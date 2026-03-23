# Hermes + Paperclip Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Paperclip into the control plane for a fleet of specialized Hermes agents running in isolated workspaces/containers with scoped memory, controlled shared context, and production-ready validation.

**Architecture:** Keep Paperclip as the company/task/governance source of truth and Hermes as the worker runtime. Build incrementally on the existing `hermes_local` adapter, workspace model, and run graph work. Add a Hermes fleet contract, runner-plane support for isolated containers, shared-context/memory publication, and strict validation including browser dogfooding of the Paperclip UI.

**Tech Stack:** TypeScript, Express, React, Drizzle ORM, PostgreSQL, Docker Compose, Hermes CLI/runtime, browser-based QA

---

## Execution Setup

- Use the current Paperclip fork as the working repo.
- Keep commits narrowly scoped and frequent.
- Do not batch unrelated architecture changes together.
- Every slice that touches runtime behavior must include validation via tests plus browser dogfooding.
- Prefer additive changes over rewrites of existing Paperclip architecture docs.

## Current Context

- Paperclip already has a real `hermes_local` adapter in the server adapter registry.
- Paperclip already has `project_workspaces`, `execution_workspaces`, and `workspace_runtime_services` primitives.
- Paperclip already runs successfully in Docker locally.
- Browser dogfooding confirms account creation/login works, but onboarding from a fresh non-admin-created account currently surfaces an `Instance admin required` blocker on the company-creation step and a 403 console error during the flow. That behavior should be treated as an active UX/policy point to understand during future onboarding work.
- The Paperclip repo is currently on branch `codex/feature2-runner-plane`.

## Primary Deliverables

1. Hermes fleet control-plane spec in `doc/spec/`
2. Runner-plane implementation plan and delivery slices
3. Hermes runtime-bundle / shared-context contract for Paperclip
4. Dockerized deployment topology for Paperclip + worker containers
5. Browser-tested Paperclip flows for configuring and operating Hermes workers

## File Targets Likely To Change

### Docs / specs
- Create: `doc/spec/hermes-fleet-control-plane.md`
- Modify: `doc/spec/agent-runtime-surface.md`
- Modify: `doc/spec/autonomous-enterprise-roadmap.md`
- Modify: `doc/SPEC.md`
- Modify: `doc/SPEC-implementation.md` only if the architecture introduces explicit near-term V1.1 behavior commitments
- Create/modify: additional `doc/plans/*.md` as implementation slices are approved

### Shared types / constants
- `packages/shared/src/constants.ts`
- `packages/shared/src/types/*`
- any runtime bundle / workspace / memory contract files introduced for Hermes fleet support

### Server
- `server/src/adapters/registry.ts`
- runtime adapter integration files for Hermes
- runner/workspace services
- runtime-bundle / memory-packet services
- routes and activity logging around worker runtime configuration

### UI
- agent configuration surfaces
- workspace/runtime configuration surfaces
- issue/run detail UI for Hermes workers
- browser-visible evidence / logs / runtime bundle inspection surfaces

### Deployment / ops
- `docker-compose.yml`
- possible new runner-plane compose/service definitions
- runtime env documentation
- setup/bootstrap scripts

## Phase 0: Architecture Baseline And Documentation

### Task 0.1: Land the Hermes fleet architecture spec

**Files:**
- Create: `doc/spec/hermes-fleet-control-plane.md`
- Test/verify: n/a (docs review)

- [ ] Review current Paperclip specs and ensure the Hermes fleet spec stays additive.
- [ ] Describe the Paperclip-vs-Hermes boundary.
- [ ] Define control plane, runner plane, worker plane, workspace model, memory model, env contract, and validation standard.
- [ ] Commit docs in isolation.

### Task 0.2: Cross-link the new architecture into strategic docs

**Files:**
- Modify: `doc/spec/autonomous-enterprise-roadmap.md`
- Modify: `doc/spec/agent-runtime-surface.md`
- Modify: `doc/SPEC.md`

- [ ] Add Hermes runtime/fleet references where appropriate.
- [ ] Make clear that Hermes is a first-class worker runtime path, not just a legacy adapter footnote.
- [ ] Keep edits small and aligned with current architecture language.
- [ ] Commit docs in isolation.

## Phase 1: Hermes Runtime Contract In Paperclip

### Task 1.1: Audit the current `hermes_local` adapter surface

**Objective:** Understand exactly what already works before expanding runtime targets.

**Files:**
- Modify: likely new plan/docs only
- Inspect: current adapter registration and Hermes adapter dependency

- [ ] Inventory the current `hermes_local` capabilities: startup, session resume, env injection, logs, output parsing, model support.
- [ ] Document gaps between current `hermes_local` and the target fleet contract.
- [ ] Produce a concrete delta list for `hermes_container` / runner-backed execution.
- [ ] Commit documentation or planning notes if repo changes are needed.

### Task 1.2: Define the Hermes runtime bundle contract

**Objective:** Specify what Paperclip materializes for a Hermes worker run.

**Files:**
- Modify: `doc/spec/agent-runtime-surface.md`
- Create if needed: runtime-bundle contract doc or shared type placeholders

The Hermes bundle must define at minimum:
- issue/task context
- project context
- company context
- runtime rules / policies / evidence requirements
- recall packet
- allowed tool/toolset policy
- workspace binding
- output/artifact contract

- [ ] Write the Hermes-specific projection rules.
- [ ] Define canonical file locations in the workspace.
- [ ] Define which values are files vs env vars vs API lookups.
- [ ] Commit docs in isolation.

## Phase 2: Runner Plane For Dockerized Hermes Workers

### Task 2.1: Decide and codify the execution boundary

**Objective:** Formalize how Dockerized Paperclip launches isolated worker containers.

**Files:**
- Modify: `doc/spec/hermes-fleet-control-plane.md`
- Create: runner-plane plan doc if needed
- Later code targets: server runner services and deployment files

Default decision to implement unless contradicted by testing:
- prefer sibling worker containers managed through a runner service or Docker API
- do not use classic DinD as the default architecture

- [ ] Document the default runner-plane approach.
- [ ] Define the minimum env/secrets/network contract.
- [ ] Define the host paths/volumes for workspaces, artifacts, and per-agent Hermes homes.
- [ ] Define security tradeoffs of Docker socket access vs remote runner service.

### Task 2.2: Map container topology for Ubuntu production

**Objective:** Produce the production deployment map from forks to always-on infrastructure.

**Files:**
- Create or modify: deployment docs and compose plans

Required topology map:
- Paperclip app container
- PostgreSQL container
- optional Redis/object storage
- runner service container or Docker API access arrangement
- Hermes worker image built from the Hermes fork
- persistent volumes for each worker profile
- repo/workspace mounts for each project

- [ ] Define named services and networks.
- [ ] Define persistent volume boundaries.
- [ ] Define how project repos are mounted or hydrated on the host.
- [ ] Define how the Ubuntu server and MacBook roles differ.

## Phase 3: Shared Context, Memory, Skills, And Tools

### Task 3.1: Define shared-context publication flow

**Objective:** Ensure workers collaborate through Paperclip-managed state rather than pooled local memory.

**Files:**
- Modify: specs/plans first
- Later likely db/shared/server changes

Minimum contract:
- local Hermes memory stays private
- publishable findings become Paperclip-scoped structured knowledge
- other workers consume recall packets or issue-linked context assembled by Paperclip

- [ ] Define publication events and data fields.
- [ ] Define who can read what by company/project/role scope.
- [ ] Define provenance and freshness expectations.
- [ ] Define when publication is automatic vs approval-gated.

### Task 3.2: Define shared skills vs local skills

**Objective:** Prevent uncontrolled cross-contamination while still allowing reuse.

- [ ] Define company/project-scoped skill projection in runtime bundles.
- [ ] Define local-only Hermes skill directories.
- [ ] Define proposed skill publication and approval flow.
- [ ] Define how toolsets and MCP bindings are projected to workers per role.

## Phase 4: Paperclip Functional Dogfooding Loop

### Task 4.1: Baseline current Paperclip flows in Docker

**Objective:** Treat Paperclip itself as the first managed product and validate assumptions in the real UI.

**Files:**
- Possibly create/update: dogfood report under `doc/plans/` or `doc/testing/`

Minimum flows to test repeatedly as the architecture evolves:
- auth/login
- onboarding
- company creation
- agent creation/editing
- project workspace configuration
- issue creation and assignment
- run/log inspection
- approvals and budgets where affected

- [ ] Start Paperclip in Docker locally.
- [ ] Browser-test the core flows.
- [ ] Capture issues with screenshots/console evidence.
- [ ] Feed findings back into implementation slices before building deeper runtime features.

### Task 4.2: Add browser validation expectations to every runtime-affecting slice

- [ ] For each slice, define what exact UI flows must be checked.
- [ ] Record expected results and failure evidence.
- [ ] Do not mark runtime-facing work done without browser validation.

## Phase 5: Delivery Slices

Implement in this order.

### Slice A: docs + architecture contract only

**Outcome:** repo contains the explicit Hermes fleet architecture and runner-plane plan.

Validation:
- docs reviewed for consistency with current specs
- no code changes yet

### Slice B: current Hermes adapter audit + Paperclip dogfood report

**Outcome:** clear view of what exists today, what is broken, and what must change first.

Validation:
- current Docker app runs
- browser QA notes captured
- current Hermes adapter capabilities documented

### Slice C: Hermes runtime-bundle and env contract

**Outcome:** Paperclip can describe exactly what a Hermes worker receives.

Validation:
- type tests / unit tests for bundle assembly
- browser check for any new agent-config UI

### Slice D: runner-plane contract and Docker topology

**Outcome:** Paperclip can target isolated Hermes worker containers in a documented, production-oriented way.

Validation:
- Docker integration tests or smoke checks
- at least one worker launch path proven locally

### Slice E: structured shared-context publication flow

**Outcome:** workers can share useful findings through Paperclip-governed state.

Validation:
- API/service tests
- issue/run UI inspection
- browser check of evidence/context surfaces

### Slice F: end-to-end Paperclip-managed Hermes issue flow

**Outcome:** one real issue goes through Paperclip into a Hermes worker, produces artifacts/logs/results, and is reviewable in the UI.

Validation:
- tests
- Docker/runtime smoke
- browser dogfood
- documented evidence bundle

## Validation Commands

Before claiming a code slice is complete, run as relevant:

```bash
pnpm -r typecheck
pnpm test:run
pnpm build
```

For Dockerized Paperclip validation:

```bash
make run
make bootstrap-ceo
```

For browser validation:
- use Hermes/browser tools to navigate the real Paperclip UI
- check console errors after navigation and key interactions
- capture screenshots for regressions/blockers

## Risks And Tradeoffs

1. Docker socket access from a containerized Paperclip app is powerful and convenient but increases host-level risk.
2. A dedicated runner service is cleaner but adds implementation complexity.
3. Mixing hidden Hermes memory with Paperclip shared state will create auditability problems if not kept strict.
4. The current Paperclip architecture is still evolving; integration should build on existing runtime/workspace abstractions rather than bypass them.
5. Browser verification will slow delivery slightly, but skipping it will produce blind spots in a control-plane product.

## Immediate Next Steps

1. Keep the new Hermes fleet spec in repo.
2. Perform a focused audit of the existing `hermes_local` adapter and document the gaps.
3. Produce a small browser dogfood report covering login/onboarding/company creation/agent creation in the current Dockerized Paperclip stack.
4. Convert the runner-plane decision into concrete implementation slices before touching broad server code.

## Recommended Commit Strategy

1. `docs: add hermes fleet control plane spec`
2. `docs: cross-link hermes runtime architecture`
3. `docs: add hermes adapter audit and dogfood findings`
4. `feat: add hermes runtime bundle contract`
5. `feat: add runner plane contract and launch plumbing`
6. `feat: add structured shared context publication for hermes workers`
7. `feat: add end-to-end hermes worker issue flow`

## Definition Of Done For This Program

This architecture initiative reaches its first real milestone only when:
- Paperclip runs in Docker
- Paperclip configures at least one Hermes worker cleanly
- the Hermes worker runs in an isolated container/workspace
- shared context is passed through Paperclip rather than pooled memory
- a real issue can be assigned, executed, reviewed, and evidenced through the Paperclip UI
- the affected UI flow is browser-tested and documented