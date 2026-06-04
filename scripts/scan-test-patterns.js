#!/usr/bin/env node
/**
 * scan-test-patterns.js
 *
 * Phase 1 — Self-Learning Scanner
 *
 * Reads every E2E spec file and extracts 4 navigation signal types:
 *   1. gotoRoutes    — page.goto('/route')          direct navigation
 *   2. urlAssertions — toHaveURL(/\/route/)          implied landing pages
 *   3. apiEndpoints  — url().includes('/api/route')  backend routes exercised
 *   4. navLinks      — getByRole('link', {name:'X'}) nav items clicked
 *
 * Output: scripts/test-route-map.json  (route → [test files])
 *
 * Usage:
 *   node scripts/scan-test-patterns.js
 *
 * The output file is consumed by build-dependency-graph.js to replace
 * the hardcoded PAGE_TEST_MAP with an auto-discovered version.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const TEST_DIR    = path.resolve(__dirname, '../tests/e2e');
const OUTPUT_FILE = path.resolve(__dirname, 'test-route-map.json');

// Nav-link text → URL route (stable architectural truth — link labels rarely change)
const NAV_LINK_TO_ROUTE = {
  'Home'     : '/',
  'Shop'     : '/shop',
  'Cart'     : '/cart',
  'Checkout' : '/checkout',
  'Login'    : '/login',
  'Register' : '/register',
  'Search'   : '/search',
  'About'    : '/about',
  'Support'  : '/support',
};

// ─── Signal extraction ────────────────────────────────────────────────────────
function scanFile(filePath) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); }
  catch { return null; }

  const signals = { gotoRoutes: [], urlAssertions: [], apiEndpoints: [], navLinks: [] };

  const push = (arr, val) => { if (!arr.includes(val)) arr.push(val); };

  // ── Signal 1: page.goto('/route') ────────────────────────────────────────
  const gotoRe = /page\.goto\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = gotoRe.exec(content)) !== null) {
    const route = m[1];
    if (route.startsWith('/')) push(signals.gotoRoutes, route);
  }

  // ── Signal 2a: toHaveURL('/route') — string literal ──────────────────────
  const urlStrRe = /toHaveURL\(\s*['"`](\/[^'"`]+)['"`]/g;
  while ((m = urlStrRe.exec(content)) !== null) {
    push(signals.urlAssertions, m[1]);
  }

  // ── Signal 2b: toHaveURL(/\/segment/) — regex literal ────────────────────
  // In source text, /\/checkout/ appears as the chars: / \ / c h e c k o u t /
  // Match: toHaveURL(/\/<segment>/) and extract <segment>
  const urlRegexRe = /toHaveURL\(\s*\/\\\/([a-z][a-z0-9-]*)/g;
  while ((m = urlRegexRe.exec(content)) !== null) {
    push(signals.urlAssertions, '/' + m[1]);
  }

  // ── Signal 3: url().includes('/api/endpoint') ─────────────────────────────
  // Captures the first segment after /api/ — stops at / or quote
  const apiRe = /url\(\)\.includes\(\s*['"`]\/api\/([^'"`/]+)/g;
  while ((m = apiRe.exec(content)) !== null) {
    push(signals.apiEndpoints, m[1]);
  }

  // ── Signal 4: getByRole('link', { name: 'X' }) ───────────────────────────
  const linkRe = /getByRole\(\s*['"`]link['"`]\s*,\s*\{[^}]*name\s*:\s*['"`]([^'"`]+)['"`]/g;
  while ((m = linkRe.exec(content)) !== null) {
    push(signals.navLinks, m[1]);
  }

  return signals;
}

// ─── Build route → [test files] map ──────────────────────────────────────────
function buildRouteMap(allSignals) {
  const routeToTests = {};

  const add = (route, testFile) => {
    if (!routeToTests[route]) routeToTests[route] = [];
    if (!routeToTests[route].includes(testFile)) routeToTests[route].push(testFile);
  };

  for (const [testFile, signals] of Object.entries(allSignals)) {
    // Page routes from gotos and URL assertions
    for (const route of [...signals.gotoRoutes, ...signals.urlAssertions]) {
      add(route, testFile);
    }

    // API routes
    for (const endpoint of signals.apiEndpoints) {
      add(`/api/${endpoint}`, testFile);
    }

    // Nav link text → route
    for (const link of signals.navLinks) {
      const route = NAV_LINK_TO_ROUTE[link];
      if (route) add(route, testFile);
    }
  }

  return routeToTests;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(TEST_DIR)) {
    process.stderr.write(`❌ Test directory not found: ${TEST_DIR}\n`);
    process.exit(1);
  }

  const specFiles = fs.readdirSync(TEST_DIR)
    .filter(f => f.endsWith('.spec.js'))
    .map(f => path.join(TEST_DIR, f));

  if (specFiles.length === 0) {
    process.stderr.write('⚠️  No spec files found in tests/e2e/\n');
    process.exit(0);
  }

  const allSignals = {};
  for (const filePath of specFiles) {
    const relPath = path.relative(path.resolve(__dirname, '..'), filePath).replace(/\\/g, '/');
    const signals = scanFile(filePath);
    if (signals) allSignals[relPath] = signals;
  }

  const routeToTests = buildRouteMap(allSignals);

  const output = {
    generatedAt    : new Date().toISOString(),
    scannedFiles   : specFiles.length,
    testSignals    : allSignals,
    routeToTests,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  process.stderr.write(`✅ Self-learning scan complete — ${specFiles.length} files, ${Object.keys(routeToTests).length} routes discovered\n`);
  for (const [route, tests] of Object.entries(routeToTests)) {
    process.stderr.write(`   ${route.padEnd(20)} → ${tests.map(t => path.basename(t)).join(', ')}\n`);
  }
}

main();
