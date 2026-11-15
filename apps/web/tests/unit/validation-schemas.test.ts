import { describe, expect, it } from "vitest";

import { pluralize } from "@/lib/shared/format";
import {
  changePasswordRequestSchema,
  createPaymentRequestSchema,
  incidentStatusRequestSchema,
  loginRequestSchema,
} from "@/lib/shared/validation-schemas";

const validPayment = {
  merchant_reference: "ORDER-1",
  description: "Test",
  amount_minor: 1000,
  currency: "THB",
  payment_method: "card",
  idempotency_key: "0b4f6a0e-5c5e-4a7b-9a51-3cfa2d39f0a1",
};

describe("createPaymentRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(createPaymentRequestSchema.safeParse(validPayment).success).toBe(true);
  });

  it.each([
    ["float amount", { amount_minor: 10.5 }],
    ["negative amount", { amount_minor: -1 }],
    ["amount above maximum", { amount_minor: 100_000_000_001 }],
    ["string amount", { amount_minor: "1000" }],
    ["lowercase currency", { currency: "thb" }],
    ["unknown method", { payment_method: "cash" }],
    ["script in merchant reference", { merchant_reference: "<script>" }],
    ["control characters in description", { description: "a\u0000b" }],
    ["short idempotency key", { idempotency_key: "abc" }],
    ["client-supplied created_by", { created_by: "00000000-0000-4000-8000-000000000001" }],
    ["client-supplied status", { status: "succeeded" }],
  ])("rejects %s", (_name, override) => {
    expect(createPaymentRequestSchema.safeParse({ ...validPayment, ...override }).success).toBe(false);
  });
});

describe("other request schemas", () => {
  it("normalizes nothing silently for login but rejects extra fields", () => {
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password: "x", role: "admin" }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("requires a note to resolve an incident", () => {
    expect(incidentStatusRequestSchema.safeParse({ status: "resolved" }).success).toBe(false);
    expect(incidentStatusRequestSchema.safeParse({ status: "resolved", note: "Fixed DNS" }).success).toBe(true);
    expect(incidentStatusRequestSchema.safeParse({ status: "investigating" }).success).toBe(true);
    expect(incidentStatusRequestSchema.safeParse({ status: "open" }).success).toBe(false);
  });

  it("enforces password length and change", () => {
    expect(changePasswordRequestSchema.safeParse({ current_password: "old", new_password: "short" }).success).toBe(false);
    expect(changePasswordRequestSchema.safeParse({ current_password: "same-password-123", new_password: "same-password-123" }).success).toBe(false);
    expect(changePasswordRequestSchema.safeParse({ current_password: "old", new_password: "a long passphrase" }).success).toBe(true);
  });
});

describe("pluralize", () => {
  it("handles singular and plural", () => {
    expect(pluralize(1, "payment")).toBe("1 payment");
    expect(pluralize(0, "payment")).toBe("0 payments");
    expect(pluralize(3, "check")).toBe("3 checks");
  });
});
