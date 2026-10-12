import { describe, expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { decodeReport, encodeReport } from '../src/report'

const one = `0x${'11'.repeat(32)}` as Hex
const two = `0x${'22'.repeat(32)}` as Hex
const three = `0x${'33'.repeat(32)}` as Hex

// cast abi-encode "f(uint64,bytes32[],bytes32[])" 1760300000 "[0x11..11,0x22..22]" "[0x33..33]"
const castEncoded = (
	'0x0000000000000000000000000000000000000000000000000000000068ec0be0' +
	'0000000000000000000000000000000000000000000000000000000000000060' +
	'00000000000000000000000000000000000000000000000000000000000000c0' +
	'0000000000000000000000000000000000000000000000000000000000000002' +
	'1111111111111111111111111111111111111111111111111111111111111111' +
	'2222222222222222222222222222222222222222222222222222222222222222' +
	'0000000000000000000000000000000000000000000000000000000000000001' +
	'3333333333333333333333333333333333333333333333333333333333333333') as Hex

describe('encodeReport', () => {
	test('matches cast abi-encode for a fixed example', () => {
		expect(encodeReport({ reportedAt: 1760300000n, release: [one, two], reject: [three] })).toBe(castEncoded)
	})

	test('round-trips through decodeReport', () => {
		const input = { reportedAt: 1760300000n, release: [one], reject: [two, three] }
		expect(decodeReport(encodeReport(input))).toEqual(input)
	})

	test('round-trips empty lists', () => {
		const input = { reportedAt: 1n, release: [], reject: [] }
		expect(decodeReport(encodeReport(input))).toEqual(input)
	})

	test('rejects a reportedAt that does not fit uint64', () => {
		expect(() => encodeReport({ reportedAt: 2n ** 64n, release: [], reject: [] })).toThrow()
	})

	test('stays under the 50 KB report quota at 40 ids', () => {
		const ids = Array.from({ length: 40 }, () => one)
		const bytes = (encodeReport({ reportedAt: 1n, release: ids, reject: [] }).length - 2) / 2
		expect(bytes).toBeLessThan(50 * 1024)
	})
})
