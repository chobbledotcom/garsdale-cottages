import { watch } from "node:fs";
import { root, debounce } from "./utils.js";
import { sync } from "./prepare-dev.js";

const ignored = [".build", "node_modules", ".git"];

const debouncedSync = debounce(sync, 5000);

watch(root, { recursive: true }, (_, file) => {
  if (!file || ignored.some((p) => file.startsWith(p))) return;
  debouncedSync();
});

console.log(`Watching ${root}...`);
