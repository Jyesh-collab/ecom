#!/usr/bin/env node
/**
 * create-jira-defect.js
 *
 * Uses Claude AI (via OpenRouter) to:
 *  1. Analyze Playwright test failures and generate a structured bug report
 *  2. Search Jira for an existing open bug covering the same failures
 *  3. If duplicate found → add a comment linking the new PR to the existing bug
 *  4. If no duplicate → create a new well-structured Jira bug
 *
 * Required env vars:
 *   JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, OPENROUTER_API_KEY
 *
 * Optional env vars (injected by workflow):
 *   PR_NUMBER, PR_TITLE, PR_URL, COMMIT_SHA
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
  OPENROUTER_API_KEY,
  PR_NUMBER = 'N/A',
  PR_TITLE = 'N/A',
  PR_URL = '',
  COMMIT_SHA = 'unknown',
  FAILED_TESTS = '',
  ERROR_DETAILS = '',
  WORKFLOW_RUN_URL = '',
} = process.env;

if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
  console.error('Missing required env vars: JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY');
  process.exit(1);
}

const failedTests = FAILED_TESTS ? FAILED_TESTS.split('\n').filter(Boolean) : [];
const truncatedError = ERROR_DETAILS.length > 4000
  ? ERROR_DETAILS.slice(0, 4000) + '\n...[truncated]'
  : ERROR_DETAILS;

// ─── Generic HTTPS request helper ────────────────────────────────────────────
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── OpenRouter / Claude helper ───────────────────────────────────────────────
async function callClaude(prompt, maxTokens = 1000) {
  if (!OPENROUTER_API_KEY) return null;

  const body = JSON.stringify({
    model: 'anthropic/claude-3-5-haiku',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
  });

  try {
    const res = await httpsRequest({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    const parsed = JSON.parse(res.body);
    const content = parsed.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  } catch (e) {
    console.warn('Claude call failed:', e.message);
    return null;
  }
}

// ─── Jira API helpers ─────────────────────────────────────────────────────────
function jiraAuth() {
  return `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;
}

function jiraOptions(path, method, contentLength) {
  const parsed = new url.URL(`${JIRA_HOST}${path}`);
  return {
    hostname: parsed.hostname,
    path: parsed.pathname + (parsed.search || ''),
    method,
    headers: {
      Authorization: jiraAuth(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(contentLength ? { 'Content-Length': contentLength } : {}),
    },
  };
}

// Search Jira for open bugs in this project matching keywords
async function searchJiraForExistingBug(keywords) {
  const keywordClause = keywords
    .slice(0, 3)
    .map(k => `summary ~ "${k.replace(/"/g, '')}"`)
    .join(' OR ');

  const jql = `project = "${JIRA_PROJECT_KEY}" AND issuetype = Bug AND status NOT IN (Done, Resolved, Closed) AND (${keywordClause}) ORDER BY created DESC`;
  const encodedJql = encodeURIComponent(jql);
  const path = `/rest/api/3/issue/search?jql=${encodedJql}&maxResults=5&fields=summary,description,status,key`;

  try {
    const res = await httpsRequest(jiraOptions(path, 'GET'), null);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      return data.issues || [];
    }
    return [];
  } catch (e) {
    console.warn('Jira search failed:', e.message);
    return [];
  }
}

// ─── AI: Analyze failures ──────────────────────────────────────────────────────
async function analyzeFailures() {
  const prompt = `You are a senior QA engineer writing a Jira bug report from automated Playwright E2E test failures.

Analyze the following test failure data and produce a structured bug report in JSON format.

## PR Information
- PR Number: #${PR_NUMBER}
- PR Title: ${PR_TITLE}
- PR URL: ${PR_URL}
- Commit: ${COMMIT_SHA}

## Failed Tests
${failedTests.length > 0 ? failedTests.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'No test names captured'}

## Error Details / Stack Traces
${truncatedError || 'No error details captured'}

Return a JSON object with these exact fields:
{
  "summary": "A concise one-line bug summary (max 200 chars)",
  "whatIsBug": "Clear explanation of what the bug is — what changed in the product that caused failures",
  "affectedComponent": "Which part of the application is affected (e.g. Cart Page, Checkout Flow)",
  "severity": "Critical | High | Medium | Low",
  "stepsToReproduce": ["step 1", "step 2", "step 3"],
  "expectedResult": "What the test expected to find",
  "actualResult": "What actually happened",
  "rootCauseHypothesis": "Most likely root cause based on the error messages",
  "affectedTests": ["test name 1", "test name 2"],
  "searchKeywords": ["2-3 short keywords to search for duplicates in Jira, e.g. Proceed to Checkout, Cart, checkout button"]
}

Be specific. Reference actual button names, page names, error messages from the data above.`;

  return callClaude(prompt, 1000);
}

// ─── AI: Deduplication check ──────────────────────────────────────────────────
async function checkIsDuplicate(existingIssues, currentFailures) {
  if (!existingIssues.length) return null;

  const issueList = existingIssues.map(i =>
    `Key: ${i.key}\nSummary: ${i.fields.summary}\nStatus: ${i.fields.status?.name}`
  ).join('\n\n');

  const prompt = `You are a QA engineer checking if a new test failure is already reported in Jira.

## Current Test Failures (new)
${currentFailures.affectedTests?.join('\n') || failedTests.join('\n')}

What is the bug: ${currentFailures.whatIsBug}
Affected component: ${currentFailures.affectedComponent}

## Existing Open Jira Bugs
${issueList}

Decide: is the current failure already covered by one of the existing bugs?

Return JSON:
{
  "isDuplicate": true or false,
  "matchingIssueKey": "QA-123 or null if no match",
  "reason": "Brief explanation of why it is or is not a duplicate"
}

Only return isDuplicate: true if the existing bug clearly covers the SAME root cause and affected component. Different tests failing for different reasons = not duplicate.`;

  return callClaude(prompt, 200);
}

// ─── Jira ADF helpers ─────────────────────────────────────────────────────────
const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const rule = () => ({ type: 'rule' });

function bulletList(items) {
  return {
    type: 'bulletList',
    content: items.map(text => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  };
}

function orderedList(items) {
  return {
    type: 'orderedList',
    content: items.map(text => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  };
}

function codeBlock(text) {
  return {
    type: 'codeBlock',
    attrs: { language: 'text' },
    content: [{ type: 'text', text: text || 'No details captured.' }],
  };
}

// ─── Build Jira ADF description ───────────────────────────────────────────────
function buildDescription(ai) {
  const content = [
    h(2, '🤖 AI-Analyzed Defect — Smart PR Testing Pipeline'),
    p('Automatically detected and analyzed by the QE Pipeline using Claude AI.'),
    p('⚠️ AI-Generated: Root cause hypothesis should be verified by an engineer.'),
    rule(),
    h(3, '🐛 What Is the Bug'),
    p(ai?.whatIsBug || `E2E tests failed during PR #${PR_NUMBER} validation. ${failedTests.length} test(s) failed.`),
  ];

  if (ai?.affectedComponent) {
    content.push(h(3, '📍 Affected Component'));
    content.push(p(ai.affectedComponent));
  }

  content.push(rule());
  content.push(h(3, '🔗 PR Details'));
  content.push(bulletList([
    `PR: #${PR_NUMBER} — ${PR_TITLE}`,
    `PR URL: ${PR_URL}`,
    `Commit SHA: ${COMMIT_SHA}`,
    `Workflow Run: ${WORKFLOW_RUN_URL}`,
  ]));

  content.push(rule());
  content.push(h(3, '🔁 Steps to Reproduce'));
  content.push(orderedList(ai?.stepsToReproduce?.length ? ai.stepsToReproduce : [
    'Open the PR linked above',
    'Check out the branch locally',
    'Run: npx playwright test --headed',
    'Observe the failure in the test output',
  ]));

  content.push(h(3, '✅ Expected Result'));
  content.push(p(ai?.expectedResult || 'All E2E tests should pass with the correct UI elements present.'));

  content.push(h(3, '❌ Actual Result'));
  content.push(p(ai?.actualResult || `${failedTests.length} test(s) failed.`));

  content.push(rule());
  content.push(h(3, '🧪 Failed Tests'));
  const tests = ai?.affectedTests?.length ? ai.affectedTests : failedTests;
  content.push(tests.length ? bulletList(tests) : p('No individual test names captured.'));

  if (ai?.rootCauseHypothesis) {
    content.push(h(3, '🔍 Root Cause Hypothesis (AI-Generated)'));
    content.push(p(ai.rootCauseHypothesis));
  }

  content.push(rule());
  content.push(h(3, '📋 Error Details'));
  content.push(p('Download Playwright artifacts from the workflow run for screenshots, videos, and traces.'));
  if (truncatedError) content.push(codeBlock(truncatedError.slice(0, 2000)));

  return { version: 1, type: 'doc', content };
}

// ─── Build duplicate comment (ADF) ───────────────────────────────────────────
function buildDuplicateComment(duplicateReason) {
  return {
    version: 1,
    type: 'doc',
    content: [
      h(3, `🔁 Same bug reproduced in PR #${PR_NUMBER}`),
      p(`PR: ${PR_TITLE}`),
      p(`PR URL: ${PR_URL}`),
      p(`Commit: ${COMMIT_SHA}`),
      p(`Workflow Run: ${WORKFLOW_RUN_URL}`),
      rule(),
      h(4, '🧪 Failed Tests in this PR'),
      failedTests.length ? bulletList(failedTests) : p('See workflow run for details.'),
      rule(),
      p(`🤖 AI deduplication note: ${duplicateReason}`),
    ],
  };
}

// ─── Jira: Create new issue ───────────────────────────────────────────────────
async function createJiraIssue(description, summary) {
  const payload = JSON.stringify({
    fields: {
      project: { key: JIRA_PROJECT_KEY },
      summary: summary.slice(0, 255),
      description,
      issuetype: { name: 'Bug' },
    },
  });

  const res = await httpsRequest(
    jiraOptions('/rest/api/3/issue', 'POST', Buffer.byteLength(payload)),
    payload
  );

  if (res.status === 201) return JSON.parse(res.body);
  throw new Error(`Jira API returned ${res.status}: ${res.body}`);
}

// ─── Jira: Add comment to existing issue ─────────────────────────────────────
async function addJiraComment(issueKey, commentBody) {
  const payload = JSON.stringify({ body: commentBody });

  const res = await httpsRequest(
    jiraOptions(`/rest/api/3/issue/${issueKey}/comment`, 'POST', Buffer.byteLength(payload)),
    payload
  );

  if (res.status === 201) return JSON.parse(res.body);
  throw new Error(`Jira comment API returned ${res.status}: ${res.body}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    // Step 1: Analyze failures with Claude
    console.log('🤖 Step 1: Analyzing test failures with Claude AI...');
    const ai = await analyzeFailures();

    if (ai) {
      console.log(`✅ AI analysis complete — ${ai.affectedComponent} | Severity: ${ai.severity}`);
    } else {
      console.log('⚠️  AI analysis unavailable — using fallback report');
    }

    // Step 2: Search Jira for existing open bugs
    console.log('🔍 Step 2: Searching Jira for existing open bugs...');
    const keywords = ai?.searchKeywords?.length
      ? ai.searchKeywords
      : failedTests.slice(0, 2);

    const existingIssues = await searchJiraForExistingBug(keywords);
    console.log(`   Found ${existingIssues.length} potentially related open bug(s)`);

    // Step 3: AI deduplication check
    let duplicateResult = null;
    if (existingIssues.length > 0 && ai) {
      console.log('🤖 Step 3: Checking for duplicate with Claude AI...');
      duplicateResult = await checkIsDuplicate(existingIssues, ai);

      if (duplicateResult?.isDuplicate) {
        console.log(`✅ Duplicate detected: ${duplicateResult.matchingIssueKey}`);
        console.log(`   Reason: ${duplicateResult.reason}`);
      } else {
        console.log('✅ No duplicate found — will create new bug');
      }
    } else {
      console.log('ℹ️  Step 3: Skipped (no existing bugs found)');
    }

    // Step 4: Either comment on duplicate or create new bug
    if (duplicateResult?.isDuplicate && duplicateResult?.matchingIssueKey) {
      console.log(`📝 Step 4: Adding comment to existing bug ${duplicateResult.matchingIssueKey}...`);
      const commentBody = buildDuplicateComment(duplicateResult.reason);
      await addJiraComment(duplicateResult.matchingIssueKey, commentBody);

      const issueUrl = `${JIRA_HOST}/browse/${duplicateResult.matchingIssueKey}`;
      console.log(`✅ Comment added to existing bug: ${duplicateResult.matchingIssueKey}`);
      console.log(`JIRA_ISSUE_KEY=${duplicateResult.matchingIssueKey}`);
      console.log(`JIRA_ISSUE_URL=${issueUrl}`);
    } else {
      console.log('📝 Step 4: Creating new Jira bug...');
      const summary = ai?.summary
        ? ai.summary.slice(0, 255)
        : `[PR #${PR_NUMBER}] E2E test failure: ${PR_TITLE}`.slice(0, 255);

      const description = buildDescription(ai);
      const issue = await createJiraIssue(description, summary);
      const issueUrl = `${JIRA_HOST}/browse/${issue.key}`;

      console.log(`✅ New Jira bug created: ${issue.key}`);
      console.log(`JIRA_ISSUE_KEY=${issue.key}`);
      console.log(`JIRA_ISSUE_URL=${issueUrl}`);
    }

  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  }
})();
