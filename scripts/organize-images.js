#!/usr/bin/env node

/**
 * Image Organization Script
 *
 * Organizes property images into a clean directory structure:
 *   images/properties/{property-slug}/{slugified-alt-text}.jpeg
 *
 * Features:
 * - Moves images into property-specific folders
 * - Renames images using slugified alt text
 * - Updates all references in property markdown files
 * - Updates alt-tags.json with new paths
 * - Deletes unused images
 *
 * Usage:
 *   node scripts/organize-images.js
 *   node scripts/organize-images.js --dry-run
 *
 * Options:
 *   --dry-run    Preview changes without modifying files
 *   --help, -h   Show help
 */

const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readdirSync,
  copyFileSync,
} = require("node:fs");
const { join, basename, dirname, extname } = require("node:path");

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  imagesDir: "images",
  propertiesImagesDir: "images/properties",
  propertiesDir: "properties",
  dataDir: "_data",
  altTagsFile: "_data/alt-tags.json",
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert text to a URL-friendly slug
 * Optimized for alt text - removes common suffixes and limits length
 */
function slugify(text, maxLength = 60) {
  if (!text) return null;

  // Remove common location suffixes that appear in all alt texts
  const cleaned = text
    .replace(/\s+at\s+The\s+Old\s+Cart\s+House.*$/i, "")
    .replace(/\s+in\s+Garsdale.*$/i, "")
    .replace(/\s+near\s+Sedbergh.*$/i, "");

  return cleaned
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, maxLength);
}

/**
 * Parse YAML front matter from markdown file
 * Simple parser that handles the fields we need
 */
const ARRAY_ITEM_RE = /^\s+-\s+/;
const KEY_VALUE_RE = /^(\w+):\s*(.*)$/;
const unquote = (value) => value.replace(/^["']|["']$/g, "");

/**
 * Apply one front matter line to the parse state
 */
function applyYamlLine(state, line) {
  if (ARRAY_ITEM_RE.test(line)) {
    if (state.key && state.inArray) {
      state.result[state.key].push(unquote(line.replace(ARRAY_ITEM_RE, "")));
    }
    return;
  }

  const keyMatch = line.match(KEY_VALUE_RE);
  if (!keyMatch) return;

  state.key = keyMatch[1];
  const value = unquote(keyMatch[2]);
  state.result[state.key] = value === "" ? [] : value;
  state.inArray = value === "";
}

function parseYamlFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const state = { result: {}, key: null, inArray: false };
  for (const line of match[1].split("\n")) {
    applyYamlLine(state, line);
  }

  return state.result;
}

/**
 * Stringify YAML-like structure back to front matter
 * Preserves the original format
 */
function updateMarkdownImagePaths(content, pathMapping) {
  let updated = content;
  for (const [oldPath, newPath] of Object.entries(pathMapping)) {
    // Replace all occurrences of the old path with the new one
    updated = updated.split(oldPath).join(newPath);
  }
  return updated;
}

/**
 * Get property slug from filename
 */
function getPropertySlug(filename) {
  return basename(filename, ".md");
}

/**
 * Make filename unique by appending counter if needed
 */
function makeUniqueFilename(baseName, ext, existingNames) {
  let name = baseName;
  let counter = 1;

  while (existingNames.has(name + ext)) {
    name = `${baseName}-${counter}`;
    counter++;
  }

  existingNames.add(name + ext);
  return name + ext;
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Image paths referenced by one property's front matter
 */
function imagesFor(frontMatter) {
  const images = new Set();

  if (frontMatter.thumbnail) {
    images.add(frontMatter.thumbnail);
  }

  if (frontMatter.header_image) {
    images.add(frontMatter.header_image);
  }

  if (Array.isArray(frontMatter.gallery)) {
    for (const img of frontMatter.gallery) {
      images.add(img);
    }
  }

  return images;
}

/**
 * Record the image references of one property file
 */
function collectFileImages(file, propertiesDir, imageToProperty) {
  const filePath = join(propertiesDir, file);
  const frontMatter = parseYamlFrontMatter(readFileSync(filePath, "utf-8"));
  if (!frontMatter) return;

  const propertySlug = getPropertySlug(file);
  const images = imagesFor(frontMatter);

  for (const img of images) {
    imageToProperty.set(img, propertySlug);
  }

  console.log(
    `  Found ${images.size} unique images in ${file} (${propertySlug})`,
  );
}

/**
 * Collect all image references from property files
 */
function collectImageReferences() {
  const propertiesDir = CONFIG.propertiesDir;
  const imageToProperty = new Map(); // imagePath -> propertySlug

  if (!existsSync(propertiesDir)) {
    console.error(`Properties directory not found: ${propertiesDir}`);
    return { imageToProperty };
  }

  const files = readdirSync(propertiesDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    collectFileImages(file, propertiesDir, imageToProperty);
  }

  return { imageToProperty };
}

/**
 * Load alt tags from JSON file
 */
function loadAltTags() {
  const altTagsPath = CONFIG.altTagsFile;
  if (!existsSync(altTagsPath)) {
    console.error(`Alt tags file not found: ${altTagsPath}`);
    return new Map();
  }

  const data = JSON.parse(readFileSync(altTagsPath, "utf-8"));
  const altMap = new Map();

  // Deduplicate - use the first occurrence of each path
  for (const item of data.images || []) {
    if (!altMap.has(item.path)) {
      altMap.set(item.path, item.alt);
    }
  }

  return altMap;
}

/**
 * Get all image files currently on disk
 */
function getExistingImages() {
  const imagesDir = CONFIG.imagesDir;
  const images = new Set();

  if (!existsSync(imagesDir)) {
    return images;
  }

  const files = readdirSync(imagesDir);
  for (const file of files) {
    if (
      file.match(/\.(jpeg|jpg|png|gif|webp)$/i) &&
      !file.startsWith(".") &&
      file !== "properties"
    ) {
      images.add(`/images/${file}`);
    }
  }

  return images;
}

/**
 * Base filename for an image: slugified alt text, or the original filename
 */
function baseNameFor(imagePath, ext, alt) {
  if (alt) {
    const baseSlug = slugify(alt);
    if (baseSlug) return baseSlug;
  }

  return basename(imagePath, ext);
}

/**
 * Build the mapping of old paths to new paths
 */
function buildPathMapping(imageToProperty, altTags) {
  const pathMapping = {}; // oldPath -> newPath
  const usedNames = new Map(); // propertySlug -> Set of used filenames

  for (const [imagePath, propertySlug] of imageToProperty) {
    const ext = extname(imagePath) || ".jpeg";

    // Initialize used names set for this property
    if (!usedNames.has(propertySlug)) {
      usedNames.set(propertySlug, new Set());
    }

    const newFilename = makeUniqueFilename(
      baseNameFor(imagePath, ext, altTags.get(imagePath)),
      ext,
      usedNames.get(propertySlug),
    );

    pathMapping[imagePath] =
      `/images/properties/${propertySlug}/${newFilename}`;
  }

  return pathMapping;
}

/**
 * Create the per-property image directories
 */
function createImageDirs(imageToProperty, dryRun) {
  const propertyDirs = new Set(Object.values(imageToProperty));

  for (const propertySlug of propertyDirs) {
    const dirPath = join(CONFIG.propertiesImagesDir, propertySlug);
    if (existsSync(dirPath)) continue;

    if (dryRun) {
      console.log(`  Would create directory: ${dirPath}`);
      continue;
    }

    mkdirSync(dirPath, { recursive: true });
    console.log(`  Created directory: ${dirPath}`);
  }
}

/**
 * Move one image, reporting whether it was found
 */
function moveImage(oldPath, newPath, dryRun) {
  const oldFilePath = join(".", oldPath);
  const newFilePath = join(".", newPath);

  if (!existsSync(oldFilePath)) {
    console.log(`  Warning: Source file not found: ${oldFilePath}`);
    return false;
  }

  if (dryRun) {
    console.log(`  Would move: ${oldPath} -> ${newPath}`);
    return true;
  }

  // Ensure destination directory exists
  mkdirSync(dirname(newFilePath), { recursive: true });
  // Copy then delete (safer than rename across filesystems)
  copyFileSync(oldFilePath, newFilePath);
  unlinkSync(oldFilePath);
  console.log(`  Moved: ${basename(oldPath)} -> ${newPath}`);
  return true;
}

/**
 * Move and rename every image in the mapping
 */
function moveImages(pathMapping, dryRun) {
  console.log("\nMoving and renaming images...");
  let movedCount = 0;

  for (const [oldPath, newPath] of Object.entries(pathMapping)) {
    if (moveImage(oldPath, newPath, dryRun)) movedCount++;
  }

  console.log(
    `  Total: ${movedCount} images ${dryRun ? "would be " : ""}moved`,
  );
}

/**
 * Rewrite image paths in the property markdown files
 */
function updatePropertyFiles(pathMapping, dryRun) {
  console.log("\nUpdating property files...");
  const propertyFiles = readdirSync(CONFIG.propertiesDir).filter((f) =>
    f.endsWith(".md"),
  );

  for (const file of propertyFiles) {
    const filePath = join(CONFIG.propertiesDir, file);
    const content = readFileSync(filePath, "utf-8");
    const updatedContent = updateMarkdownImagePaths(content, pathMapping);
    if (content === updatedContent) continue;

    if (dryRun) {
      console.log(`  Would update: ${file}`);
      continue;
    }

    writeFileSync(filePath, updatedContent);
    console.log(`  Updated: ${file}`);
  }
}

/**
 * Repoint alt tag entries at their new paths, dropping duplicates
 */
function remapAltImages(altData, pathMapping) {
  const seenPaths = new Set();
  const updatedImages = [];

  for (const item of altData.images || []) {
    const newPath = pathMapping[item.path] || item.path;

    // Skip duplicates
    if (seenPaths.has(newPath)) continue;
    seenPaths.add(newPath);

    updatedImages.push({
      path: newPath,
      alt: item.alt,
    });
  }

  return updatedImages;
}

/**
 * Rewrite image paths in alt-tags.json
 */
function updateAltTagsFile(pathMapping, dryRun) {
  console.log("\nUpdating alt-tags.json...");
  const altTagsPath = CONFIG.altTagsFile;
  if (!existsSync(altTagsPath)) return;

  const altData = JSON.parse(readFileSync(altTagsPath, "utf-8"));
  const updatedImages = remapAltImages(altData, pathMapping);

  if (!dryRun) {
    writeFileSync(
      altTagsPath,
      `${JSON.stringify({ images: updatedImages }, null, 2)}\n`,
    );
  }

  const prefix = dryRun ? "  Would update" : "  Updated";
  console.log(
    `${prefix} alt-tags.json (${updatedImages.length} unique entries)`,
  );
}

/**
 * Apply the changes
 */
function applyChanges(pathMapping, imageToProperty, dryRun) {
  createImageDirs(imageToProperty, dryRun);
  moveImages(pathMapping, dryRun);
  updatePropertyFiles(pathMapping, dryRun);
  updateAltTagsFile(pathMapping, dryRun);
}

/**
 * Delete unused images
 */
function deleteUnusedImages(usedImages, dryRun) {
  const unusedImages = [...getExistingImages()].filter(
    (img) => !usedImages.has(img),
  );

  if (unusedImages.length === 0) {
    console.log("\nNo unused images to delete.");
    return;
  }

  console.log(`\nDeleting ${unusedImages.length} unused images...`);
  for (const img of unusedImages) {
    if (dryRun) {
      console.log(`  Would delete: ${img}`);
      continue;
    }

    unlinkSync(join(".", img));
    console.log(`  Deleted: ${img}`);
  }
}

/**
 * Main entry point
 */
function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Image Organization Script

Organizes property images into a clean directory structure:
  images/properties/{property-slug}/{slugified-alt-text}.jpeg

Usage:
  node scripts/organize-images.js
  node scripts/organize-images.js --dry-run

Options:
  --dry-run    Preview changes without modifying files
  --help, -h   Show this help message
`);
    process.exit(0);
  }

  console.log("=".repeat(60));
  console.log("Image Organization Script");
  console.log("=".repeat(60));

  if (dryRun) {
    console.log("\n*** DRY RUN MODE - No changes will be made ***\n");
  }

  // Step 1: Collect all image references from property files
  console.log("\nStep 1: Scanning property files for image references...");
  const { imageToProperty } = collectImageReferences();

  if (imageToProperty.size === 0) {
    console.log("No images found in property files. Exiting.");
    process.exit(0);
  }

  console.log(`  Total unique images referenced: ${imageToProperty.size}`);

  // Step 2: Load alt tags
  console.log("\nStep 2: Loading alt tags...");
  const altTags = loadAltTags();
  console.log(`  Loaded ${altTags.size} alt tags`);

  // Step 3: Build path mapping
  console.log("\nStep 3: Building path mapping...");
  const pathMapping = buildPathMapping(imageToProperty, altTags);
  console.log(
    `  Created mappings for ${Object.keys(pathMapping).length} images`,
  );

  // Show some examples
  console.log("\n  Sample mappings:");
  const examples = Object.entries(pathMapping).slice(0, 5);
  for (const [oldPath, newPath] of examples) {
    console.log(`    ${basename(oldPath)}`);
    console.log(`      -> ${newPath}`);
  }

  // Step 4: Apply changes
  console.log("\nStep 4: Applying changes...");
  applyChanges(pathMapping, imageToProperty, dryRun);

  // Step 5: Delete unused images
  console.log("\nStep 5: Checking for unused images...");
  const usedImages = new Set(imageToProperty.keys());
  deleteUnusedImages(usedImages, dryRun);

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  if (dryRun) {
    console.log("DRY RUN COMPLETE - No changes were made");
    console.log("Run without --dry-run to apply changes");
  } else {
    console.log("COMPLETE - Images have been organized");
  }
  console.log("=".repeat(60));
}

// Run the script
main();
