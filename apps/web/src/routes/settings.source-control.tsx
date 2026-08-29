import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const SourceControlSettingsPanel = lazy(() =>
  import("../components/settings/SourceControlSettings").then(({ SourceControlSettingsPanel }) => ({
    default: SourceControlSettingsPanel,
  })),
);

export const Route = createFileRoute("/settings/source-control")({
  component: SourceControlSettingsPanel,
});
