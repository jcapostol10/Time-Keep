import { formatMoney, type MoneyAmount } from "@timekeep/core";

/** A row's or a total's billable amounts: the workspace currency, and any others. */
export interface Amounts {
  amountMinor: number;
  otherAmounts: readonly MoneyAmount[];
}

/**
 * One formatted amount per currency (Phase 6a): money in two currencies is
 * never added, so each is its own line. The workspace currency comes first;
 * it is left out when it is zero and the rest is billed in other currencies.
 */
export function amountLines(amounts: Amounts, currency: string): string[] {
  const others = amounts.otherAmounts.map((a) => formatMoney(a.amountMinor, a.currency));
  return amounts.amountMinor !== 0 || others.length === 0
    ? [formatMoney(amounts.amountMinor, currency), ...others]
    : others;
}

/** The amounts on one line, for a heading ("$50.00 · €40.00"). */
export function amountText(amounts: Amounts, currency: string): string {
  return amountLines(amounts, currency).join(" · ");
}

/** The amounts stacked, one line per currency, for a table cell. */
export function MoneyCell({ amounts, currency }: { amounts: Amounts; currency: string }) {
  return (
    <>
      {amountLines(amounts, currency).map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </>
  );
}

/** The notes under a table that shows cost and profit: what the numbers leave out. */
export function CostNotes({
  totals,
}: {
  totals: { uncostedCount: number; profitExcludedCount: number };
}) {
  const { uncostedCount: uncosted, profitExcludedCount: excluded } = totals;
  return (
    <>
      {uncosted > 0 ? (
        <p className="text-muted-foreground border-t px-3 py-2 text-xs">
          {uncosted} {uncosted === 1 ? "entry has" : "entries have"} no cost rate, so{" "}
          {uncosted === 1 ? "it counts" : "they count"} as zero cost.
        </p>
      ) : null}
      {excluded > 0 ? (
        <p className="text-muted-foreground border-t px-3 py-2 text-xs">
          Profit leaves out {excluded} {excluded === 1 ? "entry" : "entries"} billed in another
          currency (no conversion).
        </p>
      ) : null}
    </>
  );
}
