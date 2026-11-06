#!/usr/bin/env bun

import {
  bookingRating,
  cleanBody,
  readProperties,
  runApifyActor,
  saveReviews,
} from "./review-utils.js";
import { loadEnv } from "./utils.js";

await loadEnv();

const ACTOR_ID = "voyager~booking-reviews-scraper";
const MAX_REVIEWS = 9999999;

const hotelKey = (url) => {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean).pop();
    return (segment ?? "").replace(/(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.html$/, "");
  } catch {
    return null;
  }
};

const bookingText = (review) => {
  const liked = cleanBody(review.likedText);
  const disliked = cleanBody(review.dislikedText);
  return [liked, disliked && `Disliked: ${disliked}`]
    .filter(Boolean)
    .join("\n\n");
};

const mapReview = (review) => ({
  id: review.id,
  name: review.userName,
  title: review.reviewTitle,
  date: review.reviewDate,
  rating: bookingRating(review.rating),
  text: bookingText(review),
});

const fetchReviews = async (properties) => {
  console.log(
    `Fetching Booking.com reviews for ${properties.length} listing(s)...`,
  );
  return runApifyActor(ACTOR_ID, {
    startUrls: properties.map((property) => ({ url: property.booking_url })),
    maxReviewsPerHotel: MAX_REVIEWS,
    sortReviewsBy: "f_recent_desc",
  });
};

const main = async () => {
  const properties = readProperties("booking_url");
  if (properties.length === 0) {
    console.log("No properties with booking_url");
    return;
  }

  const results = await fetchReviews(properties);
  let total = 0;
  let saved = 0;

  for (const property of properties) {
    const key = hotelKey(property.booking_url);
    const reviews = results
      .filter((review) => hotelKey(review.startUrl) === key)
      .map(mapReview);
    total += reviews.length;
    const added = await saveReviews(
      "booking",
      property,
      property.booking_url,
      reviews,
    );
    saved += added;
    console.log(`${property.slug}: ${reviews.length} review(s), ${added} new`);
  }

  console.log(`\nSaved ${saved} new Booking.com review(s) (${total} fetched)`);
};

if (import.meta.main) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
