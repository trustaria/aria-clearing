import {
	bytesToHex,
	consensusIdenticalAggregation,
	type CronPayload,
	cre,
	encodeCallMsg,
	type EVMClient,
	getNetwork,
	hexToBase64,
	type HTTPSendRequester,
	LATEST_BLOCK_NUMBER,
	ok,
	prepareReportRequest,
	type Runtime,
	text,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	type Address,
	decodeFunctionResult,
	encodeFunctionData,
	type Hex,
	stringToHex,
	zeroAddress,
} from 'viem'
import { z } from 'zod'
import { ariaClearingAbi } from './abi'
import { parseEvidenceText } from './evidence'
import { type Decision, decide } from './rule'
import { type Candidate, selectSettleable } from './select'
import { encodeReport } from './report'

export const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	clearingAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	evidenceUrl: z.string().regex(/^https?:\/\/\S+$/),
	gasLimit: z.string().regex(/^\d+$/),
	maxIdsPerReport: z.number().int().positive(),
})
export type Config = z.infer<typeof configSchema>

/** eth_call against AriaClearing at the latest block. */
const callClearing = (runtime: Runtime<Config>, evm: EVMClient, data: Hex): Hex => {
	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({ from: zeroAddress, to: runtime.config.clearingAddress as Address, data }),
			blockNumber: LATEST_BLOCK_NUMBER,
		})
		.result()
	return bytesToHex(reply.data)
}

const readPending = (runtime: Runtime<Config>, evm: EVMClient) =>
	decodeFunctionResult({
		abi: ariaClearingAbi,
		functionName: 'pendingEvents',
		data: callClearing(runtime, evm, encodeFunctionData({ abi: ariaClearingAbi, functionName: 'pendingEvents' })),
	})

const readUint64 = (runtime: Runtime<Config>, evm: EVMClient, functionName: 'disputeWindow' | 'lastReportedAt') =>
	decodeFunctionResult({
		abi: ariaClearingAbi,
		functionName,
		data: callClearing(runtime, evm, encodeFunctionData({ abi: ariaClearingAbi, functionName })),
	})

/** Runs on each node: one POST with every id, then the rule. Consensus is over the decision. */
export const fetchDecision = (
	sendRequester: HTTPSendRequester,
	evidenceUrl: string,
	candidates: Candidate[],
): Decision => {
	const body = JSON.stringify({ ids: candidates.map((c) => c.id) })
	const response = sendRequester
		.sendRequest({
			url: evidenceUrl,
			method: 'POST',
			body: hexToBase64(stringToHex(body)),
			headers: { 'Content-Type': 'application/json' },
		})
		.result()
	if (!ok(response)) throw new Error(`evidence API returned HTTP ${response.statusCode}`)
	return decide(candidates, parseEvidenceText(text(response)))
}

export const onCron = (runtime: Runtime<Config>, _payload: CronPayload): string => {
	const config = runtime.config
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName })
	if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`)
	const evm = new cre.capabilities.EVMClient(network.chainSelector.selector)

	const [ids, events] = readPending(runtime, evm)
	const windowSec = readUint64(runtime, evm, 'disputeWindow')
	const lastReportedAt = readUint64(runtime, evm, 'lastReportedAt')
	const nowSec = BigInt(Math.floor(runtime.now().getTime() / 1000))

	const candidates = selectSettleable(ids, events, { windowSec, nowSec, maxIds: config.maxIdsPerReport })
	runtime.log(
		`aria-settle: ${ids.length} pending, ${candidates.length} past the ${windowSec}s window (now=${nowSec}, cap=${config.maxIdsPerReport})`,
	)
	if (candidates.length === 0) {
		runtime.log('aria-settle: nothing to settle')
		return 'nothing to settle'
	}
	if (nowSec <= lastReportedAt) {
		runtime.log(`aria-settle: now=${nowSec} is not after lastReportedAt=${lastReportedAt}, skipping`)
		return 'stale clock'
	}

	const disputed = candidates.filter((c) => c.disputed)
	const logged = candidates.filter((c) => !c.disputed)
	const verdict: Decision =
		logged.length === 0
			? { release: [], reject: [] }
			: new cre.capabilities.HTTPClient()
					.sendRequest(runtime, fetchDecision, consensusIdenticalAggregation<Decision>())(
						config.evidenceUrl,
						logged,
					)
					.result()
	const release = verdict.release
	const reject = [...verdict.reject, ...disputed.map((c) => c.id)]

	runtime.log(`aria-settle: release ${release.length}, reject ${reject.length}`)
	for (const id of release) runtime.log(`aria-settle:   release ${id}`)
	for (const id of reject) runtime.log(`aria-settle:   reject  ${id}`)
	if (disputed.length > 0) runtime.log(`aria-settle: ${disputed.length} disputed, refunded without evidence`)

	const payload = encodeReport({ reportedAt: nowSec, release, reject })
	const report = runtime.report(prepareReportRequest(payload)).result()
	const reply = evm
		.writeReport(runtime, {
			receiver: config.clearingAddress,
			report,
			gasConfig: { gasLimit: config.gasLimit },
		})
		.result()

	const txHash = reply.txHash ? bytesToHex(reply.txHash) : 'none'
	runtime.log(
		`aria-settle: writeReport txStatus=${TxStatus[reply.txStatus]} receiver=${reply.receiverContractExecutionStatus ?? 'n/a'} tx=${txHash}${reply.errorMessage ? ` error=${reply.errorMessage}` : ''}`,
	)
	if (reply.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${reply.errorMessage ?? reply.txStatus}`)
	runtime.log('aria-settle: confirm with the EventSettled logs on AriaClearing; the mock forwarder never reverts')
	return `released=${release.length} rejected=${reject.length} tx=${txHash}`
}

export const initWorkflow = (config: Config) => [
	cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCron),
]
