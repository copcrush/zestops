import { expect, test } from "@playwright/test";

import { readCsrfToken, signIn, VIEWER } from "./helpers";

test.describe("viewer role (RBAC)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, VIEWER);
  });

  test("admin controls are hidden from viewers @mobile", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Simulated payments");
    await expect(page.getByRole("button", { name: "New payment" })).toHaveCount(0);

    await page.goto("/payments?status=pending");
    await page.locator('a[href^="/payments/"]').first().click();
    await expect(page.getByText("Only administrators can run the simulation workflow.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Simulate success" })).toHaveCount(0);

    await page.goto("/monitoring");
    await expect(page.getByRole("button", { name: "Run all checks" })).toHaveCount(0);
    await page.goto("/incidents");
    await expect(page.getByRole("button", { name: "Report incident" })).toHaveCount(0);
  });

  test("admin-only page shows the 403 page", async ({ page }) => {
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/unauthorized$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("don't have access");
  });

  test("the BFF rejects viewer writes even with a valid CSRF token", async ({ page }) => {
    await page.goto("/payments");
    const csrfToken = await readCsrfToken(page);
    const response = await page.request.post("/api/payments", {
      headers: { "X-CSRF-Token": csrfToken, Origin: "http://localhost:3000" },
      data: { merchant_reference: "HACK", amount_minor: 100, currency: "THB", payment_method: "card",
        idempotency_key: "viewer-attempt-0001", description: "" },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  });

  test("requests without a CSRF token or from another origin are rejected", async ({ page }) => {
    await page.goto("/payments");
    const withoutToken = await page.request.delete("/api/profile/sessions", { headers: { Origin: "http://localhost:3000" } });
    expect(withoutToken.status()).toBe(403);
    expect((await withoutToken.json()).error.code).toBe("CSRF_TOKEN_INVALID");

    const crossOrigin = await page.request.patch("/api/profile", {
      headers: { Origin: "https://evil.example", "X-CSRF-Token": await readCsrfToken(page) },
      data: { display_name: "Hacked" },
    });
    expect(crossOrigin.status()).toBe(403);
    expect((await crossOrigin.json()).error.code).toBe("CROSS_ORIGIN_REQUEST");
  });
});
