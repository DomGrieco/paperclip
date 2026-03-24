import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { hermesBootstrapProfileService, logActivity } from "../services/index.js";

const importHermesBootstrapProfileSchema = z.object({
  homePath: z.string().min(1),
});

export function hermesBootstrapProfileRoutes(db: Db) {
  const router = Router();
  const svc = hermesBootstrapProfileService(db);

  router.get("/companies/:companyId/hermes-bootstrap-profile", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const profile = await svc.getStoredProfile(companyId);
    if (!profile) {
      res.status(404).json({ error: "Hermes bootstrap profile not found" });
      return;
    }
    res.json(profile.summary);
  });

  router.post(
    "/companies/:companyId/hermes-bootstrap-profile/import",
    validate(importHermesBootstrapProfileSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const imported = await svc.importFromHome(
        companyId,
        req.body,
        actor.actorType === "agent"
          ? { agentId: actor.agentId, userId: null }
          : { userId: actor.actorId, agentId: actor.agentId },
      );
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "company.hermes_bootstrap_profile_imported",
        entityType: "company",
        entityId: companyId,
        details: {
          sourceHomePath: imported.summary.sourceHomePath,
          hasAuthJson: imported.summary.hasAuthJson,
          hasEnvFile: imported.summary.hasEnvFile,
          hasConfigYaml: imported.summary.hasConfigYaml,
          activeProvider: imported.summary.activeProvider,
          configuredProvider: imported.summary.configuredProvider,
          defaultModel: imported.summary.defaultModel,
          mcpServerCount: imported.summary.mcpServerNames.length,
          envKeyCount: imported.summary.secretEnvKeys.length,
        },
      });
      res.status(201).json(imported.summary);
    },
  );

  return router;
}
