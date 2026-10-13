import { describe, expect, it } from "vitest";
import { activeSection } from "../lib/demo-nav";

describe("activeSection", () => {
  it("maps each product's pages to its section", () => {
    expect(activeSection("/")).toBe("overview");
    expect(activeSection("/ai-chat")).toBe("chat");
    expect(activeSection("/dashboard")).toBe("dashboard");
    expect(activeSection("/advertise")).toBe("advertise");
    expect(activeSection("/advertise/new")).toBe("advertise");
    expect(activeSection("/advertise/c/crema-works-a1b2")).toBe("advertise");
  });

  it("leaves receipts and unknown pages unhighlighted", () => {
    expect(activeSection("/receipt/req_0123456789abcdefABCDEF")).toBeNull();
    expect(activeSection("/~offline")).toBeNull();
    expect(activeSection(null)).toBeNull();
  });

  it("matches whole path segments only", () => {
    expect(activeSection("/advertisers")).toBeNull();
    expect(activeSection("/dashboard-old")).toBeNull();
    expect(activeSection("/ai-chatbot")).toBeNull();
  });
});
