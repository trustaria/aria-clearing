import { parseArgs } from "node:util";
import { rationaleHash } from "./hash";
import type { ExpectedReceipt } from "./verify";

export const USAGE =
  "Usage: verify <requestId> [--receipt '<data-aria-receipt JSON>'] [--sentence \"<text you saw>\"] [--rpc URL] [--address 0x..] [--from-block N] [--campaign-block N]";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface CliArgs {
  requestId: string;
  rpc?: string;
  address?: string;
  fromBlock?: bigint;
  campaignBlock?: bigint;
  /** Values to compare with what was logged; undefined when neither --receipt nor --sentence was given. */
  expected?: ExpectedReceipt;
  /** --sentence was given, so the expected rationaleHash is the hash of text the reader saw. */
  sentenceGiven: boolean;
}

/** The inputs contradict each other: what the reader saw is not what the card embedded. */
export class SeenMismatchError extends Error {}

function fail(message: string): never {
  throw new Error(`${message}\n${USAGE}`);
}

function block(value: string | undefined, flag: string): bigint | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) fail(`${flag} must be a block number`);
  return BigInt(value);
}

/** The comparable fields of a card's data-aria-receipt JSON. */
export function parseReceiptJson(json: string, requestId: string): ExpectedReceipt {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    fail("--receipt is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("--receipt must be a JSON object");
  const r = raw as Record<string, unknown>;
  if (r.requestId !== undefined && r.requestId !== requestId) {
    fail(`--receipt is for requestId "${String(r.requestId)}", not "${requestId}"`);
  }

  const expected: ExpectedReceipt = {};
  if (r.chainId !== undefined) {
    if (typeof r.chainId !== "number" || !Number.isInteger(r.chainId)) fail("--receipt chainId must be an integer");
    expected.chainId = r.chainId;
  }
  if (r.contract !== undefined) {
    if (typeof r.contract !== "string" || !ADDRESS.test(r.contract)) fail("--receipt contract must be an address");
    expected.contract = r.contract;
  }
  for (const field of ["campaignId", "claimsHash", "rationaleHash"] as const) {
    const value = r[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !HASH.test(value)) fail(`--receipt ${field} must be a 32-byte hex string`);
    expected[field] = value;
  }
  if (Object.keys(expected).length === 0) fail("--receipt has none of chainId, contract, campaignId, claimsHash, rationaleHash");
  return expected;
}

/** Parses the verify CLI's arguments. Throws with the usage line on bad input. */
export function parseCliArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        rpc: { type: "string" },
        address: { type: "string" },
        "from-block": { type: "string" },
        "campaign-block": { type: "string" },
        receipt: { type: "string" },
        sentence: { type: "string" },
      },
    });
  } catch (error) {
    fail((error as Error).message);
  }
  const { values, positionals } = parsed;
  const requestId = positionals[0];
  if (!requestId) fail("Missing <requestId>");

  let expected: ExpectedReceipt | undefined;
  if (values.receipt !== undefined) expected = parseReceiptJson(values.receipt, requestId);
  if (values.sentence !== undefined) {
    if (values.sentence.trim() === "") fail("--sentence is empty");
    const hash = rationaleHash(values.sentence);
    if (expected?.rationaleHash !== undefined && expected.rationaleHash.toLowerCase() !== hash) {
      throw new SeenMismatchError(
        "✗ Mismatch: rationaleHash. The --sentence does not hash to the --receipt rationaleHash, so the card showed a different sentence than it embedded",
      );
    }
    expected = { ...expected, rationaleHash: hash };
  }

  return {
    requestId,
    rpc: values.rpc,
    address: values.address,
    fromBlock: block(values["from-block"], "--from-block"),
    campaignBlock: block(values["campaign-block"], "--campaign-block"),
    expected,
    sentenceGiven: values.sentence !== undefined,
  };
}
