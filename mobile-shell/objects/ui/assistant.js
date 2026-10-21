// «Ассистент»: a chat over the object space. The model reads through tools and
// answers with Предложения; each is a card that says in words what changes,
// and nothing is written until the person presses «Применить». A pressed
// Предложение is one undoable change of the journal.
import { createObjectAssistant, discardProposal, newThread, pendingProposals, applyProposal, recheckProposals, revertProposal } from "../core/assistant.js";
import { AI_PROVIDER_NAME } from "../../services/assistant/ai-provider.js";
import { createCatalogService } from "../../services/catalog/catalog.js";
import { platformFetch } from "../../ui/platform.js";
import { NO_AI_KEY, aiKey, aiProvider as provider, withAiConsent } from "./ai.js";
import { local, rerender, store } from "./runtime.js";
import { dayShort, h, num, openSheet, toast, weekdayShort } from "./dom.js";

export const THREAD_KEY = "cookish.objects.assistant.v1";

const EXAMPLES = [
  "Замени ужин сегодня на что-то с рыбой",
  "Составь неделю на 2000 ккал с 130 г белка с понедельника",
  "Добавь бег по средам на 30 минут",
  "Сделай дневник веса",
];

const STATUS_NAMES = { pending: "Ждёт решения", applied: "Применено", discarded: "Отклонено", conflict: "Устарело", reverted: "Отменено" };

const catalog = createCatalogService({ fetchImpl: platformFetch(window) });
const assistant = createObjectAssistant({ provider, getState: () => store.state(), catalog, today: () => store.today() });

function loadThread() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(THREAD_KEY));
    if (saved && Array.isArray(saved.messages) && Array.isArray(saved.log) && Array.isArray(saved.proposals)) return saved;
  } catch {
    // A broken save starts a new conversation.
  }
  return newThread();
}

const save = (thread) => {
  try {
    window.localStorage.setItem(THREAD_KEY, JSON.stringify(thread));
  } catch {
    // The conversation lives on in memory; it just will not survive a reload.
  }
};

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const dateLabel = (date) => `${capital(weekdayShort(date))}, ${dayShort(date)}`;

function chatState() {
  return local("assistant", () => ({ thread: loadThread(), busy: false, progress: "", draft: "", checked: null, stick: false }));
}

async function send(chat, text) {
  if (!text || chat.busy) return;
  chat.busy = true;
  chat.progress = "";
  chat.draft = "";
  chat.stick = true;
  rerender();
  const result = await assistant.run(chat.thread, text, {
    onEvent: (event) => {
      if (event.type === "progress") chat.progress = event.text;
      save(chat.thread);
      chat.stick = true;
      rerender();
    },
  });
  chat.busy = false;
  chat.progress = "";
  chat.checked = null;
  // A request that did not reach the model comes back to the input.
  if (!result.ok && chat.thread.log.at(-1)?.type === "error") chat.draft = text;
  save(chat.thread);
  chat.stick = true;
  rerender();
}

// The first request asks once, as the current app does: the plan goes to a
// provider outside the device.
function trySend(chat, text) {
  if (!text.trim() || chat.busy) return;
  withAiConsent(() => send(chat, text.trim()));
}

function undoProposals(chat, ids) {
  let failed = null;
  for (const id of [...ids].reverse()) {
    const back = revertProposal(store, chat.thread, id);
    if (!back.ok) { failed = back.reason; break; }
  }
  save(chat.thread);
  toast(failed || "Отменено", { error: Boolean(failed) });
  rerender();
}

function applyProposals(chat, ids) {
  const applied = [];
  let failed = null;
  for (const id of ids) {
    const result = applyProposal(store, chat.thread, id);
    if (!result.ok) { failed = result.reason; break; }
    applied.push(id);
  }
  save(chat.thread);
  chat.checked = null;
  if (failed) toast(applied.length ? `Применено ${applied.length}. ${failed}` : failed, { error: true });
  else {
    const summary = chat.thread.proposals.find((proposal) => proposal.id === applied[0])?.summary;
    toast(applied.length === 1 ? `Применено: ${summary}` : `Применено: ${applied.length}`, { undo: () => undoProposals(chat, applied) });
  }
  rerender();
}

function discard(chat, id) {
  discardProposal(chat.thread, id);
  save(chat.thread);
  rerender();
}

function newConversation(chat) {
  const reset = () => { chat.thread = newThread(); chat.draft = ""; chat.checked = null; save(chat.thread); rerender(); };
  if (!pendingProposals(chat.thread).length) { reset(); return; }
  openSheet("Новый разговор", (close) => h("div", { class: "form" },
    h("p", { class: "sheet-text", text: "Предложения, которые вы ещё не применили, пропадут." }),
    h("div", { class: "actions" },
      h("button", { class: "btn btn-primary", onclick: () => { close(); reset(); } }, "Начать заново"),
      h("button", { class: "btn btn-quiet", onclick: close }, "Отмена"),
    ),
  ));
}

// ——— Cards ———

const macros = (values) => `Б ${num(values.protein)} · Ж ${num(values.fat)} · У ${num(values.carbs)}`;

function dayBlock(day, open) {
  const { before, after } = day;
  const ration = day.area === "ration";
  const head = ration ? `${num(before.kcal)} → ${num(after.kcal)} ккал` : before.kcal != null && after.kcal != null ? `расход ${num(before.kcal)} → ${num(after.kcal)} ккал` : "";
  return h("details", { class: "pday", open: open ? true : null },
    h("summary", { class: "pday-head" }, h("span", { class: "pday-date", text: dateLabel(day.date) }), h("span", { class: "pday-kcal", text: head })),
    ration ? h("p", { class: "pday-macros", text: `${macros(before)} → ${macros(after)}` }) : null,
    h("ul", { class: "pday-changes" }, day.changes.map((change) => h("li", {},
      h("span", { class: "pday-label", text: change.label }),
      change.now == null ? h("span", { class: "pday-now", text: "Уберётся" }) : null,
      change.was ? h("span", { class: "pday-was", text: `Было: ${change.was}` }) : change.now == null ? null : h("span", { class: "pday-was", text: "Новое" }),
      change.now == null ? null : h("span", { class: "pday-now", text: `Станет: ${change.now}` }),
    ))),
  );
}

function rowsBlock(rows, title) {
  if (!rows?.length) return null;
  return h("div", { class: "pcard-rows", role: "group", "aria-label": title },
    rows.map(([kind, name, detail]) => h("div", { class: "row" },
      h("span", { class: "row-main" }, h("span", { class: "row-title", text: name }), h("span", { class: "row-sub", text: [kind, detail].filter(Boolean).join(" · ") })),
    )),
  );
}

function proposalCard(chat, proposal) {
  const { preview, status } = proposal;
  const days = preview?.days || [];
  return h("article", { class: `card pcard is-${status}`, "data-proposal-id": proposal.id, "aria-label": `Предложение: ${proposal.summary}` },
    h("header", { class: "pcard-head" },
      h("strong", { class: "pcard-title", text: proposal.summary }),
      h("span", { class: `pcard-status is-${status}`, text: STATUS_NAMES[status] || status }),
    ),
    days.map((day) => dayBlock(day, days.length <= 2)),
    rowsBlock(preview?.rows, days.length ? "Новые продукты" : "Что изменится"),
    (proposal.warnings || []).map((warning) => h("p", { class: "pcard-note", text: `Внимание: ${warning}` })),
    status === "conflict" && proposal.reason ? h("p", { class: "pcard-note is-conflict", role: "status", text: `Больше не подходит: ${proposal.reason}` }) : null,
    status === "pending" ? h("div", { class: "actions" },
      h("button", { class: "btn btn-primary", disabled: chat.busy, onclick: () => applyProposals(chat, [proposal.id]) }, "Применить"),
      h("button", { class: "btn btn-quiet", onclick: () => discard(chat, proposal.id) }, "Отклонить"),
    ) : null,
    status === "conflict" ? h("div", { class: "actions" }, h("button", { class: "btn btn-quiet", onclick: () => discard(chat, proposal.id) }, "Отклонить")) : null,
    status === "applied" && proposal.changeSetId ? h("div", { class: "actions" }, h("button", { class: "btn btn-quiet", onclick: () => undoProposals(chat, [proposal.id]) }, "Отменить")) : null,
  );
}

function entryNode(chat, entry) {
  switch (entry.type) {
    case "user": return h("div", { class: "assist-msg from-user", text: entry.text });
    case "assistant": return h("div", { class: "assist-msg from-assistant", text: entry.text });
    case "error": return h("p", { class: "assist-note is-error", role: "alert", text: entry.text });
    case "compacted": return h("p", { class: "assist-note", text: entry.text });
    case "proposal": {
      const proposal = chat.thread.proposals.find((value) => value.id === entry.proposalId);
      return proposal ? proposalCard(chat, proposal) : null;
    }
    default: return null;
  }
}

export function assistantScreen() {
  const chat = chatState();
  const state = store.state();
  const hasKey = Boolean(aiKey.read());
  const { thread } = chat;
  // Opening, or any change of the space, checks the waiting Предложения again.
  if (!chat.busy && chat.checked !== state && thread.proposals.some((p) => p.status === "pending" || p.status === "conflict")) {
    recheckProposals(state, thread, store.today());
    save(thread);
  }
  chat.checked = state;
  const pending = pendingProposals(thread);
  const started = thread.log.some((entry) => entry.type === "user");
  const input = h("textarea", { class: "input assist-input", rows: "2", maxlength: "1000", "aria-label": "Сообщение ассистенту", placeholder: hasKey ? "Что изменить в плане?" : "Нужен ключ ИИ", disabled: chat.busy || !hasKey, value: chat.draft });
  input.addEventListener("input", () => { chat.draft = input.value; });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) trySend(chat, input.value); });

  if (chat.stick) {
    chat.stick = false;
    requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  }
  return [
    h("header", { class: "page-head" },
      h("div", {}, h("h1", { class: "page-title", text: "Ассистент" }), h("p", { class: "page-sub", text: "Предлагает, вы решаете" })),
      started ? h("button", { class: "btn btn-quiet btn-small", disabled: chat.busy, onclick: () => newConversation(chat) }, "Новый разговор") : null,
    ),
    hasKey ? null : h("div", { class: "assist-feed" },
      h("p", { class: "assist-note is-error", text: NO_AI_KEY }),
      h("a", { class: "btn btn-quiet", href: "#/profile" }, "Открыть Профиль"),
    ),
    h("section", { class: "assist-feed", "aria-label": "Разговор" },
      started ? null : h("div", { class: "assist-intro" },
        h("p", { class: "hint", text: `Спросите про план или попросите его поменять. Ассистент пришлёт предложение, а данные изменятся, только когда вы нажмёте «Применить». Запросы уходят в ${AI_PROVIDER_NAME}.` }),
        hasKey ? h("div", { class: "chips" }, EXAMPLES.map((text) => h("button", { class: "chip", onclick: () => { chat.draft = text; rerender(); } }, text))) : null,
      ),
      thread.log.map((entry) => entryNode(chat, entry)),
      chat.busy ? h("p", { class: "assist-live", role: "status", text: chat.progress || "Ассистент думает…" }) : null,
    ),
    h("div", { class: "assist-dock" },
      pending.length >= 2 && !chat.busy ? h("button", { class: "btn btn-primary btn-block", onclick: () => applyProposals(chat, pending.map((p) => p.id)) }, `Применить все (${pending.length})`) : null,
      h("form", { class: "assist-compose", onsubmit: (event) => { event.preventDefault(); trySend(chat, input.value); } },
        input,
        h("button", { class: "btn btn-primary assist-send", type: "submit", disabled: chat.busy || !hasKey }, chat.busy ? "Думаю…" : "Отправить"),
      ),
    ),
  ];
}
