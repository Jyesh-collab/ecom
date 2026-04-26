#!/usr/bin/env node
/**
 * resolve-tests.js
 *
 * Uses Claude AI via OpenRouter to analyse the PR git diff and
 * intelligently select the relevant Playwright E2E test files to run.
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

const https = require('https');
const { execSync } = require('child_process');

const AVAILABLE_TESTS = [
  'tests/e2e/auth.spec.js',
  'tests/e2e/products.spec.js',
  'tests/e2e/cart.spec.js',
  'tests/e2e/checkout.spec.js',
  'tests/e2e/search.spec.js',
];

const ALL_TESTS = AVAILABLE_TESTS.join(' ');

function callOpenRouter(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'anthropic/claude-3.5-haiku',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
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
        'X-Title': 'Smart PR Testing Pipeline',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`OpenRouter returned ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    process.stderr.write('\n❌ OPENROUTER_API_KEY is not set.\n');
    process.stderr.write('Add it as a GitHub secret: Settings → Secrets → OPENROUTER_API_KEY\n\n');
    process.exit(1);
  }

  // Get changed files from stdin or env
  let changedFiles = '';
  try {
    changedFiles = require('fs').readFileSync('/dev/stdin', 'utf-8').trim();
  } catch {
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
        { maxBuffer: 500 * 1024 }
      ).toString();
      if (gitDiff.length > 80000) {
        gitDiff = gitDiff.slice(0, 80000) + '\n...[diff truncated]\n';
      }
    } catch (e) {
      process.stderr.write(`Could not get git diff: ${e.message}\n`);
    }
  }

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
Select ONLY the test files relevant to the changed code. Rules:
1. Auth routes, login/register components, JWT, User model changed → auth.spec.js
2. Product routes, ProductCard, ProductDetail, recommendations, Pinecone changed → products.spec.js
3. Cart context, cart components, CartPage changed → cart.spec.js
4. Checkout routes, CheckoutForm, payment validation changed → checkout.spec.js
5. Search routes, search components, NavigationBar changed → search.spec.js
6. Global config changed (package.json, index.js, App.jsx, Docker, CI/CD) → ALL tests
7. Only docs/README/comments changed → empty array
8. When uncertain, INCLUDE the test (false positives safer than false negatives)

Respond with ONLY a JSON object — no explanation, no markdown:
{"tests": ["tests/e2e/auth.spec.js"]}`;

  process.stderr.write('🤖 Calling Claude AI via OpenRouter to analyse diff and select tests...\n');

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

    const selected = (parsed.tests || []).filter(t => AVAILABLE_TESTS.includes(t));

    if (selected.length === 0) {
      process.stderr.write('⚠️  Claude selected no tests — running full suite as safety net\n');
      process.stdout.write(ALL_TESTS + '\n');
    } else {
      process.stderr.write(`✅ Claude selected: ${selected.join(', ')}\n`);
      process.stdout.write(selected.join(' ') + '\n');
    }

    process.exit(0);

  } catch (err) {
    process.stderr.write('\n❌ AI Test Intelligence Gate FAILED\n');
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
