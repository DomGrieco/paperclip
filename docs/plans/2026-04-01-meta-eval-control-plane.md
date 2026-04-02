# Paperclip Meta-Eval Control Plane Implementation Plan

> For Hermes: use subagent-driven-development to implement this in narrow, validated slices.

Goal: Evolve Paperclip from a company-scoped agent orchestration system into a governed meta-level control plane that can run benchmark/dogfood companies, evaluate real operating companies, coordinate repo-bound implementation/review/deploy workflows, and improve the Paperclip repo itself through review-gated campaigns.

Architecture: Keep the existing company/work/run model as the execution plane, add first-class repository and deployment surfaces as a repo plane, and introduce a meta/eval plane that observes outcomes, runs benchmark suites, launches improvement campaigns, and routes shared-service agents across company and repo boundaries. Memory remains scoped per agent and per project/repo scope, but Paperclip publishes governed shared-context packets so same-scope agents can operate like a hive mind without collapsing into one unsafe global memory blob.

Tech Stack: existing `packages/db` Drizzle schema, `server/src/services/heartbeat.ts`, `server/src/services/issue-run-graph.ts`, runtime bundles/shared context, adapter-managed workspaces, GitHub/PR integration, activity log, approvals, and the existing planner/worker/verifier orchestration foundation.

---

## Why this plan exists

Paperclip already has meaningful foundations for governed orchestration:
- planner/worker lineage in `server/src/services/issue-run-graph.ts`
- runtime bundle + shared context packets in `packages/shared/src/types/orchestration.ts`
- shared context publications in `packages/db/src/schema/shared_context_publications.ts`
- native memory import in `server/src/services/agent-native-memory.ts`
- agent permissions and runtime config on `packages/db/src/schema/agents.ts`

But the current architecture still assumes a company is the top-level boundary. `docs/start/architecture.md` explicitly says all entities belong to exactly one company. That is too narrow for the next step.

The user goal is larger:
1. run real companies and benchmark/dogfood companies in the same instance
2. evaluate those companies longitudinally
3. bind agents to one or more repos, not only one company
4. support meta-level reviewer, release, and deployment agents
5. let Paperclip improve itself through branch -> PR -> review -> merge -> deploy -> rerun-evals loops
6. preserve scoped memory and a safe hive-mind model instead of one universal memory pool

This plan proposes the smallest coherent architecture that can support all of that.

---

## Product thesis

Paperclip should become a governed meta-control plane with three explicit layers:

1. Execution plane
- companies
- projects
- issues
- agents
- heartbeat runs
- artifacts
- runtime bundles

2. Repo plane
- repositories
- repo bindings
- branches
- pull requests
- checks
- environments
- deployments

3. Meta/eval plane
- benchmark suites
- benchmark companies
- scorecards
- regression detection
- improvement campaigns
- shared-service agents

This separation is the key design move. Do not force all of these concerns back into the current company abstraction.

---

## Design principles

1. Governed autonomy over free-form self-modification.
- Meta agents may propose and implement changes.
- They do not bypass repo policy, review gates, or deploy checks.

2. Explicit planes over overloaded company semantics.
- A dogfood benchmark company is not the same thing as a platform reviewer team.
- A repository is not a company.
- A deployment target is not a project.

3. Scoped memory over universal shared memory.
- Each agent keeps native/private memory.
- Same-scope agents can access published shared memory/context.
- Cross-scope visibility is governed and auditable.

4. Shared-service agents are first-class.
- Some agents should work across many companies/repos.
- Example: technical reviewer, security reviewer, deploy manager, eval analyst.

5. Repos are first-class execution surfaces.
- Prompt-only repo references are not enough.
- Repo bindings must be structured, permissioned, and queryable.

6. Evals must be longitudinal and reproducible.
- Benchmark companies should use pinned prompt packs, seeded issue templates, and comparable scorecards over time.

7. Human governance stays available at the highest-risk transitions.
- PR merge
- production deployment
- permissions escalation
- self-modification of Paperclip core

8. Keep current orchestration primitives intact.
- Extend planner/worker/reviewer/verifier systems instead of replacing them.

---

## Current-state audit grounded in the repo

### Already present and reusable

1. Company/project/agent/work execution model
- `packages/db/src/schema/companies.ts`
- `packages/db/src/schema/agents.ts`
- `packages/db/src/schema/projects.ts`
- `packages/db/src/schema/issues.ts`

2. Planner/worker/verifier orchestration lineage
- `server/src/services/issue-run-graph.ts`
- `packages/shared/src/types/orchestration.ts`
- `packages/db/src/schema/heartbeat_runs.ts`

3. Shared memory/context publication model
- `packages/db/src/schema/shared_context_publications.ts`
- `server/src/services/shared-context-publications.ts`
- `server/src/services/shared-context.ts`

4. Agent-native memory import hooks
- `server/src/services/agent-native-memory.ts`

5. Execution workspace/runtime bundle foundation
- `server/src/services/runtime-bundle.ts`
- `server/src/services/execution-workspaces.ts`
- `server/src/services/workspace-runtime.ts`
- `server/src/services/agent-container-plan.ts`

6. Existing approvals and governance concepts
- approvals tables/routes/services already exist and should gate high-risk meta actions

### Key architectural limitation to address

`docs/start/architecture.md` currently documents Paperclip as strictly company-scoped. That is the main conceptual blocker. The implementation is already richer than that and can support a more layered model.

### Missing or incomplete capabilities

1. No first-class repository object
2. No repo binding model for agents/companies/projects
3. No benchmark/eval suite object model
4. No meta-level campaign object for platform improvements
5. No shared-service/global agent scope
6. No PR review/merge/deployment object model in core Paperclip state
7. No scoped hive-mind memory policy across project/repo teams
8. No scoreboard for longitudinal benchmark performance
9. No release/deploy orchestration layer above PR approval

---

## Target object model

### 1. Repository

Purpose: make repos first-class control-plane objects.

Suggested fields:
- `id`
- `name`
- `provider` (`github`, `gitlab`, `local_git`, `manual`)
- `remoteUrl`
- `defaultBranch`
- `visibility`
- `status`
- `workspaceStrategy`
- `runtimeBinding`
- `ciProvider`
- `metadata`
- `createdAt`, `updatedAt`

Suggested new files:
- `packages/db/src/schema/repositories.ts`
- `packages/shared/src/types/repository.ts`
- `packages/shared/src/validators/repository.ts`
- `server/src/services/repositories.ts`
- `server/src/routes/repositories.ts`

### 2. Repository binding

Purpose: attach repos to companies, projects, agents, and campaigns without duplicating repo definitions.

Binding targets:
- company -> repo
- project -> repo
- agent -> repo
- eval suite -> repo
- campaign -> repo

Suggested fields:
- `bindingType` (`company`, `project`, `agent`, `suite`, `campaign`)
- `bindingId`
- `repositoryId`
- `role` (`primary`, `secondary`, `read_only`, `deployment_target`)
- `branchPolicy`
- `pathPolicy`
- `createdAt`, `updatedAt`

Suggested new files:
- `packages/db/src/schema/repository_bindings.ts`
- `server/src/services/repository-bindings.ts`

### 3. Agent scope profile

Purpose: let an agent be scoped to one company, many companies, one repo, many repos, or platform/global scope.

Add to or alongside `agents`:
- `scopeType` (`company`, `multi_company`, `repo`, `multi_repo`, `platform_service`)
- `scopeConfig` json
- `serviceClass` (`reviewer`, `qa`, `planner`, `engineer`, `deployment_manager`, `eval_analyst`, `security`)
- `visibilityPolicy`

Important rule:
- do not overload `companyId` to mean every scope forever
- near-term compatibility can keep a home company for accounting/UI, but true authority should derive from scoped bindings

Suggested files:
- `packages/shared/src/types/agent.ts`
- `packages/shared/src/validators/agent.ts`
- `server/src/services/agents.ts`
- `server/src/routes/agents.ts`

### 4. Eval suite

Purpose: define repeatable benchmark or audit workflows.

Suggested fields:
- `id`
- `name`
- `kind` (`benchmark`, `dogfood`, `audit`, `regression`, `release_gate`)
- `status`
- `targetType` (`company`, `company_type`, `repository`, `campaign`, `platform`)
- `promptPack`
- `seedIssueTemplate`
- `scoringRubric`
- `schedule`
- `retryPolicy`
- `repoSelectionPolicy`
- `metadata`

Suggested files:
- `packages/db/src/schema/eval_suites.ts`
- `packages/db/src/schema/eval_runs.ts`
- `packages/db/src/schema/eval_scorecards.ts`
- `server/src/services/evals.ts`
- `server/src/routes/evals.ts`

### 5. Improvement campaign

Purpose: a governed meta-level initiative that turns observations into code changes.

Suggested states:
- `proposed`
- `approved`
- `active`
- `review_pending`
- `deploy_pending`
- `completed`
- `blocked`
- `rolled_back`

Suggested fields:
- `sourceEvalSuiteId`
- `sourceEvalRunId`
- `targetRepositoryId`
- `targetEnvironmentId`
- `goal`
- `acceptanceCriteria`
- `policySnapshot`
- `statusSummary`
- `regressionBudget`

Suggested files:
- `packages/db/src/schema/improvement_campaigns.ts`
- `packages/db/src/schema/campaign_actions.ts`
- `server/src/services/improvement-campaigns.ts`
- `server/src/routes/improvement-campaigns.ts`

### 6. Pull request and deployment surfaces

Purpose: keep GitHub/provider state mirrored into Paperclip's source of truth.

Suggested tables:
- `pull_requests`
- `pull_request_reviews`
- `deployment_targets`
- `deployments`
- `deployment_checks`

Suggested files:
- `packages/db/src/schema/pull_requests.ts`
- `packages/db/src/schema/deployment_targets.ts`
- `packages/db/src/schema/deployments.ts`
- `server/src/services/pull-requests.ts`
- `server/src/services/deployments.ts`

---

## Memory model: scoped private memory + governed hive mind

The user's requirement is correct: every agent should keep its own memories per project scope, while same-scope agents can draw from each other's relevant memories like a hive mind.

The safe version of that idea is:

### Memory layers

1. Native private memory
- owned by one agent/runtime
- includes native Hermes/Codex/Cursor memory or imported equivalents
- not auto-exposed across the org

2. Scoped working memory
- tied to a company/project/repo/campaign/eval scope
- visible to agents with matching scope grants
- optimized for operational recall and handoffs

3. Published shared context
- promoted from agent output into governed shared context
- audited, ranked, freshness-tagged, revocable
- this is the default hive-mind layer

4. Platform policy memory
- cross-project standards and reviewer heuristics
- visible to platform-service agents or specifically granted teams

### Why not a literal free-for-all shared memory

A global unfiltered memory pool creates:
- leakage across unrelated projects
- stale or contradictory instructions
- poor provenance
- harder debugging
- bad security defaults

### Recommended implementation approach

Build on existing `shared_context_publications` instead of inventing a parallel memory system.

Add:
- new visibility values or scope descriptors for `repository`, `campaign`, `eval_suite`, `platform_service`
- explicit memory provenance: native import vs agent-authored vs reviewer-promoted vs eval-generated
- freshness and approval state for cross-agent visibility
- agent-to-agent audience sets grouped by scope/team, not only ad hoc IDs

Suggested schema/typing changes:
- extend `packages/shared/src/types/orchestration.ts`
- extend `packages/db/src/schema/shared_context_publications.ts`
- add `scopeType`, `scopeId`, `repoId`, `campaignId`, `evalSuiteId` fields or a normalized scope table

### Hive-mind operating rule

Agents in the same scope should not read each other's raw private memory files.
Instead they receive a runtime memory packet assembled from:
1. their private/native memory
2. scope-matching shared publications
3. approved cross-agent publications
4. platform policy snippets if authorized

This preserves the feel of a hive mind while keeping it queryable, governable, and debuggable.

---

## Permission and governance model

Every agent needs capability grants across both company and repo planes.

### Proposed capability families

Company capabilities:
- `company.read`
- `company.comment`
- `company.assign`
- `company.run_eval`
- `company.manage_agents`

Repo capabilities:
- `repo.read`
- `repo.branch`
- `repo.commit`
- `repo.open_pr`
- `repo.review_pr`
- `repo.merge_pr`

Deployment capabilities:
- `deploy.read`
- `deploy.request`
- `deploy.approve`
- `deploy.execute`
- `deploy.rollback`

Meta capabilities:
- `eval.create`
- `eval.run`
- `campaign.create`
- `campaign.approve`
- `campaign.route`
- `policy.admin`

### Governance rules

1. Meta agents can propose Paperclip self-improvement campaigns.
2. Repo-bound engineer agents can implement campaigns on branches.
3. Reviewer agents must review PRs before merge.
4. Deployment agents do not merge until checks and policy gates pass.
5. Production deployments should support human approval as a policy option.
6. Cross-scope memory visibility requires explicit grants or published context.

---

## Benchmark and dogfood model

Benchmark companies should become first-class typed companies, not naming conventions.

### Extend company typing

Add company type:
- `production`
- `sandbox`
- `dogfood`
- `benchmark`
- `research`

Suggested schema change:
- add `type` and `evaluationProfileId` to `packages/db/src/schema/companies.ts`

### Dogfood company behavior

A dogfood company can carry:
- pinned prompt pack
- starter role templates
- seeded issue templates
- target repo bindings
- eval suite bindings
- deterministic follow-up requests
- score expectations

### Benchmark run flow

1. instantiate or reset benchmark company
2. bind repo(s)
3. hire/configure benchmark agent set
4. seed issues from suite template
5. run planner/worker/reviewer flow
6. capture UI, run graph, artifacts, tests, scorecard
7. compare against previous runs
8. emit regressions/improvements

---

## Repo and PR workflow architecture

The core workflow should be:

1. Meta plane detects weakness
- from eval regression, dogfood failure, review burden, deployment failure, or recurring blocker

2. Campaign created
- ties evidence to repo, scope, and acceptance criteria

3. Branch created
- repo-bound engineer agent works in isolated workspace/worktree

4. PR opened
- PR state mirrored into Paperclip

5. Reviewers assigned
- one or more reviewer agents plus optional human reviewer

6. Merge decision recorded
- Paperclip stores decision, rationale, and policy evidence

7. Deployment triggered
- deployment agent executes rollout against bound environment

8. Post-deploy eval rerun
- same suite re-runs and compares before/after outcomes

### Critical rule

Paperclip should never treat GitHub as the system brain.
GitHub is the collaboration/execution surface.
Paperclip remains the source of truth for:
- campaign state
- policy decisions
- score history
- review routing
- deployment decisions
- regression evidence

---

## Deployment architecture

Deployment should become a first-class control-plane concern.

### Deployment target object

Suggested fields:
- `name`
- `repositoryId`
- `environment` (`dev`, `staging`, `prod`, `preview`)
- `provider` (`vercel`, `netlify`, `docker`, `railway`, `fly`, `custom`)
- `deployPolicy`
- `healthcheckConfig`
- `rollbackPolicy`

### Deployment run flow

1. create deployment request from approved PR/campaign
2. resolve target and credentials
3. run preflight checks
4. deploy
5. verify health
6. publish deployment artifact
7. trigger eval or smoke suite
8. auto-rollback or escalate on failure

### Shared-service deployment agents

Examples:
- global release manager
- environment-specific deployer
- production gatekeeper

These are ideal platform-service agents rather than company-local workers.

---

## UI and operator experience

New UI surfaces should be added deliberately.

### New top-level surfaces

1. Repositories
- list, detail, bindings, status, deploy targets

2. Evals
- suites, recent runs, regression chart, benchmark score history

3. Campaigns
- proposals, active improvements, blockers, completed wins

4. Deployments
- current env state, deploy history, health checks, rollback actions

5. Platform agents
- shared-service agents across repos/companies

### Existing page enhancements

Company detail:
- show company type
- show bound repos
- show attached eval suites
- show benchmark score trend for dogfood companies

Agent detail:
- show scope profile
- show repo bindings
- show memory visibility summary
- show service class and policy grants

Run detail:
- show whether run came from normal execution or meta/eval/campaign context
- show repo/campaign binding
- show score impacts and follow-up actions

---

## API additions

Suggested routes:
- `GET/POST /api/repositories`
- `GET/PATCH /api/repositories/:id`
- `GET/POST /api/repositories/:id/bindings`
- `GET/POST /api/eval-suites`
- `GET/POST /api/eval-runs`
- `GET /api/eval-runs/:id/scorecard`
- `GET/POST /api/improvement-campaigns`
- `GET/POST /api/pull-requests`
- `GET/POST /api/deployments`
- `POST /api/deployments/:id/approve`
- `POST /api/deployments/:id/rollback`

Important:
- meta endpoints must enforce stronger authz than ordinary company routes
- platform-service operations should log richer audit entries than standard issue actions

---

## Rollout plan

### Phase 1: Formalize the meta/repo/eval architecture in shared types and docs

Objective: define the contract before changing orchestration behavior.

Files:
- Modify: `docs/start/architecture.md`
- Add: `docs/plans/2026-04-01-meta-eval-control-plane.md`
- Add: `packages/shared/src/types/repository.ts`
- Add: `packages/shared/src/types/eval.ts`
- Add: `packages/shared/src/types/campaign.ts`
- Add validators under `packages/shared/src/validators/`

Steps:
1. Add shared types for repositories, eval suites, scorecards, campaigns, deployment targets.
2. Extend agent/company shared types with company type and scope profile concepts.
3. Update architecture docs to describe the three-plane model.
4. Add unit tests for validators and serialization.
5. Commit.

Validation:
- `pnpm --filter @paperclipai/shared test`
- `pnpm --filter @paperclipai/shared typecheck`

### Phase 2: Add repo plane primitives

Objective: make repos and bindings first-class without changing company runtime semantics yet.

Files:
- Add DB schema files under `packages/db/src/schema/`
- Modify: `packages/db/src/schema/index.ts`
- Add services/routes for repositories and bindings
- Add API docs under `docs/api/`

Steps:
1. Add `repositories` and `repository_bindings` tables.
2. Add migrations and shared validators.
3. Add CRUD routes/services.
4. Add basic UI list/detail pages for repos.
5. Add tests.
6. Commit.

Validation:
- schema tests/migrations pass
- API integration tests for create/list/bind repo

### Phase 3: Add company typing and scoped agent profiles

Objective: support dogfood/benchmark company types and platform-service agent scopes.

Files:
- Modify: `packages/db/src/schema/companies.ts`
- Modify: `packages/db/src/schema/agents.ts`
- Modify shared agent/company types and validators
- Modify agent/company routes and forms

Steps:
1. Add company type + optional evaluation profile fields.
2. Add agent scope profile fields.
3. Preserve backward compatibility for existing company-bound agents.
4. Add UI fields for scope/service class.
5. Add tests and migration coverage.
6. Commit.

Validation:
- old agents still load
- new platform-service agents can be created without breaking company agents

### Phase 4: Upgrade memory into scoped hive-mind publications

Objective: preserve per-agent memory while enabling safe same-scope collaboration.

Files:
- Modify: `packages/db/src/schema/shared_context_publications.ts`
- Modify: `packages/shared/src/types/orchestration.ts`
- Modify: `server/src/services/shared-context-publications.ts`
- Modify: `server/src/services/runtime-bundle.ts`
- Modify: `server/src/services/agent-native-memory.ts`
- Add tests around runtime memory packet composition

Steps:
1. Add richer scope descriptors for repo/campaign/eval/platform publications.
2. Add memory provenance and governance metadata.
3. Build memory packet assembly rules that combine private + shared snippets by scope.
4. Add UI/audit affordances for visibility and freshness.
5. Test same-scope hive-mind access and forbidden cross-scope reads.
6. Commit.

Validation:
- runtime packet contains correct snippets for same-scope collaborators
- private memory remains private unless published

### Phase 5: Add eval suite and scorecard primitives

Objective: let Paperclip define and run benchmark/dogfood suites before enabling self-modifying campaigns.

Files:
- Add DB schema for eval suites/runs/scorecards
- Add services/routes
- Add UI pages for suites and runs
- Add docs/guides for benchmark companies

Steps:
1. Add eval suite definitions.
2. Add eval run lifecycle + scorecard storage.
3. Add benchmark company template support.
4. Add manual trigger + scheduled trigger support.
5. Add first scorecard views.
6. Commit.

Validation:
- can run a benchmark suite against a benchmark company
- scorecard is persisted and viewable

### Phase 6: Add improvement campaigns

Objective: turn regressions and findings into governed platform work.

Files:
- Add campaign schema/services/routes
- Modify activity log integration
- Add campaign pages/cards
- Add planner routing integration for campaigns

Steps:
1. Create campaign from eval result.
2. Bind campaign to repo and acceptance criteria.
3. Route campaign work to repo-bound engineer agents.
4. Add policy states and approvals.
5. Add tests.
6. Commit.

Validation:
- campaign can be created from eval evidence
- repo binding + policy snapshot persist correctly

### Phase 7: Add PR and review workflows as first-class Paperclip objects

Objective: let Paperclip track branch/PR/review state instead of burying it in comments/logs.

Files:
- Add PR schema/services/routes
- Add GitHub provider integration layer
- Add reviewer assignment logic
- Add UI surfaces for PR state

Steps:
1. Mirror PR metadata into Paperclip.
2. Attach campaign/eval provenance to PRs.
3. Route PRs to review agents.
4. Require review policy satisfaction before merge recommendation.
5. Add tests and provider adapters.
6. Commit.

Validation:
- branch -> PR -> review -> approval flow is visible in Paperclip

### Phase 8: Add deployments and release agents

Objective: close the loop after code review.

Files:
- Add deployment target/schema/services/routes
- Add provider adapters and health checks
- Add deployment timeline UI

Steps:
1. Define deployment targets.
2. Add deployment request/execution state machine.
3. Add health checks and rollback signals.
4. Add deploy-agent routing.
5. Trigger post-deploy smoke/eval suites.
6. Commit.

Validation:
- approved PR can create a deployment record
- failed health checks trigger blocked/rollback flow

### Phase 9: Enable controlled Paperclip self-improvement campaigns

Objective: allow the platform to improve its own repo in a governed way.

Files:
- campaign/repo/pr/deploy code from prior phases
- policy and approvals integrations
- benchmark/dogfood suite definitions for the Paperclip repo itself

Steps:
1. Create benchmark dogfood company templates for Paperclip.
2. Bind Paperclip repo as a governed repository target.
3. Allow eval regressions to propose campaigns, not auto-merge fixes.
4. Require reviewer + deploy policy checks.
5. Rerun eval suites after merge/deploy.
6. Commit.

Validation:
- Paperclip can propose and ship a reviewed change to itself, then prove whether benchmark outcomes improved

---

## Recommended v1 scope

Do not build the whole vision at once.

The best v1 is:
1. repository objects + bindings
2. company type = benchmark/dogfood
3. eval suites + scorecards
4. scoped hive-mind memory on top of shared context
5. platform-service reviewer/eval agents

That alone would already make Paperclip meaningfully better and unlock the next layer safely.

Avoid putting automatic self-editing into v1.

---

## Risks and anti-patterns

1. Anti-pattern: one global memory blob
- Fix: scope-aware memory + governed publication only.

2. Anti-pattern: every shared-service agent belongs to a fake company
- Fix: introduce platform-service scope explicitly.

3. Anti-pattern: GitHub becomes the source of truth
- Fix: Paperclip stores campaigns, scorecards, approvals, deployments, and review state.

4. Anti-pattern: benchmark suites without reproducibility
- Fix: pin prompt packs, seeded tasks, scoring rubrics, and repo bindings.

5. Anti-pattern: self-improvement without review gates
- Fix: branch, PR, review, deploy, rerun-evals, compare.

6. Anti-pattern: cross-project leakage through memory or repo bindings
- Fix: explicit grants, scope boundaries, audit logs, and freshness metadata.

---

## Open design questions

1. Does a platform-service agent still need a home company for budget/accounting?
2. Should repo bindings live directly on agents/companies or through a normalized bindings table only?
3. Do we want deployments in core now or start with PR/review only?
4. Should eval suites be able to target multiple companies in one run, or should each run normalize to one target scope?
5. What approval policy is required for Paperclip self-modification in local dev vs hosted mode?

Recommended answer pattern:
- normalize the data model now
- keep UI opinions minimal in v1
- defer high-risk automation until scorecards and repo bindings are stable

---

## Concrete next slice recommendation

Start with a narrow architecture slice that lands the contracts, not the full execution loop:

1. add repository, eval, and campaign shared types/validators
2. add company type + scoped agent profile types
3. update architecture docs to the three-plane model
4. add a follow-up plan for schema + API implementation

This will create the implementation contract the rest of the system can follow without prematurely locking the database and UI around the wrong abstraction.

---

## Implementation handoff note

Once this plan is accepted, the next execution plan should be a focused Slice 1 implementation doc covering:
- exact schema/type additions
- exact migrations
- exact routes/services
- exact UI entry points
- typecheck/test commands
- acceptance criteria for repository objects, dogfood company typing, and scoped hive-mind memory
