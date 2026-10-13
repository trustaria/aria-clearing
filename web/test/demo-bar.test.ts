import { describe, expect, it } from "vitest";
import { DEMO_BAR_SCRIPT, setDemoBarHidden } from "../lib/demo-bar";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("setDemoBarHidden", () => {
  it("marks the page and remembers the choice", () => {
    const storage = memoryStorage();
    const root = { dataset: {} as DOMStringMap };
    setDemoBarHidden(true, storage, root);
    expect(root.dataset.demoBar).toBe("hidden");
    expect([...storage.data.values()]).toEqual(["hidden"]);

    setDemoBarHidden(false, storage, root);
    expect(root.dataset.demoBar).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });

  it("still hides the bar for this page when storage throws or is missing", () => {
    const root = { dataset: {} as DOMStringMap };
    expect(() => setDemoBarHidden(true, throwing, root)).not.toThrow();
    expect(root.dataset.demoBar).toBe("hidden");
    expect(() => setDemoBarHidden(false, null, root)).not.toThrow();
    expect(root.dataset.demoBar).toBeUndefined();
  });
});

describe("DEMO_BAR_SCRIPT", () => {
  function run(storage: unknown) {
    const root = { dataset: {} as DOMStringMap };
    new Function("localStorage", "document", DEMO_BAR_SCRIPT)(storage, { documentElement: root });
    return root.dataset.demoBar;
  }

  it("hides the bar before paint when the viewer dismissed it", () => {
    const storage = memoryStorage();
    setDemoBarHidden(true, storage, { dataset: {} as DOMStringMap });
    expect(run(storage)).toBe("hidden");
    expect(run(memoryStorage())).toBeUndefined();
  });

  it("does nothing when storage throws", () => {
    expect(run(throwing)).toBeUndefined();
  });
});
