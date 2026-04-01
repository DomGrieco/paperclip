import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const TRUTHY_ENV_RE = /^(1|true|yes|on)$/i;
const COPIED_SHARED_FILES = ["config.json", "config.toml", "instructions.md", "models_cache.json"] as const;
const COPIED_SHARED_DIRS = ["log", "memories", "sessions", "shell_snapshots", "tmp"] as const;
const SHARED_STATE_FILE_RE = /^(state|logs)_\d+\.sqlite$/;
const SYMLINKED_SHARED_FILES = ["auth.json"] as const;

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export function resolveCodexHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = nonEmpty(env.CODEX_HOME);
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".codex");
}

function isWorktreeMode(env: NodeJS.ProcessEnv): boolean {
  return TRUTHY_ENV_RE.test(env.PAPERCLIP_IN_WORKTREE ?? "");
}

function resolveWorktreeCodexHomeDir(env: NodeJS.ProcessEnv): string | null {
  if (!isWorktreeMode(env)) return null;
  const paperclipHome = nonEmpty(env.PAPERCLIP_HOME);
  if (!paperclipHome) return null;
  const instanceId = nonEmpty(env.PAPERCLIP_INSTANCE_ID);
  if (instanceId) {
    return path.resolve(paperclipHome, "instances", instanceId, "codex-home");
  }
  return path.resolve(paperclipHome, "codex-home");
}

async function ensureParentDir(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
}

async function ensureSymlink(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (!existing) {
    await ensureParentDir(target);
    await fs.symlink(source, target);
    return;
  }

  if (!existing.isSymbolicLink()) {
    return;
  }

  const linkedPath = await fs.readlink(target).catch(() => null);
  if (!linkedPath) return;

  const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
  if (resolvedLinkedPath === source) return;

  await fs.unlink(target);
  await fs.symlink(source, target);
}

async function ensureCopiedFile(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) return;
  await ensureParentDir(target);
  await fs.copyFile(source, target);
}

async function ensureCopiedDirectory(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, preserveTimestamps: true });
}

export async function syncSharedCodexHome(input: {
  targetHome: string;
  sourceHome: string;
  symlinkSourceHome?: string;
  onLog?: AdapterExecutionContext["onLog"];
}): Promise<boolean> {
  const targetHome = path.resolve(input.targetHome);
  const sourceHome = path.resolve(input.sourceHome);
  const symlinkSourceHome = input.symlinkSourceHome ? input.symlinkSourceHome : sourceHome;
  if (targetHome === sourceHome) return false;
  if (!(await pathExists(sourceHome))) return false;

  await fs.mkdir(targetHome, { recursive: true });

  let copiedAny = false;
  for (const name of SYMLINKED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    const symlinkTarget = path.join(symlinkSourceHome, name);
    await ensureSymlink(path.join(targetHome, name), symlinkTarget);
    copiedAny = true;
  }

  for (const name of COPIED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureCopiedFile(path.join(targetHome, name), source);
    copiedAny = true;
  }

  for (const name of COPIED_SHARED_DIRS) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureCopiedDirectory(path.join(targetHome, name), source);
    copiedAny = true;
  }

  const sharedEntries = await fs.readdir(sourceHome, { withFileTypes: true }).catch(() => []);
  for (const entry of sharedEntries) {
    if (!entry.isFile()) continue;
    if (!SHARED_STATE_FILE_RE.test(entry.name)) continue;
    const source = path.join(sourceHome, entry.name);
    await ensureCopiedFile(path.join(targetHome, entry.name), source);
    copiedAny = true;
  }

  if (copiedAny && input.onLog) {
    await input.onLog(
      "stdout",
      `[paperclip] Seeded Codex home "${targetHome}" from shared source "${sourceHome}".\n`,
    );
  }

  return copiedAny;
}

export async function prepareWorktreeCodexHome(
  env: NodeJS.ProcessEnv,
  onLog: AdapterExecutionContext["onLog"],
): Promise<string | null> {
  const targetHome = resolveWorktreeCodexHomeDir(env);
  if (!targetHome) return null;

  const sourceHome = resolveCodexHomeDir(env);
  if (path.resolve(sourceHome) === path.resolve(targetHome)) return targetHome;

  await fs.mkdir(targetHome, { recursive: true });

  for (const name of SYMLINKED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureSymlink(path.join(targetHome, name), source);
  }

  for (const name of COPIED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureCopiedFile(path.join(targetHome, name), source);
  }

  await onLog(
    "stdout",
    `[paperclip] Using worktree-isolated Codex home "${targetHome}" (seeded from "${sourceHome}").\n`,
  );
  return targetHome;
}
