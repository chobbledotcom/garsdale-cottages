import { path, bun, spawn } from "./utils.js";
import { prep } from "./prepare-dev.js";

const dev = path(".build", "dev");

prep();

console.log("Starting server...");

const watchProc = spawn(["bun", path("scripts", "watch.js")]);
const eleventyProc = bun.spawn("serve", dev);

process.on("SIGINT", () => {
  console.log("\nStopping...");
  watchProc.kill();
  eleventyProc.kill();
  process.exit();
});
