#!/usr/bin/env node

/**
 * TouchStay Guide Parser
 *
 * Parses TouchStay JSON export and converts it to guide categories and guide pages
 * following the existing schema (markdown files with YAML front matter).
 *
 * Usage:
 *   node scripts/parse-touchstay-guide.js <input.json> [--output-dir <dir>]
 *
 * Example:
 *   node scripts/parse-touchstay-guide.js touchstay.json --output-dir .
 */

const fs = require("node:fs");
const { join } = require("node:path");
const { parseArgv, wantsHelp } = require("./cli-utils.js");
const { slugify } = require("./text-utils.js");

// Icon mapping from TouchStay category icons to local icons
const ICON_MAP = {
  "icon-Hand": "icons/touchstay/vacation_rental.svg",
  "icon-Star": "icons/touchstay/sightseeing.svg",
  "icon-Numbers": "icons/touchstay/luggage_storage.svg",
  "icon-Key": "icons/touchstay/key_collection.svg",
  "icon-House": "icons/touchstay/vacation_rental.svg",
  "icon-Pin-1": "icons/touchstay/sightseeing.svg",
  "icon-Wifi": "icons/touchstay/coffee_shop.svg",
  "icon-Book-Open": "icons/touchstay/sightseeing.svg",
  "icon-Suitcase": "icons/touchstay/luggage_storage.svg",
};

// Default icon if no mapping exists
const DEFAULT_ICON = "icons/touchstay/sightseeing.svg";

// Map pin icon type to local SVG filename
const MAP_ICON_MAP = {
  vacation_rental: "vacation_rental.svg",
  key_collection: "key_collection.svg",
  sightseeing: "sightseeing.svg",
  luggage_storage: "luggage_storage.svg",
  restaurants: "restaurants.svg",
  hiking: "hiking.svg",
  coffee_shop: "coffee_shop.svg",
  swimming: "swimming.svg",
  train: "train.svg",
  taxi: "taxi.svg",
};

/**
 * Convert HTML to Markdown
 * Basic conversion for common HTML elements
 */
function htmlToMarkdown(html) {
  if (!html) return "";

  let md = html;

  // Remove style attributes
  md = md.replace(/\s*style="[^"]*"/gi, "");

  // Remove class attributes
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

  // Convert images - extract src and alt
  md = md.replace(
    /<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi,
    "![$2]($1)",
  );
  md = md.replace(
    /<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi,
    "![$1]($2)",
  );
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Convert unordered lists
  md = md.replace(/<ul[^>]*>/gi, "\n");
  md = md.replace(/<\/ul>/gi, "\n");
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gis, "- $1\n");

  // Convert ordered lists (simplified)
  md = md.replace(/<ol[^>]*>/gi, "\n");
  md = md.replace(/<\/ol>/gi, "\n");

  // Convert line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Convert iframes (YouTube embeds) to links
  md = md.replace(
    /<iframe[^>]*src="([^"]*youtube[^"]*)"[^>]*><\/iframe>/gi,
    "\n[Watch Video]($1)\n",
  );
  md = md.replace(
    /<iframe[^>]*src="([^"]*)"[^>]*><\/iframe>/gi,
    "\n[Embedded Content]($1)\n",
  );

  // Remove remaining HTML tags
  md = md.replace(/<div[^>]*>/gi, "");
  md = md.replace(/<\/div>/gi, "\n");
  md = md.replace(/<span[^>]*>/gi, "");
  md = md.replace(/<\/span>/gi, "");

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n"); // Max 2 newlines
  md = md.replace(/^\s+|\s+$/g, ""); // Trim

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
 * Escape special characters in YAML strings
 */
function escapeYaml(str) {
  if (!str) return "";
  // If the string contains special characters, wrap in quotes
  if (
    /[:#[\]{}|>&*!?,\n]/.test(str) ||
    str.includes('"') ||
    str.includes("'")
  ) {
    return `"${str.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return str;
}

/**
 * Format one item of a front matter array
 */
function formatFrontMatterItem(item) {
  if (typeof item !== "object") {
    return `  - ${escapeYaml(String(item))}\n`;
  }

  return Object.entries(item).reduce(
    (acc, [key, value], index) =>
      `${acc}${index === 0 ? "" : "    "}${key}: ${escapeYaml(String(value))}\n`,
    "  - ",
  );
}

/**
 * Format one key/value pair of front matter
 */
function frontMatterEntry(key, value) {
  if (value === null || value === undefined) return "";
  if (!Array.isArray(value)) return `${key}: ${escapeYaml(String(value))}\n`;

  return `${key}:\n${value.map(formatFrontMatterItem).join("")}`;
}

/**
 * Generate YAML front matter from an object
 */
function generateFrontMatter(data) {
  const entries = Object.entries(data)
    .map(([key, value]) => frontMatterEntry(key, value))
    .join("");

  return `---\n${entries}---\n`;
}

/**
 * Build a guide category entry
 */
function buildCategory(categoryData, categoryIndex) {
  const title =
    categoryData.title_translations?.en || `Category ${categoryIndex + 1}`;

  return {
    slug: slugify(title),
    frontMatter: {
      title: title,
      subtitle: `${title} information and guides`,
      order: categoryIndex + 1,
      icon: ICON_MAP[categoryData.icon] || DEFAULT_ICON,
    },
    content: `# ${title}\n\nExplore the guides in this section to learn more.`,
  };
}

/**
 * Build a guide page entry for one topic
 */
function buildPage(topic, category, sectionTitle, order) {
  const translations = topic.translations?.en || {};
  const topicTitle = translations.title || "Untitled Topic";
  const description = translations.description || "";

  const frontMatter = {
    title: topicTitle,
    subtitle:
      sectionTitle === topicTitle ? category.frontMatter.title : sectionTitle,
    "guide-category": category.slug,
    order: order,
  };

  if (topic.photo) {
    frontMatter.featured_image = topic.photo;
  }

  return {
    slug: `${category.slug}-${slugify(topicTitle)}`,
    frontMatter,
    content:
      htmlToMarkdown(description) || `# ${topicTitle}\n\nContent coming soon.`,
  };
}

/**
 * Build the pages for every subcategory of a category
 */
function buildCategoryPages(categoryData, category) {
  const pages = [];

  for (const subcategory of categoryData.subcategories || []) {
    const sectionTitle =
      subcategory.title_translations?.en || "Untitled Section";

    for (const topic of subcategory.topics || []) {
      pages.push(buildPage(topic, category, sectionTitle, pages.length + 1));
    }
  }

  return pages;
}

/**
 * Parse the TouchStay JSON and extract categories and pages
 */
function parseTouchStayGuide(jsonData) {
  const categories = [];
  const pages = [];

  const infoContent = jsonData.content?.info_content || [];

  for (const [categoryIndex, categoryData] of infoContent.entries()) {
    const category = buildCategory(categoryData, categoryIndex);
    categories.push(category);
    pages.push(...buildCategoryPages(categoryData, category));
  }

  return { categories, pages };
}

/**
 * Build the icon type lookup from map.icons
 */
function buildIconTypes(icons) {
  const iconTypes = {};

  for (const icon of icons) {
    iconTypes[icon.type] = {
      label: icon.translations?.en || icon.type,
      originalUrl: icon.url,
      localIcon: MAP_ICON_MAP[icon.type]
        ? `icons/touchstay/${MAP_ICON_MAP[icon.type]}`
        : null,
    };
  }

  return iconTypes;
}

/**
 * English translations of a TouchStay entity, or an empty object
 */
function translationsEn(entity) {
  const translations = entity.translations;
  if (!translations) return {};
  return translations.en || {};
}

/**
 * Label for a map marker type
 */
function markerLabel(markerType, iconTypes) {
  const iconType = iconTypes[markerType] || {};
  return iconType.label || markerType;
}

/**
 * Local icon path for a map marker type
 */
function markerIcon(markerType, iconTypes) {
  const iconType = iconTypes[markerType] || {};
  return iconType.localIcon || `icons/touchstay/${markerType}.svg`;
}

/**
 * Coordinates for a map place
 */
function markerLocation(marker) {
  const location = marker.location || {};
  return { lat: location.lat, lng: location.lng };
}

/**
 * Build one map place from a marker
 */
function buildMapPlace(marker, iconTypes) {
  const translations = translationsEn(marker);
  const markerType = marker.marker_type || "other";
  const icon = marker.icon || {};

  return {
    id: marker.id,
    title: translations.title || "Untitled",
    description: translations.description || "",
    category: markerType,
    categoryLabel: markerLabel(markerType, iconTypes),
    location: markerLocation(marker),
    directionsUrl: marker.get_directions_url || null,
    icon: markerIcon(markerType, iconTypes),
    iconUrl: icon.url || null,
  };
}

/**
 * Extract map places from TouchStay JSON
 */
function extractMapPlaces(jsonData) {
  const iconTypes = buildIconTypes(jsonData.map?.icons || []);
  const markers = jsonData.map?.info_markers || [];

  return {
    places: markers.map((marker) => buildMapPlace(marker, iconTypes)),
    iconTypes,
  };
}

/**
 * Write map places to JSON file
 */
function writeMapPlaces(places, iconTypes, outputDir) {
  const dataDir = join(outputDir, "_data");

  // Ensure directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const outputData = {
    places,
    categories: Object.entries(iconTypes).map(([type, info]) => ({
      type,
      label: info.label,
      icon: info.localIcon,
    })),
  };

  const filepath = join(dataDir, "map_places.json");
  fs.writeFileSync(filepath, JSON.stringify(outputData, null, 2), "utf8");
  console.log(`✓ Created map places: ${filepath} (${places.length} places)`);

  return filepath;
}

/**
 * Write guide categories and pages to disk
 */
function writeGuideFiles(categories, pages, outputDir) {
  const categoriesDir = join(outputDir, "guide-categories");
  const pagesDir = join(outputDir, "guide-pages");

  // Ensure directories exist
  if (!fs.existsSync(categoriesDir)) {
    fs.mkdirSync(categoriesDir, { recursive: true });
  }
  if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
  }

  // Write categories
  const writtenCategories = [];
  for (const category of categories) {
    const filename = `${category.slug}.md`;
    const filepath = join(categoriesDir, filename);
    const content =
      generateFrontMatter(category.frontMatter) +
      "\n" +
      category.content +
      "\n";

    fs.writeFileSync(filepath, content, "utf8");
    writtenCategories.push(filepath);
    console.log(`✓ Created category: ${filename}`);
  }

  // Write pages
  const writtenPages = [];
  for (const page of pages) {
    const filename = `${page.slug}.md`;
    const filepath = join(pagesDir, filename);
    const content = `${generateFrontMatter(page.frontMatter)}\n${page.content}\n`;

    fs.writeFileSync(filepath, content, "utf8");
    writtenPages.push(filepath);
    console.log(`✓ Created page: ${filename}`);
  }

  return { writtenCategories, writtenPages };
}

/**
 * Read and parse the TouchStay JSON input file
 */
function readGuideJson(inputFile) {
  console.log(`Reading input file: ${inputFile}`);
  try {
    return JSON.parse(fs.readFileSync(inputFile, "utf8"));
  } catch (error) {
    console.error(`Error reading input file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Report what a run would create without writing anything
 */
function printDryRun(categories, pages, places) {
  console.log("\n--- DRY RUN ---");
  console.log("\nCategories that would be created:");
  for (const category of categories) console.log(`  - ${category.slug}.md`);
  console.log("\nPages that would be created:");
  for (const page of pages) console.log(`  - ${page.slug}.md`);
  console.log("\nMap places that would be exported:");
  console.log(`  - _data/map_places.json (${places.length} places)`);
  console.log("\nNo files were written (dry run mode)");
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  if (wantsHelp(args)) {
    console.log(`
TouchStay Guide Parser

Converts TouchStay JSON export to guide categories and guide pages.

Usage:
  node scripts/parse-touchstay-guide.js <input.json> [options]

Options:
  --output-dir <dir>  Output directory (default: .)
  --dry-run           Show what would be created without writing files
  --help, -h          Show this help message

Example:
  node scripts/parse-touchstay-guide.js touchstay.json --output-dir .
`);
    process.exit(0);
  }

  const inputFile = args[0];
  const parsed = parseArgv(args.slice(1), {
    value: { "--output-dir": "outputDir" },
    boolean: { "--dry-run": "dryRun" },
  });
  const outputDir = parsed.outputDir ?? ".";
  const dryRun = Boolean(parsed.dryRun);

  const jsonData = readGuideJson(inputFile);

  // Parse the data
  console.log("\nParsing TouchStay guide data...");
  const { categories, pages } = parseTouchStayGuide(jsonData);
  const { places, iconTypes } = extractMapPlaces(jsonData);

  console.log(
    `\nFound ${categories.length} categories and ${pages.length} pages`,
  );
  console.log(`Found ${places.length} map places`);

  if (dryRun) {
    printDryRun(categories, pages, places);
    return;
  }

  console.log(`\nWriting files to: ${outputDir}`);
  const { writtenCategories, writtenPages } = writeGuideFiles(
    categories,
    pages,
    outputDir,
  );
  writeMapPlaces(places, iconTypes, outputDir);

  console.log(
    `\n✓ Successfully created ${writtenCategories.length} categories`,
  );
  console.log(`✓ Successfully created ${writtenPages.length} pages`);
}

main();
