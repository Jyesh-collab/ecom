#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Uploads E2E test screenshots and videos to JIRA issue
 */

async function uploadArtifactToJira(config) {
  const {
    jiraHost,
    jiraToken,
    issueKey,
    artifactPath,
    artifactType, // 'screenshot' or 'video'
  } = config;

  if (!fs.existsSync(artifactPath)) {
    console.log(`⚠️  Artifact not found: ${artifactPath}`);
    return null;
  }

  try {
    const fileData = fs.readFileSync(artifactPath);
    const fileName = path.basename(artifactPath);

    // Upload via JIRA REST API v3
    const response = await axios.post(
      `${jiraHost}/rest/api/3/issues/${issueKey}/attachments`,
      fileData,
      {
        headers: {
          Authorization: `Bearer ${jiraToken}`,
          'X-Atlassian-Token': 'no-check',
          'Content-Type': 'application/octet-stream',
          'X-Atlassian-Token': 'no-check',
          'filename': fileName,
        },
      }
    );

    console.log(`✅ Uploaded ${artifactType}: ${fileName} to ${issueKey}`);
    return response.data;

  } catch (error) {
    console.error(`❌ Failed to upload ${artifactType}:`, error.message);
    return null;
  }
}

async function main() {
  const jiraHost = process.env.JIRA_HOST;
  const jiraToken = process.env.JIRA_API_TOKEN;
  const issueKey = process.env.JIRA_ISSUE_KEY;

  if (!issueKey) {
    console.log('⚠️  No JIRA issue to attach artifacts to');
    return;
  }

  console.log(`📎 Uploading E2E artifacts to ${issueKey}...`);

  // Look for Playwright screenshots and videos
  const screenshotDir = 'test-results/screenshots';
  const videoDir = 'test-results/videos';

  if (fs.existsSync(screenshotDir)) {
    const screenshots = fs.readdirSync(screenshotDir).filter(f => 
      f.endsWith('.png') || f.endsWith('.jpg')
    );

    for (const screenshot of screenshots) {
      await uploadArtifactToJira({
        jiraHost,
        jiraToken,
        issueKey,
        artifactPath: path.join(screenshotDir, screenshot),
        artifactType: 'screenshot',
      });
    }
  }

  if (fs.existsSync(videoDir)) {
    const videos = fs.readdirSync(videoDir).filter(f => 
      f.endsWith('.webm') || f.endsWith('.mp4')
    );

    for (const video of videos.slice(0, 3)) { // Limit to 3 videos
      await uploadArtifactToJira({
        jiraHost,
        jiraToken,
        issueKey,
        artifactPath: path.join(videoDir, video),
        artifactType: 'video',
      });
    }
  }

  console.log('✅ Artifact upload complete');
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
