# Prompt Guard Follow-up Plan

Status: in progress
Date: 2026-03-29 22:15 local
Updated: 2026-03-29 23:05 local
Repo: /Users/eru/Documents/GitHub/paperclip
Primary skills: systematic-debugging, paperclip-disciplined-slice-delivery

## Goal
Diagnose and fix the remaining Hermes CEO planner timeout/thrash behavior after the auth/runtime and reachable-container-host fixes, with the work documented as a narrow, validated slice.

## Current context
Previously completed and committed:
- 76fa53ba fix: repair hermes container auth/runtime wiring
- 2ed08624 fix: tighten hermes helper prompt and container host wiring

Validated improvements already achieved:
- shared Hermes auth mount is present in server-dev
- hermes_container can reach the Paperclip API with a valid reachable container host
- Codex 401 refresh failure no longer reproduces in the fresh dogfood run path
- helper-base prompt no longer teaches the incorrect extra `/api` base behavior
- the worst wakeup-loop / broad-probe behavior was materially reduced

Live investigation findings from this slice so far:
- prompt-only tightening helped, but did not reliably constrain behavior
- company skill and company memory also influenced behavior and had to be corrected
- helper-side deny rules removed the worst cases:
  - self-wakeup
  - bare `/api`
  - top-level `/api/runs`
  - issue subresource POSTs other than `/comments`
- despite that, live issue-backed validation runs still improvised invalid helper calls and repeated exploratory attempts instead of converging cleanly

Representative live runs observed in this slice:
- PAP-13: improved, but still produced inaccurate self-reporting about polling
- PAP-15: avoided wakeup/bare discovery, but still guessed issue-subresource POST endpoints before converging
- PAP-16 / run `4c486aa6-428f-491f-b49c-ac4925f36b0e`: still showed helper misuse/thrash despite stronger guards

## Root-cause assessment
Following the systematic-debugging skill, the root cause is now treated as architectural rather than a single wording bug.

What the evidence says:
1. Runtime auth/connectivity is fixed.
2. Prompt wording improvements propagate into the run.
3. Skill/memory guidance changes also propagate.
4. The model still improvises inside assigned validation tasks unless the contract is enforced structurally.

Current root-cause hypothesis:
- assigned validation issues are still being treated as free-form agent tasks
- prose instructions and soft deny rules are insufficient
- the helper needs a run-scoped governed contract, not just a denylist

## Next narrow slice
Implement a governed validation contract for issue-backed Paperclip validation runs.

### Proposed approach
1. Add a structured helper governance mode in `hermes-runtime.ts`.
2. For qualifying issue-backed validation tasks, materialize explicit helper policy env into the runtime:
   - exact allowed endpoint patterns
   - optional exact allowed methods per pattern
   - per-endpoint GET budgets / total call budgets
3. Teach the runtime prompt and container fallback prompt to surface that governed contract explicitly.
4. Add focused tests for policy materialization and helper enforcement.
5. Re-run a fresh dogfood issue to confirm the agent is forced onto the narrow path.

### Qualification strategy for this slice
Keep the scope narrow. For now, activate governed mode only for clearly validation-shaped issue descriptions/title text that request evidence/validation behavior rather than general implementation work.

Initial heuristic target:
- task body/title contains strong validation markers such as `acceptance criteria`, `validate`, `pass/fail evidence`, or explicit endpoint constraints
- task is issue-backed (has `taskId` / `issue.id`)

If that works live, a later slice can replace heuristics with an explicit first-class issue/run policy field.

## Files likely to change
- server/src/services/hermes-runtime.ts
- server/src/services/hermes-container-execution.ts
- server/src/__tests__/hermes-runtime.test.ts
- server/src/__tests__/hermes-container-execution.test.ts
- possibly shared/runtime-bundle types only if needed for a minimal structured policy payload

## Implementation checklist
1. Re-check repo state and isolate this slice from temp/bootstrap artifacts.
2. Add helper policy parsing + enforcement primitives.
3. Add governed validation policy derivation from issue-backed task text.
4. Inject policy env into runtime preparation.
5. Surface policy summary in prompt text.
6. Add regression tests covering:
   - governed mode is derived for validation tasks
   - helper blocks disallowed endpoints
   - helper permits the narrow expected endpoints
7. Run targeted vitest.
8. Run `pnpm build`.
9. Restart/reload server-dev if runtime code changed.
10. Run one fresh CEO dogfood issue in the dedicated Paperclip company.
11. Commit immediately if live behavior is clean.

## Validation plan
### Targeted validation
- `pnpm exec vitest run src/__tests__/hermes-runtime.test.ts --config vitest.config.ts`
- `pnpm exec vitest run src/__tests__/hermes-container-execution.test.ts --config vitest.config.ts`

### Broader validation
- `pnpm build`

### Live validation success criteria
- helper/API access succeeds
- no Codex 401 auth failure
- no `/api/agents/{agentId}/wakeup`
- no bare `/api`
- no top-level `/api/runs`
- no guessed issue-subresource POSTs other than `/comments`
- runtime files read in the governed order first
- materially fewer helper calls because non-allowed calls are blocked up front
- run exits decisively with concise evidence

## Risks / open questions
- heuristic activation may be too broad or too narrow
- helper budgets must not break legitimate general-purpose issue runs
- there may still be residual model thrash on allowed endpoints, which would imply a later move to an explicit server-owned execution recipe

## Done criteria for this slice
- governed validation contract is implemented for qualifying issue-backed validation runs
- regression tests cover the new policy path
- targeted tests pass
- `pnpm build` passes
- fresh live planner-grade validation run follows the governed path cleanly
- slice is committed separately with remaining repo state explicitly reported
