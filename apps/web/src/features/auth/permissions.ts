import type { Role } from "@/types/auth";

/**
 * What each role may do. Used to hide UI controls; the real enforcement
 * happens in the BFF route handlers AND again in each backend service.
 */
export const permissions = {
  createPayment: ["admin"],
  simulatePayment: ["admin"],
  cancelPayment: ["admin"],
  manageMonitoredServices: ["admin"],
  runHealthChecks: ["admin"],
  manageIncidents: ["admin"],
  viewAuditLog: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof permissions;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (permissions[permission] as readonly Role[]).includes(role);
}
