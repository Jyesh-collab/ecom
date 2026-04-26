#!/usr/bin/env node
/**
 * resolve-tests.js
 *
 * Uses Claude AI to read the PR git diff and intelligently select
 * the relevant Playwright E2E test files to run.
 *
 * Usage (called by GitHub Actions):
 *   echo "<changed files>" | node scripts/resolve-tests.js
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY   Anthropic API key
 *   BASE_SHA            Base commit SHA of the PR
 *   HEAD_SHA            Head commit SHA of the PR
 *
 * Output (stdout): space-separated list of test file paths
 */

const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

const AVAILABLE_TESTS = [
  'tests/e2e/auth.spec.js',
  'tests/e2e/products.spec.js',
  'tests/e2e/cart.spec.js',
  'tests/e2e/checkout.spec.js',
  'tests/e2e/search.spec.js',
];

const ALL_TESTS = AVAILABLE_TESTS.join(' ');

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write('ANTHROPIC_API_KEY not set — running all tests as fallback\n');
    process.stdout.write(ALL_TESTS + '\n');
    process.exit(0);
  }

  // Get changed files from stdin or env
  let changedFiles = '';
  try {
    changedFiles = require('fs').readFileSync('/dev/stdin', 'utf-8').trim();
  } catch {
    // stdin not available on Windows CI — use env var set by workflow
    changedFiles = (process.env.CHANGED_FILES || '').replace(/,/g, '\n').trim();
  }

  if (!changedFiles) {
    process.stderr.write('No changed files detected — running all tests\n');
    process.stdout.write(ALL_TESTS + '\n');
    process.exit(0);
  }

  // Get the actual git diff for richer context
  let gitDiff = '';
  const baseSha = process.env.BASE_SHA || '';
  const headSha = process.env.HEAD_SHA || '';
  if (baseSha && headSha) {
    try {
      gitDiff = execSync(
        `git diff ${baseSha} ${headSha} -- . ":(exclude)package-lock.json" ":(exclude)*.lock"`,
        { maxBuffer: 500 * 1024 } // 500 KB max
      ).toString();
      // Truncate if too large
      if (gitDiff.length > 80000) {
        gitDiff = gitDiff.slice(0, 80000) + '\n...[diff truncated]\n';
      }
    } catch (e) {
      process.stderr.write(`Could not get git diff: ${e.message}\n`);
    }
  }

  const client = new Anthropic({ apiKey });

  const prompt = `You are a QA engineer deciding which Playwright E2E tests to run for a pull request.

## Changed files in this PR
${changedFiles}

## Git diff (may be truncated)
\`\`\`diff
${gitDiff || '(diff not available — use changed file names above)'}
\`\`\`

## Available Playwright test files and what they cover
- tests/e2e/auth.spec.js       → Login, Registration, Password validation, Auth errors, Forgot password
- tests/e2e/products.spec.js   → Home page, Shop page, Product cards, Product detail page, Recommendations
- tests/e2e/cart.spec.js       → Add to cart, Cart badge, Cart page items, Totals, Checkout button, Empty cart
- tests/e2e/checkout.spec.js   → Checkout form, Field validation, Card validation, Expiry, Successful checkout
- tests/e2e/search.spec.js     → Search bar, Search results, Empty state, Keyword matching, Navigation logo

## Your task
Select ONLY the test files that are relevant to the changed code. Rules:
1. If auth routes, login/register components, JWT logic, or User model changed → include auth.spec.js
2. If product routes, product model, ProductCard, ProductDetail, recommendations, or Pinecone changed → include products.spec.js
3. If cart context, cart components, CartPage, or basket logic changed → include cart.spec.js
4. If checkout routes, CheckoutForm, payment validation, or order logic changed → include checkout.spec.js
5. If search routes, search components, NavigationBar, or search logic changed → include search.spec.js
6. If global config files changed (package.json, index.js, App.jsx, setupProxy, Docker, CI/CD, k8s) → include ALL tests
7. If only docs/README/comments changed → include NO tests (output empty string)
8. When uncertain whether a change affects a feature, INCLUDE that test (false positives are safer than false negatives)

Respond with ONLY a JSON object in this exact format — no explanation, no markdown:
{"tests": ["tests/e2e/auth.spec.js", "tests/e2e/products.spec.js"]}

Use an empty array if truly no tests are relevant: {"tests": []}`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 256,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract the text content (skip thinking blocks)
    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text in Claude response');

    const raw = textBlock.text.trim();

    // Parse JSON — Claude should return only JSON
    let parsed;
    try {
      // Handle case where Claude wraps in markdown code block
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      throw new Error(`Could not parse Claude response as JSON: ${raw}`);
    }

    const selected = (parsed.tests || []).filter(t => AVAILABLE_TESTS.includes(t));

    if (selected.length === 0) {
      process.stderr.write('Claude selected no tests — running full suite as safety fallback\n');
      process.stdout.write(ALL_TESTS + '\n');
    } else {
      process.stderr.write(`Claude selected: ${selected.join(', ')}\n`);
      process.stdout.write(selected.join(' ') + '\n');
    }
  } catch (err) {
    process.stderr.write(`Claude API error: ${err.message} — falling back to all tests\n`);
    process.stdout.write(ALL_TESTS + '\n');
  }
}

main();
