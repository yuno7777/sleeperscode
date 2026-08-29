import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const UsagePage = lazy(() =>
  import("../components/usage/UsagePage").then(({ UsagePage }) => ({ default: UsagePage })),
);

export const Route = createFileRoute("/usage")({
  component: UsagePage,
});
