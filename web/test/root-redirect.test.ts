import { describe, expect, it } from "vitest";
import { chatRedirect } from "../lib/root-redirect";

describe("chatRedirect", () => {
  it("sends a debug link to the chat with the same query", () => {
    expect(chatRedirect({ debug: "x" })).toBe("/ai-chat?debug=x");
    expect(chatRedirect({ debug: "1", utm: "judge" })).toBe("/ai-chat?debug=1&utm=judge");
  });

  it("keeps an empty or repeated debug value", () => {
    expect(chatRedirect({ debug: "" })).toBe("/ai-chat?debug=");
    expect(chatRedirect({ debug: ["a", "b"] })).toBe("/ai-chat?debug=a&debug=b");
  });

  it("encodes the query values", () => {
    expect(chatRedirect({ debug: "a b&c" })).toBe("/ai-chat?debug=a+b%26c");
  });

  it("leaves plain / on the landing", () => {
    expect(chatRedirect({})).toBeNull();
    expect(chatRedirect({ utm: "judge" })).toBeNull();
    expect(chatRedirect(undefined)).toBeNull();
  });
});
