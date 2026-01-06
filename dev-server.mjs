import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = __dirname;
const port = Number(process.env.PORT || process.env.VITE_PORT || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0] || "/");
  const rel = decoded.replace(/^\/+/, ""); // remove leading slash
  const normalized = path.normalize(rel);
  const joined = path.join(root, normalized);

  // Prevent path traversal
  if (!joined.startsWith(root)) return null;
  return joined;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...headers });
  res.end(body);
}

function serveFile(filePath, res) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      if (fs.existsSync(indexPath)) return serveFile(indexPath, res);
      return send(res, 404, "Not found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const filePath = safeJoin(rootDir, url);
  if (!filePath) return send(res, 400, "Bad request");

  // Try file first
  if (fs.existsSync(filePath)) return serveFile(filePath, res);

  // SPA fallback for client-side routes
  const accept = String(req.headers.accept || "");
  if (accept.includes("text/html")) {
    const indexPath = path.join(rootDir, "index.html");
    return serveFile(indexPath, res);
  }

  return send(res, 404, "Not found");
});

server.listen(port, "0.0.0.0", () => {
  // Print a Vite-like hint line (nice for your run script output)
  console.log(`\n  FluentHour dev server running at:`); 
  console.log(`  > Local:   http://localhost:${port}/`); 
  console.log(`\n  (This is a static build served locally; edit source upstream if needed.)\n`);
});
