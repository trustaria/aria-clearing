import type { Hex } from 'viem'
import type { Evidence } from './evidence'
import type { Candidate, Kind } from './select'

export const MIN_VIEW_MS = 1000
export const MIN_VISIBLE_RATIO = 0.5

export type Decision = {
	release: Hex[]
	reject: Hex[]
}

/** Impression: seen for 1 s at half visibility. Click: redirected. Evidence of another kind never passes. */
export const passes = (kind: Kind, evidence: Omit<Evidence, 'id'> | undefined): boolean => {
	if (!evidence || evidence.kind !== kind) return false
	if (kind === 'click') return evidence.clickRedirected
	return evidence.viewMs >= MIN_VIEW_MS && evidence.visibleRatio >= MIN_VISIBLE_RATIO
}

/** Disputed or unproven events are rejected; the rest are released. Input order is kept. */
export const decide = (candidates: readonly Candidate[], evidence: ReadonlyMap<string, Evidence>): Decision => {
	const release: Hex[] = []
	const reject: Hex[] = []
	for (const c of candidates) {
		if (!c.disputed && passes(c.kind, evidence.get(c.id.toLowerCase()))) release.push(c.id)
		else reject.push(c.id)
	}
	return { release, reject }
}
