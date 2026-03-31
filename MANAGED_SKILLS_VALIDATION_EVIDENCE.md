# Managed Skills Validation Evidence

Date: 2026-03-31
Company: Paperclip Internal Dogfood (`PAP`)
Company ID: `215e1a5e-bd47-4a3a-9fef-d52a493c683a`
Project: Paperclip Self-Improvement Sprint 0
Project ID: `49b8904c-124c-448d-b16d-aa67c17bf3c0`

## Fixture inventory validated

The live managed-skill sentinel fixtures were already present in the dogfood company and were validated through the supported API surface.

### Company-scope base fixture
- Skill ID: `4a2cd5fb-eea7-4c63-9d2c-4539d3c70089`
- Name: `Managed Skill Live Sentinel`
- Slug: `managed-skill-live-sentinel`
- Scope: company
- Sentinel string: `PAP_MANAGED_SKILL_COMPANY_SENTINEL_V1`

### Project-scope override fixture
- Skill ID: `ce99236e-1f12-45ff-975b-fc508f40b5eb`
- Name: `Managed Skill Live Sentinel Project Override`
- Slug: `managed-skill-live-sentinel`
- Scope: project `49b8904c-124c-448d-b16d-aa67c17bf3c0`
- Sentinel string: `PAP_MANAGED_SKILL_PROJECT_SENTINEL_V1`

### Agent-scope override fixture
- Skill ID: `4a8b88d1-4864-4743-8ad0-aeb5841c26c9`
- Name: `Managed Skill Live Sentinel Agent Override`
- Slug: `managed-skill-live-sentinel`
- Scope: agent `c45b5efe-f685-49e6-a244-016df39b08d0` (`Hermes Engineer`)
- Sentinel string: `PAP_MANAGED_SKILL_AGENT_SENTINEL_V1`

## API validation used

Authenticated API reads confirmed:
- managed-skills list
- managed-skill detail bodies
- managed-skill scopes
- effective-preview at company scope
- company project list
- company agent list

Key API observations:
- company-scope preview resolves `managed-skill-live-sentinel` as `sourceType=company`
- project and agent fixtures share the same slug, confirming scoped override coexistence
- fixture markdown bodies contain the expected exact sentinel strings

## Live propagation proof

## Hermes company-scope proof
Issue: `PAP-40`
Issue ID: `7e6f5b4a-81ec-4681-bdab-2020f4ee2a92`
Agent: `Hermes CEO`
Agent ID: `b1178794-4491-45da-9a2d-64db0dedd34d`
Run ID: `0aa9937a-1859-4198-91e4-1471d8da09fc`
Result: succeeded

Evidence:
- issue comment body: `PAP_MANAGED_SKILL_COMPANY_SENTINEL_V1 — company override won (managed-skill visibility confirms company-precedence).`
- run log explicitly states shared-context managed skills included:
  - `managed-skill-live-sentinel (company)`
  - `paperclip-planner-review (company)`

## Hermes project-scope proof
Issue: `PAP-41`
Issue ID: `8aecf569-12ed-4942-b3cc-c4ca96995f96`
Agent: `Hermes QA`
Agent ID: `36b91410-2c1b-49e1-ab35-1486039e00b0`
Run ID: `c7c1a3f5-9584-4597-8193-883d98f279ee`
Result: succeeded

Evidence:
- issue comment body: `PAP_MANAGED_SKILL_PROJECT_SENTINEL_V1 - managed skill visible from project scope; project override won.`
- run log explicitly states shared-context `managedSkills` included:
  - `managed-skill-live-sentinel (sourceType project)`
  - `paperclip-planner-review (sourceType project)`

## Hermes agent-scope proof
Issue: `PAP-42`
Issue ID: `8d618ea8-33d6-46ba-9a55-345ff79d39c9`
Agent: `Hermes Engineer`
Agent ID: `c45b5efe-f685-49e6-a244-016df39b08d0`
Run ID: `193c9d27-547e-4bd9-b5b0-1f72c5acd625`
Result: succeeded

Evidence:
- issue comment body: `Runtime managed-skill check: managed skill is visible and the agent override won. PAP_MANAGED_SKILL_AGENT_SENTINEL_V1`
- run completed quickly and closed the issue successfully

## Codex company-scope proof
Issue: `PAP-43`
Issue ID: `d9d66e25-0646-4ddc-920a-85f30a3cba3e`
Agent: `Codex Engineer`
Agent ID: `220f2ddf-bed8-4ab5-a087-971c0f0e83ae`
Run ID: `864581f6-38b9-4420-8898-8f32a70414a2`
Result: succeeded

Evidence:
- issue comment body includes:
  - `Managed skill was visible in the runtime and the company override won.`
  - `PAP_MANAGED_SKILL_COMPANY_SENTINEL_V1`
- run log explicitly read:
  - `.paperclip/runtime/skills/managed-skill-live-sentinel/SKILL.md`
- run log captured the exact sentinel inside the materialized skill body

## Cursor company-scope proof
Primary run used for proof:
- Agent: `Cursor Engineer`
- Agent ID: `b53b153d-4ec9-4eb4-b801-886af4cfca05`
- Run ID: `c474c143-c679-4f29-80c1-84ae122190c8`
- Result: succeeded

Issue evidence written by Cursor during that live run:
- `PAP-38` / issue ID `937af471-09d9-4136-a626-5457e7159bb0`
- `PAP-32` / issue ID `c6ee3c43-d395-4fa4-83a3-bdc9e204e794`

Evidence:
- Cursor run log enumerated workspace files including:
  - `.paperclip/runtime/skills/managed-skill-live-sentinel/SKILL.md`
- Cursor issue comments explicitly recorded:
  - the materialized runtime skill path
  - the exact sentinel `PAP_MANAGED_SKILL_COMPANY_SENTINEL_V1`
  - confirmation that company-scope propagation was active for Cursor Engineer

Important nuance:
- In this Cursor runtime/workspace, the agent reported only materialized skill files under `.paperclip/runtime/`, not the full `instructions.md` / `bundle.json` / `shared-context.json` trio that Hermes runs read.
- That still counts as valid company-scope propagation evidence because the managed skill was present in the actual runtime-injected skills path and its body contained the expected sentinel.

## Cross-agent conclusion

Validated successfully across live runs:
- Hermes company scope
- Hermes project scope
- Hermes agent scope
- Codex company scope
- Cursor company scope

Observed precedence behavior matched expectations:
- company-only run -> company sentinel
- project-scoped run -> project sentinel
- agent-scoped run on top of project scope -> agent sentinel

## Reproduction pattern

1. Sign in as a board-capable user.
2. Verify fixture state:
   - `GET /api/companies/{companyId}/managed-skills`
   - `GET /api/companies/{companyId}/managed-skills/{skillId}`
   - `GET /api/companies/{companyId}/managed-skills/{skillId}/scopes`
3. For company/project/agent precedence:
   - create a narrow validation issue assigned to the target agent
   - set `projectId` when testing project or agent precedence
   - keep instructions validation-only and require the exact sentinel string in the comment
4. Capture:
   - issue comment evidence
   - issue run record
   - heartbeat log snippets showing runtime file reads or materialized skill paths

## Validation summary

This completes the remaining live managed-skills validation slices for v1 evidence collection.
