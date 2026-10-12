import { describe, expect, it, vi } from "vitest";
import { createPublisherHandlers } from "../app/api/aria/publisher/handlers";
import type { PublisherStore } from "../lib/publisher";

const ADDRESS = "0xd2d508841c0c99d31c78c03c94338d88ca19416b";
const CHECKSUMMED = "0xD2D508841C0C99D31C78C03C94338D88Ca19416b";

function setup(saved?: `0x${string}`) {
  let current = saved;
  const store: PublisherStore = {
    get: () => current,
    set: vi.fn((address: string) => {
      current = address as `0x${string}`;
    }),
  };
  const load = vi.fn(async (address: string) => ({ address, claimable: "10000" }));
  return { store, load, handlers: createPublisherHandlers({ store, load: load as never }) };
}

function post(body: unknown) {
  return new Request("http://localhost/api/aria/publisher", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/aria/publisher", () => {
  it("stores a valid address checksummed", async () => {
    const { store, handlers } = setup();
    const res = await handlers.POST(post({ address: ADDRESS }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: CHECKSUMMED });
    expect(store.set).toHaveBeenCalledWith(CHECKSUMMED);
  });

  it.each([[{ address: "0x123" }], [{ address: 42 }], [{}], ["not json"], [null]])("rejects %j with 400", async (body) => {
    const { store, handlers } = setup();
    const res = await handlers.POST(post(body));
    expect(res.status).toBe(400);
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe("GET /api/aria/publisher", () => {
  it("loads the dashboard for the address in the query", async () => {
    const { load, handlers } = setup();
    const res = await handlers.GET(new Request(`http://localhost/api/aria/publisher?address=${ADDRESS}`));
    expect(res.status).toBe(200);
    expect(load).toHaveBeenCalledWith(CHECKSUMMED);
    expect(await res.json()).toEqual({ address: CHECKSUMMED, claimable: "10000" });
  });

  it("falls back to the stored publisher", async () => {
    const { load, handlers } = setup(CHECKSUMMED);
    const res = await handlers.GET(new Request("http://localhost/api/aria/publisher"));
    expect(res.status).toBe(200);
    expect(load).toHaveBeenCalledWith(CHECKSUMMED);
  });

  it("rejects a malformed address with 400", async () => {
    const { load, handlers } = setup();
    const res = await handlers.GET(new Request("http://localhost/api/aria/publisher?address=0xnope"));
    expect(res.status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });

  it("returns 404 when no publisher is known", async () => {
    const { handlers } = setup();
    const res = await handlers.GET(new Request("http://localhost/api/aria/publisher"));
    expect(res.status).toBe(404);
  });

  it("returns 502 when the chain read fails", async () => {
    const { handlers, load } = setup();
    load.mockRejectedValueOnce(new Error("rpc down"));
    const res = await handlers.GET(new Request(`http://localhost/api/aria/publisher?address=${ADDRESS}`));
    expect(res.status).toBe(502);
  });
});
