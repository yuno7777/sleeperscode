import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const AgentHubPage = lazy(() =>
  import("../components/agent-hub/AgentHubPage").then(({ AgentHubPage }) => ({
    default: AgentHubPage,
  })),
);

export const Route = createFileRoute("/agents")({
  component: AgentHubPage,
});
