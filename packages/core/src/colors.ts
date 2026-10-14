import { z } from "zod";

/** The 20-colour palette projects and tags pick from (Phase 2 keeps it). */
export const PROJECT_COLORS: readonly string[] = [
  "#0f766e",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#65a30d",
  "#16a34a",
  "#0891b2",
  "#4f46e5",
  "#9333ea",
  "#e11d48",
  "#b45309",
  "#14b8a6",
  "#1d4ed8",
  "#6d28d9",
  "#be185d",
  "#15803d",
  "#475569",
];

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0f766e");

/** Stable palette colour for a name, so inline-created projects look consistent. */
export function pickColor(seed: string): string {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length] ?? "#0f766e";
}
