#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exists, loadEnv, path, write } from "./utils.js";

await loadEnv();

const CONFIG = {
  placesDir: path("places"),
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
  "true", "false", "null", "yes", "no", "on", "off", "~",
  "True", "False", "Null", "Yes", "No", "On", "Off", "None", "TRUE", "FALSE",
]);

const isPlainSafeStr = (s) => {
  if (s === "") return false;
  if (/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s)) return false;
  if (/\s+$/.test(s)) return false;
  if (/\n/.test(s)) return false;
  if (/: |:\s*$/.test(s)) return false;
  if (/\s#/.test(s)) return false;
  if (KEYWORDS.has(s)) return false;
  if (/^-?\d/.test(s)) return false;
  return true;
};

const emitScalar = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "string") {
    return isPlainSafeStr(v) ? v : JSON.stringify(v);
  }
  throw new Error(`Cannot emit scalar of type ${typeof v}`);
};

const pad = (n) => "  ".repeat(n);

const emitObject = (obj, indent) => {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      lines.push(`${k}: null`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
        continue;
      }
      lines.push(`${k}:`);
      for (const item of v) {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const sub = emitObject(item, indent + 2);
          lines.push(`${pad(indent + 1)}- ${sub[0]}`);
          for (let i = 1; i < sub.length; i++) {
            lines.push(`${pad(indent + 2)}${sub[i]}`);
          }
        } else {
          lines.push(`${pad(indent + 1)}- ${emitScalar(item)}`);
        }
      }
    } else if (typeof v === "object") {
      const sub = emitObject(v, indent + 1);
      if (sub.length === 0) {
        lines.push(`${k}: {}`);
        continue;
      }
      lines.push(`${k}:`);
      for (const line of sub) lines.push(`${pad(indent + 1)}${line}`);
    } else {
      if (typeof v === "string" && v.includes("\n")) {
        lines.push(`${k}: |-`);
        for (const line of v.split("\n")) {
          lines.push(`${pad(indent + 1)}${line}`);
        }
      } else {
        lines.push(`${k}: ${emitScalar(v)}`);
      }
    }
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
  const url = `https://api.apify.com/v2/acts/${CONFIG.actorId}/run-sync-get-dataset-items?token=${process.env.APIFY_API_KEY}&timeout=${CONFIG.requestTimeoutSec}`;

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

const buildGoogleData = (p) => {
  const out = {
    name: p.title ?? null,
    category_name: p.categoryName ?? null,
    categories: Array.isArray(p.categories) && p.categories.length ? p.categories : null,
    address: p.address ?? null,
    phone: p.phone ?? null,
    phone_unformatted: p.phoneUnformatted ?? null,
    website: p.website ?? null,
    location: p.location && typeof p.location === "object" ? p.location : null,
    plus_code: p.plusCode ?? null,
    rating: typeof p.totalScore === "number" ? p.totalScore : null,
    reviews_count: typeof p.reviewsCount === "number" ? p.reviewsCount : null,
    price: p.price ?? null,
    opening_hours: Array.isArray(p.openingHours) && p.openingHours.length ? p.openingHours : null,
    image_url: p.imageUrl ?? null,
    url: p.url ?? null,
    permanently_closed: p.permanentlyClosed === true,
    temporarily_closed: p.temporarilyClosed === true,
    scraped_at: p.scrapedAt ?? null,
  };

  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v === null || v === undefined) delete out[key];
    else if (Array.isArray(v) && v.length === 0) delete out[key];
    else if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) {
      delete out[key];
    }
  }
  return out;
};

const refreshPlace = async (place) => {
  const data = place.data;
  const hasSearch = typeof data.search === "string" && data.search.trim();
  const hasPlaceId = typeof data.google_place_id === "string" && data.google_place_id.trim();

  if (!force && data.last_fetched) {
    const ageDays = (Date.now() - new Date(data.last_fetched).getTime()) / 86_400_000;
    if (ageDays < CONFIG.maxAgeDays) {
      console.log(`  skip  ${place.slug}  (fetched ${ageDays.toFixed(1)}d ago; --force to override)`);
      return { status: "skipped" };
    }
  }

  let result;
  let discoveredPlaceId = null;

  if (hasPlaceId) {
    console.log(`  fetch ${place.slug}  (by google_place_id)`);
    result = await callApify(`place_id:${data.google_place_id}`);
  } else if (hasSearch && !isCI) {
    console.log(`  search ${place.slug}  (no place_id; local discovery)`);
    result = await callApify(data.search);
    if (result?.placeId) discoveredPlaceId = result.placeId;
  } else {
    const reason = isCI ? "search disabled on CI" : "no search query";
    console.log(`  skip  ${place.slug}  (no google_place_id; ${reason})`);
    return { status: "skipped" };
  }

  if (!result) {
    console.log(`  empty ${place.slug}  (no results returned)`);
    return { status: "skipped" };
  }

  if (discoveredPlaceId) data.google_place_id = discoveredPlaceId;
  data.google = buildGoogleData(result);
  data.last_fetched = new Date().toISOString();

  await write(place.filepath, stringifyFrontmatter(data, place.body));

  const label = discoveredPlaceId
    ? `  ok    ${place.slug}  (discovered google_place_id=${discoveredPlaceId}; name="${result.title}")`
    : `  ok    ${place.slug}  (${result.reviewsCount ?? "?"} reviews, ${result.totalScore ?? "?"}★)`;
  console.log(label);
  return { status: "fetched", discovered: Boolean(discoveredPlaceId) };
};

const main = async () => {
  if (!process.env.APIFY_API_KEY) {
    console.error("Error: APIFY_API_KEY required (set in .env locally, or as a GitHub secret on CI)");
    console.error("Get one at: https://console.apify.com/account/integrations");
    process.exit(1);
  }

  let places = readPlaces();
  if (places.length === 0) {
    console.log(`No place files found in ${CONFIG.placesDir}`);
    return;
  }

  if (onlyArg) {
    places = places.filter((p) => p.slug === onlyArg);
    if (places.length === 0) {
      console.error(`No place with slug "${onlyArg}" found in ${CONFIG.placesDir}`);
      process.exit(1);
    }
  }

  console.log(
    `Refreshing ${places.length} place(s) — ${isCI ? "CI mode (existing ids only)" : "local mode (search discovery allowed)"}${force ? " — --force" : ""}\n`,
  );

  let fetched = 0;
  let discovered = 0;
  let skipped = 0;
  let failed = 0;

  for (const place of places) {
    try {
      const res = await refreshPlace(place);
      if (res.status === "fetched") {
        fetched++;
        if (res.discovered) discovered++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`  FAIL  ${place.slug}: ${err.message}`);
      failed++;
    }
    await sleep(CONFIG.politeDelayMs);
  }

  console.log(
    `\nDone. fetched=${fetched} (of which ${discovered} new place_ids), skipped=${skipped}, failed=${failed}`,
  );
  if (failed > 0) process.exit(1);
};

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

export { parseFile, stringifyFrontmatter, buildGoogleData, readPlaces };
