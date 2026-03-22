import type { IssueEvidenceBundle, OrchestrationArtifactBundleItem } from "@paperclipai/shared";
import { FileCheck2, FileSearch, Link2 } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime } from "../lib/utils";

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function evidencePolicyLabel(policy: IssueEvidenceBundle["policy"]) {
  switch (policy) {
    case "code_ci_evaluator_summary":
      return "Code + CI + Evaluator";
    case "code_ci_evaluator_summary_artifacts":
      return "Code + CI + Evaluator + Artifacts";
    default:
      return humanize(policy);
  }
}

function readArtifactPath(artifact: OrchestrationArtifactBundleItem) {
  const metadata = artifact.metadata;
  if (!metadata) return null;
  for (const key of ["path", "url", "filePath"] as const) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function artifactLabel(artifact: OrchestrationArtifactBundleItem) {
  return artifact.label?.trim() || humanize(artifact.artifactKind);
}

export function IssueEvidenceBundleCard({
  evidenceBundle,
  verificationRunHref,
}: {
  evidenceBundle: IssueEvidenceBundle | null | undefined;
  verificationRunHref?: string | null;
}) {
  const bundle = evidenceBundle?.bundle ?? null;
  const artifacts = bundle?.artifacts ?? [];

  return (
    <section className="overflow-hidden rounded-xl border border-emerald-500/20 bg-card/95 shadow-[0_18px_50px_rgba(16,185,129,0.08)]">
      <div className="border-b border-border/60 bg-emerald-500/[0.04] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            Review Bundle
          </div>
          {bundle?.verdict ? <StatusBadge status={bundle.verdict} /> : null}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Evaluator output and proof artifacts attached to the latest verification pass.
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Evidence Policy
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {evidenceBundle ? evidencePolicyLabel(evidenceBundle.policy) : "Not configured"}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Review Ready
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {evidenceBundle?.reviewReadyAt ? formatDateTime(evidenceBundle.reviewReadyAt) : "Waiting on verification"}
            </div>
          </div>
        </div>

        {verificationRunHref ? (
          <a
            href={verificationRunHref}
            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:border-emerald-500/30 hover:text-emerald-600 dark:text-emerald-300"
          >
            <Link2 className="h-3 w-3" />
            Open verification run
          </a>
        ) : null}

        {bundle?.evaluatorSummary ? (
          <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              <FileCheck2 className="h-3.5 w-3.5" />
              Evaluator Summary
            </div>
            <p className="text-sm leading-6 text-foreground">{bundle.evaluatorSummary}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-3 text-sm text-muted-foreground">
            No evaluator summary has been attached yet.
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <FileSearch className="h-3.5 w-3.5" />
            Artifacts
          </div>
          {artifacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-3 text-sm text-muted-foreground">
              No proof artifacts have been recorded yet.
            </div>
          ) : (
            <div className="space-y-2">
              {artifacts.map((artifact) => {
                const path = readArtifactPath(artifact);
                return (
                  <div key={artifact.artifactId} className="rounded-lg border border-border/60 bg-background/60 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{artifactLabel(artifact)}</span>
                      <StatusBadge status={artifact.artifactKind} />
                      {artifact.role ? (
                        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {humanize(artifact.role)}
                        </span>
                      ) : null}
                    </div>
                    {path ? <div className="mt-2 font-mono text-xs text-muted-foreground">{path}</div> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
