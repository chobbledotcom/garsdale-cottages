import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { apifyActorUrl, postApifyDataset } from "./apify-utils.js";
import { fs, path, write } from "./utils.js";

const REVIEWS_DIR = path("reviews");
const PROPERTIES_DIR = path("properties");
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const BODY_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/;
const CONTENT_DUPLICATE_MIN_LENGTH = 40;

const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const decodeCodePoint = (code) => {
  const hex = code[1]?.toLowerCase() === "x";
  const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
  return Number.isNaN(value) ? null : String.fromCodePoint(value);
};

const decodeEntity = (entity, code) => {
  if (!code.startsWith("#")) {
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  }
  return decodeCodePoint(code) ?? entity;
};

const decodeEntities = (text) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, decodeEntity);

const asText = (value) => (typeof value === "string" ? value : "");

export const cleanText = (value) =>
  decodeEntities(asText(value)).replace(/\s+/g, " ").trim();

export const cleanBody = (value) =>
  decodeEntities(asText(value))
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const normaliseForKey = (value) => cleanText(value).toLowerCase();

export const clampRating = (value) => {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(rating)));
};

export const bookingRating = (value) => {
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? clampRating(rating / 2) : null;
};

export const toIsoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const readFrontmatter = (text) => {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return {};
  try {
    return Bun.YAML.parse(match[1]) ?? {};
  } catch {
    return {};
  }
};

const readBody = (text) => BODY_RE.exec(text)?.[1] ?? "";

export const readProperties = (field) => {
  if (!fs.exists(PROPERTIES_DIR)) return [];
  return readdirSync(PROPERTIES_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const text = readFileSync(join(PROPERTIES_DIR, file), "utf8");
      return { ...readFrontmatter(text), slug: file.replace(/\.md$/, "") };
    })
    .filter((property) => property[field]);
};

const propertyKey = (slug) => `properties/${slug}.md`;

const contentKey = (property, body) => {
  const text = normaliseForKey(body);
  return text.length >= CONTENT_DUPLICATE_MIN_LENGTH
    ? `${property}|${text}`
    : null;
};

const sourceKey = (property, source, id) => `${property}|${source}|${id}`;

const readExistingReviews = () => {
  if (!fs.exists(REVIEWS_DIR)) return [];
  return readdirSync(REVIEWS_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const text = readFileSync(join(REVIEWS_DIR, file), "utf8");
      return {
        ...readFrontmatter(text),
        body: readBody(text),
        file,
      };
    });
};

const buildReviewIndex = () => {
  const index = { content: new Set(), source: new Set() };
  for (const review of readExistingReviews()) {
    const content = contentKey(review.property, review.body);
    if (content) index.content.add(content);
    if (review.property && review.source && review.source_id) {
      index.source.add(
        sourceKey(review.property, review.source, String(review.source_id)),
      );
    }
  }
  return index;
};

const isDuplicate = (index, property, source, review) => {
  const key = sourceKey(property, source, String(review.id));
  const content = contentKey(property, review.text);
  return index.source.has(key) || (content && index.content.has(content));
};

const rememberReview = (index, property, source, review, text) => {
  index.source.add(sourceKey(property, source, String(review.id)));
  const content = contentKey(property, text);
  if (content) index.content.add(content);
};

const slugify = (value) =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30)
    .replace(/^-|-$/g, "") || "guest";

const makeTitle = (title, text) => {
  const candidate = cleanText(title) || cleanText(text);
  if (candidate.length <= 80) return candidate;
  return `${candidate.slice(0, 77).replace(/\s+\S*$/, "")}...`;
};

const uniqueFilename = (base, id) => {
  const filename = `${base}.md`;
  if (!fs.exists(join(REVIEWS_DIR, filename))) return filename;
  const suffix = String(id ?? Date.now()).slice(0, 8);
  return `${base}-${suffix}.md`;
};

const yamlString = (value) => JSON.stringify(String(value));

const writeReview = async (property, source, sourceUrl, review, index) => {
  const date = toIsoDate(review.date);
  const text = cleanBody(review.text);
  const rating = clampRating(review.rating);
  if (!date || !text || !rating || !cleanText(review.name)) return null;

  const base = `${property.slug}-${slugify(review.name)}-${source}-${date}`;
  const filename = uniqueFilename(base, review.id);
  const frontmatter = [
    `property: ${propertyKey(property.slug)}`,
    `title: ${yamlString(makeTitle(review.title, text))}`,
    `name: ${yamlString(cleanText(review.name))}`,
    `rating: ${rating}`,
    `date: ${date}`,
    `source: ${source}`,
    `source_id: ${yamlString(review.id)}`,
    sourceUrl ? `url: ${yamlString(sourceUrl)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await write(
    join(REVIEWS_DIR, filename),
    `---\n${frontmatter}\n---\n\n${text}\n`,
  );
  rememberReview(index, propertyKey(property.slug), source, review, text);
  return filename;
};

export const saveReviews = async (source, property, sourceUrl, reviews) => {
  fs.mkdir(REVIEWS_DIR);
  const index = buildReviewIndex();
  let saved = 0;

  for (const review of reviews) {
    if (isDuplicate(index, propertyKey(property.slug), source, review)) {
      continue;
    }
    const filename = await writeReview(
      property,
      source,
      sourceUrl,
      review,
      index,
    );
    if (!filename) continue;
    saved += 1;
    console.log(`  ${filename} (${review.rating}/5 stars)`);
  }

  return saved;
};

export const runApifyActor = async (actorId, input) => {
  const token = process.env.APIFY_API_KEY;
  if (!token) {
    throw new Error(
      "APIFY_API_KEY required (set in .env locally, or as a GitHub secret on CI)",
    );
  }

  return postApifyDataset(apifyActorUrl(actorId, 600), input);
};
