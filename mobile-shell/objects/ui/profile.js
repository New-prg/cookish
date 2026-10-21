// Профиль: the person's body, goal and targets as the singleton `profile`
// object, plus what belongs to this device and not to the space: the AI key,
// the theme and the data of the prototype.
import { profileOf } from "../core/values.js";
import { emptyObjectState } from "../core/store.js";
import { AI_PROVIDER_LABEL } from "../../ui/ai-key.js";
import { aiKey, aiProvider as provider, withAiConsent as withConsent } from "./ai.js";
import { THEME_OPTIONS, themeStore } from "../../ui/theme.js";
import { act, ensureHome, go, isVisibleRelation, rerender, store } from "./runtime.js";
import { fill, h, num, openSheet, pageHeader, segmented, toast } from "./dom.js";
import { relationEditor } from "./editors.js";

const LEGACY_KEY = "cookish.android.data.v1";

// Which relations of the profile sit under which heading. A relation of the
// profile type that no group lists lands in «Ещё», so a new one is not lost.
const GROUPS = [
  { title: "Вы и цель", keys: ["ageGroup", "heightCm", "weightKg", "goal"] },
  { title: "Цели на день", keys: ["targetCalories", "targetProtein", "targetFat", "targetCarbs"] },
  { title: "Питание", keys: ["mealsPerDay", "budget", "excluded", "excludedTerms", "preferences"] },
];

// The check of legacy validateRationProfile: protein and carbs give 4 kcal a
// gram, fat 9. Returns null while the targets agree with the calories (or
// some of them is not set), else the numbers to show.
export function macroMismatch(props) {
  const number = (value) => {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const calories = number(props?.targetCalories);
  const [protein, fat, carbs] = [props?.targetProtein, props?.targetFat, props?.targetCarbs].map(number);
  if (calories == null || !(calories > 0) || protein == null || fat == null || carbs == null) return null;
  const fromMacros = protein * 4 + fat * 9 + carbs * 4;
  return Math.abs(fromMacros - calories) / calories > 0.15 ? { fromMacros, calories } : null;
}

// Theme: the same key as the current app, applied to <html> as data-theme
// ("system" removes it and leaves the choice to prefers-color-scheme).
const themes = themeStore(window.localStorage);
const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");

function applyTheme() {
  const preference = themes.read();
  if (preference === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
  const dark = preference === "dark" || (preference === "system" && Boolean(systemDark?.matches));
  const background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || (dark ? "#121412" : "#f5f4ef");
  const statusBar = window.Capacitor?.Plugins?.StatusBar;
  if (statusBar) {
    // Style "DARK" is light text for a dark background.
    Promise.resolve(statusBar.setStyle?.({ style: dark ? "DARK" : "LIGHT" })).catch(() => {});
    Promise.resolve(statusBar.setBackgroundColor?.({ color: background })).catch(() => {});
  }
}

// Runs when app.js loads this module, before the first screen is drawn.
applyTheme();
systemDark?.addEventListener?.("change", () => { if (themes.read() === "system") applyTheme(); });

// What the person typed and the last answer outlive a re-render of the screen.
let draft = "";
let aiStatus = { text: "", tone: "", busy: false };
let paintAi = () => {};

function setAiStatus(text, tone = "", busy = false) {
  aiStatus = { text, tone, busy };
  paintAi();
}

function confirmSheet({ title, text, yes, danger = false, onYes }) {
  openSheet(title, (close) => [
    h("p", { class: "sheet-text", text }),
    h("div", { class: "actions" },
      h("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, onclick: () => { close(); onYes(); } }, yes),
      h("button", { class: "btn btn-quiet", onclick: close }, "Отмена"),
    ),
  ]);
}

function aiSection() {
  const section = h("section", { class: "card profile-ai", "aria-label": "Ассистент" });
  const input = h("input", {
    class: "input", type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    "aria-label": `Ключ ${AI_PROVIDER_LABEL}`, value: draft, oninput: (event) => { draft = event.target.value; },
  });
  const typed = () => input.value.trim();
  const reset = () => { input.value = ""; draft = ""; };

  const save = () => {
    if (!typed()) return setAiStatus("Вставьте ключ, чтобы сохранить его.", "error");
    if (!aiKey.write(typed())) return setAiStatus("Не удалось сохранить ключ на устройстве.", "error");
    reset();
    return setAiStatus("Ключ сохранён на этом устройстве.", "ok");
  };
  const check = () => {
    if (!typed() && !aiKey.read()) return setAiStatus("Введите ключ, чтобы проверить его.", "error");
    return withConsent(async () => {
      if (typed() && !aiKey.write(typed())) return setAiStatus("Не удалось сохранить ключ на устройстве.", "error");
      reset();
      setAiStatus("Проверяем ключ…", "", true);
      const result = await provider.checkKey().catch((error) => ({ ok: false, reason: error.message }));
      return setAiStatus(result.ok ? "Ключ работает." : result.reason, result.ok ? "ok" : "error");
    });
  };
  const remove = () => confirmSheet({
    title: "Удалить ключ", text: "Удалить ключ ИИ с этого устройства? Ассистент и Сборщик станут недоступны.", yes: "Удалить ключ", danger: true,
    onYes: () => { aiKey.clear(); setAiStatus("Ключ удалён."); },
  });

  paintAi = () => {
    const saved = Boolean(aiKey.read());
    const text = aiStatus.text || (saved ? "Ключ сохранён на этом устройстве." : "Ключ не задан: ассистент недоступен.");
    input.placeholder = saved ? "Ключ сохранён · введите новый, чтобы заменить" : "Вставьте ключ";
    fill(section,
      h("p", { class: "hint", text: "Временное поле на время теста. Ключ хранится только на этом устройстве, отдельно от данных, и общий с текущим Cookish." }),
      h("label", { class: "field" }, h("span", { class: "field-label", text: `Ключ ${AI_PROVIDER_LABEL}` }), input),
      h("p", { class: `profile-status${aiStatus.tone ? ` is-${aiStatus.tone}` : ""}`, role: "status", text }),
      h("div", { class: "actions" },
        h("button", { class: "btn btn-primary", disabled: aiStatus.busy, onclick: save }, "Сохранить"),
        h("button", { class: "btn btn-quiet", disabled: aiStatus.busy, onclick: check }, aiStatus.busy ? "Проверяем…" : "Проверить"),
        h("button", { class: "btn btn-danger", disabled: !saved || aiStatus.busy, onclick: remove }, "Удалить"),
      ),
    );
  };
  paintAi();
  return section;
}

async function reimport() {
  const { importLegacy } = await import("../core/migrate.js");
  const result = importLegacy(store, window.localStorage);
  if (!result.ok) { toast(result.reason || "Не получилось", { error: true }); return; }
  ensureHome();
  go("#/");
  toast("Данные Cookish перенесены");
}

function wipe() {
  const result = store.replaceAll(emptyObjectState());
  if (!result.ok) { toast(result.reason, { error: true }); return; }
  go("#/");
}

function dataSection() {
  let hasLegacy = false;
  try { hasLegacy = Boolean(window.localStorage.getItem(LEGACY_KEY)); } catch { hasLegacy = false; }
  return h("section", { class: "card profile-data", "aria-label": "Данные" },
    h("p", { class: "hint", text: "Данные текущего Cookish прототип только читает: что бы вы здесь ни сделали, там ничего не изменится." }),
    h("button", {
      class: "btn btn-quiet btn-block", disabled: !hasLegacy,
      onclick: () => confirmSheet({
        title: "Перенести заново", text: "Всё, что сейчас в прототипе, будет заменено данными из Cookish. Отменить это нельзя.", yes: "Заменить данными Cookish", danger: true, onYes: reimport,
      }),
    }, "Перенести заново из Cookish"),
    hasLegacy ? null : h("p", { class: "field-hint", text: "На этом устройстве нет данных Cookish" }),
    h("button", {
      class: "btn btn-danger btn-block",
      onclick: () => confirmSheet({
        title: "Удалить все данные прототипа", text: "Все объекты, типы, наборы и виджеты прототипа будут удалены, и он начнётся с чистого экрана. Данные Cookish не затрагиваются.", yes: "Удалить всё", danger: true, onYes: wipe,
      }),
    }, "Удалить все данные прототипа"),
  );
}

function propsCard(state, profile, keys) {
  const rows = keys.map((key) => state.relations[key]).filter(isVisibleRelation);
  return h("section", { class: "card props" },
    rows.map((rel) => h("div", { class: `prop prop-${rel.format}` },
      h("span", { class: "prop-label", text: rel.name }),
      h("div", { class: "prop-value" }, relationEditor(state, profile, rel)),
    )),
  );
}

export function profileScreen() {
  const state = store.state();
  const profile = profileOf(state);
  const head = pageHeader({ title: "Профиль", back: true });

  const listed = new Set(GROUPS.flatMap((g) => g.keys));
  const extra = (state.types.profile?.relations || []).filter((key) => !listed.has(key) && key !== "name");
  const groups = [...GROUPS, ...(extra.length ? [{ title: "Ещё", keys: extra }] : [])];

  const mismatch = profile ? macroMismatch(profile.props) : null;

  return [
    head,
    profile ? groups.map((group) => h("section", { class: "block", "data-group": group.title },
      h("h2", { class: "section-title", text: group.title }),
      propsCard(state, profile, group.keys),
      group.title === "Цели на день" && mismatch ? h("div", { class: "banner", role: "status" },
        h("span", { text: `БЖУ расходятся с калориями больше чем на 15%: белки, жиры и углеводы дают ${num(mismatch.fromMacros)} ккал, а цель ${num(mismatch.calories)}.` }),
      ) : null,
    )) : h("section", { class: "block" },
      h("p", { class: "empty", text: "Профиль пока не заполнен. Цели и данные тела нужны Рациону и ассистенту." }),
      h("button", { class: "btn btn-primary btn-block", onclick: () => act({ op: "create", type: "profile", name: "Профиль" }, { summary: "Профиль" }) }, "Заполнить профиль"),
    ),
    h("section", { class: "block" }, h("h2", { class: "section-title", text: "Ассистент" }), aiSection()),
    h("section", { class: "block" },
      h("h2", { class: "section-title", text: "Тема" }),
      segmented(THEME_OPTIONS.map(([id, name]) => ({ id, name })), themes.read(), (id) => { themes.write(id); applyTheme(); rerender(); }, { label: "Тема" }),
    ),
    h("section", { class: "block" }, h("h2", { class: "section-title", text: "Данные" }), dataSection()),
  ];
}
