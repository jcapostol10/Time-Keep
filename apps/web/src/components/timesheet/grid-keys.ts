/**
 * Whether Left or Right leaves a timesheet cell for its neighbour: only when
 * the caret is at that edge of the text, or the whole value is selected (as
 * it is right after focus), so the caret can still move within "1:30".
 */
export function movesHorizontally(
  key: "ArrowLeft" | "ArrowRight",
  caret: { start: number | null; end: number | null; length: number },
): boolean {
  const { start, end, length } = caret;
  if (start === null || end === null) return true;
  if (start === 0 && end === length) return true;
  return key === "ArrowLeft" ? end === 0 : start === length;
}
