# Managed Skills 25-Slice Execution Plan

> For Hermes: execute in disciplined narrow slices, commit after each validated slice, and keep unrelated dirty files out of commits.

Goal: finish v1 Paperclip-managed scoped skills across runtime projection, Hermes compatibility, backend API, UI, and live cross-agent validation.

Current completed baseline:
- DB schema for managed skills/scopes exists
- managed skill resolution/materialization service exists
- heartbeat projects `paperclipSkillsDir` and effective skill metadata into run context
- Codex, Cursor, Gemini, and Pi runtime injectors can consume a provided materialized skills directory
- focused runtime injection tests exist for managed skill resolution plus Codex/Gemini/Pi injection coverage

Remaining work is decomposed into the following 25 narrow slices.

## Slice 1 — completed
Commit the Pi/Gemini runtime injection follow-up and focused adapter tests.
Commit: `feat: inject managed skills into pi workers`

## Slice 2
Document the remaining managed-skills execution plan in a committed plan file.
Files:
- `docs/plans/2026-03-30-managed-skills-25-slice-execution-plan.md`
Validation:
- plan reviewed against current repo state
Commit:
- `docs: add managed skills 25-slice execution plan`

## Slice 3
Audit live/local adapter execution paths to determine the easiest reproducible proof that Gemini consumes `paperclipSkillsDir` during a real worker run.
Files:
- investigation only
Validation:
- identify concrete agent/run creation path and evidence source
Commit:
- no code unless helper instrumentation is needed

## Slice 4
Run and capture a live/local Gemini managed-skill runtime proof.
Files:
- evidence notes only unless a bug is found
Validation:
- real run shows materialized managed skill available to Gemini path
Commit:
- only if a bugfix is required

## Slice 5
Audit live/local adapter execution paths to determine the easiest reproducible proof that Pi consumes `paperclipSkillsDir` during a real worker run.

## Slice 6
Run and capture a live/local Pi managed-skill runtime proof.

## Slice 7
Audit Hermes runtime pathing and identify the correct projection seam for managed skills.
Files likely:
- `server/src/services/hermes-runtime.ts`
- `server/src/services/hermes-container-execution.ts`
- `server/src/services/runtime-bundle.ts`
Validation:
- written notes on where managed skills should surface for Hermes
Commit:
- only if code changes are needed

## Slice 8
Add a focused failing Hermes runtime test proving managed skill metadata/path is missing from Hermes execution context today.
Files:
- Hermes runtime tests near existing managed runtime coverage
Commit:
- `test: cover hermes managed skill runtime projection`

## Slice 9
Implement Hermes managed-skill projection using the shared effective skill source without introducing Hermes-only skill semantics.
Commit:
- `feat: project managed skills into hermes runs`

## Slice 10
Validate Hermes managed-skill projection with targeted tests plus full `pnpm build`.
Commit:
- if validation required code changes, commit them in the narrow preceding slice only

## Slice 11
Design the v1 managed-skills API contract, including board/admin auth behavior and effective-preview semantics.
Files:
- route/service notes or typed helpers
Commit:
- `docs: define managed skills api contract` if documentation is added

## Slice 12
Implement `GET /api/managed-skills` with route tests.
Commit:
- `feat: add managed skills list route`

## Slice 13
Implement `POST /api/managed-skills` with route tests.
Commit:
- `feat: add managed skills create route`

## Slice 14
Implement `GET /api/managed-skills/:id` with route tests.
Commit:
- `feat: add managed skills detail route`

## Slice 15
Implement `PATCH /api/managed-skills/:id` with route tests.
Commit:
- `feat: add managed skills update route`

## Slice 16
Implement `GET /api/managed-skills/:id/scopes` with route tests.
Commit:
- `feat: add managed skill scopes read route`

## Slice 17
Implement `PUT /api/managed-skills/:id/scopes` with route tests.
Commit:
- `feat: add managed skill scopes write route`

## Slice 18
Implement `GET /api/managed-skills/effective-preview` with route tests.
Commit:
- `feat: add managed skill effective preview route`

## Slice 19
Add UI API client/types/hooks for managed-skills CRUD and preview endpoints.
Files likely:
- `ui/src/api/*`
- `ui/src/hooks/*`
Commit:
- `feat: add managed skills ui data hooks`

## Slice 20
Add managed-skills list UI.
Commit:
- `feat: add managed skills list ui`

## Slice 21
Add create/edit managed-skill form UI.
Commit:
- `feat: add managed skill editor ui`

## Slice 22
Add scope assignment UI.
Commit:
- `feat: add managed skill scope editor ui`

## Slice 23
Add effective-preview UI and targeted UI tests for list/editor/scope/preview state transitions.
Commit:
- `feat: add managed skill preview ui`
- or `test: cover managed skills ui flows` if split is cleaner

## Slice 24
Browser-validate the managed-skills UI end-to-end in local Paperclip.
Validation:
- real create/edit/scope/preview flow works in browser
Commit:
- only if bugfixes are required

## Slice 25
Run final live cross-agent validation covering:
- company-scoped skill across Hermes/Codex/Cursor
- project override precedence
- agent override precedence
- proof that built-in Paperclip skills still remain available
Deliverables:
- issue/run ids
- browser/API/log evidence
- final completion notes in a docs artifact if needed
Commit:
- `test: validate managed skills across hermes codex and cursor`

## Validation defaults for each code slice
- run the narrowest relevant Vitest target first
- run `pnpm build` before each commit
- use browser validation only for UI/user-facing slices
- for live agent validation, capture concrete run IDs before claiming completion
