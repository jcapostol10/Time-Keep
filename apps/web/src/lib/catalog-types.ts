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

export interface TagDTO {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  /** Entries (not deleted) carrying the tag. */
  usageCount: number;
}
