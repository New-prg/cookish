// Static server for mobile-shell, to open the object prototype in a browser:
//   node scripts/serve-objects.mjs [port]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shellDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "mobile-shell");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

export function serveShell(port = 0, host = "127.0.0.1") {
  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(request.url.split("?")[0]);
    const file = path.join(shellDir, url === "/" ? "objects.html" : url);
    if (!file.startsWith(shellDir)) { response.writeHead(403); response.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": `${TYPES[path.extname(file)] || "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
      response.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await serveShell(Number(process.argv[2]) || 5174);
  console.log(`Cookish objects: http://127.0.0.1:${server.address().port}/objects.html`);
}
