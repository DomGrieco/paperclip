import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createSharedContextPublicationSchema,
  type SharedContextPublicationStatus,
  type SharedContextPublicationVisibility,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { getActorInfo, assertCompanyAccess } from "./authz.js";
import { logActivity, sharedContextService } from "../services/index.js";

export function sharedContextRoutes(db: Db) {
  const router = Router();
  const svc = sharedContextService(db);

  router.get("/companies/:companyId/shared-context", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const items = await svc.list(companyId, {
      projectId: req.query.projectId as string | undefined,
      issueId: req.query.issueId as string | undefined,
      sourceAgentId: req.query.sourceAgentId as string | undefined,
      status: req.query.status as SharedContextPublicationStatus | undefined,
      visibility: req.query.visibility as SharedContextPublicationVisibility | undefined,
    });
    res.json(items);
  });

  router.post(
    "/companies/:companyId/shared-context",
    validate(createSharedContextPublicationSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const publication = await svc.create(companyId, req.body, {
        type: req.actor.type === "agent" ? "agent" : "board",
        agentId: req.actor.agentId,
        runId: req.actor.runId,
      });
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: publication.status === "proposed" ? "shared_context.proposed" : "shared_context.published",
        entityType: "shared_context_publication",
        entityId: publication.id,
        details: {
          visibility: publication.visibility,
          status: publication.status,
          projectId: publication.projectId,
          issueId: publication.issueId,
          tagCount: publication.tags.length,
        },
      });
      res.status(201).json(publication);
    },
  );

  return router;
}
