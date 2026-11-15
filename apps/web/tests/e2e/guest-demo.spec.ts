import { expect, test } from "@playwright/test";

import { readCsrfToken } from "./helpers";

test.describe("public guest demo (read-only viewer)", () => {
  test("guest can explore without a password but cannot change the shared account @mobile", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Explore as guest (read-only)" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello, Demo Viewer");

    await page.goto("/payments");
    await expect(page.getByRole("button", { name: "New payment" })).toHaveCount(0);

    await page.goto("/settings");
    await expect(page.getByText("You are using the shared guest account")).toBeVisible();
    await expect(page.getByLabel("New password")).toHaveCount(0);

    const response = await page.request.patch("/api/profile", {
      headers: { "X-CSRF-Token": await readCsrfToken(page), Origin: "http://localhost:3000" },
      data: { display_name: "Renamed by a visitor" },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe("DEMO_ACCOUNT_READ_ONLY");
  });

  test("the demo endpoint rejects cross-origin requests", async ({ request }) => {
    const response = await request.post("/api/auth/demo", { headers: { Origin: "https://evil.example" } });
    expect(response.status()).toBe(403);
  });
});
