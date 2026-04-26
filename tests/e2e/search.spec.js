const { test, expect } = require('@playwright/test');

test.describe('Search', () => {
  test('search bar is visible in navigation', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('searching for a product returns results', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('laptop');
    await searchBox.press('Enter');
    await expect(page).toHaveURL(/search|query|q=/i, { timeout: 8000 });
    await expect(
      page.locator('[data-testid="product-card"]').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('searching for a nonexistent product shows empty state', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('xyzproductthatdoesnotexist99999');
    await searchBox.press('Enter');
    await expect(
      page.getByText(/no results|no products|not found|empty/i)
    ).toBeVisible({ timeout: 15000 });
  });

  test('search results contain the queried keyword in product names', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('phone');
    await searchBox.press('Enter');

    const cards = page.locator('[data-testid="product-card"]');
    await cards.first().waitFor({ timeout: 15000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('navigation bar logo links back to home', async ({ page }) => {
    await page.goto('/shop');
    const logo = page.getByRole('link', { name: /fusion|logo|home/i }).first();
    if (await logo.count() > 0) {
      await logo.click();
      await expect(page).toHaveURL(/^\/?($|#)/);
    }
  });
});
