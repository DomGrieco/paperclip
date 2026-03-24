import type {
  HeartbeatRun,
  HermesContainerLaunchPlan,
  PaperclipSharedContextPacket,
  RuntimeBundleRunner,
} from "@paperclipai/shared";
import { redactHomePathUserSegments } from "@paperclipai/adapter-utils";
import { StatusBadge } from "./StatusBadge";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function runnerTargetLabel(target: RuntimeBundleRunner["target"]): string {
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

function renderPath(value: string | null): string {
  return value ? redactHomePathUserSegments(value) : "—";
}

function shortenProviderRef(value: string | null): string {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function asLaunchPlan(value: unknown): HermesContainerLaunchPlan | null {
  const record = asRecord(value);
  if (!record) return null;
  return record as unknown as HermesContainerLaunchPlan;
}

function asSharedContextPacket(value: unknown): PaperclipSharedContextPacket | null {
  const record = asRecord(value);
  if (!record) return null;
  return record as unknown as PaperclipSharedContextPacket;
}

function getRuntimeServices(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={mono ? "mt-1 break-all font-mono text-sm text-foreground" : "mt-1 text-sm text-foreground"}>{value}</div>
    </div>
  );
}

export function RunRuntimeContractCard({ run }: { run: HeartbeatRun }) {
  const context = asRecord(run.contextSnapshot);
  const plan = asLaunchPlan(context?.paperclipHermesContainerPlan);
  const sharedContextPacket = asSharedContextPacket(context?.paperclipSharedContextPacket);
  const runtimeServices = getRuntimeServices(context?.paperclipRuntimeServices);
  const runner =
    plan?.runner ??
    run.runnerSnapshotJson ??
    sharedContextPacket?.runner ??
    (asRecord(context?.paperclipRuntimeBundle)?.runner as RuntimeBundleRunner | null | undefined) ??
    null;

  if (!runner && !plan && !sharedContextPacket && runtimeServices.length === 0) {
    return null;
  }

  return (
    <section className="overflow-hidden rounded-xl border border-violet-500/20 bg-card/95 shadow-[0_18px_50px_rgba(139,92,246,0.08)]">
      <div className="border-b border-border/60 bg-violet-500/[0.04] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            Runtime Contract
          </div>
          {runner ? (
            <span className="rounded-full border border-violet-500/20 bg-violet-500/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
              {runnerTargetLabel(runner.target)}
            </span>
          ) : null}
          {runner?.browserCapable ? (
            <span className="rounded-full border border-sky-500/20 bg-sky-500/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
              Browser Capable
            </span>
          ) : null}
          {runner?.sandboxed ? (
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              Sandboxed
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Resolved Paperclip worker context, container launch plan, and runtime services captured for this run.
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {runner ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailRow label="Runner Target" value={runnerTargetLabel(runner.target)} />
            <DetailRow label="Provider" value={humanize(runner.provider)} />
            <DetailRow label="Execution Mode" value={runner.executionMode ? humanize(runner.executionMode) : "—"} />
            <DetailRow label="Isolation" value={humanize(runner.isolationBoundary)} />
          </div>
        ) : null}

        {plan ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Hermes Container Plan</div>
              <div className="text-[11px] text-muted-foreground">{plan.mounts.length} mounts · {plan.env.length} env vars</div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <DetailRow label="Image" value={plan.image} mono />
              <DetailRow label="Command" value={plan.command.join(" ") || "—"} mono />
              <DetailRow label="Model" value={plan.model ?? "—"} mono />
              <DetailRow label="Provider" value={plan.provider ?? "—"} mono />
              <DetailRow label="Working Dir" value={renderPath(plan.workingDir)} mono />
              <DetailRow label="Workspace Path" value={renderPath(plan.workspacePath)} mono />
              <DetailRow label="Worker Home" value={renderPath(plan.agentHomePath)} mono />
              <DetailRow label="Runtime Bundle Root" value={renderPath(plan.runtimeBundleRoot)} mono />
              <DetailRow label="Shared Auth Source" value={renderPath(plan.sharedAuthSourcePath)} mono />
              <DetailRow label="Shared Context Path" value={renderPath(plan.sharedContextPath)} mono />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Mounts</div>
                <div className="space-y-2">
                  {plan.mounts.map((mount) => (
                    <div key={`${mount.kind}-${mount.containerPath}`} className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{humanize(mount.kind)}</span>
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {mount.readOnly ? "read-only" : "read-write"}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground break-all font-mono">
                        {renderPath(mount.containerPath)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Runtime Service</div>
                <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs space-y-1">
                  <div><span className="text-muted-foreground">Name: </span><span className="font-medium text-foreground">{plan.runtimeService.serviceName}</span></div>
                  <div><span className="text-muted-foreground">Scope: </span><span className="text-foreground">{humanize(plan.runtimeService.scopeType)} · {plan.runtimeService.scopeId}</span></div>
                  <div><span className="text-muted-foreground">Owner Agent: </span><span className="font-mono text-foreground">{plan.runtimeService.ownerAgentId}</span></div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {sharedContextPacket ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Shared Context Packet</div>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
              <DetailRow label="Issue Scope" value={sharedContextPacket.scope.issueId ?? "—"} mono />
              <DetailRow label="Project Scope" value={sharedContextPacket.scope.projectId ?? "—"} mono />
              <DetailRow label="Agent Scope" value={sharedContextPacket.scope.agentId} mono />
              <DetailRow label="Memory Snippets" value={String(sharedContextPacket.memory.snippets.length)} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <DetailRow label="Runtime Bundle Root" value={renderPath(sharedContextPacket.provenance.runtimeBundleRoot)} mono />
              <DetailRow label="Instructions Path" value={renderPath(sharedContextPacket.provenance.runtimeInstructionsPath)} mono />
              <DetailRow label="Shared Context Path" value={renderPath(sharedContextPacket.provenance.sharedContextPath)} mono />
              <DetailRow label="Verification" value={sharedContextPacket.verification.required ? "Required" : "Optional"} />
            </div>
          </div>
        ) : null}

        {runtimeServices.length > 0 ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Runtime Services</div>
              <div className="text-[11px] text-muted-foreground">{runtimeServices.length} attached</div>
            </div>
            <div className="space-y-2">
              {runtimeServices.map((service, index) => {
                const provider = asString(service.provider) ?? "unknown";
                const providerRef = asString(service.providerRef);
                const url = asString(service.url);
                const cwd = asString(service.cwd);
                const status = asString(service.status) ?? "unknown";
                return (
                  <div key={`${asString(service.id) ?? index}-${asString(service.serviceName) ?? "service"}`} className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{asString(service.serviceName) ?? "Runtime service"}</span>
                      <StatusBadge status={status} />
                      <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {humanize(provider)}
                      </span>
                      {asBoolean(service.reused) ? (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          Reused
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-2 lg:grid-cols-3 text-xs text-muted-foreground">
                      <div>Provider ref: <span className="font-mono text-foreground">{shortenProviderRef(providerRef)}</span></div>
                      <div>URL: <span className="font-mono text-foreground">{url ?? "—"}</span></div>
                      <div>CWD: <span className="font-mono text-foreground break-all">{cwd ? renderPath(cwd) : "—"}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
