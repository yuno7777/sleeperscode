import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ArchivedThreadsPanel = lazy(() =>
  import("../components/settings/SettingsPanels").then(({ ArchivedThreadsPanel }) => ({
    default: ArchivedThreadsPanel,
  })),
);

export const Route = createFileRoute("/settings/archived")({
  component: ArchivedThreadsPanel,
});
