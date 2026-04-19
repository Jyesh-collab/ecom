#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Generates a comprehensive HTML report for the test run
 * Includes: Test results, PR health, screenshots, videos, JIRA links
 */

function generateHTMLReport(config) {
  const {
    prNumber,
    prTitle,
    prAuthor,
    impactScore,
    frontendResults,
    backendResults,
    e2eResults,
    failuresFound,
    jiraIssues,
    artifactsPath,
  } = config;

  // Calculate PR health score (0-100)
  const totalTests = 
    (frontendResults?.total || 0) + 
    (backendResults?.total || 0) + 
    (e2eResults?.total || 0);
  
  const totalPassed = 
    (frontendResults?.passed || 0) + 
    (backendResults?.passed || 0) + 
    (e2eResults?.passed || 0);
  
  const totalFailed = 
    (frontendResults?.failed || 0) + 
    (backendResults?.failed || 0) + 
    (e2eResults?.failed || 0);

  const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
  const healthScore = Math.round((passRate * 0.7) + ((100 - impactScore) * 0.3));

  // Color coding for health score
  let healthColor = '#28a745'; // green
  let healthEmoji = '🟢';
  if (healthScore < 50) {
    healthColor = '#dc3545'; // red
    healthEmoji = '🔴';
  } else if (healthScore < 75) {
    healthColor = '#ffc107'; // yellow
    healthEmoji = '🟡';
  }

  // Color coding for test results
  const getTestColor = (passed, failed) => {
    if (failed === 0 && passed === 0) return '#6c757d'; // gray (skipped)
    if (failed === 0) return '#28a745'; // green
    return '#dc3545'; // red
  };

  const getTestStatus = (passed, failed, total) => {
    if (total === 0) return '<span style="color: #6c757d;">⏭️ Skipped</span>';
    if (failed === 0) return `<span style="color: #28a745;">✅ ${passed}/${total} passed</span>`;
    return `<span style="color: #dc3545;">❌ ${failed} failed, ${passed} passed</span>`;
  };

  // Build JIRA links section
  let jiraSection = '';
  if (jiraIssues && jiraIssues.length > 0) {
    jiraSection = `
      <div style="margin-top: 20px; padding: 15px; background-color: #fff3cd; border-left: 4px solid #ffc107;">
        <h3>🐛 Detected Issues (JIRA)</h3>
        <ul>
          ${jiraIssues.map(issue => `<li><strong>${issue.key}</strong>: ${issue.summary}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PR #${prNumber} - Test Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        .health-score {
            display: inline-block;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: white;
            color: ${healthColor};
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-size: 2em;
            font-weight: bold;
            margin-top: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .health-label {
            font-size: 0.8em;
            color: #666;
            margin-top: 5px;
        }
        .content {
            padding: 40px;
        }
        .pr-info {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #667eea;
        }
        .pr-info h2 {
            font-size: 1.3em;
            margin-bottom: 10px;
            color: #333;
        }
        .pr-info p {
            color: #666;
            margin: 5px 0;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .summary-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            border-top: 4px solid #667eea;
        }
        .summary-card h3 {
            margin-bottom: 15px;
            color: #333;
            font-size: 1.1em;
        }
        .summary-card .metric {
            display: flex;
            justify-content: space-between;
            margin: 10px 0;
            padding: 8px 0;
            border-bottom: 1px solid #e0e0e0;
        }
        .summary-card .metric:last-child {
            border-bottom: none;
        }
        .metric-label {
            color: #666;
            font-weight: 500;
        }
        .metric-value {
            font-weight: bold;
            font-size: 1.1em;
        }
        .test-suite {
            margin-bottom: 30px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
        }
        .test-suite-header {
            background: #f8f9fa;
            padding: 15px 20px;
            border-bottom: 1px solid #e0e0e0;
            font-weight: bold;
            font-size: 1.1em;
        }
        .test-suite-body {
            padding: 20px;
        }
        .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .status-passed {
            background: #d4edda;
            color: #155724;
        }
        .status-failed {
            background: #f8d7da;
            color: #721c24;
        }
        .status-skipped {
            background: #e2e3e5;
            color: #383d41;
        }
        .detailed-results {
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .detailed-results h2 {
            margin-bottom: 20px;
            color: #333;
        }
        .result-item {
            background: white;
            padding: 15px;
            margin: 10px 0;
            border-radius: 6px;
            border-left: 4px solid #e0e0e0;
        }
        .result-item.passed {
            border-left-color: #28a745;
        }
        .result-item.failed {
            border-left-color: #dc3545;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px;
            text-align: center;
            color: #666;
            font-size: 0.9em;
            border-top: 1px solid #e0e0e0;
        }
        .timestamp {
            color: #999;
            font-size: 0.85em;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${healthEmoji} PR #${prNumber} Test Report</h1>
            <p>${prTitle}</p>
            <div class="health-score">
                ${healthScore}%
                <div class="health-label">PR Health</div>
            </div>
        </div>

        <div class="content">
            <div class="pr-info">
                <h2>Pull Request Information</h2>
                <p><strong>Number:</strong> #${prNumber}</p>
                <p><strong>Title:</strong> ${prTitle}</p>
                <p><strong>Author:</strong> ${prAuthor}</p>
                <p><strong>Impact Score:</strong> ${impactScore}/100</p>
            </div>

            <div class="summary-grid">
                <div class="summary-card">
                    <h3>📊 Overall Statistics</h3>
                    <div class="metric">
                        <span class="metric-label">Total Tests:</span>
                        <span class="metric-value">${totalTests}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Passed:</span>
                        <span class="metric-value" style="color: #28a745;">${totalPassed}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Failed:</span>
                        <span class="metric-value" style="color: #dc3545;">${totalFailed}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Pass Rate:</span>
                        <span class="metric-value">${passRate}%</span>
                    </div>
                </div>

                <div class="summary-card">
                    <h3>🎨 Frontend Tests</h3>
                    <div class="metric">
                        <span class="metric-label">Status:</span>
                        <span>${getTestStatus(frontendResults?.passed || 0, frontendResults?.failed || 0, frontendResults?.total || 0)}</span>
                    </div>
                    ${frontendResults?.total > 0 ? `
                    <div class="metric">
                        <span class="metric-label">Passed:</span>
                        <span class="metric-value">${frontendResults.passed}/${frontendResults.total}</span>
                    </div>
                    ` : ''}
                </div>

                <div class="summary-card">
                    <h3>⚙️ Backend Tests</h3>
                    <div class="metric">
                        <span class="metric-label">Status:</span>
                        <span>${getTestStatus(backendResults?.passed || 0, backendResults?.failed || 0, backendResults?.total || 0)}</span>
                    </div>
                    ${backendResults?.total > 0 ? `
                    <div class="metric">
                        <span class="metric-label">Passed:</span>
                        <span class="metric-value">${backendResults.passed}/${backendResults.total}</span>
                    </div>
                    ` : ''}
                </div>

                <div class="summary-card">
                    <h3>🎭 E2E Tests</h3>
                    <div class="metric">
                        <span class="metric-label">Status:</span>
                        <span>${getTestStatus(e2eResults?.passed || 0, e2eResults?.failed || 0, e2eResults?.total || 0)}</span>
                    </div>
                    ${e2eResults?.total > 0 ? `
                    <div class="metric">
                        <span class="metric-label">Passed:</span>
                        <span class="metric-value">${e2eResults.passed}/${e2eResults.total}</span>
                    </div>
                    ` : ''}
                </div>
            </div>

            ${failuresFound ? `
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: #856404; margin-bottom: 10px;">⚠️ Test Failures Detected</h3>
                <p style="color: #856404;">Review the details below and check JIRA for more information.</p>
            </div>
            ` : `
            <div style="background: #d4edda; border: 1px solid #28a745; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: #155724; margin-bottom: 10px;">✅ All Tests Passed!</h3>
                <p style="color: #155724;">No issues detected in this PR.</p>
            </div>
            `}

            ${jiraSection}

            <div class="footer">
                <p>Generated: <span class="timestamp">${new Date().toLocaleString()}</span></p>
                <p>🤖 AI-Powered Smart Testing Pipeline</p>
            </div>
        </div>
    </div>
</body>
</html>
  `;

  return html;
}

// Main execution
async function main() {
  try {
    // Read environment variables and test results
    const prNumber = process.env.PR_NUMBER || '1';
    const prTitle = process.env.PR_TITLE || 'Test PR';
    const prAuthor = process.env.PR_AUTHOR || 'Unknown';
    const impactScore = parseInt(process.env.IMPACT_SCORE || '0');
    const failuresFound = process.env.FAILURES_FOUND === 'true';
    const jiraIssuesJson = process.env.JIRA_ISSUES || '[]';

    // Parse test results
    let frontendResults = { passed: 0, failed: 0, total: 0 };
    let backendResults = { passed: 0, failed: 0, total: 0 };
    let e2eResults = { passed: 0, failed: 0, total: 0 };

    if (fs.existsSync('test-results-frontend.json')) {
      const data = JSON.parse(fs.readFileSync('test-results-frontend.json', 'utf8'));
      frontendResults = {
        passed: data.numPassedTests || 0,
        failed: data.numFailedTests || 0,
        total: data.numTotalTests || 0,
      };
    }

    if (fs.existsSync('test-results-backend.json')) {
      const data = JSON.parse(fs.readFileSync('test-results-backend.json', 'utf8'));
      backendResults = {
        passed: data.numPassedTests || 0,
        failed: data.numFailedTests || 0,
        total: data.numTotalTests || 0,
      };
    }

    if (fs.existsSync('e2e-results.json')) {
      const data = JSON.parse(fs.readFileSync('e2e-results.json', 'utf8'));
      const allTests = data.suites ? data.suites.flatMap(s => s.tests || []) : [];
      e2eResults = {
        passed: allTests.filter(t => t.pass).length,
        failed: allTests.filter(t => !t.pass).length,
        total: allTests.length,
      };
    }

    // Parse JIRA issues
    let jiraIssues = [];
    try {
      jiraIssues = JSON.parse(jiraIssuesJson);
    } catch (e) {
      jiraIssues = [];
    }

    // Generate HTML
    const html = generateHTMLReport({
      prNumber,
      prTitle,
      prAuthor,
      impactScore,
      frontendResults,
      backendResults,
      e2eResults,
      failuresFound,
      jiraIssues,
    });

    // Create output directory
    const outputDir = 'test-report-html';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write HTML file
    fs.writeFileSync(path.join(outputDir, 'index.html'), html);
    console.log(`✅ HTML report generated: ${outputDir}/index.html`);

  } catch (error) {
    console.error('❌ Error generating report:', error);
    process.exit(1);
  }
}

main();
