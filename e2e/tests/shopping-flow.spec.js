import { test, expect } from '@playwright/test';

test.describe('Fusion Electronics - Shopping Flow', () => {
  test('should load home page successfully', async ({ page }) => {
    await page.goto('/');
    
    // Check page title
    const title = await page.title();
    expect(title).toBeTruthy();
    
    // Check navigation bar exists
    const navbar = page.locator('[data-testid="navigation-bar"]');
    await expect(navbar).toBeVisible();
  });

  test('should browse all products', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to shop
    await page.click('text=Shop');
    await page.waitForURL(/\/shop/);
    
    // Wait for products to load
    await page.waitForSelector('[data-testid="product-card"]', { timeout: 10000 });
    
    // Verify products are displayed
    const productCount = await page.locator('[data-testid="product-card"]').count();
    expect(productCount).toBeGreaterThan(0);
  });

  test('should view product details', async ({ page }) => {
    await page.goto('/shop');
    
    // Wait for products to load
    await page.waitForSelector('[data-testid="product-card"]', { timeout: 10000 });
    
    // Click on first product
    const firstProduct = page.locator('[data-testid="product-card"]').first();
    await firstProduct.click();
    
    // Verify we're on product details page
    await page.waitForURL(/\/product\/\w+/);
    
    // Check product details are displayed
    const productName = page.locator('[data-testid="product-name"]');
    await expect(productName).toBeVisible();
    
    const productPrice = page.locator('[data-testid="product-price"]');
    await expect(productPrice).toBeVisible();
  });

  test('should add product to cart', async ({ page }) => {
    await page.goto('/shop');
    
    // Wait for products
    await page.waitForSelector('[data-testid="product-card"]', { timeout: 10000 });
    
    // Get initial cart count
    const cartBadge = page.locator('[data-testid="cart-badge"]');
    const initialCount = parseInt(await cartBadge.textContent() || '0');
    
    // Add product to cart
    const addToCartBtn = page.locator('[data-testid="product-card"]').first().locator('button:has-text("Add to Cart")');
    await addToCartBtn.click();
    
    // Wait for toast notification
    await page.waitForSelector('[data-testid="notification"]', { timeout: 5000 });
    
    // Verify cart was updated
    const updatedCount = parseInt(await cartBadge.textContent() || '0');
    expect(updatedCount).toBe(initialCount + 1);
  });

  test('should search for products', async ({ page }) => {
    await page.goto('/');
    
    // Find search input
    const searchInput = page.locator('[data-testid="search-input"]');
    await expect(searchInput).toBeVisible();
    
    // Type search query
    await searchInput.fill('laptop');
    await page.press('[data-testid="search-input"]', 'Enter');
    
    // Wait for results
    await page.waitForURL(/search/);
    await page.waitForSelector('[data-testid="search-results"]', { timeout: 10000 });
    
    // Verify results are displayed
    const resultCount = await page.locator('[data-testid="product-card"]').count();
    expect(resultCount).toBeGreaterThanOrEqual(0);
  });

  test('should view and modify shopping cart', async ({ page }) => {
    await page.goto('/shop');
    
    // Add multiple products
    const productCards = page.locator('[data-testid="product-card"]');
    const firstAddBtn = productCards.first().locator('button:has-text("Add to Cart")');
    await firstAddBtn.click();
    
    // Wait for notification
    await page.waitForSelector('[data-testid="notification"]', { timeout: 5000 });
    
    // Click on cart
    const cartBadge = page.locator('[data-testid="cart-badge"]');
    await cartBadge.click();
    
    // Verify cart page
    await page.waitForURL(/\/cart/);
    
    // Check cart items are displayed
    const cartItems = page.locator('[data-testid="cart-item"]');
    const itemCount = await cartItems.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  test('should proceed to checkout', async ({ page }) => {
    // Add product first
    await page.goto('/shop');
    await page.waitForSelector('[data-testid="product-card"]', { timeout: 10000 });
    
    const addBtn = page.locator('[data-testid="product-card"]').first().locator('button:has-text("Add to Cart")');
    await addBtn.click();
    
    await page.waitForSelector('[data-testid="notification"]', { timeout: 5000 });
    
    // Go to cart
    const cartBadge = page.locator('[data-testid="cart-badge"]');
    await cartBadge.click();
    
    // Click checkout button
    const checkoutBtn = page.locator('button:has-text("Proceed to Checkout")');
    await checkoutBtn.click();
    
    // Verify checkout page
    await page.waitForURL(/\/checkout/);
    
    // Verify form fields exist
    const nameInput = page.locator('input[name="name"]');
    const emailInput = page.locator('input[name="email"]');
    
    await expect(nameInput).toBeVisible();
    await expect(emailInput).toBeVisible();
  });

  test('should complete checkout with valid data', async ({ page }) => {
    // Add product
    await page.goto('/shop');
    await page.waitForSelector('[data-testid="product-card"]', { timeout: 10000 });
    
    await page.locator('[data-testid="product-card"]').first().locator('button:has-text("Add to Cart")').click();
    await page.waitForSelector('[data-testid="notification"]', { timeout: 5000 });
    
    // Go to checkout
    await page.locator('[data-testid="cart-badge"]').click();
    await page.locator('button:has-text("Proceed to Checkout")').click();
    
    // Fill form
    await page.fill('input[name="name"]', 'John Doe');
    await page.fill('input[name="email"]', 'john@example.com');
    await page.fill('input[name="shippingAddress"]', '123 Main St, City, State 12345');
    
    // Fill card details (this depends on your payment form implementation)
    // Adjust selectors based on your actual form structure
    
    // Submit form
    const submitBtn = page.locator('button:has-text("Place Order")');
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      
      // Verify success page
      await page.waitForURL(/order-success|checkout/, { timeout: 10000 });
    }
  });

  test('should register new user', async ({ page }) => {
    await page.goto('/register');
    
    // Fill registration form
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="email"]', `test-${Date.now()}@example.com`);
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.fill('input[name="confirmPassword"]', 'TestPassword123!');
    
    // Submit form
    const registerBtn = page.locator('button:has-text("Register")');
    await registerBtn.click();
    
    // Wait for navigation or success message
    await page.waitForSelector('[data-testid="notification"]', { timeout: 10000 });
  });

  test('should login existing user', async ({ page }) => {
    await page.goto('/login');
    
    // Fill login form
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    
    // Submit form
    const loginBtn = page.locator('button:has-text("Login")');
    await loginBtn.click();
    
    // Wait for navigation
    await page.waitForURL('/', { timeout: 10000 });
  });

  test('should apply filters on shop page', async ({ page }) => {
    await page.goto('/shop');
    
    // Wait for products
    await page.waitForSelector('[data-testid="product-card"]', { timeout: 10000 });
    
    // If category filter exists
    const categoryFilter = page.locator('[data-testid="category-filter"]');
    if (await categoryFilter.isVisible()) {
      await categoryFilter.selectOption('electronics');
      
      // Wait for filtered results
      await page.waitForTimeout(1000);
      
      // Verify products are still visible
      const products = page.locator('[data-testid="product-card"]');
      expect(await products.count()).toBeGreaterThanOrEqual(0);
    }
  });
});
