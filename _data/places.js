import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const placesDir = join(here, "..", "places");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

const readPlaceFile = (file) => {
  const text = readFileSync(join(placesDir, file), "utf8");
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return {};
  try {
    return Bun.YAML.parse(m[1]) ?? {};
  } catch {
    return {};
  }
};

const loadPlaces = () => {
  if (!existsSync(placesDir)) return {};
  const places = {};
  for (const file of readdirSync(placesDir)) {
    if (!file.endsWith(".md")) continue;
    const slug = basename(file, ".md");
    places[slug] = { ...readPlaceFile(file), slug };
  }
  return places;
};

export default loadPlaces();
