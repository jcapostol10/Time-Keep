import { getDb } from "@timekeep/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import type { Metadata } from "next";

import { RateCell } from "@/components/rates/rate-cell";
import { RecalcBanner } from "@/components/rates/recalc-banner";
import { authorize, authorizePage } from "@/server/authz";
import { getProject } from "@/server/catalog/projects";
import { listTasks } from "@/server/catalog/tasks";
import { listMembers } from "@/server/queries/team";
import { currentRate, currentRatesAt } from "@/server/rates";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Rates" };

/** The project's own rate, each member's rate on it, and each task's (owners and admins). */
export default async function ProjectRatesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/rates">) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() => authorize(ctx, "rate.view"));
  const db = getDb();
  const [project, members, tasks, projectRate, memberRates, taskRates] = await Promise.all([
    getProject(db, viewer, projectId),
    listMembers(db, ctx.workspace.id),
    listTasks(db, viewer, projectId),
    currentRate(db, viewer, { level: "project", projectId }),
    currentRatesAt(db, viewer, "project_member", { projectId }),
    currentRatesAt(db, viewer, "task", { projectId }),
  ]);
  const onProject = members.filter(
    (m) =>
      m.status === "ACTIVE" &&
      (project.visibility === "PUBLIC" || project.memberIds.includes(m.userId)),
  );
  const common = {
    slug: workspaceSlug,
    currency: ctx.settings.currency,
    timezone: ctx.settings.timezone,
  };

  return (
    <div className="space-y-8">
      <RecalcBanner slug={workspaceSlug} />
      <section aria-labelledby="project-rate" className="space-y-2">
        <h2 id="project-rate" className="text-lg font-semibold">
          Project rate
        </h2>
        <p className="text-muted-foreground text-sm">
          For time on {project.name}, unless a member or task rate below says otherwise.
        </p>
        <RateCell
          {...common}
          target={{ level: "project", projectId }}
          title={`Rate for ${project.name}`}
          current={projectRate?.amountMinor ?? null}
          inherited="Uses each member's or the workspace rate"
        />
      </section>

      <section aria-labelledby="member-rates" className="space-y-2">
        <h2 id="member-rates" className="text-lg font-semibold">
          Member rates on this project
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {onProject.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>
                    <RateCell
                      {...common}
                      target={{ level: "project_member", projectId, userId: m.userId }}
                      title={`${m.name} on ${project.name}`}
                      current={memberRates.get(m.userId) ?? null}
                      ariaLabel={`Change rate for ${m.name}`}
                      inherited="Uses the project rate"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="task-rates" className="space-y-2">
        <h2 id="task-rates" className="text-lg font-semibold">
          Task rates
        </h2>
        {tasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">This project has no tasks.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <RateCell
                        {...common}
                        target={{ level: "task", projectId, taskId: t.id }}
                        title={`Rate for ${t.name}`}
                        current={taskRates.get(t.id) ?? null}
                        ariaLabel={`Change rate for ${t.name}`}
                        inherited="Uses the project rate"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
