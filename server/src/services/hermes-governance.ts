type GovernedIssueValidationInput = {
  taskId: string | null;
  agentId: string | null;
  taskTitle: string | null;
  taskBody: string | null;
};

export type PaperclipApiAllowedRequest = {
  method: "GET" | "POST" | "PATCH";
  pathPattern: string;
  maxCalls: number;
  summaryPath: string;
};

export type PaperclipApiGovernancePolicy = {
  mode: "issue_validation_narrow";
  reason: string;
  allowedRequests: Array<PaperclipApiAllowedRequest>;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeFreeText(value: string | null): string {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function looksLikeGovernedValidationTask(input: {
  taskTitle: string | null;
  taskBody: string | null;
}): boolean {
  const text = `${normalizeFreeText(input.taskTitle)}\n${normalizeFreeText(input.taskBody)}`;
  if (!text) return false;

  const hasValidationVerb =
    text.includes("validate") ||
    text.includes("validation") ||
    text.includes("revalidation") ||
    text.includes("pass/fail evidence");

  const hasStructuredContract =
    text.includes("acceptance criteria") ||
    text.includes("pass/fail evidence") ||
    text.includes("do not call /api/agents/{agentid}/wakeup") ||
    text.includes("do not call top-level /api/runs") ||
    text.includes("bare /api") ||
    text.includes("keep api reads") ||
    text.includes("only read instructions.md, bundle.json, and shared-context.json") ||
    text.includes("issue-backed planner execution");

  const requestsPlannerFanoutProof =
    text.includes("fan-out") ||
    text.includes("fan out") ||
    text.includes("child runs") ||
    text.includes("worker childoutput") ||
    text.includes("worker child outputs") ||
    text.includes("worker artifacts") ||
    text.includes("reviewerdecision") ||
    text.includes("reviewer decisions") ||
    text.includes("planner synthesis") ||
    text.includes("accepted child outputs") ||
    text.includes("accepted artifacts");

  return hasValidationVerb && hasStructuredContract && !requestsPlannerFanoutProof;
}

export function derivePaperclipApiGovernancePolicy(
  input: GovernedIssueValidationInput,
): PaperclipApiGovernancePolicy | null {
  if (!input.taskId || !input.agentId) return null;
  if (!looksLikeGovernedValidationTask(input)) return null;

  const issueIdPattern = escapeRegex(input.taskId);
  const agentIdPattern = escapeRegex(input.agentId);

  return {
    mode: "issue_validation_narrow",
    reason: "issue title/body indicates a governed validation workflow with explicit acceptance criteria",
    allowedRequests: [
      {
        method: "GET",
        pathPattern: `^/api/issues/${issueIdPattern}$`,
        maxCalls: 2,
        summaryPath: `/api/issues/${input.taskId}`,
      },
      {
        method: "GET",
        pathPattern: `^/api/issues/${issueIdPattern}/runs$`,
        maxCalls: 1,
        summaryPath: `/api/issues/${input.taskId}/runs`,
      },
      {
        method: "GET",
        pathPattern: `^/api/agents/${agentIdPattern}$`,
        maxCalls: 1,
        summaryPath: `/api/agents/${input.agentId}`,
      },
      {
        method: "POST",
        pathPattern: `^/api/issues/${issueIdPattern}/comments$`,
        maxCalls: 1,
        summaryPath: `/api/issues/${input.taskId}/comments`,
      },
      {
        method: "PATCH",
        pathPattern: `^/api/issues/${issueIdPattern}$`,
        maxCalls: 1,
        summaryPath: `/api/issues/${input.taskId}`,
      },
    ],
  };
}

export function buildPaperclipApiGovernanceSummary(policy: PaperclipApiGovernancePolicy | null): string | null {
  if (!policy) return null;
  const lines: string[] = [
    `mode=${policy.mode}`,
    `reason=${policy.reason}`,
    "allowed requests:",
    ...policy.allowedRequests.map(
      (rule) => `- ${rule.method} ${rule.summaryPath} (max ${rule.maxCalls})`,
    ),
  ];
  return lines.join("\n");
}
