// Builds the two start states of the corpus on the fixed today, in the
// localStorage form the app reads:
//   node scripts/primitives-lab/spaces.mjs
// empty = what «Пустое пространство» creates (the home dashboard only);
// demo = the example space of the first run.
import { NOW, isMain, SPACES, TODAY, need, openStore, run, spaceFile, writeText } from "./lib/common.mjs";

// The default widgets of ui/runtime.js `ensureHome`, kept in step by hand: that
// module needs a browser to import.
const HOME_WIDGETS = [
  { id: "w_ration", kind: "ration-today", title: "Сегодня в Рационе" },
  { id: "w_sport", kind: "sport-today", title: "Спорт сегодня" },
  { id: "w_requests", kind: "requests", title: "Покупки" },
];

export async function buildSpaces() {
  const out = {};
  {
    const { store, storage } = await openStore();
    const r = store.apply({ op: "create", type: "dashboard", id: "dashboard_home", name: "Главная", props: { widgets: HOME_WIDGETS } }, { actor: "human", summary: "Главная панель" });
    if (!r.ok) throw new Error(`empty: ${r.reason}`);
    out.empty = storage.dump();
  }
  {
    const { legacyToObjects, demoLegacyState } = await need("core/migrate.js");
    const { store, storage } = await openStore();
    const r = store.replaceAll(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW }));
    if (!r.ok) throw new Error(`demo: ${r.reason}`);
    out.demo = storage.dump();
  }
  return out;
}

if (isMain(import.meta.url)) {
  run(async () => {
    const built = await buildSpaces();
    for (const [name, text] of Object.entries(built)) {
      writeText(spaceFile(name), text);
      console.log(`${spaceFile(name)}: ${Object.keys(JSON.parse(text).objects).length} объектов`);
    }
    console.log(`Дата: ${TODAY}; каталог ${SPACES}`);
  });
}
