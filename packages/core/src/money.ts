/**
 * Money is integer minor units plus an ISO 4217 code (invariant 2). Typed
 * amounts are parsed as digit strings, never through floating point, and
 * amounts are computed with BigInt so no product loses a cent.
 */

/** The highest hourly rate accepted, in major units. */
export const MAX_RATE_MAJOR = 1_000_000;

/** Digits after the decimal point: USD 2, JPY 0, KWD 3. */
export function currencyExponent(code: string): number {
  return (
    new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

const AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

/**
 * "1,250.50" → 125050 for USD. Null for anything that is not a non-negative
 * amount with at most the currency's decimals, up to MAX_RATE_MAJOR.
 */
export function parseMoney(input: string, currency: string): number | null {
  const text = input.trim();
  const match = AMOUNT.exec(text);
  if (!match) return null;
  const exponent = currencyExponent(currency);
  const [whole = "", fraction = ""] = text.replace(/,/g, "").split(".");
  if (fraction.length > exponent) return null;
  const scale = BigInt(10) ** BigInt(exponent);
  const minor = BigInt(whole) * scale + BigInt(fraction.padEnd(exponent, "0") || "0");
  if (minor > BigInt(MAX_RATE_MAJOR) * scale) return null;
  return Number(minor);
}

/** round_half_up(rate × seconds / 3600), in minor units. */
export function amountFor(rateMinor: number, seconds: number): number {
  return Number((BigInt(rateMinor) * BigInt(seconds) + BigInt(1800)) / BigInt(3600));
}

/** 12050, "USD" → "120.50": a plain decimal for spreadsheets (no symbol, no grouping). */
export function minorToDecimal(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const sign = minor < 0 ? "-" : "";
  const digits = Math.abs(minor)
    .toString()
    .padStart(exponent + 1, "0");
  return exponent > 0
    ? `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`
    : `${sign}${digits}`;
}

/** 125050, "USD" → "$1,250.50". */
export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  const exponent = currencyExponent(currency);
  const sign = minor < 0 ? "-" : "";
  const digits = Math.abs(minor)
    .toString()
    .padStart(exponent + 1, "0");
  const decimal =
    exponent > 0 ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits;
  // A decimal string keeps every digit (Intl formats strings exactly).
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    `${sign}${decimal}` as unknown as number,
  );
}
