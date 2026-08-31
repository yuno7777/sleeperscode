import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const AttentionPage = lazy(() =>
  import("../components/attention/AttentionPage").then(({ AttentionPage }) => ({
    default: AttentionPage,
  })),
);

export const Route = createFileRoute("/attention")({
  component: AttentionPage,
});
