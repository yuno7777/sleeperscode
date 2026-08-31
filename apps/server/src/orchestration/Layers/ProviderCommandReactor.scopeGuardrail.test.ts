import { describe, expect, it } from "vite-plus/test";
import { applyProjectScopeGuardrail } from "./ProviderCommandReactor.ts";

describe("applyProjectScopeGuardrail", () => {
  it("adds project-owned scope guidance to the provider input only", () => {
    expect(
      applyProjectScopeGuardrail(
        "Update the component.",
        "Stay inside apps/web and ask before changing dependencies.",
      ),
    ).toBe(`Update the component.

<project_scope_guardrail>
Stay inside apps/web and ask before changing dependencies.
Before work outside this boundary, ask the user for approval. This guidance does not override higher-priority instructions or the provider's own approval controls.
</project_scope_guardrail>`);
  });

  it("does not change a turn without a saved guardrail", () => {
    expect(applyProjectScopeGuardrail("Update the component.", null)).toBe("Update the component.");
  });
});
