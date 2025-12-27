#!/usr/bin/env node

/**
 * Sykes Property Importer
 *
 * Fetches a Sykes Cottages listing page and converts it to a property
 * markdown file with YAML front matter.
 *
 * Usage:
 *   node scripts/import-sykes-property.js <sykes-url> [--output-dir <dir>]
 *
 * Example:
 *   node scripts/import-sykes-property.js https://www.sykescottages.co.uk/cottage/Lake-District-Yorkshire-Dales-South-Far-Ho/The-Old-Cart-House-1167031.html
 */

const { writeFileSync, mkdirSync, existsSync } = require("fs");
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
  if (!str) return "";
  if (
    /[:#\[\]{}|>&*!?,\n]/.test(str) ||
    str.includes('"') ||
    str.includes("'")
  ) {
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return str;
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
        yaml += `  - ${escapeYaml(String(item))}\n`;
      }
    } else if (typeof value === "number") {
      yaml += `${key}: ${value}\n`;
    } else {
      yaml += `${key}: ${escapeYaml(String(value))}\n`;
    }
  }

  yaml += "---\n";
  return yaml;
}

/**
 * Convert HTML to Markdown (basic conversion)
 */
function htmlToMarkdown(html) {
  if (!html) return "";

  let md = html;

  // Remove style and class attributes
  md = md.replace(/\s*style="[^"]*"/gi, "");
  md = md.replace(/\s*class="[^"]*"/gi, "");

  // Convert headers
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");

  // Convert paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gis, "$1\n\n");

  // Convert bold/strong
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");

  // Convert italic/em
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  // Convert unordered lists
  md = md.replace(/<ul[^>]*>/gi, "\n");
  md = md.replace(/<\/ul>/gi, "\n");
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gis, "- $1\n");

  // Convert ordered lists
  md = md.replace(/<ol[^>]*>/gi, "\n");
  md = md.replace(/<\/ol>/gi, "\n");

  // Convert line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Remove remaining HTML tags
  md = md.replace(/<div[^>]*>/gi, "");
  md = md.replace(/<\/div>/gi, "\n");
  md = md.replace(/<span[^>]*>/gi, "");
  md = md.replace(/<\/span>/gi, "");
  md = md.replace(/<[^>]+>/g, "");

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.replace(/^\s+|\s+$/g, "");

  // Decode HTML entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  return md;
}

/**
 * Extract JSON-LD structured data from HTML
 */
function extractJsonLd(html) {
  const jsonLdMatches = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  if (!jsonLdMatches) return [];

  const results = [];
  for (const match of jsonLdMatches) {
    const jsonMatch = match.match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (jsonMatch && jsonMatch[1]) {
      try {
        const data = JSON.parse(jsonMatch[1].trim());
        results.push(data);
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }

  return results;
}

/**
 * Extract meta tags from HTML
 */
function extractMetaTags(html) {
  const meta = {};

  // Open Graph tags
  const ogMatches = html.matchAll(
    /<meta[^>]*property=["']og:([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*\/?>/gi
  );
  for (const match of ogMatches) {
    meta[`og:${match[1]}`] = match[2];
  }

  // Also try content before property
  const ogMatches2 = html.matchAll(
    /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:([^"']+)["'][^>]*\/?>/gi
  );
  for (const match of ogMatches2) {
    meta[`og:${match[2]}`] = match[1];
  }

  // Standard meta tags
  const standardMatches = html.matchAll(
    /<meta[^>]*name=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*\/?>/gi
  );
  for (const match of standardMatches) {
    meta[match[1]] = match[2];
  }

  // Also try content before name
  const standardMatches2 = html.matchAll(
    /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']([^"']+)["'][^>]*\/?>/gi
  );
  for (const match of standardMatches2) {
    meta[match[2]] = match[1];
  }

  return meta;
}

/**
 * Extract property ID from Sykes URL
 */
function extractPropertyId(url) {
  // Pattern: The-Old-Cart-House-1167031.html -> 1167031
  const match = url.match(/-(\d+)\.html$/);
  return match ? match[1] : null;
}

/**
 * Parse Sykes property page and extract data
 */
function parseSykesPage(html, url) {
  const jsonLdData = extractJsonLd(html);
  const metaTags = extractMetaTags(html);
  const propertyId = extractPropertyId(url);

  // Find the LodgingBusiness or VacationRental schema
  let lodgingData = null;
  for (const data of jsonLdData) {
    if (data["@type"] === "LodgingBusiness" || data["@type"] === "VacationRental") {
      lodgingData = data;
      break;
    }
    // Check for @graph array
    if (data["@graph"]) {
      for (const item of data["@graph"]) {
        if (item["@type"] === "LodgingBusiness" || item["@type"] === "VacationRental") {
          lodgingData = item;
          break;
        }
      }
    }
  }

  // Extract title
  let title = "";
  if (lodgingData && lodgingData.name) {
    title = lodgingData.name;
  } else if (metaTags["og:title"]) {
    title = metaTags["og:title"].replace(/ \| Sykes.*$/, "");
  } else {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/ \| Sykes.*$/, "");
    }
  }

  // Extract description
  let description = "";
  if (lodgingData && lodgingData.description) {
    description = lodgingData.description;
  } else if (metaTags["og:description"]) {
    description = metaTags["og:description"];
  } else if (metaTags["description"]) {
    description = metaTags["description"];
  }

  // Extract location
  let location = "";
  if (lodgingData && lodgingData.address) {
    const addr = lodgingData.address;
    const parts = [];
    if (addr.addressLocality) parts.push(addr.addressLocality);
    if (addr.addressRegion) parts.push(addr.addressRegion);
    location = parts.join(", ");
  }

  // Extract images
  const images = [];
  if (lodgingData && lodgingData.image) {
    if (Array.isArray(lodgingData.image)) {
      images.push(...lodgingData.image);
    } else {
      images.push(lodgingData.image);
    }
  }
  if (metaTags["og:image"] && !images.includes(metaTags["og:image"])) {
    images.unshift(metaTags["og:image"]);
  }

  // Extract property details from HTML patterns
  // Sykes typically shows "Sleeps X" and "X Bedrooms" in the page
  let sleeps = null;
  let bedrooms = null;
  let bathrooms = null;

  const sleepsMatch = html.match(/sleeps?\s*(\d+)/i);
  if (sleepsMatch) sleeps = parseInt(sleepsMatch[1], 10);

  const bedroomsMatch = html.match(/(\d+)\s*bedroom/i);
  if (bedroomsMatch) bedrooms = parseInt(bedroomsMatch[1], 10);

  const bathroomsMatch = html.match(/(\d+)\s*bathroom/i);
  if (bathroomsMatch) bathrooms = parseInt(bathroomsMatch[1], 10);

  // Extract features/amenities
  const features = [];

  // Look for common amenity patterns
  const amenityPatterns = [
    /\bwifi\b/i,
    /\bwi-fi\b/i,
    /\bparking\b/i,
    /\bpet[s]?\s*(?:friendly|welcome|allowed)\b/i,
    /\bgarden\b/i,
    /\bopen\s*fire\b/i,
    /\bwood\s*(?:burning|burner)\b/i,
    /\bdishwasher\b/i,
    /\bwashing\s*machine\b/i,
    /\bhot\s*tub\b/i,
    /\bpool\b/i,
    /\bking[- ]?size\b/i,
    /\bensuite\b/i,
    /\ben-suite\b/i,
    /\bcentral\s*heating\b/i,
    /\belectric\s*heating\b/i,
  ];

  for (const pattern of amenityPatterns) {
    const match = html.match(pattern);
    if (match) {
      // Normalize the feature name
      let feature = match[0].toLowerCase().replace(/[-\s]+/g, " ").trim();
      feature = feature.charAt(0).toUpperCase() + feature.slice(1);
      if (!features.includes(feature)) {
        features.push(feature);
      }
    }
  }

  // Look for features in data attributes or JSON
  const featuresMatch = html.match(
    /(?:features|amenities|facilities)["']?\s*:\s*\[([^\]]+)\]/i
  );
  if (featuresMatch) {
    const featureItems = featuresMatch[1].match(/["']([^"']+)["']/g);
    if (featureItems) {
      for (const item of featureItems) {
        const feature = item.replace(/["']/g, "").trim();
        if (feature && !features.includes(feature)) {
          features.push(feature);
        }
      }
    }
  }

  // Extract price if available
  let priceFrom = null;
  const priceMatch = html.match(/(?:from|price)[:\s]*[£$]?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i);
  if (priceMatch) {
    priceFrom = `£${priceMatch[1].replace(/,/g, "")}`;
  }

  // Extract property type
  let propertyType = "Cottage";
  if (/\bapartment\b/i.test(html)) propertyType = "Apartment";
  else if (/\bhouse\b/i.test(html)) propertyType = "House";
  else if (/\bbarn\b/i.test(html)) propertyType = "Barn";
  else if (/\bfarmhouse\b/i.test(html)) propertyType = "Farmhouse";
  else if (/\blodge\b/i.test(html)) propertyType = "Lodge";
  else if (/\bchalet\b/i.test(html)) propertyType = "Chalet";
  else if (/\bbungalow\b/i.test(html)) propertyType = "Bungalow";
  else if (/\bcart\s*house\b/i.test(html)) propertyType = "Cart House";

  // Extract full description from the page
  let fullDescription = "";

  // Try to find the main description section
  const descPatterns = [
    /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*id="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*data-section="description"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      fullDescription = htmlToMarkdown(match[1]);
      break;
    }
  }

  // Fall back to meta description if no body description found
  if (!fullDescription) {
    fullDescription = description;
  }

  return {
    title,
    subtitle: location || propertyType,
    location,
    sleeps,
    bedrooms,
    bathrooms,
    propertyType,
    features,
    images,
    priceFrom,
    description: fullDescription,
    metaDescription: description,
    metaTitle: title,
    sykesUrl: url,
    sykesId: propertyId,
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

  const frontMatter = {
    title: property.title,
    subtitle: property.subtitle,
    location: property.location,
    sleeps: property.sleeps,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    property_type: property.propertyType,
    features: property.features,
    header_image: property.images[0] || null,
    gallery: property.images.slice(1),
    price_from: property.priceFrom,
    sykes_url: property.sykesUrl,
    sykes_id: property.sykesId,
    header_text: property.title,
    meta_description: property.metaDescription,
    meta_title: property.metaTitle,
  };

  const content =
    generateFrontMatter(frontMatter) + "\n" + (property.description || "") + "\n";

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

Options:
  --output-dir <dir>  Output directory (default: .)
  --dry-run           Show what would be created without writing files
  --help, -h          Show this help message

Example:
  node scripts/import-sykes-property.js https://www.sykescottages.co.uk/cottage/Lake-District-Yorkshire-Dales-South-Far-Ho/The-Old-Cart-House-1167031.html
`);
    process.exit(0);
  }

  const url = args[0];
  let outputDir = ".";
  let dryRun = false;

  // Parse arguments
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  // Validate URL
  if (!url.includes("sykescottages.co.uk")) {
    console.error("Error: URL must be a Sykes Cottages listing URL");
    process.exit(1);
  }

  console.log(`Fetching: ${url}`);

  try {
    const html = await fetchWithRetry(url);
    console.log(`Fetched ${html.length} bytes`);

    console.log("\nParsing property data...");
    const property = parseSykesPage(html, url);

    console.log(`\nExtracted property:`);
    console.log(`  Title: ${property.title}`);
    console.log(`  Location: ${property.location || "Not found"}`);
    console.log(`  Sleeps: ${property.sleeps || "Not found"}`);
    console.log(`  Bedrooms: ${property.bedrooms || "Not found"}`);
    console.log(`  Bathrooms: ${property.bathrooms || "Not found"}`);
    console.log(`  Type: ${property.propertyType}`);
    console.log(`  Features: ${property.features.length} found`);
    console.log(`  Images: ${property.images.length} found`);
    console.log(`  Sykes ID: ${property.sykesId || "Not found"}`);

    if (dryRun) {
      console.log("\n--- DRY RUN ---");
      console.log(`\nWould create: properties/${slugify(property.title)}.md`);
      console.log("\nFront matter preview:");
      console.log(
        generateFrontMatter({
          title: property.title,
          subtitle: property.subtitle,
          location: property.location,
          sleeps: property.sleeps,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          property_type: property.propertyType,
          features: property.features.slice(0, 5),
          sykes_id: property.sykesId,
        })
      );
    } else {
      console.log(`\nWriting to: ${outputDir}`);
      const filepath = writePropertyFile(property, outputDir);
      console.log(`\n✓ Created: ${filepath}`);
    }
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

main();
