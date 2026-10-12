import { parseAbi } from 'viem'

/** The AriaClearing views the workflow reads. Enums decode as uint8. */
export const ariaClearingAbi = parseAbi([
	'struct ClearingEvent { bytes32 campaignId; address publisher; uint8 kind; uint8 status; uint64 loggedAt; uint256 price; }',
	'function pendingEvents() view returns (bytes32[] ids, ClearingEvent[] events)',
	'function disputeWindow() view returns (uint64)',
	'function lastReportedAt() view returns (uint64)',
])
