import { test, expect } from "@playwright/test";

// Drives the real app in Chromium via the hardware-free demo device.

async function connectDemo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /try a demo keyboard/i }).click();
  await page.getByRole("option", { name: /demo · 50-key ortho/i }).click();
  // Wait for the connected editor (the layer list only renders once connected).
  await expect(
    page.getByRole("listbox", { name: /keymap layer/i })
  ).toBeVisible();
}

test("connects to the demo keyboard from the hero page", async ({ page }) => {
  await connectDemo(page);

  const layers = page.getByRole("listbox", { name: /keymap layer/i });
  await expect(layers.getByRole("option", { name: "Base" })).toBeVisible();
  await expect(layers.getByRole("option", { name: "Fn" })).toBeVisible();

  // The hero marketing copy is gone — we're really in the editor.
  await expect(
    page.getByText(/a community fork of zmk studio/i)
  ).toHaveCount(0);
});

test("switches the active layer", async ({ page }) => {
  await connectDemo(page);

  const layers = page.getByRole("listbox", { name: /keymap layer/i });
  const fn = layers.getByRole("option", { name: "Fn" });
  await fn.click();
  await expect(fn).toHaveAttribute("aria-selected", "true");
});

test("selecting a key opens the behavior/key picker", async ({ page }) => {
  await connectDemo(page);

  // Click a key on the rendered keymap (the "Q" key on the base layer).
  await page.getByRole("button", { name: /\bQ\b/ }).first().click();

  // The picker surfaces its cross-tab search box once a key is selected.
  await expect(page.getByPlaceholder(/filter keys/i)).toBeVisible();
});
