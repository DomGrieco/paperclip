export type AuthContextNotice = {
  title: string;
  message: string;
};

export function getAuthContextNotice(nextPath: string | null | undefined): AuthContextNotice | null {
  const normalized = (nextPath ?? "").trim();
  if (!normalized) {
    return null;
  }

  if (/^\/board-claim\//.test(normalized)) {
    return {
      title: "Board claim in progress",
      message:
        "Sign in or create an account to continue the board ownership claim. Paperclip will bring you back to the claim challenge automatically after authentication.",
    };
  }

  if (/^\/invite\//.test(normalized)) {
    return {
      title: "Invite ready to accept",
      message:
        "Authenticate first, then Paperclip will return you to the invite so you can finish joining without restarting the flow.",
    };
  }

  return null;
}