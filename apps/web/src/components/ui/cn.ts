import { clsx, type ClassValue } from "clsx";

/** Join conditional class names: cn("a", isActive && "b"). */
export function cn(...classValues: ClassValue[]): string {
  return clsx(classValues);
}
