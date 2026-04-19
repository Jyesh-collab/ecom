# 🤖 AI Smart Testing Pipeline - Setup Guide

## Quick Start (5 minutes)

This guide helps you set up the complete AI-powered testing pipeline:

```
PR raised → AI reads changes → picks right tests → runs them → files bugs → marks PR
```

---

## ✅ Prerequisites

- [ ] GitHub repository access
- [ ] OpenAI API key (GPT-4 access)
- [ ] JIRA account with API access
- [ ] Node.js 18+ locally

---

## 🚀 Step 1: Get OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy the key (starts with `sk-`)
4. **Keep it safe!** You'll use it in Step 3

**Cost**: ~$9/month for 100 PRs with GPT-4

---

## 🚀 Step 2: Get JIRA API Token

### Generate Token
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Name it: `GitHub Actions`
4. Copy the token
5. **Keep it safe!**

### Get JIRA Details
1. Your JIRA host: `https://your-workspace.atlassian.net`
2. Your project key: Look at any JIRA issue URL: `https://your-workspace.atlassian.net/browse/KEY-123`
   - Example: If URL is `https://acme.atlassian.net/browse/FE-42`, then KEY is `FE`

---

## 🚀 Step 3: Add GitHub Secrets

### Navigate to Secrets
1. Go to your GitHub repository
2. Click **Settings** (top menu)
3. Click **Secrets and variables** → **Actions** (left sidebar)

### Add 4 Secrets

#### Secret 1: OpenAI API Key
- **Name**: `OPENAI_API_KEY`
- **Value**: `sk-xxxxxxxxxxxx`
- Click "Add secret"

#### Secret 2: JIRA Host
- **Name**: `JIRA_HOST`
- **Value**: `https://your-workspace.atlassian.net`
- Click "Add secret"

#### Secret 3: JIRA API Token
- **Name**: `JIRA_API_TOKEN`
- **Value**: (paste the token from Step 2)
- Click "Add secret"

#### Secret 4: JIRA Project Key
- **Name**: `JIRA_PROJECT_KEY`
- **Value**: `FE` (or your project key)
- Click "Add secret"

✅ Now you should see 4 secrets listed on this page

---

## 🚀 Step 4: Install Dependencies

The workflow needs the `openai` and `axios` packages. Add them to your project:

```bash
# Frontend dependencies
npm install openai axios

# Backend dependencies
cd backend && npm install openai axios
```

---

## 🚀 Step 5: Test the Pipeline

### Create a Test PR

1. Create a new branch:
   ```bash
   git checkout -b test/ai-pipeline
   ```

2. Make a small change (e.g., update README):
   ```bash
   echo "# AI Testing" >> README.md
   git add .
   git commit -m "test: add AI testing"
   git push origin test/ai-pipeline
   ```

3. Go to GitHub and create a Pull Request

4. Watch the magic happen! ✨

### Monitor the Workflow

1. Go to your PR
2. Scroll down to "Checks" section
3. Click "🤖 AI Smart Testing"
4. Watch the jobs execute in real-time:
   - 🤖 AI Analyzes Changes
   - 🧪 Frontend Tests
   - 🧪 Backend Tests
   - 🎭 E2E Tests
   - 🤖 AI Analyzes Failures
   - ✅ Mark PR

---

## 📊 What You'll See

### If Tests Pass ✅
```
✅ All Tests Passed

🤖 AI Analysis
- Impact Score: 25/100 🟢 Low Risk
- Tests Selected: frontend
- Tests Skipped: backend, e2e

📊 Test Results
✅ Frontend Tests: 45/45 passed (100%)
⏭️  Backend Tests: Not run
⏭️  E2E Tests: Not run
```

### If Tests Fail ❌
```
❌ Tests Failed

🤖 AI Analysis
- Impact Score: 85/100 🔴 High Risk

📊 Test Results
❌ Frontend Tests: 40/45 passed (88%)

🐛 Failures Detected
JIRA Issue: FE-789
AI has automatically created a JIRA issue with root cause analysis
```

---

## 🔍 How It Works

### Step 1: AI Reads Changes
```
Changed files:
- src/pages/Home.jsx
- src/components/ProductCard.jsx

AI Analysis:
"These files affect the Home page and product display.
Impact score: 65/100 (high - UI-critical)
Run: frontend tests
Skip: backend tests (no API changes)"
```

### Step 2: Smart Test Selection
```
Based on AI analysis:
- Run frontend tests only
- Skip backend tests (saves 5 minutes)
- Skip E2E tests (not affected)
```

### Step 3: Run Selected Tests
```
Frontend tests: 45 tests in 3 minutes ⏱️
✅ All pass
```

### Step 4: AI Analyzes Failures (if any)
```
Test: "Cart should show product count"
Error: "Expected 5, got undefined"

AI Analysis:
Root Cause: Missing state initialization
Category: logic_bug
Severity: high
Priority: P1
Fix Suggestion: Initialize cartItems state in useEffect
```

### Step 5: File JIRA Bug (if needed)
```
JIRA Issue Created: FE-789
Title: [LOGIC_BUG] Home - cart state not initialized
Labels: automated-test, ai-analyzed, pr-456
Priority: High
```

### Step 6: Mark PR
```
The workflow posts a comprehensive comment with:
- Test results summary
- Impact analysis
- JIRA issue link (if applicable)
- Next steps
```

---

## 🎯 Cost Breakdown

| Component | Cost/PR | Monthly (100 PRs) |
|-----------|---------|-------------------|
| AI Change Analysis | $0.002 | $0.20 |
| AI Failure Analysis | $0.005 | $0.50 |
| API Calls | $0.003 | $0.30 |
| **Total** | **$0.01** | **~$1.00** |

✨ **Very affordable!**

---

## ⚠️ Troubleshooting

### "OpenAI API rate limit exceeded"
- **Solution**: Your team made too many API calls
- **Action**: Wait 1 minute or upgrade your OpenAI plan
- **Prevention**: Use `gpt-3.5-turbo` instead of `gpt-4` (cheaper)

### "JIRA authentication failed"
- **Check**:
  1. Is `JIRA_API_TOKEN` correct? (should start with jira_...)
  2. Is `JIRA_HOST` correct? (should end with atlassian.net)
  3. Is `JIRA_PROJECT_KEY` correct? (case-sensitive)
- **Test**: Run this locally:
  ```bash
  curl -H "Authorization: Bearer YOUR_TOKEN" \
    https://your-workspace.atlassian.net/rest/api/3/myself
  ```
  Should return your user info

### "Workflow not running"
- **Check**:
  1. Go to **.github/workflows/**
  2. Is `ai-smart-testing.yml` there?
  3. Go to Actions tab - is the workflow visible?
  4. Is it enabled? (Should show "enabled" status)

### "Tests not running correctly"
- **Check**:
  1. Do your tests run locally? `npm test`
  2. Are they in the right folder?
  3. Are they named correctly? (Must match test patterns)

---

## 📝 Configuration Files Created

```
.github/
├── workflows/
│   └── ai-smart-testing.yml           # Main workflow
└── scripts/
    ├── ai-change-analyzer.js          # Step 1: AI reads changes
    ├── ai-failure-analyzer.js         # Step 5: AI files bugs
    └── pr-comment-builder.js          # Step 6: Mark PR
```

---

## ✨ Next Steps

1. ✅ Follow setup above
2. ✅ Create a test PR
3. ✅ Watch it work!
4. ✅ Tweak AI prompts if needed (in the `.js` files)
5. ✅ Share with your team

---

## 🆘 Need Help?

### Workflow Not Triggering?
- Check: Branch protection rules
- Check: Workflow file location and name
- Check: `on: pull_request` trigger

### AI Analysis Not Working?
- Check: OpenAI API key is valid
- Check: OpenAI account has GPT-4 access
- Check: API quota not exceeded

### JIRA Not Creating Issues?
- Check: JIRA token is valid
- Check: JIRA project key is correct
- Check: User has permission to create issues

### Tests Not Running?
- Run locally first: `npm test`
- Check test file names match patterns
- Check test runner configuration

---

## 🎉 Success Indicators

You've successfully set up the AI pipeline when:

- [ ] Secrets are configured in GitHub
- [ ] Test PR created and workflow ran
- [ ] ✅ or ❌ status appears on PR
- [ ] Test results comment posted to PR
- [ ] (If failed) JIRA issue automatically created
- [ ] AI analysis visible in PR comment

**Congratulations!** 🚀 You now have an AI-powered testing pipeline!

---

## 📚 Learn More

- [Workflow File Guide](./ai-smart-testing.yml)
- [AI Integration Roadmap](./AI_INTEGRATION_ROADMAP.md)
- [OpenAI API Docs](https://platform.openai.com/docs)
- [JIRA API Docs](https://developer.atlassian.com/cloud/jira/rest)
- [GitHub Actions Docs](https://docs.github.com/en/actions)

---

**Last Updated**: 2026-04-19
**Version**: 1.0
