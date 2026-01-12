import { join } from "node:path";
import { path, fs, bun } from "./utils.js";
import { prep } from "./prepare-dev.js";

const dev = path(".build", "dev");
const output = path("_site");

prep();

console.log("Building site...");

fs.rm(output);
bun.run("build", dev);
fs.mv(join(dev, "_site"), output);

console.log("Built to _site/");
