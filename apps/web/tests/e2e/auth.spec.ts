import { expect, test } from "@playwright/test";

import { ADMIN, signIn } from "./helpers";

test.describe("authentication", () => {
  test("protected pages redirect to login and back after sign-in @mobile", async ({ page }) => {
    await page.goto("/payments");
    await expect(page).toHaveURL(/\/login\?next=%2Fpayments/);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-mail").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/payments$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Simulated payments");
  });

  test("wrong password shows a generic error", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-mail").fill("nobody@zestops.demo");
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    // (Next.js also renders an empty role="alert" route announcer, so filter by text.)
    await expect(page.getByRole("alert").filter({ hasText: "Invalid e-mail or password" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("open redirects are blocked after login", async ({ page }) => {
    await signIn(page, ADMIN, "/login?next=https%3A%2F%2Fevil.example%2Fsteal");
    await expect(page).toHaveURL(/localhost:3000\/dashboard$/);
  });

  test("session cookie is HttpOnly and logout revokes the session", async ({ page, context }) => {
    await signIn(page, ADMIN);
    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name.includes("zestops_session"));
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toContain("zestops_session");

    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/login\?reason=signed-out/);

    // Re-using the old cookie value must not work: the session row was deleted.
    await context.addCookies([{ ...sessionCookie!, expires: -1 }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("security headers are set on pages", async ({ page }) => {
    const response = await page.goto("/login");
    const headers = response!.headers();
    expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
