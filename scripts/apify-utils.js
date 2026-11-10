/**
 * Shared helpers for the Apify-backed fetch scripts.
 *
 * Kept as CommonJS so both the `require`-style and `import`-style scripts can
 * use it.
 */

/** Exit unless an Apify API key is configured. */
function requireApifyKey() {
  if (process.env.APIFY_API_KEY) return;

  console.error(
    "Error: APIFY_API_KEY required (set in .env locally, or as a GitHub secret on CI)",
  );
  console.error("Get one at: https://console.apify.com/account/integrations");
  process.exit(1);
}

/**
 * Build the sync-run endpoint URL for an actor.
 *
 * @param {string} actorId
 * @param {number} [timeoutSec] - Optional server-side run timeout
 */
function apifyActorUrl(actorId, timeoutSec) {
  const base = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${process.env.APIFY_API_KEY}`;
  return timeoutSec ? `${base}&timeout=${timeoutSec}` : base;
}

/**
 * Run an actor synchronously and return its dataset items.
 *
 * @param {string} url - Endpoint from apifyActorUrl
 * @param {unknown} input - Actor input payload
 * @returns {Promise<unknown[]>}
 */
async function postApifyDataset(url, input) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const results = await res.json();
  if (!Array.isArray(results)) throw new Error("Invalid API response format");

  return results;
}

module.exports = { apifyActorUrl, postApifyDataset, requireApifyKey };
