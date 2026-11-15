import { expect, test } from "@playwright/test";

import { ADMIN, signIn, uniqueSuffix } from "./helpers";

test.describe("payments (admin)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN);
  });

  test("create a payment and simulate success @mobile", async ({ page }) => {
    const merchantReference = `E2E-${uniqueSuffix()}`;
    await page.goto("/payments");
    await page.getByRole("button", { name: "New payment" }).click();
    const dialog = page.getByRole("dialog", { name: "New simulated payment" });
    await dialog.getByLabel("Merchant reference").fill(merchantReference);
    await dialog.getByLabel("Amount").fill("1,234.56");
    await dialog.getByLabel("Currency").selectOption("THB");
    await expect(dialog.getByText("Will be charged as THB 1,234.56")).toBeVisible();
    await dialog.getByRole("button", { name: "Create payment" }).click();

    await expect(page).toHaveURL(/\/payments\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("THB 1,234.56");
    await expect(page.getByText(merchantReference)).toBeVisible();
    await expect(page.getByText("123456", { exact: true })).toBeVisible(); // minor units, no floats

    await page.getByRole("button", { name: "Simulate success" }).click();
    await expect(page.getByText("Payment is final")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "is now succeeded" })).toBeVisible();
    const history = page.locator("ol").filter({ hasText: "Simulation started" });
    await expect(history.locator("li")).toHaveCount(3);
  });

  test("simulate a failure with a reason", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "New payment" }).click();
    const dialog = page.getByRole("dialog", { name: "New simulated payment" });
    await dialog.getByLabel("Merchant reference").fill(`E2E-FAIL-${uniqueSuffix()}`);
    await dialog.getByLabel("Amount").fill("99");
    await dialog.getByRole("button", { name: "Create payment" }).click();
    await expect(page).toHaveURL(/\/payments\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: "Simulate failure" }).click();
    const failureDialog = page.getByRole("dialog", { name: "Simulate a failed payment" });
    await failureDialog.getByLabel("Failure reason").fill("E2E: insufficient funds");
    await failureDialog.getByRole("button", { name: "Mark as failed" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Payment failed" })).toContainText("E2E: insufficient funds");
  });

  test("amount validation prevents too many decimals", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "New payment" }).click();
    const dialog = page.getByRole("dialog", { name: "New simulated payment" });
    await dialog.getByLabel("Merchant reference").fill("E2E-INVALID");
    await dialog.getByLabel("Amount").fill("12.345");
    await dialog.getByRole("button", { name: "Create payment" }).click();
    await expect(dialog.getByText("Use at most 2 decimal places.")).toBeVisible();
    await dialog.getByLabel("Currency").selectOption("JPY");
    await dialog.getByLabel("Amount").fill("100.5");
    await dialog.getByRole("button", { name: "Create payment" }).click();
    await expect(dialog.getByText("This currency has no decimal places.")).toBeVisible();
  });

  test("filter by status", async ({ page }) => {
    await page.goto("/payments?status=failed");
    const statusBadges = page.locator("tbody").getByText("failed", { exact: true });
    await expect(statusBadges.first()).toBeVisible();
    await expect(page.locator("tbody").getByText("succeeded", { exact: true })).toHaveCount(0);
  });
});
