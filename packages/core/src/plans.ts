/**
 * Plan gates. Every workspace gets every feature until Phase 8 brings plan
 * limits; the gated settings (force timer, kiosk photo) ask here and are always allowed.
 */

export type PlanFeature = "forceTimer" | "kioskPhoto";

export function planAllows(_workspace: { id: string }, _feature: PlanFeature): boolean {
  return true;
}
