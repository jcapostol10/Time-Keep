/** What a submitted period is compared by: its time and its expenses. */
export interface PeriodMeasure {
  workSeconds: number;
  expenseCount: number;
  expenseMinor: number;
}

/**
 * Whether a period no longer reads as it was submitted: its time, or its
 * expenses (one added, removed or re-priced), differ from the snapshot.
 */
export function periodChanged(live: PeriodMeasure, submitted: PeriodMeasure): boolean {
  return (
    live.workSeconds !== submitted.workSeconds ||
    live.expenseCount !== submitted.expenseCount ||
    live.expenseMinor !== submitted.expenseMinor
  );
}
