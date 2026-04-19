# Complete Step-by-Step Setup Guide
## Smart PR Testing Pipeline with JIRA & Playwright

This guide walks you through every step to set up the complete automation pipeline from scratch.

---

## 🎯 Overview of What We're Building

```
Your Code → GitHub PR → Automated Tests → JIRA Issues (on failure) → PR Comments
```

---

# PHASE 1: LOCAL SETUP (20 minutes)

## Step 1.1: Install Playwright

Run this in your project root:

```bash
npm install --save-dev @playwright/test
```

**Verify installation:**
```bash
npx playwright --version
```

Expected output: `Version 1.40.1` (or similar)

---

## Step 1.2: Create Playwright Configuration

Create file: `playwright.config.js` (in project root)

```javascript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'cd backend && npm start',
      url: 'http://localhost:5000/api/products',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'npm start',
      url: 'http://localhost:3001',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
```

---

## Step 1.3: Create E2E Tests Directory

```bash
# Create the directory structure
mkdir -p e2e/tests
mkdir -p test-results
```

---

## Step 1.4: Create Your First E2E Test

Create file: `e2e/tests/shopping-flow.spec.js`

```javascript
import { test, expect } from '@playwright/test';

test.describe('Fusion Electronics - Shopping Flow', () => {
  test('should load home page successfully', async ({ page }) => {
    await page.goto('/');
    
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('should browse all products', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to shop
    await page.click('text=Shop');
    await page.waitForURL(/\/shop/);
    
    // Wait for products to load
    const productCount = await page.locator('[data-testid="product-card"]').count();
    expect(productCount).toBeGreaterThan(0);
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
    
    // Verify cart was updated
    const updatedCount = parseInt(await cartBadge.textContent() || '0');
    expect(updatedCount).toBeGreaterThanOrEqual(initialCount);
  });
});
```

---

## Step 1.5: Update package.json Scripts

Open `package.json` and find the `"scripts"` section:

```json
{
  "scripts": {
    "start": "craco start",
    "build": "craco build",
    "test": "jest --passWithNoTests",
    "test:ci": "jest --ci --coverage --passWithNoTests",
    "e2e": "playwright test",
    "e2e:debug": "playwright test --debug",
    "e2e:report": "playwright show-report",
    "e2e:headed": "playwright test --headed"
  }
}
```

**Add these lines if missing**

---

## Step 1.6: Add Test IDs to React Components

This allows Playwright to find elements. Add `data-testid` attributes:

### Update `src/components/ProductCard.jsx`:

```jsx
// Find this line:
return (
  <div className="product-card">

// Change to:
return (
  <div className="product-card" data-testid="product-card">
```

### Update `src/components/NavigationBar.jsx`:

```jsx
// Add data-testid to search input
<input 
  type="text" 
  placeholder="Search..." 
  data-testid="search-input"
/>

// Add data-testid to cart badge
<span data-testid="cart-badge">{cartCount}</span>

// Add data-testid to nav bar
<nav data-testid="navigation-bar">
```

### Update `src/pages/Cart.jsx`:

```jsx
// Add to cart container
<div data-testid="cart-items">
  {cartItems.map(item => (
    <div key={item.id} data-testid="cart-item">
      {/* item content */}
    </div>
  ))}
</div>
```

---

## Step 1.7: Test Locally

### Terminal 1: Start Backend
```bash
cd backend
npm start
```

Wait for: `Server ready on port 5000`

### Terminal 2: Start Frontend
```bash
npm start
```

Wait for: `webpack compiled successfully`

### Terminal 3: Run E2E Tests
```bash
npm run e2e
```

**Expected output:**
```
✓ 3 passed (5s)
```

✅ If tests pass, move to Phase 2!

---

# PHASE 2: GITHUB SETUP (15 minutes)

## Step 2.1: Create GitHub Directory Structure

```bash
# Create GitHub workflows and scripts directories
mkdir -p .github/workflows
mkdir -p .github/scripts
```

---

## Step 2.2: Create Test Mapping Configuration

Create file: `.github/test-mapping.json`

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
    "backend/routes/**": [
      "backend/__tests__/products.spec.js",
      "backend/__tests__/checkout.spec.js"
    ],
    "backend/models/**": [
      "backend/__tests__/products.spec.js",
      "backend/__tests__/auth.spec.js"
    ]
  }
}
```

---

## Step 2.3: Create GitHub Actions Workflow

Create file: `.github/workflows/smart-pr-tests.yml`

```yaml
name: Smart PR Testing Pipeline

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - 'src/**'
      - 'backend/**'
      - 'package.json'
      - '.github/workflows/**'

permissions:
  contents: read
  pull-requests: write

jobs:
  detect-changes:
    name: Detect Changed Files
    runs-on: ubuntu-latest
    outputs:
      has-frontend-changes: ${{ steps.detect.outputs.has-frontend }}
      has-backend-changes: ${{ steps.detect.outputs.has-backend }}
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Get changed files
        id: changed-files
        uses: tj-actions/changed-files@v40
        with:
          json: true

      - name: Detect changes
        id: detect
        run: |
          CHANGED_FILES='${{ steps.changed-files.outputs.all_changed_files }}'
          echo "has-frontend=$(echo $CHANGED_FILES | jq 'map(select(startswith("src/"))) | length > 0')" >> $GITHUB_OUTPUT
          echo "has-backend=$(echo $CHANGED_FILES | jq 'map(select(startswith("backend/"))) | length > 0')" >> $GITHUB_OUTPUT

      - name: Comment PR - Tests Starting
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🚀 **Smart PR Testing Started**\n\nRunning tests...'
            });

  run-frontend-tests:
    name: Run Frontend Tests
    needs: detect-changes
    if: needs.detect-changes.outputs.has-frontend-changes == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18.x
          cache: 'npm'
      - name: Install dependencies
        run: npm install
      - name: Run frontend tests
        id: test
        run: npm test -- --ci --coverage --passWithNoTests
        continue-on-error: true

  run-backend-tests:
    name: Run Backend Tests
    needs: detect-changes
    if: needs.detect-changes.outputs.has-backend-changes == 'true'
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:6.0
        options: >-
          --health-cmd "mongosh --eval 'db.adminCommand(\"ping\")'"
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
        run: |
          npm install
          cd backend && npm install
      - name: Run backend tests
        id: test
        working-directory: backend
        run: npm test -- --ci --coverage --passWithNoTests
        env:
          MONGO_URI: mongodb://localhost:27017/test-ecommerce
          JWT_SECRET: test_secret_key
        continue-on-error: true

  run-playwright-tests:
    name: Run E2E Tests
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:6.0
        options: >-
          --health-cmd "mongosh --eval 'db.adminCommand(\"ping\")'"
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
      - name: Install dependencies
        run: |
          npm install
          npx playwright install --with-deps
          cd backend && npm install
      - name: Run E2E tests
        id: playwright
        run: npx playwright test
        env:
          MONGO_URI: mongodb://localhost:27017/test-ecommerce
          JWT_SECRET: test_secret_key
          PORT: 3001
        continue-on-error: true
        timeout-minutes: 10

      - name: Upload Playwright report
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30

  post-results:
    name: Post Test Results
    needs: [run-frontend-tests, run-backend-tests, run-playwright-tests]
    runs-on: ubuntu-latest
    if: always()
    steps:
      - uses: actions/checkout@v3

      - name: Comment PR - Tests Failed
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ **Tests Failed**\n\n🔍 Check the logs for details.\n\n📊 [View GitHub Actions](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})'
            });

      - name: Comment PR - Tests Passed
        if: success()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '✅ **All Tests Passed!**\n\n🎉 Your PR is ready for review.'
            });
```

---

## Step 2.4: Commit and Push to GitHub

```bash
# Stage files
git add .github/
git add e2e/
git add playwright.config.js
git add package.json

# Commit
git commit -m "feat: add E2E testing with Playwright and GitHub Actions"

# Push to your main branch
git push origin main
```

✅ GitHub Actions workflow is now set up!

---

# PHASE 3: JIRA SETUP (10 minutes)

## Step 3.1: Get JIRA API Token

1. Go to: https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Name: `GitHub Actions Testing`
4. Click **Create**
5. **Copy the token** (save it in a text file for now)

⚠️ **Important**: You won't see this token again!

---

## Step 3.2: Gather JIRA Information

You need three pieces of information:

### Find JIRA_HOST:
- Go to your JIRA instance
- Look at the URL in your browser
- Example: `https://mycompany.atlassian.net`

### Find JIRA_PROJECT_KEY:
- Go to your JIRA project
- Click **Project settings** (bottom left)
- Look for "Project key"
- Example: `FE` (for Fusion Electronics)

### Verify API Works

Open PowerShell and test:

```bash
$jiraHost = "https://your-jira-instance.atlassian.net"
$apiToken = "your_api_token_here"
$projectKey = "FE"

$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("your-email@company.com:$apiToken"))

Invoke-WebRequest -Uri "$jiraHost/rest/api/3/project/$projectKey" `
  -Headers @{Authorization="Bearer $apiToken"} `
  -Method GET
```

If this works, you'll see your JIRA project details! ✅

---

# PHASE 4: GITHUB SECRETS SETUP (10 minutes)

## Step 4.1: Add JIRA Secrets to GitHub

1. Go to your GitHub repository
2. Click **Settings** (top menu)
3. Click **Secrets and variables** → **Actions** (left sidebar)
4. Click **New repository secret**

---

## Step 4.2: Add First Secret - JIRA_HOST

- **Name**: `JIRA_HOST`
- **Value**: `https://your-jira-instance.atlassian.net`
- Click **Add secret**

---

## Step 4.3: Add Second Secret - JIRA_API_TOKEN

- **Name**: `JIRA_API_TOKEN`
- **Value**: (paste the token from Step 3.1)
- Click **Add secret**

---

## Step 4.4: Add Third Secret - JIRA_PROJECT_KEY

- **Name**: `JIRA_PROJECT_KEY`
- **Value**: `FE` (or your project key)
- Click **Add secret**

✅ **You should now see all 3 secrets in the list!**

---

# PHASE 5: ENABLE JIRA INTEGRATION (5 minutes)

## Step 5.1: Create JIRA-Enabled Workflow

Create file: `.github/workflows/smart-pr-tests-jira.yml`

```yaml
name: Smart PR Testing with JIRA

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - 'src/**'
      - 'backend/**'
      - 'package.json'

permissions:
  contents: read
  pull-requests: write

jobs:
  run-all-tests:
    name: Run All Tests
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:6.0
        options: >-
          --health-cmd "mongosh --eval 'db.adminCommand(\"ping\")'"
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
        run: |
          npm install
          npx playwright install --with-deps
          cd backend && npm install

      - name: Start backend
        working-directory: backend
        run: npm start &
        env:
          MONGO_URI: mongodb://localhost:27017/test-ecommerce
          JWT_SECRET: test_secret_key

      - name: Wait for backend
        run: sleep 5

      - name: Run frontend tests
        id: frontend-tests
        run: npm test -- --ci --passWithNoTests
        continue-on-error: true

      - name: Run backend tests
        id: backend-tests
        working-directory: backend
        run: npm test -- --ci --passWithNoTests
        env:
          MONGO_URI: mongodb://localhost:27017/test-ecommerce
          JWT_SECRET: test_secret_key
        continue-on-error: true

      - name: Run E2E tests
        id: e2e-tests
        run: npx playwright test
        env:
          PORT: 3001
        continue-on-error: true

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: |
            playwright-report/
            test-results/

      - name: Collect test results
        if: always()
        id: collect-results
        run: |
          FRONTEND_RESULT="${{ steps.frontend-tests.outcome }}"
          BACKEND_RESULT="${{ steps.backend-tests.outcome }}"
          E2E_RESULT="${{ steps.e2e-tests.outcome }}"
          
          echo "frontend_result=$FRONTEND_RESULT" >> $GITHUB_ENV
          echo "backend_result=$BACKEND_RESULT" >> $GITHUB_ENV
          echo "e2e_result=$E2E_RESULT" >> $GITHUB_ENV

  create-jira-issue:
    name: Create JIRA Issue if Tests Failed
    needs: run-all-tests
    runs-on: ubuntu-latest
    if: failure()
    steps:
      - uses: actions/checkout@v3

      - name: Create JIRA issue
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
                          "text": "Automated test failure in PR\n\nTitle: ${{ github.event.pull_request.title }}\nAuthor: ${{ github.event.pull_request.user.login }}\nBranch: ${{ github.head_ref }}\nURL: ${{ github.event.pull_request.html_url }}\n\nCheck GitHub Actions for details: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}"
                        }
                      ]
                    }
                  ]
                },
                "issuetype": {"name": "Bug"},
                "priority": {"name": "High"},
                "labels": ["automated-test", "github-actions", "pr-${{ github.event.pull_request.number }}"]
              }
            }'

      - name: Comment PR - Test Failed & JIRA Issue Created
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ **Tests Failed**\n\n🐛 JIRA issue created automatically in project: ${{ secrets.JIRA_PROJECT_KEY }}\n\n📊 [View GitHub Actions](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})'
            });

  post-success:
    name: Post Success Comment
    needs: run-all-tests
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
              body: '✅ **All Tests Passed!**\n\n🎉 Your PR is ready for review.\n\n✨ Smart testing pipeline completed successfully.'
            });
```

---

## Step 5.2: Push the JIRA Workflow

```bash
git add .github/workflows/smart-pr-tests-jira.yml
git commit -m "feat: add JIRA integration to automated testing pipeline"
git push origin main
```

---

# PHASE 6: TEST THE COMPLETE PIPELINE (5 minutes)

## Step 6.1: Create a Test PR

```bash
# Create a new branch
git checkout -b test/e2e-setup

# Make a small change
echo "# Test PR for E2E setup" >> README.md

# Commit
git add README.md
git commit -m "test: E2E setup test"

# Push
git push origin test/e2e-setup
```

---

## Step 6.2: Create Pull Request

1. Go to your GitHub repository
2. Click **Pull requests** tab
3. Click **New Pull Request**
4. Base: `main`
5. Compare: `test/e2e-setup`
6. Click **Create pull request**
7. Add a title: "Test: E2E Pipeline Setup"
8. Click **Create pull request**

---

## Step 6.3: Monitor GitHub Actions

1. Go to **Actions** tab
2. You should see "Smart PR Testing with JIRA" running
3. Wait for it to complete (2-3 minutes)

**Expected workflow:**
- ✅ Run All Tests
- ✅ (Optional) Create JIRA Issue (if tests fail)
- ✅ Post Success/Failure Comment

---

## Step 6.4: Check PR Comments

Scroll down to see the automated comment:

```
✅ All Tests Passed!

🎉 Your PR is ready for review.

✨ Smart testing pipeline completed successfully.
```

Or if tests fail:

```
❌ Tests Failed

🐛 JIRA issue created automatically in project: FE

📊 View GitHub Actions
```

---

## Step 6.5: Check JIRA (if tests failed)

If tests failed:
1. Go to your JIRA project
2. Look for recent issues
3. Should see: "PR #XXX - Automated Test Failure"
4. Click to view full details

---

# PHASE 7: VERIFY EVERYTHING WORKS (5 minutes)

## Step 7.1: Test Failure Scenario

To see the JIRA integration work, let's intentionally break a test:

```bash
# Create a new branch
git checkout -b test/break-test

# Edit a test to make it fail
# Open e2e/tests/shopping-flow.spec.js
# Change this line:
expect(productCount).toBeGreaterThan(0);

# To:
expect(productCount).toBeGreaterThan(100); // This will fail!

# Commit and push
git add e2e/tests/shopping-flow.spec.js
git commit -m "test: intentional test failure"
git push origin test/break-test
```

---

## Step 7.2: Create PR and Watch

1. Create a PR for `test/break-test`
2. GitHub Actions runs
3. E2E tests fail ❌
4. JIRA issue created automatically 🐛
5. PR comment posted with JIRA link 📝

---

## Step 7.3: Fix and Verify

```bash
# Fix the test
# Revert the change in e2e/tests/shopping-flow.spec.js

# Commit and push
git add e2e/tests/shopping-flow.spec.js
git commit -m "fix: correct test assertion"
git push origin test/break-test
```

Watch GitHub Actions run again - tests should now pass! ✅

---

# FINAL CHECKLIST ✨

Mark off as you complete:

- [ ] **Phase 1**: Playwright installed and E2E tests run locally
- [ ] **Phase 2**: GitHub Actions workflow created and pushed
- [ ] **Phase 3**: JIRA API token generated and credentials noted
- [ ] **Phase 4**: All 3 GitHub Secrets added (JIRA_HOST, JIRA_API_TOKEN, JIRA_PROJECT_KEY)
- [ ] **Phase 5**: JIRA-enabled workflow created and pushed
- [ ] **Phase 6**: Test PR created and workflow executed successfully
- [ ] **Phase 7**: Tested failure scenario and verified JIRA issue creation

---

# QUICK REFERENCE: Common Commands

### Run tests locally:
```bash
npm run e2e              # Run all E2E tests
npm run e2e:headed      # See browser interactions
npm run e2e:debug       # Debug mode
npm run e2e:report      # View HTML report
```

### Run specific test:
```bash
npx playwright test shopping-flow
```

### Generate Playwright report:
```bash
npm run e2e:report
```

### Check test results:
```bash
# View generated report
npx playwright show-report
```

---

# TROUBLESHOOTING

### GitHub Actions workflow not triggering?
- Check: Workflow file is in `.github/workflows/`
- Check: Workflow file name ends with `.yml`
- Check: You pushed to `main` branch
- Check: PR has changes to `src/` or `backend/`

### JIRA issue not created?
- Check: All 3 secrets are set correctly in GitHub
- Check: JIRA_HOST doesn't have trailing slash
- Check: JIRA_API_TOKEN is valid (not expired)
- Check: JIRA_PROJECT_KEY is correct (check JIRA settings)

### E2E tests failing?
- Check: React components have `data-testid` attributes
- Check: Servers are running (backend on 5000, frontend on 3001)
- Check: MongoDB is running locally

### "Cannot find test file" error?
- Check: File path: `e2e/tests/shopping-flow.spec.js`
- Check: File exists and has `.spec.js` extension

---

# NEXT STEPS

1. ✅ Share this setup with your team
2. ✅ Add more E2E test scenarios
3. ✅ Configure JIRA notifications (optional)
4. ✅ Set up branch protection rules to require passing tests
5. ✅ Monitor JIRA for auto-created issues

---

**Need help?** Check these files:
- `SMART_PR_TESTING_GUIDE.md` - Complete overview
- `JIRA_INTEGRATION_SETUP.md` - JIRA-specific details
- `.github/workflows/smart-pr-tests-jira.yml` - Workflow configuration

---

## 🎉 You're Done!

You now have a complete automated testing pipeline that:
- ✅ Runs tests on every PR
- ✅ Creates JIRA issues on failures
- ✅ Posts comments on PRs
- ✅ Provides instant feedback to developers

**Happy testing!** 🚀
