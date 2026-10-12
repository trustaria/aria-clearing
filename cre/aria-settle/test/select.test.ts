import { describe, expect, test } from 'bun:test'
import { selectSettleable } from '../src/select'
import { idA, idB, idC, idD, onchainEvent } from './fixtures'

const LOGGED = 1
const DISPUTED = 2
const RELEASED = 3

describe('selectSettleable', () => {
	test('keeps events whose window has closed, including the exact boundary', () => {
		const ids = [idA, idB, idC]
		const events = [onchainEvent(0, LOGGED, 100n), onchainEvent(1, LOGGED, 110n), onchainEvent(0, LOGGED, 111n)]
		const out = selectSettleable(ids, events, { windowSec: 20n, nowSec: 130n, maxIds: 40 })
		expect(out.map((c) => c.id)).toEqual([idA, idB])
		expect(out.map((c) => c.kind)).toEqual(['impression', 'click'])
	})

	test('marks disputed events and skips settled ones', () => {
		const ids = [idA, idB, idC]
		const events = [onchainEvent(0, DISPUTED, 1n), onchainEvent(0, RELEASED, 1n), onchainEvent(1, LOGGED, 1n)]
		const out = selectSettleable(ids, events, { windowSec: 20n, nowSec: 100n, maxIds: 40 })
		expect(out).toEqual([
			{ id: idA, kind: 'impression', disputed: true, loggedAt: 1 },
			{ id: idC, kind: 'click', disputed: false, loggedAt: 1 },
		])
	})

	test('caps to maxIds, oldest first, stable on ties', () => {
		const ids = [idA, idB, idC, idD]
		const events = [
			onchainEvent(0, LOGGED, 50n),
			onchainEvent(0, LOGGED, 10n),
			onchainEvent(0, LOGGED, 30n),
			onchainEvent(0, LOGGED, 10n),
		]
		const out = selectSettleable(ids, events, { windowSec: 0n, nowSec: 100n, maxIds: 3 })
		expect(out.map((c) => c.id)).toEqual([idB, idD, idC])
	})

	test('selects everything pending when the clock is unavailable', () => {
		const ids = [idA, idB]
		const events = [onchainEvent(0, LOGGED, 1000n), onchainEvent(1, DISPUTED, 1000n)]
		const out = selectSettleable(ids, events, { windowSec: 20n, nowSec: null, maxIds: 40 })
		expect(out.map((c) => c.id)).toEqual([idA, idB])
	})

	test('lowercases ids and ignores a length mismatch tail', () => {
		const upper = `0x${'AB'.repeat(32)}` as const
		const out = selectSettleable([upper, idB], [onchainEvent(0, LOGGED, 1n)], {
			windowSec: 0n,
			nowSec: 10n,
			maxIds: 40,
		})
		expect(out.map((c) => c.id)).toEqual([`0x${'ab'.repeat(32)}`])
	})
})
