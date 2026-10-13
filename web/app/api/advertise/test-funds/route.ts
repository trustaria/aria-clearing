import { verifyAdvertiser } from "@/lib/advertiser-auth";
import { advertiserWalletOf } from "@/lib/advertiser-wallet";
import { hasDemoKey } from "@/lib/demo-key";
import {
  currentFeePerGas,
  sendTestFunds,
  testFundsGrants,
  testFundsSourceUsdc,
  walletBalances,
} from "@/lib/test-funds";
import { fundingModeFromEnv, launchLimitsFromEnv } from "../campaigns/handlers";
import { createTestFundsHandler, testFundsPerUserFromEnv } from "./handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends test USDC and MON from the deployer key to the signed-in advertiser's embedded wallet. */
export const POST = createTestFundsHandler({
  auth: (req) => verifyAdvertiser(req),
  funding: fundingModeFromEnv,
  walletOf: advertiserWalletOf,
  bypass: hasDemoKey,
  limits: launchLimitsFromEnv,
  perUser: testFundsPerUserFromEnv,
  grants: {
    count: (userId) => testFundsGrants().count(userId),
    record: (userId, grant) => testFundsGrants().record(userId, grant),
  },
  balances: walletBalances,
  feePerGas: currentFeePerGas,
  sourceUsdc: testFundsSourceUsdc,
  send: sendTestFunds,
});
