import { z } from "zod";

import { MAXIMUM_PASSWORD_LENGTH_SHARED, MINIMUM_PASSWORD_LENGTH_SHARED } from "@/lib/shared/password-rules";

/**
 * Zod schemas for every request the browser sends to the BFF.
 * Used on the server (authoritative) and in forms (fast feedback).
 * The backends validate again — never rely on a single layer.
 */
const noControlCharacters = (value: string) => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);

export const loginRequestSchema = z.object({
  email: z.email("Enter a valid e-mail address.").max(254),
  password: z.string().min(1, "Enter your password.").max(MAXIMUM_PASSWORD_LENGTH_SHARED),
}).strict();

export const createPaymentRequestSchema = z.object({
  merchant_reference: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,64}$/,
    "Use 1-64 letters, digits, '.', '_', ':' or '-'."),
  description: z.string().trim().max(280, "At most 280 characters.").refine(noControlCharacters,
    "Remove control characters.").default(""),
  amount_minor: z.number().int().positive().max(100_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/, "Choose a currency."),
  payment_method: z.enum(["card", "bank_transfer", "promptpay", "e_wallet"]),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
}).strict();

export const simulatePaymentRequestSchema = z.object({
  outcome: z.enum(["succeeded", "failed"]),
  failure_reason: z.string().trim().min(1).max(200).refine(noControlCharacters).optional(),
}).strict();

export const registerServiceRequestSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80).refine(noControlCharacters),
  description: z.string().trim().max(280).refine(noControlCharacters).default(""),
  target_url: z.url("Enter a full URL such as http://payment-api:8080/health/ready").max(2048),
  expected_status_code: z.number().int().min(100).max(599).default(200),
  timeout_ms: z.number().int().min(100).max(10_000).default(3000),
  degraded_threshold_ms: z.number().int().min(1).max(10_000).default(1000),
}).strict();

export const updateServiceRequestSchema = z.object({
  is_enabled: z.boolean().optional(),
  description: z.string().trim().max(280).refine(noControlCharacters).optional(),
  timeout_ms: z.number().int().min(100).max(10_000).optional(),
  degraded_threshold_ms: z.number().int().min(1).max(10_000).optional(),
  expected_status_code: z.number().int().min(100).max(599).optional(),
}).strict();

export const createIncidentRequestSchema = z.object({
  title: z.string().trim().min(3, "At least 3 characters.").max(120).refine(noControlCharacters),
  description: z.string().trim().max(2000).refine(noControlCharacters).default(""),
  severity: z.enum(["low", "medium", "high", "critical"]),
  service_id: z.uuid().nullable().optional(),
}).strict();

export const incidentStatusRequestSchema = z.object({
  status: z.enum(["investigating", "resolved"]),
  note: z.string().trim().min(3, "At least 3 characters.").max(2000).refine(noControlCharacters).optional(),
}).strict().refine((request) => request.status !== "resolved" || Boolean(request.note), {
  message: "Describe the resolution (at least 3 characters).",
  path: ["note"],
});

export const incidentNoteRequestSchema = z.object({
  note: z.string().trim().min(3, "At least 3 characters.").max(2000).refine(noControlCharacters),
}).strict();

export const updateProfileRequestSchema = z.object({
  display_name: z.string().trim().min(1, "Enter a name.").max(80).refine(noControlCharacters),
}).strict();

export const changePasswordRequestSchema = z.object({
  current_password: z.string().min(1, "Enter your current password.").max(MAXIMUM_PASSWORD_LENGTH_SHARED),
  new_password: z.string()
    .min(MINIMUM_PASSWORD_LENGTH_SHARED, `Use at least ${MINIMUM_PASSWORD_LENGTH_SHARED} characters.`)
    .max(MAXIMUM_PASSWORD_LENGTH_SHARED),
}).strict().refine((request) => request.current_password !== request.new_password, {
  message: "The new password must be different.",
  path: ["new_password"],
});

export const uuidSchema = z.uuid();
