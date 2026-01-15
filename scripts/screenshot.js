import { chromium } from "playwright";
import { path, fs, bun } from "./utils.js";
import { prep } from "./prepare-dev.js";
import { spawn } from "node:child_process";

const screenshotsDir = path("screenshots");
const siteDir = path("_site");

// Parse command line arguments
const args = process.argv.slice(2);
const pagesToCapture = args.length > 0 ? args : ["/"];

async function startServer() {
  // Build the site first
  console.log("Building site...");
  prep();
  fs.rm(siteDir);
  const devDir = path(".build", "dev");
  bun.run("build", devDir);
  const { join } = await import("node:path");
  fs.mv(join(devDir, "_site"), siteDir);

  // Start a simple HTTP server
  console.log("Starting server...");
  const server = Bun.serve({
    port: 3456,
    fetch(req) {
      const url = new URL(req.url);
      let filepath = url.pathname;
      if (filepath === "/" || filepath.endsWith("/")) {
        filepath = filepath + "index.html";
      }
      const file = Bun.file(path("_site", filepath.slice(1)));
      return new Response(file);
    },
  });
  return server;
}

async function takeScreenshots(pages) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  fs.mkdir(screenshotsDir);

  for (const pagePath of pages) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const url = `http://localhost:3456${pagePath}`;
    console.log(`Capturing ${url}...`);

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

      // Generate filename from path
      const filename =
        pagePath === "/" ? "homepage" : pagePath.replace(/\//g, "-").replace(/^-|-$/g, "");
      const screenshotPath = path("screenshots", `${filename}.png`);

      // Take full page screenshot
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved: ${screenshotPath}`);
    } catch (err) {
      console.error(`Failed to capture ${pagePath}: ${err.message}`);
    }

    await page.close();
  }

  await browser.close();
}

async function main() {
  const server = await startServer();

  try {
    await takeScreenshots(pagesToCapture);
  } finally {
    server.stop();
    console.log("Done!");
  }
}

main().catch(console.error);
