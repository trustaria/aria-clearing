import type { Hex } from 'viem'
import { z } from 'zod'

/** One entry of the evidence API response. */
const evidenceSchema = z.object({
	id: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
	kind: z.enum(['impression', 'click']),
	viewMs: z.number().finite().nonnegative().default(0),
	visibleRatio: z.number().min(0).max(1).default(0),
	clickRedirected: z.boolean().default(false),
})

export type Evidence = {
	id: Hex
	kind: 'impression' | 'click'
	viewMs: number
	visibleRatio: number
	clickRedirected: boolean
}

/** Indexes `{evidence: [...]}` by lowercase id. Malformed entries are dropped; a malformed body yields an empty map. */
export const parseEvidence = (body: unknown): Map<string, Evidence> => {
	const out = new Map<string, Evidence>()
	if (typeof body !== 'object' || body === null) return out
	const entries = (body as { evidence?: unknown }).evidence
	if (!Array.isArray(entries)) return out
	for (const entry of entries) {
		const parsed = evidenceSchema.safeParse(entry)
		if (!parsed.success) continue
		const id = parsed.data.id.toLowerCase() as Hex
		if (!out.has(id)) out.set(id, { ...parsed.data, id })
	}
	return out
}

export const parseEvidenceText = (text: string): Map<string, Evidence> => {
	try {
		return parseEvidence(JSON.parse(text))
	} catch {
		return new Map()
	}
}
