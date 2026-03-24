import fs from "node:fs/promises";
import path from "node:path";
import type { HermesBootstrapImportSummary } from "@paperclipai/shared";

export type HermesBootstrapImportPayload = {
  authJson: string | null;
  envFile: string | null;
  configYaml: string | null;
};

export type ImportedHermesBootstrap = {
  summary: HermesBootstrapImportSummary;
  payload: HermesBootstrapImportPayload;
};

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function readString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readYamlBlock(content: string, sectionName: string): string[] {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `${sectionName}:`);
  if (startIndex < 0) return [];
  const sectionIndent = lines[startIndex]?.match(/^(\s*)/)?.[1].length ?? 0;
  const block: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (trimmed.length > 0 && indent <= sectionIndent) break;
    block.push(line);
  }
  return block;
}

function readYamlChildScalar(content: string, sectionName: string, childKey: string): string | null {
  const block = readYamlBlock(content, sectionName);
  for (const line of block) {
    const match = line.match(/^\s{2}([A-Za-z0-9_.-]+):\s*(.+?)\s*$/);
    if (!match) continue;
    if (match[1] !== childKey) continue;
    return normalizeYamlScalar(match[2] ?? "");
  }
  return null;
}

function readYamlChildKeys(content: string, sectionName: string): string[] {
  const block = readYamlBlock(content, sectionName);
  const keys = new Set<string>();
  for (const line of block) {
    const match = line.match(/^\s{2}([A-Za-z0-9_.-]+):(?:\s+.*)?$/);
    if (!match) continue;
    keys.add(match[1] ?? "");
  }
  return [...keys].filter((value) => value.length > 0).sort();
}

function readYamlList(content: string, sectionName: string): string[] {
  const block = readYamlBlock(content, sectionName);
  const result: string[] = [];
  for (const line of block) {
    const match = line.match(/^\s{2}-\s*(.+?)\s*$/);
    if (!match) continue;
    const value = normalizeYamlScalar(match[1] ?? "");
    if (value.length > 0) result.push(value);
  }
  return result;
}

function parseEnvKeyNames(content: string): string[] {
  const keys = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const delimiter = normalized.indexOf("=");
    if (delimiter <= 0) continue;
    const key = normalized.slice(0, delimiter).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.add(key);
  }
  return [...keys].sort();
}

function parseAuthSummary(content: string): Pick<HermesBootstrapImportSummary, "activeProvider" | "authProviderIds"> {
  try {
    const parsed = JSON.parse(content) as {
      active_provider?: unknown;
      providers?: Record<string, unknown>;
    };
    const authProviderIds = Object.keys(parsed.providers ?? {}).sort();
    return {
      activeProvider: readString(typeof parsed.active_provider === "string" ? parsed.active_provider : null),
      authProviderIds,
    };
  } catch {
    return {
      activeProvider: null,
      authProviderIds: [],
    };
  }
}

export async function importHermesBootstrapFromHome(input: {
  homePath: string;
}): Promise<ImportedHermesBootstrap> {
  const sourceHomePath = path.resolve(input.homePath);
  const authPath = path.join(sourceHomePath, "auth.json");
  const envPath = path.join(sourceHomePath, ".env");
  const configPath = path.join(sourceHomePath, "config.yaml");

  const [hasAuthJson, hasEnvFile, hasConfigYaml] = await Promise.all([
    pathExists(authPath),
    pathExists(envPath),
    pathExists(configPath),
  ]);

  const [authJson, envFile, configYaml] = await Promise.all([
    hasAuthJson ? fs.readFile(authPath, "utf8") : Promise.resolve(null),
    hasEnvFile ? fs.readFile(envPath, "utf8") : Promise.resolve(null),
    hasConfigYaml ? fs.readFile(configPath, "utf8") : Promise.resolve(null),
  ]);

  const authSummary = authJson ? parseAuthSummary(authJson) : { activeProvider: null, authProviderIds: [] };
  const secretEnvKeys = envFile ? parseEnvKeyNames(envFile) : [];
  const configuredProvider = configYaml ? readYamlChildScalar(configYaml, "model", "provider") : null;
  const defaultModel = configYaml ? readYamlChildScalar(configYaml, "model", "default") : null;
  const configuredBaseUrl = configYaml ? readYamlChildScalar(configYaml, "model", "base_url") : null;
  const terminalBackend = configYaml ? readYamlChildScalar(configYaml, "terminal", "backend") : null;
  const terminalCwd = configYaml ? readYamlChildScalar(configYaml, "terminal", "cwd") : null;
  const mcpServerNames = configYaml ? readYamlChildKeys(configYaml, "mcp_servers") : [];
  const enabledPlatforms = configYaml ? readYamlChildKeys(configYaml, "platform_toolsets") : [];
  const enabledToolsets = configYaml ? readYamlList(configYaml, "toolsets") : [];

  return {
    summary: {
      sourceHomePath,
      hasAuthJson,
      hasConfigYaml,
      hasEnvFile,
      activeProvider: authSummary.activeProvider,
      authProviderIds: authSummary.authProviderIds,
      configuredProvider,
      defaultModel,
      configuredBaseUrl,
      terminalBackend,
      terminalCwd,
      mcpServerNames,
      enabledPlatforms,
      enabledToolsets,
      secretEnvKeys,
    },
    payload: {
      authJson: authJson ? authJson.replace(/\n*$/, "\n") : null,
      envFile: envFile ? envFile.replace(/\n*$/, "\n") : null,
      configYaml: configYaml ? configYaml.replace(/\n*$/, "\n") : null,
    },
  };
}
