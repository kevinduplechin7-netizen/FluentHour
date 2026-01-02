import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const dist = path.join(projectRoot, "dist");

const toCopy = [
  "index.html",
  "companion-bridge.js",
  "fluenthour.svg",
  "vite.svg",
  "assets",
  "library"
];

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmrf(p) {
  if (await exists(p)) {
    await fs.rm(p, { recursive: true, force: true });
  }
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(from, to);
    } else if (e.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

async function copyAny(entry) {
  const src = path.join(projectRoot, entry);
  const dst = path.join(dist, entry);
  if (!(await exists(src))) {
    console.warn(`[build] Skipping missing: ${entry}`);
    return;
  }
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await copyDir(src, dst);
  } else {
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }
}

console.log("[build] Rebuilding dist/");
await rmrf(dist);
await fs.mkdir(dist, { recursive: true });

for (const entry of toCopy) {
  await copyAny(entry);
}

console.log("[build] Done. dist/ is ready for Netlify publish.");
