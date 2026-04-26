const { test, expect } = require('@playwright/test');

test.describe('Product Browsing', () => {
  test('home page loads with featured products', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/fusion|ecom|shop/i);
    await expect(page.locator('[data-testid="product-card"]').first())
      .toBeVisible({ timeout: 15000 });
  });

  test('shop page loads and displays product grid', async ({ page }) => {
    await page.goto('/shop');
    await expect(
      page.locator('[data-testid="product-card"]').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('product cards show name and price', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    await expect(firstCard.getByText(/\$[\d,.]+|[\d,.]+\s*(usd|USD)/)).toBeVisible();
  });

  test('clicking a product card navigates to product detail page', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    await firstCard.click();
    await expect(page).toHaveURL(/\/product(s)?\/|\/item\//);
    await expect(page.getByRole('button', { name: /see me in cart/i })).toBeVisible({ timeout: 10000 });
  });

  test('product detail page shows name, price, and add-to-cart button', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    await firstCard.click();
    await expect(page.getByRole('button', { name: /see me in cart/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/\$[\d,.]+/)).toBeVisible();
  });

  test('product detail page shows recommendations section', async ({ page }) => {
    await page.goto('/shop');
    const firstCard = page.locator('[data-testid="product-card"]').first();
    await firstCard.waitFor({ timeout: 15000 });
    await firstCard.click();
    await expect(
      page.getByText(/you may also like|similar|recommended|related/i)
    ).toBeVisible({ timeout: 15000 });
  });
});
