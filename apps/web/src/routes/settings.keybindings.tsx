import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const KeybindingsSettingsPanel = lazy(() =>
  import("../components/settings/KeybindingsSettings").then(({ KeybindingsSettingsPanel }) => ({
    default: KeybindingsSettingsPanel,
  })),
);

export const Route = createFileRoute("/settings/keybindings")({
  component: KeybindingsSettingsPanel,
});
