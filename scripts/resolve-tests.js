#!/usr/bin/env node
/**
 * resolve-tests.js
 *
 * Two-layer intelligent test selection:
 *
 * Layer 1 — Dependency Graph (factual)
 *   Scans actual import relationships in src/ and backend/ to determine
 *   which files are impacted by the PR changes. No guessing.
 *
 * Layer 2 — Claude AI (reasoning)
 *   Receives the dependency graph output + git diff and makes the final
 *   decision. Claude now has facts, not just file names.
 *
 * Exit codes:
 *   0  — success, test files printed to stdout
 *   1  — AI call failed — pipeline is blocked intentionally
 *
 * Required env vars:
 *   OPENROUTER_API_KEY   API key from openrouter.ai
 *   BASE_SHA             Base commit SHA of the PR
 *   HEAD_SHA             Head commit SHA of the PR
 */

const https        = require('https');
const fs           = require('fs');
const { execSync } = require('child_process');
const path         = require('path');

const AVAILABLE_TESTS = [
  'tests/e2e/auth.spec.js',
  'tests/e2e/products.spec.js',
  'tests/e2e/cart.spec.js',
  'tests/e2e/checkout.spec.js',
  'tests/e2e/search.spec.js',
];

const ALL_TESTS = AVAILABLE_TESTS.join(' ');

// ─── Layer 1: Run dependency graph ────────────────────────────────────────────
function runDependencyGraph(changedFilesList) {
  const files = changedFilesList
    .filter(f => f && f.trim())
    // Only pass relevant source files — skip lockfiles, configs, assets
    .filter(f => !f.match(/\.(lock|md|txt|ico|png|svg|jpg|css)$/) && !f.includes('node_modules'));

  if (files.length === 0) return null;

  try {
    const graphScript = path.resolve(__dirname, 'build-dependency-graph.js');
    const output = execSync(
      `node "${graphScript}" ${files.map(f => `"${f}"`).join(' ')}`,
      { maxBuffer: 500 * 1024 }
    ).toString();
    return JSON.parse(output);
  } catch (e) {
    process.stderr.write(`⚠️  Dependency graph failed: ${e.message}\n`);
    return null;
  }
}

// ─── Format graph for Claude prompt ──────────────────────────────────────────
function formatGraphForPrompt(graph) {
  if (!graph) return 'Dependency graph not available.';

  const lines = [];
  for (const [file, data] of Object.entries(graph)) {
    lines.push(`File: ${file}`);
    if (data.note) {
      lines.push(`  Note: ${data.note}`);
    }
    if (data.directImporters?.length) {
      lines.push(`  Directly used by: ${data.directImporters.join(', ')}`);
    }
    if (data.affectedPages?.length) {
      lines.push(`  Affected pages: ${data.affectedPages.join(', ')}`);
    }
    if (data.affectedComponents?.length) {
      lines.push(`  Affected components: ${data.affectedComponents.join(', ')}`);
    }
    if (data.suggestedTests?.length) {
      lines.push(`  Graph suggests: ${data.suggestedTests.join(', ')}`);
    } else {
      lines.push(`  Graph suggests: none`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Collect all graph-suggested tests ───────────────────────────────────────
function collectGraphSuggestions(graph) {
  if (!graph) return [];
  const tests = new Set();
  for (const data of Object.values(graph)) {
    for (const t of (data.suggestedTests || [])) {
      tests.add(t);
    }
  }
  return [...tests].filter(t => AVAILABLE_TESTS.includes(t));
}

// ─── Phase 5: Load historical feedback from decision log ─────────────────────
function loadHistoricalContext() {
  const logPath = path.resolve(__dirname, 'decision-log.json');
  try {
    const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    const withResults = (log.entries || []).filter(e => e.testResults);
    if (withResults.length === 0) {
      return 'No historical data yet — this is an early run. Trust the dependency graph.';
    }

    const recent = withResults.slice(-20);
    const lines  = [`Historical accuracy (last ${recent.length} PRs with results):`];

    // Build file-area → test outcome patterns
    const areaPatterns = {};
    for (const entry of recent) {
      for (const file of (entry.changedFiles || [])) {
        // Group by top-level directory: src/components, backend/routes, etc.
        const parts = file.replace(/\\/g, '/').split('/');
        const area  = parts.slice(0, 2).join('/');
        if (!areaPatterns[area]) areaPatterns[area] = { runs: 0, failures: {}, cleanRuns: {} };
        areaPatterns[area].runs++;

        for (const test of (entry.finalSelected || [])) {
          const name   = path.basename(test);
          const status = entry.testResults?.[test] || 'unknown';
          if (status === 'failed') {
            areaPatterns[area].failures[name] = (areaPatterns[area].failures[name] || 0) + 1;
          } else if (status === 'passed') {
            areaPatterns[area].cleanRuns[name] = (areaPatterns[area].cleanRuns[name] || 0) + 1;
          }
        }
      }
    }

    for (const [area, data] of Object.entries(areaPatterns).slice(0, 6)) {
      const failList = Object.entries(data.failures)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t}(failed ${n}x)`)
        .join(', ');
      const cleanList = Object.entries(data.cleanRuns)
        .filter(([t]) => !(data.failures[t]))  // tests that NEVER failed
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t}(passed ${n}x with no failures)`)
        .join(', ');

      lines.push(`\n${area} (${data.runs} PRs):`);
      if (failList)  lines.push(`  Reliably catches bugs: ${failList}`);
      if (cleanList) lines.push(`  Consistently clean (possible over-selection): ${cleanList}`);
    }

    // Overall engine accuracy
    const allMetrics = recent.filter(e => e.metrics);
    if (allMetrics.length > 0) {
      const avgCaught = allMetrics.reduce((s, e) => s + (e.metrics.caught || 0), 0) / allMetrics.length;
      lines.push(`\nEngine performance: avg ${avgCaught.toFixed(1)} failures caught per PR`);
    }

    return lines.join('\n');
  } catch {
    return 'Historical data unavailable — trust the dependency graph.';
  }
}

// ─── Phase 5: Log this decision (testResults filled in later by update-decision-log.js) ──
function logDecision({ changedFiles, graphSuggested, claudeSelected, finalSelected, selectionSource }) {
  const logPath = path.resolve(__dirname, 'decision-log.json');
  let log = { version: 1, entries: [] };
  try { log = JSON.parse(fs.readFileSync(logPath, 'utf-8')); }
  catch { /* first run — start fresh */ }

  if (!Array.isArray(log.entries)) log.entries = [];

  log.entries.push({
    id             : `run-${process.env.GITHUB_RUN_ID || Date.now()}`,
    date           : new Date().toISOString(),
    pr             : process.env.GITHUB_REF || 'local',
    sha            : process.env.HEAD_SHA   || 'unknown',
    changedFiles,
    graphSuggested,
    claudeSelected,
    finalSelected,
    selectionSource,  // 'claude' | 'graph-fallback' | 'full-suite'
    testResults    : null,  // filled in by update-decision-log.js after tests run
    completedAt    : null,
    metrics        : null,
  });

  // Keep last 50 entries — enough for meaningful patterns, not too large
  if (log.entries.length > 50) log.entries = log.entries.slice(-50);

  try { fs.writeFileSync(logPath, JSON.stringify(log, null, 2)); }
  catch (e) { process.stderr.write(`⚠️  Could not write decision log: ${e.message}\n`); }
}

// ─── Claude via OpenRouter ────────────────────────────────────────────────────
function callOpenRouter(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      // Phase 3: Upgraded from claude-3.5-haiku → claude-3.5-sonnet
      // Better architectural reasoning = fewer wrong selections
      model      : 'anthropic/claude-3.5-sonnet',
      messages   : [{ role: 'user', content: prompt }],
      max_tokens : 1000,   // was 300 — enough room to reason before concluding
      temperature: 0,
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Jyesh-collab/ecom',
        'X-Title': 'AI-Powered Predictive QE Pipeline',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(body));
        else reject(new Error(`OpenRouter returned ${res.statusCode}: ${body}`));
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    process.stderr.write('\n❌ OPENROUTER_API_KEY is not set.\n');
    process.stderr.write('Add it as a GitHub secret: Settings → Secrets → OPENROUTER_API_KEY\n\n');
    process.exit(1);
  }

  // Get changed files from stdin or env
  let changedFilesRaw = '';
  try {
    changedFilesRaw = require('fs').readFileSync('/dev/stdin', 'utf-8').trim();
  } catch {
    changedFilesRaw = (process.env.CHANGED_FILES || '').replace(/,/g, '\n').trim();
  }

  if (!changedFilesRaw) {
    process.stderr.write('No changed files detected — running all tests\n');
    process.stdout.write(ALL_TESTS + '\n');
    process.exit(0);
  }

  const changedFilesList = changedFilesRaw.split('\n').filter(Boolean);

  // ── Layer 1: Dependency Graph ──────────────────────────────────────────────
  process.stderr.write('🔍 Layer 1: Running dependency graph analysis...\n');
  const graph = runDependencyGraph(changedFilesList);
  const graphSuggestions = collectGraphSuggestions(graph);
  const graphSummary = formatGraphForPrompt(graph);

  process.stderr.write(`   Graph suggests: ${graphSuggestions.length > 0 ? graphSuggestions.join(', ') : 'none'}\n`);

  // Get the actual git diff for richer context
  let gitDiff = '';
  const baseSha = process.env.BASE_SHA || '';
  const headSha = process.env.HEAD_SHA || '';
  if (baseSha && headSha) {
    try {
      gitDiff = execSync(
        `git diff ${baseSha} ${headSha} -- . ":(exclude)package-lock.json" ":(exclude)*.lock"`,
        { maxBuffer: 500 * 1024 }
      ).toString();
      if (gitDiff.length > 60000) {
        gitDiff = gitDiff.slice(0, 60000) + '\n...[diff truncated]\n';
      }
    } catch (e) {
      process.stderr.write(`Could not get git diff: ${e.message}\n`);
    }
  }

  // ── Layer 2: Claude AI reasoning on top of graph ───────────────────────────
  process.stderr.write('🤖 Layer 2: Claude AI reasoning over dependency graph...\n');

  // Phase 5: Load historical feedback — Claude now learns from past decisions
  const historicalContext = loadHistoricalContext();

  const prompt = `You are a QA engineer selecting Playwright E2E tests for a pull request.
You have been given a factual dependency impact analysis — trust it as ground truth.

## Changed Files
${changedFilesRaw}

## Dependency Impact Analysis (factual — derived from actual import graph)
${graphSummary}

## Graph-Suggested Tests (based on import relationships and self-learned route coverage)
${graphSuggestions.length > 0 ? graphSuggestions.join('\n') : 'None — changes are outside src/ or have no test coverage'}

## Historical Feedback (self-correcting loop — patterns from past PRs)
${historicalContext}

## Git Diff (for additional context)
\`\`\`diff
${gitDiff || '(not available)'}
\`\`\`

## Available Test Files
- tests/e2e/auth.spec.js       → Login, Registration, Password reset
- tests/e2e/products.spec.js   → Shop, Product cards, Product detail, Recommendations
- tests/e2e/cart.spec.js       → Cart page, Add/remove items, Cart total, Checkout button
- tests/e2e/checkout.spec.js   → Checkout form, Payment validation, Order submission
- tests/e2e/search.spec.js     → Search bar, Search results, Navigation

## Instructions
1. Start with the graph-suggested tests — they are based on real import relationships
2. Use historical feedback to refine: if a test has been "consistently clean" for this file area, consider removing it unless the graph strongly suggests it
3. Use the git diff to check if any additional tests are needed that the graph may have missed
4. Remove any test that is clearly NOT impacted by these changes
5. Only docs, CI config, or script changes (scripts/) → return empty array
6. Do NOT add tests just because they are part of a related user flow

Respond with ONLY a JSON object — no explanation, no markdown:
{"tests": ["tests/e2e/cart.spec.js"]}`;

  try {
    const response = await callOpenRouter(apiKey, prompt);
    const raw = response.choices?.[0]?.message?.content?.trim();

    if (!raw) throw new Error('Empty response from OpenRouter');

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      throw new Error(`Claude returned non-JSON: ${raw}`);
    }

    let selected = (parsed.tests || []).filter(t => AVAILABLE_TESTS.includes(t));
    let selectionSource = 'claude';

    // Safety net — if Claude returns nothing but graph had suggestions, use graph
    if (selected.length === 0 && graphSuggestions.length > 0) {
      process.stderr.write('⚠️  Claude returned empty — using graph suggestions as fallback\n');
      selected = graphSuggestions;
      selectionSource = 'graph-fallback';
    }

    // Final safety net — if still nothing, run all
    if (selected.length === 0) {
      process.stderr.write('⚠️  No tests selected — running full suite as safety net\n');
      selectionSource = 'full-suite';
      logDecision({
        changedFiles  : changedFilesList,
        graphSuggested: graphSuggestions,
        claudeSelected: parsed.tests || [],
        finalSelected : AVAILABLE_TESTS,
        selectionSource,
      });
      process.stdout.write(ALL_TESTS + '\n');
    } else {
      process.stderr.write(`✅ Final selection: ${selected.join(', ')}\n`);
      logDecision({
        changedFiles  : changedFilesList,
        graphSuggested: graphSuggestions,
        claudeSelected: parsed.tests || [],
        finalSelected : selected,
        selectionSource,
      });
      process.stdout.write(selected.join(' ') + '\n');
    }

    process.exit(0);

  } catch (err) {
    // If Claude fails but graph has suggestions — use graph as fallback
    if (graphSuggestions.length > 0) {
      process.stderr.write(`⚠️  Claude failed (${err.message}) — using dependency graph as fallback\n`);
      process.stderr.write(`✅ Fallback selection: ${graphSuggestions.join(', ')}\n`);
      logDecision({
        changedFiles  : changedFilesList,
        graphSuggested: graphSuggestions,
        claudeSelected: [],
        finalSelected : graphSuggestions,
        selectionSource: 'graph-fallback',
      });
      process.stdout.write(graphSuggestions.join(' ') + '\n');
      process.exit(0);
    }

    process.stderr.write('\n❌ AI Risk Assessment Engine FAILED\n');
    process.stderr.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.stderr.write(`Error: ${err.message}\n`);

    if (err.message.includes('401') || err.message.includes('403')) {
      process.stderr.write('\n👉 Invalid OPENROUTER_API_KEY.\n');
      process.stderr.write('   Fix: Check the secret value in GitHub Settings → Secrets\n\n');
    } else if (err.message.includes('402') || err.message.includes('credit') || err.message.includes('balance')) {
      process.stderr.write('\n👉 Insufficient OpenRouter credits.\n');
      process.stderr.write('   Fix: Go to https://openrouter.ai → Credits → Add credits\n\n');
    }

    process.stderr.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.stderr.write('Pipeline blocked. Fix the AI issue and re-run.\n\n');
    process.exit(1);
  }
}

main();
