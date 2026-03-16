#!/bin/bash
#
# Download Wayback Machine archives for defunct Garsdale websites
#
# This script uses the wayback-machine-downloader tool to download
# archived versions of three sites that are no longer online:
#   - garsdale.info
#   - www.garsdaleredsquirrels.org.uk
#   - www.garsdaleparishcouncil.com
#
# Prerequisites:
#   - Node.js 18+ installed
#   - git clone https://github.com/birbwatcher/wayback-machine-downloader.git
#   - cd wayback-machine-downloader/wayback-machine-downloader && npm install
#
# Usage:
#   ./scripts/download-wayback-archives.sh
#
# The archives will be saved to wayback-archives/ in the project root.
# These are reference material only and should not be committed to git.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOWNLOADER_DIR="$PROJECT_DIR/../wayback-downloader/wayback-machine-downloader"

if [ ! -d "$DOWNLOADER_DIR" ]; then
  echo "wayback-machine-downloader not found."
  echo "Please run:"
  echo "  cd $(dirname "$PROJECT_DIR")"
  echo "  git clone https://github.com/birbwatcher/wayback-machine-downloader.git wayback-downloader"
  echo "  cd wayback-downloader/wayback-machine-downloader && npm install"
  exit 1
fi

OUTPUT_DIR="$PROJECT_DIR/wayback-archives"
mkdir -p "$OUTPUT_DIR"

cat > /tmp/wayback-download-all.mjs << 'SCRIPT'
import { WaybackMachineDownloader } from "./lib/downloader.js";
import { normalizeBaseUrlInput } from "./lib/utils.js";

const outputBase = process.argv[2];

const sites = [
  { url: "garsdale.info", dir: `${outputBase}/garsdale-info` },
  { url: "www.garsdaleredsquirrels.org.uk", dir: `${outputBase}/garsdale-red-squirrels` },
  { url: "www.garsdaleparishcouncil.com", dir: `${outputBase}/garsdale-parish-council` },
];

for (const site of sites) {
  console.log(`\n========================================`);
  console.log(`Downloading: ${site.url}`);
  console.log(`To: ${site.dir}`);
  console.log(`========================================\n`);

  const normalized = normalizeBaseUrlInput(site.url);

  const dl = new WaybackMachineDownloader({
    base_url: normalized.canonicalUrl,
    normalized_base: normalized,
    exact_url: false,
    directory: site.dir,
    from_timestamp: 0,
    to_timestamp: 0,
    threads_count: 3,
    rewrite_mode: "relative",
    canonical_action: "keep",
    download_external_assets: false,
  });

  await dl.download_files();
  console.log(`\nDone: ${site.url}\n`);
}

console.log("\nAll downloads complete!");
console.log(`Archives saved to: ${outputBase}`);
SCRIPT

cd "$DOWNLOADER_DIR"
node /tmp/wayback-download-all.mjs "$OUTPUT_DIR"

echo ""
echo "Downloads complete. Archives are in: $OUTPUT_DIR"
echo "Review the content and use it as reference for creating new site pages."
