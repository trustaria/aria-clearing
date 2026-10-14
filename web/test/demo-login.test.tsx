import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TestLogin from "../components/TestLogin";
import { demoLogin } from "../lib/demo-login";

describe("demoLogin", () => {
  it("returns the email and code when both are set", () => {
    expect(demoLogin({ email: " test-1@privy.io ", code: " 123456 " })).toEqual({
      email: "test-1@privy.io",
      code: "123456",
    });
  });

  it("returns null when either value is missing or blank", () => {
    expect(demoLogin({ email: "test-1@privy.io", code: undefined })).toBeNull();
    expect(demoLogin({ email: undefined, code: "123456" })).toBeNull();
    expect(demoLogin({ email: " ", code: "123456" })).toBeNull();
  });
});

describe("TestLogin", () => {
  it("shows the test email and code", () => {
    const html = renderToStaticMarkup(<TestLogin login={{ email: "test-1@privy.io", code: "123456" }} note="Shared account." />);
    expect(html).toContain("test-1@privy.io");
    expect(html).toContain("123456");
    expect(html).toContain("Shared account.");
  });

  it("renders nothing without a login", () => {
    expect(renderToStaticMarkup(<TestLogin login={null} note="Shared account." />)).toBe("");
  });
});
