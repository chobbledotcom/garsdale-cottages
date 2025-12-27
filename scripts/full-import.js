#!/usr/bin/env node

/**
 * Full Property Import Script
 *
 * Downloads a Sykes property page, imports it, and downloads all images locally.
 *
 * Usage:
 *   node scripts/full-import.js <url>
 *   node scripts/full-import.js --file <local.html>
 *   node scripts/full-import.js --dry-run <url>
 *
 * Options:
 *   --dry-run       Preview what would be done without making changes
 *   --file <path>   Use a local HTML file instead of downloading
 *   --skip-images   Skip image downloading (useful for testing)
 *   --help, -h      Show help
 */

const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readdirSync,
} = require("fs");
const { join, basename } = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  imagesDir: "images",
  propertiesDir: "properties",
  reviewsDir: "reviews",
  dataDir: "_data",
  tempDir: ".tmp-import",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  referer: "https://www.sykescottages.co.uk/",
  retryCount: 3,
  retryDelayMs: 2000,
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract filename from a Sykes image URL
 * e.g., https://images-cdn.sykesassets.co.uk/images/property_images/976x732/1167031/sc_1736159243_1167031_44.jpeg?access=...
 * -> 1167031_sc_1736159243_1167031_44.jpeg
 */
function extractImageFilename(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/");
    const filename = pathParts[pathParts.length - 1]; // e.g., sc_1736159243_1167031_44.jpeg

    // Extract property ID from path (e.g., /976x732/1167031/...)
    const propertyId = pathParts[pathParts.length - 2]; // e.g., 1167031

    // Prefix with property ID for uniqueness
    return `${propertyId}_${filename}`;
  } catch (e) {
    // Fallback: use a hash of the URL
    const hash = url.split("?")[0].split("/").pop();
    return hash || "image.jpg";
  }
}

/**
 * Generate a local path for an image
 */
function getLocalImagePath(url, baseDir = CONFIG.imagesDir) {
  const filename = extractImageFilename(url);
  return `/${baseDir}/${filename}`;
}

// =============================================================================
// HTTP DOWNLOAD FUNCTIONS
// =============================================================================

/**
 * Download a file from a URL with retry logic and spoofing headers
 * Returns the response body as a Buffer
 */
async function downloadWithRetry(url, options = {}) {
  const {
    retries = CONFIG.retryCount,
    retryDelay = CONFIG.retryDelayMs,
    asBuffer = false,
  } = options;

  const headers = {
    "User-Agent": CONFIG.userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    Referer: CONFIG.referer,
    "Cache-Control": "no-cache",
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await downloadUrl(url, headers, asBuffer);
      return result;
    } catch (error) {
      console.log(
        `  Attempt ${attempt}/${retries} failed: ${error.message}`
      );
      if (attempt < retries) {
        const delay = retryDelay * attempt;
        console.log(`  Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Low-level URL download function
 */
function downloadUrl(url, headers, asBuffer = false) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === "https:" ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers,
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        downloadUrl(redirectUrl, headers, asBuffer).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve(asBuffer ? buffer : buffer.toString("utf8"));
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.end();
  });
}

// =============================================================================
// HTML PAGE DOWNLOADING
// =============================================================================

/**
 * Download an HTML page to a temporary file
 * @param {string} url - The URL to download
 * @param {string} outputDir - Base directory for temp files
 * @returns {Promise<{filePath: string, html: string}>}
 */
async function downloadHtmlPage(url, outputDir = ".") {
  console.log(`Downloading HTML from: ${url}`);

  const tempDir = join(outputDir, CONFIG.tempDir);
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const html = await downloadWithRetry(url, { asBuffer: false });
  const filename = `import-${Date.now()}.html`;
  const filePath = join(tempDir, filename);

  writeFileSync(filePath, html, "utf8");
  console.log(`  Saved ${html.length} bytes to ${filePath}`);

  return { filePath, html };
}

// =============================================================================
// PROPERTY FILE MANAGEMENT
// =============================================================================

/**
 * Find all files related to a property by slug
 * @param {string} slug - The property slug
 * @param {string} outputDir - Base directory
 * @returns {{propertyFile: string|null, reviewFiles: string[]}}
 */
function findExistingPropertyFiles(slug, outputDir = ".") {
  const result = {
    propertyFile: null,
    reviewFiles: [],
  };

  // Check for property file
  const propertiesDir = join(outputDir, CONFIG.propertiesDir);
  const propertyPath = join(propertiesDir, `${slug}.md`);
  if (existsSync(propertyPath)) {
    result.propertyFile = propertyPath;
  }

  // Find review files that start with the property slug
  const reviewsDir = join(outputDir, CONFIG.reviewsDir);
  if (existsSync(reviewsDir)) {
    const reviewFiles = readdirSync(reviewsDir);
    for (const file of reviewFiles) {
      if (file.startsWith(`${slug}-`) && file.endsWith(".md")) {
        result.reviewFiles.push(join(reviewsDir, file));
      }
    }
  }

  return result;
}

/**
 * Delete existing property and associated review files
 * @param {string} slug - The property slug
 * @param {string} outputDir - Base directory
 * @returns {{deleted: string[]}}
 */
function deleteExistingProperty(slug, outputDir = ".") {
  const files = findExistingPropertyFiles(slug, outputDir);
  const deleted = [];

  if (files.propertyFile) {
    unlinkSync(files.propertyFile);
    deleted.push(files.propertyFile);
  }

  for (const reviewFile of files.reviewFiles) {
    unlinkSync(reviewFile);
    deleted.push(reviewFile);
  }

  return { deleted };
}

// =============================================================================
// IMAGE EXTRACTION AND DOWNLOADING
// =============================================================================

/**
 * Extract all image URLs from a property markdown file
 * @param {string} filePath - Path to the property markdown file
 * @returns {string[]} Array of image URLs
 */
function extractImagesFromProperty(filePath) {
  const content = readFileSync(filePath, "utf8");
  const images = [];
  const seen = new Set();

  // Match URLs in the frontmatter (thumbnail, header_image, gallery items)
  // Pattern: https://images-cdn.sykesassets.co.uk/... (stops at whitespace, quote, or bracket)
  const urlPattern = /https:\/\/images-cdn\.sykesassets\.co\.uk\/[^\s"'\]]+/g;
  const matches = content.match(urlPattern) || [];

  for (const url of matches) {
    // Normalize URL (remove trailing quotes/brackets that might be captured)
    const cleanUrl = url.replace(/["\]]+$/, "");
    const baseUrl = cleanUrl.split("?")[0];

    if (!seen.has(baseUrl)) {
      seen.add(baseUrl);
      images.push(cleanUrl);
    }
  }

  return images;
}

/**
 * Download a single image to the images directory
 * @param {string} url - Image URL to download
 * @param {string} outputDir - Base directory
 * @returns {Promise<{url: string, localPath: string, filename: string, success: boolean, error?: string}>}
 */
async function downloadImage(url, outputDir = ".") {
  const imagesDir = join(outputDir, CONFIG.imagesDir);
  if (!existsSync(imagesDir)) {
    mkdirSync(imagesDir, { recursive: true });
  }

  const filename = extractImageFilename(url);
  const localPath = join(imagesDir, filename);
  const relativePath = `/${CONFIG.imagesDir}/${filename}`;

  try {
    const buffer = await downloadWithRetry(url, { asBuffer: true });
    writeFileSync(localPath, buffer);

    return {
      url,
      localPath,
      relativePath,
      filename,
      success: true,
      size: buffer.length,
    };
  } catch (error) {
    return {
      url,
      localPath,
      relativePath,
      filename,
      success: false,
      error: error.message,
    };
  }
}

/**
 * Download all images for a property
 * @param {string[]} urls - Array of image URLs
 * @param {string} outputDir - Base directory
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{successful: object[], failed: object[], urlToLocalMap: Map}>}
 */
async function downloadAllImages(urls, outputDir = ".", onProgress = null) {
  const successful = [];
  const failed = [];
  const urlToLocalMap = new Map();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (onProgress) {
      onProgress(i + 1, urls.length, url);
    }

    const result = await downloadImage(url, outputDir);

    if (result.success) {
      successful.push(result);
      urlToLocalMap.set(url, result.relativePath);

      // Also map the base URL (without query params) to handle alt-tags
      const baseUrl = url.split("?")[0];
      if (baseUrl !== url) {
        urlToLocalMap.set(baseUrl, result.relativePath);
      }
    } else {
      failed.push(result);
    }

    // Small delay between downloads to be polite
    if (i < urls.length - 1) {
      await sleep(100);
    }
  }

  return { successful, failed, urlToLocalMap };
}

// =============================================================================
// MARKDOWN AND ALT-TAGS UPDATING
// =============================================================================

/**
 * Update a property markdown file to use local image paths
 * @param {string} filePath - Path to the property markdown file
 * @param {Map} urlToLocalMap - Map of remote URLs to local paths
 * @returns {{updated: boolean, replacements: number}}
 */
function updatePropertyImagePaths(filePath, urlToLocalMap) {
  let content = readFileSync(filePath, "utf8");
  let replacements = 0;

  for (const [remoteUrl, localPath] of urlToLocalMap) {
    // Escape special regex characters in the URL
    const escapedUrl = remoteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escapedUrl, "g");

    const newContent = content.replace(regex, localPath);
    if (newContent !== content) {
      const matches = content.match(regex) || [];
      replacements += matches.length;
      content = newContent;
    }
  }

  if (replacements > 0) {
    writeFileSync(filePath, content, "utf8");
  }

  return { updated: replacements > 0, replacements };
}

/**
 * Update alt-tags.json to use local image paths
 * @param {string} outputDir - Base directory
 * @param {Map} urlToLocalMap - Map of remote URLs to local paths
 * @returns {{updated: boolean, replacements: number}}
 */
function updateAltTagsPaths(outputDir, urlToLocalMap) {
  const altTagsPath = join(outputDir, CONFIG.dataDir, "alt-tags.json");

  if (!existsSync(altTagsPath)) {
    return { updated: false, replacements: 0, reason: "file not found" };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(altTagsPath, "utf8"));
  } catch (e) {
    return { updated: false, replacements: 0, reason: "parse error" };
  }

  if (!data.images || !Array.isArray(data.images)) {
    return { updated: false, replacements: 0, reason: "no images array" };
  }

  let replacements = 0;

  for (const img of data.images) {
    if (!img.path) continue;

    // Try to find a matching URL in our map
    const baseUrl = img.path.split("?")[0];

    if (urlToLocalMap.has(img.path)) {
      img.path = urlToLocalMap.get(img.path);
      replacements++;
    } else if (urlToLocalMap.has(baseUrl)) {
      img.path = urlToLocalMap.get(baseUrl);
      replacements++;
    }
  }

  if (replacements > 0) {
    writeFileSync(altTagsPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  return { updated: replacements > 0, replacements };
}

// =============================================================================
// IMPORTER INTEGRATION
// =============================================================================

/**
 * Run the existing Sykes importer on an HTML file
 * @param {string} htmlPath - Path to the HTML file
 * @param {string} outputDir - Output directory
 * @returns {Promise<{success: boolean, slug: string, output: string}>}
 */
async function runSykesImporter(htmlPath, outputDir = ".") {
  const { spawn } = require("child_process");
  const scriptPath = join(__dirname, "import-sykes-property.js");

  return new Promise((resolve, reject) => {
    const args = ["--file", htmlPath];
    if (outputDir !== ".") {
      args.push("--output-dir", outputDir);
    }

    const proc = spawn("node", [scriptPath, ...args], {
      cwd: outputDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        // Extract slug from output
        const slugMatch = stdout.match(/Created: .*\/([^/]+)\.md/);
        const slug = slugMatch ? slugMatch[1] : null;

        resolve({
          success: true,
          slug,
          output: stdout,
        });
      } else {
        resolve({
          success: false,
          slug: null,
          output: stdout + "\n" + stderr,
          exitCode: code,
        });
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Extract slug from HTML content by parsing the title
 * This allows us to determine the slug before running the importer
 */
function extractSlugFromHtml(html) {
  // Try og:title first
  const ogMatch = html.match(
    /<meta\s+(?:property=["']og:title["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+property=["']og:title["'])/i
  );
  if (ogMatch) {
    const title = ogMatch[1] || ogMatch[2];
    return slugify(title);
  }

  // Fall back to page title
  const titleMatch = html.match(/<title>([^|<]+)/i);
  if (titleMatch) {
    return slugify(titleMatch[1].trim());
  }

  return null;
}

// =============================================================================
// MAIN ORCHESTRATION
// =============================================================================

/**
 * Run the full import process
 */
async function fullImport(options) {
  const {
    url,
    localFile,
    outputDir = ".",
    dryRun = false,
    skipImages = false,
  } = options;

  console.log("\n=== Full Property Import ===\n");

  // Step 1: Get the HTML content
  let html;
  let htmlFilePath;

  if (localFile) {
    console.log(`Reading from local file: ${localFile}`);
    html = readFileSync(localFile, "utf8");
    htmlFilePath = localFile;
    console.log(`  Read ${html.length} bytes\n`);
  } else if (url) {
    console.log("Step 1: Downloading HTML page...");
    try {
      const result = await downloadHtmlPage(url, outputDir);
      html = result.html;
      htmlFilePath = result.filePath;
    } catch (error) {
      console.error(`  Failed to download: ${error.message}`);
      console.log("\nTip: If the download is blocked, save the page manually and use --file");
      process.exit(1);
    }
    console.log();
  } else {
    console.error("Error: Must provide a URL or --file <path>");
    process.exit(1);
  }

  // Step 2: Determine the property slug
  const slug = extractSlugFromHtml(html);
  if (!slug) {
    console.error("Error: Could not extract property title from HTML");
    process.exit(1);
  }
  console.log(`Step 2: Property slug: ${slug}`);

  // Step 3: Check for and delete existing property
  console.log("\nStep 3: Checking for existing property...");
  const existingFiles = findExistingPropertyFiles(slug, outputDir);

  if (existingFiles.propertyFile || existingFiles.reviewFiles.length > 0) {
    console.log(`  Found existing property file: ${existingFiles.propertyFile}`);
    console.log(`  Found ${existingFiles.reviewFiles.length} existing review files`);

    if (dryRun) {
      console.log("  [DRY RUN] Would delete these files");
    } else {
      const deleted = deleteExistingProperty(slug, outputDir);
      console.log(`  Deleted ${deleted.deleted.length} files`);
    }
  } else {
    console.log("  No existing property found");
  }

  // Step 4: Run the Sykes importer
  console.log("\nStep 4: Running Sykes importer...");
  if (dryRun) {
    console.log("  [DRY RUN] Would run importer on:", htmlFilePath);
  } else {
    const importResult = await runSykesImporter(htmlFilePath, outputDir);
    if (!importResult.success) {
      console.error("  Import failed:");
      console.error(importResult.output);
      process.exit(1);
    }
    console.log("  Import successful");
    console.log("  Output:", importResult.output.split("\n").slice(-5).join("\n  "));
  }

  // Step 5: Extract image URLs from the created property
  console.log("\nStep 5: Extracting image URLs...");
  const propertyPath = join(outputDir, CONFIG.propertiesDir, `${slug}.md`);

  let imageUrls = [];
  if (dryRun) {
    // In dry run, parse from HTML instead
    const urlPattern = /https?:\/\/images-cdn\.sykesassets\.co\.uk[^\s"'>\]]+/g;
    const matches = html.match(urlPattern) || [];
    const seen = new Set();
    for (const url of matches) {
      const cleanUrl = url.replace(/["\]>]+$/, "");
      const baseUrl = cleanUrl.split("?")[0];
      if (!seen.has(baseUrl)) {
        seen.add(baseUrl);
        imageUrls.push(cleanUrl);
      }
    }
    console.log(`  [DRY RUN] Found ${imageUrls.length} images in HTML`);
  } else {
    imageUrls = extractImagesFromProperty(propertyPath);
    console.log(`  Found ${imageUrls.length} images in property file`);
  }

  if (imageUrls.length === 0) {
    console.log("  No images to download");
    console.log("\n=== Import Complete ===\n");
    return;
  }

  // Step 6: Download all images
  console.log("\nStep 6: Downloading images...");
  if (skipImages) {
    console.log("  [SKIPPED] Image downloading disabled");
    console.log("\n=== Import Complete (images skipped) ===\n");
    return;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would download ${imageUrls.length} images to /${CONFIG.imagesDir}/`);
    console.log("  Sample filenames:");
    for (const url of imageUrls.slice(0, 3)) {
      console.log(`    - ${extractImageFilename(url)}`);
    }
    if (imageUrls.length > 3) {
      console.log(`    ... and ${imageUrls.length - 3} more`);
    }
  } else {
    const downloadResult = await downloadAllImages(
      imageUrls,
      outputDir,
      (current, total, url) => {
        const filename = extractImageFilename(url);
        process.stdout.write(
          `\r  Downloading ${current}/${total}: ${filename.substring(0, 40)}...`
        );
      }
    );
    console.log(); // New line after progress

    console.log(`  Downloaded: ${downloadResult.successful.length}`);
    if (downloadResult.failed.length > 0) {
      console.log(`  Failed: ${downloadResult.failed.length}`);
      for (const fail of downloadResult.failed) {
        console.log(`    - ${fail.filename}: ${fail.error}`);
      }
    }

    // Step 7: Update property markdown with local paths
    console.log("\nStep 7: Updating property with local image paths...");
    const propertyUpdate = updatePropertyImagePaths(
      propertyPath,
      downloadResult.urlToLocalMap
    );
    console.log(`  Updated ${propertyUpdate.replacements} image references in property`);

    // Step 8: Update alt-tags.json with local paths
    console.log("\nStep 8: Updating alt-tags.json...");
    const altTagsUpdate = updateAltTagsPaths(outputDir, downloadResult.urlToLocalMap);
    if (altTagsUpdate.updated) {
      console.log(`  Updated ${altTagsUpdate.replacements} paths in alt-tags.json`);
    } else {
      console.log(`  No updates needed (${altTagsUpdate.reason || "no matching paths"})`);
    }
  }

  console.log("\n=== Import Complete ===\n");
}

// =============================================================================
// CLI HANDLING
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Full Property Import Script

Downloads a Sykes property page, imports it, and downloads all images locally.

Usage:
  node scripts/full-import.js <url> [options]
  node scripts/full-import.js --file <local.html> [options]

Options:
  --file <path>   Use a local HTML file instead of downloading
  --dry-run       Preview what would be done without making changes
  --skip-images   Skip image downloading (useful for testing importer only)
  --help, -h      Show this help message

Examples:
  # Import from URL (may be blocked - see tip below)
  node scripts/full-import.js https://sykes.b-cdn.net/cottage/.../Property-123456.html

  # Import from local file (recommended if blocked)
  node scripts/full-import.js --file saved-page.html

  # Preview without making changes
  node scripts/full-import.js --dry-run https://example.com/property.html

Tip: If the download is blocked, save the page manually in your browser and use --file
`);
    process.exit(0);
  }

  let url = null;
  let localFile = null;
  let dryRun = false;
  let skipImages = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--skip-images") {
      skipImages = true;
    } else if (args[i] === "--file" && args[i + 1]) {
      localFile = args[++i];
    } else if (!args[i].startsWith("-")) {
      url = args[i];
    }
  }

  await fullImport({
    url,
    localFile,
    outputDir: ".",
    dryRun,
    skipImages,
  });
}

// =============================================================================
// EXPORTS (for testing)
// =============================================================================

module.exports = {
  // Configuration
  CONFIG,

  // Utilities
  slugify,
  extractImageFilename,
  getLocalImagePath,

  // HTTP
  downloadWithRetry,
  downloadUrl,

  // HTML downloading
  downloadHtmlPage,

  // Property management
  findExistingPropertyFiles,
  deleteExistingProperty,

  // Image handling
  extractImagesFromProperty,
  downloadImage,
  downloadAllImages,

  // Path updating
  updatePropertyImagePaths,
  updateAltTagsPaths,

  // Importer integration
  runSykesImporter,
  extractSlugFromHtml,

  // Main
  fullImport,
};

// Run if executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
