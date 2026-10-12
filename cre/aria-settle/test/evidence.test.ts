import { describe, expect, test } from 'bun:test'
import { parseEvidence, parseEvidenceText } from '../src/evidence'
import { idA, idB, idC } from './fixtures'

const good = {
	id: idA,
	kind: 'impression',
	viewMs: 1500,
	visibleRatio: 0.8,
	clickRedirected: false,
	firstSeenAt: '2026-10-13T10:00:00.000Z',
}

describe('parseEvidence', () => {
	test('indexes well-formed entries by lowercase id', () => {
		const upper = `0x${'AA'.repeat(32)}`
		const map = parseEvidence({ evidence: [{ ...good, id: upper }] })
		expect(map.size).toBe(1)
		expect(map.get(idA)).toMatchObject({ kind: 'impression', viewMs: 1500, visibleRatio: 0.8 })
	})

	test('drops malformed entries and keeps the rest', () => {
		const map = parseEvidence({
			evidence: [
				good,
				{ ...good, id: idB, kind: 'banner' },
				{ ...good, id: idC, viewMs: '1500' },
				{ ...good, id: '0x1234' },
				{ ...good, id: `0x${'ee'.repeat(32)}`, visibleRatio: 1.5 },
				null,
				42,
			],
		})
		expect([...map.keys()]).toEqual([idA])
	})

	test('defaults missing signal fields to failing values', () => {
		const map = parseEvidence({ evidence: [{ id: idA, kind: 'click' }] })
		expect(map.get(idA)).toMatchObject({ viewMs: 0, visibleRatio: 0, clickRedirected: false })
	})

	test('keeps the first entry when an id repeats', () => {
		const map = parseEvidence({ evidence: [good, { ...good, viewMs: 0 }] })
		expect(map.get(idA)?.viewMs).toBe(1500)
	})

	test('returns an empty map for any malformed body', () => {
		for (const body of [null, undefined, 'x', 42, [], {}, { evidence: 'nope' }, { evidence: null }]) {
			expect(parseEvidence(body).size).toBe(0)
		}
	})
})

describe('parseEvidenceText', () => {
	test('parses a JSON body', () => {
		expect(parseEvidenceText(JSON.stringify({ evidence: [good] })).size).toBe(1)
	})

	test('returns an empty map for invalid JSON', () => {
		expect(parseEvidenceText('<html>not json</html>').size).toBe(0)
		expect(parseEvidenceText('').size).toBe(0)
	})
})
