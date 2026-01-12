import { join } from "node:path";
import { root, path, fs, git, rsync, bun, find } from "./utils.js";
import { buildDir, templateRepo } from "./consts.js";

const build = path(buildDir);
const template = path(buildDir, "template");
const dev = path(buildDir, "dev");

const templateExcludes = [".git", "node_modules", "*.md", "test", "test-*"];
const rootExcludes = [
  ".git", "*.nix", "README.md", buildDir, "scripts",
  "node_modules", "package*.json", "bun.lock", "old_site",
];

export const prep = () => {
  console.log("Preparing build...");
  fs.mkdir(build);

  if (!fs.exists(join(template, ".git"))) {
    console.log("Cloning template...");
    fs.rm(template);
    git.clone(templateRepo, template);
  } else {
    console.log("Updating template...");
    git.reset(template, { hard: true });
    git.pull(template);
  }

  find.deleteByExt(dev, ".md");
  rsync(template, dev, { delete: true, exclude: templateExcludes });
  rsync(root, join(dev, "src"), { exclude: rootExcludes });

  sync();

  if (!fs.exists(join(dev, "node_modules"))) {
    console.log("Installing dependencies...");
    bun.install(dev);
  }

  fs.rm(join(dev, "_site"));
  console.log("Build ready.");
};

export const sync = () => {
  rsync(root, join(dev, "src"), {
    update: true,
    exclude: rootExcludes,
    include: ["*/", "**/*.md", "**/*.scss"],
  });
};

if (import.meta.main) prep();
