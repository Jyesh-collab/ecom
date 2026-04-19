# JIRA Integration Setup Guide

## Overview

The Smart PR Testing Pipeline now creates automatic JIRA issues when tests fail on pull requests. This guide shows how to set up JIRA integration.

---

## Step 1: Get JIRA API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Name it: `GitHub Actions Testing`
4. Copy the token (you won't see it again!)

---

## Step 2: Set Up GitHub Secrets

Go to your GitHub repository:
1. Settings → Secrets and variables → Actions
2. Click **New repository secret**

Add these three secrets:

### Secret 1: JIRA_HOST
- **Name**: `JIRA_HOST`
- **Value**: Your JIRA instance URL
  - Example: `https://mycompany.atlassian.net`
  - Or: `https://jira.example.com`

### Secret 2: JIRA_API_TOKEN
- **Name**: `JIRA_API_TOKEN`
- **Value**: The token you created in Step 1

### Secret 3: JIRA_PROJECT_KEY
- **Name**: `JIRA_PROJECT_KEY`
- **Value**: Your project key
  - Example: `FE` (for Fusion Electronics)
  - Go to your JIRA project → Project settings → Details → Project key

---

## Step 3: Enable the Workflow

The workflow file is already created at: `.github/workflows/smart-pr-tests-jira.yml`

Push it to your repository:

```bash
git add .github/workflows/smart-pr-tests-jira.yml
git commit -m "feat: add smart PR testing with JIRA integration"
git push origin main
```

---

## Step 4: Test It

1. Create a test PR with code changes
2. GitHub Actions will trigger automatically
3. When tests fail (if you want to test):
   - Edit a test to make it fail
   - Push the change
   - GitHub Actions will:
     - Run all affected tests
     - If any fail → Create JIRA issue automatically
     - Post a comment on your PR

---

## JIRA Issue Fields

When a test fails, a JIRA issue is created with:

| Field | Value |
|-------|-------|
| **Type** | Bug |
| **Priority** | High |
| **Summary** | `PR #123 - Automated Test Failure` |
| **Description** | PR title, author, URL, and test details |
| **Labels** | `automated-test`, `github-actions`, `pr-123` |
| **Project** | Your configured project key |

---

## PR Comment Example

When tests fail, you'll see a comment like:

```
❌ Test Results:
❌ Frontend Tests
❌ E2E Tests (Playwright)

🐛 JIRA Issue Created - A bug has been automatically created in JIRA

Project: FE

📊 [View Test Report](link-to-github-actions)
```

---

## Troubleshooting

### Issue: JIRA issue not created

Check these:
1. Verify all three secrets are set correctly in GitHub
2. Verify JIRA_HOST doesn't have trailing slash
3. Check the GitHub Actions logs for errors
4. Verify your API token is still valid (hasn't expired)

### Issue: "401 Unauthorized"

- API token might be expired or invalid
- Generate a new token at https://id.atlassian.com/manage-profile/security/api-tokens

### Issue: "404 Not Found"

- JIRA_HOST is wrong
- JIRA_PROJECT_KEY is wrong
- Check your JIRA project exists

---

## API Documentation References

- [JIRA REST API v3 - Create Issue](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issues-post)
- [JIRA API Authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
- [Create API Tokens](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)

---

## Advanced: Customize Issue Creation

To modify how JIRA issues are created, edit `.github/workflows/smart-pr-tests-jira.yml`:

Find the "Create JIRA issue" step and modify the JSON payload:

```yaml
- name: Create JIRA issue
  run: |
    curl -X POST ${{ secrets.JIRA_HOST }}/rest/api/3/issues \
      -H "Authorization: Bearer ${{ secrets.JIRA_API_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d '{
        "fields": {
          "project": {"key": "${{ secrets.JIRA_PROJECT_KEY }}"},
          "summary": "PR #${{ github.event.pull_request.number }} - Automated Test Failure",
          "description": { ... },
          "issuetype": {"name": "Bug"},
          "priority": {"name": "High"},
          "labels": ["automated-test", "github-actions"],
          "customfield_12345": "custom value"  # Add custom fields here
        }
      }'
```

---

## Security Note

- Never hardcode API keys in your repository
- Always use GitHub Secrets
- Regularly rotate your JIRA API tokens
- Only give the token "read + write" permissions for the required project

---

## Next Steps

1. ✅ Set up the three secrets in GitHub
2. ✅ Test with a pull request
3. ✅ Configure issue labels in JIRA if needed
4. ✅ Set up notifications in JIRA for assigned issues
5. ✅ Document this process in your team wiki

---

Questions? Check the main guide: `SMART_PR_TESTING_GUIDE.md`
