const { test, expect } = require('@playwright/test');

async function addProductToCart(page) {
  await page.goto('/shop');
  const firstCard = page.locator('[data-testid="product-card"]').first();
  await firstCard.waitFor({ timeout: 15000 });
  await firstCard.click();
  await expect(page.getByRole('button', { name: 'See me in cart', exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'See me in cart', exact: true }).click();
}

test.describe('Checkout Flow', () => {

  // ── Navigation ────────────────────────────────────────────────────────────
  test('"Proceed to Checkout" button on cart navigates to /checkout', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/cart');
    // Exact text — catches any rename of this button
    await expect(page.getByRole('button', { name: 'Proceed to Checkout', exact: true })).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Proceed to Checkout', exact: true }).click();
    await expect(page).toHaveURL(/\/checkout/, { timeout: 8000 });
  });

  // ── Checkout Form UI ──────────────────────────────────────────────────────
  test('checkout form renders email field', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 10000 });
  });

  test('checkout form renders card number field', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await expect(page.getByLabel(/card number|card no/i)).toBeVisible({ timeout: 10000 });
  });

  test('checkout form renders expiry field', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await expect(page.getByLabel(/expir/i)).toBeVisible({ timeout: 10000 });
  });

  test('checkout form renders CVC field', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await expect(page.getByLabel(/cvc|cvv|security code/i)).toBeVisible({ timeout: 10000 });
  });

  test('checkout submit button exists', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: /pay|place order|submit/i })).toBeVisible({ timeout: 10000 });
  });

  // ── Validation ────────────────────────────────────────────────────────────
  test('shows error for invalid card number (too short)', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await page.getByLabel(/email/i).fill('buyer@example.com');
    await page.getByLabel(/card number|card no/i).fill('1234');
    await page.getByRole('button', { name: /pay|place order|submit/i }).click();
    await expect(page.getByText(/invalid|card.*number|error/i)).toBeVisible({ timeout: 8000 });
  });

  test('shows error for invalid expiry date', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await page.getByLabel(/email/i).fill('buyer@example.com');
    await page.getByLabel(/card number|card no/i).fill('4111111111111111');
    await page.getByLabel(/expir/i).fill('00/00');
    await page.getByRole('button', { name: /pay|place order|submit/i }).click();
    await expect(page.getByText(/invalid|expir|error/i)).toBeVisible({ timeout: 8000 });
  });

  test('shows error for missing email', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await page.getByLabel(/card number|card no/i).fill('4111111111111111');
    await page.getByRole('button', { name: /pay|place order|submit/i }).click();
    await expect(page.getByText(/email|required|invalid/i)).toBeVisible({ timeout: 8000 });
  });

  // ── API Coverage ──────────────────────────────────────────────────────────
  test('checkout API returns success for valid card details', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await page.getByLabel(/email/i).fill('buyer@example.com');
    await page.getByLabel(/card number|card no/i).fill('4111111111111111');
    await page.getByLabel(/expir/i).fill('12/28');
    const cvcField = page.getByLabel(/cvc|cvv|security code/i);
    if (await cvcField.count() > 0) await cvcField.fill('123');

    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/checkout') && res.status() === 200, { timeout: 20000 }),
      page.getByRole('button', { name: /pay|place order|submit/i }).click(),
    ]);
    expect(response.status()).toBe(200);
  });

  test('successful checkout redirects to order success page', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await page.getByLabel(/email/i).fill('buyer@example.com');
    await page.getByLabel(/card number|card no/i).fill('4111111111111111');
    await page.getByLabel(/expir/i).fill('12/28');
    const cvcField = page.getByLabel(/cvc|cvv|security code/i);
    if (await cvcField.count() > 0) await cvcField.fill('123');
    await page.getByRole('button', { name: /pay|place order|submit/i }).click();
    await expect(page).toHaveURL(/order.*success|success|confirmation/i, { timeout: 20000 });
    await expect(page.getByText(/order.*placed|thank you|success/i)).toBeVisible({ timeout: 10000 });
  });

  test('checkout API rejects invalid card number', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await page.getByLabel(/email/i).fill('buyer@example.com');
    await page.getByLabel(/card number|card no/i).fill('0000000000000000');
    await page.getByLabel(/expir/i).fill('12/28');
    const cvcField = page.getByLabel(/cvc|cvv|security code/i);
    if (await cvcField.count() > 0) await cvcField.fill('123');
    await page.getByRole('button', { name: /pay|place order|submit/i }).click();
    await expect(page.getByText(/invalid|error|failed/i)).toBeVisible({ timeout: 10000 });
  });
});
