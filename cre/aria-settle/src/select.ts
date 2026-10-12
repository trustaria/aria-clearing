import type { Hex } from 'viem'

export type Kind = 'impression' | 'click'

/** One pending event as AriaClearing.pendingEvents() returns it. */
export type OnchainEvent = {
	kind: number
	status: number
	loggedAt: bigint
}

/** A pending event whose dispute window has closed. */
export type Candidate = {
	id: Hex
	kind: Kind
	disputed: boolean
	loggedAt: number
}

export type SelectOptions = {
	windowSec: bigint
	/** Current time in seconds; null selects every pending event and lets the contract skip open windows. */
	nowSec: bigint | null
	maxIds: number
}

const KIND_CLICK = 1
const STATUS_LOGGED = 1
const STATUS_DISPUTED = 2

/** Logged or Disputed events past their window, oldest first, capped at maxIds. */
export const selectSettleable = (
	ids: readonly Hex[],
	events: readonly OnchainEvent[],
	{ windowSec, nowSec, maxIds }: SelectOptions,
): Candidate[] => {
	const count = Math.min(ids.length, events.length)
	const out: Candidate[] = []
	for (let i = 0; i < count; i++) {
		const event = events[i]
		if (event.status !== STATUS_LOGGED && event.status !== STATUS_DISPUTED) continue
		if (nowSec !== null && event.loggedAt + windowSec > nowSec) continue
		out.push({
			id: ids[i].toLowerCase() as Hex,
			kind: event.kind === KIND_CLICK ? 'click' : 'impression',
			disputed: event.status === STATUS_DISPUTED,
			loggedAt: Number(event.loggedAt),
		})
	}
	return out.sort((a, b) => a.loggedAt - b.loggedAt).slice(0, Math.max(0, maxIds))
}
