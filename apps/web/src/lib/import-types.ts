/**
 * The CSV import's dry run as the dialog sees it (Phase 4b). Built by
 * `server/entry-import.ts`; ISO strings only, like every other DTO.
 */

export interface ImportRowResult {
  line: number;
  status: "ok" | "error";
  error: string | null;
  description: string;
  start: string | null;
  end: string | null;
  userName: string;
}

export interface ImportCreates {
  clients: string[];
  projects: string[];
  tasks: string[];
  tags: string[];
}

export interface ImportPlan {
  rows: ImportRowResult[];
  ok: number;
  errors: number;
  creates: ImportCreates;
  /** Changes when any ready row or creation would differ: the commit checks it. */
  fingerprint: string;
}
