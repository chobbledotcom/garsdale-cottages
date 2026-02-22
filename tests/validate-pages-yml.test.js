import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

// --- YAML parsing via Python (has yaml built-in) ---
// Batch multiple YAML documents in a single Python call for performance

function parseYaml(text) {
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import sys, yaml, json; print(json.dumps(yaml.safe_load(sys.stdin.read())))",
    ],
    { input: text, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`YAML parse failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function parseFrontmatterBatch(filepaths) {
  // Parse all frontmatter in a single Python call for performance
  const separator = "\n---SEPARATOR---\n";
  const yamlTexts = [];

  for (const filepath of filepaths) {
    const content = readFileSync(filepath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    yamlTexts.push(match ? match[1] : "null");
  }

  const batchInput = yamlTexts.join(separator);
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import sys, yaml, json
input_text = sys.stdin.read()
docs = input_text.split("\\n---SEPARATOR---\\n")
results = []
for doc in docs:
    try:
        results.append(yaml.safe_load(doc))
    except:
        results.append(None)
print(json.dumps(results))`,
    ],
    { input: batchInput, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`YAML batch parse failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  const resultMap = {};
  for (let i = 0; i < filepaths.length; i++) {
    resultMap[filepaths[i]] = parsed[i];
  }
  return resultMap;
}

function parseFrontmatter(filepath) {
  const content = readFileSync(filepath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYaml(match[1]);
}

// --- Frontmatter parsing ---

function parseFrontmatter(filepath) {
  const content = readFileSync(filepath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYaml(match[1]);
}

// --- Fetch valid field types and properties from Pages CMS source ---

const PAGES_CMS_REPO = "pages-cms/pages-cms";
const PAGES_CMS_BRANCH = "main";

// Structural types handled specially in entry-form.tsx (not in fields/core/)
const STRUCTURAL_TYPES = new Set(["object", "block"]);

async function fetchRepoTree() {
  const url = `https://api.github.com/repos/${PAGES_CMS_REPO}/git/trees/${PAGES_CMS_BRANCH}?recursive=1`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Pages CMS repo tree: ${response.status}`,
    );
  }
  return response.json();
}

function extractCoreFieldTypes(tree) {
  const types = new Set();
  for (const item of tree) {
    const match = item.path.match(/^fields\/core\/([^/]+)\/index\.tsx?$/);
    if (match) {
      types.add(match[1]);
    }
  }
  return types;
}

async function fetchFieldTypeDefinition() {
  const url = `https://raw.githubusercontent.com/${PAGES_CMS_REPO}/${PAGES_CMS_BRANCH}/types/field.ts`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch field.ts: ${response.status}`);
  }
  return response.text();
}

function extractFieldProperties(fieldTypeSrc) {
  // Extract property names from the TypeScript Field type definition
  // Matches patterns like: name: string, name?: string, name: Type | null
  const props = new Set();
  const propRegex = /^\s+(\w+)\??:/gm;
  let match;
  while ((match = propRegex.exec(fieldTypeSrc)) !== null) {
    props.add(match[1]);
  }
  return props;
}

// --- Load config ---

const pagesYmlContent = readFileSync(join(root, ".pages.yml"), "utf8");
const config = parseYaml(pagesYmlContent);

// --- Helper functions ---

function collectFieldTypeErrors(fields, allValidTypes, path = "") {
  const errors = [];
  if (!fields) return errors;

  for (const field of fields) {
    if (!field || typeof field !== "object") continue;
    const fieldPath = path ? `${path}.${field.name}` : field.name;

    if (field.type && !allValidTypes.has(field.type)) {
      errors.push(
        `Invalid field type "${field.type}" at ${fieldPath} (valid: ${[...allValidTypes].sort().join(", ")})`,
      );
    }

    if (field.fields) {
      errors.push(
        ...collectFieldTypeErrors(field.fields, allValidTypes, fieldPath),
      );
    }
    if (field.blocks) {
      for (const block of field.blocks) {
        errors.push(
          ...collectFieldTypeErrors(
            block.fields,
            allValidTypes,
            `${fieldPath}[block:${block.name}]`,
          ),
        );
      }
    }
  }
  return errors;
}

function collectFieldPropertyErrors(fields, validProps, path = "") {
  const errors = [];
  if (!fields) return errors;

  for (const field of fields) {
    if (!field || typeof field !== "object") continue;
    const fieldPath = path ? `${path}.${field.name}` : field.name;

    for (const key of Object.keys(field)) {
      if (!validProps.has(key)) {
        errors.push(
          `Unknown field property "${key}" at ${fieldPath} (valid: ${[...validProps].sort().join(", ")})`,
        );
      }
    }

    if (field.fields) {
      errors.push(
        ...collectFieldPropertyErrors(field.fields, validProps, fieldPath),
      );
    }
    if (field.blocks) {
      for (const block of field.blocks) {
        errors.push(
          ...collectFieldPropertyErrors(
            block.fields,
            validProps,
            `${fieldPath}[block:${block.name}]`,
          ),
        );
      }
    }
  }
  return errors;
}

function getConfigFieldNames(fields) {
  if (!fields) return new Set();
  return new Set(fields.map((f) => f.name));
}

function getBlockDefinition(blocksConfig, blockType) {
  if (!blocksConfig) return null;
  return blocksConfig.find((b) => b.name === blockType) || null;
}

function findMissingFields(frontmatterObj, configFields, path = "") {
  const missing = [];
  if (!frontmatterObj || typeof frontmatterObj !== "object") return missing;

  const configNames = getConfigFieldNames(configFields);

  for (const [key, value] of Object.entries(frontmatterObj)) {
    const fieldPath = path ? `${path}.${key}` : key;

    // Skip 'body' as it maps to markdown content, not frontmatter
    if (key === "body") continue;

    if (!configNames.has(key)) {
      missing.push(fieldPath);
      continue;
    }

    const fieldConfig = configFields.find((f) => f.name === key);
    if (!fieldConfig) continue;

    // Recurse into nested objects
    if (fieldConfig.type === "object" && fieldConfig.fields && value) {
      if (fieldConfig.list && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          missing.push(
            ...findMissingFields(
              value[i],
              fieldConfig.fields,
              `${fieldPath}[${i}]`,
            ),
          );
        }
      } else if (typeof value === "object" && !Array.isArray(value)) {
        missing.push(
          ...findMissingFields(value, fieldConfig.fields, fieldPath),
        );
      }
    }

    // Recurse into block fields
    if (fieldConfig.type === "block" && Array.isArray(value)) {
      const bKey = fieldConfig.blockKey || "type";
      for (let i = 0; i < value.length; i++) {
        const blockItem = value[i];
        if (!blockItem || typeof blockItem !== "object") continue;
        const blockType = blockItem[bKey];
        const blockDef = getBlockDefinition(fieldConfig.blocks, blockType);

        if (!blockDef) {
          missing.push(
            `${fieldPath}[${i}] (unknown block type "${blockType}")`,
          );
          continue;
        }

        const blockFieldNames = getConfigFieldNames(blockDef.fields);
        for (const [bFieldKey, bFieldValue] of Object.entries(blockItem)) {
          if (bFieldKey === bKey) continue;
          const bFieldPath = `${fieldPath}[${i}:${blockType}].${bFieldKey}`;
          if (!blockFieldNames.has(bFieldKey)) {
            missing.push(bFieldPath);
          }

          // Recurse into nested objects within blocks
          const bFieldConfig = blockDef.fields?.find(
            (f) => f.name === bFieldKey,
          );
          if (
            bFieldConfig?.type === "object" &&
            bFieldConfig.fields &&
            bFieldValue
          ) {
            if (bFieldConfig.list && Array.isArray(bFieldValue)) {
              for (let j = 0; j < bFieldValue.length; j++) {
                missing.push(
                  ...findMissingFields(
                    bFieldValue[j],
                    bFieldConfig.fields,
                    `${bFieldPath}[${j}]`,
                  ),
                );
              }
            } else if (
              typeof bFieldValue === "object" &&
              !Array.isArray(bFieldValue)
            ) {
              missing.push(
                ...findMissingFields(
                  bFieldValue,
                  bFieldConfig.fields,
                  bFieldPath,
                ),
              );
            }
          }
        }
      }
    }
  }

  return missing;
}

function getMarkdownFiles(dirPath) {
  if (!existsSync(dirPath)) return [];
  const files = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...getMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

// --- Tests ---

let coreFieldTypes;
let allValidTypes;
let validFieldProperties;

beforeAll(async () => {
  const [treeData, fieldTypeSrc] = await Promise.all([
    fetchRepoTree(),
    fetchFieldTypeDefinition(),
  ]);

  coreFieldTypes = extractCoreFieldTypes(treeData.tree);
  allValidTypes = new Set([...coreFieldTypes, ...STRUCTURAL_TYPES]);
  validFieldProperties = extractFieldProperties(fieldTypeSrc);
});

describe("Pages CMS source validation", () => {
  test("successfully fetched core field types from Pages CMS repo", () => {
    expect(coreFieldTypes.size).toBeGreaterThan(0);
    expect(coreFieldTypes.has("string")).toBe(true);
    expect(coreFieldTypes.has("number")).toBe(true);
    expect(coreFieldTypes.has("boolean")).toBe(true);
    expect(coreFieldTypes.has("image")).toBe(true);
  });

  test("successfully extracted field properties from Pages CMS types/field.ts", () => {
    expect(validFieldProperties.size).toBeGreaterThan(0);
    expect(validFieldProperties.has("name")).toBe(true);
    expect(validFieldProperties.has("type")).toBe(true);
    expect(validFieldProperties.has("label")).toBe(true);
    expect(validFieldProperties.has("fields")).toBe(true);
  });

  test("structural types (object, block) are not in fields/core/ but are valid", () => {
    expect(coreFieldTypes.has("object")).toBe(false);
    expect(coreFieldTypes.has("block")).toBe(false);
    expect(allValidTypes.has("object")).toBe(true);
    expect(allValidTypes.has("block")).toBe(true);
  });
});

describe(".pages.yml field type validation", () => {
  test("all field types are valid Pages CMS types", () => {
    const allErrors = [];

    for (const entry of config.content || []) {
      const errors = collectFieldTypeErrors(
        entry.fields,
        allValidTypes,
        `content[${entry.name}]`,
      );
      allErrors.push(...errors);
    }

    if (allErrors.length > 0) {
      throw new Error(
        `Invalid field types found:\n${allErrors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
  });

  test("no use of unsupported 'type: array'", () => {
    const content = readFileSync(join(root, ".pages.yml"), "utf8");
    const arrayMatches = [...content.matchAll(/type:\s*array/g)];
    expect(arrayMatches.length).toBe(0);
  });

  test("all field properties are valid Pages CMS field properties", () => {
    const allErrors = [];

    for (const entry of config.content || []) {
      const errors = collectFieldPropertyErrors(
        entry.fields,
        validFieldProperties,
        `content[${entry.name}]`,
      );
      allErrors.push(...errors);
    }

    if (allErrors.length > 0) {
      throw new Error(
        `Unknown field properties found:\n${allErrors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
  });
});

describe("frontmatter vs .pages.yml alignment", () => {
  const fileEntries = (config.content || []).filter(
    (entry) => entry.type === "file" && entry.path.endsWith(".md"),
  );

  for (const entry of fileEntries) {
    test(`${entry.label || entry.name}: frontmatter fields match config`, () => {
      const filePath = join(root, entry.path);
      if (!existsSync(filePath)) {
        throw new Error(`Content file not found: ${entry.path}`);
      }

      const frontmatter = parseFrontmatter(filePath);
      if (!frontmatter) {
        throw new Error(`No frontmatter found in ${entry.path}`);
      }

      const missing = findMissingFields(frontmatter, entry.fields);
      if (missing.length > 0) {
        throw new Error(
          `Fields in ${entry.path} frontmatter not defined in .pages.yml config for "${entry.name}":\n${missing.map((m) => `  - ${m}`).join("\n")}`,
        );
      }
    });
  }

  const collectionEntries = (config.content || []).filter(
    (entry) => entry.type === "collection",
  );

  for (const entry of collectionEntries) {
    test(`${entry.label || entry.name} collection: frontmatter fields match config`, () => {
      const dirPath = join(root, entry.path);
      if (!existsSync(dirPath)) return;

      const mdFiles = getMarkdownFiles(dirPath);
      const excludeSet = new Set(
        (entry.exclude || []).map((f) => join(root, entry.path, f)),
      );

      const filesToParse = mdFiles.filter((f) => !excludeSet.has(f));
      const frontmatterMap = parseFrontmatterBatch(filesToParse);

      const allMissing = [];
      for (const filePath of filesToParse) {
        const frontmatter = frontmatterMap[filePath];
        if (!frontmatter) continue;

        const relativePath = filePath.replace(root + "/", "");
        const missing = findMissingFields(frontmatter, entry.fields);
        if (missing.length > 0) {
          allMissing.push(
            `${relativePath}:\n${missing.map((m) => `    - ${m}`).join("\n")}`,
          );
        }
      }

      if (allMissing.length > 0) {
        throw new Error(
          `Collection "${entry.name}" has files with frontmatter fields not in .pages.yml:\n${allMissing.join("\n")}`,
        );
      }
    });
  }
});
