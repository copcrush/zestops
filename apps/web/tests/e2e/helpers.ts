import { expect, type Page } from "@playwright/test";

export const ADMIN = { email: "admin@zestops.demo", password: "LocalAdmin#2026" };
export const VIEWER = { email: "viewer@zestops.demo", password: "LocalViewer#2026" };

export async function signIn(page: Page, account: { email: string; password: string }, path = "/login") {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  // Wait until the new page has hydrated: clicking a button before React attaches
  // its handlers does nothing (this caused a flaky logout test).
  await page.waitForLoadState("networkidle");
}

/** Reads the CSRF token from the page's server-rendered payload (to call the BFF directly in tests). */
export async function readCsrfToken(page: Page): Promise<string> {
  const html = await page.content();
  const match = /csrfToken\\?":\\?"([A-Za-z0-9_-]{43})/.exec(html);
  if (!match?.[1]) {
    throw new Error("CSRF token not found in page");
  }
  return match[1];
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.toUpperCase();
}
