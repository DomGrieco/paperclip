import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureGeminiSkillsInjected } from "@paperclipai/adapter-gemini-local/server";
import { ensurePiSkillsInjected } from "@paperclipai/adapter-pi-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("managed skill adapter injection", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("injects Gemini skills from a provided materialized skills directory", async () => {
    const skillsDir = await makeTempDir("paperclip-gemini-materialized-");
    const skillsHome = await makeTempDir("paperclip-gemini-home-");
    cleanupDirs.add(skillsDir);
    cleanupDirs.add(skillsHome);

    await fs.mkdir(path.join(skillsDir, "managed-skill"), { recursive: true });
    await fs.writeFile(path.join(skillsDir, "managed-skill", "SKILL.md"), "---\nname: managed-skill\n---\n", "utf8");

    await ensureGeminiSkillsInjected(async () => {}, {
      skillsDir,
      skillsHome,
    });

    expect(await fs.realpath(path.join(skillsHome, "managed-skill"))).toBe(
      await fs.realpath(path.join(skillsDir, "managed-skill")),
    );
  });

  it("injects Pi skills from a provided materialized skills directory", async () => {
    const skillsDir = await makeTempDir("paperclip-pi-materialized-");
    const skillsHome = await makeTempDir("paperclip-pi-home-");
    cleanupDirs.add(skillsDir);
    cleanupDirs.add(skillsHome);

    await fs.mkdir(path.join(skillsDir, "managed-skill"), { recursive: true });
    await fs.writeFile(path.join(skillsDir, "managed-skill", "SKILL.md"), "---\nname: managed-skill\n---\n", "utf8");

    await ensurePiSkillsInjected(async () => {}, {
      skillsDir,
      skillsHome,
    });

    expect(await fs.realpath(path.join(skillsHome, "managed-skill"))).toBe(
      await fs.realpath(path.join(skillsDir, "managed-skill")),
    );
  });
});
