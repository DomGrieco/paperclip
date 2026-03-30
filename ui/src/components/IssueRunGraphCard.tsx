import type { IssueOrchestrationSummary, SharedContextPublication } from "@paperclipai/shared";
import { Archive, BookMarked, GitBranchPlus, Loader2, ShieldCheck, Upload, Wrench } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime } from "../lib/utils";
import { Link } from "../lib/router";
import { IssueEvidenceBundleCard } from "./IssueEvidenceBundle";
import { Button } from "./ui/button";

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function runTypeLabel(runType: string) {
  switch (runType) {
    case "planner":
      return "Planner";
    case "worker":
      return "Worker";
    case "verification":
      return "Verification";
    default:
      return humanize(runType);
  }
}

function evidencePolicyLabel(policy: IssueOrchestrationSummary["evidencePolicy"]) {
  switch (policy) {
    case "code_ci_evaluator_summary":
      return "Code + CI + Evaluator";
    case "code_ci_evaluator_summary_artifacts":
      return "Code + CI + Evaluator + Artifacts";
    default:
      return humanize(policy);
  }
}

function runnerTargetLabel(target: NonNullable<IssueOrchestrationSummary["nodes"][number]["runnerSnapshotJson"]>["target"]) {
  switch (target) {
    case "local_host":
      return "Local Host";
    case "adapter_managed":
      return "Adapter Managed";
    case "cloud_sandbox":
      return "Cloud Sandbox";
    case "hermes_container":
      return "Hermes Container";
    default:
      return humanize(target);
  }
}

function executionModeLabel(value: NonNullable<IssueOrchestrationSummary["nodes"][number]["runnerSnapshotJson"]>["executionMode"] | null) {
  switch (value) {
    case "isolated_workspace":
      return "Isolated Workspace";
    case "shared_workspace":
      return "Shared Workspace";
    default:
      return value ? humanize(value) : "Unknown";
  }
}

function workspaceStrategyLabel(value: NonNullable<IssueOrchestrationSummary["nodes"][number]["runnerSnapshotJson"]>["workspaceStrategyType"] | null) {
  switch (value) {
    case "git_worktree":
      return "Git Worktree";
    case "cloud_sandbox":
      return "Cloud Sandbox";
    case "adapter_managed":
      return "Adapter Managed";
    default:
      return value ? humanize(value) : "Unknown";
  }
}

function isolationBoundaryLabel(value: NonNullable<IssueOrchestrationSummary["nodes"][number]["runnerSnapshotJson"]>["isolationBoundary"]) {
  switch (value) {
    case "host_process":
      return "Host Process";
    case "adapter_runtime":
      return "Adapter Runtime";
    case "container_process":
      return "Container Process";
    case "cloud_sandbox":
      return "Cloud Sandbox";
    default:
      return humanize(value);
  }
}

function visibilityLabel(value: SharedContextPublication["visibility"]) {
  switch (value) {
    case "issue":
      return "Issue Scope";
    case "project":
      return "Project Scope";
    case "company":
      return "Company Scope";
    case "agent_set":
      return "Agent Set";
    default:
      return humanize(value);
  }
}

function freshnessLabel(value: SharedContextPublication["freshness"]) {
  switch (value) {
    case "live":
      return "Live";
    case "recent":
      return "Recent";
    case "static":
      return "Static";
    default:
      return humanize(value);
  }
}

function publicationPreview(publication: SharedContextPublication) {
  const candidate = publication.summary?.trim().length ? publication.summary.trim() : publication.body.trim();
  if (candidate.length <= 180) return candidate;
  return `${candidate.slice(0, 177)}…`;
}

function IssueSharedContextCard({
  publications,
  onPublish,
  onArchive,
  pendingPublicationId,
}: {
  publications: SharedContextPublication[];
  onPublish?: (publicationId: string) => void;
  onArchive?: (publicationId: string) => void;
  pendingPublicationId?: string | null;
}) {
  if (publications.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-amber-500/20 bg-card/95 shadow-[0_18px_50px_rgba(245,158,11,0.08)]">
      <div className="border-b border-border/60 bg-amber-500/[0.04] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
            Shared Context
          </div>
          <span className="rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            {publications.length} linked item{publications.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Published and proposed context packets attached directly to this issue for governed cross-agent recall.
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {publications.map((publication) => {
          const pending = pendingPublicationId === publication.id;
          const canPublish = publication.status === "proposed" && Boolean(onPublish);
          const canArchive = publication.status !== "archived" && Boolean(onArchive);

          return (
            <div key={publication.id} className="rounded-lg border border-border/60 bg-background/60 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300">
                  <BookMarked className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm font-medium text-foreground">{publication.title}</span>
                <StatusBadge status={publication.status} />
                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {visibilityLabel(publication.visibility)}
                </span>
                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {freshnessLabel(publication.freshness)}
                </span>
              </div>
              <div className="mt-2 text-sm leading-6 text-foreground">{publicationPreview(publication)}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                {publication.sourceAgentId ? (
                  <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono">
                    Agent {publication.sourceAgentId.slice(0, 8)}
                  </span>
                ) : null}
                {publication.createdByRunId ? (
                  <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono">
                    Run {publication.createdByRunId.slice(0, 8)}
                  </span>
                ) : null}
                {typeof publication.provenance?.source === "string" && publication.provenance.source.trim().length > 0 ? (
                  <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
                    Source {humanize(publication.provenance.source)}
                  </span>
                ) : null}
                <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
                  Freshness {freshnessLabel(publication.freshness)}
                </span>
                {publication.confidence !== null ? (
                  <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
                    Confidence {Math.round(publication.confidence * 100)}%
                  </span>
                ) : null}
                {publication.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
                    #{tag}
                  </span>
                ))}
              </div>
              {canPublish || canArchive ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                  {canPublish ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={pending}
                      onClick={() => onPublish?.(publication.id)}
                    >
                      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      Publish to shared recall
                    </Button>
                  ) : null}
                  {canArchive ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => onArchive?.(publication.id)}
                    >
                      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                      Archive context
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function countByType(orchestration: IssueOrchestrationSummary) {
  return orchestration.nodes.reduce(
    (acc, node) => {
      acc[node.runType] += 1;
      return acc;
    },
    { planner: 0, worker: 0, verification: 0 },
  );
}

export function IssueRunGraphCard({
  orchestration,
  runLinks,
  onPublishSharedContext,
  onArchiveSharedContext,
  pendingSharedContextId,
}: {
  orchestration: IssueOrchestrationSummary | null | undefined;
  runLinks?: Map<string, string>;
  onPublishSharedContext?: (publicationId: string) => void;
  onArchiveSharedContext?: (publicationId: string) => void;
  pendingSharedContextId?: string | null;
}) {
  if (!orchestration) return null;

  const counts = countByType(orchestration);
  const issueSharedContextPublications = orchestration.issueSharedContextPublications ?? [];
  const lastVerification = orchestration.lastVerificationRunId
    ? orchestration.nodes.find((node) => node.id === orchestration.lastVerificationRunId) ?? null
    : null;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-cyan-500/20 bg-card/95 shadow-[0_18px_50px_rgba(6,182,212,0.08)]">
        <div className="border-b border-border/60 bg-cyan-500/[0.04] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              Orchestration
            </div>
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
              {evidencePolicyLabel(orchestration.evidencePolicy)}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Planner, worker, and verification runs currently attached to this issue.
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Review Ready
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {orchestration.reviewReadyAt ? formatDateTime(orchestration.reviewReadyAt) : "Pending verification"}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Evidence Policy
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {evidencePolicyLabel(orchestration.evidencePolicy)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Graph Size
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">{orchestration.nodes.length} runs</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2.5 py-1">
              <GitBranchPlus className="h-3 w-3" />
              {counts.planner} planner
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2.5 py-1">
              <Wrench className="h-3 w-3" />
              {counts.worker} worker
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2.5 py-1">
              <ShieldCheck className="h-3 w-3" />
              {counts.verification} verification
            </span>
          </div>

          {orchestration.nodes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-3 text-sm text-muted-foreground">
              No planner or worker runs have been created for this issue yet.
            </div>
          ) : (
            <div className="space-y-2">
              {orchestration.nodes.map((node) => {
                const runHref = runLinks?.get(node.id) ?? null;
                return (
                  <div
                    key={node.id}
                    className="rounded-lg border border-border/60 bg-background/60 px-3 py-3"
                    style={{ marginLeft: `${Math.min(node.graphDepth, 3) * 14}px` }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{runTypeLabel(node.runType)}</span>
                      <StatusBadge status={node.status} />
                      {node.verificationVerdict ? <StatusBadge status={node.verificationVerdict} /> : null}
                      {node.repairAttempt > 0 ? (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          Repair {node.repairAttempt}
                        </span>
                      ) : null}
                      {node.runnerSnapshotJson ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                          {runnerTargetLabel(node.runnerSnapshotJson.target)}
                        </span>
                      ) : null}
                      {node.runnerSnapshotJson?.browserCapable ? (
                        <span className="rounded-full border border-sky-500/30 bg-sky-500/[0.08] px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                          Browser Capable
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{node.id.slice(0, 8)}</span>
                      {runHref ? (
                        <Link to={runHref} className="text-cyan-700 hover:underline dark:text-cyan-300">
                          Open run
                        </Link>
                      ) : null}
                      {node.parentRunId ? <span>Parent {node.parentRunId.slice(0, 8)}</span> : <span>Root run</span>}
                    </div>
                    {node.runnerSnapshotJson ? (
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {node.runnerSnapshotJson.executionMode ? (
                          <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
                            {executionModeLabel(node.runnerSnapshotJson.executionMode)}
                          </span>
                        ) : null}
                        {node.runnerSnapshotJson.workspaceStrategyType ? (
                          <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
                            {workspaceStrategyLabel(node.runnerSnapshotJson.workspaceStrategyType)}
                          </span>
                        ) : null}
                        <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1">
                          {isolationBoundaryLabel(node.runnerSnapshotJson.isolationBoundary)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {lastVerification ? (
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm text-muted-foreground">
              Latest verification verdict:{" "}
              <span className="font-medium text-foreground">
                {lastVerification.verificationVerdict ? humanize(lastVerification.verificationVerdict) : "Pending"}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <IssueEvidenceBundleCard
        evidenceBundle={orchestration.evidenceBundle ?? null}
        verificationRunHref={
          orchestration.lastVerificationRunId ? runLinks?.get(orchestration.lastVerificationRunId) ?? null : null
        }
      />

      <IssueSharedContextCard
        publications={issueSharedContextPublications}
        onPublish={onPublishSharedContext}
        onArchive={onArchiveSharedContext}
        pendingPublicationId={pendingSharedContextId}
      />
    </div>
  );
}

export { IssueEvidenceBundleCard } from "./IssueEvidenceBundle";
