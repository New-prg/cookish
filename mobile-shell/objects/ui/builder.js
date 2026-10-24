// «Собрать с ИИ»: the person says in words what to track, the Сборщик answers
// with a checked Предложение of tracks, screens and cards, and the person
// applies it as one undoable change or asks for another version.
import { buildProposal } from "../core/builder.js";
import { applyBundle } from "../kit/pipeline.js";
import { AI_PROVIDER_NAME } from "../../services/assistant/ai-provider.js";
import { aiKey, aiProvider as provider } from "./ai.js";
import { go, store } from "./runtime.js";
import { fill, h, openSheet, toast } from "./dom.js";

const EXAMPLES = ["Вода: цель 2 литра в день", "Вес по утрам, тренд за месяц", "Давление и пульс утром и вечером", "Сколько трачу на еду по неделям"];

export function builderSheet() {
  const chat = { history: [], proposal: null, reply: "", error: "", problems: [], busy: false };
  openSheet("Собрать с ИИ", (close) => {
    const body = h("div", { class: "form builder" });
    const input = h("textarea", { class: "input", rows: "3", maxlength: "500", "aria-label": "Что отслеживать" });

    async function send() {
      const request = input.value.trim();
      if (!request || chat.busy) return;
      chat.busy = true;
      chat.error = "";
      chat.problems = [];
      render();
      const result = await buildProposal({ provider, state: store.state(), request, today: store.today(), history: chat.history });
      chat.busy = false;
      if (result.ok) {
        chat.history = [...chat.history, { role: "user", content: request }, { role: "assistant", content: result.answer }];
        chat.reply = result.proposal.reply;
        chat.proposal = result.proposal.checked && !result.proposal.checked.noop ? result.proposal : null;
        input.value = "";
      } else {
        chat.error = result.reason;
        chat.problems = (result.problems || []).slice(0, 3).map((problem) => problem.message);
      }
      render();
    }

    function apply() {
      const { checked, summary } = chat.proposal;
      const result = applyBundle(store, checked);
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
      const hasKey = Boolean(aiKey.read());
      input.disabled = chat.busy || !hasKey;
      input.placeholder = chat.history.length ? "Что поменять?" : "Например, хочу считать воду, цель 2 литра в день";
      fill(body,
        hasKey ? null : h("p", { class: "builder-note builder-error", text: "Сборщику нужен ключ ИИ. Его задают в Профиле Cookish, в разделе «Ассистент»." }),
        chat.reply ? h("p", { class: "builder-reply", text: chat.reply }) : null,
        chat.proposal ? h("section", { class: "card list", "aria-label": "Что добавится" },
          chat.proposal.checked.rows.map(([kind, name, detail]) => h("div", { class: "row" },
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
        ...chat.problems.map((message) => h("p", { class: "field-hint", text: message })),
        h("p", { class: "field-hint", text: `Запрос уходит в ${AI_PROVIDER_NAME}. Сборщик видит только устройство пространства: треки, поля, экраны и карточки, без ваших записей.` }),
      );
    }

    render();
    return body;
  });
}
