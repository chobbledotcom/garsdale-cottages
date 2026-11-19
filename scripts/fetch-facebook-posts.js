#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  apifyActorUrl,
  postApifyDataset,
  requireApifyKey,
} from "./apify-utils.js";
import { parseArgv, runCli } from "./cli-utils.js";
import { exists, fs, loadEnv, path, readJson, write } from "./utils.js";

const CONFIG = {
  siteConfig: path("_data", "site.json"),
  postsDir: path("social-posts"),
  imagesDir: path("images", "facebook-posts"),
  actorId: "KoJrdxJCTtpon81KY",
  resultsLimit: 8,
};

const getImageUrl = (post) => {
  const media = post.media?.[0];
  return (
    post.fullPicture ||
    post.image ||
    post.displayUrl ||
    media?.photo_image?.uri ||
    media?.thumbnail ||
    media?.thumbnailImage?.uri ||
    media?.image?.uri ||
    null
  );
};

const getPostDate = (post) => {
  let value = post.time || post.createdTime || post.date;
  if (!value && post.timestamp) {
    const timestamp = Number(post.timestamp);
    value = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  }
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizePost = (post) => {
  const shared = post.sharedPost;
  const title = (
    post.text ||
    post.message ||
    post.caption ||
    shared?.text ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: post.postId || post.id,
    date: getPostDate(post),
    title,
    url: post.url,
    imageUrl: getImageUrl(post) || (shared && getImageUrl(shared)),
  };
};

const formatSlug = (post) => {
  const date = post.date.replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  const id = post.id
    ? String(post.id).replace(/[^a-z0-9-]/gi, "-")
    : createHash("sha256").update(post.url).digest("hex").slice(0, 20);
  return `${date}-${id}`;
};

const savePost = async (post) => {
  const slug = formatSlug(post);
  const jsonPath = join(CONFIG.postsDir, `${slug}.json`);
  const imagePath = join(CONFIG.imagesDir, `${slug}.jpg`);
  if ((await exists(jsonPath)) && (await exists(imagePath))) return false;

  // Publish the record only after its thumbnail has downloaded successfully.
  const response = await fetch(post.imageUrl);
  if (!response.ok) throw new Error(`Image HTTP ${response.status} for ${slug}`);
  if (!response.headers.get("content-type")?.startsWith("image/")) {
    throw new Error(`Thumbnail is not an image for ${slug}`);
  }
  await write(imagePath, await response.arrayBuffer());
  await write(
    jsonPath,
    `${JSON.stringify(
      {
        url: post.url,
        date: post.date,
        title: post.title,
        name: post.title,
        thumbnail: `/images/facebook-posts/${slug}.jpg`,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`${slug}.json`);
  return true;
};

export const savePosts = async (results) => {
  const posts = results
    .map(normalizePost)
    .filter((post) => post.url && post.date && post.title && post.imageUrl);
  if (!posts.length) {
    throw new Error("Facebook returned no dated posts with text and thumbnails");
  }
  fs.mkdir(CONFIG.postsDir);
  fs.mkdir(CONFIG.imagesDir);

  console.log(
    `Found ${posts.length} posts with thumbnails (${results.length - posts.length} incomplete posts skipped)`,
  );
  let saved = 0;
  for (const post of posts) {
    if (await savePost(post)) saved++;
  }
  console.log(`Saved ${saved} new posts (${posts.length - saved} already existed)`);
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: bun run fetch-facebook-posts [--limit 8]");
    console.log("Loads socials.Facebook from _data/site.json and APIFY_API_KEY from .env.");
    return;
  }
  const options = parseArgv(args, { value: { "--limit": "limit" } });
  const limit = Number(options.limit ?? CONFIG.resultsLimit);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }

  await loadEnv();
  requireApifyKey();
  const siteConfig = await readJson(CONFIG.siteConfig);
  const facebookUrl = siteConfig.socials?.Facebook;
  if (!facebookUrl) throw new Error("socials.Facebook missing in _data/site.json");

  console.log(`Fetching posts for ${facebookUrl}...`);
  let results;
  try {
    results = await postApifyDataset(apifyActorUrl(CONFIG.actorId, 300), {
      startUrls: [{ url: facebookUrl }],
      resultsLimit: limit,
    });
  } catch (error) {
    throw new Error(error.message.replaceAll(process.env.APIFY_API_KEY, "[redacted]"));
  }
  await savePosts(results);
};

if (import.meta.main) runCli(main);
