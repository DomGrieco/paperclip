# Paperclip Governed Swarming Implementation Plan

> For Hermes: use subagent-driven-development to implement this in narrow slices.

Goal: Add governed, budget-aware swarm orchestration to Paperclip so planners can fan out bounded worker subtasks to cheaper/faster models and reserve stronger models for review, verification, and synthesis.

Architecture: Extend the existing planner/worker/verification run graph into a typed swarm controller. Planner runs emit structured swarm plans, Paperclip materializes worker child runs in isolated workspaces with model-tier routing, reviewers/verifiers adjudicate outputs, and the planner/root closes the loop with synthesis plus repair routing.

Tech Stack: existing heartbeat_runs / issue-run-graph orchestration, execution workspaces, runtime bundles, activity log, adapter config overrides, UI run graph views.

---

## Design principles

1. Governed fan-out, not free-form recursive spawning.
2. Typed subtasks with explicit scope, artifact contract, and acceptance checks.
3. Workspace isolation or explicit path ownership.
4. Budget-aware model routing.
5. Reviewer/verifier gates before acceptance.
6. Frequent commits and narrow slices.

## External research learnings to apply

Based on Cursor's "Scaling long-running autonomous coding" and "Towards self-driving codebases":

1. Avoid flat peer swarms.
- The flat self-coordination approach created lock contention, bottlenecks, brittle coordination, and risk-averse behavior.
- Paperclip should prefer hierarchy: planner/root -> workers -> reviewers/verifiers.

2. Prioritize observability early.
- Their harness invested heavily in timestamps, action logs, and replayable traces before scaling up.
- Paperclip should treat swarm observability as a first-class requirement, not a later UI nicety.

3. Planning must itself be dynamic.
- Large projects cannot rely on one up-front rigid decomposition.
- Paperclip planners should be able to refresh and refine swarm plans over time instead of freezing the whole dependency graph at the start.

4. Workers should not carry the whole project in their heads.
- Cursor's separation of planners and workers improved throughput because workers could grind on assigned slices without coordinating with peers or carrying the big picture.
- Paperclip should keep worker prompts narrow and bounded.

5. Synchronization overhead is a real enemy.
- Shared mutable coordination state can erase the benefits of parallelism.
- Paperclip should minimize cross-worker synchronization and prefer immutable task packets plus reviewer/planner reconciliation.

6. Freshness matters.
- Their article explicitly treats freshness/pathological behavior as a design concern.
- Paperclip should keep strong runtime-bundle freshness, workspace freshness, and task validity checks in the swarm loop.

7. Commit correctness matters.
- Parallel throughput only matters if the resulting commits/artifacts are coherent.
- Paperclip should require reviewer/verifier acceptance before work is considered merged/complete.

8. Intent specification matters.
- Better instruction-following models performed better in long-running setups because intent was specified more precisely.
- Paperclip should use structured subtask contracts instead of relying on prose-only delegation.

---

## Target architecture

### New concepts

1. Swarm plan
- Produced by planner/root.
- Contains typed subtask objects.
- Stored on planner run and surfaced in UI/runtime bundle.

2. Swarm child run
- Existing heartbeat run row with additional swarm metadata.
- Usually runType=worker, optionally review/verification specializations.

3. Model tier policy
- Maps task type/risk to model class.
- Cheap models for bounded execution; premium for review/synthesis.

4. Swarm merge/review loop
- Worker outputs -> reviewer decision -> verifier outcome -> planner synthesis.

### Typed subtask shape

Suggested shape:

```ts
interface SwarmSubtask {
  id: string;
  kind: "research" | "implementation" | "verification" | "review";
  title: string;
  goal: string;
  taskKey?: string;
  allowedPaths?: string[];
  forbiddenPaths?: string[];
  expectedArtifacts: Array<{
    kind: "summary" | "patch" | "test_result" | "comment" | "document";
    required: boolean;
  }>;
  acceptanceChecks: string[];
  recommendedModelTier: "cheap" | "balanced" | "premium";
  budgetCents?: number;
  maxRuntimeSec?: number;
  dependsOn?: string[];
}
```

### Suggested persistence additions

Prefer adding swarm metadata to run context/policy first before adding new tables.
Possible later table if needed: `swarm_subtasks`.

## Isolation, worktree, and validation topology

### Worker isolation policy

1. Research/triage workers
- Default: read-only isolated runtime directory.
- No repo mutation privileges required.
- Full git worktree optional.

2. Implementation workers
- Default: dedicated git worktree per child run.
- Each worker receives a bounded task packet plus explicit path scope.
- Workers do not share a mutable dirty tree.

3. Reviewer/verifier workers
- Default: separate clean validation workspace.
- They should inspect structured worker artifacts first, not mutate the worker workspace directly.
- If direct reproduction is needed, materialize the candidate branch/patch into a clean validation workspace.

### Path ownership model

Each subtask should carry:
- `allowedPaths`
- `forbiddenPaths`
- optional ownership mode: `exclusive` | `advisory` | `read_only`

Paperclip should enforce path ownership at two layers:
1. Runtime/prompt contract for the worker.
2. Post-run verification against actual changed files.

### Worker artifact packet

Each swarm child should return a structured packet containing at least:
- summary
- changed files
- patch / branch / worktree reference
- commands run
- test results
- risks / open questions
- confidence
- reviewer handoff notes

### Reviewer and verifier execution model

1. Worker-local validation
- cheap/balanced workers may run narrow, task-local commands in their own isolated worktree.
- Examples: targeted unit tests, lint on touched files, focused build commands.

2. Independent reviewer/verifier validation
- premium reviewer/verifier should rerun validation in a clean environment before acceptance when the task mutates code.
- This prevents false positives caused by contaminated worker state.

3. Browser validation
- Browser validation should be verifier-tier behavior, not default cheap-worker behavior.
- Start with a controlled shared validation environment on the local dev instance, serialized/queued when needed.
- Longer term, evolve toward ephemeral per-run validation environments.

### Merge/integration policy

1. Workers never merge directly into the primary issue workspace.
2. Accepted worker outputs are integrated in a dedicated integration workspace.
3. Integration applies accepted child artifacts in deterministic order.
4. Broader validation runs after integration and before issue completion.

### Rollout constraints

1. Research/triage swarms can launch before worktree-heavy code-writing swarms.
2. Parallel implementation swarms must not ship before per-worker worktree isolation and path ownership checks exist.
3. Premium review + verification must gate completion before any swarm slice is considered done.

---

## Gap analysis against current Paperclip

### Already present

1. Run graph foundation
- `heartbeat_runs` already tracks `runType`, `rootRunId`, `parentRunId`, `graphDepth`, `repairAttempt`, `verificationVerdict`.

2. Planner root creation
- `issue-run-graph.ts:startPlannerRoot()`

3. Worker fan-out primitive
- `issue-run-graph.ts:spawnWorkers()`
- Supports planner-root -> worker-child creation.

4. Verification/repair primitive
- `issue-run-graph.ts:scheduleRepairFromVerification()`
- `heartbeat.ts` already triggers repair routing after verification verdict=repair.

5. Runtime bundle lineage support
- `runtime-bundle.ts` surfaces run graph fields into worker runtime.

6. Evidence/verification model
- `issue-run-evidence.ts` and verification verdict plumbing already exist.

### Missing / incomplete

1. No typed swarm plan contract
- Planner output is not yet persisted as structured subtask definitions.

2. No automatic planner-to-fanout runtime path
- `spawnWorkers()` exists but is not the main live orchestration path driven by planner decomposition.

3. No first-class model tier routing for swarm children
- There is not yet a policy layer that intentionally routes cheap vs premium models by subtask type.

4. No explicit path ownership / merge discipline for swarms
- Existing workspace handling is strong, but swarm-specific file ownership constraints are not yet first-class.

5. No planner synthesis phase as a first-class run step
- Current graph supports planner + workers + verification, but synthesis/aggregation is not clearly modeled as a dedicated orchestration step.

6. No swarm-specific UI
- Run graph lineage exists in data, but not a rich swarm dashboard showing subtask status, budget, dependencies, and reviewer outcomes.

7. No admission control policy for when to swarm
- Paperclip does not yet decide whether a task should stay serial vs fan out.

---

## Recommended rollout

### Slice 1: Typed swarm plan contract
Objective: introduce structured subtask definitions without changing execution behavior.

Files:
- Modify: `packages/shared/src/*` for shared types/validators
- Modify: `server/src/services/runtime-bundle.ts`
- Modify: `server/src/services/issue-run-graph.ts`
- Add tests: `server/src/__tests__/...`

Steps:
1. Add shared `SwarmSubtask` and `SwarmPlan` types/validators.
2. Extend planner run context/policy snapshots to carry an optional swarm plan.
3. Surface swarm plan into runtime bundles/shared context.
4. Add regression tests for serialization and runtime bundle projection.
5. Commit.

### Slice 2: Swarm admission + model-tier policy
Objective: teach Paperclip when to swarm and which model tier to use.

Files:
- Add: `server/src/services/swarm-policy.ts`
- Modify: `server/src/services/heartbeat.ts`
- Modify: `server/src/services/issue-run-graph.ts`
- Tests.

Steps:
1. Define heuristics for `shouldSwarm(issue, plannerOutput, workspaceScope)`.
2. Define model-tier mapping:
   - research/log triage -> cheap
   - isolated implementation -> balanced/cheap
   - review/synthesis/verification -> premium
3. Add tests for policy decisions.
4. Commit.

### Slice 3: Planner-driven fan-out
Objective: connect planner output to actual child worker creation.

Files:
- Modify: `server/src/services/heartbeat.ts`
- Modify: `server/src/services/issue-run-graph.ts`
- Possibly add: `server/src/services/swarm-controller.ts`
- Tests.

Steps:
1. Parse planner-produced structured swarm plan.
2. Materialize child worker runs through `spawnWorkers()`.
3. Persist subtask metadata on child contexts.
4. Ensure child runs inherit root lineage and policy snapshots.
5. Add tests for end-to-end planner -> workers fan-out.
6. Commit.

### Slice 4: Workspace isolation / path ownership
Objective: prevent swarm collisions.

Files:
- Modify: execution workspace resolution/services
- Modify: runtime bundle/shared context
- Tests.

Steps:
1. Add per-subtask allowedPaths/forbiddenPaths to runtime context.
2. Enforce isolated workspaces by default for parallel implementation workers, or explicit path ownership if sharing.
3. Add runtime warnings/errors when workers violate ownership.
4. Add tests for collision prevention.
5. Commit.

### Slice 5: Reviewer/synthesis loop
Objective: add premium reviewer/planner aggregation.

Files:
- Add: reviewer/synthesis orchestration service or extend heartbeat orchestrator.
- Modify: issue-run-evidence and issue-run-graph.
- Tests.

Steps:
1. Add planner synthesis step after worker completion.
2. Add reviewer decisions: accept/reject/request-repair per child.
3. Require structured child outputs.
4. Feed accepted child artifacts into synthesis output.
5. Commit.

### Slice 6: UI observability for swarms
Objective: make swarm state legible.

Files:
- UI run detail / issue detail / agent run views.
- Shared API types.
- Tests/build/browser checks.

Steps:
1. Show planner root + child worker tree.
2. Show subtask kind, model tier, dependencies, budget, status.
3. Show requested/started/completed/reviewed/verified lifecycle.
4. Commit.

---

## Model-tier recommendation

Suggested default tiers:

- Cheap
  - Minimax / Kimi / GLM class
  - Use for: research, triage, summarization, bounded file-local changes, first-pass drafts

- Balanced
  - stronger coding model but not flagship
  - Use for: medium implementation slices, focused bugfixes, test updates

- Premium
  - flagship reasoning model
  - Use for: planning, review, verification adjudication, synthesis, conflict resolution

Rules:
1. Planner root defaults premium.
2. Reviewer/verifier defaults premium.
3. Worker subtasks default cheap/balanced depending on risk and scope.
4. Escalate cheap worker repairs to premium only after bounded retries fail.

---

## Acceptance criteria for governed swarming

1. Planner can emit a structured swarm plan.
2. Paperclip can automatically create parallel worker children from that plan.
3. Each worker has explicit scope, model tier, and workspace/path constraints.
4. Reviewer/verifier can accept, reject, or repair child outputs.
5. Planner/root can synthesize accepted worker outputs into final issue progress.
6. Budgets and run lineage remain visible and enforceable.
7. UI clearly distinguishes planner root, worker children, review, and verification outcomes.

---

## Suggested first implementation target

Start with research/triage swarming, not code-writing swarming.

Reason:
- lower risk
- easiest to parallelize
- easiest to review/synthesize
- validates routing, lineage, budget, and UI before allowing parallel code edits

Example first target:
- planner emits 2-4 evidence-gathering subtasks
- cheap workers inspect logs/files/docs independently
- premium reviewer synthesizes findings
- no merge conflicts yet

---

## Verification commands for each slice

Targeted tests first, then broader builds:
- `pnpm exec vitest run <targeted-tests> --config server/vitest.config.ts`
- `pnpm --filter @paperclipai/server build`
- `pnpm --filter @paperclipai/ui build`
- `pnpm build`

For user-facing swarm UI:
- browser validation against live dev instance on `:3100`

---

## Final recommendation

Paperclip should implement governed swarming.
Not recursive free-form spawning.
Not “every agent can spawn anything.”

The right version is:
- planner-controlled
- typed subtasks
- budget-aware model routing
- isolated workers
- premium review and synthesis
- strong verification gates
