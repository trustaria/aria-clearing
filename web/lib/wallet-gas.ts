// Gas limits for transactions the advertiser's wallet sends. Monad charges the full gas limit, so limits are
// explicit: the RPC estimate plus 20 %, or a fixed limit while the estimate can't run yet.

/** Limits used when a call can't be estimated yet (createCampaign needs the USDC and the allowance first). */
export const FALLBACK_GAS = {
  approve: 150_000n,
  createCampaign: 400_000n,
  dispute: 60_000n,
  withdraw: 165_000n,
} as const;

/** The estimate plus 20 %, rounded up. */
export function withMargin(estimate: bigint): bigint {
  return (estimate * 12n + 9n) / 10n;
}

/** MON in wei for these gas limits at `feePerGas`. */
export function feeFor(limits: bigint[], feePerGas: bigint): bigint {
  return limits.reduce((sum, limit) => sum + limit, 0n) * feePerGas;
}
