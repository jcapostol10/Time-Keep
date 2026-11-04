import type { KioskAction, KioskState } from "@timekeep/core";

/** What the Kiosks page and the kiosk screen read: JSON-safe, shared by server and client. */

export interface KioskDTO {
  id: string;
  name: string;
  projectId: string | null;
  taskId: string | null;
  everyone: boolean;
  userIds: string[];
  groupIds: string[];
  sessionTimeoutSeconds: number;
  showLogo: boolean;
  photo: boolean;
  disabled: boolean;
  createdAt: string;
}

/** The device URL is shown once, at create and rotate (ruling R1). */
export interface CreatedKiosk {
  kiosk: KioskDTO;
  url: string;
}

/** A workspace where the person may punch on a kiosk, and their PIN and QR state there (R8). */
export interface CredentialStatus {
  workspaceId: string;
  workspaceName: string;
  slug: string;
  hasPin: boolean;
  pinSetAt: string | null;
  hasQr: boolean;
}

/** The kiosk screen's first read. */
export interface KioskScreenDTO {
  name: string;
  workspaceName: string;
  logo: string | null;
  sessionTimeoutSeconds: number;
  photo: boolean;
  people: KioskPerson[];
  /** The server's time: the device's clock is not trusted. */
  now: string;
  timezone: string;
}

export interface KioskPerson {
  userId: string;
  name: string;
  image: string | null;
  hasPin: boolean;
}

export interface KioskVisitDTO {
  ticket: string;
  person: { userId: string; name: string };
  state: KioskState;
  actions: KioskAction[];
  workedTodaySeconds: number;
  now: string;
}

export type KioskPunchDTO = Omit<KioskVisitDTO, "ticket">;
