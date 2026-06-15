#!/usr/bin/env node
/**
 * update-decision-log.js
 *
 * Phase 4 — Runtime Coverage + Phase 5 — Feedback Loop (data collection half)
 *
 * Called by the CI pipeline after Playwright tests complete.
 * Reads test-results/results.json and updates the most recent entry
 * in scripts/decision-log.json with actual pass/fail outcomes.
 *
 * Over time, this log becomes the training data for the self-correcting
 * feedback loop injected into the Claude prompt by resolve-tests.js.
 *
 * Usage (in CI after playwright tests):
 *   node scripts/update-decision-log.js
 *
 * Reads:
 *   test-results/results.json   (Playwright JSON reporter output)
 *   scripts/decision-log.json   (written by resolve-tests.js)
 *
 * Writes:
 *   scripts/decision-log.json   (same file, last entry updated)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_PATH     = path.resolve(__dirname, 'decision-log.json');
const RESULTS_PATH = path.resolve(process.cwd(), 'test-results', 'results.json');
const ROUTE_MAP_PATH = path.resolve(__dirname, 'test-route-map.json');

// ─── Parse Playwright results.json ───────────────────────────────────────────
function parsePlaywrightResults(resultsPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    const results = {};

    function walkSuites(suites, file) {
      for (const suite of (suites || [])) {
        // suite.file is set on top-level suites
        const currentFile = suite.file || file;

        for (const spec of (suite.specs || [])) {
          for (const test of (spec.tests || [])) {
            if (!currentFile) continue;
            // Normalize to forward-slash relative path
            const rel = currentFile.replace(/\\/g, '/');
            const key = rel.includes('tests/e2e/')
              ? rel.substring(rel.indexOf('tests/e2e/'))
              : rel;

            if (!results[key]) results[key] = 'passed';
            const status = test.status || (test.results?.[0]?.status);
            if (status === 'failed' || status === 'timedOut') {
              results[key] = 'failed';
            }
          }
        }

        // Recurse into nested suites
        if (suite.suites) walkSuites(suite.suites, currentFile);
      }
    }

    walkSuites(raw.suites, null);
    return results;
  } catch (e) {
    process.stderr.write(`⚠️  Could not parse results.json: ${e.message}\n`);
    return null;
  }
}

// ─── Infer runtime route coverage from test results + route map ──────────────
// Phase 4: validates that the static scan matches what tests actually exercise
function inferRuntimeCoverage(testResults) {
  try {
    const routeMap = JSON.parse(fs.readFileSync(ROUTE_MAP_PATH, 'utf-8'));
    const coverage = {};

    for (const [route, tests] of Object.entries(routeMap.routeToTests || {})) {
      const ran = tests.filter(t => testResults[t] !== undefined);
      if (ran.length > 0) {
        const failed = ran.filter(t => testResults[t] === 'failed');
        coverage[route] = {
          coveredBy: ran,
          status    : failed.length > 0 ? 'failed' : 'passed',
        };
      }
    }

    return coverage;
  } catch {
    return {};
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  // 1. Parse test results
  const testResults = parsePlaywrightResults(RESULTS_PATH);
  if (!testResults) {
    process.stderr.write('⚠️  No test results to log — skipping decision log update\n');
    process.exit(0);
  }

  // 2. Load decision log
  let log = { version: 1, entries: [] };
  try {
    log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  } catch {
    process.stderr.write('⚠️  No decision log found — nothing to update\n');
    process.exit(0);
  }

  if (!Array.isArray(log.entries) || log.entries.length === 0) {
    process.stderr.write('⚠️  Decision log is empty — nothing to update\n');
    process.exit(0);
  }

  // 3. Update the most recent entry
  const entry = log.entries[log.entries.length - 1];

  entry.testResults  = testResults;
  entry.completedAt  = new Date().toISOString();
  entry.runtimeCoverage = inferRuntimeCoverage(testResults);

  // 4. Compute accuracy metrics
  const selected = entry.finalSelected || [];
  const caught   = selected.filter(t => testResults[t] === 'failed').length;
  const clean    = selected.filter(t => testResults[t] === 'passed').length;
  const unknown  = selected.filter(t => testResults[t] === undefined).length;

  // precision: of tests we selected, how many actually found bugs?
  // (0 bugs found = PR was clean OR we over-selected)
  entry.metrics = {
    totalSelected : selected.length,
    caught,   // tests that found real failures — good selection
    clean,    // tests selected but passed — possible over-selection
    unknown,  // selected tests with no result (skipped?)
    precision : selected.length > 0
      ? `${Math.round((caught / selected.length) * 100)}%`
      : 'N/A',
  };

  // 5. Save
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

  process.stderr.write('✅ Decision log updated\n');
  process.stderr.write(`   Tests selected  : ${selected.length}\n`);
  process.stderr.write(`   Failures caught : ${caught}\n`);
  process.stderr.write(`   Clean runs      : ${clean}\n`);
  process.stderr.write(`   Precision       : ${entry.metrics.precision}\n`);

  // Print metrics JSON to stdout for CI to capture
  process.stdout.write(JSON.stringify(entry.metrics) + '\n');
}

main();
