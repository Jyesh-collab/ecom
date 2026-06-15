#!/usr/bin/env node
/**
 * build-dependency-graph.js
 *
 * Scans all src/ files and builds a reverse dependency map:
 *   "which files import this changed file?"
 *
 * Rules (per CTO):
 *   - Max traversal depth: 2 levels
 *   - Ignores: .css, .svg, .png, .json, .md imports
 *   - Only scans: .js, .jsx files
 *   - Performance budget: must complete in < 5 seconds
 *
 * Usage:
 *   node scripts/build-dependency-graph.js src/components/ProductCard.jsx src/pages/Cart.jsx
 *
 * Output (JSON to stdout):
 *   {
 *     "src/components/ProductCard.jsx": {
 *       "directImporters": ["src/pages/Shop.jsx", "src/pages/Home.jsx"],
 *       "level2Importers": ["src/App.jsx"],
 *       "affectedPages": ["Shop.jsx", "Home.jsx"],
 *       "affectedComponents": ["ProductListing.jsx"]
 *     }
 *   }
 */

const fs   = require('fs');
const path = require('path');

const SRC_DIR    = path.resolve(__dirname, '../src');
const IGNORE_EXT = new Set(['.css', '.svg', '.png', '.jpg', '.json', '.md', '.txt', '.ico']);

// ─── Step 1: Collect all JS/JSX files in src/ ────────────────────────────────
function collectSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip test folders and dev folders
      if (['node_modules', '__tests__', 'dev'].includes(entry.name)) continue;
      files.push(...collectSourceFiles(full));
    } else if (['.js', '.jsx'].includes(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

// ─── Step 2: Parse imports from a file ───────────────────────────────────────
function parseImports(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const imports = [];
  // Match: import ... from '...' or require('...')
  const patterns = [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const imp = match[1];
      // Skip non-relative imports (node_modules) and ignored extensions
      if (!imp.startsWith('.')) continue;
      const ext = path.extname(imp);
      if (IGNORE_EXT.has(ext)) continue;
      imports.push(imp);
    }
  }
  return imports;
}

// ─── Step 3: Resolve import path to absolute path ────────────────────────────
function resolveImport(fromFile, importPath) {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, importPath);

  // Try with extensions
  for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx', '']) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ─── Step 4: Build forward map (file → what it imports) ──────────────────────
function buildForwardMap(sourceFiles) {
  const map = {}; // file → [imported files]
  for (const file of sourceFiles) {
    const imports = parseImports(file);
    map[file] = imports
      .map(imp => resolveImport(file, imp))
      .filter(Boolean);
  }
  return map;
}

// ─── Step 5: Build reverse map (file → who imports it) ───────────────────────
function buildReverseMap(forwardMap) {
  const reverse = {}; // file → [files that import it]
  for (const [importer, imports] of Object.entries(forwardMap)) {
    for (const imported of imports) {
      if (!reverse[imported]) reverse[imported] = [];
      if (!reverse[imported].includes(importer)) {
        reverse[imported].push(importer);
      }
    }
  }
  return reverse;
}

// ─── Step 6: Get importers up to depth 2 ─────────────────────────────────────
function getImporters(changedFile, reverseMap, maxDepth = 2) {
  const absChanged = path.resolve(process.cwd(), changedFile);
  const level1 = reverseMap[absChanged] || [];
  const level2 = [];

  for (const l1 of level1) {
    const l2importers = reverseMap[l1] || [];
    for (const l2 of l2importers) {
      if (!level1.includes(l2) && l2 !== absChanged && !level2.includes(l2)) {
        level2.push(l2);
      }
    }
  }

  return { level1, level2 };
}

// ─── Step 7: Categorize into pages vs components ─────────────────────────────
function categorize(files) {
  const pages      = [];
  const components = [];
  const other      = [];

  for (const f of files) {
    // Normalize to forward slashes for cross-platform compatibility
    const rel = path.relative(SRC_DIR, f).replace(/\\/g, '/');
    if (rel.startsWith('pages/'))           pages.push(path.basename(f));
    else if (rel.startsWith('components/')) components.push(path.basename(f));
    else other.push(path.basename(f));
  }
  return { pages, components, other };
}

const ALL_TESTS = [
  'tests/e2e/auth.spec.js',
  'tests/e2e/products.spec.js',
  'tests/e2e/cart.spec.js',
  'tests/e2e/checkout.spec.js',
  'tests/e2e/search.spec.js',
];

// Files that are global — any change here affects everything
const GLOBAL_FILES = new Set([
  'App.jsx', 'index.js', 'apiClient.js', 'setupProxy.js',
  'NavigationBar.jsx', // appears on every page via App layout
]);

// Backend route → test mapping
const BACKEND_ROUTE_MAP = {
  'auth.js':     'tests/e2e/auth.spec.js',
  'products.js': 'tests/e2e/products.spec.js',
  'cart.js':     'tests/e2e/cart.spec.js',
  'checkout.js': 'tests/e2e/checkout.spec.js',
  'search.js':   'tests/e2e/search.spec.js',
};

// Backend model → test mapping
const BACKEND_MODEL_MAP = {
  'user.js':    'tests/e2e/auth.spec.js',
  'product.js': 'tests/e2e/products.spec.js',
  'order.js':   'tests/e2e/checkout.spec.js',
};

// Keyword fallback for files with no structural mapping
const KEYWORD_MAP = [
  { keywords: ['auth', 'login', 'register', 'password', 'user', 'jwt'], test: 'tests/e2e/auth.spec.js' },
  { keywords: ['product', 'shop', 'home', 'recommendation', 'pinecone'], test: 'tests/e2e/products.spec.js' },
  { keywords: ['cart', 'basket', 'shopping'],                             test: 'tests/e2e/cart.spec.js' },
  { keywords: ['checkout', 'payment', 'order', 'billing'],               test: 'tests/e2e/checkout.spec.js' },
  { keywords: ['search', 'navigation', 'navbar'],                         test: 'tests/e2e/search.spec.js' },
];

// ─── Self-learning: PAGE_TO_ROUTE bridge ─────────────────────────────────────
// Maps component filenames to their URL routes.
// This is stable architectural truth — Cart.jsx lives at /cart.
// The other half (route → which test covers it) is auto-discovered by scan-test-patterns.js.
const PAGE_TO_ROUTE = {
  'Login.jsx':          '/login',
  'Register.jsx':       '/register',
  'ForgotPassword.jsx': '/forgot-password',
  'ResetPassword.jsx':  '/reset-password',
  'Home.jsx':           '/',
  'Shop.jsx':           '/shop',
  'ProductDetails.jsx': '/product',
  'Cart.jsx':           '/cart',
  'ShoppingCart.jsx':   '/cart',
  'Checkout.jsx':       '/checkout',
  'CheckoutForm.jsx':   '/checkout',
  'NavigationBar.jsx':  '/',
  'SearchResults.jsx':  '/search',
};

// ─── Load auto-discovered route → test map ────────────────────────────────────
function loadRouteMap() {
  const mapPath = path.resolve(__dirname, 'test-route-map.json');
  try {
    const data = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    process.stderr.write(`📖 Loaded self-learning route map (generated ${data.generatedAt?.slice(0, 10) || 'unknown'})\n`);
    return data.routeToTests || {};
  } catch {
    process.stderr.write('⚠️  test-route-map.json not found — running scanner now...\n');
    // Try to auto-generate the route map on first use
    try {
      const { execSync } = require('child_process');
      execSync(`node "${path.resolve(__dirname, 'scan-test-patterns.js')}"`, {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      const data = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
      return data.routeToTests || {};
    } catch {
      process.stderr.write('⚠️  Auto-scan failed — falling back to hardcoded map\n');
      return null;
    }
  }
}

// ─── Build PAGE_TEST_MAP from auto-discovered route map ───────────────────────
function buildPageTestMap(routeToTests) {
  // Hardcoded fallback used only when scan-test-patterns.js has never run
  if (!routeToTests) {
    return {
      'Login.jsx':          ['tests/e2e/auth.spec.js'],
      'Register.jsx':       ['tests/e2e/auth.spec.js'],
      'ForgotPassword.jsx': ['tests/e2e/auth.spec.js'],
      'ResetPassword.jsx':  ['tests/e2e/auth.spec.js'],
      'Home.jsx':           ['tests/e2e/products.spec.js'],
      'Shop.jsx':           ['tests/e2e/products.spec.js'],
      'ProductDetails.jsx': ['tests/e2e/products.spec.js'],
      'Cart.jsx':           ['tests/e2e/cart.spec.js'],
      'ShoppingCart.jsx':   ['tests/e2e/cart.spec.js'],
      'Checkout.jsx':       ['tests/e2e/checkout.spec.js'],
      'CheckoutForm.jsx':   ['tests/e2e/checkout.spec.js'],
      'NavigationBar.jsx':  ['tests/e2e/search.spec.js'],
      'SearchResults.jsx':  ['tests/e2e/search.spec.js'],
    };
  }

  const map = {};
  for (const [page, route] of Object.entries(PAGE_TO_ROUTE)) {
    const direct = routeToTests[route] || [];
    // Also capture partial matches: /product covers /product/:id
    const partial = Object.entries(routeToTests)
      .filter(([r]) => r !== route && r.startsWith(route + '/'))
      .flatMap(([, t]) => t);
    const merged = [...new Set([...direct, ...partial])];
    if (merged.length > 0) map[page] = merged;
  }

  return map;
}

// ─── Step 8: Map pages to test files ─────────────────────────────────────────
function mapToTests(affectedPages, changedFile) {
  const tests    = new Set();
  const basename = path.basename(changedFile);
  const relNorm  = changedFile.replace(/\\/g, '/');

  // Global files — any change triggers the full suite
  if (GLOBAL_FILES.has(basename)) {
    return ALL_TESTS;
  }

  // Backend route files
  if (relNorm.includes('backend/routes/') && BACKEND_ROUTE_MAP[basename]) {
    return [BACKEND_ROUTE_MAP[basename]];
  }

  // Backend model files
  if (relNorm.includes('backend/models/') && BACKEND_MODEL_MAP[basename]) {
    return [BACKEND_MODEL_MAP[basename]];
  }

  // Self-learning: build PAGE_TEST_MAP from scanned route map
  const routeToTests = loadRouteMap();
  const PAGE_TEST_MAP = buildPageTestMap(routeToTests);

  const addTests = (t) => {
    if (Array.isArray(t)) t.forEach(x => tests.add(x));
    else if (t) tests.add(t);
  };

  // Map affected pages from dependency graph
  for (const page of affectedPages) {
    addTests(PAGE_TEST_MAP[page]);
  }

  // Map the changed file itself
  addTests(PAGE_TEST_MAP[basename]);

  // Keyword fallback for unmapped files
  if (tests.size === 0) {
    const lowerName = basename.toLowerCase();
    for (const { keywords, test } of KEYWORD_MAP) {
      if (keywords.some(k => lowerName.includes(k))) {
        tests.add(test);
        break;
      }
    }
  }

  return [...tests];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const changedFiles = process.argv.slice(2);

  if (changedFiles.length === 0) {
    process.stderr.write('Usage: node build-dependency-graph.js <file1> [file2] ...\n');
    process.exit(1);
  }

  const start = Date.now();

  // Build the full graph once
  const sourceFiles = collectSourceFiles(SRC_DIR);
  const forwardMap  = buildForwardMap(sourceFiles);
  const reverseMap  = buildReverseMap(forwardMap);

  const result = {};

  for (const changedFile of changedFiles) {
    const absFile = path.resolve(process.cwd(), changedFile);

    // Handle backend files — use route/model map directly
    if (!absFile.includes(SRC_DIR)) {
      const suggestedTests = mapToTests([], changedFile);
      result[changedFile] = {
        directImporters: [],
        level2Importers: [],
        affectedPages: [],
        affectedComponents: [],
        suggestedTests,
        note: suggestedTests.length
          ? `Backend file — mapped via route/model rules`
          : 'File outside src/ — no test mapping found',
      };
      continue;
    }

    const { level1, level2 } = getImporters(changedFile, reverseMap);
    const { pages: l1Pages, components: l1Comps } = categorize(level1);
    const { pages: l2Pages }                       = categorize(level2);

    const allAffectedPages = [...new Set([...l1Pages, ...l2Pages])];
    const suggestedTests   = mapToTests(allAffectedPages, changedFile);

    result[changedFile] = {
      directImporters:   level1.map(f => path.relative(path.resolve(__dirname, '..'), f)),
      level2Importers:   level2.map(f => path.relative(path.resolve(__dirname, '..'), f)),
      affectedPages:     allAffectedPages,
      affectedComponents: l1Comps,
      suggestedTests,
    };
  }

  const elapsed = Date.now() - start;
  process.stderr.write(`✅ Dependency graph built in ${elapsed}ms\n`);

  if (elapsed > 5000) {
    process.stderr.write(`⚠️  Performance budget exceeded (${elapsed}ms > 5000ms)\n`);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
