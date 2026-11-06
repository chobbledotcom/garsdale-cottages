#!/usr/bin/env bun

import {
  clampRating,
  cleanBody,
  cleanText,
  readProperties,
  runApifyActor,
  saveReviews,
} from "./review-utils.js";
import { loadEnv } from "./utils.js";

await loadEnv();

const ACTOR_ID = "tri_angle~airbnb-reviews-scraper";
const MAX_REVIEWS = 9999999;

const roomId = (url) => /\/(?:rooms|listing)\/(\d+)/.exec(url ?? "")?.[1];

const reviewerName = (review) =>
  cleanText(review.reviewer?.firstName || review.reviewer?.hostName) ||
  "Airbnb guest";

const mapReview = (review) => ({
  id: review.id,
  name: reviewerName(review),
  date: review.createdAt,
  rating: clampRating(review.rating),
  text: cleanBody(review.localizedText || review.text),
});

const fetchReviews = async (properties) => {
  console.log(`Fetching Airbnb reviews for ${properties.length} listing(s)...`);
  return runApifyActor(ACTOR_ID, {
    startUrls: properties.map((property) => ({ url: property.airbnb_url })),
    maxReviewsPerListing: MAX_REVIEWS,
    sortBy: "most-recent",
    locale: "en-GB",
  });
};

const reviewsFor = (results, property) => {
  const id = roomId(property.airbnb_url);
  return results
    .filter((review) => roomId(review.startUrl) === id)
    .map(mapReview);
};

const main = async () => {
  const properties = readProperties("airbnb_url");
  if (properties.length === 0) {
    console.log("No properties with airbnb_url");
    return;
  }

  const results = await fetchReviews(properties);
  let total = 0;
  let saved = 0;

  for (const property of properties) {
    const reviews = reviewsFor(results, property);
    total += reviews.length;
    const added = await saveReviews(
      "airbnb",
      property,
      property.airbnb_url,
      reviews,
    );
    saved += added;
    console.log(`${property.slug}: ${reviews.length} review(s), ${added} new`);
  }

  console.log(`\nSaved ${saved} new Airbnb review(s) (${total} fetched)`);
};

if (import.meta.main) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
