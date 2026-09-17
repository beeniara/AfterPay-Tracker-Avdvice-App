import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("add an order, record every payment, and it settles", async ({ page }) => {
  await signIn(page);
  const reference = `E2E-${Date.now()}`;

  await page.goto("/orders/new");
  await page.getByLabel("Merchant").fill("Cobalt Kitchenware");
  await page.getByLabel("Order number").fill(reference);
  await page.getByLabel(/Order amount/).fill("100.00");
  await page.getByRole("button", { name: "Add order" }).click();

  await expect(page.getByRole("heading", { name: "Cobalt Kitchenware" })).toBeVisible();
  await expect(page.getByText("4 remaining")).toBeVisible();
  await expect(page.locator(".timeline > li")).toHaveCount(4);

  for (let step = 0; step < 4; step++) {
    const item = page.locator(".timeline > li").nth(step);
    await item.locator("summary").click();
    await item.getByRole("button", { name: "Mark paid" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`${3 - step} remaining`)).toBeVisible();
  }

  await expect(page.getByText("0 remaining")).toBeVisible();
  await expect(page.locator("dd", { hasText: "$100.00" }).first()).toBeVisible();
  await expect(page.locator("section").first().getByText("Paid", { exact: true })).toBeVisible();
});

test("the filter bar narrows the list", async ({ page }) => {
  await signIn(page);
  const reference = `FILTER-${Date.now()}`;
  const providers = await page.request.get("/api/providers").then((r) => r.json());
  const created = await page.request.post("/api/orders", {
    data: {
      providerId: providers.results[0].id,
      merchant: "Fernway Pharmacy",
      reference,
      channel: "in_store",
      purchasedOn: "2026-01-15",
      totalAmount: "48.00",
    },
  });
  expect(created.status()).toBe(201);

  await page.goto("/orders");
  await page.getByLabel("Search").fill(reference);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=FILTER-/);
  await expect(page.getByText("1 orders")).toBeVisible();
  await expect(page.getByRole("link", { name: "Fernway Pharmacy" })).toBeVisible();

  await page.getByText("Paid", { exact: true }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No orders match")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL("/orders");
});
