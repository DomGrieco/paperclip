# Hermes Fleet Control Plane Spec

Status: Draft
Date: 2026-03-22
Audience: Product + Engineering
Scope: Using Paperclip as the control plane for a fleet of specialized Hermes agents running in isolated workspaces/containers with scoped memory and controlled shared context

## 1. Document Role

This document defines the target architecture for running Paperclip-managed companies whose workers are primarily Hermes agents.

It is additive to the existing documents:

- `doc/SPEC-implementation.md` remains the V1 implementation contract.
- `doc/spec/feature-1-hierarchical-orchestration.md` remains the source of truth for planner/worker/verification orchestration.
- `doc/spec/agent-runtime-surface.md` remains the source of truth for runtime bundles and context projection.

This document specializes those ideas for Hermes-based execution and long-lived autonomous operation.

## 2. Core Decision

Paperclip is the control plane.
Hermes is the worker runtime.

Paperclip owns:
- companies
- goals
- projects
- issues
- org structure
- approvals
- budgets
- auditability
- run graph state
- workspace bindings
- shared-context governance

Hermes owns:
- reasoning and execution
- tool use
- local memory
- local skills
- session continuity
- project-specialized runtime behavior

Paperclip must remain the management source of truth.
Hermes must remain the execution/runtime source of truth.

## 3. System Goals

The Hermes fleet architecture must support:

1. One Paperclip deployment managing many specialized Hermes agents.
2. Per-agent isolation of workspace, sessions, memory, skills, and credentials.
3. Shared context through governed Paperclip surfaces, not by merging all Hermes homes into one brain.
4. 24/7 autonomous operation on a long-lived Ubuntu server.
5. Strong auditability of work, costs, artifacts, approvals, and cross-agent coordination.
6. Browser/test-capable agent execution for software verification loops.
7. Local-first developer ergonomics on macOS while production runs on Ubuntu/Docker.

## 4. Deployment Topology

## 4.1 Operator / development machine

The macOS laptop is the operator and development console.

Primary responsibilities:
- maintain the Hermes fork
- maintain the Paperclip fork
- test changes locally
- inspect dashboards/logs
- perform browser dogfooding
- approve risky actions

## 4.2 Always-on runtime host

The Ubuntu server is the always-on execution environment.

Primary responsibilities:
- run Paperclip in Docker
- run PostgreSQL and supporting services
- run Hermes worker containers
- host persistent volumes
- run schedulers / runner services / background automation

## 4.3 Containerization model

Paperclip itself may run in Docker and still orchestrate isolated containers.
That is supported, but the architecture must be explicit about how child runtime containers are launched.

Preferred options, in order:

1. Separate runner service with Docker access
- Paperclip app container talks to a runner service
- runner service manages worker containers
- Paperclip app does not require broad direct Docker control

2. Paperclip app container using a Docker API endpoint
- mount `/var/run/docker.sock` or use a remote Docker API endpoint with TLS
- Paperclip launches sibling worker containers on the host
- acceptable for local/self-hosted power-user setups, but broader host access risk must be documented clearly

3. Classic Docker-in-Docker
- not preferred as the default architecture
- higher operational complexity and weaker ergonomics for persistent workspaces/host volumes

Default architectural decision:
- do not use classic DinD as the default
- prefer sibling containers launched by a dedicated runner service or Docker API integration

## 5. Runtime Planes

## 5.1 Control plane

Paperclip services:
- `paperclip-server`
- `paperclip-ui` if separate from the server build/runtime
- `postgres`
- optional `redis` for future queue/event needs
- optional object storage or S3-compatible service for artifacts

## 5.2 Runner plane

A runner plane is required for isolated execution.

Runner responsibilities:
- create and destroy Hermes worker containers
- attach workspaces and volumes
- inject scoped env vars / secrets
- expose logs and status back to Paperclip
- capture artifacts
- support browser-capable verification environments where needed

The runner plane may initially be implemented inside the existing Paperclip server process for local-first V1/V2, but the target architecture is a separate process/service boundary.

## 5.3 Worker plane

Worker containers run Hermes for specific roles.
Examples:
- `hermes-planner`
- `hermes-paperclip-engineer`
- `hermes-atlas-researcher`
- `hermes-market-analyst`
- `hermes-obsidian-curator`
- `hermes-verifier`

Each worker gets:
- its own repo/workspace mount
- its own `HERMES_HOME`
- its own session DB and local memory
- its own skills directory
- its own toolset/profile
- its own secrets scope

## 6. Hermes Runtime Modes In Paperclip

Paperclip already supports `hermes_local`.
The Hermes fleet architecture extends this with clearer runtime targets:

- `hermes_local`
  - local CLI process on the host or inside the Paperclip runtime container
  - useful for development and compatibility

- `hermes_container`
  - Hermes launched in a dedicated sibling container per run or per persistent worker
  - preferred production target for isolated agents

- `hermes_remote` (future)
  - Hermes exposed by remote service/runner API
  - useful for multi-host fleets later

The immediate next-step target is `hermes_local` plus a design path to `hermes_container`.

## 7. Workspace Model

Paperclip already has strong primitives for:
- `project_workspaces`
- `execution_workspaces`
- `workspace_runtime_services`

These should be used directly.

### 7.1 Project workspace

Represents the durable project source of truth.
Examples:
- Paperclip repo
- Hermes fork repo
- Atlas-GIC repo
- Obsidian vault repo

### 7.2 Execution workspace

Represents a concrete execution environment for a run.
Examples:
- a temporary git worktree for a worker run
- a persistent branch-bound workspace for a long-lived specialist agent
- a verification sandbox workspace

### 7.3 Hermes workspace policy

For Hermes workers, the runtime bundle should define whether the run uses:
- the durable primary project workspace
- a derived execution workspace
- a reusable project-specialized worker workspace
- a verification-only sandbox workspace

## 8. Memory Model

## 8.1 Principle

Do not create one globally shared Hermes memory directory.
Use layered memory.

## 8.2 Memory layers

### Layer A: Hermes local memory

Private to one Hermes worker profile.
Stored inside that worker's `HERMES_HOME`.

Allowed contents:
- project conventions
- repo-specific notes
- tool quirks
- local operating habits
- project-specific reusable skills

### Layer B: Paperclip shared structured context

Company/project/issue scoped context owned by Paperclip.

Allowed contents:
- approved plans
- policies
- task context
- goal ancestry
- evidence expectations
- bounded recall packets
- shared findings with provenance

### Layer C: Published knowledge

When a Hermes agent learns something useful for others, it should publish a structured item back to Paperclip instead of assuming direct access to another worker's local memory.

Published knowledge item fields should include at least:
- source agent id
- company id
- project id nullable
- issue id nullable
- title
- summary
- detail/body
- tags
- freshness timestamp
- confidence/ranking metadata
- provenance refs
- visibility scope (`company`, `project`, `agent-set`)

## 8.3 Runtime recall packet

Paperclip should pass Hermes a recall packet rather than a raw memory dump.

A Hermes recall packet should include:
- scope
- curated recalled items
- provenance
- freshness
- rank/confidence
- explicit inclusion reason

## 9. Skills Model

## 9.1 Local skills

Each Hermes worker may have private local skills.
Examples:
- repo-specific coding workflow
- market-analysis workflow
- vault organization workflow

## 9.2 Shared skills

Paperclip should support company-scoped shared skills/rules/policies that can be projected into Hermes runtime bundles.

Examples:
- required release discipline
- TDD policy
- code review standards
- issue response format
- evidence expectations

## 9.3 Skill publication

A Hermes-discovered skill should not become globally active automatically.
Recommended flow:
- worker proposes skill or skill update
- Paperclip records proposal and provenance
- human/operator or policy approves if needed
- skill becomes company/project scoped runtime input

## 10. Tool And Permission Model

Each Hermes worker should receive only the toolset needed for its role.

Examples:
- planning worker: search/read/web/tools, limited write ability
- engineering worker: terminal/file/git/browser if required
- verifier: browser/terminal/test/reporting tools
- research worker: web/search/extract/note publishing tools

Permissions must be scoped by:
- company
- agent role
- project
- workspace
- approval/budget state

Human approval gates remain required for high-risk actions such as:
- destructive repository operations
- deployment/promotions
- secret changes
- outbound notifications with business impact
- high-cost run escalations

## 11. Shared Environment And Secret Contract

The architecture must define a standard env contract across Paperclip, runner services, and Hermes containers.

## 11.1 Paperclip core env

Examples already present or expected:
- `DATABASE_URL`
- `PAPERCLIP_HOME`
- `PAPERCLIP_INSTANCE_ID`
- `PAPERCLIP_CONFIG`
- `PAPERCLIP_PUBLIC_URL`
- `PAPERCLIP_DEPLOYMENT_MODE`
- `PAPERCLIP_DEPLOYMENT_EXPOSURE`
- `BETTER_AUTH_SECRET`

## 11.2 Runner-plane env

New/explicit examples to define:
- `PAPERCLIP_RUNNER_MODE=local_docker|remote_docker`
- `PAPERCLIP_RUNNER_DOCKER_SOCKET=/var/run/docker.sock`
- `PAPERCLIP_RUNNER_DOCKER_HOST=tcp://runner-host:2376`
- `PAPERCLIP_RUNNER_DOCKER_TLS_VERIFY=1`
- `PAPERCLIP_RUNNER_DOCKER_CERT_PATH=/run/secrets/docker-client`
- `PAPERCLIP_RUNNER_NETWORK=paperclip_default`
- `PAPERCLIP_RUNNER_WORK_ROOT=/var/lib/paperclip/workspaces`
- `PAPERCLIP_RUNNER_ARTIFACT_ROOT=/var/lib/paperclip/artifacts`

## 11.3 Hermes worker env

Examples to standardize:
- `HERMES_HOME`
- `HERMES_CONFIG`
- `PAPERCLIP_AGENT_ID`
- `PAPERCLIP_COMPANY_ID`
- `PAPERCLIP_PROJECT_ID`
- `PAPERCLIP_ISSUE_ID`
- `PAPERCLIP_RUN_ID`
- `PAPERCLIP_API_BASE_URL`
- `PAPERCLIP_AGENT_API_KEY`
- `PAPERCLIP_RUNTIME_BUNDLE_PATH`
- `PAPERCLIP_RECALL_PACKET_PATH`
- `PAPERCLIP_WORKSPACE_PATH`
- `PAPERCLIP_ARTIFACT_OUTPUT_DIR`

Provider/model credentials should be injected only where needed.

## 12. Inter-Agent Communication

Hermes workers may collaborate, but not by unrestricted direct shell access to each other.

Default communication path:
- worker publishes result/request to Paperclip
- Paperclip records it against company/project/issue/run state
- Paperclip routes the relevant subset to another worker

Allowed forms:
- issue comments
- child issues
- run-graph child runs
- published knowledge items
- explicit agent-to-agent request records

Future direct worker messaging may exist, but it must still be durable, logged, and policy-controlled.

## 13. Repo And Project Mapping

The first deployment should treat these as distinct project workspaces:

- `paperclip`
  - control-plane repo
  - managed by a Paperclip engineering Hermes agent

- `hermes-agent`
  - runtime/worker repo fork
  - managed by a Hermes-core engineering agent

- `atlas-gic`
  - research + market intelligence project
  - managed by an Atlas researcher agent

- `Obsidian vault`
  - knowledge/vault project
  - managed by an Obsidian curator agent

Paperclip projects should map to these workspaces and their associated specialist agents.

## 14. Initial Fleet Recommendation

Initial company layout:

- Board / operator: human
- `hermes-core-planner`
  - plans architecture and routes deeper work
- `paperclip-engineer`
  - evolves Paperclip control-plane features
- `hermes-engineer`
  - evolves Hermes runtime capabilities and skills
- `integration-engineer`
  - owns adapter/runner/runtime-bundle integration between Paperclip and Hermes
- `verifier`
  - browser, tests, evidence, evaluator summaries

Optional early domain specialists:
- `atlas-researcher`
- `market-analyst`
- `obsidian-curator`

## 15. Validation Standard

A Hermes fleet slice is not done until it passes:

1. schema/type validation
2. server/unit tests
3. UI tests where relevant
4. Docker/runtime integration checks
5. browser dogfooding of affected Paperclip flows
6. at least one end-to-end issue run through Paperclip with evidence and logs

## 16. Immediate Architecture Decisions

1. Proceed with Paperclip as the control plane and Hermes as the worker runtime.
2. Keep one Hermes code fork, not one fork per project.
3. Keep agent-local Hermes homes isolated.
4. Use Paperclip-governed structured shared context instead of a pooled memory brain.
5. Support Dockerized Paperclip plus isolated worker containers through a runner boundary, not default DinD.
6. Evolve `hermes_local` into a broader Hermes runtime family with `hermes_container` as the production target.
7. Treat browser dogfooding and end-to-end runtime validation as required for every control-plane slice touching execution.