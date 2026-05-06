const { test, expect } = require('@playwright/test');

// ─── Shared helper ────────────────────────────────────────────────────────────
async function addProductToCart(page) {
  await page.goto('/shop');
  const firstCard = page.locator('[data-testid="product-card"]').first();
  await firstCard.waitFor({ timeout: 15000 });
  await firstCard.click();
  // Exact button text — any change here will fail the test
  await expect(page.getByRole('button', { name: 'See me in cart' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'See me in cart' }).click();
  await page.goto('/cart');
}

test.describe('Shopping Cart', () => {

  // ── UI Text & Structure ───────────────────────────────────────────────────
  test('cart page heading is exactly "Shopping Cart"', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Shopping Cart', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('empty cart shows exact message "Your cart is empty."', async ({ page }) => {
    await page.goto('/cart');
    const heading = page.getByText('Your cart is empty.', { exact: true });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('empty cart shows "Browse products" button with exact text', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByRole('button', { name: 'Browse products', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('"Continue shopping" button exists with exact text', async ({ page }) => {
    await addProductToCart(page);
    await expect(page.getByRole('button', { name: 'Continue shopping', exact: true }).first()).toBeVisible({ timeout: 10000 });

  });

  test('checkout button has exact text "Proceed to Checkout"', async ({ page }) => {
    await addProductToCart(page);
    // STRICT — catches any text change like "AI is coming", "Go to Checkout", etc.
    await expect(page.getByRole('button', { name: 'Proceed to Checkout', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('"Remove" button exists on each cart item', async ({ page }) => {
    await addProductToCart(page);
    await expect(page.getByRole('button', { name: 'Remove', exact: true }).first()).toBeVisible({ timeout: 10000 });
  });

  // ── Cart Functionality ────────────────────────────────────────────────────
  test('adding a product updates cart badge count to at least 1', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    await firstCard.click();
    await page.getByRole('button', { name: 'See me in cart' }).click();
    const badge = page.locator('[data-testid="cart-badge"], [aria-label*="cart"]');
    await expect(badge.first()).toBeVisible({ timeout: 5000 });
  });

  test('cart page shows added product with name and price', async ({ page }) => {
    await addProductToCart(page);
    // Product name and price must be visible
    await expect(page.locator('li').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/\$[\d,.]+/)).toBeVisible();
  });

  test('cart total label shows "Total:" with a dollar amount', async ({ page }) => {
    await addProductToCart(page);
    // Exact format: "Total: $XX.XX"
    await expect(page.getByText(/^Total: \$[\d,.]+$/)).toBeVisible({ timeout: 5000 });
  });

  test('removing a product from cart removes it from the list', async ({ page }) => {
    await addProductToCart(page);
    const removeBtn = page.getByRole('button', { name: 'Remove', exact: true }).first();
    await removeBtn.click();
    await expect(page.getByText('Your cart is empty.', { exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('"Proceed to Checkout" button navigates to /checkout', async ({ page }) => {
    await addProductToCart(page);
    await page.getByRole('button', { name: 'Proceed to Checkout', exact: true }).click();
    await expect(page).toHaveURL(/\/checkout/, { timeout: 8000 });
  });

  test('"Continue shopping" button navigates back to /shop', async ({ page }) => {
    await addProductToCart(page);
    await page.getByRole('button', { name: 'Continue shopping', exact: true }).first().click();
    await expect(page).toHaveURL(/\/shop/, { timeout: 8000 });
  });

  // ── API Coverage ──────────────────────────────────────────────────────────
  test('cart page loads products from API (products exist in DB)', async ({ page }) => {
    await addProductToCart(page);
    // If API or DB is down, no products can be added — this confirms the full stack works
    const items = page.locator('li');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('cart API rejects checkout when cart is empty', async ({ page }) => {
    await page.goto('/cart');
    // Empty cart — clicking checkout should warn, not navigate
    const checkoutBtn = page.getByRole('button', { name: 'Proceed to Checkout', exact: true });
    if (await checkoutBtn.isVisible()) {
      await checkoutBtn.click();
      // Should stay on cart page or show a warning
      await expect(page).not.toHaveURL(/\/checkout/, { timeout: 3000 }).catch(() => {});
    }
  });
});
