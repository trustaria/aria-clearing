import { describe, expect, test } from 'bun:test'
import type { Evidence } from '../src/evidence'
import { decide, passes } from '../src/rule'
import type { Candidate } from '../src/select'
import { idA, idB, idC, idD } from './fixtures'

const impression = (viewMs: number, visibleRatio: number): Omit<Evidence, 'id'> => ({
	kind: 'impression',
	viewMs,
	visibleRatio,
	clickRedirected: false,
})
const click = (clickRedirected: boolean): Omit<Evidence, 'id'> => ({
	kind: 'click',
	viewMs: 0,
	visibleRatio: 0,
	clickRedirected,
})

describe('passes', () => {
	test('impression needs viewMs >= 1000 and visibleRatio >= 0.5', () => {
		expect(passes('impression', impression(1000, 0.5))).toBe(true)
		expect(passes('impression', impression(999, 1))).toBe(false)
		expect(passes('impression', impression(5000, 0.49))).toBe(false)
		expect(passes('impression', impression(0, 0))).toBe(false)
	})

	test('click needs clickRedirected', () => {
		expect(passes('click', click(true))).toBe(true)
		expect(passes('click', click(false))).toBe(false)
	})

	test('evidence of the other kind never passes', () => {
		expect(passes('impression', click(true))).toBe(false)
		expect(passes('click', impression(5000, 1))).toBe(false)
	})

	test('missing evidence never passes', () => {
		expect(passes('impression', undefined)).toBe(false)
		expect(passes('click', undefined)).toBe(false)
	})
})

describe('decide', () => {
	const candidate = (id: Candidate['id'], kind: Candidate['kind'], disputed = false): Candidate => ({
		id,
		kind,
		disputed,
		loggedAt: 1,
	})

	test('splits candidates into release and reject, keeping input order', () => {
		const evidence = new Map<string, Evidence>([
			[idA, { id: idA, ...impression(1500, 0.9) }],
			[idB, { id: idB, ...impression(0, 0) }],
			[idC, { id: idC, ...click(true) }],
		])
		const out = decide(
			[candidate(idA, 'impression'), candidate(idB, 'impression'), candidate(idC, 'click'), candidate(idD, 'click')],
			evidence,
		)
		expect(out).toEqual({ release: [idA, idC], reject: [idB, idD] })
	})

	test('rejects disputed events even with passing evidence', () => {
		const evidence = new Map<string, Evidence>([[idA, { id: idA, ...impression(5000, 1) }]])
		expect(decide([candidate(idA, 'impression', true)], evidence)).toEqual({ release: [], reject: [idA] })
	})

	test('returns empty lists for no candidates', () => {
		expect(decide([], new Map())).toEqual({ release: [], reject: [] })
	})
})
