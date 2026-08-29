import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ProviderSettingsPanel = lazy(() =>
  import("../components/settings/ProviderSettingsPanel").then(({ ProviderSettingsPanel }) => ({
    default: ProviderSettingsPanel,
  })),
);

function SettingsProvidersRoute() {
  return <ProviderSettingsPanel />;
}

export const Route = createFileRoute("/settings/providers")({
  component: SettingsProvidersRoute,
});
