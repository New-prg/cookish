// Sharing is the same printer as the model's context and the same pipeline as
// the model's answer. `exportBundle` writes structure only: never an entry,
// items only where they are structure (catalog rows, habit schedule). `previewImport`
// treats a received text as an untrusted model: key collisions are renamed
// `_2`, `_3`, the rest goes through checkBundle, and the person applies the result.
import { KEYS } from "./catalogue.js";
import { checkBundle } from "./pipeline.js";
import { appSlug, normalizeBundle } from "./normalize.js";
import { live, printSpec, readSpec } from "./spec.js";

export function exportBundle(state, app = null) {
  const spec = readSpec(state);
  const printed = printSpec(spec, { app, items: "structure" });
  const first = printed.tracks[0]?.name;
  const name = (app ? first || app : first || "Приложение").slice(0, 60);
  return JSON.stringify({ v: printed.v, name, ...(printed.tracks.length ? { tracks: printed.tracks } : {}), ...(printed.screens.length ? { screens: printed.screens } : {}) }, null, 2);
}

function freeKey(kind, key, taken) {
  const { max } = KEYS[kind];
  for (let n = 2; ; n++) {
    const tail = `_${n}`;
    const candidate = `${key.slice(0, max - tail.length).replace(/_$/, "")}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Renames what already exists in the space, inside the bundle consistently.
function renameCollisions(bundle, spec) {
  const renames = [];
  const out = JSON.parse(JSON.stringify(bundle));
  const trackMap = new Map();
  const takenTracks = new Set([...Object.keys(spec.tracks), ...(out.tracks || []).map((t) => t.key)]);
  for (const track of out.tracks || []) {
    if (!(track.key in spec.tracks)) continue;
    const key = freeKey("track", track.key, takenTracks);
    takenTracks.add(key);
    trackMap.set(track.key, key);
    renames.push({ kind: "track", from: track.key, to: key });
    track.key = key;
  }
  const takenScreens = new Set([...Object.keys(spec.screens), ...(out.screens || []).map((s) => s.key)]);
  const takenCards = new Set([...Object.keys(spec.cards), ...(out.screens || []).flatMap((s) => (s.cards || []).map((c) => c.key))]);
  for (const screen of out.screens || []) {
    if (screen.key !== "home" && screen.key in spec.screens) {
      const key = freeKey("screen", screen.key, takenScreens);
      takenScreens.add(key);
      renames.push({ kind: "screen", from: screen.key, to: key });
      screen.key = key;
    }
    for (const card of screen.cards || []) {
      if (card.key in spec.cards) {
        const key = freeKey("card", card.key, takenCards);
        takenCards.add(key);
        renames.push({ kind: "card", from: card.key, to: key });
        card.key = key;
      }
      for (const el of card.body || []) if (trackMap.has(el.of)) el.of = trackMap.get(el.of);
    }
  }
  for (const track of out.tracks || []) for (const field of track.fields || []) if (trackMap.has(field.to)) field.to = trackMap.get(field.to);
  return { bundle: out, renames };
}

const appsOf = (spec) => new Set([...Object.values(spec.tracks), ...live(spec.screens), ...live(spec.cards)].map((x) => x.app).filter(Boolean));

export function previewImport(text, state, ctx = {}) {
  const spec = readSpec(state);
  const normalized = normalizeBundle(text, { spec });
  const fail = (layer, problems) => ({ ok: false, layer, problems: problems.slice(0, 6), changes: normalized.changes, ops: [], rows: [], cascades: [], spec, renames: [], name: normalized.bundle?.name });
  if (!normalized.bundle) return fail("L0", normalized.problems);
  if (normalized.bundle.remove?.length) return fail("L1", [{ path: "remove", rule: "import-remove", message: "Общий пакет только добавляет: удалять чужие треки, экраны и карточки он не может. Уберите remove." }]);
  const { bundle, renames } = renameCollisions(normalized.bundle, spec);
  const taken = appsOf(spec);
  let app = appSlug(bundle.name);
  for (let n = 2; taken.has(app); n++) app = `${appSlug(bundle.name).slice(0, 17)}_${n}`;
  const checked = checkBundle(bundle, state, { ...ctx, source: "import", app });
  return { ...checked, changes: [...normalized.changes, ...checked.changes], renames, name: bundle.name, app };
}
