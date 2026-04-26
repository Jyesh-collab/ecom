const { test, expect } = require('@playwright/test');

test.describe('Search', () => {

  // ── Navigation Bar UI ─────────────────────────────────────────────────────
  test('navigation bar shows "Home" link with exact text', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('navigation bar shows "Shop" link with exact text', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Shop', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('navigation bar shows "About" link with exact text', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'About', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('navigation bar shows "Support" link with exact text', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Support', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('search bar is visible in navigation', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('navigation logo links back to home page', async ({ page }) => {
    await page.goto('/shop');
    const logo = page.getByRole('link', { name: /fusion|logo|home/i }).first();
    if (await logo.count() > 0) {
      await logo.click();
      await expect(page).toHaveURL(/^\/?($|#)/);
    }
  });

  // ── Search Functionality ──────────────────────────────────────────────────
  test('searching for "laptop" returns product results', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('laptop');
    await searchBox.press('Enter');
    await expect(page).toHaveURL(/search|query|q=/i, { timeout: 8000 });
    await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('searching for "phone" returns at least one result', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('phone');
    await searchBox.press('Enter');
    const cards = page.locator('[data-testid="product-card"]');
    await cards.first().waitFor({ timeout: 15000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('searching for a nonexistent product shows empty state message', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('xyzproductthatdoesnotexist99999');
    await searchBox.press('Enter');
    await expect(
      page.getByText(/no results|no products|not found|empty/i)
    ).toBeVisible({ timeout: 15000 });
  });

  // ── Search API Coverage ───────────────────────────────────────────────────
  test('search API returns 200 for a valid query', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('laptop');

    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/search') && res.status() === 200, { timeout: 10000 }),
      searchBox.press('Enter'),
    ]);
    expect(response.status()).toBe(200);
  });

  test('search API returns empty array for nonexistent product', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('xyzproductthatdoesnotexist99999');

    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/search'), { timeout: 10000 }),
      searchBox.press('Enter'),
    ]);
    expect(response.status()).toBe(200);
    const body = await response.json();
    const results = Array.isArray(body) ? body : body.results || body.products || [];
    expect(results.length).toBe(0);
  });

  // ── DB Coverage ───────────────────────────────────────────────────────────
  test('products DB has data — search returns results for common term', async ({ page }) => {
    await page.goto('/');
    const searchBox = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox'));
    await searchBox.fill('a');

    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/search'), { timeout: 10000 }),
      searchBox.press('Enter'),
    ]);
    const body = await response.json();
    const results = Array.isArray(body) ? body : body.results || body.products || [];
    // DB must have at least 1 product with "a" in name/description
    expect(results.length).toBeGreaterThan(0);
  });
});
