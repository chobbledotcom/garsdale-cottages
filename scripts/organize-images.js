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
  renameSync,
  copyFileSync,
} = require("fs");
const { join, basename, dirname, extname } = require("path");

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
  let cleaned = text
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
function parseYamlFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result = {};

  // Parse simple key: value pairs and arrays
  const lines = yaml.split("\n");
  let currentKey = null;
  let inArray = false;

  for (const line of lines) {
    // Check for array item
    if (line.match(/^\s+-\s+/)) {
      if (currentKey && inArray) {
        const value = line.replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, "");
        result[currentKey].push(value);
      }
      continue;
    }

    // Check for key: value
    const keyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2].replace(/^["']|["']$/g, "");

      if (value === "") {
        // This could be an array
        result[currentKey] = [];
        inArray = true;
      } else {
        result[currentKey] = value;
        inArray = false;
      }
    }
  }

  return result;
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
 * Collect all image references from property files
 */
function collectImageReferences() {
  const propertiesDir = CONFIG.propertiesDir;
  const imageToProperty = new Map(); // imagePath -> propertySlug
  const propertyImages = new Map(); // propertySlug -> Set of imagePaths

  if (!existsSync(propertiesDir)) {
    console.error(`Properties directory not found: ${propertiesDir}`);
    return { imageToProperty, propertyImages };
  }

  const files = readdirSync(propertiesDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const filePath = join(propertiesDir, file);
    const content = readFileSync(filePath, "utf-8");
    const frontMatter = parseYamlFrontMatter(content);

    if (!frontMatter) continue;

    const propertySlug = getPropertySlug(file);
    const images = new Set();

    // Collect thumbnail
    if (frontMatter.thumbnail) {
      images.add(frontMatter.thumbnail);
    }

    // Collect header_image
    if (frontMatter.header_image) {
      images.add(frontMatter.header_image);
    }

    // Collect gallery images
    if (Array.isArray(frontMatter.gallery)) {
      for (const img of frontMatter.gallery) {
        images.add(img);
      }
    }

    propertyImages.set(propertySlug, images);

    for (const img of images) {
      imageToProperty.set(img, propertySlug);
    }

    console.log(
      `  Found ${images.size} unique images in ${file} (${propertySlug})`
    );
  }

  return { imageToProperty, propertyImages };
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
 * Build the mapping of old paths to new paths
 */
function buildPathMapping(imageToProperty, altTags) {
  const pathMapping = {}; // oldPath -> newPath
  const usedNames = new Map(); // propertySlug -> Set of used filenames

  for (const [imagePath, propertySlug] of imageToProperty) {
    const alt = altTags.get(imagePath);
    const ext = extname(imagePath) || ".jpeg";

    // Initialize used names set for this property
    if (!usedNames.has(propertySlug)) {
      usedNames.set(propertySlug, new Set());
    }

    let newFilename;

    if (alt) {
      // Use slugified alt text
      const baseSlug = slugify(alt);
      if (baseSlug) {
        newFilename = makeUniqueFilename(
          baseSlug,
          ext,
          usedNames.get(propertySlug)
        );
      } else {
        // Fallback if slugify returns empty
        const originalFilename = basename(imagePath, ext);
        newFilename = makeUniqueFilename(
          originalFilename,
          ext,
          usedNames.get(propertySlug)
        );
      }
    } else {
      // No alt text - use original filename
      const originalFilename = basename(imagePath, ext);
      newFilename = makeUniqueFilename(
        originalFilename,
        ext,
        usedNames.get(propertySlug)
      );
    }

    const newPath = `/images/properties/${propertySlug}/${newFilename}`;
    pathMapping[imagePath] = newPath;
  }

  return pathMapping;
}

/**
 * Apply the changes
 */
function applyChanges(pathMapping, imageToProperty, dryRun) {
  const propertiesDir = CONFIG.propertiesDir;
  const imagesDir = CONFIG.imagesDir;

  // 1. Create property image directories
  const propertyDirs = new Set(Object.values(imageToProperty));
  for (const propertySlug of propertyDirs) {
    const dirPath = join(CONFIG.propertiesImagesDir, propertySlug);
    if (!existsSync(dirPath)) {
      if (dryRun) {
        console.log(`  Would create directory: ${dirPath}`);
      } else {
        mkdirSync(dirPath, { recursive: true });
        console.log(`  Created directory: ${dirPath}`);
      }
    }
  }

  // 2. Move/rename image files
  console.log("\nMoving and renaming images...");
  let movedCount = 0;
  for (const [oldPath, newPath] of Object.entries(pathMapping)) {
    // Convert web paths to filesystem paths
    const oldFilePath = join(".", oldPath);
    const newFilePath = join(".", newPath);

    if (existsSync(oldFilePath)) {
      if (dryRun) {
        console.log(`  Would move: ${oldPath} -> ${newPath}`);
      } else {
        // Ensure destination directory exists
        mkdirSync(dirname(newFilePath), { recursive: true });
        // Copy then delete (safer than rename across filesystems)
        copyFileSync(oldFilePath, newFilePath);
        unlinkSync(oldFilePath);
        console.log(`  Moved: ${basename(oldPath)} -> ${newPath}`);
      }
      movedCount++;
    } else {
      console.log(`  Warning: Source file not found: ${oldFilePath}`);
    }
  }
  console.log(`  Total: ${movedCount} images ${dryRun ? "would be " : ""}moved`);

  // 3. Update property markdown files
  console.log("\nUpdating property files...");
  const propertyFiles = readdirSync(propertiesDir).filter((f) =>
    f.endsWith(".md")
  );

  for (const file of propertyFiles) {
    const filePath = join(propertiesDir, file);
    const content = readFileSync(filePath, "utf-8");
    const updatedContent = updateMarkdownImagePaths(content, pathMapping);

    if (content !== updatedContent) {
      if (dryRun) {
        console.log(`  Would update: ${file}`);
      } else {
        writeFileSync(filePath, updatedContent);
        console.log(`  Updated: ${file}`);
      }
    }
  }

  // 4. Update alt-tags.json
  console.log("\nUpdating alt-tags.json...");
  const altTagsPath = CONFIG.altTagsFile;
  if (existsSync(altTagsPath)) {
    const altData = JSON.parse(readFileSync(altTagsPath, "utf-8"));
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

    const updatedAltData = { images: updatedImages };

    if (dryRun) {
      console.log(
        `  Would update alt-tags.json (${updatedImages.length} unique entries)`
      );
    } else {
      writeFileSync(altTagsPath, JSON.stringify(updatedAltData, null, 2) + "\n");
      console.log(
        `  Updated alt-tags.json (${updatedImages.length} unique entries)`
      );
    }
  }
}

/**
 * Delete unused images
 */
function deleteUnusedImages(usedImages, dryRun) {
  const existingImages = getExistingImages();
  const unusedImages = [];

  for (const img of existingImages) {
    if (!usedImages.has(img)) {
      unusedImages.push(img);
    }
  }

  if (unusedImages.length === 0) {
    console.log("\nNo unused images to delete.");
    return;
  }

  console.log(`\nDeleting ${unusedImages.length} unused images...`);
  for (const img of unusedImages) {
    const filePath = join(".", img);
    if (dryRun) {
      console.log(`  Would delete: ${img}`);
    } else {
      unlinkSync(filePath);
      console.log(`  Deleted: ${img}`);
    }
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
  const { imageToProperty, propertyImages } = collectImageReferences();

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
  console.log(`  Created mappings for ${Object.keys(pathMapping).length} images`);

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
  console.log("\n" + "=".repeat(60));
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
