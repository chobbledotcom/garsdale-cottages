/**
 * Small text helpers shared by the import scripts.
 *
 * Kept as CommonJS so both the `require`-style and `import`-style scripts can
 * use it.
 */

/** Convert a string to a URL-friendly slug. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

/** Sleep for a given number of milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { sleep, slugify };
