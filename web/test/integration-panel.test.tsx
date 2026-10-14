import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import IntegrationPanel, {
  INTEGRATION_SNIPPET,
} from "../components/dashboard/IntegrationPanel";

describe("IntegrationPanel", () => {
  it("shows the published SDK: serve() on the server and AriaAdCard in the browser", () => {
    expect(INTEGRATION_SNIPPET).toContain(
      "npm install @trustaria/core @trustaria/react",
    );
    expect(INTEGRATION_SNIPPET).toContain(
      'import { createAria } from "@trustaria/core";',
    );
    expect(INTEGRATION_SNIPPET).toContain("aria.serve(");
    expect(INTEGRATION_SNIPPET).toContain(
      'import { AriaAdCard } from "@trustaria/react";',
    );
    expect(INTEGRATION_SNIPPET).not.toContain("/api/chat");
  });

  it("links both packages on npm", () => {
    const html = renderToStaticMarkup(
      <IntegrationPanel publisherId="pk_live_x" />,
    );
    expect(html).toContain("https://www.npmjs.com/package/@trustaria/core");
    expect(html).toContain("https://www.npmjs.com/package/@trustaria/react");
  });
});
