"use client";

import { weekStartKey } from "@timekeep/core";

import { RangeNav } from "./range-nav";
import { type Zoom } from "./schedule-model";
import { useScheduleRange } from "./use-range";
import { hm, useMySchedule } from "./use-schedule";

const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** My schedule (decision 17): the viewer's published assignments, day by day, read-only. */
export function MySchedule({
  slug,
  from,
  zoom,
  today,
  weekStart,
}: {
  slug: string;
  from: string;
  zoom: Zoom;
  today: string;
  weekStart: number;
}) {
  const nav = useScheduleRange({ from, zoom, today, weekStart });
  const { data } = useMySchedule(slug, nav.range.from, nav.range.to);
  const assignments = data?.assignments ?? [];
  const busyDays = nav.days
    .map((day) => ({
      day,
      items: assignments
        .filter((a) => (a.days[day] ?? 0) > 0)
        .map((a) => ({ a, minutes: a.days[day]! })),
    }))
    .filter((d) => d.items.length > 0);
  const weeks = new Map<string, typeof busyDays>();
  for (const d of busyDays) {
    const key = weekStartKey(d.day, weekStart);
    weeks.set(key, [...(weeks.get(key) ?? []), d]);
  }

  return (
    <section aria-label="My schedule">
      <RangeNav
        range={nav.range}
        zoom={nav.zoom}
        zooms={["week", "month"]}
        onShift={nav.shift}
        onToday={nav.today}
        onZoom={nav.setZoom}
      />
      {data && busyDays.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
          Nothing scheduled
        </p>
      ) : null}
      <div className="space-y-6">
        {[...weeks].map(([week, list]) => (
          <div key={week} className="space-y-2">
            {list.map(({ day, items }) => (
              <div key={day} className="rounded-lg border p-3">
                <h3 className="mb-2 text-sm font-medium">
                  {DAY.format(new Date(`${day}T00:00:00Z`))}
                </h3>
                <ul className="space-y-1">
                  {items.map(({ a, minutes }) => (
                    <li key={a.id} className="flex items-start gap-2 text-sm">
                      <span
                        aria-hidden
                        className="mt-1.5 size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: a.project?.color ?? "var(--muted-foreground)" }}
                      />
                      <div>
                        <div>
                          {[a.project?.name ?? "Another project", a.task?.name, hm(minutes)]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        {a.note ? (
                          <div className="text-muted-foreground text-xs">{a.note}</div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
