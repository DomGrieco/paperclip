import { describe, expect, it } from "vitest";
import { getAuthContextNotice } from "./authContext";

describe("getAuthContextNotice", () => {
  it("returns a board-claim notice for board claim redirects", () => {
    expect(getAuthContextNotice("/board-claim/demo-token?code=abc123")).toEqual({
      title: "Board claim in progress",
      message:
        "Sign in or create an account to continue the board ownership claim. Paperclip will bring you back to the claim challenge automatically after authentication.",
    });
  });

  it("returns an invite notice for invite redirects", () => {
    expect(getAuthContextNotice("/invite/demo-token")).toEqual({
      title: "Invite ready to accept",
      message:
        "Authenticate first, then Paperclip will return you to the invite so you can finish joining without restarting the flow.",
    });
  });

  it("returns null for generic destinations", () => {
    expect(getAuthContextNotice("/")).toBeNull();
    expect(getAuthContextNotice(null)).toBeNull();
  });
});