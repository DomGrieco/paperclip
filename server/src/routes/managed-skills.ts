import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createManagedSkillSchema,
  managedSkillEffectivePreviewQuerySchema,
  putManagedSkillScopesSchema,
  updateManagedSkillSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { managedSkillService } from "../services/managed-skills.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function managedSkillRoutes(db: Db) {
  const router = Router();
  const svc = managedSkillService(db);

  router.get("/companies/:companyId/managed-skills", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const items = await svc.listManagedSkills(companyId);
    res.json(items);
  });

  router.post(
    "/companies/:companyId/managed-skills",
    validate(createManagedSkillSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const item = await svc.createManagedSkill(companyId, req.body);
      res.status(201).json(item);
    },
  );

  router.get("/companies/:companyId/managed-skills/effective-preview", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const query = managedSkillEffectivePreviewQuerySchema.parse(req.query);
    const preview = await svc.previewEffectiveSkills({
      companyId,
      projectId: query.projectId ?? null,
      agentId: query.agentId ?? null,
      moduleDir,
    });
    res.json(preview);
  });

  router.get("/companies/:companyId/managed-skills/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const skillId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const item = await svc.getManagedSkill(companyId, skillId);
    res.json(item);
  });

  router.patch(
    "/companies/:companyId/managed-skills/:id",
    validate(updateManagedSkillSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const skillId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const item = await svc.updateManagedSkill(companyId, skillId, req.body);
      res.json(item);
    },
  );

  router.get("/companies/:companyId/managed-skills/:id/scopes", async (req, res) => {
    const companyId = req.params.companyId as string;
    const skillId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const scopes = await svc.listManagedSkillScopes(companyId, skillId);
    res.json(scopes);
  });

  router.put(
    "/companies/:companyId/managed-skills/:id/scopes",
    validate(putManagedSkillScopesSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const skillId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const scopes = await svc.replaceManagedSkillScopes(companyId, skillId, req.body.assignments);
      res.json(scopes);
    },
  );

  return router;
}
