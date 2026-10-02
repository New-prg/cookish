import { readFileSync } from "node:fs";
import { homedir } from "node:os";
export const KEY = JSON.parse(readFileSync(homedir() + "/.local/share/opencode/auth.json", "utf8")).routerai.key;
export const netStats = { retries: 0, failures: [] };
export async function rai(path, body, method = "POST", attempt = 0) {
  try { const r = await raiOnce(path, body, method); if (r.status >= 500 && attempt < 2) { netStats.retries++; netStats.failures.push(r.status + " " + JSON.stringify(r.json).slice(0, 120)); return rai(path, body, method, attempt + 1); } return r; }
  catch (e) { if (attempt < 2) { netStats.retries++; netStats.failures.push(String(e.message || e)); return rai(path, body, method, attempt + 1); } throw e; }
}
async function raiOnce(path, body, method) {
  const t = Date.now();
  const res = await fetch("https://routerai.ru" + path, {
    method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ms: Date.now() - t, json };
}
