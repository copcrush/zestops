/** The shared error envelope returned by every ZestOps API (BFF and backends). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    request_id?: string | null;
    details?: unknown;
  };
}

export interface FieldError {
  field: string;
  message: string;
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const error = (value as { error: unknown }).error;
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

export function extractFieldErrors(details: unknown): FieldError[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.filter((item): item is FieldError =>
    typeof item === "object" && item !== null && typeof item.field === "string" && typeof item.message === "string");
}
