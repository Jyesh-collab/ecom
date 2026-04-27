const { test, expect } = require('@playwright/test');

test.describe('Product Browsing', () => {

  // ── Page Title & Structure ────────────────────────────────────────────────
  test('home page title contains "Fusion"', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Fusion/i);
  });

  test('home page loads with at least one product card', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('shop page loads and displays product grid', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('shop page shows more than one product card', async ({ page }) => {
    await page.goto('/shop');
    await page.locator('[data-testid="product-card"]').first().waitFor({ timeout: 15000 });
    const count = await page.locator('[data-testid="product-card"]').count();
    expect(count).toBeGreaterThan(1);
  });

  // ── Product Card UI Text ──────────────────────────────────────────────────
  test('product card shows price in "$X.XX" format', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    await expect(firstCard.getByText(/\$[\d]+\.[\d]{2}/)).toBeVisible();
  });

  test('product card "See me in cart" button has exact text', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    // STRICT — catches "Add to Cart", "Buy Now", "AI is coming", any other text change
    await expect(firstCard.getByRole('button', { name: 'See me in cart', exact: true })).toBeVisible();
  });

  test('product card "View Details" button has exact text', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    await expect(firstCard.getByRole('button', { name: 'View Details', exact: true }).first()).toBeVisible();
  });

  // ── Navigation ────────────────────────────────────────────────────────────
  test('clicking product card navigates to /product/:id', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    await firstCard.click();
    await expect(page).toHaveURL(/\/product\//, { timeout: 10000 });
  });

  // ── Product Detail Page UI Text ───────────────────────────────────────────
  test('product detail page shows "See me in cart" button with exact text', async ({ page }) => {
    await page.goto('/shop');
    await page.locator('[data-testid="product-card"]').first().waitFor({ timeout: 15000 });
    await page.locator('[data-testid="product-card"]').first().click();
    // STRICT — any change to this button text is caught
    await expect(page.getByRole('button', { name: 'See me in cart', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('product detail page shows price', async ({ page }) => {
    await page.goto('/shop');
    await page.locator('[data-testid="product-card"]').first().waitFor({ timeout: 15000 });
    await page.locator('[data-testid="product-card"]').first().click();
    await expect(page.getByText(/\$[\d]+\.[\d]{2}/).first()).toBeVisible({ timeout: 20000 });
  });

  test('product detail page shows recommendations section', async ({ page }) => {
    await page.goto('/shop');
    await page.locator('[data-testid="product-card"]').first().waitFor({ timeout: 15000 });
    await page.locator('[data-testid="product-card"]').first().click();
    await expect(
      page.getByText(/you may also like|similar|recommended|related/i)
    ).toBeVisible({ timeout: 15000 });
  });

  // ── API & DB Coverage ─────────────────────────────────────────────────────
  test('products API returns data — shop page is not empty', async ({ page }) => {
    // Intercept the products API call and verify it returns 200
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/products') && res.status() === 200),
      page.goto('/shop'),
    ]);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body) || body.products || body.data).toBeTruthy();
  });

  test('product detail API returns 200 for a valid product', async ({ page }) => {
    await page.goto('/shop');
    await page.locator('[data-testid="product-card"]').first().waitFor({ timeout: 15000 });
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/products/') && res.status() === 200),
      page.locator('[data-testid="product-card"]').first().click(),
    ]);
    expect(response.status()).toBe(200);
  });
});
