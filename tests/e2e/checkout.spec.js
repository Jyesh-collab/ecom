const { test, expect } = require('@playwright/test');

async function addProductToCart(page) {
  await page.goto('/shop');
  const firstCard = page.locator('[data-testid="product-card"]').first();
  await firstCard.waitFor({ timeout: 15000 });
  await firstCard.click();
  await page.getByRole('button', { name: /see me in cart/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /see me in cart/i }).click();
}

test.describe('Checkout Flow', () => {
  test('checkout page is reachable from cart', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/cart');
    await page.getByRole('button', { name: /checkout|proceed/i }).click();
    await expect(page).toHaveURL(/checkout/i, { timeout: 8000 });
  });

  test('checkout form renders all required fields', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel(/card number|card no/i)).toBeVisible();
  });

  test('checkout shows validation error for invalid card number', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await page.getByLabel(/email/i).fill('buyer@example.com');
    await page.getByLabel(/card number|card no/i).fill('1234');
    await page.getByRole('button', { name: /pay|place order|submit/i }).click();
    await expect(page.getByText(/invalid|card.*number|error/i)).toBeVisible({ timeout: 8000 });
  });

  test('checkout shows validation error for invalid expiry', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');
    await page.getByLabel(/email/i).fill('buyer@example.com');
    await page.getByLabel(/card number|card no/i).fill('4111111111111111');

    const expiryField = page.getByLabel(/expir/i);
    if (await expiryField.count() > 0) {
      await expiryField.fill('00/00');
      await page.getByRole('button', { name: /pay|place order|submit/i }).click();
      await expect(page.getByText(/invalid|expir|error/i)).toBeVisible({ timeout: 8000 });
    }
  });

  test('successful checkout redirects to order success page', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/checkout');

    await page.getByLabel(/email/i).fill('buyer@example.com');
    await page.getByLabel(/card number|card no/i).fill('4111111111111111');

    const expiryField = page.getByLabel(/expir/i);
    if (await expiryField.count() > 0) await expiryField.fill('12/28');

    const cvcField = page.getByLabel(/cvc|cvv|security code/i);
    if (await cvcField.count() > 0) await cvcField.fill('123');

    await page.getByRole('button', { name: /pay|place order|submit/i }).click();

    // Backend has a 3-second simulated delay — give it time
    await expect(page).toHaveURL(/order.*success|success|confirmation/i, { timeout: 20000 });
    await expect(page.getByText(/order.*placed|thank you|success/i)).toBeVisible({ timeout: 10000 });
  });
});
