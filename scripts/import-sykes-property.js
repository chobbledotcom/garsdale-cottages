#!/usr/bin/env node

/**
 * Sykes Property Importer
 *
 * Fetches a Sykes Cottages listing page and converts it to a property
 * markdown file with YAML front matter matching the chobble-template schema.
 *
 * Usage:
 *   node scripts/import-sykes-property.js <sykes-url> [--output-dir <dir>]
 *   node scripts/import-sykes-property.js --file <local.html> [--output-dir <dir>]
 *
 * Example:
 *   node scripts/import-sykes-property.js https://www.sykescottages.co.uk/cottage/Lake-District-Yorkshire-Dales-South-Far-Ho/The-Old-Cart-House-1167031.html
 *   node scripts/import-sykes-property.js --file example.html
 */

const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} = require("node:fs");
const { join } = require("node:path");
const { parseArgv, wantsHelp } = require("./cli-utils.js");
const { sleep, slugify } = require("./text-utils.js");

/**
 * Escape special characters in YAML strings
 */
function escapeYaml(str) {
  if (!str) return '""';
  const s = String(str);
  if (
    /[:#[\]{}|>&*!?,\n]/.test(s) ||
    s.includes('"') ||
    s.includes("'") ||
    s.startsWith(" ") ||
    s.endsWith(" ")
  ) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return s;
}

/**
 * Format one item of a front matter array
 */
function formatArrayItem(item) {
  if (typeof item !== "object" || item === null) {
    return `  - ${escapeYaml(item)}\n`;
  }

  const entries = Object.entries(item).map(
    ([key, value]) => `    ${key}: ${escapeYaml(value)}\n`,
  );
  return `  -\n${entries.join("")}`;
}

/**
 * Format one key/value pair of front matter
 */
function formatFrontMatterEntry(key, value) {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return `${key}:\n${value.map(formatArrayItem).join("")}`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${key}: ${value}\n`;
  }

  return `${key}: ${escapeYaml(value)}\n`;
}

/**
 * Generate YAML front matter from an object
 */
function generateFrontMatter(data) {
  let yaml = "---\n";

  for (const [key, value] of Object.entries(data)) {
    yaml += formatFrontMatterEntry(key, value);
  }

  yaml += "---\n";
  return yaml;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text) {
  if (!text) return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#163;/g, "£")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num));
}

/**
 * Strip HTML tags and normalise whitespace
 */
function textOnly(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const OG_PROPERTY_FIRST_RE =
  /<meta\s+property=["']og:([^"']+)["']\s+content=["']([^"']*)["'][^>]*\/?>/gi;
const OG_CONTENT_FIRST_RE =
  /<meta\s+content=["']([^"']*)["']\s+property=["']og:([^"']+)["'][^>]*\/?>/gi;
const NAME_FIRST_RE =
  /<meta\s+name=["']([^"']+)["']\s+content=["']([^"']*)["'][^>]*\/?>/gi;
const CONTENT_FIRST_RE =
  /<meta\s+content=["']([^"']*)["']\s+name=["']([^"']+)["'][^>]*\/?>/gi;

/**
 * Collect meta tag values from one attribute order
 */
function collectMeta(html, pattern, keyFor, valueFor) {
  const meta = {};

  for (const match of html.matchAll(pattern)) {
    meta[keyFor(match)] = decodeHtmlEntities(valueFor(match));
  }

  return meta;
}

/**
 * Copy keys that are still missing from a collected batch
 */
function mergeMissingMeta(meta, extra) {
  for (const [key, value] of Object.entries(extra)) {
    if (!meta[key]) meta[key] = value;
  }

  return meta;
}

/**
 * Extract meta tags from HTML
 */
function extractMetaTags(html) {
  const meta = collectMeta(
    html,
    OG_PROPERTY_FIRST_RE,
    (match) => `og:${match[1]}`,
    (match) => match[2],
  );

  mergeMissingMeta(
    meta,
    collectMeta(
      html,
      OG_CONTENT_FIRST_RE,
      (match) => `og:${match[2]}`,
      (match) => match[1],
    ),
  );

  Object.assign(
    meta,
    collectMeta(
      html,
      NAME_FIRST_RE,
      (match) => match[1],
      (match) => match[2],
    ),
  );

  mergeMissingMeta(
    meta,
    collectMeta(
      html,
      CONTENT_FIRST_RE,
      (match) => match[2],
      (match) => match[1],
    ),
  );

  return meta;
}

/**
 * Extract sleeps/bedrooms/bathrooms from at-a-glance section
 */
function extractAtAGlance(html) {
  const result = { sleeps: null, bedrooms: null, bathrooms: null, pets: false };

  // Match: <li class='sleeps'><p><b>2</b> Guests</p></li>
  const sleepsMatch = html.match(
    /<li\s+class=['"]sleeps['"][^>]*>[\s\S]*?<b>(\d+)<\/b>/i,
  );
  if (sleepsMatch) {
    result.sleeps = parseInt(sleepsMatch[1], 10);
  }

  // Match: <li class='bedrooms'><p><b>1</b> Bedroom</p></li>
  const bedroomsMatch = html.match(
    /<li\s+class=['"]bedrooms['"][^>]*>[\s\S]*?<b>(\d+)<\/b>/i,
  );
  if (bedroomsMatch) {
    result.bedrooms = parseInt(bedroomsMatch[1], 10);
  }

  // Match: <li class='bathrooms'><p><b>1</b> Bathroom</p></li>
  const bathroomsMatch = html.match(
    /<li\s+class=['"]bathrooms['"][^>]*>[\s\S]*?<b>(\d+)<\/b>/i,
  );
  if (bathroomsMatch) {
    result.bathrooms = parseInt(bathroomsMatch[1], 10);
  }

  // Match: <li class='pets'><p>Pets: <strong>Yes</strong></p></li>
  const petsMatch = html.match(
    /<li\s+class=['"]pets['"][^>]*>[\s\S]*?<strong>Yes<\/strong>/i,
  );
  result.pets = !!petsMatch;

  return result;
}

/**
 * Extract features from cottage_features section
 */
function extractFeatures(html) {
  const features = [];

  // Find the cottage_features section
  const sectionMatch = html.match(
    /<section\s+class=['"]cottage_features['"][^>]*>([\s\S]*?)<\/section>/i,
  );

  if (sectionMatch) {
    // Extract each feature from <li class="secondary_feature ...">Feature Name</li>
    const featureMatches = sectionMatch[1].matchAll(
      /<li\s+class=["'][^"']*secondary_feature[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    );

    for (const match of featureMatches) {
      // Clean up the feature text
      const feature = decodeHtmlEntities(textOnly(match[1]));

      if (feature && !features.includes(feature)) {
        features.push(feature);
      }
    }
  }

  return features;
}

/**
 * Extract gallery images
 */
function extractGalleryImages(html) {
  const images = [];
  const seen = new Set();

  // Match high-quality gallery images: src='https://images-cdn.sykesassets.co.uk/images/property_images/976x732/...'
  const imgMatches = html.matchAll(
    /src=['"]([^'"]*images-cdn\.sykesassets\.co\.uk\/images\/property_images\/\d+x\d+\/[^'"]+)['"]/gi,
  );

  for (const match of imgMatches) {
    let url = match[1];

    // Normalize to consistent size (use 976x732 for gallery)
    url = url.replace(/\/\d+x\d+\//, "/976x732/");

    // Remove query params for deduplication
    const baseUrl = url.split("?")[0];

    if (!seen.has(baseUrl)) {
      seen.add(baseUrl);
      images.push(url);
    }
  }

  return images;
}

const ALT_THEN_SRC_RE =
  /<img[^>]*\s+alt=["']([^"']+)["'][^>]*\s+src=["']([^"']+)["'][^>]*>/gi;
const SRC_THEN_ALT_RE =
  /<img[^>]*\s+src=["']([^"']+)["'][^>]*\s+alt=["']([^"']+)["'][^>]*>/gi;

/**
 * Add one alt tag when it is a new Sykes CDN image with a useful description
 */
function addAltTag(altTags, seen, rawAlt, rawSrc) {
  const alt = decodeHtmlEntities(rawAlt.trim());
  if (!rawSrc.includes("images-cdn.sykesassets.co.uk")) return;

  const src = rawSrc.replace(/\/\d+x\d+\//, "/976x732/");
  const baseUrl = src.split("?")[0];
  if (seen.has(baseUrl)) return;
  seen.add(baseUrl);

  if (alt.length > 10) {
    altTags.push({ path: src, alt: alt });
  }
}

/**
 * Extract image alt tags from the page
 */
function extractImageAltTags(html) {
  const altTags = [];
  const seen = new Set();

  // Pattern: alt="..." followed by src="..." or src="..." followed by alt="..."
  for (const match of html.matchAll(ALT_THEN_SRC_RE)) {
    addAltTag(altTags, seen, match[1], match[2]);
  }

  for (const match of html.matchAll(SRC_THEN_ALT_RE)) {
    addAltTag(altTags, seen, match[2], match[1]);
  }

  return altTags;
}

/**
 * Extract the full property description
 */
function extractDescription(html) {
  // Find the description article: <article class="property" itemprop="description" id="description">
  const articleMatch = html.match(
    /<article[^>]*id=["']description["'][^>]*>([\s\S]*?)<\/article>/i,
  );

  if (!articleMatch) return "";

  const content = articleMatch[1];
  const parts = [];

  // Extract "The property" section with paragraphs
  const propertySection = content.match(
    /<h2>The property<\/h2>[\s\S]*?<div[^>]*class=["']columns["'][^>]*>([\s\S]*?)<\/div>/i,
  );

  if (propertySection) {
    // Extract all paragraphs
    const paragraphs = propertySection[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const p of paragraphs) {
      const text = decodeHtmlEntities(textOnly(p[1]));
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * Extract amenities list
 */
function extractAmenities(html) {
  const amenities = [];

  // Find the amenities list: <ul class="amenities">
  const listMatch = html.match(
    /<ul\s+class=["']amenities["'][^>]*>([\s\S]*?)<\/ul>/i,
  );

  if (listMatch) {
    const itemMatches = listMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
    for (const item of itemMatches) {
      const text = decodeHtmlEntities(textOnly(item[1]));
      if (text) {
        amenities.push(text);
      }
    }
  }

  return amenities;
}

/**
 * Headline of one customer review
 */
function reviewHeadline(reviewHtml) {
  const match = reviewHtml.match(/<h3[^>]*>"?([^<]+)"?<\/h3>/i);
  if (!match) return "";
  return decodeHtmlEntities(match[1].replace(/^"|"$/g, "").trim());
}

/**
 * Body of one customer review
 */
function reviewBody(reviewHtml) {
  const match = reviewHtml.match(
    /<p\s+class=['"]quote['"][^>]*>([\s\S]*?)<\/p>/i,
  );
  if (!match) return "";
  return decodeHtmlEntities(textOnly(match[1]));
}

/**
 * Author name and rating of one customer review
 */
function reviewAuthor(reviewHtml) {
  const match = reviewHtml.match(
    /<p\s+class=["']author["'][^>]*>[\s\S]*?Reviewed by\s+([^<]+)<strong\s+class=["']review_score["'][^>]*>([0-9.]+)/i,
  );

  if (!match) return { name: "", rating: null };
  return { name: match[1].trim(), rating: parseFloat(match[2]) };
}

/**
 * Date of one customer review
 */
function reviewDate(reviewHtml) {
  const match = reviewHtml.match(
    /<p\s+class=["']author["'][^>]*>[\s\S]*?<\/strong><span>([^<]+)<\/span>/i,
  );
  return match ? match[1].trim() : "";
}

/**
 * Build one review record, or null when the block is empty
 */
function buildReview(reviewHtml, propertyTitle) {
  if (reviewHtml.includes("empty_search_message")) return null;

  const headline = reviewHeadline(reviewHtml);
  const body = reviewBody(reviewHtml);
  const { name, rating } = reviewAuthor(reviewHtml);

  // Only include reviews with at least a name or body
  if (!(name || body || headline)) return null;

  return {
    name: name || "Anonymous",
    rating: rating,
    headline: headline,
    body: body || headline, // Use headline as body if no quote
    date: reviewDate(reviewHtml),
    propertyTitle: propertyTitle,
  };
}

/**
 * Extract customer reviews from the page
 */
function extractReviews(html, propertyTitle) {
  // Find the customer reviews section
  const sectionMatch = html.match(
    /<section\s+id=["']customer_reviews["'][^>]*>([\s\S]*?)<\/section>/i,
  );

  if (!sectionMatch) return [];

  // Extract each review from <li class="customer-review">
  const reviewMatches = sectionMatch[1].matchAll(
    /<li\s+class=["'][^"']*customer-review[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
  );

  const reviews = [];
  for (const match of reviewMatches) {
    const review = buildReview(match[1], propertyTitle);
    if (review) reviews.push(review);
  }

  return reviews;
}

/**
 * Extract property ID from URL or HTML
 */
function extractPropertyId(url, html) {
  // From URL: The-Old-Cart-House-1167031.html -> 1167031
  const urlMatch = url.match(/-(\d+)\.html$/);
  if (urlMatch) return urlMatch[1];

  // From HTML: var propertyID = '1167031';
  const htmlMatch = html.match(/propertyID\s*=\s*['"](\d+)['"]/);
  if (htmlMatch) return htmlMatch[1];

  return null;
}

/**
 * Extract location from title
 */
function extractLocation(html, _metaTags) {
  // Title format: "The Old Cart House | Sedbergh | Far Ho | Self Catering Holiday Cottage"
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const parts = titleMatch[1].split("|").map((p) => p.trim());
    if (parts.length >= 2) {
      // Return the location part (usually second segment)
      return parts[1];
    }
  }
  return "";
}

/**
 * Page title from og:title or the page title element
 */
function resolveTitle(metaTags, html) {
  const ogTitle = metaTags["og:title"];
  if (ogTitle) return ogTitle;

  const titleMatch = html.match(/<title>([^|<]+)/i);
  return titleMatch ? titleMatch[1].trim() : "";
}

/**
 * Body content built from the description and amenities list
 */
function buildPropertyBody(description, amenities) {
  if (amenities.length === 0) return description;

  const list = amenities.map((a) => `- ${a}`).join("\n");
  const spacer = description ? "\n\n" : "";
  return `${description}${spacer}## At a glance\n\n${list}`;
}

/**
 * Parse Sykes property page and extract data
 */
function parseSykesPage(html, url) {
  const metaTags = extractMetaTags(html);
  const atAGlance = extractAtAGlance(html);
  const features = extractFeatures(html);
  const images = extractGalleryImages(html);
  const description = extractDescription(html);
  const amenities = extractAmenities(html);
  const propertyId = extractPropertyId(url, html);
  const location = extractLocation(html, metaTags);
  const title = resolveTitle(metaTags, html);

  // Add pet-friendly if pets are allowed
  if (atAGlance.pets && !features.some((f) => /pet/i.test(f))) {
    features.push("Pet friendly");
  }

  // Get the main header image (og:image or first gallery image)
  const headerImage = metaTags["og:image"] || images[0] || "";

  // Meta description
  const metaDescription = metaTags.description || "";

  return {
    title,
    subtitle: `Cottage in ${location}`,
    thumbnail: headerImage,
    headerImage,
    featured: false,
    bedrooms: atAGlance.bedrooms,
    bathrooms: atAGlance.bathrooms,
    sleeps: atAGlance.sleeps,
    pricePerNight: null, // Not reliably extractable from static HTML
    features,
    gallery: images,
    body: buildPropertyBody(description, amenities),
    metaTitle: title.substring(0, 55),
    metaDescription: metaDescription.substring(0, 155),
    sykesPropertyId: propertyId,
  };
}

/**
 * One attempt at fetching a URL, retrying via fetchWithRetry
 */
async function tryFetch(url, headers, attempt, retries) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    if (attempt === retries - 1) throw error;
    console.log(
      `Retry ${attempt + 1}/${retries} after error: ${error.message}`,
    );
    await sleep(1000 * (attempt + 1));
  }
}

/**
 * Fetch a URL with retries
 */
async function fetchWithRetry(url, retries = 3) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
  };

  for (let i = 0; i < retries; i++) {
    const text = await tryFetch(url, headers, i, retries);
    if (text !== undefined) return text;
  }
}

/**
 * Load alt-tags.json, falling back to an empty image list
 */
function readAltTagsFile(filepath) {
  if (!existsSync(filepath)) return { images: [] };

  try {
    const data = JSON.parse(readFileSync(filepath, "utf8"));
    if (!data.images) data.images = [];
    return data;
  } catch {
    // If parsing fails, start fresh
    return { images: [] };
  }
}

/**
 * Add alt tags that are not already present
 * @returns {number} number of tags added
 */
function addMissingAltTags(existingData, altTags) {
  const existingPaths = new Set(existingData.images.map((img) => img.path));
  let addedCount = 0;

  for (const tag of altTags) {
    if (existingPaths.has(tag.path)) continue;
    existingData.images.push(tag);
    existingPaths.add(tag.path);
    addedCount++;
  }

  return addedCount;
}

/**
 * Write or update alt-tags.json file
 */
function writeAltTagsFile(altTags, outputDir) {
  const dataDir = join(outputDir, "_data");
  const filepath = join(dataDir, "alt-tags.json");

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const existingData = readAltTagsFile(filepath);
  const addedCount = addMissingAltTags(existingData, altTags);

  // Write the updated file
  writeFileSync(filepath, `${JSON.stringify(existingData, null, 2)}\n`, "utf8");

  return { filepath, addedCount, totalCount: existingData.images.length };
}

/**
 * Write review files to disk
 */
function writeReviewFiles(reviews, propertySlug, outputDir) {
  const reviewsDir = join(outputDir, "reviews");

  if (!existsSync(reviewsDir)) {
    mkdirSync(reviewsDir, { recursive: true });
  }

  const writtenFiles = [];

  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i];

    // Create a unique slug for each review
    const reviewSlug = slugify(`${propertySlug}-${review.name}-${i + 1}`);
    const filename = `${reviewSlug}.md`;
    const filepath = join(reviewsDir, filename);

    // Build front matter matching the reviews schema
    const frontMatter = {
      title: review.headline || "",
      name: review.name,
      rating: review.rating,
      // url: null, // Not available from Sykes
      // thumbnail: null, // Not available from Sykes
      // products: [], // Reference field - properties use different collection
    };

    // Build body content
    let bodyContent = review.body || "";

    // Add date as a note
    if (review.date) {
      bodyContent += `\n\n*Reviewed: ${review.date}*`;
    }

    const content = `${generateFrontMatter(frontMatter)}\n${bodyContent}\n`;

    writeFileSync(filepath, content, "utf8");
    writtenFiles.push(filepath);
  }

  return writtenFiles;
}

/**
 * Write property file to disk
 */
function writePropertyFile(property, outputDir) {
  const propertiesDir = join(outputDir, "properties");

  if (!existsSync(propertiesDir)) {
    mkdirSync(propertiesDir, { recursive: true });
  }

  const slug = slugify(property.title);
  const filename = `${slug}.md`;
  const filepath = join(propertiesDir, filename);

  // Build front matter matching the chobble-template properties schema
  const frontMatter = {
    title: property.title,
    subtitle: property.subtitle,
    thumbnail: property.thumbnail,
    header_image: property.headerImage,
    featured: property.featured,
    // locations: [], // Reference field - would need manual setup
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    sleeps: property.sleeps,
    // price_per_night: property.pricePerNight, // Omit if null
    features: property.features,
    gallery: property.gallery,
    meta_title: property.metaTitle,
    meta_description: property.metaDescription,
    // faqs: [], // Could be populated if we extract Q&A content
  };

  // Only include price if we have it
  if (property.pricePerNight) {
    frontMatter.price_per_night = property.pricePerNight;
  }

  const content = `${generateFrontMatter(frontMatter)}\n${property.body || ""}\n`;

  writeFileSync(filepath, content, "utf8");
  return filepath;
}

/**
 * Read the page HTML from a local file
 * @returns {{html: string, url: string}}
 */
function readLocalPage(localFile, url) {
  console.log(`Reading from file: ${localFile}`);
  try {
    const html = readFileSync(localFile, "utf8");
    console.log(`Read ${html.length} bytes`);
    // Use a placeholder URL if reading from file
    return { html, url: url || `file://${localFile}` };
  } catch (error) {
    console.error(`Error reading file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Fetch the page HTML from a Sykes Cottages URL
 */
async function fetchPage(url) {
  if (!url) {
    console.error("Error: Must provide a URL or --file <path>");
    process.exit(1);
  }

  if (!url.includes("sykescottages.co.uk")) {
    console.error("Error: URL must be a Sykes Cottages listing URL");
    process.exit(1);
  }

  console.log(`Fetching: ${url}`);

  try {
    const html = await fetchWithRetry(url);
    console.log(`Fetched ${html.length} bytes`);
    return html;
  } catch (error) {
    console.error(`Error fetching: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Load the page HTML and the URL to parse it against
 */
async function loadPage(localFile, url) {
  if (localFile) return readLocalPage(localFile, url);
  return { html: await fetchPage(url), url };
}

const orNotFound = (value) => value || "Not found";

/**
 * Report the extracted feature list
 */
function printFeatures(features) {
  console.log(`  Features: ${features.length} found`);
  if (features.length === 0) return;
  console.log(`    - ${features.slice(0, 5).join("\n    - ")}`);
  if (features.length > 5) {
    console.log(`    ... and ${features.length - 5} more`);
  }
}

/**
 * Report the property data that was extracted
 */
function printExtracted(property, reviews, altTags) {
  console.log("\nExtracted property:");
  console.log(`  Title: ${property.title}`);
  console.log(`  Subtitle: ${orNotFound(property.subtitle)}`);
  console.log(`  Sleeps: ${orNotFound(property.sleeps)}`);
  console.log(`  Bedrooms: ${orNotFound(property.bedrooms)}`);
  console.log(`  Bathrooms: ${orNotFound(property.bathrooms)}`);
  printFeatures(property.features);
  console.log(`  Gallery images: ${property.gallery.length} found`);
  console.log(`  Description: ${property.body.length} characters`);
  console.log(`  Reviews: ${reviews.length} found`);
  if (reviews.length > 0) {
    console.log(
      `    First review: "${reviews[0].headline.substring(0, 50)}..." by ${reviews[0].name}`,
    );
  }
  console.log(`  Image alt tags: ${altTags.length} found`);
}

/**
 * Preview what a run would create without writing anything
 */
function printDryRun(property, reviews, altTags, propertySlug) {
  console.log("\n--- DRY RUN ---");
  console.log(`\nWould create: properties/${propertySlug}.md`);
  console.log("\nFront matter preview:");
  console.log(
    generateFrontMatter({
      title: property.title,
      subtitle: property.subtitle,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      sleeps: property.sleeps,
      features: property.features,
      meta_title: property.metaTitle,
      meta_description: property.metaDescription,
    }),
  );
  console.log("\nBody preview (first 500 chars):");
  console.log(`${property.body.substring(0, 500)}...`);

  if (reviews.length > 0) {
    console.log(`\nWould create ${reviews.length} review files in reviews/`);
    console.log("Sample review filenames:");
    for (let i = 0; i < Math.min(3, reviews.length); i++) {
      console.log(
        `  - ${slugify(`${propertySlug}-${reviews[i].name}-${i + 1}`)}.md`,
      );
    }
  }

  if (altTags.length > 0) {
    console.log(
      `\nWould add ${altTags.length} alt tags to _data/alt-tags.json`,
    );
    console.log("Sample alt tag:");
    console.log(`  ${altTags[0].alt.substring(0, 80)}...`);
  }
}

/**
 * Write the property, reviews and alt tags to disk
 */
function writeOutputs(property, reviews, altTags, outputDir) {
  const propertySlug = slugify(property.title);

  console.log(`\nWriting to: ${outputDir}`);
  const filepath = writePropertyFile(property, outputDir);
  console.log(`\n✓ Created: ${filepath}`);

  if (reviews.length > 0) {
    const reviewFiles = writeReviewFiles(reviews, propertySlug, outputDir);
    console.log(`✓ Created ${reviewFiles.length} review files in reviews/`);
  }

  if (altTags.length > 0) {
    const altResult = writeAltTagsFile(altTags, outputDir);
    console.log(
      `✓ Added ${altResult.addedCount} alt tags to ${altResult.filepath} (${altResult.totalCount} total)`,
    );
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (wantsHelp(args)) {
    console.log(`
Sykes Property Importer

Fetches a Sykes Cottages listing and converts it to a property page.

Usage:
  node scripts/import-sykes-property.js <sykes-url> [options]
  node scripts/import-sykes-property.js --file <local.html> [options]

Options:
  --file <path>       Read from a local HTML file instead of fetching
  --output-dir <dir>  Output directory (default: .)
  --dry-run           Show what would be created without writing files
  --help, -h          Show this help message

Examples:
  node scripts/import-sykes-property.js https://www.sykescottages.co.uk/cottage/.../The-Old-Cart-House-1167031.html
  node scripts/import-sykes-property.js --file example.html --dry-run
`);
    process.exit(0);
  }

  const parsed = parseArgv(args, {
    value: { "--output-dir": "outputDir", "--file": "localFile" },
    boolean: { "--dry-run": "dryRun" },
  });
  const outputDir = parsed.outputDir ?? ".";
  const dryRun = Boolean(parsed.dryRun);
  const localFile = parsed.localFile ?? null;
  const positionalUrl = parsed.positionals.at(-1) ?? "";

  const page = await loadPage(localFile, positionalUrl);

  console.log("\nParsing property data...");
  const property = parseSykesPage(page.html, page.url);

  console.log("\nExtracting reviews...");
  const reviews = extractReviews(page.html, property.title);

  console.log("\nExtracting image alt tags...");
  const altTags = extractImageAltTags(page.html);

  printExtracted(property, reviews, altTags);

  if (dryRun) {
    printDryRun(property, reviews, altTags, slugify(property.title));
    return;
  }

  writeOutputs(property, reviews, altTags, outputDir);
}

main();
