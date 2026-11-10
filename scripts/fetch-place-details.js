#!/usr/bin/env bun

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apifyActorUrl, requireApifyKey } from "./apify-utils.js";
import { runCli } from "./cli-utils.js";
import { exists, loadEnv, path, write } from "./utils.js";

await loadEnv();

const CONFIG = {
  placesDir: path("places"),
  imagesDir: path("images", "places"),
  actorId: "compass~crawler-google-places",
  maxAgeDays: 7,
  requestTimeoutSec: 240,
  politeDelayMs: 1500,
};

const isCI = process.env.CI === "true" || process.env.CI === "1";
const force = process.argv.includes("--force");

const onlyArg = process.argv
  .find((a) => a.startsWith("--only="))
  ?.split("=")[1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const parseFile = (text) => {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { data: {}, body: text };
  try {
    return { data: Bun.YAML.parse(m[1]) ?? {}, body: m[2] };
  } catch (err) {
    throw new Error(`YAML parse error: ${err.message}`);
  }
};

const KEYWORDS = new Set([
  "true",
  "false",
  "null",
  "yes",
  "no",
  "on",
  "off",
  "~",
  "True",
  "False",
  "Null",
  "Yes",
  "No",
  "On",
  "Off",
  "None",
  "TRUE",
  "FALSE",
]);

const UNSAFE_PLAIN_STR_PATTERNS = [
  /^[\s\-?:,[\]{}#&*!|>'"%@`]/,
  /\s+$/,
  /\n/,
  /: |:\s*$/,
  /\s#/,
  /^-?\d/,
];

const isPlainSafeStr = (s) =>
  s !== "" &&
  !KEYWORDS.has(s) &&
  !UNSAFE_PLAIN_STR_PATTERNS.some((re) => re.test(s));

const SCALAR_EMITTERS = {
  boolean: (v) => (v ? "true" : "false"),
  number: (v) => (Number.isFinite(v) ? String(v) : "null"),
  string: (v) => (isPlainSafeStr(v) ? v : JSON.stringify(v)),
};

const emitScalar = (v) => {
  if (v === null || v === undefined) return "null";

  const emitter = SCALAR_EMITTERS[typeof v];
  if (!emitter) throw new Error(`Cannot emit scalar of type ${typeof v}`);

  return emitter(v);
};

const pad = (n) => "  ".repeat(n);

const isPlainObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const emitArrayItem = (item, indent) => {
  if (!isPlainObject(item)) {
    return [`${pad(indent + 1)}- ${emitScalar(item)}`];
  }

  const sub = emitObject(item, indent + 2);
  return [
    `${pad(indent + 1)}- ${sub[0]}`,
    ...sub.slice(1).map((line) => `${pad(indent + 2)}${line}`),
  ];
};

const emitArrayLines = (key, items, indent) => {
  if (items.length === 0) return [`${key}: []`];

  const lines = [`${key}:`];
  for (const item of items) lines.push(...emitArrayItem(item, indent));
  return lines;
};

const emitNestedLines = (key, value, indent) => {
  const sub = emitObject(value, indent + 1);
  if (sub.length === 0) return [`${key}: {}`];

  return [`${key}:`, ...sub.map((line) => `${pad(indent + 1)}${line}`)];
};

const emitStringLines = (key, value, indent) => {
  if (!value.includes("\n")) return [`${key}: ${emitScalar(value)}`];

  return [
    `${key}: |-`,
    ...value.split("\n").map((line) => `${pad(indent + 1)}${line}`),
  ];
};

const emitValueLines = (key, value, indent) => {
  if (value === null || value === undefined) return [`${key}: null`];
  if (Array.isArray(value)) return emitArrayLines(key, value, indent);
  if (typeof value === "object") return emitNestedLines(key, value, indent);
  if (typeof value === "string") return emitStringLines(key, value, indent);

  return [`${key}: ${emitScalar(value)}`];
};

const emitObject = (obj, indent) => {
  const lines = [];

  for (const [key, value] of Object.entries(obj)) {
    lines.push(...emitValueLines(key, value, indent));
  }

  return lines;
};

const stringifyFrontmatter = (data, body = "") =>
  `---\n${emitObject(data, 0).join("\n")}\n---\n${body}`;

const readPlaces = () => {
  if (!exists(CONFIG.placesDir)) return [];
  return readdirSync(CONFIG.placesDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      const filepath = join(CONFIG.placesDir, file);
      const parsed = parseFile(readFileSync(filepath, "utf8"));
      return { slug, filepath, data: parsed.data, body: parsed.body };
    });
};

const callApify = async (searchString) => {
  const url = apifyActorUrl(CONFIG.actorId, CONFIG.requestTimeoutSec);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      searchStringsArray: [searchString],
      maxCrawledPlacesPerSearch: 1,
      scrapePlaceDetailPage: true,
      language: "en",
      skipClosedPlaces: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const results = await res.json();
  if (!Array.isArray(results)) {
    throw new Error("Apify returned non-array response");
  }
  return results[0] ?? null;
};

// Google-hosted photo URLs end with a size spec (e.g. =w408-h306-k-no or
// =s408) that caps the served resolution. Rewrite it to request a
// longer-edge master (no crop) suitable for retina displays and later reuse.
const upgradeImageUrl = (imageUrl, longestEdge = 1600) => {
  if (!imageUrl) return imageUrl;
  if (!/googleusercontent\.com/.test(imageUrl)) return imageUrl;
  return imageUrl.replace(/=[^/]+$/, `=s${longestEdge}`);
};
const downloadImage = async (imageUrl, slug) => {
  if (!imageUrl || imageUrl.startsWith("/images/")) return imageUrl;
  const hiresUrl = upgradeImageUrl(imageUrl);
  const ext =
    hiresUrl.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)?.[1]?.toLowerCase() || "jpg";
  const localPath = `/images/places/${slug}.${ext}`;
  const fullPath = join(CONFIG.imagesDir, `${slug}.${ext}`);
  mkdirSync(CONFIG.imagesDir, { recursive: true });

  const res = await fetch(hiresUrl);
  if (!res.ok) {
    throw new Error(
      `Image download failed for ${slug}: HTTP ${res.status} (${imageUrl})`,
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error(
      `Image download failed for ${slug}: empty response (${imageUrl})`,
    );
  }
  writeFileSync(fullPath, buf);
  console.log(`  image: ${slug}.${ext}`);
  return localPath;
};

const valueOrNull = (v) => (v === undefined ? null : v);
const listOrNull = (v) => (Array.isArray(v) && v.length ? v : null);
const numberOrNull = (v) => (typeof v === "number" ? v : null);
const objectOrNull = (v) => (v && typeof v === "object" ? v : null);

const isEmptyValue = (v) => {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
};

const buildGoogleData = (p) => {
  const out = {
    name: valueOrNull(p.title),
    category_name: valueOrNull(p.categoryName),
    categories: listOrNull(p.categories),
    address: valueOrNull(p.address),
    phone: valueOrNull(p.phone),
    phone_unformatted: valueOrNull(p.phoneUnformatted),
    website: valueOrNull(p.website),
    location: objectOrNull(p.location),
    plus_code: valueOrNull(p.plusCode),
    rating: numberOrNull(p.totalScore),
    reviews_count: numberOrNull(p.reviewsCount),
    price: valueOrNull(p.price),
    opening_hours: listOrNull(p.openingHours),
    image_url: valueOrNull(p.imageUrl),
    url: valueOrNull(p.url),
    permanently_closed: p.permanentlyClosed === true,
    temporarily_closed: p.temporarilyClosed === true,
    scraped_at: valueOrNull(p.scrapedAt),
  };

  return Object.fromEntries(
    Object.entries(out).filter(([, value]) => !isEmptyValue(value)),
  );
};

/**
 * True when the stored data is recent enough to skip
 */
const freshnessSkip = (place) => {
  const data = place.data;
  if (force || !data.last_fetched) return false;

  const ageDays =
    (Date.now() - new Date(data.last_fetched).getTime()) / 86_400_000;
  if (!(ageDays < CONFIG.maxAgeDays)) return false;

  console.log(
    `  skip  ${place.slug}  (fetched ${ageDays.toFixed(1)}d ago; --force to override)`,
  );
  return true;
};

/**
 * Ask Apify for the place data, or report why it cannot be fetched
 */
const fetchPlaceData = async (place) => {
  const data = place.data;
  const hasPlaceId =
    typeof data.google_place_id === "string" && data.google_place_id.trim();

  if (hasPlaceId) {
    console.log(`  fetch ${place.slug}  (by google_place_id)`);
    return { result: await callApify(`place_id:${data.google_place_id}`) };
  }

  const hasSearch = typeof data.search === "string" && data.search.trim();
  if (hasSearch && !isCI) {
    console.log(`  search ${place.slug}  (no place_id; local discovery)`);
    const result = await callApify(data.search);
    return { result, discoveredPlaceId: result?.placeId ?? null };
  }

  const reason = isCI ? "search disabled on CI" : "no search query";
  console.log(`  skip  ${place.slug}  (no google_place_id; ${reason})`);
  return { skipped: true };
};

/**
 * Log line describing a successful refresh
 */
const placeLabel = (slug, result, discoveredPlaceId) => {
  if (discoveredPlaceId) {
    return `  ok    ${slug}  (discovered google_place_id=${discoveredPlaceId}; name="${result.title}")`;
  }
  return `  ok    ${slug}  (${result.reviewsCount ?? "?"} reviews, ${result.totalScore ?? "?"}★)`;
};

/**
 * Write the fetched place data back to the property file
 */
const savePlaceDetails = async (place, result, discoveredPlaceId) => {
  const data = place.data;
  if (discoveredPlaceId) data.google_place_id = discoveredPlaceId;

  const googleData = buildGoogleData(result);
  const localImage = await downloadImage(googleData.image_url, place.slug);
  if (localImage) {
    googleData.image_url = localImage;
  }

  data.google = googleData;
  data.last_fetched = new Date().toISOString();

  await write(place.filepath, stringifyFrontmatter(data, place.body));

  console.log(placeLabel(place.slug, result, discoveredPlaceId));
  return { status: "fetched", discovered: Boolean(discoveredPlaceId) };
};

const refreshPlace = async (place) => {
  if (freshnessSkip(place)) return { status: "skipped" };

  const fetched = await fetchPlaceData(place);
  if (fetched.skipped) return { status: "skipped" };

  if (!fetched.result) {
    console.log(`  empty ${place.slug}  (no results returned)`);
    return { status: "skipped" };
  }

  return savePlaceDetails(place, fetched.result, fetched.discoveredPlaceId);
};

/**
 * Keep only the requested place when --only was passed
 */
const selectPlaces = (places) => {
  if (!onlyArg) return places;

  const selected = places.filter((p) => p.slug === onlyArg);
  if (selected.length === 0) {
    console.error(
      `No place with slug "${onlyArg}" found in ${CONFIG.placesDir}`,
    );
    process.exit(1);
  }

  return selected;
};

/**
 * Refresh one place, turning a failure into a failed status
 */
const refreshOne = async (place) => {
  try {
    return await refreshPlace(place);
  } catch (err) {
    console.error(`  FAIL  ${place.slug}: ${err.message}`);
    return { status: "failed" };
  }
};

/**
 * Fold one refresh result into the run statistics
 */
const countStatus = (stats, res) => {
  if (res.status !== "fetched") {
    if (res.status === "failed") stats.failed++;
    else stats.skipped++;
    return;
  }

  stats.fetched++;
  if (res.discovered) stats.discovered++;
};

/**
 * Refresh every place, collecting run statistics
 */
const refreshAll = async (places) => {
  const stats = { fetched: 0, discovered: 0, skipped: 0, failed: 0 };

  for (const place of places) {
    const res = await refreshOne(place);
    countStatus(stats, res);
    await sleep(CONFIG.politeDelayMs);
  }

  return stats;
};

const main = async () => {
  requireApifyKey();

  const places = readPlaces();
  if (places.length === 0) {
    console.log(`No place files found in ${CONFIG.placesDir}`);
    return;
  }

  const selected = selectPlaces(places);

  console.log(
    `Refreshing ${selected.length} place(s) — ${isCI ? "CI mode (existing ids only)" : "local mode (search discovery allowed)"}${force ? " — --force" : ""}\n`,
  );

  const stats = await refreshAll(selected);

  console.log(
    `\nDone. fetched=${stats.fetched} (of which ${stats.discovered} new place_ids), skipped=${stats.skipped}, failed=${stats.failed}`,
  );
  if (stats.failed > 0) process.exit(1);
};

if (import.meta.main) runCli(main);

export { buildGoogleData, parseFile, readPlaces, stringifyFrontmatter };
