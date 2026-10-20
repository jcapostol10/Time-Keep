/**
 * Isomorphic DTOs for clients, projects, tasks and tags. Like the tracker
 * DTOs, everything crossing the server/client boundary is JSON-safe.
 */

export interface ClientDTO {
  id: string;
  name: string;
  address: string;
  email: string;
  notes: string;
  /** ISO 4217; reserved for invoicing (Phase 6). */
  currency: string | null;
  archived: boolean;
  projectCount: number;
}

export interface ProjectListItem {
  id: string;
  name: string;
  color: string;
  clientId: string | null;
  clientName: string | null;
  billable: boolean;
  visibility: "PUBLIC" | "PRIVATE";
  archived: boolean;
  isTemplate: boolean;
  note: string;
  favorite: boolean;
  /** Everyone's time for admins; the viewer's own time for members. */
  trackedSeconds: number;
  memberCount: number;
}

export interface ProjectDetail extends ProjectListItem {
  memberIds: string[];
}

export interface ProjectStatus {
  from: string;
  to: string;
  byTask: { taskId: string | null; name: string; seconds: number }[];
  byMember: { userId: string; name: string; seconds: number }[];
  billableSeconds: number;
  nonBillableSeconds: number;
  totalSeconds: number;
}

export interface TaskDTO {
  id: string;
  projectId: string;
  name: string;
  status: "ACTIVE" | "DONE";
  assigneeIds: string[];
  trackedSeconds: number;
}

export interface TagDTO {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  /** Entries (not deleted) carrying the tag. */
  usageCount: number;
}
