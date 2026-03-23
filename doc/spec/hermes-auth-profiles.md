# Hermes Auth Profiles Spec

Status: Draft
Date: 2026-03-23
Audience: Product + Engineering
Scope: Paperclip-managed Hermes bootstrap and auth reuse for workers with company-scoped durable state plus isolated run/workspace scratch state

## 1. Purpose

This document defines how Paperclip should support Hermes provider authentication reuse and managed Hermes bootstrap across many Hermes workers without forcing each worker/container to re-authenticate from scratch.

The immediate need is local-first reuse of already-configured Hermes auth (for example Codex auth stored in `~/.hermes/auth.json`), but the target architecture is a Paperclip-managed company Hermes home that does not depend on a host-local `~/.hermes` at runtime.

## 2. Core Decision

Provider auth for Hermes should be configured once and reused.

But Hermes runtime state should be split into company-durable state and isolated run/workspace-local scratch state.

Therefore the architecture must split Hermes runtime state into:
- Paperclip-managed shared auth/bootstrap profile data
- company-scoped durable Hermes home state
- run/workspace-local private Hermes scratch state

## 3. State Layers

### 3.1 Shared Hermes auth profile

This layer contains durable provider login/auth artifacts that should be reused across workers.

Examples:
- `auth.json`
- selected provider config
- shared provider-related `.env` values when intentionally allowed
- optional runtime config defaults that are safe to share

### 3.2 Company-scoped Hermes durable state

This layer is shared by Hermes workers within one Paperclip company and is managed by Paperclip as the durable Hermes home.

Examples:
- shared memories that should help multiple company agents
- shared skills
- durable Hermes config defaults
- long-lived company-specific operating conventions

### 3.3 Run/workspace-local Hermes scratch state

This layer is private to one execution workspace or run.

Examples:
- session DB / short-lived conversation history
- temporary checkpoints
- workspace-local scratch notes
- run-local caches or state that should not automatically become company-wide durable memory

### 3.4 Paperclip-managed scoped secrets/context

This layer is owned by Paperclip and injected per run.

Examples:
- `PAPERCLIP_API_KEY`
- runtime bundle paths
- issue/project/company IDs
- policy flags
- project/company secrets

## 4. Why a split model is required

If all Hermes workers share one complete unmanaged `HERMES_HOME` with no layering or policy, then:
- sessions bleed across runs in unsafe ways
- accidental writes can corrupt durable state
- auditability becomes worse
- workers can smuggle coordination through uncontrolled side effects

If every Hermes worker authenticates separately and keeps a fully isolated durable home, then:
- setup is repetitive and fragile
- shared learning is fragmented
- company-level memory/skills do not compound over time
- provider auth becomes an operational bottleneck

So the right model is:
- shared auth/bootstrap managed by Paperclip
- company-scoped durable Hermes state
- isolated run/workspace-local scratch state

## 5. Local-first implementation target

For the current local Dockerized Paperclip setup, the first implementation target remains a migration-friendly bootstrap path:

1. optionally mount the host Hermes home into the Paperclip server container as a read-only bootstrap source
2. import or copy selected bootstrap/auth files into Paperclip-managed company state
3. materialize a company-scoped managed `HERMES_HOME` for the company
4. give each Hermes run isolated workspace/run-local scratch areas alongside that company durable home
5. run Hermes against the managed company home plus run-local execution context

This gives:
- one-time auth/bootstrap from an existing machine when convenient
- reusable auth inside the Paperclip runtime
- company-shared durable memories/skills/config
- isolated execution scratch state
- a path to fresh deployments with no host `~/.hermes`

## 6. Shared auth source

Default local bootstrap source path:
- host: `${HOME}/.hermes`
- container mount: `/paperclip/shared/hermes-home-source`

This source should be mounted read-only when used.
It is a bootstrap/import source, not the target long-lived runtime home for production workers.

## 7. Managed Hermes home and scratch state

Paperclip should provision a company-scoped managed Hermes home rooted under Paperclip-managed company storage.

Example durable home:
- `/paperclip/instances/default/companies/<company-id>/hermes-home`

Paperclip should set:
- `HERMES_HOME=<company-managed-home>`

In addition, each run should get isolated writable scratch areas rooted under its execution workspace or run workspace.

Example scratch roots:
- `/paperclip/instances/default/workspaces/<agent-id>`
- `/paperclip/instances/default/runs/<run-id>/scratch`

This split keeps durable company memory/skills/config separate from throwaway execution state.

## 8. What gets imported from a shared bootstrap source

Initial local-first bootstrap allowlist:
- `auth.json`
- `.env` (optional and policy-sensitive; include only when intentionally desired)
- `config.yaml` (optional; include only if needed for provider/runtime behavior)

Do not import by default from a host bootstrap source:
- sessions
- state DB
- memories
- skills
- checkpoints
- browser screenshots
- cron jobs
- logs

Recommended v1 default behavior:
- import `auth.json` into Paperclip-managed company state
- optionally import `.env` and `config.yaml` when present and explicitly allowed
- never import sessions/memory/state DB from the host bootstrap source

Important distinction:
- after bootstrap, Paperclip-managed company Hermes memory/skills may grow inside the managed durable home
- that does not imply Paperclip should continuously mirror a host `~/.hermes`

## 9. Auth profile abstraction in Paperclip

Long-term, Paperclip should model this explicitly as a reusable auth profile instead of only a filesystem convention.

Suggested entity shape:
- `id`
- `name`
- `description`
- `providerCapabilities`
- `sourceType` (`local_fs`, `secret_bundle`, later `remote_runner_profile`)
- `sourcePath` or managed ref
- `allowedCompanyIds`
- `allowedProjectIds`
- `allowedAgentIds` / role classes
- metadata / timestamps

But the initial local implementation can ship without a DB table if the behavior is otherwise clear and testable.

## 10. Security constraints

- shared auth source should be mounted read-only
- worker home should be writable and private
- Paperclip must not silently merge all worker state into one shared home
- profile reuse must be explicit and auditable
- future higher-trust and lower-trust worker groups should support separate auth profiles

## 11. Runtime behavior contract

Before Hermes execution, Paperclip should:

1. resolve the company-managed Hermes home path
2. ensure it exists
3. import or sync allowed bootstrap/auth files into managed company state when a bootstrap source is configured
4. inject `HERMES_HOME` into the Hermes runtime env
5. provision isolated run/workspace-local scratch paths separately from the durable home
6. inject Paperclip run-specific env separately
7. materialize the runtime bundle into the worker workspace/home
8. ensure the Paperclip control-plane filesystem is not exposed as a writable worker mount

## 12. Codex-specific local-first goal

The first proof point for this system is:
- Codex auth may already exist in host `~/.hermes/auth.json`
- Paperclip Docker container can mount host `~/.hermes` read-only as an import/bootstrap source
- Paperclip imports `auth.json` into managed company Hermes state
- Hermes worker runs use the managed company `HERMES_HOME` plus isolated scratch state
- Hermes can reuse the existing Codex auth without re-login
- the runtime machine can later run without depending on the original host `~/.hermes`

Important nuance:
- shared auth alone is not enough if the worker model/provider configuration still points at the wrong provider
- for example, a worker defaulting to `anthropic/claude-sonnet-4` will still fail even if Codex auth is present
- Paperclip must eventually align Hermes default model/provider selection with the active shared auth profile or make the operator choose explicitly

## 13. Validation standard

A Hermes auth-profile slice is not done until:
- local Docker Paperclip still boots
- Hermes environment test succeeds or degrades clearly when auth is intentionally unavailable
- browser validation confirms Hermes agent configuration still works in the Paperclip UI
- managed company Hermes home is durable across runs
- run/workspace-local scratch state remains isolated
- any bootstrap source is not writable by the worker runtime
- the Paperclip control-plane filesystem is not exposed as a writable worker mount

## 14. Future extensions

Later enhancements can add:
- first-class auth profile DB tables and UI
- multiple named auth profiles
- company/project-scoped auth profile assignment
- remote runner auth profile syncing
- selective provider-specific auth discovery surfaced in Paperclip UI
- dynamic Hermes model/provider discovery based on the active auth profile
