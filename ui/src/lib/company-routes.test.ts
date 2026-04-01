import { describe, expect, it } from "vitest";
import { applyCompanyPrefix, extractCompanyPrefixFromPath, toCompanyRelativePath } from "./company-routes";

describe("company route helpers", () => {
  it("treats managed-skills as a board route root for prefix application", () => {
    expect(applyCompanyPrefix("/managed-skills", "sha")).toBe("/SHA/managed-skills");
  });

  it("does not mistake a managed-skills route for a company prefix", () => {
    expect(extractCompanyPrefixFromPath("/managed-skills")).toBeNull();
  });

  it("converts prefixed managed-skills routes back to company-relative form", () => {
    expect(toCompanyRelativePath("/SHA/managed-skills")).toBe("/managed-skills");
  });
});
