# Managed Hermes Home And Protected Control-Plane Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use subagent-driven-development or executing-plans to implement this plan task-by-task. Keep commits narrow and validation explicit.

**Goal:** Replace the temporary host-`~/.hermes` bootstrap assumption with a Paperclip-managed, company-scoped Hermes home model while enforcing a hard boundary that prevents workers from directly editing the Paperclip control-plane filesystem.

**Architecture:** Treat Paperclip as a protected control plane that provisions Hermes bootstrap/auth/config and governs durable company-scoped Hermes state. Hermes workers run in isolated execution workspaces/containers with scoped writable mounts for project work and scratch state, but they interact with Paperclip itself only through API/helper/CLI surfaces. This plan is the prerequisite hardening slice before the primary `hermes_container` execution cutover.

**Tech Stack:** TypeScript, Express, React, Drizzle ORM, PostgreSQL, Docker Compose, Hermes CLI/runtime, browser dogfooding

---

## Why this plan exists

The current local-first implementation can mount host `~/.hermes` and copy selected files into worker state. That was useful to validate provider/model alignment and runner-plane ideas, but it is not the target production architecture.

Key reasons to harden the design now:

1. A fresh deployment on another machine/server may not have a valid `~/.hermes`.
2. A long-lived autonomous company should accumulate shared Hermes memories/skills/config over time.
3. Workers must not be able to patch or corrupt the Paperclip server repo/files from inside the Paperclip container.
4. The next major implementation step (`runner-container-primary-execution-cutover`) should happen on top of the correct state and isolation model, not a temporary bootstrap shortcut.

## Decisions locked by this plan

1. Paperclip remains the protected control plane.
2. Hermes remains the worker runtime.
3. Durable Hermes state is company-scoped by default.
4. Execution scratch state is isolated per run/workspace.
5. Paperclip filesystem/code is not a writable worker mount.
6. Workers mutate Paperclip state only through API/helper/CLI surfaces.
7. Host `~/.hermes` is an optional bootstrap/import source, not a permanent runtime dependency.

## Deliverables

1. Spec updates that make the new state/isolation model explicit.
2. Storage/path design for company-scoped managed Hermes homes.
3. Bootstrap/import design for existing local Hermes installs.
4. Runner/mount policy that protects Paperclip control-plane files.
5. A sequenced implementation order that leads back to `runner-container-primary-execution-cutover`.

## File targets likely to change

### Specs / plans
- Modify: `doc/spec/hermes-fleet-control-plane.md`
- Modify: `doc/spec/hermes-auth-profiles.md`
- Create: `doc/plans/2026-03-23-managed-hermes-home-and-control-plane-isolation.md`
- Optionally modify later: `doc/spec/agent-runtime-surface.md`

### Shared path/state helpers
- `server/src/home-paths.ts`
- `server/src/services/hermes-runtime.ts`
- `server/src/services/hermes-container-plan.ts`
- any new shared runtime state helper files

### Server / runner
- `server/src/services/heartbeat.ts`
- `server/src/services/workspace-runtime.ts`
- `server/src/services/hermes-container-launcher.ts`
- routes/services for company-scoped Hermes bootstrap or managed runtime config

### Deployment / ops
- `docker-compose.yml`
- deployment docs
- possible future bootstrap/import scripts or setup commands

---

## Phase 0: Lock the architecture in docs before more runtime code

### Task 0.1: Update the Hermes fleet control-plane spec

**Objective:** Make company-scoped managed Hermes state and protected control-plane boundaries explicit.

**Files:**
- Modify: `doc/spec/hermes-fleet-control-plane.md`

- [ ] Replace the old per-agent durable-home assumption with company-scoped managed Hermes state.
- [ ] Add the bootstrap/import model so production does not depend on host `~/.hermes`.
- [ ] Add the hard rule that workers must not edit Paperclip control-plane files directly.
- [ ] Commit docs in isolation.

### Task 0.2: Update the Hermes auth/bootstrap spec

**Objective:** Reframe the auth-profile doc from "shared auth + isolated agent homes" to "managed company durable home + isolated scratch state".

**Files:**
- Modify: `doc/spec/hermes-auth-profiles.md`

- [ ] Define company durable state vs run-local scratch state.
- [ ] Clarify that host `~/.hermes` is bootstrap/import only.
- [ ] Clarify that managed company Hermes memory/skills may grow after bootstrap without mirroring host state.
- [ ] Commit docs in isolation.

---

## Phase 1: Introduce the managed storage model

### Task 1.1: Add company-scoped Hermes home path helpers

**Objective:** Give Paperclip one canonical path for managed Hermes durable state per company.

**Files:**
- Modify: `server/src/home-paths.ts`
- Test: add/extend `server/src/__tests__/...` for path helpers

Implementation target:
- add a helper like `resolveCompanyHermesHomeDir(companyId: string): string`
- example root: `/paperclip/instances/default/companies/<company-id>/hermes-home`

Validation:
- unit test the new path helper
- keep existing workspace path helpers unchanged unless needed

Commit:
- `git commit -m "feat: add company hermes home path helper"`

### Task 1.2: Separate durable Hermes state from scratch state in runtime prep

**Objective:** Stop treating the execution workspace or agent workspace as the durable Hermes home itself.

**Files:**
- Modify: `server/src/services/hermes-runtime.ts`
- Modify: `server/src/services/heartbeat.ts`
- Test: `server/src/__tests__/hermes-runtime.test.ts`

Required behavior:
- `HERMES_HOME` resolves to the company-scoped managed home
- run/workspace-local scratch paths remain available for temporary state and artifacts
- runtime bundle files continue to materialize into the execution workspace, not the protected control-plane filesystem

Validation:
- targeted unit tests
- inspect effective config log line in heartbeat output

Commit:
- `git commit -m "feat: use company managed hermes home"`

---

## Phase 2: Replace ad hoc host bootstrap with managed bootstrap/import

### Task 2.1: Model bootstrap source as optional import input

**Objective:** Make the host `~/.hermes` mount explicitly optional and migration-oriented.

**Files:**
- Modify: `server/src/services/hermes-runtime.ts`
- Modify: deployment docs / local dev docs as needed
- Test: `server/src/__tests__/hermes-runtime.test.ts`

Required behavior:
- if a bootstrap source exists, import/sync the allowlisted auth/config files into managed company state
- if no bootstrap source exists, runtime still works as long as Paperclip-managed company bootstrap exists
- missing host `~/.hermes` should no longer imply broken architecture

Validation:
- tests for both "bootstrap source present" and "bootstrap source absent"

Commit:
- `git commit -m "feat: support optional hermes bootstrap source"`

### Task 2.2: Define the first Paperclip-managed company bootstrap surface

**Objective:** Give Paperclip a place to own Hermes bootstrap/config independent of host files.

**Files:**
- create/modify the smallest practical config/secrets surface in server code
- possibly docs only in first slice if DB/UI is deferred

Minimum acceptable first slice:
- define the data contract and storage location
- support file-backed managed company bootstrap under Paperclip home if DB modeling is deferred
- keep the interface narrow and reversible

Do not overbuild yet:
- no full UI wizard required in the first slice unless runtime implementation demands it
- no generic multi-provider management framework unless needed immediately

Commit:
- `git commit -m "feat: add managed company hermes bootstrap contract"`

---

## Phase 3: Enforce protected control-plane boundaries

### Task 3.1: Define and enforce mount policy for worker containers

**Objective:** Ensure workers cannot directly patch Paperclip code/files in the server container.

**Files:**
- Modify: `server/src/services/hermes-container-plan.ts`
- Modify: `server/src/services/hermes-container-launcher.ts`
- Modify: `server/src/services/workspace-runtime.ts`
- Test: add targeted launcher/plan tests

Required policy:
- no writable mounts for Paperclip app code/control-plane directories
- only mount:
  - assigned project workspace(s)
  - artifact output dirs
  - allowed worker scratch dirs
  - managed company Hermes durable home if needed by the worker runtime
- any Paperclip control-plane surface exposed to workers must be read-only or API-mediated

Validation:
- test generated mount plans
- verify a live run still succeeds
- inspect container launch metadata/logs

Commit:
- `git commit -m "feat: enforce protected paperclip mount policy"`

### Task 3.2: Harden the API/helper-only rule for Paperclip mutations

**Objective:** Make the worker contract explicit: control-plane mutation goes through helper/API, not filesystem edits.

**Files:**
- Modify: `server/src/services/hermes-runtime.ts`
- Modify: prompt/runtime note materialization if needed
- Modify docs if needed

Required behavior:
- worker instructions clearly state that Paperclip must be interacted with through helper/API/CLI only
- no prompt text should imply that editing Paperclip server files is a legitimate control-plane mutation path

Validation:
- inspect materialized runtime instructions/prompt note
- validate a live heartbeat still uses helper/API path successfully

Commit:
- `git commit -m "docs: harden paperclip api-only worker contract"`

---

## Phase 4: Reconnect to the original roadmap

### Task 4.1: Update the `hermes_container` cutover checklist

**Objective:** Make the next execution slice depend on the corrected storage/isolation model.

**Files:**
- Modify: this plan or a dedicated follow-up plan
- Optionally update: `doc/plans/2026-03-22-hermes-paperclip-fleet-implementation.md`

Checklist to confirm before cutover:
- [ ] company-scoped managed Hermes home exists
- [ ] host bootstrap source is optional, not required
- [ ] worker mount policy protects Paperclip control-plane files
- [ ] runtime bundle/helper contract still works
- [ ] browser dogfooding still passes for Hermes flows

Commit:
- `git commit -m "docs: connect managed hermes home work to container cutover"`

### Task 4.2: Resume `runner-container-primary-execution-cutover`

**Objective:** Move actual Hermes execution into `hermes_container` after the state and isolation model is correct.

This is intentionally not part of the current docs-only/spec-hardening slice.
It is the next implementation milestone after the tasks above are complete.

---

## Validation standard for this plan

This plan is not complete until:
- docs/spec updates are committed cleanly
- the next implementation slice has a clear storage/mount/security target
- the original roadmap is preserved, not replaced
- `runner-container-primary-execution-cutover` remains the next major implementation task after this hardening work

## Recommended commit order

1. `docs: update hermes fleet control-plane state model`
2. `docs: update hermes bootstrap/auth model`
3. `docs: add managed hermes home and isolation implementation plan`

## End state after this plan

After this plan lands, the architecture should be unambiguous:
- Paperclip is the protected control plane.
- Hermes is the worker runtime.
- Durable Hermes memory/skills/config are shared per company by default.
- Execution scratch state stays isolated.
- Host `~/.hermes` is only a bootstrap/import option.
- Workers cannot directly mutate Paperclip code/files in the Paperclip container.
- The next implementation target remains `runner-container-primary-execution-cutover`, now on a safer foundation.
