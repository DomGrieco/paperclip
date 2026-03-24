# Remaining Hermes + Paperclip Roadmap Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Close the remaining gaps in the Hermes fleet roadmap by moving from a locally validated architecture spine to a repeatable, operator-friendly, regression-tested, production-oriented Paperclip control plane.

Architecture: Treat the current branch as having a working backbone — runtime bundle projection, shared context, runner-plane/container execution, and live issue-backed Hermes orchestration are already materially present. The next plan focuses on hardening and completion: durable regression coverage, smoother authenticated dogfooding/operator UX, managed Hermes bootstrap independent of host-local state, richer shared skill/memory governance, and better review/evidence UI.

Tech Stack: TypeScript, Express, React, Drizzle ORM, PostgreSQL, Docker Compose, Hermes CLI/runtime, browser dogfooding, Vitest, persisted run logs

---

## Current context / assumptions

What is already strongly present in the repo/history:
- Hermes fleet control-plane docs and plan
- Hermes runtime bundle projection into worker workspaces
- helper-first Paperclip API contract for unattended Hermes workers
- shared-context packet materialization and publication foundation
- runner-plane contract and `hermes_container` execution path
- live issue-backed Hermes CEO planner execution succeeding through Paperclip
- `agents.lastHeartbeatAt` start-time observability fix
- prompt hardening for helper-first narrow-scope execution, including issue-backed fallback prompt behavior

Known remaining gaps:
- authenticated browser/operator bootstrap is still rough
- regression coverage is weaker than the amount of runtime behavior already implemented
- some evidence/review surfaces still require DB/log spelunking rather than clear UI presentation
- long-term production bootstrap still leans on host `~/.hermes` as a practical local source
- shared-skill governance and richer shared-memory publication flows are foundational rather than complete

Planning assumptions:
- Keep commits narrow and frequent
- Prefer additive improvements over sweeping rewrites
- Every runtime-facing slice requires tests plus browser/local dogfood where practical
- Preserve the Paperclip control-plane vs Hermes worker-plane boundary

---

## Proposed approach

Work in five milestone groups:

1. Stabilize what already works
2. Make local authenticated dogfooding/operator flows reliable
3. Remove the long-term host `~/.hermes` dependency by making bootstrap managed by Paperclip
4. Deepen shared context into governed shared skills/memory workflows
5. Improve reviewability and prepare for cleaner runner/service separation

The first two groups should produce the strongest near-term leverage because they reduce regressions and make further validation cheaper.

---

## Milestone 1: Stabilization and regression coverage

Objective: Convert live proof into durable automated proof and clean up dogfood noise.

### Task 1.1: Clean stale dogfood validation artifacts

Files likely to change:
- none if done operationally only
- maybe `doc/plans/` or a dogfood note if documenting cleanup results

Steps:
1. Inspect the dogfood company for stale validation issues/runs (e.g. PAP-7, PAP-8, older malformed or stuck validation artifacts).
2. Decide the minimal cleanup action per artifact:
   - close as cancelled
   - mark done with explanatory comment
   - delete only if clearly invalid test pollution and safe to remove
3. Record what was cleaned and why.
4. Verify the company issue board is no longer polluted with obsolete regression artifacts.

Validation:
- DB/API issue listing is clean
- no active misleading validation issue remains

### Task 1.2: Add integration test for assignment-backed planner start semantics

Objective: Lock in the live-proofed behavior that an assignment-backed planner run starts cleanly and updates the read model immediately.

Files likely to change:
- Create or modify: `server/src/__tests__/issues-checkout-wakeup.test.ts`
- Possibly modify: `server/src/__tests__/heartbeat-workspace-session.test.ts`
- Inspect: `server/src/services/heartbeat.ts`
- Inspect: `server/src/services/issues.ts`

Implementation targets:
- create a company, CEO agent, and assigned issue
- trigger assignment-backed run path
- assert run enters `running`
- assert `agents.lastHeartbeatAt` equals run `startedAt` while run is active
- assert issue/run binding fields are correct during execution

Validation commands:
- `pnpm exec vitest run src/__tests__/issues-checkout-wakeup.test.ts --config vitest.config.ts`
- if a second focused test file is added, run both explicitly

Commit suggestion:
- `test: cover assignment-backed planner start observability`

### Task 1.3: Add regression coverage for issue-backed Hermes container prompt behavior

Objective: Preserve the task-aware prompt behavior in both runtime-prep and container fallback paths.

Files likely to change:
- `server/src/__tests__/hermes-runtime.test.ts`
- `server/src/__tests__/hermes-container-execution.test.ts`
- Possibly `server/src/services/hermes-container-execution.ts` only if more fallback edge cases are discovered

Implementation targets:
- cover runtime-bundle issue/title/description fallback
- cover no-task branch explicitly
- cover custom prompt + runtime note + task workflow preservation

Validation commands:
- `pnpm exec vitest run src/__tests__/hermes-runtime.test.ts src/__tests__/hermes-container-execution.test.ts --config vitest.config.ts`

Commit suggestion:
- `test: harden hermes issue prompt regressions`

---

## Milestone 2: Authenticated local dogfood / operator UX hardening

Objective: Make local authenticated Paperclip operation a reliable control-plane workflow instead of an expert-only path.

### Task 2.1: Audit and map the authenticated bootstrap flow

Files likely to change:
- `doc/plans/` dogfood report file or local note
- Inspect only first:
  - `server/src/routes/access.ts`
  - `server/src/board-claim.ts`
  - auth-related UI pages/components
  - local onboarding/auth smoke tests

Questions to answer:
- Why does browser sign-in/create-account sometimes diverge from backend reality?
- What exact steps should a fresh operator follow in authenticated local mode?
- Where do claim/bootstrap/admin paths remain confusing?

Validation:
- produce a concise operator flow map with exact URLs and expected states

### Task 2.2: Harden local authenticated operator flows

Files likely to change:
- likely server auth/bootstrap routes and/or UI auth onboarding surfaces
- likely release smoke or browser regression tests
- possibly docs under `docs/deploy/` or `doc/`

Implementation targets:
- reliable board-claim / instance-admin path
- repeatable sign-in and company-creation path
- reduced need for manual DB/operator intervention

Validation:
- browser dogfood from sign-in to company/company-membership visibility
- if feasible, automated smoke coverage for the improved path

Commit suggestion:
- `fix: streamline authenticated local operator bootstrap`

### Task 2.3: Document the dogfood bootstrap workflow

Files likely to change:
- `doc/DOCKER.md`
- `docs/deploy/deployment-modes.md`
- possibly the dogfood/bootstrap skill doc if mirrored in repo docs

Implementation targets:
- exact local authenticated bootstrap steps
- expected failure modes and how to recognize them
- when to use board claim vs standard sign-in vs bootstrap CLI

Commit suggestion:
- `docs: document authenticated dogfood bootstrap flow`

---

## Milestone 3: Managed Hermes bootstrap and company-scoped durable state

Objective: Move from host `~/.hermes` bootstrap dependence to Paperclip-managed Hermes provisioning.

### Task 3.1: Design the managed Hermes bootstrap state model

Files likely to change:
- `doc/spec/hermes-fleet-control-plane.md`
- `doc/spec/agent-runtime-surface.md`
- maybe a new plan doc under `doc/plans/`

Design targets:
- what provider auth/config Paperclip stores
- how company-scoped managed Hermes home is materialized
- which parts remain import-only from host `~/.hermes`
- migration path for current local dogfood installations

Deliverable:
- explicit data model and projection contract before implementation

Commit suggestion:
- `docs: define managed hermes bootstrap model`

### Task 3.2: Implement Paperclip-managed Hermes bootstrap materialization

Files likely to change:
- `server/src/services/hermes-runtime.ts`
- secret/config services and supporting schema/types
- possibly routes/UI for managing provider/runtime config

Implementation targets:
- Paperclip-managed storage of Hermes provider/auth/runtime defaults
- company Hermes home materialized from managed state
- host `~/.hermes` import path becomes optional migration/bootstrap helper

Validation:
- focused runtime-prep tests
- live worker run without relying on host-local durable Hermes home as primary source

Commit suggestion:
- `feat: materialize managed hermes bootstrap state`

---

## Milestone 4: Shared skills, memory governance, and inter-agent communication

Objective: Upgrade shared context from a packet/publication foundation into a governed collaboration layer.

### Task 4.1: Shared skill governance design

Files likely to change:
- specs/docs first
- likely later shared types, DB schema, services, and UI surfaces

Design targets:
- local-only skills vs shared company/project skills
- proposal/approval/publication lifecycle
- runtime projection of approved shared skills

Commit suggestion:
- `docs: define shared skill governance`

### Task 4.2: Shared skill publication implementation

Files likely to change:
- shared context / publication schema and services
- runtime bundle assembly
- UI inspection/review surfaces

Implementation targets:
- create proposed shared skill record
- approve/reject flow
- projection into runtime bundle for relevant workers

Validation:
- service/API tests
- runtime bundle tests
- browser checks where UI is added

Commit suggestion:
- `feat: add shared skill publication workflow`

### Task 4.3: Richer shared-memory and inter-agent publication flows

Files likely to change:
- `server/src/services/shared-context-publications.ts`
- runtime bundle assembly / recall selection logic
- UI/context browsing surfaces

Implementation targets:
- stronger provenance/freshness/ranking
- issue/project/company visibility scoping
- explicit inter-agent request/publication patterns beyond comments-only usage

Commit suggestion:
- `feat: deepen shared memory and inter-agent publication flows`

---

## Milestone 5: Review/evidence UX and cleaner runner separation

Objective: Make the system easier to operate and review, then prepare for cleaner production boundaries.

### Task 5.1: Review/evidence UI hardening

Files likely to change:
- issue detail / live runs / run graph UI surfaces
- shared context or evidence components
- server routes if additional evidence payload shaping is needed

Implementation targets:
- clearer planner/worker/verification graph visibility
- clearer evidence bundle presentation
- easier shared-context / provenance inspection
- reduced need for DB/log spelunking for normal operator review

Validation:
- browser dogfood of issue/run review flow
- console checks and screenshots for changed surfaces

Commit suggestion:
- `feat: improve run graph and evidence review surfaces`

### Task 5.2: Separate runner-plane responsibilities more cleanly

Files likely to change:
- runner-plane services
- launcher/bridge services
- deployment/topology docs

Implementation targets:
- reduce coupling between the Paperclip app container and direct runner concerns
- clarify what remains in-process vs what becomes a dedicated runner service
- preserve local-first path while preparing for remote/generalized runner mode

Validation:
- integration tests for runner planning/launch behavior
- local Docker smoke path remains healthy

Commit suggestion:
- `refactor: separate runner plane responsibilities`

---

## Files likely to change overall

Docs/specs/plans:
- `doc/plans/2026-03-22-hermes-paperclip-fleet-implementation.md`
- `doc/spec/hermes-fleet-control-plane.md`
- `doc/spec/autonomous-enterprise-roadmap.md`
- `doc/spec/agent-runtime-surface.md`
- `doc/spec/feature-1-hierarchical-orchestration.md`
- possibly additional `doc/plans/*.md`

Server/runtime/orchestration:
- `server/src/services/heartbeat.ts`
- `server/src/services/issues.ts`
- `server/src/services/hermes-runtime.ts`
- `server/src/services/hermes-container-execution.ts`
- `server/src/services/hermes-container-plan.ts`
- `server/src/services/hermes-container-launcher.ts`
- `server/src/services/shared-context-publications.ts`
- `server/src/services/runtime-bundle.ts`
- auth/bootstrap-related routes and services

Tests:
- `server/src/__tests__/issues-checkout-wakeup.test.ts`
- `server/src/__tests__/heartbeat-workspace-session.test.ts`
- `server/src/__tests__/hermes-runtime.test.ts`
- `server/src/__tests__/hermes-container-execution.test.ts`
- additional auth/bootstrap/browser smoke coverage as needed

UI:
- issue detail / live runs / evidence inspection pages and components
- auth/bootstrap/operator flow pages if hardened
- shared context / review surfaces

---

## Validation strategy

Per slice:
- run only the smallest relevant targeted tests first
- then broader server/build validation when a slice crosses subsystem boundaries
- browser dogfood every runtime-facing or operator-facing slice
- inspect persisted run logs and DB state for orchestration behavior, not just top-line success/failure

Typical commands:
- `pnpm exec vitest run <focused-files> --config vitest.config.ts`
- `pnpm build`
- Docker/local smoke as needed
- browser validation against the real Paperclip app

For orchestration slices specifically, validate all of:
- issue state
- heartbeat_runs / events
- agents.lastHeartbeatAt
- persisted run log behavior
- UI presentation where applicable

---

## Risks / tradeoffs

1. Auth/operator UX fixes can sprawl if mixed with unrelated runtime changes; keep them isolated.
2. Managed Hermes bootstrap may require schema/secrets/UI work across multiple layers; do docs/design first.
3. Shared skills/memory governance can easily become over-designed; keep first versions narrow and operator-auditable.
4. Review/evidence UI improvements may uncover missing backend shaping; treat that as a separate support slice, not a surprise in a giant frontend diff.
5. Runner-service extraction is valuable but should come after the local-first production spine is well tested.

---

## Definition of “remaining roadmap addressed”

This roadmap is materially addressed when:
- assignment-backed planner execution and observability are protected by automated tests
- local authenticated operator flows are repeatable without heroic intervention
- Hermes bootstrap is primarily Paperclip-managed, not host-home-dependent
- shared context evolves into governed shared skills/memory collaboration
- review/evidence UI is good enough for normal operator use
- runner-plane responsibilities are clean enough to extend toward a dedicated service boundary later

---

## Suggested execution order summary

1. Dogfood cleanup + orchestration regression coverage
2. Authenticated local operator/bootstrap hardening
3. Managed Hermes bootstrap/materialization
4. Shared skill governance
5. Shared memory / inter-agent publication deepening
6. Review/evidence UI hardening
7. Cleaner runner-plane separation
8. Later enterprise connectors and broader operating-system expansion
