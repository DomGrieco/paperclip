# Hermes Bootstrap Importer and Profile Classification Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Convert a real Hermes home into a Paperclip-managed bootstrap classification that separates structured config, secrets, and provider auth state, then materialize worker bootstrap files from that classification without relying on a steady-state source mount.

Architecture: Use the verified local Hermes setup model as the source of truth. Add a narrow importer service in Paperclip that reads auth.json, config.yaml, and .env from an existing Hermes home, classifies the contents into a managed bootstrap summary plus worker-compatible file payloads, and plugs that importer into Hermes runtime preparation. Preserve the current compatibility behavior while making import intent explicit and observable.

Tech Stack: TypeScript, Node fs/path, Vitest, existing Paperclip secrets/runtime-prep services, Hermes-compatible config/env/auth file projection.

---

## Current verified Hermes facts this plan relies on

- Hermes setup is modular, not just a single login:
  - model/provider
  - terminal backend
  - tools
  - gateway/messaging
  - TTS
  - agent settings
- Hermes persists bootstrap/runtime state across:
  - `~/.hermes/config.yaml`
  - `~/.hermes/.env`
  - `~/.hermes/auth.json`
- `config.yaml` holds structured runtime config such as model/provider/base_url, auxiliary routing, terminal defaults, toolsets, TTS/STT, MCP, and memory/compression/display settings.
- `.env` holds provider keys, tool provider keys, gateway tokens, and other deployment-specific secret values.
- `auth.json` holds provider auth state and active provider selection, including refreshable OAuth/device-code state such as Codex auth.

These were verified from the local Hermes repo and local `~/.hermes` state before writing this plan.

---

## Slice objective

Deliver one narrow implementation slice that adds:

1. A Hermes bootstrap importer/classifier service in Paperclip.
2. A summary contract describing what was imported.
3. Runtime-prep support for importing from an existing Hermes home path into managed worker bootstrap files.
4. Tests proving imported Hermes state is classified and materialized without keeping the import source in the steady-state runtime contract.

Do not add UI or DB tables in this slice.
Do not attempt to fully persist structured bootstrap profiles in Paperclip yet.

---

## Task 1: Add shared bootstrap classification types

Objective: Create a typed contract for the importer output so later slices can persist and render it cleanly.

Files:
- Modify: `packages/shared/src/types/orchestration.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test/usage via server tests in later tasks

Implementation details:
- Add a new summary type for Hermes bootstrap imports, e.g.:
  - source path
  - active provider
  - default model
  - terminal backend/cwd
  - enabled MCP server names
  - enabled platform toolset names
  - detected secret env key names
  - detected auth provider ids
- Keep the type summary-only, not full secret contents.
- Export the new type from both shared index files so server imports work during full build.

Validation:
- Full repo build later must pass; missing shared exports are a known pitfall.

Commit suggestion:
- `feat: add hermes bootstrap import summary types`

---

## Task 2: Implement Hermes bootstrap importer/classifier service

Objective: Read a Hermes home and classify its real setup surfaces into summary metadata plus worker-compatible file payloads.

Files:
- Create: `server/src/services/hermes-bootstrap.ts`
- Possibly modify: `server/src/services/hermes-runtime.ts`
- Create: `server/src/__tests__/hermes-bootstrap.test.ts`

Implementation details:
- Add a service function to read from a Hermes home path:
  - `auth.json`
  - `config.yaml`
  - `.env`
- Parse these safely and tolerate missing files.
- Return two layers of output:
  1. summary metadata for observability/review
  2. sanitized worker bootstrap payloads for auth/config/env projection
- Classification rules:
  - `auth.json` => auth provider ids + active provider summary + raw auth payload text for worker projection
  - `config.yaml` => extract summary fields like provider/default/base_url, terminal backend/cwd, MCP server names, toolsets/platform toolsets
  - `.env` => detect secret env keys by name and preserve file payload for worker projection
- Do not expose raw secrets in the summary.
- Keep file payload behavior Hermes-compatible so runtime prep can still materialize auth.json/config.yaml/.env.

Tests:
- importer with all three files present
- importer with partial/missing files
- importer summary does not leak secret values but does report secret key names
- importer correctly detects active provider/model/terminal/MCP/toolset surfaces from realistic fixture content

Validation command:
- `pnpm exec vitest run src/__tests__/hermes-bootstrap.test.ts --config vitest.config.ts`

Commit suggestion:
- `feat: classify hermes bootstrap imports`

---

## Task 3: Integrate importer into Hermes runtime prep

Objective: Make runtime prep import from an explicit Hermes home path by using the classifier output rather than a blind steady-state source mount.

Files:
- Modify: `server/src/services/hermes-runtime.ts`
- Modify: `server/src/services/hermes-container-plan.ts`
- Modify: `server/src/__tests__/hermes-runtime.test.ts`
- Modify: `server/src/__tests__/hermes-container-plan.test.ts`

Implementation details:
- Add explicit import-source support using an env/config hint such as:
  - `PAPERCLIP_HERMES_IMPORT_HOME`
- During runtime prep:
  - if inline managed bootstrap payloads already exist, keep current behavior
  - else if an import-home hint exists, run the new importer/classifier against that path
  - materialize worker `auth.json`, `.env`, and `config.yaml` from the importer payload
  - expose a non-secret JSON summary in runtime env for observability if useful
  - remove the import-home hint from the final worker env after materialization
- Ensure the steady-state container launch plan does not mount the import source unless explicitly requested for a transitional/import-helper path.

Tests:
- runtime prep can import from a real temp Hermes home path
- final runtime env excludes the import-home hint
- materialized worker home contains auth/config/env from the import source
- container plan for normal runtime-prep output does not mount the import path
- explicit shared-auth import mount still works if intentionally requested elsewhere

Validation commands:
- `pnpm exec vitest run src/__tests__/hermes-runtime.test.ts src/__tests__/hermes-container-plan.test.ts --config vitest.config.ts`

Commit suggestion:
- `feat: import hermes homes during runtime prep`

---

## Task 4: Validate broader repo safety

Objective: Prove the slice works in the monorepo and doesn’t break shared exports.

Files:
- none expected unless build reveals export or typing gaps

Validation commands:
- `pnpm exec vitest run src/__tests__/hermes-bootstrap.test.ts src/__tests__/hermes-runtime.test.ts src/__tests__/hermes-container-plan.test.ts --config vitest.config.ts`
- `pnpm build`

If validation fails:
- fix the narrowest issue
- rerun focused tests
- rerun full build

Commit suggestion:
- no extra commit if fixes remain inside the same narrow slice

---

## Out of scope for this slice

Do not implement yet:
- UI for managed Hermes bootstrap
- DB tables for persisted bootstrap profiles or provider auth records
- full conversion of `.env` keys into company secrets automatically
- MCP/gateway editing UI
- worker-side dynamic setup wizard replay

Those should follow only after the importer/classifier seam is stable.

---

## Definition of done

This slice is done when:
- Hermes setup findings are documented in repo docs/specs.
- Paperclip can classify a real Hermes home into summary metadata plus worker-compatible payloads.
- Hermes runtime prep can import from an existing Hermes home path without keeping that path in the steady-state worker env/runtime contract.
- Focused tests pass.
- Full `pnpm build` passes.
- Changes are committed in a narrow slice.
- Any unrelated repo dirt is explicitly left out.
