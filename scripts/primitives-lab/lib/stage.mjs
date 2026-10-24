// The render phase of one answer, shared by check.mjs and repacket.mjs so a new
// answer and a re-judged old one are shown to the judge the same way: the
// changed screens on the state after the answer (with the smoke taps), then the
// same screens on a seeded copy of that state (see seed.mjs) before and after a
// tap. Seeding writes only `state-seeded.json`; `state-after.json` stays as the
// answer left it.
import path from "node:path";
import { LabError, TODAY, need, openStore, writeText } from "./common.mjs";
import { changedScreens, readKit } from "./describe.mjs";
import { renderRoutes, renderSeeded, withBrowser } from "./render.mjs";
import { seedState } from "./seed.mjs";
import { withSlot } from "./slots.mjs";
import { shiftDate } from "../../../mobile-shell/objects/viz/util.js";

const LOOKAHEAD_DAYS = 7;

// The screens a person must look at after the answer, each with the card titles
// it has to show, so a route the app does not know (it falls back to home) is caught.
export function routesFor(stateBefore, stateAfter) {
  const kit = readKit(stateAfter);
  return changedScreens(stateBefore, stateAfter).map((key) => ({
    key,
    hash: key === "home" ? "#/" : `#/screen/${key}`,
    expectCards: process.env.LAB_SKIP_CARD_CHECK ? [] : (kit.screens.find((x) => x.key === key)?.cards || []).map((c) => c.name).filter(Boolean),
  }));
}

// The nearest day after today on which a track has something to mark.
async function dueFinder(seeded) {
  const [{ listTracks, itemsOf, trackOf }, { dueOn }, { slotsOf }] = await Promise.all([
    need("kit/ledger.js", ["listTracks", "itemsOf", "trackOf"]),
    need("kit/schedule.js", ["dueOn"]),
    need("kit/sources.js", ["slotsOf"]),
  ]);
  const state = (await openStore(seeded)).store.state();
  const known = new Set(listTracks(state).map((t) => t.key));
  return (key) => {
    if (!known.has(key)) return null;
    const track = trackOf(state, key);
    for (let i = 1; i <= LOOKAHEAD_DAYS; i += 1) {
      const date = shiftDate(TODAY, i);
      const due = track.kind === "follow" ? slotsOf(state, track.follows, date).length > 0 : itemsOf(state, key).some((item) => !item.archived && dueOn(item, date));
      if (due) return date;
    }
    return null;
  };
}

// A lab failure is tried once more on a fresh slot before it is reported; only a
// lab failure, never a verdict on the answer.
async function inSlot(fn) {
  let last;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await withSlot(() => withBrowser(fn), {
        onWait: () => console.error("Жду свободного места для отрисовки (проверяют сразу много ответов), это нормально."),
      });
    } catch (error) {
      if (error instanceof LabError) throw error;
      last = error;
    }
  }
  throw last;
}

// → { screens, seed }; each screen carries `seeded` when the seeded render ran.
export async function renderStage(dir, serializedAfter, routes) {
  let seeded = null;
  let seed;
  try {
    seeded = await seedState(serializedAfter);
    seed = seeded.report;
    writeText(path.join(dir, "state-seeded.json"), seeded.serialized);
  } catch (error) {
    if (error instanceof LabError) throw error;
    seed = { failed: String(error?.message || error).split("\n")[0] };
  }
  const nextDue = seeded ? await dueFinder(seeded.serialized) : () => null;
  const screens = await inSlot(async (env) => {
    const plain = await renderRoutes(env, serializedAfter, routes, dir);
    if (!seeded) return plain;
    const withData = await renderSeeded(env, seeded.serialized, routes, dir, { nextDue });
    return plain.map((entry) => ({ ...entry, seeded: withData.find((s) => s.key === entry.key) || null }));
  });
  return { screens, seed };
}
