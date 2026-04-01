# Per-Agent Container Runtime v1 Implementation Plan

> For Hermes: plan only. Do not implement from this document in the same turn. Execute later as disciplined narrow slices with tests, live validation, and frequent commits.

Goal: deliver v1 per-agent containerized execution for Hermes, Codex, and Cursor, with Paperclip-managed runtime freshness, native-home managed-skill projection, auto-imported pending-review skills, and dual memory persistence.

Architecture: reuse the existing project codebase configuration plus isolated-workspaces system for selecting the checkout/worktree that comes from the project's repo/local-folder configuration, but move Hermes/Codex/Cursor onto a generic per-agent container runtime plane. Persist company-shared canonical state under the Paperclip instance root, persist adapter-native homes per agent, and make runtime files plus native-home projection complementary rather than competing mechanisms.

Tech stack: Paperclip server runtime services, workspace-runtime + runner-plane, Hermes container code as seed implementation, Docker bind mounts, adapter-native skill injection helpers, managed-skills service, instance settings / execution workspace policy, existing dogfood company for validation.

---

## Success criteria

v1 is complete when all of the following are true:

1. Hermes, Codex, and Cursor all run through Paperclip-managed containers.
2. Paperclip manages runtime/binary freshness for Hermes, Codex, and Cursor for new runs.
3. Each of those adapters gets a persistent native home volume per company+agent.
4. When a project has a configured codebase repo/local folder, the selected execution workspace for that project is mounted into the agent container for applicable runs.
5. Managed skills are projected into native adapter skill homes inside containers.
6. Live validation proves native-home availability directly, not only `.paperclip/runtime` visibility.
7. New agent-authored skills are auto-imported into company managed skills as `pending_review` (or equivalent inactive status).
8. Native agent memory persists across runs when the adapter has it.
9. Paperclip company memory also persists and is projected into runs.
10. Isolated workspace selection composes cleanly with container execution.
11. Heartbeat/runtime observability clearly shows container/runtime/home/skill projection state.

---

## Ground rules for execution

1. One narrow slice per commit.
2. No broad dirty tree accumulation.
3. Every slice gets focused tests before moving on.
4. Externally visible slices must also get live validation.
5. Do not mix architecture refactors with product behavior changes unless required for the slice.
6. Preserve existing Hermes behavior while generic abstractions are introduced.

---

## Slice 1: Runtime/cache path contract for company + agent persistence

Objective: add the path helpers that every later slice depends on.

Files:
- Modify: `server/src/home-paths.ts`
- Add/update tests near path helpers if present

Add helpers for:
- `resolveCompanySharedRuntimeRoot(companyId)`
- `resolveCompanySharedSkillsRoot(companyId)`
- `resolveCompanySharedContextRoot(companyId)`
- `resolveCompanySharedMemoryRoot(companyId)`
- `resolveCompanySharedArtifactsRoot(companyId)`
- `resolveAgentRuntimeHomeRoot(companyId, agentId, adapterType)`
- `resolveAdapterRuntimeCacheRoot(adapterType)`
- `resolveAdapterRuntimeChannelRoot(adapterType, channel)`
- `resolveAdapterRuntimeChannelMetadataPath(adapterType, channel)`

Step 1: write failing tests for sanitized company/agent/adapter paths.

Step 2: implement minimal helpers.

Step 3: run focused tests.

Step 4: commit.

Suggested commit message:
- `feat: add company and agent runtime path helpers`

Validation:
- focused unit tests only

---

## Immediate priority slice: unblock Codex auth bootstrap and Cursor workspace mounting

Objective: fix the current live blocker before continuing deeper runtime generalization. Codex agent containers must inherit usable auth through a Paperclip-managed bootstrap path, and Cursor agent containers must receive a valid existing workspace mount/path instead of an empty or malformed host path.

Why this is inserted before Slice 2:
- this is a live blocking runtime failure, not a future architecture improvement
- Codex currently reaches the OpenAI Responses/WebSocket endpoints without valid auth in containerized runs
- Cursor currently receives a non-existent workspace path like `[]/instances/default/workspaces/...`
- the user explicitly wants live blocking runtime failures prioritized over the planned slice queue

Files likely involved:
- Modify: `server/src/services/codex-runtime.ts`
- Modify: `packages/adapters/codex-local/src/server/execute.ts`
- Modify: `packages/adapters/codex-local/src/server/codex-home.ts`
- Modify: `server/src/services/agent-container-plan.ts`
- Modify: `server/src/services/agent-container-profiles.ts`
- Modify: `server/src/services/runner-plane.ts`
- Modify: `server/src/services/workspace-runtime.ts`
- Modify: `packages/adapters/cursor-local/src/server/execute.ts`
- Modify: Docker/local runtime wiring if needed (`docker-compose.yml`, container launcher glue)
- Add/update focused tests around Codex auth/bootstrap and Cursor workspace-path resolution/remapping

Required outcomes:
- Codex container runs get a deterministic Paperclip-managed auth/bootstrap source that is visible inside the container and copied/symlinked into the effective native Codex home before execution
- The Codex auth contract is explicit enough to support web/device auth through Paperclip-managed state rather than depending on ad hoc host-only login state
- Codex live retries must no longer degrade into `401 Unauthorized: Missing bearer or basic authentication in header` when a properly bootstrapped container starts
- Cursor container launch plans and adapter execution must agree on a valid workspace host path and container path
- Cursor must fail only when the source workspace truly does not exist, not because the path was malformed/empty during planning or env rewriting
- Heartbeat/runtime observability should make both the auth source and workspace mount resolution inspectable

Step 1: write or tighten failing regression tests for:
- Codex shared-home/auth bootstrap propagation into containerized/native-home execution
- Cursor workspace host-path to container-path remapping, especially empty-prefix / malformed-path cases

Step 2: inspect current live path/auth flow and fix the narrowest root causes:
- for Codex, verify what auth/config files or env are actually required by the CLI in containerized mode and ensure Paperclip materializes them into the runtime/native home contract
- for Cursor, verify where the malformed workspace path is being constructed and fix it at the planning/source layer rather than in a downstream symptom handler

Step 3: run focused tests.

Step 4: run live validation in the local Paperclip dogfood environment:
- prove a Codex containerized run starts with valid auth/bootstrap state
- prove a Cursor containerized run receives a real existing mounted workspace path

Step 5: commit immediately once validated.

Suggested commit message:
- `fix: unblock codex auth bootstrap and cursor workspace mounts`

Validation:
- focused vitest targets for Codex runtime/container/home wiring and Cursor workspace path resolution
- local live Paperclip validation for one Codex run and one Cursor run
- browser/e2e validation if any user-facing runtime details change

---

## Immediate follow-up slice: agent-container naming, cleanup visibility, and orphan reconciliation

Objective: fix the misleading legacy container naming and make ephemeral agent-container cleanup trustworthy/inspectable.

Why this is elevated ahead of Slice 2:
- live validation showed Codex/Cursor agent containers are being launched through the generic `agent_container` path but still named with the legacy `paperclip-hermes-*` prefix
- multiple finished/failed runs left Docker containers running even though `workspace_runtime_services` rows were already marked `stopped`
- cleanup failures are currently too easy to miss because container deletion errors are swallowed during stop/release flow
- this creates operator confusion, local Docker pollution, and weakens confidence in the per-agent runtime plane before further generalization work

Files likely involved:
- Modify: `server/src/services/hermes-container-launcher.ts`
- Modify: `server/src/services/workspace-runtime.ts`
- Modify: `server/src/index.ts`
- Add/update focused tests around container naming, cleanup failure handling, and persisted-runtime startup reconciliation

Required outcomes:
- generic agent-container runs use a neutral/container-appropriate name prefix instead of `paperclip-hermes-*`
- Hermes-specific runs remain distinguishable if still using the Hermes-specific provider path
- when Docker container removal fails, Paperclip logs/persists enough signal that the runtime service is not silently treated as cleanly removed
- startup reconciliation reaps or force-stops orphaned/stale labeled Paperclip agent containers from previously finished runs/server crashes
- local operators can clearly distinguish active containers from stale leftovers in Docker

Step 1: tighten or add failing regression tests for:
- naming of `agent_container` vs `hermes_container` launches
- cleanup/remove failure visibility in runtime-service stop flow
- startup reconciliation of stale/orphaned persisted container runtime services

Step 2: implement the narrowest root-cause fixes:
- split container naming by provider/plan type instead of reusing the legacy Hermes-only prefix everywhere
- stop swallowing Docker remove failures silently; surface them in logs and runtime-service state transitions
- extend startup reconciliation or explicit reaper logic to remove stale labeled Paperclip agent containers associated with stopped/finished runtime services

Step 3: run focused tests.

Step 4: run local Docker validation:
- trigger at least one fresh generic agent-container run
- confirm the new container naming is correct
- confirm finished runs do not leave orphan containers behind

Step 5: commit immediately once validated.

Suggested commit message:
- `fix: reconcile agent container naming and cleanup`

Validation:
- focused vitest targets for workspace-runtime and container-launcher behavior
- local Docker inspection before/after a finished run
- browser/e2e only if any user-facing runtime observability text changes

---

## Immediate follow-up slice: fallback workspace hygiene and Cursor runtime note clarity

Objective: keep containerized heartbeat runs autonomous without letting fallback workspaces become persistent garbage magnets or misleading the agent about what environment/workspace it is operating in.

Why this comes before Slice 2:
- live Cursor validation showed the agent was running in a fallback non-project workspace and treated it like a real repo, creating `package.json`, `package-lock.json`, `tsconfig.json`, and `node_modules`
- those edits persisted in the Paperclip instance workspace mount, so the sandbox boundary limited blast radius but did not prevent cross-run contamination of the fallback workspace
- the current runtime note advertises `PAPERCLIP_*` variables but does not clearly distinguish scratch fallback workspaces from real project workspaces, which encourages self-repair/bootstrap behavior instead of issue work
- the user wants container isolation, not heavy-handed heartbeat lockdown, so the right near-term fix is better sandbox hygiene and clearer runtime context rather than broad command bans

Files likely involved:
- Modify: `server/src/services/heartbeat.ts`
- Modify: `server/src/home-paths.ts`
- Modify: `packages/adapters/cursor-local/src/server/execute.ts`
- Add/update focused tests around fallback workspace reset behavior and Cursor runtime note rendering

Required outcomes:
- fallback agent workspaces are treated as scratch execution sandboxes, not durable pseudo-repos
- fresh fallback runs start from a clean workspace baseline so cancelled/rogue prior runs do not poison later runs
- fallback workspace state that should persist lives in the agent native home, not in arbitrary repo-like files under `/workspace`
- Cursor's injected runtime note explicitly calls out when `/workspace` is a fallback scratch workspace and tells the agent not to bootstrap package managers or invent repo scaffolding unless the task explicitly requires it
- the fix remains compatible with container autonomy; it should reduce accidental workspace damage without hard-blocking legitimate task commands inside a real project workspace

Step 1: add or tighten failing regression tests for:
- fallback workspace reset/scrub behavior for fresh runs without a project/prior-session workspace
- fallback workspace session migration semantics that must still work when a real project workspace later becomes available
- Cursor runtime note text for fallback scratch workspaces

Step 2: implement the narrowest root-cause fixes:
- reset or scrub fallback workspace contents at the start of fresh fallback runs
- preserve the existing fallback path contract needed for session migration where appropriate
- enrich the Cursor runtime note using `PAPERCLIP_WORKSPACE_SOURCE` / related context so the agent knows when it is in a scratch fallback workspace rather than a project checkout

Step 3: run focused tests.

Step 4: run local validation:
- confirm a fresh fallback workspace no longer inherits prior accidental package-manager scaffolding
- confirm the injected Cursor prompt/runtime note clearly marks scratch fallback mode

Step 5: commit immediately once validated.

Suggested commit message:
- `fix: reset fallback workspaces and clarify cursor scratch mode`

Validation:
- focused vitest targets for heartbeat workspace handling and Cursor execute/runtime-note behavior
- local filesystem validation of the fallback workspace before/after a fresh run

---

## Slice 2: Generalize Hermes managed-runtime service into adapter-managed runtime service

Objective: create a generic runtime freshness abstraction without breaking Hermes.

Files:
- Add: `server/src/services/agent-managed-runtime.ts`
- Modify: `server/src/services/hermes-runtime.ts`
- Modify: `server/src/home-paths.ts`
- Modify shared types if needed in `packages/shared`
- Add tests:
  - `server/src/__tests__/agent-managed-runtime.test.ts`
  - update `server/src/__tests__/hermes-runtime.test.ts`

Design:
- preserve Hermes runtime management behavior as the first supported adapter profile
- add adapter-aware runtime channel metadata
- shape returned resolution like:
  - command path
  - runtime root
  - version
  - channel
  - provider/source
  - adapter type

For v1:
- Hermes runtime freshness is real/managed
- Codex/Cursor can initially use the same generic service shape even if install/update internals differ per adapter
- the abstraction must support future adapter-specific install logic

Step 1: write failing generic managed-runtime tests using fake installers.

Step 2: extract shared resolution interface from Hermes-specific logic.

Step 3: wire Hermes to the generic managed-runtime service.

Step 4: run tests.

Step 5: commit.

Suggested commit message:
- `refactor: introduce generic adapter managed runtime service`

Validation:
- `pnpm exec vitest run src/__tests__/agent-managed-runtime.test.ts src/__tests__/hermes-runtime.test.ts --config vitest.config.ts`

---

## Slice 3: Adapter container profile registry

Objective: replace Hermes-only container assumptions with a reusable adapter container profile model.

Files:
- Add: `server/src/services/agent-container-profiles.ts`
- Add: `server/src/services/agent-container-plan.ts`
- Modify: `server/src/services/hermes-container-plan.ts`
- Modify: `server/src/services/runner-plane.ts`
- Modify shared plan types in `packages/shared/src/types/...`
- Add tests:
  - `server/src/__tests__/agent-container-plan.test.ts`
  - update `server/src/__tests__/hermes-container-plan.test.ts`

Profile fields should include:
- adapterType
- image
- default command/entrypoint
- container workdir
- native home path
- native skills path
- runtime cache mount requirements
- browser/service capabilities
- env rewriting rules

Step 1: write failing tests that define Hermes/Codex/Cursor profiles.

Step 2: implement profile registry and generic plan builder.

Step 3: keep Hermes plan output compatible via adapter profile.

Step 4: run tests.

Step 5: commit.

Suggested commit message:
- `refactor: add generic agent container profile registry`

Validation:
- `pnpm exec vitest run src/__tests__/agent-container-plan.test.ts src/__tests__/hermes-container-plan.test.ts --config vitest.config.ts`

---

## Slice 4: Generic container launcher integration in workspace runtime

Objective: have the runtime-service plane launch generic adapter containers, not just Hermes containers.

Files:
- Modify: `server/src/services/workspace-runtime.ts`
- Modify: `server/src/services/runner-plane.ts`
- Modify: Hermes launcher integration files if needed
- Add tests around runtime service registration and provider detection

Behavior:
- runtime service provider becomes generic container-capable
- runner snapshot should reflect containerized adapter runs
- existing Hermes container runtime service path remains valid

Step 1: write failing tests for generic container runtime-service registration.

Step 2: implement generic provider plumbing.

Step 3: preserve Hermes compatibility.

Step 4: run tests.

Step 5: commit.

Suggested commit message:
- `refactor: route adapter containers through generic runtime service plane`

Validation:
- focused runtime-service tests
- build if shared types changed

---

## Slice 5: Native-home projection contract for managed skills

Objective: make native-home skill projection an explicit invariant for Hermes/Codex/Cursor.

Files:
- Modify: `server/src/services/hermes-runtime.ts`
- Modify: `packages/adapters/codex-local/src/server/execute.ts`
- Modify: `packages/adapters/cursor-local/src/server/execute.ts`
- Possibly add shared helper utilities in `packages/adapter-utils/src/server-utils.ts`
- Tests:
  - `server/src/__tests__/hermes-runtime.test.ts`
  - `server/src/__tests__/codex-local-skill-injection.test.ts`
  - `server/src/__tests__/cursor-local-skill-injection.test.ts`

Required outcomes:
- native-home paths are explicitly known per adapter
- skill sync/link logic consumes canonical Paperclip materialized skills dir
- test assertions prove the projected target is the native home, not just runtime dir visibility

Step 1: strengthen failing tests around native-home projection.

Step 2: implement any cleanup needed in projection helpers.

Step 3: run tests.

Step 4: commit.

Suggested commit message:
- `test: lock native skill home projection for container adapters`

Validation:
- focused tests only

---

## Slice 6: Hermes on generic container/runtime abstraction

Objective: migrate Hermes fully onto the generic abstractions while preserving current behavior.

Files:
- Modify: `server/src/services/hermes-container-plan.ts`
- Modify: `server/src/services/hermes-container-execution.ts`
- Modify: `server/src/services/hermes-runtime.ts`
- Modify any launcher glue needed
- Tests:
  - `server/src/__tests__/hermes-container-plan.test.ts`
  - `server/src/__tests__/hermes-container-launcher.test.ts`
  - `server/src/__tests__/hermes-runtime.test.ts`

Behavior:
- Hermes container plan comes from generic adapter profile path
- Hermes still mounts:
  - execution workspace
  - managed HERMES_HOME
  - runtime bundle
  - shared auth source
  - managed runtime cache
- Hermes managed runtime freshness remains intact

Step 1: refactor with failing tests first.

Step 2: run focused test suite.

Step 3: run build if needed.

Step 4: commit.

Suggested commit message:
- `refactor: migrate hermes to generic agent container runtime`

Validation:
- focused tests
- optionally one live Hermes environment test if low-cost

---

## Slice 7: Codex managed runtime freshness + container profile

Objective: add Paperclip-managed runtime freshness and containerized execution for Codex.

Files:
- Codex adapter/runtime files
- generic managed-runtime service
- generic container profile registry
- runtime service integration
- tests:
  - Codex runtime freshness tests
  - Codex container profile tests
  - Codex native-home projection tests

Behavior:
- Codex new runs use Paperclip-managed runtime path instead of image-baked-only assumption
- Codex gets stable native home mount
- managed skills projected into native Codex skills home

Step 1: write failing tests around Codex managed runtime resolution.

Step 2: implement minimal Codex runtime profile.

Step 3: run focused tests.

Step 4: commit.

Suggested commit message:
- `feat: add codex managed runtime and container profile`

Validation:
- focused tests
- build if shared types changed

---

## Slice 8: Cursor managed runtime freshness + container profile

Objective: add Paperclip-managed runtime freshness and containerized execution for Cursor.

Files:
- Cursor adapter/runtime files
- generic managed-runtime service
- generic container profile registry
- runtime service integration
- tests:
  - Cursor runtime freshness tests
  - Cursor container profile tests
  - Cursor native-home projection tests

Behavior:
- Cursor new runs use Paperclip-managed runtime path
- Cursor gets stable native home mount
- managed skills projected into `~/.cursor/skills` equivalent inside container

Step 1: write failing tests.

Step 2: implement minimal Cursor runtime profile.

Step 3: run focused tests.

Step 4: commit.

Suggested commit message:
- `feat: add cursor managed runtime and container profile`

Validation:
- focused tests
- build if shared types changed

---

## Slice 9: Project codebase/workspace selection + container runtime policy integration

Objective: cleanly compose project codebase selection, workspace isolation, and per-agent containers.

Files:
- `server/src/services/execution-workspace-policy.ts`
- `server/src/services/heartbeat.ts`
- `server/src/services/workspace-runtime.ts`
- project/workspace services tied to codebase selection if needed
- optional shared types/settings files
- tests around planner/worker workspace selection

Behavior:
- project codebase configuration (`repo` + `local folder` / Paperclip-managed folder) remains the source of truth for the repo a run should use
- workspace selection remains policy-driven on top of that source project codebase
- selected execution workspace is mounted into the chosen adapter container
- containerization is not hidden inside isolated-workspaces alone
- add a separate experimental/runtime flag if needed

Step 1: write failing tests for policy composition.

Step 2: implement minimal integration.

Step 3: run tests.

Step 4: commit.

Suggested commit message:
- `feat: compose isolated workspaces with agent containers`

Validation:
- focused service tests
- browser/UI check if settings surface changes

---

## Slice 10: Pending-review auto-import for agent-authored skills

Objective: when an agent creates a native skill, Paperclip auto-imports it as a non-active managed skill.

Files:
- `server/src/services/managed-skills.ts`
- add new native-home scan/import service, e.g. `server/src/services/agent-native-skill-imports.ts`
- routes/UI for managed skills status if needed
- `ui/src/pages/ManagedSkills.tsx` or related UI files
- tests for import detection and status behavior

Behavior:
- detect newly-authored native skills after run completion
- auto-import to managed skills with status `pending_review` (or chosen equivalent)
- store provenance:
  - companyId
  - agentId
  - runId
  - source path
  - importedAt
- do not include pending-review skills in active live projection until approved

Step 1: write failing service tests.

Step 2: implement import service.

Step 3: expose pending-review status in existing Managed Skills UI.

Step 4: run tests.

Step 5: commit.

Suggested commit message:
- `feat: auto-import agent skills as pending review`

Validation:
- focused tests
- UI validation via browser

---

## Slice 11: Dual memory persistence and supported ingest

Objective: preserve both native adapter memory and Paperclip company memory.

Files:
- add service such as `server/src/services/agent-native-memory.ts`
- shared-context/memory integration files
- heartbeat/run-finalization hooks
- tests for persistence and import behavior

Behavior for v1:
- native agent home memory persists because native homes persist
- Paperclip company memory persists in company-shared storage/DB path
- add adapter-aware ingest for only clearly-structured supported memory artifacts
- preserve unsupported native memory raw in the agent home without data loss

Step 1: write failing tests for native-home persistence and Paperclip memory ingest.

Step 2: implement minimal supported ingest path.

Step 3: run tests.

Step 4: commit.

Suggested commit message:
- `feat: persist native and paperclip memory across container runs`

Validation:
- focused tests
- likely one live Hermes memory persistence proof first

---

## Slice 12: Heartbeat and runtime observability upgrades

Objective: make the new runtime model inspectable and trustworthy.

Files:
- `server/src/services/heartbeat.ts`
- runtime service reporting/UI files
- possibly instance settings/heartbeats UI
- tests around serialization/read model output

Expose at minimum:
- adapter container profile
- runtime channel/version
- execution workspace mode
- native home root
- native skills projection result
- company shared state root
- runtime service/container ID
- heartbeat timestamp consistency

Also include the existing known follow-up:
- fix/reconcile `heartbeat.invoked` vs `agents.lastHeartbeatAt`

Step 1: write failing observability tests.

Step 2: implement model/reporting updates.

Step 3: run tests.

Step 4: commit.

Suggested commit message:
- `feat: improve container runtime and heartbeat observability`

Validation:
- focused tests
- browser/UI spot check if surfaced there

---

## Slice 13: Live Hermes native-home proof

Objective: prove Hermes uses projected native-home managed skills in the containerized model.

Live validation steps:
1. create narrow validation issue assigned to Hermes
2. require exact sentinel output
3. ensure run evidence includes native HERMES_HOME skill path
4. confirm runtime finishes cleanly

Artifacts to capture:
- issue comment
- run ID
- runtime service/container record
- native-home path evidence

Commit:
- docs/evidence only if repo-tracked evidence is desired

---

## Slice 14: Live Codex native-home proof

Objective: prove Codex uses projected native-home managed skills in the containerized model.

Validation same pattern as Hermes, but require evidence from Codex native skills home path.

---

## Slice 15: Live Cursor native-home proof

Objective: prove Cursor uses projected native-home managed skills in the containerized model.

Validation same pattern as Hermes/Codex, but require evidence from Cursor native skills home path.

---

## Slice 16: Live pending-review skill import + memory persistence proof

Objective: prove the new persistence loops work end-to-end.

Validation tasks:
1. have a target agent author a new native skill
2. verify Paperclip auto-imports it into Managed Skills as `pending_review`
3. approve it
4. verify it becomes active and projectable on a later run
5. have an agent write/update supported native memory
6. verify:
   - native memory persists in the native home
   - imported Paperclip memory is queryable/visible where expected

---

## Cross-slice validation commands

Use as appropriate per slice:
- `pnpm exec vitest run src/__tests__/hermes-runtime.test.ts --config vitest.config.ts`
- `pnpm exec vitest run src/__tests__/hermes-container-plan.test.ts --config vitest.config.ts`
- `pnpm exec vitest run src/__tests__/hermes-container-launcher.test.ts --config vitest.config.ts`
- `pnpm exec vitest run src/__tests__/agent-managed-runtime.test.ts --config vitest.config.ts`
- `pnpm exec vitest run src/__tests__/agent-container-plan.test.ts --config vitest.config.ts`
- `pnpm exec vitest run src/__tests__/codex-local-skill-injection.test.ts --config vitest.config.ts`
- `pnpm exec vitest run src/__tests__/cursor-local-skill-injection.test.ts --config vitest.config.ts`
- `pnpm build`

And for live validation as needed:
- docker rebuild/restart only for touched services
- browser validation when UI/settings/managed-skills surfaces change

---

## Suggested execution order summary

1. Slice 1: path helpers
2. Slice 2: generic managed runtime service
3. Slice 3: container profile registry
4. Slice 4: generic runtime-service launcher integration
5. Slice 5: native-home projection contract/tests
6. Slice 6: Hermes migration
7. Slice 7: Codex container + runtime freshness
8. Slice 8: Cursor container + runtime freshness
9. Slice 9: isolated workspace integration
10. Slice 10: pending-review skill auto-import
11. Slice 11: dual memory persistence/import
12. Slice 12: observability/heartbeat fixes
13. Slice 13-16: live proofs

---

## Open questions to resolve during execution

1. Runtime channel complexity
- Start with one managed channel per adapter in v1, or expose stable/canary now?
- Recommendation: start with one managed channel per adapter, leave channel expansion for later unless trivial.

2. Supported native-memory ingest formats
- Which Hermes/Codex/Cursor native-memory artifacts are structured enough to import safely in v1?
- Recommendation: Hermes first, add Codex/Cursor only where clearly structured and stable.

3. UI exposure for container runtime policy
- Should it stay experimental/internal at first, or show explicit project/runtime configuration once functional?
- Recommendation: experimental first, then expose more broadly after live validation.

---

## Final note

This plan is intentionally commit-slice oriented. The right way to execute it is not as one large branch-wide rewrite, but as a sequence of validated migrations that keep Hermes working while Codex and Cursor are brought onto the same container/runtime model.
