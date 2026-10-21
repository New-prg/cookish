// «Собрать с ИИ»: the person says in words what to track, the Сборщик answers
// with a checked Предложение of types, relations, sets and widgets, and the
// person applies it as one undoable change or asks for another version.
import { buildProposal } from "../core/builder.js";
import { homeOf } from "../core/values.js";
import { AI_PROVIDER_NAME, createRouterAiProvider, fetchTransport } from "../../services/assistant/ai-provider.js";
import { aiKeyStore } from "../../ui/ai-key.js";
import { nativeAiTransport } from "../../ui/platform.js";
import { go, store } from "./runtime.js";
import { fill, h, num, openSheet, toast } from "./dom.js";
import { FORMAT_NAMES } from "./editors.js";
import { DISPLAY_NAMES } from "./widgets.js";

const EXAMPLES = ["Вода: цель 2 литра в день", "Вес по утрам, тренд за месяц", "Давление и пульс утром и вечером", "Сколько трачу на еду по неделям"];

const aiKey = aiKeyStore(window.localStorage);
const provider = createRouterAiProvider({
  getKey: () => aiKey.read(),
  transport: nativeAiTransport(window) || fetchTransport((...args) => window.fetch(...args)),
});

export function builderSheet() {
  const chat = { history: [], proposal: null, reply: "", error: "", busy: false };
  openSheet("Собрать с ИИ", (close) => {
    const body = h("div", { class: "form builder" });
    const input = h("textarea", { class: "input", rows: "3", maxlength: "500", "aria-label": "Что отслеживать" });

    async function send() {
      const request = input.value.trim();
      if (!request || chat.busy) return;
      chat.busy = true;
      chat.error = "";
      render();
      const result = await buildProposal({ provider, state: store.state(), request, today: store.today(), history: chat.history });
      chat.busy = false;
      if (result.ok) {
        chat.history = [...chat.history, { role: "user", content: request }, { role: "assistant", content: result.answer }];
        chat.reply = result.proposal.reply;
        chat.proposal = result.proposal.ops.length ? result.proposal : null;
        input.value = "";
      } else {
        chat.error = result.reason;
      }
      render();
    }

    function apply() {
      const { ops, summary } = chat.proposal;
      const result = store.apply(ops, { actor: "ai", summary });
      if (!result.ok) {
        chat.error = result.reason;
        chat.proposal = null;
        render();
        return;
      }
      close();
      go("#/");
      toast(`Добавлено: ${summary}`, {
        undo: () => {
          const back = store.apply({ op: "revert", changeSetId: result.changeSetId }, { actor: "human", summary: `Отмена: ${summary}` });
          toast(back.ok ? "Отменено" : back.reason, { error: !back.ok });
        },
      });
    }

    function render() {
      const state = store.state();
      const hasKey = Boolean(aiKey.read());
      input.disabled = chat.busy || !hasKey;
      input.placeholder = chat.history.length ? "Что поменять?" : "Например, хочу считать воду, цель 2 литра в день";
      fill(body,
        hasKey ? null : h("p", { class: "builder-note builder-error", text: "Сборщику нужен ключ ИИ. Его задают в Профиле Cookish, в разделе «Ассистент»." }),
        chat.reply ? h("p", { class: "builder-reply", text: chat.reply }) : null,
        chat.proposal ? h("section", { class: "card list", "aria-label": "Что добавится" },
          changeRows(state, chat.proposal.ops).map(([kind, name, detail]) => h("div", { class: "row" },
            h("span", { class: "row-main" }, h("span", { class: "row-title", text: name }), h("span", { class: "row-sub", text: [kind, detail].filter(Boolean).join(" · ") })),
          )),
        ) : null,
        chat.proposal ? h("div", { class: "actions" },
          h("button", { class: "btn btn-primary", onclick: apply }, "Добавить"),
          h("button", { class: "btn btn-quiet", onclick: () => { chat.proposal = null; render(); } }, "Не надо"),
        ) : null,
        chat.history.length || !hasKey ? null : h("div", { class: "chips" }, EXAMPLES.map((text) => h("button", { class: "chip", onclick: () => { input.value = text; input.focus(); } }, text))),
        input,
        h("button", { class: `btn ${chat.proposal ? "btn-quiet" : "btn-primary"}`, disabled: chat.busy || !hasKey, onclick: send }, chat.busy ? "Собираю…" : chat.history.length ? "Уточнить" : "Собрать"),
        chat.error ? h("p", { class: "builder-note builder-error", role: "alert", text: chat.error }) : null,
        h("p", { class: "field-hint", text: `Запрос уходит в ${AI_PROVIDER_NAME}. Сборщик видит только устройство пространства: названия типов, связей и наборов, без ваших записей.` }),
      );
    }

    render();
    return body;
  });
}

// What the Предложение adds, in the person's words.
function changeRows(state, ops) {
  const home = homeOf(state);
  const had = new Set((home?.props?.widgets || []).map((w) => w.id));
  return ops.flatMap((op) => {
    if (op.op === "defineRelation") return [["Связь", op.relation.name, [FORMAT_NAMES[op.relation.format] || op.relation.format, op.relation.unit].filter(Boolean).join(", ")]];
    if (op.op === "defineType") return [["Тип", `${op.type.icon || ""} ${op.type.name}`.trim(), op.type.fact ? "записи вносите вы" : ""]];
    if (op.op === "create" && op.type === "set") return [["Набор", op.name, ""]];
    if (op.op === "update" && op.id === home?.id) {
      return (op.props.widgets || []).filter((w) => !had.has(w.id)).map((w) => ["Виджет на главной", w.title, [DISPLAY_NAMES[w.display], w.goal != null ? `цель ${num(w.goal)}` : ""].filter(Boolean).join(", ")]);
    }
    return [];
  });
}
