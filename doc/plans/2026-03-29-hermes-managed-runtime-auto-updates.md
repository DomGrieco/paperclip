# Hermes Managed Runtime Auto-Updates Implementation Plan

> For Hermes: use disciplined narrow slices, validate each slice, and keep commits isolated.

Goal: make Paperclip-managed Hermes agents refresh their Hermes CLI/runtime automatically without requiring manual Docker image rebuilds from the operator.

Architecture: introduce a Paperclip-managed Hermes runtime cache under the Paperclip instance root, refresh that runtime on a configurable cadence by installing Hermes into a managed virtualenv, then point both local-host and hermes_container executions at that managed runtime instead of the image-baked `hermes` binary. Surface runtime status in the Hermes adapter environment test so operators can see what Paperclip is doing.

Tech stack: TypeScript, Node child_process/fs, Python venv + pip, existing Hermes runtime prep/container-plan services, Vitest.

---

## Slice 1: Plan and shared path helpers

Objective: define where managed Hermes runtimes live and add path helpers for runtime cache locations.

Files:
- Create: `doc/plans/2026-03-29-hermes-managed-runtime-auto-updates.md`
- Modify: `server/src/home-paths.ts`
- Test: `server/src/__tests__/hermes-managed-runtime.test.ts`

Steps:
1. Add helpers for Paperclip-managed Hermes runtime cache roots under the instance root.
2. Add a runtime test file scaffold that can host later TDD coverage.
3. Commit docs/path scaffolding.

Validation:
- `pnpm exec vitest run src/__tests__/hermes-managed-runtime.test.ts --config vitest.config.ts`

Commit:
- `docs: plan hermes managed runtime auto-updates`

## Slice 2: Managed runtime installer/service

Objective: add a service that installs or refreshes Hermes into a managed virtualenv on a cadence and returns runtime metadata.

Files:
- Create: `server/src/services/hermes-managed-runtime.ts`
- Modify: `server/src/home-paths.ts`
- Test: `server/src/__tests__/hermes-managed-runtime.test.ts`

Steps:
1. Write failing tests for path resolution, stale-vs-fresh refresh decisions, metadata persistence, and hermes command resolution.
2. Implement runtime cache layout:
   - `<paperclip-instance>/runtime-cache/hermes/channels/<channel>/current`
   - metadata json per channel
   - temp dir + atomic rename
3. Implement cadence controls with sensible defaults:
   - auto-update enabled by default
   - stable channel default
   - refresh interval default (for example 6h)
4. Install Hermes into a venv with a managed source string/configurable ref.
5. Return runtime metadata including version, source, channel, checkedAt, updatedAt, command path, and whether a refresh happened.
6. Commit once targeted tests pass.

Validation:
- `pnpm exec vitest run src/__tests__/hermes-managed-runtime.test.ts --config vitest.config.ts`

Commit:
- `feat: add managed hermes runtime updater`

## Slice 3: Wire runtime prep for local-host Hermes execution

Objective: ensure runtime prep resolves a managed Hermes command automatically for Hermes agents before execution.

Files:
- Modify: `server/src/services/hermes-runtime.ts`
- Modify: `server/src/services/heartbeat.ts`
- Modify: `server/src/adapters/registry.ts`
- Test: `server/src/__tests__/hermes-runtime.test.ts`

Steps:
1. Write failing tests that expect `prepareHermesAdapterConfigForExecution()` to inject managed runtime metadata and a managed `hermesCommand` path.
2. Resolve the managed runtime during Hermes config preparation.
3. Preserve explicit operator overrides if they intentionally set `hermesCommand`.
4. Attach runtime metadata into env/config for downstream visibility.
5. Surface managed-runtime status in environment test output.
6. Commit after targeted runtime tests pass.

Validation:
- `pnpm exec vitest run src/__tests__/hermes-runtime.test.ts --config vitest.config.ts`

Commit:
- `feat: use managed hermes runtime for host execution`

## Slice 4: Wire hermes_container execution + launch plan

Objective: make hermes_container runs use the same managed runtime by mounting the runtime cache into launched worker containers and rewriting the command path appropriately.

Files:
- Modify: `server/src/services/hermes-container-plan.ts`
- Modify: `server/src/services/hermes-container-execution.ts`
- Modify: `packages/shared/src/types/orchestration.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `server/src/__tests__/hermes-container-plan.test.ts`

Steps:
1. Write failing tests for launch-plan mounts/env when a managed Hermes runtime is present.
2. Extend the launch plan schema with a managed-runtime mount kind/path.
3. Mount the managed runtime cache read-only into the hermes_container.
4. Rewrite the hermes command path for in-container execution when Paperclip resolved a managed runtime.
5. Commit after plan tests and full build pass.

Validation:
- `pnpm exec vitest run src/__tests__/hermes-container-plan.test.ts --config vitest.config.ts`
- `pnpm build`

Commit:
- `feat: mount managed hermes runtime in worker containers`

## Slice 5: Final validation and operator-facing notes

Objective: verify the full flow and leave the branch PR-ready.

Files:
- Modify: any touched tests/docs only if needed for clarity

Steps:
1. Run targeted Hermes tests together.
2. Run full repo build.
3. Check git status and confirm only intended files changed.
4. Push branch and open PR against the user fork.

Validation:
- `pnpm exec vitest run src/__tests__/hermes-managed-runtime.test.ts src/__tests__/hermes-runtime.test.ts src/__tests__/hermes-container-plan.test.ts --config vitest.config.ts`
- `pnpm build`

PR notes should explain:
- Paperclip now auto-refreshes managed Hermes runtimes on cadence.
- Imported `HERMES_HOME` still manages auth/config only.
- New runs pick up the refreshed runtime automatically.
- Existing runs are not hot-swapped mid-flight.
