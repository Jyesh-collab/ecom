# 📊 AI-Powered Smart Testing - Comprehensive Reporting

This document explains the enhanced reporting system for the AI-powered smart testing pipeline.

## Overview

The workflow now includes **8 comprehensive jobs**:

1. 🤖 **AI Analyzes Changes** - Determines impact score & tests to run
2. 🧪 **Frontend Tests** - React testing with HTML report
3. ⚙️ **Backend Tests** - Node.js testing with HTML report  
4. 🎭 **E2E Tests** - Playwright testing with screenshots & videos on failures
5. 🤖 **AI Analyzes Failures** - Root cause detection & JIRA issue creation
6. ✅ **Mark PR** - Posts summary to PR
7. 📊 **Generate HTML Report** - Creates comprehensive dashboard
8. 📧 **Send Email** - Notifies PR author with report link

---

## 🎯 Features

### ✅ Jest HTML Reports
- Beautiful, interactive test reports
- Test details with stack traces
- Code coverage metrics
- Inline source code for failing tests

**Locations:**
- Frontend: `test-report-frontend/index.html`
- Backend: `test-report-backend/index.html`

### 📸 Playwright Screenshots & Videos
- Automatic screenshots on test failures
- Full test session videos
- Uploaded to GitHub artifacts
- Attached to JIRA issues (E2E failures only)

**Locations:**
- Screenshots: `.playwright/test-results/*/*.png`
- Videos: `.playwright/test-results/*/video.webm`

### 📊 HTML Dashboard
- PR Health Score (0-100%)
- Impact Score visualization
- All test results consolidated
- JIRA issue links
- Timestamp & metrics

**Location:** `test-report-html/index.html`

### 📧 Email Notification
- Sent to PR author's email
- Includes health score & pass rate
- Link to detailed HTML report
- Action summary (failures/successes)

---

## 🔧 Configuration

### Frontend Tests (Jest)
File: `jest.config.js`

```javascript
reporters: [
  'default',
  [
    'jest-html-reporters',
    {
      publicPath: './test-report-frontend',
      filename: 'index.html',
    },
  ],
]
```

### Backend Tests (Jest)
File: `backend/jest.config.js`

```javascript
reporters: [
  'default',
  [
    'jest-html-reporters',
    {
      publicPath: '../test-report-backend',
      filename: 'index.html',
    },
  ],
]
```

### Playwright E2E Tests
File: `playwright.config.js` (if using Playwright)

```javascript
use: {
  screenshot: 'only-on-failure', // ✅ Only capture on failures
  video: 'retain-on-failure',     // ✅ Only record on failures
}
```

---

## 📋 Metrics Calculated

### Health Score Formula
```
Health Score = (Pass Rate × 70%) + ((100 - Impact Score) × 30%)
```

**Example:**
- Pass Rate: 90% (90 tests passed out of 100)
- Impact Score: 45/100 (medium risk)
- Health Score: (90 × 0.7) + ((100 - 45) × 0.3) = 63 + 16.5 = **79.5%**

### Color Coding
- 🟢 **Green** (75-100%): Ready to merge
- 🟡 **Yellow** (50-74%): Review before merging
- 🔴 **Red** (0-49%): Requires fixes

---

## 🚀 Usage

### View Reports After PR Tests Complete

1. **GitHub Actions Tab**
   - Go to PR → "Checks" tab
   - Click "🤖 AI Smart Testing"
   - Scroll to "Artifacts" section
   - Download:
     - `test-report-frontend`
     - `test-report-backend`
     - `test-report-html`

2. **Email Notification**
   - PR author receives email with report link
   - Click link to view detailed dashboard

3. **JIRA Issues**
   - Automatically created on failures
   - Includes:
     - Root cause analysis (AI-generated)
     - Severity classification
     - Screenshots/Videos (E2E only)
     - Stack traces

---

## 📁 Artifact Structure

```
artifacts/
├── test-results-frontend.json
│   └── Frontend test results (Jest format)
├── test-results-backend.json
│   └── Backend test results (Jest format)
├── e2e-results.json
│   └── E2E test results (Playwright format)
├── test-report-frontend/
│   ├── index.html           ← Click to view
│   └── assets/              ← CSS, JS, images
├── test-report-backend/
│   ├── index.html           ← Click to view
│   └── assets/
├── test-report-html/
│   └── index.html           ← Main dashboard
├── playwright-report/
│   ├── index.html
│   ├── traces/
│   └── videos/
└── e2e-screenshots/
    └── failure_*.png
```

---

## 🔗 Report Links

### During GitHub Actions Run
```
https://github.com/[owner]/[repo]/actions/runs/[run-id]
```

### In PR Comment
```
### Test Results
- 📊 Report: [View Full Report](#)
- 🐛 JIRA Issues: [PROJ-123](#)
```

### Via Email
```
Click here to view your detailed test report:
[Link to test-report-html/index.html]
```

---

## 🎬 Playwright Configuration for Screenshots/Videos

Add to your `playwright.config.js`:

```javascript
use: {
  // Only capture screenshots on failures
  screenshot: 'only-on-failure',
  
  // Only record videos on failures
  video: 'retain-on-failure',
  
  // Optional: trace for debugging
  trace: 'on-first-retry',
},
```

---

## 🐛 Troubleshooting

### HTML Report Not Generated
```bash
# Check if script ran
node .github/scripts/generate-html-report.js

# Verify test result files exist
ls -la test-results-*.json
```

### Email Not Sent
- Check GitHub Actions logs for errors
- Verify `JIRA_HOST` secret is set (used in email)
- PR author email must be public on GitHub

### Screenshots/Videos Not Uploading to JIRA
- Ensure Playwright is configured with `screenshot: 'only-on-failure'`
- Check JIRA token has attachment permissions
- Verify issue key is set correctly

---

## 📊 Example HTML Report

The generated report includes:

```
┌─────────────────────────────────────┐
│ PR #123 Test Report                 │
│         🟢 79% Health Score         │
├─────────────────────────────────────┤
│ PR: "Add checkout feature"          │
│ Author: john.doe                    │
│ Impact: 52/100 (Medium)             │
├─────────────────────────────────────┤
│ STATISTICS                          │
│ Total Tests: 250                    │
│ ✅ Passed: 225 (90%)                │
│ ❌ Failed: 25 (10%)                 │
├─────────────────────────────────────┤
│ BREAKDOWN                           │
│ Frontend: 80/90 passed              │
│ Backend: 90/100 passed              │
│ E2E: 55/60 passed                   │
├─────────────────────────────────────┤
│ JIRA ISSUES                         │
│ • PROJ-123: Login test timeout      │
│ • PROJ-124: API validation error    │
└─────────────────────────────────────┘
```

---

## 🔄 Continuous Improvement

The reporting system is designed to be extensible. Future enhancements:

- [ ] Performance metrics (test duration, trends)
- [ ] Code coverage visualization
- [ ] Historical trend charts
- [ ] Test reliability scoring
- [ ] AI-powered test failure predictions
- [ ] Slack notifications
- [ ] Custom dashboard themes

---

## 📞 Support

For issues or suggestions:
1. Check GitHub Actions logs
2. Review error messages in workflow output
3. Create an issue in the repository

---

**Last Updated:** 2026-04-19
**Version:** 1.0.0
