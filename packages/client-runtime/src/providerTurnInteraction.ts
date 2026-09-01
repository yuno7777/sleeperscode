/**
 * Declares only follow-up behavior that the built-in adapters implement and
 * test today. Unknown and third-party drivers stay unknown instead of being
 * treated as compatible with any built-in provider.
 */
export type ProviderTurnInteraction =
  | { readonly kind: "steer"; readonly label: string }
  | { readonly kind: "queue"; readonly label: string }
  | { readonly kind: "unsupported"; readonly label: string }
  | { readonly kind: "unknown"; readonly label: string };

export function providerTurnInteraction(
  driver: string | null | undefined,
): ProviderTurnInteraction {
  switch (driver) {
    case "claudeAgent":
    case "cursor":
    case "grok":
    case "opencode":
      return {
        kind: "steer",
        label: "A follow-up will steer the active turn.",
      };
    case "codex":
      return {
        kind: "queue",
        label: "A follow-up will queue after the active turn.",
      };
    case "antigravity":
      return {
        kind: "unsupported",
        label: "This provider cannot accept a follow-up while its turn is running. Stop it first.",
      };
    default:
      return {
        kind: "unknown",
        label: "Follow-up behavior is not confirmed for this provider.",
      };
  }
}
