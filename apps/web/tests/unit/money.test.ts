import { describe, expect, it } from "vitest";

import { formatMoney, minorUnitsToDecimalString, parseDecimalToMinorUnits } from "@/lib/shared/money";

describe("parseDecimalToMinorUnits", () => {
  it.each([
    ["1250.50", 2, 125050],
    ["1,250.50", 2, 125050],
    ["0.01", 2, 1],
    ["12", 2, 1200],
    ["12.5", 2, 1250],
    ["100", 0, 100],
    ["0.1", 2, 10],
    ["0.29", 2, 29], // 0.29 * 100 = 28.999999999999996 with floats
    ["1000000000", 2, 100_000_000_000],
  ])("parses %s with exponent %i as %i minor units", (input, exponent, expected) => {
    expect(parseDecimalToMinorUnits(input, exponent)).toEqual({ ok: true, amountMinor: expected });
  });

  it.each([
    ["", 2, "Enter an amount."],
    ["0", 2, "Amount must be greater than zero."],
    ["0.00", 2, "Amount must be greater than zero."],
    ["-5", 2, "Use digits"],
    ["1e5", 2, "Use digits"],
    ["12.345", 2, "Use at most 2 decimal places."],
    ["100.5", 0, "This currency has no decimal places."],
    ["abc", 2, "Use digits"],
    ["1.2.3", 2, "Use digits"],
    ["1000000000.01", 2, "above the maximum"],
    ["NaN", 2, "Use digits"],
  ])("rejects %s (exponent %i)", (input, exponent, expectedMessage) => {
    const result = parseDecimalToMinorUnits(input, exponent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(expectedMessage);
    }
  });
});

describe("minorUnitsToDecimalString", () => {
  it.each([
    [125050, 2, "1250.50"],
    [5, 2, "0.05"],
    [100, 0, "100"],
    ["9007199254740993", 2, "90071992547409.93"], // beyond Number precision, exact via BigInt
    [-150, 2, "-1.50"],
  ])("converts %s with exponent %i to %s", (amountMinor, exponent, expected) => {
    expect(minorUnitsToDecimalString(amountMinor, exponent)).toBe(expected);
  });
});

describe("formatMoney", () => {
  // Intl puts a non-breaking space (U+00A0) between a currency code and the number.
  const normalizeSpaces = (value: string) => value.replaceAll("\u00a0", " ");

  it("formats using the currency's decimal places", () => {
    expect(normalizeSpaces(formatMoney(125050, "THB", 2))).toBe("THB 1,250.50");
    expect(formatMoney(12800, "JPY", 0)).toBe("¥12,800");
    expect(formatMoney(129900, "USD", 2)).toBe("$1,299.00");
  });

  it("formats large totals passed as strings without losing precision", () => {
    expect(formatMoney("9007199254740993", "USD", 2)).toBe("$90,071,992,547,409.93");
  });
});
