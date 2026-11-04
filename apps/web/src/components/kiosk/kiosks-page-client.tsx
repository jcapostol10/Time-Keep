"use client";

import { kioskRequiredGaps, type RequiredField } from "@timekeep/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@timekeep/ui/components/alert-dialog";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { Switch } from "@timekeep/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { CopyIcon, MonitorSmartphoneIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import type { KioskDTO } from "@/lib/kiosk-types";
import {
  createKioskAction,
  rotateKioskTokenAction,
  setKioskDisabledAction,
  updateKioskAction,
} from "@/server/actions/kiosks";

import {
  type Assignees,
  AssigneesField,
  assigneesLabel,
  type Option,
} from "../time-off/assignees-field";
import { ProjectPicker, type ProjectSelection } from "../tracker/project-picker";
import { useTargetKey } from "../tracker/target-context";
import { useTrackerOptions } from "../tracker/use-tracker-cache";

interface ProjectOption extends Option {
  color: string;
}

const GAP_WARNINGS: Partial<Record<RequiredField, string>> = {
  project: "This workspace requires a project: pick one, or people cannot clock out here.",
  task: "This project has tasks: pick a default task, or members cannot clock out here.",
  tag: "This workspace requires a tag, which a kiosk cannot add: people could clock in here but not out.",
};

/**
 * The Kiosks page: a list with Edit, Rotate URL and Disable, and the dialog
 * that shows the device URL. The URL exists only in that dialog: the server
 * keeps its hash (ruling R1), so a lost URL means rotating.
 */
export function KiosksPageClient({
  slug,
  kiosks,
  people,
  groups,
  projects,
  tasks,
  photoAllowed,
  requiredFields,
}: {
  slug: string;
  kiosks: KioskDTO[];
  people: Option[];
  groups: Option[];
  projects: ProjectOption[];
  tasks: Option[];
  photoAllowed: boolean;
  requiredFields: RequiredField[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<KioskDTO | "new" | null>(null);
  const [rotating, setRotating] = useState<KioskDTO | null>(null);
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null);

  const projectOf = (k: KioskDTO) => projects.find((p) => p.id === k.projectId) ?? null;
  const taskOf = (k: KioskDTO) => tasks.find((t) => t.id === k.taskId) ?? null;

  async function rotate(kiosk: KioskDTO) {
    const result = await rotateKioskTokenAction(slug, kiosk.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDeviceUrl(result.data.url);
  }

  async function setDisabled(kiosk: KioskDTO, disabled: boolean) {
    const result = await setKioskDisabledAction(slug, kiosk.id, disabled);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(disabled ? `${kiosk.name} disabled` : `${kiosk.name} enabled`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          New kiosk
        </Button>
      </div>

      {kiosks.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphoneIcon}
          title="No kiosks yet"
          description="Create one, then open its device URL on a shared tablet or computer."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {kiosks.map((k) => {
                const project = projectOf(k);
                const task = taskOf(k);
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>
                      {project ? `${project.name}${task ? ` › ${task.name}` : ""}` : "None"}
                    </TableCell>
                    <TableCell>{assigneesLabel(k, people, groups)}</TableCell>
                    <TableCell>
                      <Badge variant={k.disabled ? "secondary" : "default"}>
                        {k.disabled ? "Disabled" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${k.name}`}>
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(k)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setRotating(k)}>
                            Rotate URL…
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void setDisabled(k, !k.disabled)}>
                            {k.disabled ? "Enable" : "Disable"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing ? (
        <KioskDialog
          slug={slug}
          kiosk={editing === "new" ? null : editing}
          people={people}
          groups={groups}
          photoAllowed={photoAllowed}
          requiredFields={requiredFields}
          onClose={() => setEditing(null)}
          onCreated={setDeviceUrl}
        />
      ) : null}

      <AlertDialog open={rotating !== null} onOpenChange={(open) => !open && setRotating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the device URL?</AlertDialogTitle>
            <AlertDialogDescription>
              The old URL stops working on every device. Open the new URL on each one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!rotating) return;
                const target = rotating;
                setRotating(null);
                void rotate(target);
              }}
            >
              Rotate URL
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeviceUrlDialog url={deviceUrl} onClose={() => setDeviceUrl(null)} />
    </div>
  );
}

/** Shown once, after create and after rotate: only the hash is stored. */
function DeviceUrlDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Device URL copied");
  }
  return (
    <Dialog open={url !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Device URL</DialogTitle>
          <DialogDescription>
            Open this on the kiosk device. Keep it now: it is not shown again, and a lost URL means
            rotating.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly aria-label="Device URL" value={url ?? ""} className="min-w-0 flex-1" />
          <Button variant="outline" onClick={() => void copy()}>
            <CopyIcon />
            Copy
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KioskDialog({
  slug,
  kiosk,
  people,
  groups,
  photoAllowed,
  requiredFields,
  onClose,
  onCreated,
}: {
  slug: string;
  kiosk: KioskDTO | null;
  people: Option[];
  groups: Option[];
  photoAllowed: boolean;
  requiredFields: RequiredField[];
  onClose: () => void;
  onCreated: (url: string) => void;
}) {
  const router = useRouter();
  const { data: options } = useTrackerOptions(slug, useTargetKey());
  const [name, setName] = useState(kiosk?.name ?? "");
  const [selection, setSelection] = useState<ProjectSelection>({
    projectId: kiosk?.projectId ?? null,
    taskId: kiosk?.taskId ?? null,
  });
  const [assignees, setAssignees] = useState<Assignees>({
    everyone: kiosk?.everyone ?? true,
    userIds: kiosk?.userIds ?? [],
    groupIds: kiosk?.groupIds ?? [],
  });
  const [timeout, setTimeoutSeconds] = useState(String(kiosk?.sessionTimeoutSeconds ?? 15));
  const [showLogo, setShowLogo] = useState(kiosk?.showLogo ?? true);
  const [photo, setPhoto] = useState(kiosk?.photo ?? false);
  const [saving, setSaving] = useState(false);

  const gaps = kioskRequiredGaps(requiredFields, {
    ...selection,
    projectHasTasks:
      (options?.projects.find((p) => p.id === selection.projectId)?.tasks.length ?? 0) > 0,
  });

  async function save() {
    setSaving(true);
    const input = {
      name,
      projectId: selection.projectId,
      taskId: selection.taskId,
      ...assignees,
      sessionTimeoutSeconds: Number(timeout),
      showLogo,
      photo,
    };
    const result = kiosk
      ? await updateKioskAction(slug, kiosk.id, input)
      : await createKioskAction(slug, input);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if ("url" in result.data) onCreated(result.data.url);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kiosk ? "Edit kiosk" : "New kiosk"}</DialogTitle>
          <DialogDescription>
            Punches here are entries on the default project, described as “Kiosk: {name || "name"}”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="kiosk-name">Name</Label>
            <Input
              id="kiosk-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Default project and task</Label>
            <div>
              <ProjectPicker slug={slug} value={selection} onChange={setSelection} />
            </div>
            {gaps.map((gap) => (
              <p key={gap} className="text-muted-foreground text-sm">
                {GAP_WARNINGS[gap]}
              </p>
            ))}
          </div>
          <AssigneesField
            legend="Who can use it"
            value={assignees}
            onChange={setAssignees}
            people={people}
            groups={groups}
          />
          <div className="space-y-1.5">
            <Label htmlFor="kiosk-timeout">Return to the list after (seconds)</Label>
            <Input
              id="kiosk-timeout"
              type="number"
              min={5}
              max={300}
              value={timeout}
              onChange={(e) => setTimeoutSeconds(e.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Show the workspace logo
            <Switch
              checked={showLogo}
              onCheckedChange={setShowLogo}
              aria-label="Show the workspace logo"
            />
          </label>
          {photoAllowed ? (
            <label className="flex items-center justify-between gap-3 text-sm">
              Take a photo at clock in
              <Switch
                checked={photo}
                onCheckedChange={setPhoto}
                aria-label="Take a photo at clock in"
              />
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || name.trim() === ""} onClick={() => void save()}>
            {kiosk ? "Save" : "Create kiosk"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
