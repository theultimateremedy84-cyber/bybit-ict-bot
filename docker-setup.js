/**
 * docker-setup.js
 *
 * Runs inside the Docker build context BEFORE pnpm install.
 * Replaces "catalog:" version placeholders with real semver values so
 * pnpm can install without access to the full workspace catalog.
 * Also strips the "preinstall" script that enforces pnpm usage.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Catalog versions (keep in sync with pnpm-workspace.yaml) ─────────────────
const CATALOG = {
  // Shared
  "@types/node":   "^22.0.0",
  "drizzle-orm":   "^0.45.2",
  "zod":           "^3.25.76",

  // React / Vite ecosystem (dashboard)
  "@replit/vite-plugin-cartographer":        "^0.5.21",
  "@replit/vite-plugin-dev-banner":          "^0.1.1",
  "@replit/vite-plugin-runtime-error-modal": "^0.0.6",
  "@tailwindcss/vite":    "^4.1.14",
  "@tanstack/react-query":"^5.90.21",
  "@types/react":         "^19.2.0",
  "@types/react-dom":     "^19.2.0",
  "@vitejs/plugin-react": "^5.0.4",
  "class-variance-authority": "^0.7.1",
  "clsx":                 "^2.1.1",
  "framer-motion":        "^12.23.24",
  "lucide-react":         "^0.545.0",
  "react":                "19.1.0",
  "react-dom":            "19.1.0",
  "tailwind-merge":       "^3.3.1",
  "tailwindcss":          "^4.1.14",
  "vite":                 "^7.3.2",
  "wouter":               "^3.3.5",
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
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", ".git"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry === "package.json") {
      console.log(`Processing: ${full}`);
      resolvePackageJson(full);
    }
  }
}

console.log("=== docker-setup.js: resolving catalog: dependencies ===");
walk(".");
console.log("=== docker-setup.js: done ===");
