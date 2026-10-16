#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exists, fs, loadEnv, path, write } from "./utils.js";

await loadEnv();

const CONFIG = {
  propertiesDir: path("properties"),
  reviewsDir: path("reviews"),
  actorId: "nwua9Gu5YrADL7ZDj",
  maxReviews: 9999,
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const PLACE_ID_RE = /^google_place_id:\s*(\S+)\s*$/m;

const readProperties = () =>
  readdirSync(CONFIG.propertiesDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const text = readFileSync(join(CONFIG.propertiesDir, f), "utf8");
      const frontmatter = FRONTMATTER_RE.exec(text)?.[1];
      const placeId = frontmatter && PLACE_ID_RE.exec(frontmatter)?.[1];
      if (!placeId) return null;
      return { slug: f.replace(/\.md$/, ""), placeId };
    })
    .filter(Boolean);

const emitStr = (s) =>
  /^[\w .,'&()-]+$/.test(s) ? s : JSON.stringify(s);

const formatFilename = (slug, name, date) => {
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 30);
  return `${slug}-${safeName}-google-${date.toISOString().split("T")[0]}.md`;
};

const fetchReviews = async (placeId) => {
  const url = `https://api.apify.com/v2/acts/${CONFIG.actorId}/run-sync-get-dataset-items?token=${process.env.APIFY_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startUrls: [
        { url: `https://www.google.com/maps/place/?q=place_id:${placeId}` },
      ],
      maxReviews: CONFIG.maxReviews,
      reviewsSort: "newest",
      language: "en",
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const results = await res.json();
  if (!Array.isArray(results)) throw new Error("Invalid API response format");

  return results
    .flatMap((item) => item.reviews || [])
    .map((r) => ({
      content: r.text || r.reviewText,
      date: new Date(r.publishedAtDate),
      rating: Number(r.stars),
      author: r.name || r.authorName,
      authorUrl: r.reviewerUrl || r.authorUrl,
    }))
    .filter((r) => r.content?.length > 5 && r.rating > 0);
};

const saveReview = async (slug, review) => {
  const filename = formatFilename(slug, review.author, review.date);
  const filepath = join(CONFIG.reviewsDir, filename);

  if (await exists(filepath)) return false;

  const frontmatter = [
    `property: properties/${slug}.md`,
    `name: ${emitStr(review.author)}`,
    review.authorUrl ? `url: ${review.authorUrl}` : null,
    `rating: ${review.rating}`,
    `date: ${review.date.toISOString().split("T")[0]}`,
  ]
    .filter(Boolean)
    .join("\n");

  await write(filepath, `---\n${frontmatter}\n---\n\n${review.content}\n`);

  console.log(`  ${filename} (${review.rating}/5 stars)`);
  return true;
};

const main = async () => {
  if (!process.env.APIFY_API_KEY) {
    console.error("Error: APIFY_API_KEY required (set in .env locally, or as a GitHub secret on CI)");
    console.error("Get one at: https://console.apify.com/account/integrations");
    process.exit(1);
  }

  const properties = readProperties();
  if (properties.length === 0) {
    console.log(`No properties with google_place_id in ${CONFIG.propertiesDir}`);
    return;
  }

  fs.mkdir(CONFIG.reviewsDir);

  let totalSaved = 0;
  let totalReviews = 0;

  for (const { slug, placeId } of properties) {
    const reviews = await fetchReviews(placeId);
    console.log(
      `${slug}: found ${reviews.length} review(s) for place ${placeId}`,
    );
    totalReviews += reviews.length;

    for (const review of reviews) {
      if (await saveReview(slug, review)) totalSaved += 1;
    }
  }

  console.log(
    `\nSaved ${totalSaved} new review(s) (${totalReviews - totalSaved} already existed)`,
  );
};

if (import.meta.main) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
