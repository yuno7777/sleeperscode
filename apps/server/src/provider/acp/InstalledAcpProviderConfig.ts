import { createHash } from "node:crypto";

import { ProviderDriverKind, ProviderInstanceId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const INSTALLED_ACP_DRIVER_KIND = ProviderDriverKind.make("acp");

export const InstalledAcpProviderConfig = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  commandPath: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
  environment: Schema.Record(Schema.String, Schema.String),
});
export type InstalledAcpProviderConfig = typeof InstalledAcpProviderConfig.Type;

/** Stable, collision-resistant routing id derived from the registry agent id. */
export function installedAcpInstanceId(agentId: string): ProviderInstanceId {
  const readable = agentId
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 44);
  const fingerprint = createHash("sha256").update(agentId).digest("hex").slice(0, 12);
  return ProviderInstanceId.make(`acp_${readable || "agent"}_${fingerprint}`);
}
