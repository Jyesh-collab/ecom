#!/usr/bin/env node
/**
 * create-jira-defect.js
 *
 * Claude AI reads the git diff + Playwright failures and writes a proper
 * QA bug report — what changed, navigation steps, expected vs actual.
 * Screenshots and videos from Playwright are attached directly to the Jira ticket.
 * Deduplication: if the same bug is already open in Jira, adds a comment instead.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
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
  GIT_DIFF = '',
  ARTIFACTS_PATH = 'test-artifacts',
  WORKFLOW_RUN_URL = '',
} = process.env;

if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
  console.error('Missing required env vars: JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY');
  process.exit(1);
}

// Parse failed tests from FAILED_TESTS env var, or extract from ERROR_DETAILS log
function extractFailedTests() {
  if (FAILED_TESTS && FAILED_TESTS.trim()) {
    return FAILED_TESTS.split('\n').filter(Boolean);
  }
  // Fallback: parse Playwright output lines with ✘ symbol
  if (ERROR_DETAILS) {
    const lines = ERROR_DETAILS.split('\n');
    const failed = [];
    for (const line of lines) {
      // Match lines like: ✘   5 [chromium] › tests/e2e/cart.spec.js:40:3 › Shopping Cart › checkout button...
      const match = line.match(/✘.*?›\s+(.+?)\s+\(\d+/);
      if (match) {
        const name = match[1].trim();
        if (!name.includes('retry') && !failed.includes(name)) {
          failed.push(name);
        }
      }
    }
    return failed;
  }
  return [];
}

const failedTests = extractFailedTests();

// ─── Find Playwright screenshots and videos ───────────────────────────────────
function findArtifacts() {
  const screenshots = [];
  const videos = [];

  if (!fs.existsSync(ARTIFACTS_PATH)) return { screenshots, videos };

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.png') && !entry.includes('context')) {
        screenshots.push(full);
      } else if (entry.endsWith('.webm')) {
        videos.push(full);
      }
    }
  }

  walk(ARTIFACTS_PATH);
  // Return only failing test artifacts (limit to avoid huge uploads)
  return {
    screenshots: screenshots.filter(f => f.includes('failed') || f.includes('test-failed')).slice(0, 3),
    videos: videos.slice(0, 2),
  };
}

// ─── Generic HTTPS request ────────────────────────────────────────────────────
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Jira helpers ─────────────────────────────────────────────────────────────
function jiraAuth() {
  return `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;
}

function jiraHost() {
  return new url.URL(JIRA_HOST).hostname;
}

async function jiraRequest(apiPath, method, bodyObj) {
  const payload = bodyObj ? JSON.stringify(bodyObj) : null;
  const options = {
    hostname: jiraHost(),
    path: apiPath,
    method,
    headers: {
      Authorization: jiraAuth(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  };
  return httpsRequest(options, payload);
}

// Upload a file as a Jira attachment
async function uploadAttachment(issueKey, filePath, displayName) {
  const fileContent = fs.readFileSync(filePath);
  const fileName = displayName || path.basename(filePath);
  const mimeType = fileName.endsWith('.webm') ? 'video/webm' : 'image/png';
  const boundary = `Boundary${Date.now()}`;

  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileContent, footer]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: jiraHost(),
      path: `/rest/api/3/issue/${issueKey}/attachments`,
      method: 'POST',
      headers: {
        Authorization: jiraAuth(),
        'X-Atlassian-Token': 'no-check',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(Buffer.concat(chunks).toString()));
        else reject(new Error(`Attachment upload failed ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Claude via OpenRouter ────────────────────────────────────────────────────
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

// ─── Step 1: AI analyzes diff + failures ─────────────────────────────────────
async function analyzeFailures() {
  const prompt = `You are a senior QA engineer writing a Jira bug report.
You have two inputs: (1) the git diff showing what code changed in this PR, and (2) the Playwright test failures.
Your job is to connect the dots — explain exactly what changed in the code and how it caused the tests to fail.

## Git Diff (what the developer changed in this PR)
${GIT_DIFF ? GIT_DIFF.slice(0, 3000) : 'Not available'}

## Failed Tests
${failedTests.length > 0 ? failedTests.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'See error details'}

## Playwright Error Output
${ERROR_DETAILS ? ERROR_DETAILS.slice(0, 2000) : 'Not available'}

## PR Info
PR #${PR_NUMBER}: ${PR_TITLE}

Instructions:
- Look at the git diff to find EXACTLY what changed (e.g. button text, API response, component)
- Explain the bug in plain English: "The [element] was changed from '[old value]' to '[new value]'"
- Write steps to reproduce using the ACTUAL navigation path the Playwright test took
- Be specific with file names, button names, page URLs from the diff and test output

Return JSON with these exact fields:
{
  "summary": "One-line bug title mentioning what changed and where (max 200 chars)",
  "whatChanged": "Exact description of the code change — e.g. 'Button text in Cart.jsx changed from Proceed to Checkout to AI is coming'",
  "changedFile": "The file where the change was made e.g. src/pages/Cart.jsx",
  "oldValue": "The original value before the change e.g. Proceed to Checkout",
  "newValue": "The new value after the change e.g. AI is coming",
  "affectedComponent": "Which page/component is affected e.g. Cart Page",
  "severity": "Critical | High | Medium | Low",
  "stepsToReproduce": ["Exact navigation steps the test took, e.g. Go to /shop", "Click on the first product card", "Click See me in cart button", "Navigate to /cart"],
  "expectedResult": "What should be there — e.g. A button with text Proceed to Checkout is visible",
  "actualResult": "What is actually there — e.g. The button reads AI is coming",
  "searchKeywords": ["2-3 short keywords for Jira duplicate search"]
}`;

  return callClaude(prompt, 1000);
}

// ─── Step 2: Search Jira for duplicates ──────────────────────────────────────
async function searchExistingBugs(keywords) {
  const clauses = keywords.slice(0, 3)
    .map(k => `summary ~ "${k.replace(/"/g, '')}"`)
    .join(' OR ');

  const jql = encodeURIComponent(
    `project = "${JIRA_PROJECT_KEY}" AND issuetype = Bug AND status NOT IN (Done, Resolved, Closed) AND (${clauses}) ORDER BY created DESC`
  );

  try {
    const res = await jiraRequest(
      `/rest/api/3/issue/search?jql=${jql}&maxResults=5&fields=summary,status,key`,
      'GET'
    );
    if (res.status === 200) return JSON.parse(res.body).issues || [];
  } catch (e) {
    console.warn('Jira search failed:', e.message);
  }
  return [];
}

// ─── Step 3: AI deduplication check ──────────────────────────────────────────
async function checkDuplicate(existingIssues, ai) {
  if (!existingIssues.length || !ai) return null;

  const list = existingIssues.map(i => `Key: ${i.key}\nSummary: ${i.fields.summary}`).join('\n\n');

  const result = await callClaude(`You are checking if a new Playwright test failure is already reported in Jira.

New bug: ${ai.whatChanged}
Affected component: ${ai.affectedComponent}

Existing open bugs:
${list}

Return JSON:
{
  "isDuplicate": true or false,
  "matchingIssueKey": "EXP-123 or null",
  "reason": "Brief explanation"
}

Only return isDuplicate: true if the existing bug is clearly the SAME root cause.`, 200);

  return result;
}

// ─── Jira ADF builders ────────────────────────────────────────────────────────
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
    attrs: { language: 'diff' },
    content: [{ type: 'text', text: text || 'No diff captured.' }],
  };
}

// ─── Build Jira description ───────────────────────────────────────────────────
function buildDescription(ai) {
  const content = [];

  // AI disclaimer
  content.push(p('⚠️ AI-Generated Analysis — Root cause and steps should be verified by an engineer before acting.'));
  content.push(rule());

  // What is the bug
  content.push(h(2, '🐛 Bug Summary'));
  content.push(p(ai?.whatChanged || `E2E tests failed during PR #${PR_NUMBER}. ${failedTests.length} test(s) failed.`));

  if (ai?.changedFile) {
    content.push(p(`📁 File changed: ${ai.changedFile}`));
  }

  if (ai?.oldValue && ai?.newValue) {
    content.push(h(3, '🔄 What Changed'));
    content.push(bulletList([
      `Before: "${ai.oldValue}"`,
      `After:  "${ai.newValue}"`,
    ]));

    if (GIT_DIFF) {
      const relevantDiff = GIT_DIFF.split('\n')
        .filter(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@') || l.startsWith('diff'))
        .slice(0, 30)
        .join('\n');
      content.push(codeBlock(relevantDiff));
    }
  }

  content.push(rule());

  // Steps to reproduce
  content.push(h(3, '🔁 Steps to Reproduce'));
  content.push(orderedList(
    ai?.stepsToReproduce?.length ? ai.stepsToReproduce : [
      'Open the PR branch locally',
      'Run: npx playwright test --headed',
      'Observe the failure',
    ]
  ));

  content.push(h(3, '✅ Expected Result'));
  content.push(p(ai?.expectedResult || 'All E2E tests pass with the correct UI elements present.'));

  content.push(h(3, '❌ Actual Result'));
  content.push(p(ai?.actualResult || `${failedTests.length} test(s) failed.`));

  content.push(rule());

  // Evidence
  content.push(h(3, '📎 Evidence'));
  content.push(p('Screenshots are attached directly to this ticket.'));
  content.push(bulletList([
    `🎥 Video recording: ${WORKFLOW_RUN_URL} → Artifacts → playwright-results-pr-${PR_NUMBER} → video.webm`,
    `🔍 Playwright trace: download artifacts and run: npx playwright show-trace trace.zip`,
  ]));

  content.push(rule());

  // Small reference section
  content.push(h(3, '🔗 Reference'));
  content.push(bulletList([
    `PR: #${PR_NUMBER} — ${PR_TITLE}`,
    `PR URL: ${PR_URL}`,
    `Commit: ${COMMIT_SHA.slice(0, 8)}`,
    `Workflow: ${WORKFLOW_RUN_URL}`,
  ]));

  return { version: 1, type: 'doc', content };
}

// ─── Build duplicate comment ──────────────────────────────────────────────────
function buildDuplicateComment(ai, reason) {
  return {
    version: 1,
    type: 'doc',
    content: [
      h(3, `🔁 Same bug reproduced in PR #${PR_NUMBER}`),
      p(ai?.whatChanged || 'Same test failures detected.'),
      rule(),
      h(4, 'Failed Tests'),
      failedTests.length ? bulletList(failedTests) : p('See workflow run.'),
      rule(),
      bulletList([
        `PR: #${PR_NUMBER} — ${PR_TITLE}`,
        `PR URL: ${PR_URL}`,
        `Commit: ${COMMIT_SHA.slice(0, 8)}`,
        `Workflow: ${WORKFLOW_RUN_URL}`,
      ]),
      p(`🤖 AI deduplication: ${reason}`),
    ],
  };
}

// ─── Create Jira issue ────────────────────────────────────────────────────────
async function createJiraIssue(summary, description) {
  const payload = JSON.stringify({
    fields: {
      project: { key: JIRA_PROJECT_KEY },
      summary: summary.slice(0, 255),
      description,
      issuetype: { name: 'Bug' },
    },
  });

  const res = await httpsRequest({
    hostname: jiraHost(),
    path: '/rest/api/3/issue',
    method: 'POST',
    headers: {
      Authorization: jiraAuth(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);

  if (res.status === 201) return JSON.parse(res.body);
  throw new Error(`Jira API ${res.status}: ${res.body}`);
}

// ─── Add comment to existing issue ───────────────────────────────────────────
async function addComment(issueKey, body) {
  const payload = JSON.stringify({ body });
  const res = await httpsRequest({
    hostname: jiraHost(),
    path: `/rest/api/3/issue/${issueKey}/comment`,
    method: 'POST',
    headers: {
      Authorization: jiraAuth(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);

  if (res.status !== 201) throw new Error(`Comment API ${res.status}: ${res.body}`);
}

// ─── Attach screenshots to Jira (videos linked, not attached — CTO decision) ──
async function attachArtifacts(issueKey, artifacts) {
  // Videos are NOT uploaded — Jira is not a video host.
  // Video link is included in the ticket description pointing to GitHub artifacts.
  const all = artifacts.screenshots;
  if (all.length === 0) {
    console.log('   No screenshots found to attach');
    return;
  }

  for (let i = 0; i < all.length; i++) {
    const filePath = all[i];
    const displayName = `screenshot-${i + 1}.png`;
    try {
      const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
      console.log(`   Attaching ${displayName} (${sizeMB}MB) from ${path.basename(path.dirname(filePath))}...`);
      await uploadAttachment(issueKey, filePath, displayName);
      console.log(`   ✅ Attached: ${displayName}`);
    } catch (e) {
      console.warn(`   ⚠️  Could not attach ${displayName}: ${e.message}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    // Step 1: Analyze
    console.log('🤖 Step 1: Claude is analyzing git diff + test failures...');
    const ai = await analyzeFailures();
    if (ai) {
      console.log(`✅ Bug identified: ${ai.whatChanged?.slice(0, 100)}`);
      console.log(`   Component: ${ai.affectedComponent} | Severity: ${ai.severity}`);
    } else {
      console.log('⚠️  AI unavailable — using fallback report');
    }

    // Step 2: Search for duplicates
    console.log('🔍 Step 2: Searching Jira for existing open bugs...');
    const keywords = ai?.searchKeywords?.length ? ai.searchKeywords : failedTests.slice(0, 2);
    const existing = await searchExistingBugs(keywords);
    console.log(`   Found ${existing.length} potentially related open bug(s)`);

    // Step 3: Deduplication
    let duplicate = null;
    if (existing.length && ai) {
      console.log('🤖 Step 3: Checking for duplicate...');
      duplicate = await checkDuplicate(existing, ai);
      if (duplicate?.isDuplicate) {
        console.log(`✅ Duplicate: ${duplicate.matchingIssueKey} — ${duplicate.reason}`);
      } else {
        console.log('✅ Not a duplicate — creating new bug');
      }
    }

    // Step 4: Find Playwright artifacts
    console.log('📁 Step 4: Finding Playwright screenshots and videos...');
    const artifacts = findArtifacts();
    console.log(`   Found ${artifacts.screenshots.length} screenshot(s), ${artifacts.videos.length} video(s)`);

    // Step 5: Create or update Jira
    let issueKey;
    if (duplicate?.isDuplicate && duplicate?.matchingIssueKey) {
      console.log(`📝 Step 5: Adding comment to existing bug ${duplicate.matchingIssueKey}...`);
      await addComment(duplicate.matchingIssueKey, buildDuplicateComment(ai, duplicate.reason));
      issueKey = duplicate.matchingIssueKey;
      console.log(`✅ Comment added to ${issueKey}`);
    } else {
      console.log('📝 Step 5: Creating new Jira bug...');
      const summary = ai?.summary
        ? ai.summary
        : `[PR #${PR_NUMBER}] E2E failure: ${PR_TITLE}`.slice(0, 255);

      const issue = await createJiraIssue(summary, buildDescription(ai));
      issueKey = issue.key;
      console.log(`✅ Created: ${issueKey}`);
    }

    // Step 6: Attach screenshots and videos
    console.log(`📎 Step 6: Attaching screenshots and videos to ${issueKey}...`);
    await attachArtifacts(issueKey, artifacts);

    const issueUrl = `${JIRA_HOST}/browse/${issueKey}`;
    console.log(`\n🎉 Done! Jira bug: ${issueUrl}`);
    console.log(`JIRA_ISSUE_KEY=${issueKey}`);
    console.log(`JIRA_ISSUE_URL=${issueUrl}`);

  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  }
})();
