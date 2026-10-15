"use client";

import { formatClock, type TrackerSettingsInput, type ViewerPrefs } from "@timekeep/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useNow } from "@/hooks/use-now";
import { fetchJson } from "@/lib/fetch-json";
import { workspaceRoutes } from "@/lib/routes";
import { EMPTY_DRAFT, type EntryDraft, type TimeEntryDTO } from "@/lib/tracker-types";
import {
  continueEntryAction,
  type StartResult,
  startTimerAction,
  stopTimerAction,
  updateEntryAction,
} from "@/server/actions/time-entries";

import { trackerKeys, trackerUrls } from "./query-keys";
import { IdleDialog } from "./idle-dialog";
import { activeIdlePrompt, type IdlePrompt } from "./idle-prompt";
import { trackSave, useIsSaving } from "./saving-store";
import { createTrackerChannel, type TrackerChannel } from "./tracker-channel";
import { useTrackerCache } from "./use-tracker-cache";
import { useIdleDetection, usePomodoro, useReminders } from "./use-tracker-helpers";

export type RunningPatch = Partial<EntryDraft> & { start?: string };

interface TrackerContextValue {
  slug: string;
  workspaceId: string;
  viewer: ViewerPrefs;
  settings: TrackerSettingsInput;
  running: TimeEntryDTO | null;
  pending: boolean;
  draft: EntryDraft;
  setDraft: (patch: Partial<EntryDraft>) => void;
  start: (details?: EntryDraft) => Promise<boolean>;
  stop: (end?: Date) => Promise<boolean>;
  toggle: () => Promise<boolean>;
  continueEntry: (entryId: string) => Promise<boolean>;
  updateRunning: (patch: RunningPatch) => Promise<boolean>;
  registerDescriptionInput: (el: HTMLInputElement | null) => void;
  focusDescription: () => void;
  notifyEntriesChanged: () => void;
}

interface TrackerClockValue {
  /** ms since epoch while a timer runs; 0 before hydration or when idle */
  now: number;
  elapsedSeconds: number;
}

const TrackerContext = createContext<TrackerContextValue | null>(null);
const TrackerClockContext = createContext<TrackerClockValue>({ now: 0, elapsedSeconds: 0 });

export function useTracker(): TrackerContextValue {
  const value = useContext(TrackerContext);
  if (!value) throw new Error("useTracker must be used inside <TrackerProvider>");
  return value;
}

export function useTrackerClock(): TrackerClockValue {
  return useContext(TrackerClockContext);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest('[role="dialog"], [role="menu"], [role="listbox"], [cmdk-root]'));
}

/** S start/stop, N focus description, Esc blur. Ignored while typing or with modifiers. */
function useKeyboardShortcuts(onToggle: () => void, onFocusDescription: () => void) {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
      return;
    }
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      onToggle();
    } else if (key === "n") {
      event.preventDefault();
      onFocusDescription();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

/**
 * "0:42:10 · Design review" while a timer runs. Next.js rewrites the title on
 * navigation, so whenever the title is not the one we last wrote it becomes
 * the new base to restore when the timer stops.
 */
function useDocumentTitle(running: TimeEntryDTO | null, elapsedSeconds: number, ready: boolean) {
  const base = useRef<string | null>(null);
  const written = useRef<string | null>(null);
  useEffect(() => {
    if (!running) {
      if (written.current !== null && document.title === written.current && base.current) {
        document.title = base.current;
      }
      written.current = null;
      return;
    }
    if (!ready) return;
    if (document.title !== written.current) base.current = document.title;
    const title = `${formatClock(elapsedSeconds)} · ${running.description || "(no description)"}`;
    document.title = title;
    written.current = title;
  }, [running, elapsedSeconds, ready]);
}

/** Ask the browser to confirm leaving while a save has not reached the server yet. */
function useLeaveWarning(saving: boolean) {
  useEffect(() => {
    if (!saving) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saving]);
}

export interface TrackerProviderProps {
  slug: string;
  workspaceId: string;
  viewer: ViewerPrefs;
  settings: TrackerSettingsInput;
  initialRunning: TimeEntryDTO | null;
  children: React.ReactNode;
}

export function TrackerProvider({
  slug,
  workspaceId,
  viewer,
  settings,
  initialRunning,
  children,
}: TrackerProviderProps) {
  const qc = useQueryClient();
  const router = useRouter();
  const cache = useTrackerCache(slug);
  const runningKey = useMemo(() => trackerKeys.running(slug), [slug]);

  const { data: running = null } = useQuery({
    queryKey: runningKey,
    queryFn: async () =>
      (await fetchJson<{ running: TimeEntryDTO | null }>(trackerUrls.running(slug))).running,
    initialData: initialRunning,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const now = useNow(Boolean(running));
  const elapsedSeconds =
    running && now > 0 ? Math.max(0, Math.floor((now - Date.parse(running.start)) / 1000)) : 0;

  const [draft, setDraftState] = useState<EntryDraft>(EMPTY_DRAFT);
  const [pending, setPending] = useState(false);
  // Synchronous in-flight guard: `pending` state lags a render behind, so a
  // double Enter or S could otherwise send two starts (the second would stop
  // the first after 1 s and leave a stray entry).
  const inFlight = useRef(false);
  const begin = useCallback(() => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    return true;
  }, []);
  const finish = useCallback(() => {
    inFlight.current = false;
    setPending(false);
  }, []);
  const channelRef = useRef<TrackerChannel | null>(null);
  const descriptionInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const channel = createTrackerChannel(workspaceId, (message) => {
      if (message.type === "running") qc.setQueryData(runningKey, message.running);
      void cache.invalidateEntries();
      void cache.invalidateOptions();
    });
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [qc, cache, runningKey, workspaceId]);

  const setRunning = useCallback(
    (entry: TimeEntryDTO | null, broadcast = true) => {
      qc.setQueryData(runningKey, entry);
      if (broadcast) channelRef.current?.post({ type: "running", running: entry });
    },
    [qc, runningKey],
  );

  const notifyEntriesChanged = useCallback(() => {
    channelRef.current?.post({ type: "entries-changed" });
  }, []);

  const applyStart = useCallback(
    ({ started, stopped }: StartResult) => {
      setRunning(started);
      if (stopped) cache.upsertEntry(stopped, "insert");
      void cache.invalidateOptions();
    },
    [cache, setRunning],
  );

  const setDraft = useCallback((patch: Partial<EntryDraft>) => {
    setDraftState((d) => ({ ...d, ...patch }));
  }, []);

  const start = useCallback(
    async (details?: EntryDraft) => {
      if (!begin()) return false;
      try {
        const result = await trackSave(() => startTimerAction(slug, details ?? draft));
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        applyStart(result.data);
        setDraftState(EMPTY_DRAFT);
        return true;
      } finally {
        finish();
      }
    },
    [slug, draft, applyStart, begin, finish],
  );

  const stop = useCallback(
    async (end?: Date) => {
      const current = qc.getQueryData<TimeEntryDTO | null>(runningKey);
      if (!current || !begin()) return false;
      qc.setQueryData(runningKey, null);
      try {
        const result = await trackSave(() =>
          stopTimerAction(slug, {
            entryId: current.id,
            ...(end ? { end: end.toISOString() } : {}),
          }),
        );
        if (!result.ok) {
          qc.setQueryData(runningKey, current);
          toast.error(result.error);
          return false;
        }
        cache.upsertEntry(result.data, "insert");
        void cache.invalidateOptions();
        channelRef.current?.post({ type: "running", running: null });
        return true;
      } finally {
        finish();
      }
    },
    [qc, runningKey, slug, cache, begin, finish],
  );

  const toggle = useCallback(
    () => (qc.getQueryData<TimeEntryDTO | null>(runningKey) ? stop() : start()),
    [qc, runningKey, start, stop],
  );

  const continueEntry = useCallback(
    async (entryId: string) => {
      if (!begin()) return false;
      try {
        const result = await trackSave(() => continueEntryAction(slug, entryId));
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        applyStart(result.data);
        return true;
      } finally {
        finish();
      }
    },
    [slug, applyStart, begin, finish],
  );

  const updateRunning = useCallback(
    async (patch: RunningPatch) => {
      const current = qc.getQueryData<TimeEntryDTO | null>(runningKey);
      if (!current) return false;
      qc.setQueryData<TimeEntryDTO | null>(runningKey, {
        ...current,
        ...patch,
        ...cache.resolveDetails(patch),
      });
      const result = await trackSave(() => updateEntryAction(slug, current.id, patch));
      if (!result.ok) {
        qc.setQueryData<TimeEntryDTO | null>(runningKey, (r) =>
          r?.id === current.id ? current : r,
        );
        toast.error(result.error);
        return false;
      }
      qc.setQueryData<TimeEntryDTO | null>(runningKey, (r) =>
        r?.id === current.id ? result.data : r,
      );
      setRunning(qc.getQueryData<TimeEntryDTO | null>(runningKey) ?? null);
      return true;
    },
    [qc, runningKey, cache, slug, setRunning],
  );

  const registerDescriptionInput = useCallback((el: HTMLInputElement | null) => {
    descriptionInput.current = el;
  }, []);

  const focusDescription = useCallback(() => {
    const el = descriptionInput.current;
    if (el) {
      el.focus();
      el.select();
    } else {
      router.push(`${workspaceRoutes.tracker(slug)}?focus=description`);
    }
  }, [router, slug]);

  useLeaveWarning(useIsSaving());
  useKeyboardShortcuts(() => void toggle(), focusDescription);
  useDocumentTitle(running, elapsedSeconds, now > 0);
  usePomodoro(running, elapsedSeconds, settings, now > 0);
  useReminders(workspaceId, viewer.timezone, running, settings, focusDescription);
  const [idlePrompt, setIdlePrompt] = useState<IdlePrompt | null>(null);
  const activePrompt = activeIdlePrompt(idlePrompt, running);
  useIdleDetection(
    Boolean(running) && activePrompt === null,
    settings.idleDetectionMinutes,
    (since) => {
      const current = qc.getQueryData<TimeEntryDTO | null>(runningKey);
      if (current) setIdlePrompt({ entryId: current.id, since });
    },
  );

  const value = useMemo<TrackerContextValue>(
    () => ({
      slug,
      workspaceId,
      viewer,
      settings,
      running,
      pending,
      draft,
      setDraft,
      start,
      stop,
      toggle,
      continueEntry,
      updateRunning,
      registerDescriptionInput,
      focusDescription,
      notifyEntriesChanged,
    }),
    [
      slug,
      workspaceId,
      viewer,
      settings,
      running,
      pending,
      draft,
      setDraft,
      start,
      stop,
      toggle,
      continueEntry,
      updateRunning,
      registerDescriptionInput,
      focusDescription,
      notifyEntriesChanged,
    ],
  );
  const clock = useMemo(() => ({ now, elapsedSeconds }), [now, elapsedSeconds]);

  return (
    <TrackerContext.Provider value={value}>
      <TrackerClockContext.Provider value={clock}>
        {children}
        <IdleDialog idleSince={activePrompt?.since ?? null} onClose={() => setIdlePrompt(null)} />
      </TrackerClockContext.Provider>
    </TrackerContext.Provider>
  );
}
