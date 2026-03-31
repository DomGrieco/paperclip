# Managed Skills Post-v1 Backlog

Date: 2026-03-31

## Confirmed follow-up items

### 1. Cursor issue-create path can still 500 for fresh assigned validation issues
Observed while attempting to create a new Cursor-assigned managed-skill validation issue through:
- `POST /api/companies/{companyId}/issues`
- with `assigneeAgentId = b53b153d-4ec9-4eb4-b801-886af4cfca05`

Observed behavior:
- request returned `500 Internal server error`
- direct Cursor wakeup still succeeded
- existing Cursor-assigned issues (`PAP-32`, `PAP-38`) also completed successfully and proved runtime propagation

Why this is post-v1 instead of blocking v1:
- live Cursor managed-skill company-scope propagation is already proven
- the remaining defect appears specific to one issue-creation / wakeup path, not the managed-skill materialization itself

Recommended follow-up:
- reproduce under focused test coverage around issue creation with Cursor assignee
- inspect whether the issue-create wake path throws synchronously for Cursor while direct `/agents/:id/wakeup` succeeds
- add a regression test once root cause is identified

### 2. Cross-adapter runtime shape is not fully uniform
Observed:
- Hermes logs showed governed runtime reads from `instructions.md`, `bundle.json`, and `shared-context.json`
- Cursor evidence came from materialized skill files under `.paperclip/runtime/skills/...`

Why this matters:
- the product behavior is acceptable, but operator/debug expectations differ by adapter
- evidence collection and troubleshooting should not assume every adapter exposes the same runtime file layout

Recommended follow-up:
- document adapter-specific runtime evidence locations more explicitly
- consider a normalized lightweight runtime manifest available to every adapter

### 3. Agent-authored comment attribution may be worth auditing separately
During board-side API reads, several agent-generated issue comments appeared with `createdByAgentId` as `null` in the returned payloads, even though live run evidence strongly suggests agent authorship.

Why this is not blocking v1:
- comments, run IDs, and run logs still provide enough evidence for managed-skill validation
- managed-skill behavior itself was validated successfully

Recommended follow-up:
- audit issue comment serialization / attribution in board reads
- verify whether this is response shaping, activity-log mismatch, or persistence behavior

### 4. Hermes QA project proof still used some avoidable probing
The Hermes QA project-scope run succeeded and produced correct evidence, but the run log still showed some avoidable failed lookups before posting the final sentinel comment.

Why this is post-v1:
- correctness and scope outcome were still achieved
- no timeout or broad environment spiral occurred

Recommended follow-up:
- continue tightening managed-skill validation prompts so project/agent proof runs stay as narrow as the strongest Hermes CEO and Codex examples

## Operator guidance

For future managed-skill validation reruns, prefer:
- Hermes CEO or Hermes QA for narrow proof tasks
- Codex Engineer for deterministic runtime file confirmation
- Cursor Engineer using an already-assigned issue or a tested wake path until the fresh issue-create 500 is root-caused
