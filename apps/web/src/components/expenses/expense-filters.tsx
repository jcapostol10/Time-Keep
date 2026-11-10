"use client";

import { NONE_ID, type ReportQuery } from "@timekeep/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";

import { DatePresetMenu } from "../reports/date-preset-menu";
import { InvoicedSelect } from "../reports/invoiced-select";
import { MultiSelectFilter } from "../reports/multi-select-filter";
import { useReportOptions } from "../reports/use-report";
import { useTracker } from "../tracker/tracker-provider";
import { useExpenseCategories } from "./use-expenses";

/** The Expenses page's filters: the range, people, projects, categories and billable, in the URL. */
export function ExpenseFilters({
  query,
  onChange,
}: {
  query: ReportQuery;
  onChange: (patch: Partial<ReportQuery>) => void;
}) {
  const { slug, viewer } = useTracker();
  const { data: options } = useReportOptions(slug);
  const { data: categories } = useExpenseCategories(slug);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DatePresetMenu query={query} prefs={viewer} onChange={onChange} />
      {options?.users ? (
        <MultiSelectFilter
          label="Users"
          options={options.users}
          value={query.userIds}
          onChange={(userIds) => onChange({ userIds })}
        />
      ) : null}
      {options?.groups && options.groups.length > 0 ? (
        <MultiSelectFilter
          label="Groups"
          options={options.groups}
          value={query.groupIds}
          onChange={(groupIds) => onChange({ groupIds })}
        />
      ) : null}
      <MultiSelectFilter
        label="Clients"
        options={options?.clients ?? []}
        value={query.clientIds}
        onChange={(clientIds) => onChange({ clientIds })}
        none={{ id: NONE_ID, name: "Without client" }}
      />
      <MultiSelectFilter
        label="Projects"
        options={(options?.projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
        value={query.projectIds}
        onChange={(projectIds) => onChange({ projectIds })}
      />
      <MultiSelectFilter
        label="Categories"
        options={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))}
        value={query.categoryIds}
        onChange={(categoryIds) => onChange({ categoryIds })}
      />
      <Select
        value={query.billable}
        onValueChange={(v) =>
          onChange({ billable: v === "yes" ? "yes" : v === "no" ? "no" : "all" })
        }
      >
        <SelectTrigger size="sm" aria-label="Billable" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Billable: all</SelectItem>
          <SelectItem value="yes">Billable only</SelectItem>
          <SelectItem value="no">Non-billable only</SelectItem>
        </SelectContent>
      </Select>
      <InvoicedSelect value={query.invoiced} onChange={(invoiced) => onChange({ invoiced })} />
    </div>
  );
}
