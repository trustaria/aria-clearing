import { decodeAbiParameters, encodeAbiParameters, type Hex, parseAbiParameters } from 'viem'

export type SettlementReport = {
	reportedAt: bigint
	release: Hex[]
	reject: Hex[]
}

const reportParams = parseAbiParameters('uint64 reportedAt, bytes32[] release, bytes32[] reject')

/** abi.encode(uint64 reportedAt, bytes32[] release, bytes32[] reject), as AriaClearing.onReport decodes it. */
export const encodeReport = ({ reportedAt, release, reject }: SettlementReport): Hex =>
	encodeAbiParameters(reportParams, [reportedAt, release, reject])

export const decodeReport = (data: Hex): SettlementReport => {
	const [reportedAt, release, reject] = decodeAbiParameters(reportParams, data)
	return { reportedAt, release: [...release], reject: [...reject] }
}
