import { expect, test } from "@playwright/test";

import { ADMIN, signIn, uniqueSuffix } from "./helpers";

test.describe("monitoring and incidents (admin)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN);
  });

  test("run all checks and see results", async ({ page }) => {
    await page.goto("/monitoring");
    await page.getByRole("button", { name: "Run all checks" }).click();
    await expect(page.getByText(/checks? finished/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("row", { name: /Payment API/ }).getByText("up", { exact: true })).toBeVisible();
  });

  test("registering a non-approved URL is blocked (SSRF protection)", async ({ page }) => {
    await page.goto("/monitoring");
    await page.getByRole("button", { name: "Register service" }).click();
    const dialog = page.getByRole("dialog", { name: "Register an approved service" });
    await dialog.getByLabel("Name").fill(`Metadata ${uniqueSuffix()}`);
    await dialog.getByLabel("Health check URL").fill("http://169.254.169.254/latest/meta-data/");
    await dialog.getByRole("button", { name: "Register" }).click();
    await expect(dialog.getByText("This URL is not in the approved monitoring targets.")).toBeVisible();
  });

  test("report, investigate and resolve an incident @mobile", async ({ page }) => {
    const title = `E2E incident ${uniqueSuffix()}`;
    await page.goto("/incidents");
    await page.getByRole("button", { name: "Report incident" }).click();
    const dialog = page.getByRole("dialog", { name: "Report an incident" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Severity").selectOption("high");
    await dialog.getByLabel("What is happening?").fill("Checkout returns 500 for some users.");
    await dialog.getByRole("button", { name: "Open incident" }).click();

    await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await page.getByRole("button", { name: "Start investigating" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Incident is now investigating" })).toBeVisible();

    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByText("Describe the resolution", { exact: false }).or(page.getByText("a note (3-2000 characters) is required", { exact: false })).first()).toBeVisible();

    await page.getByLabel("Note").fill("Rolled back the faulty release.");
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByText("Rolled back the faulty release.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  });
});
