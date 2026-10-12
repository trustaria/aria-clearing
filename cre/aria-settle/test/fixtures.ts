import type { Hex } from 'viem'

export const idA = `0x${'aa'.repeat(32)}` as Hex
export const idB = `0x${'bb'.repeat(32)}` as Hex
export const idC = `0x${'cc'.repeat(32)}` as Hex
export const idD = `0x${'dd'.repeat(32)}` as Hex

export const onchainEvent = (kind: number, status: number, loggedAt: bigint) => ({
	campaignId: `0x${'01'.repeat(32)}` as Hex,
	publisher: '0x00000000000000000000000000000000000000aa' as Hex,
	kind,
	status,
	loggedAt,
	price: 10_000n,
})
