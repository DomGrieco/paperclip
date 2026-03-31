export interface AgentContainerProfile {
  adapterType: string;
  image: string;
  serviceName: string;
  runnerProvider: "hermes_container" | "agent_container";
  defaultCommand: string;
  workingDir: string;
  nativeHomePath: string;
  nativeSkillsPath: string | null;
  homeEnvName: string;
  runtimeRootContainerPath: string;
  managedRuntimeRootEnvName: string | null;
  managedRuntimeCommandEnvNames: string[];
  managedRuntimeContainerPath: string | null;
  sharedAuthSourceEnvName: string | null;
  sharedAuthContainerPath: string | null;
  imageEnvName: string | null;
  browserCapable: boolean;
}

const DEFAULT_WORKSPACE_PATH = "/workspace";
const DEFAULT_RUNTIME_ROOT = "/workspace/.paperclip/runtime";
const DEFAULT_SHARED_CONTEXT_PATH = "/workspace/.paperclip/context/shared-context.json";

const PROFILES: Record<string, AgentContainerProfile> = {
  hermes_local: {
    adapterType: "hermes_local",
    image: "paperclip/hermes-worker:dev",
    serviceName: "hermes-worker",
    runnerProvider: "hermes_container",
    defaultCommand: "hermes",
    workingDir: DEFAULT_WORKSPACE_PATH,
    nativeHomePath: "/home/hermes/.hermes",
    nativeSkillsPath: "/home/hermes/.hermes/skills",
    homeEnvName: "HERMES_HOME",
    runtimeRootContainerPath: DEFAULT_RUNTIME_ROOT,
    managedRuntimeRootEnvName: "PAPERCLIP_HERMES_MANAGED_RUNTIME_ROOT",
    managedRuntimeCommandEnvNames: [
      "PAPERCLIP_HERMES_MANAGED_RUNTIME_HERMES_COMMAND",
      "PAPERCLIP_HERMES_MANAGED_RUNTIME_PYTHON_COMMAND",
    ],
    managedRuntimeContainerPath: "/paperclip/runtime/hermes-managed",
    sharedAuthSourceEnvName: "PAPERCLIP_HERMES_SHARED_HOME_SOURCE",
    sharedAuthContainerPath: "/paperclip/shared/hermes-home-source",
    imageEnvName: "PAPERCLIP_HERMES_CONTAINER_IMAGE",
    browserCapable: false,
  },
  codex_local: {
    adapterType: "codex_local",
    image: "paperclip/codex-worker:dev",
    serviceName: "codex-worker",
    runnerProvider: "agent_container",
    defaultCommand: "codex",
    workingDir: DEFAULT_WORKSPACE_PATH,
    nativeHomePath: "/home/codex/.codex",
    nativeSkillsPath: "/home/codex/.codex/skills",
    homeEnvName: "CODEX_HOME",
    runtimeRootContainerPath: DEFAULT_RUNTIME_ROOT,
    managedRuntimeRootEnvName: "PAPERCLIP_CODEX_MANAGED_RUNTIME_ROOT",
    managedRuntimeCommandEnvNames: ["PAPERCLIP_CODEX_MANAGED_RUNTIME_COMMAND"],
    managedRuntimeContainerPath: "/paperclip/runtime/codex-managed",
    sharedAuthSourceEnvName: null,
    sharedAuthContainerPath: null,
    imageEnvName: null,
    browserCapable: false,
  },
  cursor_local: {
    adapterType: "cursor_local",
    image: "paperclip/cursor-worker:dev",
    serviceName: "cursor-worker",
    runnerProvider: "agent_container",
    defaultCommand: "agent",
    workingDir: DEFAULT_WORKSPACE_PATH,
    nativeHomePath: "/home/cursor/.cursor",
    nativeSkillsPath: "/home/cursor/.cursor/skills",
    homeEnvName: "HOME",
    runtimeRootContainerPath: DEFAULT_RUNTIME_ROOT,
    managedRuntimeRootEnvName: null,
    managedRuntimeCommandEnvNames: [],
    managedRuntimeContainerPath: null,
    sharedAuthSourceEnvName: null,
    sharedAuthContainerPath: null,
    imageEnvName: null,
    browserCapable: false,
  },
};

export const AGENT_CONTAINER_WORKSPACE_PATH = DEFAULT_WORKSPACE_PATH;
export const AGENT_CONTAINER_SHARED_CONTEXT_PATH = DEFAULT_SHARED_CONTEXT_PATH;

export function listAgentContainerProfiles(): AgentContainerProfile[] {
  return Object.values(PROFILES);
}

export function getAgentContainerProfile(adapterType: string): AgentContainerProfile {
  const profile = PROFILES[adapterType];
  if (!profile) {
    throw new Error(`Unsupported agent container adapter type: ${adapterType}`);
  }
  return profile;
}
