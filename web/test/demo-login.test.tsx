import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TestLogin from "../components/dashboard/TestLogin";
import { demoPublisherLogin } from "../lib/demo-login";

describe("demoPublisherLogin", () => {
  it("returns the email and code when both are set", () => {
    expect(demoPublisherLogin({ email: " test-1@privy.io ", code: " 123456 " })).toEqual({
      email: "test-1@privy.io",
      code: "123456",
    });
  });

  it("returns null when either value is missing or blank", () => {
    expect(demoPublisherLogin({ email: "test-1@privy.io", code: undefined })).toBeNull();
    expect(demoPublisherLogin({ email: undefined, code: "123456" })).toBeNull();
    expect(demoPublisherLogin({ email: " ", code: "123456" })).toBeNull();
  });
});

describe("TestLogin", () => {
  it("shows the test email and code", () => {
    const html = renderToStaticMarkup(<TestLogin login={{ email: "test-1@privy.io", code: "123456" }} />);
    expect(html).toContain("test-1@privy.io");
    expect(html).toContain("123456");
  });

  it("renders nothing without a login", () => {
    expect(renderToStaticMarkup(<TestLogin login={null} />)).toBe("");
  });
});
