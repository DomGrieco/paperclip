# Hermes Adapter Audit And Paperclip Dogfood Findings

Status: Working notes / implementation input
Date: 2026-03-22
Audience: Engineering
Scope: Current-state audit of the existing `hermes_local` adapter plus local Docker/browser dogfooding findings from the Paperclip UI

## 1. Why this doc exists

Before implementing the Hermes fleet architecture, we need a precise view of what already exists and where the current system falls short.

This document captures:
- what the current `hermes_local` adapter already does well
- what gaps prevent it from serving as the long-term Hermes fleet runtime surface
- what Paperclip UI/runtime dogfooding already revealed in local Docker testing

## 2. Environment tested

Local machine:
- macOS
- Docker available locally
- Paperclip repo at `/Users/eru/Documents/GitHub/paperclip`
- Paperclip started via `make run`
- Browser testing performed against `http://localhost:3100`

## 3. Current Hermes integration surface

Paperclip already includes a server-side `hermes_local` adapter registration in `server/src/adapters/registry.ts`.
It depends on the published npm package `hermes-paperclip-adapter`.

The current package exposes:
- server module
  - `execute`
  - `testEnvironment`
  - `sessionCodec`
- ui module
  - `parseHermesStdoutLine`
  - `buildHermesConfig`
- cli module
  - `printHermesStreamEvent`

## 4. What the current adapter already does well

### 4.1 Basic one-shot execution works conceptually

The adapter runs Hermes via CLI in one-shot mode:
- `hermes chat -q <prompt>`
- quiet mode enabled by default
- model passed explicitly
- toolsets can be enabled
- provider may be passed when valid
- prior session can be resumed with `--resume`

This is already enough for a basic Paperclip heartbeat -> Hermes execution loop.

### 4.2 Session continuity is already modeled

The adapter has a real `sessionCodec` and stores Hermes `sessionId` values for reuse across heartbeats.
That aligns well with the Paperclip heartbeat/session model.

### 4.3 Environment testing exists

The adapter already performs basic environment checks:
- Hermes CLI presence
- Hermes version check
- Python availability
- model selection visibility
- presence of likely API keys

That gives a decent starting operator experience.

### 4.4 Generic Hermes configuration already exists

The current adapter supports at least these config concepts:
- model
- provider
- timeoutSec
- graceSec
- enabled toolsets
- extra args
- persistSession
- worktreeMode
- checkpoints
- custom CLI path
- promptTemplate
- env map
- cwd

That is a useful baseline for the future fleet contract.

## 5. Current adapter gaps

These are the most important gaps discovered in the current `hermes_local` implementation.

### 5.1 No UI registration in Paperclip’s frontend adapter registry

Paperclip server knows about `hermes_local`, but the current UI does not.

Observed in code:
- server adapter registry includes `hermes_local`
- UI adapter registry does not include `hermes_local`
- advanced new-agent picker does not list Hermes
- invite/join adapter labels do not include Hermes
- org chart / other adapter label maps do not include Hermes

Observed in browser:
- “New agent” advanced configuration does not show Hermes at all

Impact:
- operator cannot configure Hermes agents through the normal UI even though the server/runtime supports them

### 5.2 Current prompt contract is too primitive for long-term fleet use

The current adapter prompt is a static text template that instructs Hermes to:
- use terminal + curl for localhost Paperclip API calls
- query issue queues manually
- patch issue status directly via curl

This is useful as a bootstrap mechanism, but it is not a proper runtime bundle contract.

Impact:
- no structured runtime projection
- no governed memory recall packet
- no issue/run/evidence contract beyond prompt text
- too much behavior encoded as ad hoc shell instructions

### 5.3 Auth token is injected by Paperclip but not consumed by the adapter prompt

Paperclip heartbeat execution creates a local agent JWT for adapters that support it.
The Hermes adapter is marked `supportsLocalAgentJwt: true`.
However, the current Hermes adapter execution path does not appear to use `ctx.authToken` when building the runtime prompt or CLI environment in a meaningful way.

The default prompt examples also show bare curl commands without an authorization header.

Impact:
- local-auth integration is incomplete or at least not explicit
- the prompt contract is fragile and under-specified
- worker API access depends on ambient assumptions instead of a clear runtime auth surface

### 5.4 No container-native Hermes runtime target yet

Current adapter target is `hermes_local` only.
That means:
- local process execution
- no first-class `hermes_container`
- no runner-plane orchestration contract for isolated sibling containers

Impact:
- current implementation does not match the long-term production architecture
- Paperclip-in-Docker cannot yet cleanly treat Hermes as an isolated worker fleet through a dedicated runtime target

### 5.5 No Paperclip-governed shared-context publication flow

The current adapter supports Hermes local memory and local sessions, but there is no explicit Paperclip-level shared knowledge publication path.

Impact:
- not suitable yet for multi-agent shared-context governance
- too much cross-agent knowledge would be implicit or hidden if scaled up without additional work

### 5.6 Runtime bundle materialization is not yet Hermes-specific

Paperclip already has runtime-bundle materialization utilities in adapter-utils, but the Hermes adapter currently works primarily from prompt text.

Impact:
- Hermes fleet architecture needs an explicit projection contract
- current integration is not taking advantage of Paperclip’s evolving runtime-bundle direction

### 5.7 Output parsing is useful but still thin

The adapter parses:
- session ID
- response summary
- rough token usage
- rough cost
- some error lines

This is enough for a first pass but not enough for a fully governed software-company loop where we want:
- evidence references
- runtime bundle visibility
- artifact publication
- structured verifier outputs
- richer state transitions

## 6. Browser dogfood findings

## 6.1 Positive findings

### 6.1.1 Dockerized Paperclip boots successfully

`make run` completed successfully and the app became available at `http://localhost:3100`.

### 6.1.2 Auth flow works

Observed:
- sign-in page loads
- “create account” flow works
- account creation succeeds
- login succeeds

### 6.1.3 Bootstrap invite flow works

Using a forced bootstrap CEO invite generated inside the running Docker container:
- invite landing page loaded correctly
- “Accept bootstrap invite” succeeded
- “Bootstrap complete” page appeared
- board/dashboard opened successfully after acceptance

### 6.1.4 Existing board/dashboard experience loads

Observed after bootstrap:
- dashboard renders correctly
- sidebar and company navigation render
- live run cards render
- recent activity renders
- existing agents and runs are visible

## 6.2 Negative findings / product gaps

### 6.2.1 Fresh account onboarding blocked at company creation

Observed flow:
- create new account
- land in onboarding modal/wizard
- company naming step visible
- after entering company name and mission, the UI shows:
  - `Instance admin required`
- browser console also recorded a 403 during this flow

Impact:
- onboarding is not self-explanatory for non-admin users on this instance state
- this should be treated as either a UX bug, a policy bug, or a missing flow explanation

### 6.2.2 Onboarding modal close behavior appears ineffective

Observed:
- clicking `Close` during the onboarding wizard did not visibly dismiss the modal in browser testing

This needs confirmation in source and probably a focused repro, but it is worth tracking.

### 6.2.3 Hermes adapter is missing from the New Agent advanced UI

Observed in browser:
- “Add a new agent” -> “I want advanced configuration myself”
- available adapters shown:
  - Claude
  - Codex
  - Gemini
  - OpenCode
  - Pi
  - Cursor
  - OpenClaw Gateway
- Hermes not shown

This is a concrete product bug relative to the backend capabilities.

## 7. Immediate implementation recommendations

### 7.1 First UI/runtime slice

Add first-class frontend support for `hermes_local`:
- UI adapter registration
- adapter labels in UI maps
- new-agent picker visibility
- invite/join labels where appropriate
- transcript parser integration through the UI adapter registry

This is the smallest high-value implementation slice because it closes an obvious server/UI mismatch.

Status update:
- completed locally in this workstream
- Hermes now appears in the advanced new-agent picker
- Hermes now resolves through the Paperclip UI adapter registry
- Hermes now renders in agent configuration/detail label surfaces
- Hermes environment tests can be triggered from the UI

### 7.2 Next architecture slice

After UI support lands, implement a Hermes runtime-bundle contract:
- explicit Paperclip -> Hermes runtime projection
- env contract
- auth token usage contract
- scoped recall packet
- output/artifact publication contract

### 7.3 Next runner slice

After the runtime contract is explicit, add the runner-plane/container execution design:
- define `hermes_container`
- define sibling-container execution topology
- avoid default DinD

## 8. Validation required for upcoming slices

For Hermes-related Paperclip changes, require:
- typecheck
- relevant unit tests
- build
- Dockerized app smoke
- browser validation of affected flows

Minimum browser flow for the next slice:
- create/open board
- open “New agent” advanced config
- confirm Hermes appears as a selectable adapter
- confirm Hermes-specific configuration form renders correctly

## 9. Recommended commit ordering from here

1. docs: add hermes fleet control plane spec and plan
2. docs: add hermes adapter audit and dogfood findings
3. feat: add hermes adapter to Paperclip UI registry and new-agent flows
4. docs: cross-link hermes fleet architecture into strategic specs
5. feat: add hermes runtime bundle contract
6. feat: add runner-plane/container orchestration support
