# Feature 1 Spec: Hierarchical Orchestration

Status: Draft  
Date: 2026-03-21  
Audience: Product + Engineering  
Scope: First implementation milestone for Paperclip's planner/worker/verification execution model

## 1. Document Role

This spec defines the first major implementation target for Paperclip's autonomous-enterprise program.

- `doc/SPEC.md` remains the umbrella architecture.
- `doc/spec/autonomous-enterprise-roadmap.md` defines sequencing and dependencies.
- `doc/spec/agent-runtime-surface.md` defines the runtime bundle, policy resolution, and tool projections consumed by runs.

This document owns the orchestration model itself: run graph structure, lifecycle, outcomes, retries, evidence flow, and completion criteria.

## 2. Problem Statement

The current heartbeat model can invoke agents and persist run state, but it is not yet a durable planner/worker execution graph.
Paperclip needs a first-class orchestration layer that can:

- decompose work into explicit child runs
- execute bounded parallel workers safely
- verify outputs with evidence
- automatically repair failed verification up to policy limits
- preserve durable audit state across restarts and runner failures

Without this layer, Paperclip cannot become a reliable autonomous software-company control plane.

## 3. Feature 1 Contract

Feature 1 is complete when Paperclip can:

1. attach an issue to a rooted run graph
2. create or resume a `planner` run from a wakeup
3. let the planner spawn bounded child `worker` runs
4. let the planner or system spawn `verification` runs
5. enforce TDD-oriented execution policy for software work
6. automatically re-enter worker repair loops after failed verification
7. attach evaluator summaries and required artifacts back to the issue
8. return the issue to a clear review-ready or terminal failed state

Feature 1 is intentionally about the software-company loop, not the full future enterprise-automation surface.

## 4. In-Scope Decisions

The following decisions are fixed for Feature 1:

- the swarm is modeled inside Paperclip as a first-class run graph
- first-class run types are `planner`, `worker`, and `verification`
- bounded parallel worker fan-out is supported in the first implementation
- recursive worker-spawns-worker swarm trees are deferred
- automatic repair loops are supported and configurable, with default max retries of `3`
- TDD is the default execution policy for software work
- evidence policy is hierarchical and configurable at `company -> agent -> issue`
- default evidence policy is `code + CI + evaluator summary`
- human-facing review artifacts are supported in Feature 1 but required only when policy demands them
- runners are local-first/self-hosted by default
- Paperclip may run in a container, but sandboxing must live in a separate execution plane

## 5. Out Of Scope For Feature 1

Feature 1 explicitly does not include:

- unconstrained recursive swarming
- broad enterprise-automation execution targets
- advanced autonomous hiring or org redesign flows
- a complete long-document knowledge platform
- full cloud-runner fleet management as the default execution model

## 6. Run Graph Model

Every software issue should be able to own a rooted execution graph.
The root is typically a `planner` run created or resumed from a Paperclip wakeup.

### 6.1 Run types

- `planner`
  Owns decomposition, task slicing, child-run creation, and reconciliation.
- `worker`
  Owns a scoped implementation package and produces concrete outputs.
- `verification`
  Owns evaluation, proof gathering, and the pass/repair/fail decision.

### 6.2 Required run fields

Each run record must persist at least:

- company, issue, and agent binding
- run type
- parent run id and root run id
- lifecycle status
- policy snapshot
- memory/context snapshot reference
- runner target
- workspace binding
- retry counters
- cost / usage summaries
- evidence / artifact references

The run record is the durable unit of orchestration.
Transient runtime state should never be the only source of truth.

## 7. Run Lifecycle

### 7.1 Planner entry

A wakeup creates or resumes a planner run for the issue.
The planner decides whether to:

- continue existing work
- spawn workers
- request verification
- conclude the issue is blocked or complete

### 7.2 Worker fan-out

Workers are spawned with bounded, explicit work packages.
Each package should define:

- the task slice or expected responsibility
- workspace / branch target
- expected outputs
- applicable policies and evidence requirements

Feature 1 should support parallel workers, but with bounded limits and explicit join/review behavior rather than free-form recursive swarms.

### 7.3 Verification

Verification is a first-class child run type, not an afterthought.
It consumes worker outputs and produces:

- evaluator summary
- referenced evidence
- verdict

Verification verdicts must be structured:

- `pass`
- `repair`
- `fail_terminal`

### 7.4 Repair loop

If verification returns `repair`, Paperclip should automatically schedule the next worker attempt under the same planner, subject to policy limits.
Default repair-loop limit is `3`, but the value must be configurable.
When the limit is exhausted, the planner should surface the issue as blocked or terminally failed rather than silently looping forever.

## 8. Failure Model

Feature 1 should fail visibly and recoverably.
The system must model at least these outcomes:

- `completed`
- `needs_repair`
- `blocked`
- `failed_terminal`
- `canceled`
- `budget_paused`
- `runner_lost`
- `policy_denied`

Failure handling rules:

- verification never silently passes
- runner loss preserves run state and collected evidence so far
- policy denial produces an explicit terminal state
- budget enforcement can pause work without erasing orchestration history
- restart recovery must preserve run-graph integrity

## 9. Evidence Model

Evidence is part of orchestration, not just a UI attachment feature.

### 9.1 Evidence policy

Evidence policy resolves hierarchically:

- company default
- agent override
- issue override

Default software evidence policy:

- code changes
- CI / test results
- evaluator summary

Optional policy-driven artifacts include:

- screenshots
- browser recordings
- walkthrough videos
- interactive verification traces

### 9.2 Evidence flow

Workers and verification runs may emit artifacts, but verification is responsible for producing the review bundle that gets attached back to the issue.
That bundle should be durable, inspectable, and sufficient for human review without re-running the task.

## 10. Runner Boundary

Paperclip owns orchestration, policy, budgets, audit state, and evidence requirements.
Runners own isolated execution, log streaming, artifact capture, and sandbox lifecycle.

This separation is required even when everything lives in the same monorepo.
Separate runner system means separate process/service boundary, not separate repository.

Feature 1 assumes:

- local-first/self-hosted runner targets
- browser-capable verification execution
- artifact upload back into Paperclip
- optional future cloud backends as adapters, not the default architecture

## 11. Reference Inputs

Feature 1 should explicitly borrow from these systems:

- [Longshot](https://github.com/Blastgits/longshot): planner/worker swarm structure, delegation boundaries, bounded parallelism
- [OpenAI Symphony](https://github.com/openai/symphony): orchestration discipline, proof-of-work bundles, review artifacts, evaluator summaries

Paperclip should adapt these ideas into its own company-scoped control-plane model rather than embedding either project directly.

## 12. Acceptance Gates

Feature 1 is accepted only when all of the following are true:

1. run-graph state survives service restarts
2. planner runs can create bounded parallel worker runs
3. verification runs produce evaluator summaries and structured verdicts
4. automatic repair loops respect configurable retry limits
5. policy-driven evidence requirements are enforced
6. evidence is attached back to the issue in a reviewable form
7. local-first runners can execute work and return logs/artifacts
8. worker startup includes resolved runtime bundle inputs and memory recall
9. tests cover orchestration state transitions, retries, policy resolution, and artifact handling

Feature 1 is not complete merely because the schema or API exists.
It is complete only when Paperclip can reliably drive a real software issue through planning, execution, verification, repair, and review.
