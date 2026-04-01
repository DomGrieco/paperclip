import type { Db } from "@paperclipai/db";
import type { HermesBootstrapImportSummary } from "@paperclipai/shared";
import {
  classifyHermesBootstrap,
  importHermesBootstrapFromHome,
  type HermesBootstrapImportPayload,
  type ImportedHermesBootstrap,
} from "./hermes-bootstrap.js";
import { secretService } from "./secrets.js";

const SECRET_NAMES = {
  authJson: "paperclip.hermes_bootstrap.auth_json",
  envFile: "paperclip.hermes_bootstrap.env_file",
  configYaml: "paperclip.hermes_bootstrap.config_yaml",
  summaryJson: "paperclip.hermes_bootstrap.summary_json",
} as const;

function parseSummary(raw: string | null): HermesBootstrapImportSummary | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HermesBootstrapImportSummary;
  } catch {
    return null;
  }
}

async function upsertOrRemovePayloadSecret(input: {
  db: Db;
  companyId: string;
  secretName: string;
  value: string | null;
  actor?: { userId?: string | null; agentId?: string | null };
  description: string;
}) {
  const svc = secretService(input.db);
  if (input.value === null) {
    await svc.removeByName(input.companyId, input.secretName);
    return null;
  }
  return await svc.upsertTextSecretByName(
    input.companyId,
    {
      name: input.secretName,
      value: input.value,
      description: input.description,
    },
    input.actor,
  );
}

export function hermesBootstrapProfileService(db: Db) {
  return {
    getStoredProfile: async (companyId: string): Promise<ImportedHermesBootstrap | null> => {
      const svc = secretService(db);
      const [authJson, envFile, configYaml, summaryJson] = await Promise.all([
        svc.resolveSecretTextByName(companyId, SECRET_NAMES.authJson),
        svc.resolveSecretTextByName(companyId, SECRET_NAMES.envFile),
        svc.resolveSecretTextByName(companyId, SECRET_NAMES.configYaml),
        svc.resolveSecretTextByName(companyId, SECRET_NAMES.summaryJson),
      ]);

      if (!authJson && !envFile && !configYaml && !summaryJson) {
        return null;
      }

      const payload: HermesBootstrapImportPayload = {
        authJson,
        envFile,
        configYaml,
      };
      const storedSummary = parseSummary(summaryJson);
      const classified = classifyHermesBootstrap({
        sourceHomePath: storedSummary?.sourceHomePath ?? `paperclip://companies/${companyId}/hermes-bootstrap-profile`,
        authJson,
        envFile,
        configYaml,
      });

      return {
        payload,
        summary: storedSummary ?? classified.summary,
      };
    },

    importFromHome: async (
      companyId: string,
      input: { homePath: string },
      actor?: { userId?: string | null; agentId?: string | null },
    ): Promise<ImportedHermesBootstrap> => {
      const imported = await importHermesBootstrapFromHome({ homePath: input.homePath });
      await Promise.all([
        upsertOrRemovePayloadSecret({
          db,
          companyId,
          secretName: SECRET_NAMES.authJson,
          value: imported.payload.authJson,
          actor,
          description: "Persisted Hermes bootstrap auth.json imported into Paperclip control-plane state.",
        }),
        upsertOrRemovePayloadSecret({
          db,
          companyId,
          secretName: SECRET_NAMES.envFile,
          value: imported.payload.envFile,
          actor,
          description: "Persisted Hermes bootstrap .env imported into Paperclip control-plane state.",
        }),
        upsertOrRemovePayloadSecret({
          db,
          companyId,
          secretName: SECRET_NAMES.configYaml,
          value: imported.payload.configYaml,
          actor,
          description: "Persisted Hermes bootstrap config.yaml imported into Paperclip control-plane state.",
        }),
        upsertOrRemovePayloadSecret({
          db,
          companyId,
          secretName: SECRET_NAMES.summaryJson,
          value: `${JSON.stringify(imported.summary, null, 2)}\n`,
          actor,
          description: "Summary metadata for the persisted Hermes bootstrap profile.",
        }),
      ]);
      return imported;
    },
  };
}

export { SECRET_NAMES as HERMES_BOOTSTRAP_PROFILE_SECRET_NAMES };
