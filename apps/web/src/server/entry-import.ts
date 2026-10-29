import "server-only";

import { createHash } from "node:crypto";

import {
  can,
  clientInputSchema,
  type ColumnMapping,
  type DateFormat,
  entryRulesOf,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  missingRequiredField,
  parseCsv,
  type ParsedImportRow,
  parseImportRows,
  requiredFieldMessage,
  tagInputSchema,
} from "@timekeep/core";
import { type Database, eq, workspaceSettings } from "@timekeep/db";

import type { ImportCreates, ImportPlan, ImportRowResult } from "@/lib/import-types";
import type { PickerProject } from "@/lib/tracker-types";

import { WorkspaceAccessError } from "./access-error";
import { scopeForUser } from "./authz";
import { createClient, listClientOptions } from "./catalog/clients";
import { createProject, listPickerProjects } from "./catalog/projects";
import { createTag, listTags } from "./catalog/tags";
import { createTask, visibleTasksFor } from "./catalog/tasks";
import type { Viewer } from "./catalog/viewer";
import { listMembers } from "./queries/team";
import { createManualEntries, type EntryScope } from "./time-entries";

/**
 * Importing time entries from a CSV (Phase 4b): a dry run resolves every row
 * (its person, project, client, task and tags, the workspace's rules) and
 * reports it as ready or with its error; the commit resolves the same way,
 * refuses to go on if anything changed since (the fingerprint), creates
 * what the person allowed, and writes the ready rows through the entry
 * service in one transaction.
 */

export class ImportError extends Error {}

/** Names to create, one per spelling ignoring case: the first spelling seen stands. */
class NameSet {
  private readonly byKey = new Map<string, string>();
  add(name: string): void {
    const key = lower(name);
    if (!this.byKey.has(key)) this.byKey.set(key, name);
  }
  values(): string[] {
    return [...this.byKey.values()];
  }
}

export interface ImportOptions {
  /** The zone the file's times are in. */
  timezone: string;
  dateFormat: DateFormat;
  /** Create projects, clients, tasks and tags the file names and the workspace lacks. */
  createMissing: boolean;
  mapping: ColumnMapping;
  /** The groups a task created by the import belongs to; required when tasks are by group. */
  newTaskGroupIds?: string[];
}

export type { ImportCreates, ImportPlan, ImportRowResult } from "@/lib/import-types";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

const lower = (s: string) => s.trim().toLowerCase();

/** A ready row: its target and the names it resolves at commit time. */
interface ReadyRow {
  row: ParsedImportRow;
  scope: EntryScope;
  userName: string;
  client: string | null;
  project: string | null;
  task: string | null;
  tags: string[];
}

interface Resolution {
  results: ImportRowResult[];
  ready: ReadyRow[];
  creates: ImportCreates;
  fingerprint: string;
}

/** What the workspace has, by name, per target person (their projects differ). */
class Lookup {
  readonly clients = new Map<string, { id: string }>();
  readonly tags = new Map<string, { id: string; archived: boolean }>();
  readonly projectsByUser = new Map<string, PickerProject[]>();
  constructor(
    private readonly db: Executor,
    readonly workspaceId: string,
  ) {}

  async load(): Promise<void> {
    for (const c of await listClientOptions(this.db, this.workspaceId)) {
      if (!c.archived) this.clients.set(lower(c.name), { id: c.id });
    }
    for (const t of await listTags(this.db, this.workspaceId, { includeArchived: true })) {
      this.tags.set(lower(t.name), { id: t.id, archived: t.archived });
    }
  }

  async projectsFor(scope: EntryScope): Promise<PickerProject[]> {
    let list = this.projectsByUser.get(scope.userId);
    if (!list) {
      // Every project the person may see, so a row naming one whose tasks are
      // all hidden from them is told so, not offered as a project to create.
      list = await listPickerProjects(this.db, scope, { keepProjectsWithHiddenTasks: true });
      this.projectsByUser.set(scope.userId, list);
    }
    return list;
  }

  private readonly hiddenByUser = new Map<string, Map<string, string[]>>();

  /** Active tasks of the project the person may not track on (decision 11): exist, but hidden. */
  async hiddenTaskNames(scope: EntryScope, projectId: string): Promise<string[]> {
    let byProject = this.hiddenByUser.get(scope.userId);
    if (!byProject) {
      byProject = new Map();
      this.hiddenByUser.set(scope.userId, byProject);
    }
    let names = byProject.get(projectId);
    if (!names) {
      const all = await visibleTasksFor(this.db, scope, {
        projectIds: [projectId],
        includeHidden: true,
      });
      names = all.filter((t) => !t.visible).map((t) => t.name);
      byProject.set(projectId, names);
    }
    return names;
  }

  /** A project by name, preferring the given client's. */
  project(list: PickerProject[], name: string, client: string | null): PickerProject | undefined {
    const matches = list.filter((p) => lower(p.name) === lower(name));
    if (client) {
      const withClient = matches.find((p) => lower(p.clientName ?? "") === lower(client));
      if (withClient) return withClient;
    }
    return matches[0];
  }
}

async function resolve(
  db: Executor,
  viewer: Viewer,
  text: string,
  options: ImportOptions,
): Promise<Resolution> {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    throw new ImportError("The file is over 4 MB.");
  }
  const table = parseCsv(text);
  const data = table.slice(1);
  if (data.length > MAX_IMPORT_ROWS) {
    throw new ImportError(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows.`);
  }
  const parsed = parseImportRows(data, options.mapping, options);

  const [settings] = await db
    .select({
      requiredFields: workspaceSettings.requiredFields,
      allowBreaks: workspaceSettings.allowBreaks,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, viewer.workspaceId));
  const rules = entryRulesOf(settings ?? { requiredFields: [], allowBreaks: false });
  const members = (await listMembers(db as Database, viewer.workspaceId)).filter(
    (m) => m.status === "ACTIVE",
  );
  const byEmail = new Map(members.map((m) => [lower(m.email), m]));
  const me = members.find((m) => m.userId === viewer.userId);
  const lookup = new Lookup(db, viewer.workspaceId);
  await lookup.load();
  const scopes = new Map<string, EntryScope | WorkspaceAccessError>();
  const mayCreate = {
    client: can(viewer.actor, "client.create", { kind: "none" }),
    project: can(viewer.actor, "project.create", { kind: "project", projectId: null }),
    tag: can(viewer.actor, "tag.create", { kind: "none" }),
    // A task on a project the import creates: only roles that add tasks anywhere (decision 11).
    taskOnNewProject: can(viewer.actor, "task.create", { kind: "task", projectId: "new" }),
  };
  const byGroup = viewer.actor.settings.taskVisibility === "BY_GROUP";
  const newTaskGroupIds = options.newTaskGroupIds ?? [];
  const creates = {
    clients: new NameSet(),
    projects: new NameSet(),
    tasks: new NameSet(),
    tags: new NameSet(),
  };
  const results: ImportRowResult[] = [];
  const ready: ReadyRow[] = [];

  for (const row of parsed) {
    const base = {
      line: row.line,
      description: row.description,
      start: row.start?.toISOString() ?? null,
      end: row.end?.toISOString() ?? null,
    };
    const fail = (userName: string, message: string) =>
      results.push({ ...base, status: "error", error: `Line ${row.line}: ${message}`, userName });
    if (row.error) {
      results.push({ ...base, status: "error", error: row.error, userName: me?.name ?? "" });
      continue;
    }

    // Whose time: the file's email, else the importer's own.
    const member = row.email ? byEmail.get(row.email) : me;
    if (!member) {
      fail("", `unknown email ${row.email}`);
      continue;
    }
    let scope = scopes.get(member.userId);
    if (!scope) {
      try {
        scope = await scopeForUser(db, viewer, member.userId);
      } catch (error) {
        if (!(error instanceof WorkspaceAccessError)) throw error;
        scope = error;
      }
      scopes.set(member.userId, scope);
    }
    if (scope instanceof WorkspaceAccessError) {
      fail(member.name, `you cannot add time for ${member.email}`);
      continue;
    }
    const actor = scope.actedBy ?? scope.actor;
    if (
      !can(actor, "entry.writeTimes", { kind: "entry", userId: scope.userId, projectId: null })
    ) {
      fail(member.name, "force timer is on: time is added with the timer");
      continue;
    }

    // Client, project, task and tags by name; missing ones are created or refused.
    let clientName: string | null = null;
    if (row.client) {
      if (lookup.clients.has(lower(row.client))) clientName = row.client;
      else if (options.createMissing && mayCreate.client) {
        creates.clients.add(row.client);
        clientName = row.client;
      } else {
        fail(member.name, mayCreate.client ? `unknown client "${row.client}"` : "you cannot create clients here");
        continue;
      }
    }
    let projectHasTasks = false;
    let projectName: string | null = null;
    let existing: PickerProject | undefined;
    if (row.project) {
      existing = lookup.project(await lookup.projectsFor(scope), row.project, clientName);
      if (existing) {
        projectName = existing.name;
        projectHasTasks =
          existing.tasks.length > 0 ||
          (await lookup.hiddenTaskNames(scope, existing.id)).length > 0;
      } else if (options.createMissing && mayCreate.project) {
        creates.projects.add(clientName ? `${row.project} (${clientName})` : row.project);
        projectName = row.project;
      } else {
        fail(member.name, mayCreate.project ? `unknown project "${row.project}"` : "you cannot create projects here");
        continue;
      }
    }
    let taskName: string | null = null;
    if (row.task) {
      if (!projectName) {
        fail(member.name, `task "${row.task}" needs a project`);
        continue;
      }
      const found = existing?.tasks.find((t) => lower(t.name) === lower(row.task!));
      const hidden =
        !found &&
        existing !== undefined &&
        (await lookup.hiddenTaskNames(scope, existing.id)).some(
          (n) => lower(n) === lower(row.task!),
        );
      const mayCreateTask = existing
        ? can(viewer.actor, "task.create", { kind: "task", projectId: existing.id })
        : mayCreate.project && mayCreate.taskOnNewProject;
      if (found) taskName = found.name;
      else if (hidden) {
        // Rule 11: the task exists, but not for the row's person.
        const whose = scope.userId === viewer.userId ? "your" : `${member.name}'s`;
        fail(member.name, `task "${row.task}" isn't available to ${whose} groups`);
        continue;
      } else if (options.createMissing && mayCreateTask) {
        if (byGroup && newTaskGroupIds.length === 0) {
          fail(member.name, `choose groups for new tasks to create "${row.task}"`);
          continue;
        }
        creates.tasks.add(`${projectName} › ${row.task}`);
        taskName = row.task;
      } else {
        fail(member.name, `unknown task "${row.task}"`);
        continue;
      }
    }
    // Rule 8 of decision 11, as the entry service applies it at commit: a
    // manager or member saving on a project with active tasks must name one.
    if (
      !taskName &&
      existing &&
      projectHasTasks &&
      byGroup &&
      scope.role !== "owner" &&
      scope.role !== "admin"
    ) {
      fail(member.name, requiredFieldMessage("task"));
      continue;
    }
    let tagProblem: string | null = null;
    const tagNames: string[] = [];
    for (const name of row.tags) {
      const found = lookup.tags.get(lower(name));
      if (found?.archived) tagProblem = `tag "${name}" is archived`;
      else if (found) tagNames.push(name);
      else if (options.createMissing && mayCreate.tag) {
        creates.tags.add(name);
        tagNames.push(name);
      } else tagProblem = mayCreate.tag ? `unknown tag "${name}"` : "you cannot create tags here";
      if (tagProblem) break;
    }
    if (tagProblem) {
      fail(member.name, tagProblem);
      continue;
    }

    const missing = missingRequiredField(
      rules.requiredFields,
      {
        description: row.description,
        projectId: projectName ? "pending" : null,
        taskId: taskName ? "pending" : null,
        tagIds: tagNames,
        type: "work",
      },
      { projectHasTasks },
    );
    if (missing) {
      fail(member.name, requiredFieldMessage(missing).toLowerCase().replace(/\.$/, ""));
      continue;
    }

    results.push({ ...base, status: "ok", error: null, userName: member.name });
    ready.push({
      row,
      scope,
      userName: member.name,
      client: clientName,
      project: projectName,
      task: taskName,
      tags: tagNames,
    });
  }

  const sorted = (set: NameSet) => set.values().sort((a, b) => a.localeCompare(b));
  const createsOut: ImportCreates = {
    clients: sorted(creates.clients),
    projects: sorted(creates.projects),
    tasks: sorted(creates.tasks),
    tags: sorted(creates.tags),
  };
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        rows: ready.map((r) => ({
          line: r.row.line,
          userId: r.scope.userId,
          description: r.row.description,
          client: r.client,
          project: r.project,
          task: r.task,
          tags: r.tags,
          billable: r.row.billable,
          start: r.row.start?.toISOString(),
          end: r.row.end?.toISOString(),
        })),
        creates: createsOut,
        newTaskGroupIds: [...newTaskGroupIds].sort(),
      }),
    )
    .digest("hex");
  return { results, ready, creates: createsOut, fingerprint };
}

/** The dry run: every row as ready or with its error, and what a commit would create. */
export async function planEntryImport(
  db: Database,
  viewer: Viewer,
  text: string,
  options: ImportOptions,
): Promise<ImportPlan> {
  const { results, creates, fingerprint } = await resolve(db, viewer, text, options);
  return {
    rows: results,
    ok: results.filter((r) => r.status === "ok").length,
    errors: results.filter((r) => r.status === "error").length,
    creates,
    fingerprint,
  };
}

/**
 * The commit: resolves again, refuses when the outcome differs from the
 * checked one, then creates what is missing and writes every ready row,
 * all in one transaction.
 */
export async function commitEntryImport(
  db: Database,
  viewer: Viewer,
  text: string,
  options: ImportOptions,
  fingerprint: string,
): Promise<{ imported: number }> {
  const resolution = await resolve(db, viewer, text, options);
  if (resolution.fingerprint !== fingerprint) {
    throw new ImportError("The file or the workspace changed since the check; check again.");
  }
  if (resolution.ready.length === 0) return { imported: 0 };

  return db.transaction(async (tx) => {
    const lookup = new Lookup(tx, viewer.workspaceId);
    await lookup.load();
    // Clients first, then projects (which may need them), tasks and tags.
    for (const name of resolution.creates.clients) {
      const created = await createClient(tx, viewer.workspaceId, clientInputSchema.parse({ name }));
      lookup.clients.set(lower(name), { id: created.id });
    }
    for (const name of resolution.creates.tags) {
      const created = await createTag(tx, viewer.workspaceId, tagInputSchema.parse({ name }));
      lookup.tags.set(lower(name), { id: created.id, archived: false });
    }
    const createdProjects = new Map<string, PickerProject>();
    const projectKey = (name: string, client: string | null) =>
      `${lower(name)}|${client ? lower(client) : ""}`;
    for (const r of resolution.ready) {
      if (!r.project) continue;
      const list = await lookup.projectsFor(r.scope);
      if (lookup.project(list, r.project, r.client)) continue;
      const key = projectKey(r.project, r.client);
      if (createdProjects.has(key)) continue;
      const clientId = r.client ? (lookup.clients.get(lower(r.client))?.id ?? null) : null;
      const created = await createProject(tx, viewer, { name: r.project, clientId });
      createdProjects.set(key, created);
      // A project just created is visible to everyone it was created for.
      for (const scoped of lookup.projectsByUser.values()) scoped.push(created);
    }
    for (const r of resolution.ready) {
      if (!r.project || !r.task) continue;
      const project = lookup.project(await lookup.projectsFor(r.scope), r.project, r.client);
      if (!project) throw new ImportError(`Project "${r.project}" could not be found.`);
      if (project.tasks.some((t) => lower(t.name) === lower(r.task!))) continue;
      const created = await createTask(tx, viewer, project.id, {
        name: r.task,
        assigneeIds: [],
        groupIds: options.newTaskGroupIds ?? [],
      });
      project.tasks.push({ id: created.id, name: created.name });
    }

    let imported = 0;
    const byUser = new Map<string, ReadyRow[]>();
    for (const r of resolution.ready) {
      byUser.set(r.scope.userId, [...(byUser.get(r.scope.userId) ?? []), r]);
    }
    for (const rows of byUser.values()) {
      const scope = rows[0]!.scope;
      const list = await lookup.projectsFor(scope);
      const inputs = rows.map((r) => {
        const project = r.project ? lookup.project(list, r.project, r.client) : undefined;
        const task = r.task ? project?.tasks.find((t) => lower(t.name) === lower(r.task!)) : undefined;
        return {
          description: r.row.description,
          projectId: project?.id ?? null,
          taskId: task?.id ?? null,
          tagIds: r.tags.flatMap((name) => {
            const t = lookup.tags.get(lower(name));
            return t ? [t.id] : [];
          }),
          billable: r.row.billable,
          start: r.row.start!,
          end: r.row.end!,
        };
      });
      const { ids } = await createManualEntries(tx, scope, inputs);
      imported += ids.length;
    }
    return { imported };
  });
}
