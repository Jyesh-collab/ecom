/**
 * AI Failure Analyzer
 * Analyzes test failures and automatically files JIRA bugs
 * 
 * This is STEP 5: AI files bugs
 */

const { OpenAI } = require('openai');
const axios = require('axios');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyze test failures and create JIRA issues
 * @param {Object} testResults - Test results from all suites
 * @param {Object} config - JIRA configuration
 * @returns {Object} Analysis results
 */
async function analyzeAndFileIssues(testResults, config) {
  const failures = collectFailures(testResults);

  if (failures.length === 0) {
    return {
      failuresFound: false,
      jiraIssue: null,
      summary: 'All tests passed! ✅',
    };
  }

  // AI analyzes each failure
  const analyzedFailures = await Promise.all(
    failures.map((failure) => analyzeFailure(failure))
  );

  // Cluster similar failures
  const clusters = clusterFailures(analyzedFailures);

  // File JIRA issue for each cluster
  const jiraIssues = [];
  for (const cluster of clusters) {
    const issue = await fileJiraIssue(cluster, config);
    if (issue) {
      jiraIssues.push(issue);
    }
  }

  return {
    failuresFound: true,
    jiraIssues: jiraIssues,
    jiraIssue: jiraIssues[0] || null,
    summary: {
      totalFailures: failures.length,
      clusters: clusters.length,
      jiraIssuesCreated: jiraIssues.length,
      issueKeys: jiraIssues.map((i) => i.key),
    },
  };
}

/**
 * Collect all failures from test results
 */
function collectFailures(testResults) {
  const failures = [];

  // Frontend failures
  if (testResults.frontend?.testResults) {
    testResults.frontend.testResults.forEach((suite) => {
      suite.assertionResults?.forEach((result) => {
        if (!result.status === 'passed') {
          failures.push({
            suite: 'frontend',
            test: result.title,
            error: result.failureMessages?.[0] || 'Unknown error',
            file: suite.name,
          });
        }
      });
    });
  }

  // Backend failures
  if (testResults.backend?.testResults) {
    testResults.backend.testResults.forEach((suite) => {
      suite.assertionResults?.forEach((result) => {
        if (!result.status === 'passed') {
          failures.push({
            suite: 'backend',
            test: result.title,
            error: result.failureMessages?.[0] || 'Unknown error',
            file: suite.name,
          });
        }
      });
    });
  }

  // E2E failures
  if (testResults.e2e?.suites) {
    testResults.e2e.suites.forEach((suite) => {
      suite.tests?.forEach((test) => {
        if (!test.pass) {
          failures.push({
            suite: 'e2e',
            test: test.title,
            error: test.err?.message || 'Unknown error',
            file: suite.title,
          });
        }
      });
    });
  }

  return failures;
}

/**
 * Analyze a single failure with AI
 */
async function analyzeFailure(failure) {
  const prompt = `
Analyze this test failure and provide:
1. Root cause (logic bug, flaky test, environment issue, missing setup)
2. Severity (critical, high, medium, low)
3. Affected component
4. Quick fix suggestion
5. Priority (P0-P3)

Test: ${failure.test}
File: ${failure.file}
Error: ${failure.error}

Respond in JSON:
{
  "rootCause": "...",
  "category": "logic_bug|flaky_test|environment|configuration|missing_dependency|other",
  "severity": "critical|high|medium|low",
  "affectedComponent": "...",
  "fixSuggestion": "...",
  "priority": "P0|P1|P2|P3"
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    return {
      ...failure,
      ...analysis,
    };
  } catch (error) {
    console.error('❌ Failed to analyze failure:', error.message);
    return {
      ...failure,
      rootCause: 'Test failure (auto-analysis failed)',
      category: 'other',
      severity: 'high',
      affectedComponent: failure.file,
      fixSuggestion: 'Review test and implementation',
      priority: 'P2',
    };
  }
}

/**
 * Cluster similar failures
 */
function clusterFailures(failures) {
  const clusters = [];
  const grouped = {};

  // Group by category and component
  failures.forEach((failure) => {
    const key = `${failure.category}-${failure.affectedComponent}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(failure);
  });

  // Create clusters
  Object.entries(grouped).forEach(([key, failures]) => {
    clusters.push({
      category: failures[0].category,
      component: failures[0].affectedComponent,
      severity: failures[0].severity,
      priority: failures[0].priority,
      failures: failures,
      description: generateClusterDescription(failures),
    });
  });

  return clusters;
}

/**
 * Generate description for failure cluster
 */
function generateClusterDescription(failures) {
  const testNames = failures.map((f) => `- ${f.test}`).join('\n');
  const rootCauses = [...new Set(failures.map((f) => f.rootCause))];

  return `
## Failed Tests
${testNames}

## Root Causes
${rootCauses.map((c) => `- ${c}`).join('\n')}

## First Error
${failures[0].error}

## Suggested Fix
${failures[0].fixSuggestion}
`;
}

/**
 * File JIRA issue for failure cluster
 */
async function fileJiraIssue(cluster, config) {
  if (!config.jiraHost || !config.jiraToken || !config.jiraProject) {
    console.warn('⚠️  JIRA credentials not configured - skipping issue creation');
    return null;
  }

  const severityMap = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
  };

  const priorityMap = {
    P0: 1,
    P1: 2,
    P2: 3,
    P3: 4,
  };

  const issue = {
    fields: {
      project: { key: config.jiraProject },
      summary: `[${cluster.category.toUpperCase()}] ${cluster.component} - ${cluster.failures.length} test failure(s)`,
      description: cluster.description,
      issuetype: { name: 'Bug' },
      priority: { id: String(priorityMap[cluster.priority] || 3) },
      labels: [
        'automated-test',
        'ai-analyzed',
        `pr-${config.prNumber}`,
        cluster.category,
        'test-failure',
      ],
    },
  };

  try {
    const response = await axios.post(
      `${config.jiraHost}/rest/api/3/issues`,
      issue,
      {
        headers: {
          Authorization: `Bearer ${config.jiraToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`✅ JIRA Issue Created: ${response.data.key}`);
    return {
      key: response.data.key,
      url: `${config.jiraHost}/browse/${response.data.key}`,
      category: cluster.category,
    };
  } catch (error) {
    console.error('❌ Failed to create JIRA issue:', error.response?.data || error.message);
    return null;
  }
}

module.exports = { analyzeAndFileIssues };
