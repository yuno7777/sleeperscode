import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ReadinessCell } from "./AgentHubPage";

describe("ReadinessCell", () => {
  it("announces both positive and negative readiness without changing the visible label", () => {
    const ready = renderToStaticMarkup(<ReadinessCell label="Installed" ready />);
    const unavailable = renderToStaticMarkup(<ReadinessCell label="Routable" ready={false} />);

    expect(ready).toContain('<span class="sr-only">Installed: Yes</span>');
    expect(ready).toContain('aria-hidden="true">Installed</span>');
    expect(unavailable).toContain('<span class="sr-only">Routable: No</span>');
    expect(unavailable).toContain('aria-hidden="true">Routable</span>');
  });
});
