#!/usr/bin/env bun

import {
  clampRating,
  cleanBody,
  cleanText,
  readProperties,
  saveReviews,
} from "./review-utils.js";
import { loadEnv } from "./utils.js";

await loadEnv();

const BASE_URL = "https://www.freetobook.com";
const PAGE_LIMIT = 100;
const REVIEW_BLOCK_RE =
  /<div class="flex justify-between">([\s\S]*?)<hr class="review-hr mt-10 mb-10"\/>/g;
const HEADER_RE =
  /<p class="font-bold text-base review-black-color">([\s\S]*?)<br\/>\s*<span class="font-normal">([\s\S]*?)<\/span><\/p>/;
const RATING_RE =
  /<p class="font-bold review-black-color mb-0[^"]*">([\d.]+) of 5<\/p>/;
const TEXT_RE = /free-comment-(\d+)[^"]*">([\s\S]*?)<\/p>/;
const PROPERTY_ID_RE = /property_id=(\d+)/;
const TOTAL_RE = /review-summary-number[^>]*>(\d+)<\/span>/;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const DATE_RE = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{4})$/i;

const parseReviewDate = (value) => {
  const match = DATE_RE.exec(cleanText(value));
  if (!match) return null;
  const month = MONTHS.indexOf(match[2].toLowerCase());
  if (month === -1) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1])))
    .toISOString()
    .slice(0, 10);
};

const reviewerName = (value) => {
  const name = cleanText(value);
  const anonymous = /^guest from\s*\.?$/i.test(name);
  return name && !anonymous ? name : "Freetobook guest";
};

const PLACEHOLDER_RE = /^no comment submitted\.?$/i;

const mapReview = (block) => {
  const header = HEADER_RE.exec(block);
  const rating = RATING_RE.exec(block);
  const text = TEXT_RE.exec(block);
  if (!header || !rating || !text) return null;
  const body = cleanBody(text[2]);
  if (PLACEHOLDER_RE.test(body)) return null;
  return {
    id: text[1],
    name: reviewerName(header[1]),
    date: parseReviewDate(header[2]),
    rating: clampRating(Number(rating[1])),
    text: body,
  };
};

const parseReviews = (html) =>
  [...html.matchAll(REVIEW_BLOCK_RE)]
    .map((match) => mapReview(match[1]))
    .filter(Boolean);

const fetchText = async (url) => {
  const res = await fetch(url, {
    headers: {
      accept: "text/html",
      "user-agent": "garsdalecottages.co.uk review sync",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

const reviewUrl = (property) => {
  const params = new URLSearchParams({
    w_id: property.freetobook_id,
    w_tkn: property.freetobook_token,
  });
  return `${BASE_URL}/reviews/all?${params}`;
};

const pageUrl = (property, propertyId, from) => {
  const params = new URLSearchParams({
    w_id: property.freetobook_id,
    w_tkn: property.freetobook_token,
    property_id: propertyId,
    reviews_from: String(from),
    reviews_limit: String(PAGE_LIMIT),
  });
  return `${BASE_URL}/reviews/get?${params}`;
};

const fetchAllReviews = async (property) => {
  const html = await fetchText(reviewUrl(property));
  const propertyId = PROPERTY_ID_RE.exec(html)?.[1];
  const total = Number(TOTAL_RE.exec(html)?.[1] ?? 0);
  let reviews = parseReviews(html);

  while (propertyId && reviews.length < total) {
    const more = parseReviews(
      await fetchText(pageUrl(property, propertyId, reviews.length)),
    );
    if (more.length === 0) break;
    reviews = reviews.concat(more);
  }

  return reviews;
};

const main = async () => {
  const properties = readProperties("freetobook_id").filter(
    (property) => property.freetobook_token,
  );
  if (properties.length === 0) {
    console.log("No properties with freetobook_id and freetobook_token");
    return;
  }

  let total = 0;
  let saved = 0;

  for (const property of properties) {
    const reviews = await fetchAllReviews(property);
    total += reviews.length;
    const added = await saveReviews(
      "freetobook",
      property,
      reviewUrl(property),
      reviews,
    );
    saved += added;
    console.log(`${property.slug}: ${reviews.length} review(s), ${added} new`);
  }

  console.log(`\nSaved ${saved} new Freetobook review(s) (${total} fetched)`);
};

if (import.meta.main) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
