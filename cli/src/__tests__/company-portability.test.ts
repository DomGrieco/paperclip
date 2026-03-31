import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CompanyPortabilityManifest } from "@paperclipai/shared";
import { resolveInlineSourceFromPath } from "../commands/client/company.js";

const tempPaths: string[] = [];

afterEach(async () => {
  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (!tempPath) continue;
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

describe("resolveInlineSourceFromPath", () => {
  it("loads managed skill markdown files from an exported folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-cli-portability-"));
    tempPaths.push(root);

    const manifest: CompanyPortabilityManifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: {
        companyId: "11111111-1111-1111-1111-111111111111",
        companyName: "Paperclip",
      },
      includes: {
        company: true,
        agents: false,
        managedSkills: true,
      },
      company: {
        path: "COMPANY.md",
        name: "Paperclip",
        description: null,
        brandColor: null,
        requireBoardApprovalForNewAgents: true,
      },
      agents: [],
      managedSkills: [
        {
          slug: "research-ui",
          name: "Research UI",
          path: "managed-skills/research-ui/SKILL.md",
          description: "Portable managed skill",
          status: "active",
          scopes: [{ scopeType: "company", agentSlug: null }],
        },
      ],
      requiredSecrets: [],
    };

    await fs.writeFile(path.join(root, "paperclip.manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    await fs.writeFile(path.join(root, "COMPANY.md"), "---\nkind: company\n---\n", "utf8");
    await fs.mkdir(path.join(root, "managed-skills", "research-ui"), { recursive: true });
    await fs.writeFile(
      path.join(root, "managed-skills", "research-ui", "SKILL.md"),
      "---\nname: Research UI\ndescription: Portable managed skill\n---\n\n# Research UI\n",
      "utf8",
    );

    const resolved = await resolveInlineSourceFromPath(root);

    expect(resolved.files["managed-skills/research-ui/SKILL.md"]).toContain("# Research UI");
  });
});
