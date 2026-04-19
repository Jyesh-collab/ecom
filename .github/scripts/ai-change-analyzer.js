/**
 * AI Change Analyzer
 * Reads the changes in a PR and intelligently picks which tests should run
 * 
 * This is STEP 1: AI reads the change
 */

const { OpenAI } = require('openai');
const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyze code changes and determine which tests to run
 * @param {string[]} changedFiles - List of changed files
 * @returns {Object} Analysis with tests to run and skip
 */
async function analyzeChanges(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    return {
      impactScore: 0,
      testsToRun: ['frontend', 'backend', 'e2e'],
      testsToSkip: [],
      reasoning: 'No files changed - running all tests',
    };
  }

  // Read file content for context
  const fileContexts = await Promise.all(
    changedFiles.slice(0, 10).map(async (file) => {
      try {
        const content = fs.readFileSync(file, 'utf8').substring(0, 500);
        return { file, preview: content };
      } catch (e) {
        return { file, preview: '[file not readable]' };
      }
    })
  );

  const prompt = `
You are a smart QA system. Analyze these code changes and determine:
1. Impact score (0-100): How risky is this change?
2. Which test suites should run: frontend, backend, e2e
3. Which tests can be skipped: if they're definitely not affected
4. Reasoning

Changed files:
${changedFiles.join('\n')}

File previews:
${fileContexts.map((f) => `${f.file}:\n${f.preview}`).join('\n---\n')}

Respond in JSON format:
{
  "impactScore": 0-100,
  "testsToRun": ["frontend"|"backend"|"e2e"],
  "testsToSkip": ["frontend"|"backend"|"e2e"],
  "reasoning": "explanation"
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
    console.log('🤖 AI Change Analysis:');
    console.log(`  Impact Score: ${analysis.impactScore}/100`);
    console.log(`  Tests to Run: ${analysis.testsToRun.join(', ')}`);
    console.log(`  Tests to Skip: ${analysis.testsToSkip.join(', ') || 'none'}`);
    console.log(`  Reasoning: ${analysis.reasoning}`);

    return analysis;
  } catch (error) {
    console.error('❌ AI analysis failed:', error.message);
    // Fallback: run all tests
    return {
      impactScore: 100,
      testsToRun: ['frontend', 'backend', 'e2e'],
      testsToSkip: [],
      reasoning: 'AI analysis failed - running all tests for safety',
    };
  }
}

module.exports = { analyzeChanges };
