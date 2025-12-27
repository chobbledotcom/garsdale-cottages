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

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");

/**
 * Convert a string to a URL-friendly slug
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

/**
 * Escape special characters in YAML strings
 */
function escapeYaml(str) {
  if (!str) return '""';
  const s = String(str);
  if (
    /[:#\[\]{}|>&*!?,\n]/.test(s) ||
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
 * Generate YAML front matter from an object
 */
function generateFrontMatter(data) {
  let yaml = "---\n";

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      yaml += `${key}:\n`;
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          // Handle objects like FAQs
          yaml += "  -\n";
          for (const [k, v] of Object.entries(item)) {
            yaml += `    ${k}: ${escapeYaml(v)}\n`;
          }
        } else {
          yaml += `  - ${escapeYaml(item)}\n`;
        }
      }
    } else if (typeof value === "number") {
      yaml += `${key}: ${value}\n`;
    } else if (typeof value === "boolean") {
      yaml += `${key}: ${value}\n`;
    } else {
      yaml += `${key}: ${escapeYaml(value)}\n`;
    }
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
 * Extract meta tags from HTML
 */
function extractMetaTags(html) {
  const meta = {};

  // Open Graph tags - property before content
  const ogMatches = html.matchAll(
    /<meta\s+property=["']og:([^"']+)["']\s+content=["']([^"']*)["'][^>]*\/?>/gi
  );
  for (const match of ogMatches) {
    meta[`og:${match[1]}`] = decodeHtmlEntities(match[2]);
  }

  // Open Graph tags - content before property
  const ogMatches2 = html.matchAll(
    /<meta\s+content=["']([^"']*)["']\s+property=["']og:([^"']+)["'][^>]*\/?>/gi
  );
  for (const match of ogMatches2) {
    if (!meta[`og:${match[2]}`]) {
      meta[`og:${match[2]}`] = decodeHtmlEntities(match[1]);
    }
  }

  // Standard meta tags - name before content
  const standardMatches = html.matchAll(
    /<meta\s+name=["']([^"']+)["']\s+content=["']([^"']*)["'][^>]*\/?>/gi
  );
  for (const match of standardMatches) {
    meta[match[1]] = decodeHtmlEntities(match[2]);
  }

  // Standard meta tags - content before name
  const standardMatches2 = html.matchAll(
    /<meta\s+content=["']([^"']*)["']\s+name=["']([^"']+)["'][^>]*\/?>/gi
  );
  for (const match of standardMatches2) {
    if (!meta[match[2]]) {
      meta[match[2]] = decodeHtmlEntities(match[1]);
    }
  }

  return meta;
}

/**
 * Extract sleeps/bedrooms/bathrooms from at-a-glance section
 */
function extractAtAGlance(html) {
  const result = { sleeps: null, bedrooms: null, bathrooms: null, pets: false };

  // Match: <li class='sleeps'><p><b>2</b> Guests</p></li>
  const sleepsMatch = html.match(
    /<li\s+class=['"]sleeps['"][^>]*>[\s\S]*?<b>(\d+)<\/b>/i
  );
  if (sleepsMatch) {
    result.sleeps = parseInt(sleepsMatch[1], 10);
  }

  // Match: <li class='bedrooms'><p><b>1</b> Bedroom</p></li>
  const bedroomsMatch = html.match(
    /<li\s+class=['"]bedrooms['"][^>]*>[\s\S]*?<b>(\d+)<\/b>/i
  );
  if (bedroomsMatch) {
    result.bedrooms = parseInt(bedroomsMatch[1], 10);
  }

  // Match: <li class='bathrooms'><p><b>1</b> Bathroom</p></li>
  const bathroomsMatch = html.match(
    /<li\s+class=['"]bathrooms['"][^>]*>[\s\S]*?<b>(\d+)<\/b>/i
  );
  if (bathroomsMatch) {
    result.bathrooms = parseInt(bathroomsMatch[1], 10);
  }

  // Match: <li class='pets'><p>Pets: <strong>Yes</strong></p></li>
  const petsMatch = html.match(
    /<li\s+class=['"]pets['"][^>]*>[\s\S]*?<strong>Yes<\/strong>/i
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
    /<section\s+class=['"]cottage_features['"][^>]*>([\s\S]*?)<\/section>/i
  );

  if (sectionMatch) {
    // Extract each feature from <li class="secondary_feature ...">Feature Name</li>
    const featureMatches = sectionMatch[1].matchAll(
      /<li\s+class=["'][^"']*secondary_feature[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi
    );

    for (const match of featureMatches) {
      // Clean up the feature text
      let feature = match[1]
        .replace(/<[^>]+>/g, "") // Remove HTML tags
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim();

      feature = decodeHtmlEntities(feature);

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
    /src=['"]([^'"]*images-cdn\.sykesassets\.co\.uk\/images\/property_images\/\d+x\d+\/[^'"]+)['"]/gi
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

/**
 * Extract the full property description
 */
function extractDescription(html) {
  // Find the description article: <article class="property" itemprop="description" id="description">
  const articleMatch = html.match(
    /<article[^>]*id=["']description["'][^>]*>([\s\S]*?)<\/article>/i
  );

  if (!articleMatch) return "";

  const content = articleMatch[1];
  const parts = [];

  // Extract "The property" section with paragraphs
  const propertySection = content.match(
    /<h2>The property<\/h2>[\s\S]*?<div[^>]*class=["']columns["'][^>]*>([\s\S]*?)<\/div>/i
  );

  if (propertySection) {
    // Extract all paragraphs
    const paragraphs = propertySection[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const p of paragraphs) {
      let text = p[1]
        .replace(/<[^>]+>/g, "") // Remove HTML tags
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim();
      text = decodeHtmlEntities(text);
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
    /<ul\s+class=["']amenities["'][^>]*>([\s\S]*?)<\/ul>/i
  );

  if (listMatch) {
    const itemMatches = listMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
    for (const item of itemMatches) {
      let text = item[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      text = decodeHtmlEntities(text);
      if (text) {
        amenities.push(text);
      }
    }
  }

  return amenities;
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
function extractLocation(html, metaTags) {
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

  // Title from og:title or page title
  let title = metaTags["og:title"] || "";
  if (!title) {
    const titleMatch = html.match(/<title>([^|<]+)/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
  }

  // Meta description
  const metaDescription = metaTags["description"] || "";

  // Combine features from cottage_features section
  // Add pet-friendly if pets are allowed
  if (atAGlance.pets && !features.some((f) => /pet/i.test(f))) {
    features.push("Pet friendly");
  }

  // Get the main header image (og:image or first gallery image)
  const headerImage = metaTags["og:image"] || images[0] || "";

  // Build the full body content
  let body = "";
  if (description) {
    body = description;
  }

  // Add amenities as a list if we have them
  if (amenities.length > 0) {
    if (body) body += "\n\n";
    body += "## At a glance\n\n";
    body += amenities.map((a) => `- ${a}`).join("\n");
  }

  return {
    title,
    subtitle: location,
    thumbnail: headerImage,
    headerImage,
    featured: false,
    bedrooms: atAGlance.bedrooms,
    bathrooms: atAGlance.bathrooms,
    sleeps: atAGlance.sleeps,
    pricePerNight: null, // Not reliably extractable from static HTML
    features,
    gallery: images,
    body,
    metaTitle: title.substring(0, 55),
    metaDescription: metaDescription.substring(0, 155),
    sykesPropertyId: propertyId,
  };
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
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Retry ${i + 1}/${retries} after error: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
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

  const content =
    generateFrontMatter(frontMatter) + "\n" + (property.body || "") + "\n";

  writeFileSync(filepath, content, "utf8");
  return filepath;
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
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

  let url = "";
  let localFile = null;
  let outputDir = ".";
  let dryRun = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--file" && args[i + 1]) {
      localFile = args[++i];
    } else if (!args[i].startsWith("-")) {
      url = args[i];
    }
  }

  let html;

  if (localFile) {
    // Read from local file
    console.log(`Reading from file: ${localFile}`);
    try {
      html = readFileSync(localFile, "utf8");
      console.log(`Read ${html.length} bytes`);
      // Use a placeholder URL if reading from file
      if (!url) {
        url = `file://${localFile}`;
      }
    } catch (error) {
      console.error(`Error reading file: ${error.message}`);
      process.exit(1);
    }
  } else {
    // Fetch from URL
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
      html = await fetchWithRetry(url);
      console.log(`Fetched ${html.length} bytes`);
    } catch (error) {
      console.error(`Error fetching: ${error.message}`);
      process.exit(1);
    }
  }

  console.log("\nParsing property data...");
  const property = parseSykesPage(html, url);

  console.log(`\nExtracted property:`);
  console.log(`  Title: ${property.title}`);
  console.log(`  Subtitle: ${property.subtitle || "Not found"}`);
  console.log(`  Sleeps: ${property.sleeps || "Not found"}`);
  console.log(`  Bedrooms: ${property.bedrooms || "Not found"}`);
  console.log(`  Bathrooms: ${property.bathrooms || "Not found"}`);
  console.log(`  Features: ${property.features.length} found`);
  if (property.features.length > 0) {
    console.log(`    - ${property.features.slice(0, 5).join("\n    - ")}`);
    if (property.features.length > 5) {
      console.log(`    ... and ${property.features.length - 5} more`);
    }
  }
  console.log(`  Gallery images: ${property.gallery.length} found`);
  console.log(`  Description: ${property.body.length} characters`);

  if (dryRun) {
    console.log("\n--- DRY RUN ---");
    console.log(`\nWould create: properties/${slugify(property.title)}.md`);
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
      })
    );
    console.log("\nBody preview (first 500 chars):");
    console.log(property.body.substring(0, 500) + "...");
  } else {
    console.log(`\nWriting to: ${outputDir}`);
    const filepath = writePropertyFile(property, outputDir);
    console.log(`\n✓ Created: ${filepath}`);
  }
}

main();
