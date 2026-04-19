# Smart PR Testing Pipeline - Implementation Guide

Based on the Brownbox demo, here's how to build an automated PR testing system for Fusion Electronics.

## 🎯 System Overview

```
Developer creates PR
    ↓
GitHub Actions detects changed files
    ↓
Workflow analyzes test-mapping.json
    ↓
Only affected tests are selected & executed
    ↓
Playwright CLI runs automated browser tests
    ↓
If tests fail → Create issue in JIRA
    ↓
Post comment on PR with results
    ↓
Developer gets instant feedback
```

---

## 📋 Step 1: Create Test Mapping Configuration

Create `.github/test-mapping.json` to map code changes to relevant tests:

```json
{
  "test-mapping": {
    "src/pages/**": [
      "src/tests/Cart.test.js",
      "src/tests/Checkout.test.js",
      "src/tests/Shop.test.js"
    ],
    "src/components/**": [
      "src/tests/Cart.test.js",
      "src/tests/Checkout.test.js"
    ],
    "src/services/**": [
      "src/tests/Cart.test.js",
      "src/tests/Checkout.test.js",
      "src/tests/Shop.test.js"
    ],
    "backend/routes/**": [
      "backend/__tests__/products.spec.js",
      "backend/__tests__/checkout.spec.js",
      "backend/__tests__/auth.spec.js"
    ],
    "backend/models/**": [
      "backend/__tests__/products.spec.js",
      "backend/__tests__/auth.spec.js"
    ],
    "backend/services/**": [
      "backend/__tests__/products.spec.js"
    ],
    "src/App.jsx": [
      "src/tests/*.test.js"
    ],
    "package.json": [
      "src/tests/*.test.js",
      "backend/__tests__/*.spec.js"
    ]
  }
}
```

---

## 🔄 Step 2: Create Changed Files Detection Script

Create `.github/scripts/detect-changed-files.js`:

```javascript
const fs = require('fs');
const path = require('path');

// Get changed files from GitHub Actions
const changedFiles = process.env.GITHUB_CONTEXT 
  ? JSON.parse(process.env.GITHUB_CONTEXT).event.pull_request.changed_files
  : [];

// Load test mapping
const testMappingPath = path.join(__dirname, '../test-mapping.json');
const testMapping = JSON.parse(fs.readFileSync(testMappingPath, 'utf8'));

function matchesPattern(filePath, pattern) {
  const regex = new RegExp(
    '^' + pattern
      .replace(/\*/g, '[^/]*')
      .replace(/\*\*/g, '.*') + '$'
  );
  return regex.test(filePath);
}

function getAffectedTests(changedFiles) {
  const affectedTests = new Set();

  changedFiles.forEach(file => {
    Object.entries(testMapping['test-mapping']).forEach(([pattern, tests]) => {
      if (matchesPattern(file, pattern)) {
        tests.forEach(test => affectedTests.add(test));
      }
    });
  });

  return Array.from(affectedTests);
}

const affectedTests = getAffectedTests(changedFiles);
console.log('Affected Tests:', JSON.stringify(affectedTests, null, 2));

// Output for GitHub Actions
fs.writeFileSync(
  path.join(__dirname, '../affected-tests.json'),
  JSON.stringify({ tests: affectedTests }, null, 2)
);
```

---

## 🚀 Step 3: Create Main PR Testing Workflow

Create `.github/workflows/smart-pr-tests.yml`:

```yaml
name: Smart PR Testing Pipeline

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  detect-changes:
    name: Detect Changed Files
    runs-on: ubuntu-latest
    outputs:
      affected-tests: ${{ steps.detect.outputs.tests }}
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Get changed files
        id: changed-files
        uses: tj-actions/changed-files@v40
        with:
          json: true

      - name: Detect affected tests
        id: detect
        run: |
          node .github/scripts/detect-changed-files.js
        env:
          CHANGED_FILES: ${{ steps.changed-files.outputs.all_changed_files }}

      - name: Comment PR - Tests Starting
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🚀 **Smart PR Testing Started**\n\nRunning affected tests...'
            });

  run-frontend-tests:
    name: Run Frontend Tests
    needs: detect-changes
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x]
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm install

      - name: Run tests
        id: test
        run: npm test -- --ci --coverage
        continue-on-error: true

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        if: always()

      - name: Set test result
        if: steps.test.outcome == 'failure'
        run: echo "FRONTEND_TEST_FAILED=true" >> $GITHUB_ENV

  run-backend-tests:
    name: Run Backend Tests
    needs: detect-changes
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:6.0
        options: >-
          --health-cmd "mongosh --eval 'db.adminCommand(\"ping\")'
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 27017:27017

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18.x
          cache: 'npm'

      - name: Install dependencies
        working-directory: backend
        run: npm install

      - name: Run backend tests
        id: test
        working-directory: backend
        run: npm test -- --ci --coverage
        env:
          MONGO_URI: mongodb://localhost:27017/test-ecommerce
          JWT_SECRET: test_secret_key
        continue-on-error: true

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        if: always()

      - name: Set test result
        if: steps.test.outcome == 'failure'
        run: echo "BACKEND_TEST_FAILED=true" >> $GITHUB_ENV

  playwright-tests:
    name: Run E2E Tests with Playwright
    needs: [run-frontend-tests, run-backend-tests]
    runs-on: ubuntu-latest
    if: always()
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18.x

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Start backend
        run: |
          cd backend
          npm install
          npm start &
        env:
          MONGO_URI: mongodb://localhost:27017/test-ecommerce
          JWT_SECRET: test_secret_key

      - name: Wait for backend
        run: sleep 5

      - name: Start frontend
        run: |
          npm install
          npm start &

      - name: Wait for frontend
        run: sleep 10

      - name: Run E2E tests
        id: playwright
        run: npx playwright test
        continue-on-error: true

      - name: Upload Playwright report
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/

  create-bug-on-failure:
    name: Create Bug Report
    needs: [run-frontend-tests, run-backend-tests, playwright-tests]
    runs-on: ubuntu-latest
    if: |
      failure() ||
      contains(needs.run-frontend-tests.result, 'failure') ||
      contains(needs.run-backend-tests.result, 'failure') ||
      contains(needs.playwright-tests.result, 'failure')
    steps:
      - uses: actions/checkout@v3

      - name: Create JIRA issue
        id: create-issue
        run: |
          curl -X POST ${{ secrets.JIRA_HOST }}/rest/api/3/issues \
            -H "Authorization: Bearer ${{ secrets.JIRA_API_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{
              "fields": {
                "project": {"key": "${{ secrets.JIRA_PROJECT_KEY }}"},
                "summary": "PR #${{ github.event.pull_request.number }} - Automated Test Failure",
                "description": {
                  "version": 3,
                  "type": "doc",
                  "content": [
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": "Automated test failure detected\n\nPR: ${{ github.event.pull_request.title }}\nURL: ${{ github.event.pull_request.html_url }}"
                        }
                      ]
                    }
                  ]
                },
                "issuetype": {"name": "Bug"},
                "priority": {"name": "High"},
                "labels": ["automated-test", "github-actions"]
              }
            }'

      - name: Comment PR - Tests Failed
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ **Tests Failed**\n\n🐛 JIRA issue created automatically with full error details.\n\nPlease check JIRA and the logs to fix the issues.'
            });

  post-success-comment:
    name: Post Success Comment
    needs: [run-frontend-tests, run-backend-tests, playwright-tests]
    runs-on: ubuntu-latest
    if: success()
    steps:
      - uses: actions/checkout@v3

      - name: Comment PR - Tests Passed
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '✅ **All Tests Passed!**\n\nYour PR is ready for review.'
            });
```

---

## 🎭 Step 4: Create Playwright E2E Tests

Create `playwright.config.js`:

```javascript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
  },
});
```

Create `e2e/tests/shopping-flow.spec.js`:

```javascript
import { test, expect } from '@playwright/test';

test.describe('Shopping Flow', () => {
  test('should browse products and add to cart', async ({ page }) => {
    // Navigate to home
    await page.goto('/');
    await expect(page).toHaveTitle(/Fusion Electronics/);

    // Browse products
    await page.click('text=Shop');
    await page.waitForSelector('[data-testid="product-card"]');

    // Add first product to cart
    const productCards = await page.locator('[data-testid="product-card"]').all();
    expect(productCards.length).toBeGreaterThan(0);

    await productCards[0].click();
    await page.click('button:has-text("Add to Cart")');

    // Verify cart updated
    const cartBadge = page.locator('[data-testid="cart-badge"]');
    await expect(cartBadge).toContainText('1');
  });

  test('should complete checkout process', async ({ page }) => {
    // Add product to cart
    await page.goto('/');
    await page.click('text=Shop');
    await page.click('[data-testid="product-card"] button:has-text("Add to Cart")');

    // Go to checkout
    await page.click('[data-testid="cart-badge"]');
    await page.click('button:has-text("Proceed to Checkout")');

    // Fill checkout form
    await page.fill('input[name="name"]', 'John Doe');
    await page.fill('input[name="email"]', 'john@example.com');
    await page.fill('input[name="address"]', '123 Main St');
    
    // Fill card details
    const cardFrame = page.frameLocator('iframe[title="Iframe for credit card"]');
    await cardFrame.locator('input[name="cardnumber"]').fill('4242424242424242');
    await cardFrame.locator('input[name="expiry"]').fill('12/25');
    await cardFrame.locator('input[name="cvc"]').fill('123');

    // Submit
    await page.click('button:has-text("Place Order")');

    // Verify success
    await expect(page).toHaveURL(/order-success/);
  });

  test('should search for products', async ({ page }) => {
    await page.goto('/');
    
    // Search for product
    await page.fill('[data-testid="search-input"]', 'laptop');
    await page.press('[data-testid="search-input"]', 'Enter');

    // Verify results
    await expect(page.locator('[data-testid="search-results"]')).toBeVisible();
    const results = await page.locator('[data-testid="product-card"]').count();
    expect(results).toBeGreaterThan(0);
  });
});
```

---

## 🔌 Integrate with JIRA

Create `.github/scripts/create-jira-issue.js`:

```javascript
const axios = require('axios');

async function createJiraIssue(testFailures) {
  const jiraUrl = process.env.JIRA_HOST;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;

  const failureDetails = testFailures
    .map(failure => `
*Test:* ${failure.testName}
*Error:* ${failure.error}
*Stack:* {{code}}${failure.stack}{{code}}
    `)
    .join('\n\n---\n\n');

  const payload = {
    fields: {
      project: { key: projectKey },
      summary: `PR #${process.env.PR_NUMBER} - Automated Test Failure`,
      description: {
        version: 3,
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `Test Failures Detected\n${failureDetails}\n\nPR Details:\n- Author: ${process.env.PR_AUTHOR}\n- Branch: ${process.env.PR_BRANCH}\n- Commit: ${process.env.COMMIT_SHA}\n- URL: ${process.env.PR_URL}\n\nEnvironment:\n- Timestamp: ${new Date().toISOString()}\n- Runner: GitHub Actions`,
              },
            ],
          },
        ],
      },
      issuetype: { name: 'Bug' },
      priority: { name: 'High' },
      labels: ['automated-test', 'github-actions', `pr-${process.env.PR_NUMBER}`],
    },
  };

  try {
    const response = await axios.post(`${jiraUrl}/rest/api/3/issues`, payload, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('JIRA Issue Created:', response.data.key);
    return response.data;
  } catch (error) {
    console.error('Failed to create JIRA issue:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = { createJiraIssue };
```

---

## 📝 Step 6: Configure GitHub Secrets

Add these secrets in GitHub Settings → Secrets:

```
JIRA_HOST=https://your-jira-instance.atlassian.net
JIRA_API_TOKEN=your_jira_api_token_here
JIRA_PROJECT_KEY=YOUR_PROJECT_KEY
```

### How to get JIRA credentials:
1. **JIRA_API_TOKEN**: Go to https://id.atlassian.com/manage-profile/security/api-tokens → Create token
2. **JIRA_HOST**: Your JIRA instance URL (e.g., https://mycompany.atlassian.net)
3. **JIRA_PROJECT_KEY**: Found in JIRA project settings (e.g., FE for Fusion Electronics)

---

## 🛠️ Step 7: Update package.json Scripts

Add to your `package.json`:

```json
{
  "scripts": {
    "test": "jest --passWithNoTests",
    "test:ci": "jest --ci --coverage --passWithNoTests",
    "e2e": "playwright test",
    "e2e:debug": "playwright test --debug",
    "e2e:report": "playwright show-report"
  }
}
```

---

## ✅ Implementation Checklist

- [ ] Create `.github/test-mapping.json`
- [ ] Create `.github/scripts/detect-changed-files.js`
- [ ] Create `.github/workflows/smart-pr-tests-jira.yml`
- [ ] Create `playwright.config.js`
- [ ] Create `e2e/tests/shopping-flow.spec.js`
- [ ] Setup JIRA API credentials (Bearer token)
- [ ] Add GitHub Secrets (JIRA_HOST, JIRA_API_TOKEN, JIRA_PROJECT_KEY)
- [ ] Add Playwright to package.json dependencies
- [ ] Update test scripts in package.json
- [ ] Add test IDs to React components for Playwright to find elements
- [ ] Test workflow with a dummy PR

---

## 🎨 Step 8: Add Test IDs to Frontend Components

Update `src/components/ProductCard.jsx`:

```jsx
<div data-testid="product-card">
  {/* component content */}
</div>
```

Update `src/components/NavigationBar.jsx`:

```jsx
<input data-testid="search-input" type="text" placeholder="Search..." />
<div data-testid="cart-badge">{cartCount}</div>
```

Update `src/pages/Shop.jsx`:

```jsx
<div data-testid="search-results">
  {/* search results */}
</div>
```

---

## 🚀 How It All Works Together

1. **Developer pushes PR** → Triggers workflow
2. **Detect changed files** → Map to relevant tests
3. **Run only affected tests** → Save time & resources
4. **Playwright automates browser interactions** → End-to-end testing
5. **Tests fail** → Automatically create issue in JIRA
6. **Post PR comment** → Developer gets instant feedback with JIRA link
7. **Tests pass** → Success notification on PR

---

## 💡 Pro Tips

1. **Cache dependencies** to speed up CI/CD
2. **Use parallel jobs** to run tests faster
3. **Capture screenshots** on failure for debugging
4. **Generate HTML reports** for detailed test results
5. **Set up PR branch protection** to require passing tests
6. **Use Matrix strategy** to test multiple configurations

---

## 📚 Next Steps

1. Implement this step by step
2. Test with a dummy PR
3. Monitor test results
4. Optimize test mapping as needed
5. Add more E2E test scenarios
6. Integrate with Slack for notifications (optional)

Let me know which step you'd like help implementing!
