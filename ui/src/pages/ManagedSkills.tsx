import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Eye, Pencil, Plus, SlidersHorizontal } from "lucide-react";
import type { Agent, ManagedSkill, ManagedSkillScopeAssignment, Project } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { managedSkillsApi } from "../api/managed-skills";
import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type ManagedSkillFormState = {
  name: string;
  slug: string;
  description: string;
  bodyMarkdown: string;
  status: "active" | "archived";
};

type ScopeDraftState = {
  companyEnabled: boolean;
  projectIds: string[];
  agentIds: string[];
};

type PreviewFilterState = {
  projectId: string;
  agentId: string;
};

const EMPTY_FORM: ManagedSkillFormState = {
  name: "",
  slug: "",
  description: "",
  bodyMarkdown: "",
  status: "active",
};

const EMPTY_SCOPE_DRAFT: ScopeDraftState = {
  companyEnabled: false,
  projectIds: [],
  agentIds: [],
};

const EMPTY_PREVIEW_FILTERS: PreviewFilterState = {
  projectId: "",
  agentId: "",
};

function formatTimestamp(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function toFormState(skill: ManagedSkill | null): ManagedSkillFormState {
  if (!skill) return EMPTY_FORM;
  return {
    name: skill.name,
    slug: skill.slug,
    description: skill.description ?? "",
    bodyMarkdown: skill.bodyMarkdown,
    status: skill.status,
  };
}

function toScopeDraft(scopes: ManagedSkillScopeAssignment[] | undefined): ScopeDraftState {
  if (!scopes) return EMPTY_SCOPE_DRAFT;
  return {
    companyEnabled: scopes.some((scope) => scope.scopeType === "company"),
    projectIds: scopes.filter((scope) => scope.scopeType === "project" && scope.projectId).map((scope) => scope.projectId!),
    agentIds: scopes.filter((scope) => scope.scopeType === "agent" && scope.agentId).map((scope) => scope.agentId!),
  };
}

function toggleSelection(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function ManagedSkills() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<ManagedSkill | null>(null);
  const [formState, setFormState] = useState<ManagedSkillFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const [scopeEditorOpen, setScopeEditorOpen] = useState(false);
  const [scopeSkill, setScopeSkill] = useState<ManagedSkill | null>(null);
  const [scopeDraft, setScopeDraft] = useState<ScopeDraftState>(EMPTY_SCOPE_DRAFT);
  const [scopeError, setScopeError] = useState<string | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFilters, setPreviewFilters] = useState<PreviewFilterState>(EMPTY_PREVIEW_FILTERS);

  useEffect(() => {
    setBreadcrumbs([{ label: "Managed Skills" }]);
  }, [setBreadcrumbs]);

  const listQueryKey = useMemo(
    () => (selectedCompanyId ? queryKeys.managedSkills.list(selectedCompanyId) : (["managed-skills", "no-company"] as const)),
    [selectedCompanyId],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => managedSkillsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : (["projects", "no-company"] as const),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : (["agents", "no-company"] as const),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const scopeQuery = useQuery({
    queryKey:
      selectedCompanyId && scopeSkill
        ? queryKeys.managedSkills.scopes(selectedCompanyId, scopeSkill.id)
        : (["managed-skills", "scopes", "idle"] as const),
    queryFn: () => managedSkillsApi.listScopes(selectedCompanyId!, scopeSkill!.id),
    enabled: !!selectedCompanyId && !!scopeSkill && scopeEditorOpen,
  });

  const effectivePreviewQuery = useQuery({
    queryKey:
      selectedCompanyId && previewOpen
        ? queryKeys.managedSkills.effectivePreview(
            selectedCompanyId,
            previewFilters.projectId || null,
            previewFilters.agentId || null,
          )
        : (["managed-skills", "effective-preview", "idle"] as const),
    queryFn: () =>
      managedSkillsApi.effectivePreview(selectedCompanyId!, {
        projectId: previewFilters.projectId || null,
        agentId: previewFilters.agentId || null,
      }),
    enabled: !!selectedCompanyId && previewOpen,
  });

  useEffect(() => {
    if (!scopeEditorOpen) return;
    setScopeDraft(toScopeDraft(scopeQuery.data));
  }, [scopeEditorOpen, scopeQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("No company selected");
      const payload = {
        name: formState.name.trim(),
        slug: formState.slug.trim() || undefined,
        description: formState.description.trim() || null,
        bodyMarkdown: formState.bodyMarkdown,
        status: formState.status,
      };
      if (!payload.name) throw new Error("Name is required");
      if (!payload.bodyMarkdown.trim()) throw new Error("Body markdown is required");
      if (editingSkill) {
        return managedSkillsApi.update(selectedCompanyId, editingSkill.id, payload);
      }
      return managedSkillsApi.create(selectedCompanyId, payload);
    },
    onSuccess: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.managedSkills.list(selectedCompanyId) });
      setEditorOpen(false);
      setEditingSkill(null);
      setFormState(EMPTY_FORM);
      setFormError(null);
    },
    onError: (mutationError) => {
      setFormError(mutationError instanceof Error ? mutationError.message : "Failed to save managed skill");
    },
  });

  const saveScopesMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId || !scopeSkill) throw new Error("No managed skill selected");
      const assignments: Array<{ scopeType: "company" | "project" | "agent"; projectId?: string; agentId?: string }> = [];
      if (scopeDraft.companyEnabled) {
        assignments.push({ scopeType: "company" });
      }
      for (const projectId of scopeDraft.projectIds) {
        assignments.push({ scopeType: "project", projectId });
      }
      for (const agentId of scopeDraft.agentIds) {
        assignments.push({ scopeType: "agent", agentId });
      }
      return managedSkillsApi.replaceScopes(selectedCompanyId, scopeSkill.id, assignments);
    },
    onSuccess: async () => {
      if (!selectedCompanyId || !scopeSkill) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.managedSkills.scopes(selectedCompanyId, scopeSkill.id) });
      setScopeError(null);
      setScopeEditorOpen(false);
      setScopeSkill(null);
    },
    onError: (mutationError) => {
      setScopeError(mutationError instanceof Error ? mutationError.message : "Failed to save scope assignments");
    },
  });

  function openCreateEditor() {
    setEditingSkill(null);
    setFormState(EMPTY_FORM);
    setFormError(null);
    setEditorOpen(true);
  }

  function openEditEditor(skill: ManagedSkill) {
    setEditingSkill(skill);
    setFormState(toFormState(skill));
    setFormError(null);
    setEditorOpen(true);
  }

  function openScopeEditor(skill: ManagedSkill) {
    setScopeSkill(skill);
    setScopeDraft(EMPTY_SCOPE_DRAFT);
    setScopeError(null);
    setScopeEditorOpen(true);
  }

  function updateField<K extends keyof ManagedSkillFormState>(key: K, value: ManagedSkillFormState[K]) {
    setFormState((current) => ({ ...current, [key]: value }));
  }

  function updateScopeDraft<K extends keyof ScopeDraftState>(key: K, value: ScopeDraftState[K]) {
    setScopeDraft((current) => ({ ...current, [key]: value }));
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={BookOpen} message="Select a company to view managed skills." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-semibold">Managed Skills</h1>
                <p className="text-sm text-muted-foreground">
                  Govern company-defined skill content and scope precedence alongside built-in Paperclip skills.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPreviewOpen(true)} className="gap-2">
                <Eye className="h-4 w-4" />
                Effective preview
              </Button>
              <Button onClick={openCreateEditor} className="gap-2">
                <Plus className="h-4 w-4" />
                New managed skill
              </Button>
            </div>
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}

        {!data || data.length === 0 ? (
          <EmptyState icon={BookOpen} message="No managed skills created yet." />
        ) : (
          <div className="space-y-3">
            {data.map((skill) => (
              <div key={skill.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{skill.name}</h2>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {skill.status}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{skill.slug}</code>
                    </div>
                    {skill.description ? (
                      <p className="text-sm text-muted-foreground">{skill.description}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No description provided.</p>
                    )}
                    <div className="text-xs text-muted-foreground">Updated {formatTimestamp(skill.updatedAt)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => openScopeEditor(skill)}>
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Scopes
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => openEditEditor(skill)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingSkill ? "Edit managed skill" : "Create managed skill"}</DialogTitle>
            <DialogDescription>
              Managed skills override built-in skills by slug/name according to company, project, and agent precedence.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="managed-skill-name">Name</Label>
                <Input
                  id="managed-skill-name"
                  value={formState.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="Research UI"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="managed-skill-slug">Slug</Label>
                <Input
                  id="managed-skill-slug"
                  value={formState.slug}
                  onChange={(event) => updateField("slug", event.target.value)}
                  placeholder="research-ui"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <div className="space-y-2">
                <Label htmlFor="managed-skill-description">Description</Label>
                <Textarea
                  id="managed-skill-description"
                  value={formState.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  placeholder="What this skill governs and when to use it"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formState.status} onValueChange={(value) => updateField("status", value as "active" | "archived")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="managed-skill-body">Skill markdown</Label>
              <Textarea
                id="managed-skill-body"
                value={formState.bodyMarkdown}
                onChange={(event) => updateField("bodyMarkdown", event.target.value)}
                placeholder={"---\nname: research-ui\ndescription: Improve UI research prompts\n---\n\n# Research UI\n"}
                rows={16}
                className="font-mono text-xs"
              />
            </div>

            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditorOpen(false);
                setFormError(null);
              }}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : editingSkill ? "Save changes" : "Create skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scopeEditorOpen} onOpenChange={setScopeEditorOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Scope assignments</DialogTitle>
            <DialogDescription>
              Assign {scopeSkill?.name ?? "this managed skill"} at company, project, or agent scope.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <Checkbox
                id="managed-skill-scope-company"
                checked={scopeDraft.companyEnabled}
                onCheckedChange={(checked) => updateScopeDraft("companyEnabled", checked === true)}
              />
              <Label htmlFor="managed-skill-scope-company" className="cursor-pointer">
                Apply at company scope
              </Label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div>
                  <h3 className="text-sm font-medium">Project scopes</h3>
                  <p className="text-xs text-muted-foreground">Applied when runs target matching projects.</p>
                </div>
                <div className="space-y-2">
                  {projects.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No projects available.</p>
                  ) : (
                    projects.map((project: Project) => (
                      <label key={project.id} className="flex items-center gap-3 text-sm">
                        <Checkbox
                          checked={scopeDraft.projectIds.includes(project.id)}
                          onCheckedChange={() =>
                            updateScopeDraft("projectIds", toggleSelection(scopeDraft.projectIds, project.id))
                          }
                        />
                        <span>{project.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border p-3">
                <div>
                  <h3 className="text-sm font-medium">Agent scopes</h3>
                  <p className="text-xs text-muted-foreground">Highest precedence for explicitly targeted agents.</p>
                </div>
                <div className="space-y-2">
                  {agents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No agents available.</p>
                  ) : (
                    agents.map((agent: Agent) => (
                      <label key={agent.id} className="flex items-center gap-3 text-sm">
                        <Checkbox
                          checked={scopeDraft.agentIds.includes(agent.id)}
                          onCheckedChange={() =>
                            updateScopeDraft("agentIds", toggleSelection(scopeDraft.agentIds, agent.id))
                          }
                        />
                        <span>{agent.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>

            {scopeError ? <p className="text-sm text-destructive">{scopeError}</p> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setScopeEditorOpen(false)} disabled={saveScopesMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => saveScopesMutation.mutate()} disabled={saveScopesMutation.isPending || scopeQuery.isLoading}>
              {saveScopesMutation.isPending ? "Saving…" : "Save scopes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Effective skill preview</DialogTitle>
            <DialogDescription>
              Inspect the resolved skill set after built-in, company, project, and agent precedence are applied.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Project filter</Label>
                <Select value={previewFilters.projectId || "__none__"} onValueChange={(value) => setPreviewFilters((current) => ({ ...current, projectId: value === "__none__" ? "" : value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="No project filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No project filter</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Agent filter</Label>
                <Select value={previewFilters.agentId || "__none__"} onValueChange={(value) => setPreviewFilters((current) => ({ ...current, agentId: value === "__none__" ? "" : value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="No agent filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No agent filter</SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {effectivePreviewQuery.isLoading ? (
              <PageSkeleton variant="list" />
            ) : effectivePreviewQuery.error ? (
              <p className="text-sm text-destructive">{effectivePreviewQuery.error.message}</p>
            ) : !effectivePreviewQuery.data || effectivePreviewQuery.data.entries.length === 0 ? (
              <EmptyState icon={Eye} message="No effective skills resolved for the selected filters." />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border px-2 py-1">total {effectivePreviewQuery.data.counts.total}</span>
                  <span className="rounded-full border border-border px-2 py-1">builtin {effectivePreviewQuery.data.counts.builtin}</span>
                  <span className="rounded-full border border-border px-2 py-1">managed {effectivePreviewQuery.data.counts.managed}</span>
                </div>
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {effectivePreviewQuery.data.entries.map((entry) => (
                    <div key={`${entry.name}:${entry.sourceType}:${entry.scopeId ?? "none"}`} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">{entry.name}</div>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {entry.sourceType}
                        </span>
                        {entry.managedSkillId ? (
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {entry.managedSkillId}
                          </code>
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {entry.description || "No description provided."}
                      </div>
                      {entry.candidates.length > 1 ? (
                        <div className="mt-3 space-y-1">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Resolution candidates</div>
                          <div className="flex flex-wrap gap-2">
                            {entry.candidates.map((candidate, index) => (
                              <span
                                key={`${entry.name}:${candidate.sourceType}:${candidate.scopeId ?? "none"}:${index}`}
                                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                {candidate.sourceType}
                                {candidate.managedSkillSlug ? `:${candidate.managedSkillSlug}` : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
