import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ConnectionsSettings = lazy(() =>
  import("../components/settings/ConnectionsSettings").then(({ ConnectionsSettings }) => ({
    default: ConnectionsSettings,
  })),
);

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsSettings,
});
