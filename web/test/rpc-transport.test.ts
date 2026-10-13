import { describe, expect, it } from "vitest";
import { rpcTransport } from "../lib/chain";

describe("rpcTransport", () => {
  it("never lets Next cache RPC responses", () => {
    const transport = rpcTransport("https://rpc.example")({ retryCount: 0 });
    expect(transport.value?.fetchOptions).toMatchObject({ cache: "no-store" });
  });

  it("keeps the retry options it is given", () => {
    const transport = rpcTransport("https://rpc.example", { retryCount: 3, retryDelay: 300 })({});
    expect(transport.config.retryCount).toBe(3);
    expect(transport.config.retryDelay).toBe(300);
  });
});
