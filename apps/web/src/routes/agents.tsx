import { createFileRoute } from "@tanstack/react-router";

import { AgentHubPage } from "../components/agent-hub/AgentHubPage";

export const Route = createFileRoute("/agents")({
  component: AgentHubPage,
});
