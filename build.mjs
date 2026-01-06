import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = __dirname;
const dist = path.join(root, "dist");

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// Clean dist
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Copy the already-built static site into dist/
const itemsToCopy = [
  "index.html",
  "assets",
  "library",
  "companion-bridge.js",
  "fluenthour.svg",
  "vite.svg",
  "README.txt",
];

for (const item of itemsToCopy) {
  const src = path.join(root, item);
  if (!exists(src)) continue;
  const dst = path.join(dist, item);
  fs.cpSync(src, dst, { recursive: true });
}

console.log("Built static site into dist/");
