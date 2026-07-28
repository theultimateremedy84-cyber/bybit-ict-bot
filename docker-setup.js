/**
 * docker-setup.js
 *
 * Runs inside the Docker build context BEFORE pnpm install.
 * Replaces "catalog:" version placeholders with real semver values so
 * pnpm can install without access to the full workspace catalog.
 *
 * Also strips the "preinstall" script that enforces pnpm usage (not needed
 * inside Docker where we always call pnpm directly).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Catalog versions (keep in sync with pnpm-workspace.yaml) ─────────────────
const CATALOG = {
  "@types/node": "^22.0.0",
  "drizzle-orm": "^0.45.2",
  "zod": "^3.25.76",
};

function resolvePackageJson(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const pkg = JSON.parse(raw);

  let changed = false;

  for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (!pkg[depField]) continue;
    for (const [name, version] of Object.entries(pkg[depField])) {
      if (version === "catalog:") {
        const resolved = CATALOG[name];
        if (resolved) {
          pkg[depField][name] = resolved;
          changed = true;
          console.log(`  Resolved catalog:${name} → ${resolved}`);
        } else {
          console.warn(`  WARNING: No catalog entry for "${name}" — leaving as-is`);
        }
      }
    }
  }

  // Remove the pnpm-enforcement preinstall script
  if (pkg.scripts?.preinstall) {
    delete pkg.scripts.preinstall;
    changed = true;
  }

  if (changed) {
    writeFileSync(filePath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  Written: ${filePath}`);
  }
}

function walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (entry === "package.json") {
      console.log(`Processing: ${full}`);
      resolvePackageJson(full);
    }
  }
}

console.log("=== docker-setup.js: resolving catalog: dependencies ===");
walk(".");
console.log("=== docker-setup.js: done ===");
