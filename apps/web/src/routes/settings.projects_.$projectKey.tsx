import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ProjectSettingsPanel = lazy(() =>
  import("../components/settings/ProjectSettingsPanel").then(({ ProjectSettingsPanel }) => ({
    default: ProjectSettingsPanel,
  })),
);

function SettingsProjectDetailRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectSettingsPanel selectedProjectKey={projectKey} />;
}

export const Route = createFileRoute("/settings/projects_/$projectKey")({
  component: SettingsProjectDetailRoute,
});
