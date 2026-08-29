import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const DiagnosticsSettingsPanel = lazy(() =>
  import("../components/settings/DiagnosticsSettings").then(({ DiagnosticsSettingsPanel }) => ({
    default: DiagnosticsSettingsPanel,
  })),
);

export const Route = createFileRoute("/settings/diagnostics")({
  component: DiagnosticsSettingsPanel,
});
