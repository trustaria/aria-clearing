import { describe, expect } from 'bun:test'
import {
	addContractMock,
	EvmMock,
	HttpActionsMock,
	newTestRuntime,
	REPORT_METADATA_HEADER_LENGTH,
	test,
} from '@chainlink/cre-sdk/test'
import { bytesToHex, type Hex } from 'viem'
import { ariaClearingAbi } from '../src/abi'
import { decodeReport, type SettlementReport } from '../src/report'
import { type Config, onCron } from '../src/workflow'
import { idA, idB, idC, idD, onchainEvent } from './fixtures'

const MONAD_TESTNET = 2183018362218727504n
const CLEARING = '0x00000000000000000000000000000000000c1ea2' as const
const NOW_SEC = 1_760_300_000n

const config: Config = {
	schedule: '*/30 * * * * *',
	chainSelectorName: 'monad-testnet',
	clearingAddress: CLEARING,
	evidenceUrl: 'http://localhost:3000/api/aria/evidence',
	gasLimit: '500000',
	maxIdsPerReport: 40,
}

type Pending = { ids: Hex[]; events: ReturnType<typeof onchainEvent>[] }

const setup = (pending: Pending, evidence: unknown[] | null, lastReportedAt = 0n) => {
	const runtime = newTestRuntime<Config>(null, { timeProvider: () => Number(NOW_SEC) * 1000 }, config)
	const evm = EvmMock.testInstance(MONAD_TESTNET)
	const clearing = addContractMock(evm, { address: CLEARING, abi: ariaClearingAbi })
	clearing.pendingEvents = () => [pending.ids, pending.events]
	clearing.disputeWindow = () => 20n
	clearing.lastReportedAt = () => lastReportedAt

	const reports: SettlementReport[] = []
	clearing.writeReport = ({ report, gasConfig }) => {
		expect(gasConfig.gasLimit).toBe(500000n)
		reports.push(decodeReport(bytesToHex(report.rawReport.slice(REPORT_METADATA_HEADER_LENGTH))))
		return { txStatus: 'TX_STATUS_SUCCESS', txHash: Buffer.alloc(32, 0xab).toString('base64') }
	}

	const requests: string[][] = []
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		requests.push(JSON.parse(new TextDecoder().decode(req.body)).ids)
		if (evidence === null) return { statusCode: 500, body: '' }
		return { statusCode: 200, body: Buffer.from(JSON.stringify({ evidence })).toString('base64') }
	}
	return { runtime, reports, requests }
}

const old = NOW_SEC - 60n

describe('onCron', () => {
	test('settles closed-window events with one evidence call and one report', () => {
		const { runtime, reports, requests } = setup(
			{
				ids: [idA, idB, idC, idD],
				events: [
					onchainEvent(0, 1, old),
					onchainEvent(1, 1, old),
					onchainEvent(0, 2, old),
					onchainEvent(0, 1, NOW_SEC - 5n),
				],
			},
			[
				{ id: idA, kind: 'impression', viewMs: 1800, visibleRatio: 0.9, clickRedirected: false, firstSeenAt: 1 },
				{ id: idB, kind: 'click', viewMs: 0, visibleRatio: 0, clickRedirected: false, firstSeenAt: 1 },
			],
		)

		const result = onCron(runtime, {} as never)

		expect(requests).toEqual([[idA, idB]])
		expect(reports).toEqual([{ reportedAt: NOW_SEC, release: [idA], reject: [idB, idC] }])
		expect(result).toContain('released=1 rejected=2')
		expect(runtime.getLogs().join('\n')).toContain('4 pending, 3 past the 20s window')
	})

	test('does nothing when no window has closed', () => {
		const { runtime, reports, requests } = setup({ ids: [idA], events: [onchainEvent(0, 1, NOW_SEC)] }, [])
		expect(onCron(runtime, {} as never)).toBe('nothing to settle')
		expect(requests).toEqual([])
		expect(reports).toEqual([])
	})

	test('skips the evidence call when every candidate is disputed', () => {
		const { runtime, reports, requests } = setup({ ids: [idA], events: [onchainEvent(0, 2, old)] }, [])
		onCron(runtime, {} as never)
		expect(requests).toEqual([])
		expect(reports).toEqual([{ reportedAt: NOW_SEC, release: [], reject: [idA] }])
	})

	test('rejects every logged id the evidence API does not know', () => {
		const { runtime, reports, requests } = setup(
			{ ids: [idA, idB], events: [onchainEvent(0, 1, old), onchainEvent(1, 1, old)] },
			[],
		)
		onCron(runtime, {} as never)
		expect(requests).toEqual([[idA, idB]])
		expect(reports).toEqual([{ reportedAt: NOW_SEC, release: [], reject: [idA, idB] }])
	})

	test('fails the run without a report when the evidence API errors', () => {
		const { runtime, reports } = setup({ ids: [idA], events: [onchainEvent(0, 1, old)] }, null)
		expect(() => onCron(runtime, {} as never)).toThrow()
		expect(reports).toEqual([])
	})

	test('does not report when the clock is not after lastReportedAt', () => {
		const { runtime, reports } = setup({ ids: [idA], events: [onchainEvent(0, 1, old)] }, [], NOW_SEC)
		expect(onCron(runtime, {} as never)).toBe('stale clock')
		expect(reports).toEqual([])
	})
})
