/**
 * Plan gates. Every workspace gets every feature until Phase 8 brings plan
 * limits; the one gated setting (force timer) asks here and is always allowed.
 */

export type PlanFeature = "forceTimer";

export function planAllows(_workspace: { id: string }, _feature: PlanFeature): boolean {
  return true;
}
