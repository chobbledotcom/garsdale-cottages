#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load environment variables
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [key, ...value] = line.split('=');
      if (key && value.length && !process.env[key]) {
        process.env[key] = value.join('=').trim();
      }
    });
}

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const CONFIG = {
  siteConfigPath: path.join(__dirname, '..', '_data', 'site.json'),
  reviewsDir: path.join(__dirname, '..', 'reviews'),
  actorId: 'nwua9Gu5YrADL7ZDj',
  maxReviews: 9999 // Fetch all available reviews
};

function formatFilename(name, date) {
  const safeName = (name || 'anonymous')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30);
  const safeDate = date instanceof Date && !isNaN(date)
    ? date.toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];
  return `${safeName}-google-${safeDate}.md`;
}

function makeApiRequest(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const request = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, response => {
      let responseData = '';
      response.on('data', chunk => responseData += chunk);
      response.on('end', () => {
        if (response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode}: ${responseData}`));
        } else {
          resolve(responseData);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });

    request.write(postData);
    request.end();
  });
}

async function fetchReviews(placeId, options = {}) {
  const url = `https://api.apify.com/v2/acts/${CONFIG.actorId}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}`;
  const data = {
    startUrls: [{ url: `https://www.google.com/maps/place/?q=place_id:${placeId}` }],
    maxReviews: options.maxReviews || CONFIG.maxReviews,
    reviewsSort: options.sort || 'newest',
    language: options.language || 'en'
  };

  console.log(`Fetching all available reviews...`);

  const response = await makeApiRequest(url, data);
  const results = JSON.parse(response);

  if (!Array.isArray(results)) {
    throw new Error('Invalid API response format');
  }

  return results
    .flatMap(item => item.reviews || [])
    .map(review => ({
      content: review.text || review.reviewText || '',
      date: review.publishedAtDate ? new Date(review.publishedAtDate) : new Date(),
      rating: review.stars || review.rating || 0,
      author: review.name || review.authorName || 'Anonymous',
      authorUrl: review.reviewerUrl || review.authorUrl || ''
    }))
    .filter(review => review.content.length > 5);
}

function saveReview(review, outputDir) {
  const filename = formatFilename(review.author, review.date);
  const filepath = path.join(outputDir, filename);

  if (fs.existsSync(filepath)) {
    return false; // Skip existing
  }

  const rating = review.rating || 5;
  const content = `---
name: ${review.author}
url: ${review.authorUrl}
rating: ${rating}
---

${review.content}
`;

  fs.writeFileSync(filepath, content);
  console.log(`✓ ${filename} (${rating}/5 stars)`);
  return true;
}

async function main() {
  // Validate requirements
  if (!APIFY_API_TOKEN) {
    console.error('Error: APIFY_API_TOKEN required in .env file');
    console.error('Get token: https://console.apify.com/account/integrations');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.siteConfigPath)) {
    console.error(`Error: ${CONFIG.siteConfigPath} not found`);
    process.exit(1);
  }

  const siteConfig = JSON.parse(fs.readFileSync(CONFIG.siteConfigPath, 'utf8'));
  if (!siteConfig.google_place_id) {
    console.error('Error: google_place_id missing from site.json');
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(CONFIG.reviewsDir, { recursive: true });

  try {
    // Fetch and save reviews
    const reviews = await fetchReviews(siteConfig.google_place_id);
    console.log(`Found ${reviews.length} reviews`);

    const saved = reviews.reduce((count, review) =>
      count + (saveReview(review, CONFIG.reviewsDir) ? 1 : 0), 0
    );

    console.log(`\nSaved ${saved} new reviews (${reviews.length - saved} already existed)`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}