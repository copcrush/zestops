/**
 * Money helpers shared by server and browser code.
 *
 * Amounts are integer MINOR units (satang, cents) everywhere (ADR-0005).
 * Conversions use string arithmetic only — never parseFloat — so values such
 * as 0.1 + 0.2 can never introduce rounding errors.
 */

export const MAXIMUM_AMOUNT_MINOR = 100_000_000_000;

export type ParseAmountResult =
  | { ok: true; amountMinor: number }
  | { ok: false; error: string };

/**
 * Convert a decimal string typed by a user ("1,250.50") into minor units (125050).
 * `minorUnitExponent` is the number of decimal places of the currency (THB 2, JPY 0).
 */
export function parseDecimalToMinorUnits(rawInput: string, minorUnitExponent: number): ParseAmountResult {
  const normalizedInput = rawInput.trim().replaceAll(",", "");
  if (normalizedInput === "") {
    return { ok: false, error: "Enter an amount." };
  }
  const decimalPattern = /^(\d{1,12})(?:\.(\d+))?$/;
  const match = decimalPattern.exec(normalizedInput);
  if (!match) {
    return { ok: false, error: "Use digits with an optional decimal point, e.g. 1250.50." };
  }

  const wholePart = match[1] ?? "0";
  const fractionPart = match[2] ?? "";
  if (fractionPart.length > minorUnitExponent) {
    return minorUnitExponent === 0
      ? { ok: false, error: "This currency has no decimal places." }
      : { ok: false, error: `Use at most ${minorUnitExponent} decimal places.` };
  }

  const paddedFraction = fractionPart.padEnd(minorUnitExponent, "0");
  const amountMinor = Number(BigInt(wholePart + paddedFraction));
  if (amountMinor <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }
  if (amountMinor > MAXIMUM_AMOUNT_MINOR) {
    return { ok: false, error: "Amount is above the maximum allowed." };
  }
  return { ok: true, amountMinor };
}

/** Convert minor units back to a plain decimal string: (125050, 2) -> "1250.50". */
export function minorUnitsToDecimalString(amountMinor: number | string, minorUnitExponent: number): string {
  const amount = BigInt(amountMinor);
  const isNegative = amount < BigInt(0);
  const digits = (isNegative ? -amount : amount).toString().padStart(minorUnitExponent + 1, "0");
  const wholePart = minorUnitExponent === 0 ? digits : digits.slice(0, -minorUnitExponent);
  const fractionPart = minorUnitExponent === 0 ? "" : `.${digits.slice(-minorUnitExponent)}`;
  return `${isNegative ? "-" : ""}${wholePart}${fractionPart}`;
}

/**
 * Format minor units for display, e.g. (125050, "THB", 2) -> "฿1,250.50".
 * Intl.NumberFormat accepts a decimal STRING, so no floating point is involved.
 */
export function formatMoney(amountMinor: number | string, currencyCode: string, minorUnitExponent: number,
                            locale = "en-US"): string {
  const decimalString = minorUnitsToDecimalString(amountMinor, minorUnitExponent);
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: minorUnitExponent,
    maximumFractionDigits: minorUnitExponent,
  });
  // TypeScript's lib types do not yet include the string overload of format().
  return formatter.format(decimalString as unknown as number);
}

/** Minor-unit exponents per ISO 4217, used only for display before currencies load. */
export const DEFAULT_MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  THB: 2, USD: 2, EUR: 2, GBP: 2, SGD: 2, JPY: 0,
};
