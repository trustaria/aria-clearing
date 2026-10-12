import { describe, expect, test } from 'bun:test'
import { getNetwork } from '@chainlink/cre-sdk'
import staging from '../config.json'
import { configSchema } from '../src/workflow'

describe('config.json', () => {
	test('matches the config schema', () => {
		expect(configSchema.safeParse(staging).success).toBe(true)
	})

	test('names a chain the SDK knows', () => {
		const network = getNetwork({ chainFamily: 'evm', chainSelectorName: staging.chainSelectorName })
		expect(network?.chainSelector.selector).toBe(2183018362218727504n)
	})
})
