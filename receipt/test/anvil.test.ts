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
import { claimsHash, eventIdOf, formatClaims, Kind } from "../src/hash";
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
  });

  it("reports an unknown requestId", async () => {
    await expect(verifyReceipt("nope", { rpcUrl: RPC, address: emitter, fromBlock: 0n })).rejects.toThrow(/No EventLogged/);
  });
});
