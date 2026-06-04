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
  GRAPH_OUTPUT = '',    // JSON string from build-dependency-graph.js
  FAILED_SPECS  = '',   // Newline-separated spec file paths that actually failed
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
const failedSpecFiles = FAILED_SPECS.split('\n').filter(Boolean);

// ─── Group failures by root cause (changed source file) ──────────────────────
// Each group = one Jira ticket
function groupFailuresBySource() {
  let graph = {};
  try { graph = JSON.parse(GRAPH_OUTPUT); } catch {}

  // No graph available → one catch-all group covering all failures
  if (Object.keys(graph).length === 0) {
    return [{
      sourceFile : null,
      specFiles  : failedSpecFiles.length > 0 ? failedSpecFiles : ['see error log'],
      isUntraced : true,
    }];
  }

  const groups      = [];
  const coveredBases = new Set(); // spec basenames already claimed by a group

  for (const [sourceFile, data] of Object.entries(graph)) {
    const suggested = data.suggestedTests || [];

    // Match suggested specs against the specs that actually failed
    const failedForThis = suggested.filter(spec => {
      const specBase = path.basename(spec);
      return failedSpecFiles.some(f => path.basename(f) === specBase || f.includes(specBase) || spec.includes(path.basename(f)));
    });

    if (failedForThis.length > 0) {
      groups.push({ sourceFile, specFiles: [...new Set(failedForThis)] });
      failedForThis.forEach(s => coveredBases.add(path.basename(s)));
    }
  }

  // Catch-all: failed specs not traced to any changed file
  const uncovered = failedSpecFiles.filter(f => !coveredBases.has(path.basename(f)));
  if (uncovered.length > 0) {
    groups.push({ sourceFile: null, specFiles: uncovered, isUntraced: true });
  }

  // Nothing grouped at all → single catch-all
  if (groups.length === 0) {
    return [{
      sourceFile : null,
      specFiles  : failedSpecFiles.length > 0 ? failedSpecFiles : ['see error log'],
      isUntraced : true,
    }];
  }

  return groups;
}

// ─── Extract the diff section for one specific source file ───────────────────
function filterDiffForFile(fullDiff, sourceFile) {
  if (!fullDiff)     return '';
  if (!sourceFile)   return fullDiff.slice(0, 4000);

  const normalTarget = sourceFile.replace(/\\/g, '/');
  const lines    = fullDiff.split('\n');
  const sections = [];
  let current    = [];
  let inSection  = false;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (inSection && current.length) sections.push(current.join('\n'));
      current   = [line];
      inSection = line.replace(/\\/g, '/').includes(normalTarget);
    } else {
      current.push(line);
    }
  }
  if (inSection && current.length) sections.push(current.join('\n'));

  const result = sections.join('\n');
  // Fall back to full diff if file not found in diff (e.g. backend file)
  return result || fullDiff.slice(0, 4000);
}

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
  // FIX #5: Playwright names screenshots by test title — 'failed' is NEVER in the filename.
  // Take all screenshots, prioritise any that have 'retry' in path (those are definite failures),
  // then fill up to 3 from the rest.
  const retryShots = screenshots.filter(f => f.includes('retry'));
  const otherShots = screenshots.filter(f => !f.includes('retry'));
  const finalShots = [...retryShots, ...otherShots].slice(0, 3);

  return {
    screenshots: finalShots,
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
    model: 'anthropic/claude-3.5-haiku',   // FIX #1: dots not hyphens
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

// ─── FIX #2: Product-language fallback when AI is unavailable ─────────────────
// Maps failed spec files to plain-English product area names
const SPEC_TO_PRODUCT_AREA = {
  'auth.spec.js'     : 'Authentication Flow',
  'products.spec.js' : 'Product Browsing',
  'cart.spec.js'     : 'Shopping Cart',
  'checkout.spec.js' : 'Checkout Flow',
  'search.spec.js'   : 'Search and Navigation',
};

function productFallbackSummary() {
  // Derive product areas from the failed spec file names — never use PR title
  const areas = [...new Set(
    failedTests
      .map(t => {
        const spec = Object.keys(SPEC_TO_PRODUCT_AREA).find(s => t.includes(s));
        return spec ? SPEC_TO_PRODUCT_AREA[spec] : null;
      })
      .filter(Boolean)
  )];

  if (areas.length > 0) {
    return `${areas.join(' and ')} broken in PR #${PR_NUMBER} — E2E tests detected a regression`;
  }
  return `Product regression detected in PR #${PR_NUMBER} — manual investigation required`;
}

function productFallbackWhatChanged() {
  // Extract something useful from the error log if no diff is available
  if (ERROR_DETAILS) {
    const errorLine = ERROR_DETAILS.split('\n')
      .find(l => l.includes('expected') || l.includes('toHaveText') || l.includes('toBeVisible') || l.includes('Error:'));
    if (errorLine) return `Test assertion failed: ${errorLine.trim().slice(0, 300)}`;
  }
  const areas = [...new Set(
    failedTests
      .map(t => {
        const spec = Object.keys(SPEC_TO_PRODUCT_AREA).find(s => t.includes(s));
        return spec ? SPEC_TO_PRODUCT_AREA[spec] : null;
      })
      .filter(Boolean)
  )];
  return areas.length > 0
    ? `Regression in ${areas.join(', ')} — ${failedTests.length} test(s) failed. See git diff and Playwright output for details.`
    : `${failedTests.length} E2E test(s) failed. Manual investigation required.`;
}

// ─── Step 1: AI analyzes one group (one changed source file → its failing specs) ─
async function analyzeFailures(group) {
  const { sourceFile, specFiles } = group;

  // Extract only this file's portion of the diff
  const diffSnippet  = filterDiffForFile(GIT_DIFF, sourceFile) || 'Not available';

  // Last 3000 chars of error log — that's where the actual failure messages appear
  const errorSnippet = ERROR_DETAILS ? ERROR_DETAILS.slice(-3000) : 'Not available';

  // Map spec files to human-readable product area descriptions for Claude
  const SPEC_AREAS = {
    'auth.spec.js'     : 'Authentication — Login, Register, Forgot Password pages',
    'products.spec.js' : 'Product Browsing — Shop page, Product cards, Product detail, Recommendations',
    'cart.spec.js'     : 'Shopping Cart — Add/remove items, Cart total, Checkout button',
    'checkout.spec.js' : 'Checkout Flow — Payment form, Card validation, Order submission',
    'search.spec.js'   : 'Search and Navigation — Search bar, Nav links, Search results',
  };
  const specContext = specFiles.map(s => {
    const base = path.basename(s);
    return `• ${s}  →  ${SPEC_AREAS[base] || base}`;
  }).join('\n');

  const prompt = `You are a senior QA engineer writing ONE Jira bug report for ONE specific code change.

## The Source File That Changed
${sourceFile || 'Unknown — see git diff below'}

## Git Diff For This Specific File
\`\`\`diff
${diffSnippet}
\`\`\`

## Product Areas Broken By This Change
${specContext}

## Playwright Failure Output
${errorSnippet}

## PR Info
PR #${PR_NUMBER}: ${PR_TITLE}

CRITICAL RULES:
1. PRODUCT language only. Never write "E2E test", "Playwright", "spec file", "CI", or "test failure".
2. Summary = what broke for the USER in this specific file. E.g. "Add to Cart button text changed from 'Add to Cart' to 'See me in cart' in ProductCard.jsx"
3. stepsToReproduce = browser steps a human tester follows — not code.
4. oldValue / newValue = exact text from the git diff minus/plus lines. Do NOT guess.
5. ALL fields required — never null.

Return JSON — every field must be populated:
{
  "summary": "One product-language bug title for THIS file's change. Max 200 chars.",
  "whatChanged": "Exact: '[element] in [file] changed from [old] to [new]'",
  "changedFile": "${sourceFile || 'see git diff'}",
  "oldValue": "Exact value from diff minus (−) lines",
  "newValue": "Exact value from diff plus (+) lines",
  "affectedComponent": "Shopping Cart | Checkout Flow | Product Listing | Authentication | Search and Navigation",
  "severity": "Critical | High | Medium | Low",
  "stepsToReproduce": ["Go to /page", "Do action", "Observe result"],
  "expectedResult": "What the user should see",
  "actualResult": "What the user actually sees after this change",
  "searchKeywords": ["2-3 short product-domain keywords"]
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

Only return isDuplicate: true if the existing bug is clearly the SAME root cause.`, 500);  // FIX #6: was 200 — not enough tokens to reason

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
  content.push(p(ai?.whatChanged || productFallbackWhatChanged()));

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
  content.push(p(ai?.expectedResult || 'Product behaves as designed — UI elements have correct text and functionality works end to end.'));

  content.push(h(3, '❌ Actual Result'));
  content.push(p(ai?.actualResult || productFallbackWhatChanged()));

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

// ─── Validate AI output fields — fill blanks with product-language fallbacks ──
function validateAI(ai, group) {
  if (!ai) return null;
  const bad = v => !v || (typeof v === 'string' && (v.toLowerCase().includes('e2e') || v.toLowerCase().includes('playwright')));

  if (bad(ai.summary))        ai.summary        = productFallbackSummary();
  if (!ai.whatChanged)        ai.whatChanged     = productFallbackWhatChanged();
  if (!ai.changedFile)        ai.changedFile     = group.sourceFile || 'See git diff';
  if (!ai.oldValue)           ai.oldValue        = 'See git diff (− lines)';
  if (!ai.newValue)           ai.newValue        = 'See git diff (+ lines)';
  if (!ai.affectedComponent)  ai.affectedComponent = 'See affected test areas';
  if (!ai.severity)           ai.severity        = 'High';
  if (!Array.isArray(ai.stepsToReproduce) || !ai.stepsToReproduce.length) {
    ai.stepsToReproduce = [
      'Open the application in a browser',
      'Navigate to the page affected by this change',
      'Perform the action described in "What Changed"',
      'Observe the incorrect behaviour',
    ];
  }
  if (!ai.expectedResult) ai.expectedResult = 'Product behaves as designed with correct UI text and functionality';
  if (!ai.actualResult)   ai.actualResult   = productFallbackWhatChanged();
  if (!Array.isArray(ai.searchKeywords) || !ai.searchKeywords.length) {
    ai.searchKeywords = group.specFiles.map(s => path.basename(s).replace('.spec.js', '')).slice(0, 2);
  }
  return ai;
}

// ─── Main — one Jira ticket per root cause (changed source file) ──────────────
(async () => {
  try {
    // ── Group failures by root cause ─────────────────────────────────────────
    const groups = groupFailuresBySource();
    console.log(`\n📊 ${groups.length} root cause group(s) identified:`);
    groups.forEach((g, i) =>
      console.log(`   ${i + 1}. ${g.sourceFile || 'untraced'} → ${g.specFiles.map(s => path.basename(s)).join(', ')}`)
    );

    // ── Playwright artifacts — found once, attached to first new ticket ───────
    const artifacts = findArtifacts();
    console.log(`📁 Artifacts: ${artifacts.screenshots.length} screenshot(s), ${artifacts.videos.length} video(s)`);

    const createdTickets = []; // {key, url, sourceFile}
    let screenshotsAttached = false;

    // ── Loop — one Jira ticket per group ─────────────────────────────────────
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const label = group.sourceFile ? path.basename(group.sourceFile) : 'untraced failures';
      console.log(`\n${'━'.repeat(60)}`);
      console.log(`🔍 Group ${i + 1}/${groups.length}: ${label}`);
      console.log(`   Specs: ${group.specFiles.map(s => path.basename(s)).join(', ')}`);

      // Step 1: Claude analyzes this specific group
      console.log('🤖 Analyzing with Claude...');
      let ai = await analyzeFailures(group);
      ai = validateAI(ai, group);

      if (ai) {
        console.log(`   ✅ ${ai.summary?.slice(0, 80)}`);
        console.log(`   Component: ${ai.affectedComponent} | Severity: ${ai.severity}`);
      } else {
        console.log('   ⚠️  AI unavailable — using product-language fallback');
      }

      // Step 2: Search Jira for duplicates
      const keywords = ai?.searchKeywords?.length
        ? ai.searchKeywords
        : group.specFiles.map(s => path.basename(s).replace('.spec.js', '')).slice(0, 2);
      const existing = await searchExistingBugs(keywords);
      console.log(`🔍 Duplicate search: ${existing.length} open bug(s) found`);

      // Step 3: Dedup check
      let duplicate = null;
      if (existing.length && ai) {
        duplicate = await checkDuplicate(existing, ai);
        if (duplicate?.isDuplicate) {
          console.log(`   ✅ Duplicate of ${duplicate.matchingIssueKey} — will comment`);
        } else {
          console.log('   ✅ Not a duplicate — will create new ticket');
        }
      }

      // Step 4: Create or comment
      let issueKey;
      if (duplicate?.isDuplicate && duplicate?.matchingIssueKey) {
        await addComment(duplicate.matchingIssueKey, buildDuplicateComment(ai, duplicate.reason));
        issueKey = duplicate.matchingIssueKey;
        console.log(`📝 Comment added to ${issueKey}`);
      } else {
        const summary = (ai?.summary || productFallbackSummary()).slice(0, 255);
        const issue   = await createJiraIssue(summary, buildDescription(ai));
        issueKey      = issue.key;
        console.log(`📝 Created: ${issueKey} — ${summary.slice(0, 60)}`);

        // Step 5: Attach screenshots to the FIRST new ticket only
        if (!screenshotsAttached && artifacts.screenshots.length > 0) {
          await attachArtifacts(issueKey, artifacts);
          screenshotsAttached = true;
        }
      }

      const issueUrl = `${JIRA_HOST}/browse/${issueKey}`;
      createdTickets.push({ key: issueKey, url: issueUrl, sourceFile: group.sourceFile });
      console.log(`JIRA_ISSUE_KEY=${issueKey}`);
      console.log(`JIRA_ISSUE_URL=${issueUrl}`);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log(`\n${'━'.repeat(60)}`);
    console.log(`🎉 Done — ${createdTickets.length} Jira ticket(s) created/updated:`);
    createdTickets.forEach(t => console.log(`   ${t.key}  ${t.url}`));

  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  }
})();
