import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { claimsHash, eventIdOf, formatClaims, Kind, rationaleHash } from "../src/hash";
import { verifyReceipt } from "../src/verify";

// Anvil's first dev account.
const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const foundryPath = `${process.env.HOME}/.foundry/bin:${process.env.PATH}`;
const env = { ...process.env, PATH: foundryPath, DYLD_FALLBACK_LIBRARY_PATH: `${process.env.HOME}/.local/libusb/lib` };
const hasFoundry = spawnSync("anvil", ["--version"], { env }).status === 0;

const requestId = "req_anvil";
const claims = formatClaims(["Kids under 6 stay free.", "Free cancellation up to 48 hours."]);
const campaignId = keccak256(toBytes("hotel-lumen"));
const rationale = "Kids under 6 stay free.";
const lateRequestId = "req_late";
const lateClaims = formatClaims(["Free airport pickup.", "Late checkout until 2pm."]);
const lateCampaignId = keccak256(toBytes("hotel-late"));
const lateRationale = "Free airport pickup.";
// One second between blocks keeps timestamps strictly increasing, as the block search needs.
const mine = (client: PublicClient, blocks: number) =>
  client.request({ method: "anvil_mine" as never, params: [`0x${blocks.toString(16)}`, "0x1"] as never });

describe.skipIf(!hasFoundry)("verifyReceipt against anvil", () => {
  let anvil: ChildProcess;
  let outDir: string;
  let client: PublicClient;
  let emitter: Address;
  const account = privateKeyToAccount(DEV_KEY);
  const wallet = createWalletClient({ account, chain: foundry, transport: http(RPC) });

  const send = async (functionName: string, args: unknown[]) => {
    const hash = await wallet.writeContract({ address: emitter, abi: emitterAbi, functionName, args });
    await client.waitForTransactionReceipt({ hash });
  };
  let emitterAbi: Abi;

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "receipt-emitter-"));
    execFileSync("forge", ["build", "--root", ROOT, "--contracts", FIXTURES, "--out", outDir, "--cache-path", join(outDir, "cache")], { env });
    const artifact = JSON.parse(readFileSync(join(outDir, "Emitter.sol", "Emitter.json"), "utf8"));
    emitterAbi = artifact.abi;

    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { env, stdio: "ignore" });
    client = createPublicClient({ chain: foundry, transport: http(RPC) });
    for (let i = 0; i < 50; i++) {
      try {
        await client.getBlockNumber();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const deployHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args: [] });
    emitter = (await client.waitForTransactionReceipt({ hash: deployHash })).contractAddress!;

    await send("campaignCreated", [campaignId, claims, claimsHash(claims)]);
    await send("eventLogged", [
      eventIdOf(requestId, Kind.Impression),
      campaignId,
      requestId,
      Kind.Impression,
      rationale,
      keccak256(toBytes(rationale)),
      [1],
    ]);
    for (let i = 0; i < 30; i++) await client.request({ method: "evm_mine" as never, params: [] as never });
    await send("eventSettled", [eventIdOf(requestId, Kind.Impression), 3]);

    // A campaign created long after deploy.
    await mine(client, 1500);
    await send("campaignCreated", [lateCampaignId, lateClaims, claimsHash(lateClaims)]);
    await mine(client, 20);
    await send("eventLogged", [
      eventIdOf(lateRequestId, Kind.Impression),
      lateCampaignId,
      lateRequestId,
      Kind.Impression,
      lateRationale,
      keccak256(toBytes(lateRationale)),
      [1],
    ]);
  }, 60_000);

  afterAll(() => {
    anvil?.kill();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("verifies a released receipt, scanning in small chunks", async () => {
    const receipt = await verifyReceipt(requestId, { rpcUrl: RPC, address: emitter, fromBlock: 0n, maxRange: 7n, concurrency: 3 });

    expect(receipt.ok).toBe(true);
    expect(receipt.events[0].status).toBe("released");
    expect(receipt.events[0].citedClaims).toEqual(["1. Kids under 6 stay free."]);
    expect(receipt.events[0].eventId).toBe(eventIdOf(requestId, Kind.Impression));
    expect(receipt.events[0].settledTx).toBeDefined();
    expect(receipt.campaign.claims).toBe(claims);
  });

  it("keeps the view's status when the settlement tx is outside the scanned window", async () => {
    const receipt = await verifyReceipt(requestId, {
      rpcUrl: RPC,
      address: emitter,
      fromBlock: 0n,
      maxRange: 7n,
      settlementScanChunks: 1,
    });

    expect(receipt.ok).toBe(true);
    expect(receipt.events[0].status).toBe("released");
    expect(receipt.events[0].settledTx).toBeUndefined();
  });

  it("verifies without a fromBlock, leaving the claims text unavailable", async () => {
    const receipt = await verifyReceipt(requestId, { rpcUrl: RPC, address: emitter, maxRange: 7n });

    expect(receipt.ok).toBe(true);
    expect(receipt.campaign.claims).toBeNull();
    expect(receipt.campaign.claimsMatch).toBe(true);
  });

  it("finds the claims of a campaign created far after the deploy block", async () => {
    const receipt = await verifyReceipt(lateRequestId, { rpcUrl: RPC, address: emitter, fromBlock: 0n, maxRange: 7n });

    expect(receipt.ok).toBe(true);
    expect(receipt.campaign.claims).toBe(lateClaims);
    expect(receipt.events[0].citedClaims).toEqual(["1. Free airport pickup."]);
  });

  it("does not find a late campaign when the backward scan is too short and no override is given", async () => {
    const receipt = await verifyReceipt(lateRequestId, {
      rpcUrl: RPC,
      address: emitter,
      fromBlock: 0n,
      maxRange: 7n,
      campaignBackScanChunks: 1,
      campaignScanChunks: 2,
    });

    expect(receipt.campaign.claims).toBeNull();
  });

  it("starts the campaign scan at campaignFromBlock", async () => {
    const head = await client.getBlockNumber();
    const receipt = await verifyReceipt(lateRequestId, {
      rpcUrl: RPC,
      address: emitter,
      fromBlock: 0n,
      maxRange: 7n,
      campaignBackScanChunks: 1,
      campaignFromBlock: head - 40n,
    });

    expect(receipt.campaign.claims).toBe(lateClaims);
  });

  it("matches the card's receipt, chain id and contract included", async () => {
    const receipt = await verifyReceipt(requestId, {
      rpcUrl: RPC,
      address: emitter,
      fromBlock: 0n,
      maxRange: 7n,
      expected: {
        chainId: foundry.id,
        contract: emitter,
        campaignId,
        claimsHash: claimsHash(claims),
        rationaleHash: rationaleHash(rationale),
      },
    });

    expect(receipt.seen!.every((c) => c.matches)).toBe(true);
    expect(receipt.ok).toBe(true);
  });

  it("fails when the sentence the reader saw is not the one logged", async () => {
    const receipt = await verifyReceipt(requestId, {
      rpcUrl: RPC,
      address: emitter,
      fromBlock: 0n,
      maxRange: 7n,
      expected: { rationaleHash: rationaleHash("Kids under 12 stay free.") },
    });

    expect(receipt.consistent).toBe(true);
    expect(receipt.seen).toEqual([
      expect.objectContaining({ field: "rationaleHash", actual: keccak256(toBytes(rationale)), matches: false }),
    ]);
    expect(receipt.ok).toBe(false);
  });

  it("reports an unknown requestId", async () => {
    await expect(verifyReceipt("nope", { rpcUrl: RPC, address: emitter })).rejects.toThrow(/No event found/);
  });
});
