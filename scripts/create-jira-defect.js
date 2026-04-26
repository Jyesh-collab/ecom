#!/usr/bin/env node
/**
 * create-jira-defect.js
 *
 * Creates a Jira bug/defect from Playwright test failure data and prints the
 * new issue key + URL to stdout. Called by the GitHub Actions workflow.
 *
 * Required env vars:
 *   JIRA_HOST          e.g. https://yourorg.atlassian.net  (secret name in GitHub)
 *   JIRA_EMAIL         e.g. you@yourorg.com
 *   JIRA_API_TOKEN     Jira API token (from id.atlassian.com/manage-profile/security/api-tokens)
 *   JIRA_PROJECT_KEY   e.g. QA
 *
 * Optional env vars (injected by workflow):
 *   PR_NUMBER          Pull request number
 *   PR_TITLE           Pull request title
 *   PR_URL             Pull request URL
 *   COMMIT_SHA         Short commit SHA
 *   FAILED_TESTS       Newline-separated list of failed test names
 *   ERROR_DETAILS      Full error output / stack trace
 *   WORKFLOW_RUN_URL   Link to the GitHub Actions run
 */

const https = require('https');
const url = require('url');

const {
  JIRA_HOST,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
  JIRA_PROJECT_KEY,
  PR_NUMBER = 'N/A',
  PR_TITLE = 'N/A',
  PR_URL = '',
  COMMIT_SHA = 'unknown',
  FAILED_TESTS = '',
  ERROR_DETAILS = '',
  WORKFLOW_RUN_URL = '',
} = process.env;

if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
  console.error(
    'Missing required env vars: JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY'
  );
  process.exit(1);
}

const failedList = FAILED_TESTS
  ? FAILED_TESTS.split('\n')
      .filter(Boolean)
      .map(t => `* ${t}`)
      .join('\n')
  : '_No individual test names captured_';

const truncatedError = ERROR_DETAILS.length > 3000
  ? ERROR_DETAILS.slice(0, 3000) + '\n...[truncated, see workflow run for full output]'
  : ERROR_DETAILS;

const summary = `[PR #${PR_NUMBER}] E2E test failure: ${PR_TITLE}`.slice(0, 255);

const description = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Automated Defect — Smart PR Testing Pipeline' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Playwright E2E tests failed during PR validation.', attrs: {} },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'PR Details' }],
    },
    {
      type: 'bulletList',
      content: [
        bullet(`PR: #${PR_NUMBER} — ${PR_TITLE}`),
        bullet(`PR URL: ${PR_URL}`),
        bullet(`Commit: ${COMMIT_SHA}`),
        bullet(`Workflow Run: ${WORKFLOW_RUN_URL}`),
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Failed Tests' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: failedList }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Error Details / Stack Trace' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'text' },
      content: [{ type: 'text', text: truncatedError || 'No error output captured.' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Steps to Reproduce' }],
    },
    {
      type: 'orderedList',
      content: [
        step('Open the PR linked above.'),
        step('Check out the branch locally.'),
        step('Run: npx playwright test <failing-spec> --headed'),
        step('Observe the failure described in the error details above.'),
      ],
    },
  ],
};

function bullet(text) {
  return {
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function step(text) {
  return {
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

const payload = JSON.stringify({
  fields: {
    project: { key: JIRA_PROJECT_KEY },
    summary,
    description,
    issuetype: { name: 'Bug' },
    priority: { name: 'High' },
    labels: ['automated-defect', 'playwright', 'pr-pipeline'],
  },
});

const parsed = new url.URL(`${JIRA_HOST}/rest/api/3/issue`);
const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

const options = {
  hostname: parsed.hostname,
  path: parsed.pathname,
  method: 'POST',
  headers: {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    if (res.statusCode === 201) {
      const issue = JSON.parse(body);
      const issueUrl = `${JIRA_HOST}/browse/${issue.key}`;
      // Print key and URL on separate lines so the workflow can parse them
      console.log(`JIRA_ISSUE_KEY=${issue.key}`);
      console.log(`JIRA_ISSUE_URL=${issueUrl}`);
    } else {
      console.error(`Jira API returned ${res.statusCode}: ${body}`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('Failed to reach Jira API:', err.message);
  process.exit(1);
});

req.write(payload);
req.end();
