import type { PaperclipSharedContextManagedSkill, PaperclipSharedContextPacket, RuntimeBundle } from "@paperclipai/shared";

export function buildPaperclipSharedContextPacket(input: {
  runtimeBundle: RuntimeBundle;
  workspaceCwd: string;
  runtimeBundleRoot: string | null;
  runtimeInstructionsPath: string | null;
  sharedContextPath: string | null;
  managedSkillsDir?: string | null;
  managedSkills?: PaperclipSharedContextManagedSkill[] | null;
}): PaperclipSharedContextPacket {
  return {
    version: "v1",
    scope: {
      companyId: input.runtimeBundle.company.id,
      projectId: input.runtimeBundle.project?.id ?? null,
      issueId: input.runtimeBundle.issue?.id ?? null,
      runId: input.runtimeBundle.run.id,
      agentId: input.runtimeBundle.agent.id,
    },
    policy: input.runtimeBundle.policy,
    runner: input.runtimeBundle.runner,
    verification: input.runtimeBundle.verification,
    memory: input.runtimeBundle.memory,
    managedSkills: {
      skillsDir: input.managedSkillsDir ?? null,
      entries: input.managedSkills ?? [],
    },
    provenance: {
      source: "runtime_bundle",
      workspaceCwd: input.workspaceCwd,
      runtimeBundleRoot: input.runtimeBundleRoot,
      runtimeInstructionsPath: input.runtimeInstructionsPath,
      sharedContextPath: input.sharedContextPath,
    },
  };
}
