import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, CheckCircle2Icon, CircleDotIcon, ShieldAlertIcon } from "lucide-react";
import { useMemo } from "react";

import { classifyAttentionThread, type AttentionKind } from "../../attention";
import { useProjects, useThreadShells } from "../../state/entities";
import { Button } from "../ui/button";

type AttentionItem = {
  readonly thread: EnvironmentThreadShell;
  readonly kind: AttentionKind;
  readonly title: string;
  readonly detail: string;
};

const ICONS = {
  approval: ShieldAlertIcon,
  input: CircleDotIcon,
  failed: AlertTriangleIcon,
  plan: CircleDotIcon,
  verification: AlertTriangleIcon,
  working: CircleDotIcon,
} as const;

export function AttentionPage() {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const items = useMemo(() => {
    const projectById = new Map(projects.map((project) => [project.id, project] as const));
    return threads
      .filter((thread) => thread.archivedAt === null)
      .flatMap((thread) => {
        const handoff = projectById
          .get(thread.projectId)
          ?.handoffs?.find((entry) => entry.threadId === thread.id);
        const classification = classifyAttentionThread(
          thread,
          (handoff?.summary.verification.length ?? 0) > 0,
        );
        return classification ? [{ thread, ...classification }] : [];
      })
      .toSorted((left, right) => right.thread.updatedAt.localeCompare(left.thread.updatedAt));
  }, [projects, threads]);
  const needsYou = items.filter((item) => item.kind !== "working");
  const working = items.filter((item) => item.kind === "working");

  const renderItem = (item: AttentionItem) => {
    const Icon = ICONS[item.kind];
    return (
      <button
        key={`${item.thread.environmentId}:${item.thread.id}`}
        type="button"
        className="flex w-full items-start gap-3 rounded-lg border border-border/70 bg-card p-3 text-left hover:bg-accent/50"
        onClick={() =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: item.thread.environmentId, threadId: item.thread.id },
          })
        }
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {item.thread.title}
          </span>
          <span className="block text-xs text-muted-foreground">
            {item.title} · {item.detail}
          </span>
          <span className="block truncate pt-1 font-mono text-[11px] text-muted-foreground/80">
            {item.thread.branch ?? item.thread.worktreePath ?? "Local workspace"}
          </span>
        </span>
      </button>
    );
  };

  return (
    <main className="mx-auto flex h-full w-full max-w-4xl flex-col gap-8 overflow-y-auto p-5 sm:p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attention</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What needs you now. Completed tasks stay unverified until a handoff records a check.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/" })}>
          Back to tasks
        </Button>
      </header>
      <section>
        <h2 className="mb-2 text-sm font-medium text-foreground">Needs you ({needsYou.length})</h2>
        <div className="space-y-2">
          {needsYou.length > 0 ? (
            needsYou.map(renderItem)
          ) : (
            <Empty label="Nothing is waiting for you." />
          )}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium text-foreground">Working ({working.length})</h2>
        <div className="space-y-2">
          {working.length > 0 ? (
            working.map(renderItem)
          ) : (
            <Empty label="No active provider runs." />
          )}
        </div>
      </section>
    </main>
  );
}

function Empty({ label }: { readonly label: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
      {label}
    </p>
  );
}
