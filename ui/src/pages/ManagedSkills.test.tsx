// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  selectedCompanyId: "company-1" as string | null,
  managedSkills: [] as Array<{
    id: string;
    companyId: string;
    name: string;
    slug: string;
    description: string | null;
    bodyMarkdown: string;
    status: "active" | "archived";
    createdAt: string;
    updatedAt: string;
  }>,
}));

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: mockState.selectedCompanyId,
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: mockSetBreadcrumbs,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

import { ManagedSkills } from "./ManagedSkills";

describe("ManagedSkills page", () => {
  beforeEach(() => {
    mockSetBreadcrumbs.mockReset();
    mockInvalidateQueries.mockReset();
    mockState.selectedCompanyId = "company-1";
    mockState.managedSkills = [];
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (Array.isArray(queryKey) && queryKey[0] === "managed-skills" && queryKey.length === 2) {
        return {
          data: mockState.managedSkills,
          isLoading: false,
          error: null,
        };
      }
      return {
        data: [],
        isLoading: false,
        error: null,
      };
    });
  });

  it("renders the company selection empty state when no company is selected", () => {
    mockState.selectedCompanyId = null;

    const html = renderToStaticMarkup(<ManagedSkills />);

    expect(html).toContain("Select a company to view managed skills.");
  });

  it("renders an empty state when the company has no managed skills", () => {
    const html = renderToStaticMarkup(<ManagedSkills />);

    expect(html).toContain("Managed Skills");
    expect(html).toContain("No managed skills created yet.");
    expect(html).toContain("Effective preview");
    expect(html).toContain("New managed skill");
  });

  it("renders managed skill cards with edit and scope actions", () => {
    mockState.managedSkills = [
      {
        id: "skill-1",
        companyId: "company-1",
        name: "Research UI",
        slug: "research-ui",
        description: "Improve UI research prompts",
        bodyMarkdown: "# Research UI",
        status: "active",
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:05:00.000Z",
      },
      {
        id: "skill-2",
        companyId: "company-1",
        name: "Archived Research UI",
        slug: "archived-research-ui",
        description: "Archived variant",
        bodyMarkdown: "# Archived Research UI",
        status: "archived",
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:05:00.000Z",
      },
    ];

    const html = renderToStaticMarkup(<ManagedSkills />);

    expect(html).toContain("Research UI");
    expect(html).toContain("research-ui");
    expect(html).toContain("Improve UI research prompts");
    expect(html).toContain("Scopes");
    expect(html).toContain("Edit");
    expect(html).toContain("Archive");
    expect(html).toContain("Restore");
  });
});
