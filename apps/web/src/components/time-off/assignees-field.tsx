"use client";

import { Checkbox } from "@timekeep/ui/components/checkbox";
import { Label } from "@timekeep/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";

export interface Option {
  id: string;
  name: string;
}

export interface Assignees {
  everyone: boolean;
  userIds: string[];
  groupIds: string[];
}

function toggle(list: string[], id: string, on: boolean): string[] {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

/** Everyone, or some people and groups: shared by policies, holidays and targets. */
export function AssigneesField({
  value,
  onChange,
  people,
  groups,
  legend = "Applies to",
}: {
  value: Assignees;
  onChange: (next: Assignees) => void;
  people: Option[];
  groups: Option[];
  legend?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <RadioGroup
        value={value.everyone ? "everyone" : "some"}
        onValueChange={(v) => onChange({ ...value, everyone: v === "everyone" })}
        className="flex flex-wrap gap-4"
      >
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="everyone" aria-label="Everyone" /> Everyone
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="some" aria-label="Some people and groups" /> Some people and groups
        </label>
      </RadioGroup>
      {value.everyone ? null : (
        <div className="grid max-h-56 gap-3 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium uppercase">Groups</p>
            {groups.length === 0 ? (
              <p className="text-muted-foreground text-sm">No groups yet.</p>
            ) : (
              groups.map((g) => (
                <Label key={g.id} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    aria-label={g.name}
                    checked={value.groupIds.includes(g.id)}
                    onCheckedChange={(on) =>
                      onChange({ ...value, groupIds: toggle(value.groupIds, g.id, on === true) })
                    }
                  />
                  {g.name}
                </Label>
              ))
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium uppercase">People</p>
            {people.map((p) => (
              <Label key={p.id} className="flex items-center gap-2 font-normal">
                <Checkbox
                  aria-label={p.name}
                  checked={value.userIds.includes(p.id)}
                  onCheckedChange={(on) =>
                    onChange({ ...value, userIds: toggle(value.userIds, p.id, on === true) })
                  }
                />
                {p.name}
              </Label>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}

/** "Everyone", or the names of the people and groups. */
export function assigneesLabel(a: Assignees, people: Option[], groups: Option[]): string {
  if (a.everyone || (a.userIds.length === 0 && a.groupIds.length === 0)) return "Everyone";
  const names = [
    ...groups.filter((g) => a.groupIds.includes(g.id)).map((g) => g.name),
    ...people.filter((p) => a.userIds.includes(p.id)).map((p) => p.name),
  ];
  return names.join(", ") || "Nobody";
}
