import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ProjectSettingsPanel = lazy(() =>
  import("../components/settings/ProjectSettingsPanel").then(({ ProjectSettingsPanel }) => ({
    default: ProjectSettingsPanel,
  })),
);

function SettingsProjectsRoute() {
  return <ProjectSettingsPanel selectedProjectKey={null} />;
}

export const Route = createFileRoute("/settings/projects")({
  component: SettingsProjectsRoute,
});
