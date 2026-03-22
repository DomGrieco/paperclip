import type { IssueOrchestrationSummary } from "@paperclipai/shared";
import { GitBranchPlus, ShieldCheck, Wrench } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime } from "../lib/utils";
import { Link } from "../lib/router";
import { IssueEvidenceBundleCard } from "./IssueEvidenceBundle";

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
    default:
      return humanize(target);
  }
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
}: {
  orchestration: IssueOrchestrationSummary | null | undefined;
  runLinks?: Map<string, string>;
}) {
  if (!orchestration) return null;

  const counts = countByType(orchestration);
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
    </div>
  );
}

export { IssueEvidenceBundleCard } from "./IssueEvidenceBundle";
