// Статический сервер для дизайн-песочницы Cookish.
// Запуск: npm run design  (или node scripts/serve-design.mjs [--port 4173])
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "design");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4173;

const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

http.createServer((request, response) => {
  const url = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const file = path.join(root, decodeURIComponent(url));
  if (!file.startsWith(root)) {
    response.writeHead(403);
    response.end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Не найдено");
      return;
    }
    const type = types[path.extname(file)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    response.end(data);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Cookish design mocks: http://127.0.0.1:${port}/`);
});
