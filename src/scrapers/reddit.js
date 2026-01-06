const axios = require('axios');
const path = require('path');
const fs = require('fs');

async function scrapeReddit() {
  const apifyToken = process.env.APIFY_TOKEN;

  if (!apifyToken) {
    console.log('[Reddit] Skipping Reddit scrape (no APIFY_TOKEN configured)');
    return [];
  }

  const configPath = path.join(__dirname, '..', '..', 'docs', 'config.json');
  let redditUrls = [];
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    redditUrls = config.reddit?.urls || [];
  } catch (err) {
    console.log('[Reddit] Could not load config.json');
    return [];
  }

  if (redditUrls.length === 0) {
    console.log('[Reddit] No Reddit URLs configured in config.json');
    return [];
  }

  try {
    console.log(`[Reddit] Starting Apify Reddit scraper for ${redditUrls.length} URLs...`);
    
    const runResponse = await axios.post(
      'https://api.apify.com/v2/acts/oAuCIx3ItNrs2okjQ/runs',
      {
        startUrls: redditUrls.map(url => ({ url })),
        maxItems: 30,
        maxPostCount: 10,
        maxComments: 0,
        skipComments: true,
        sort: 'new',
        time: 'day'
      },
      {
        params: { token: apifyToken },
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );

    const runId = runResponse.data.data.id;
    console.log(`[Reddit] Apify run started: ${runId}`);

    // Poll for completion (max 2 minutes)
    let runStatus = 'RUNNING';
    let datasetId = null;
    let attempts = 0;
    const maxAttempts = 24; // 24 * 5s = 2 minutes

    while (runStatus === 'RUNNING' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      attempts++;

      const statusResponse = await axios.get(
        `https://api.apify.com/v2/acts/oAuCIx3ItNrs2okjQ/runs/${runId}`,
        { params: { token: apifyToken } }
      );

      runStatus = statusResponse.data.data.status;
      datasetId = statusResponse.data.data.defaultDatasetId;
      console.log(`[Reddit] Run status: ${runStatus} (attempt ${attempts}/${maxAttempts})`);
    }

    if (runStatus !== 'SUCCEEDED') {
      console.error(`[Reddit] Apify run did not succeed: ${runStatus}`);
      return [];
    }

    if (!datasetId) {
      console.error('[Reddit] No dataset ID returned from Apify');
      return [];
    }

    // Get results from default dataset
    const datasetResponse = await axios.get(
      `https://api.apify.com/v2/datasets/${datasetId}/items`,
      { params: { token: apifyToken } }
    );

    const posts = datasetResponse.data
      .filter(post => post && post.title && (post.dataType === 'post' || !post.dataType))
      .map(post => {
        let timestamp;
        try {
          timestamp = post.createdAt ? new Date(post.createdAt).toISOString() : new Date().toISOString();
        } catch {
          timestamp = new Date().toISOString();
        }
        
        return {
          id: `reddit_${post.parsedId || post.id || Date.now()}`,
          source: 'reddit',
          author: post.username || post.author || 'unknown',
          content: post.title + (post.body ? `\n\n${post.body.substring(0, 500)}` : ''),
          url: post.url || post.link || `https://reddit.com${post.permalink || ''}`,
          timestamp,
          metadata: {
            score: post.upVotes || post.score || 0,
            num_comments: post.numberOfComments || post.numComments || 0,
            subreddit: post.parsedCommunityName || post.communityName || post.subreddit
          }
        };
      });

    console.log(`[Reddit] Successfully fetched ${posts.length} posts from Apify`);
    return posts;

  } catch (error) {
    console.error('[Reddit] Error with Apify scraper:', error.message);
    return [];
  }
}

module.exports = { scrapeReddit };
