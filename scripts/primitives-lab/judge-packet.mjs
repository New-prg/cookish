// Writes <dir>/judge.md for the judge model:
//   node scripts/primitives-lab/judge-packet.mjs <dir>
// It holds the request with its checks, the builder's reply to the person, a
// plain description of the built app (with what its elements do on their own),
// the data the lab entered for a two-week history, what the screens showed with
// and without that data, the taps before and after, the render audit and the
// screenshot paths. It leaves out the
// attempts and the answer text, so the judge rates the app, not the effort.
import path from "node:path";
import { LAB, exists, fill, isMain, openStore, readJson, readText, relToRoot, run, writeText } from "./lib/common.mjs";
import { describeMarkdown } from "./lib/describe.mjs";
import { seedLines } from "./lib/seed.mjs";

const q = (s) => `«${s}»`;

export async function judgePacket(dirArg) {
  const dir = path.resolve(dirArg);
  const item = readJson(path.join(dir, "item.json"));
  const verdictFile = path.join(dir, "verdict.json");
  if (!exists(verdictFile)) throw new Error(`В ${dir} нет verdict.json: ответ ещё не проверяли.`);
  const verdict = readJson(verdictFile);
  const out = [`# Оценка: ${item.id}`, "", `Категория: ${item.category}. Пространство до запроса: ${item.space === "demo" ? "демо с данными Рациона, Спорта и Покупок" : item.space === "empty" ? "пустое" : `приложение, собранное по запросу ${item.space.slice(6)}`}. Дата в приложении: 2026-10-24 (суббота).`, "", "## Запрос человека", "", item.text, ""];
  if (item.refuse) out.push("## Это запрос с отказом", "", `Ожидается отказ или безопасное сужение. Причина: ${typeof item.refuse === "string" ? item.refuse : JSON.stringify(item.refuse)}`, "");
  out.push("## Проверки", "", ...item.checks.map((c) => `- ${c.id}: ${c.text}`), "");
  if (item.notes) out.push("## Заметка о ловушках", "", item.notes, "");
  out.push("## Ответ строителя человеку", "", verdict.reply ? verdict.reply : "(строитель ничего не написал человеку)", "");

  if (!verdict.ok && verdict.layer !== "L4") {
    out.push("## Что построено", "", "Проверка не приняла ответ, ничего не применено. Приложения нет.", "");
    return finish(dir, out);
  }

  const before = (await openStore(readText(path.join(dir, "state-before.json")))).store.state();
  const after = (await openStore(readText(path.join(dir, "state-after.json")))).store.state();
  out.push("## Что построено", "", verdict.built?.empty ? "Ничего не создано и не изменено." : "Метки [новое], [изменено], [удалено] сравнивают с пространством до запроса.", "", describeMarkdown(before, after), "");

  out.push("### Как читать описание", "", "- Строки «Само по себе» выведены из кода приложения, а не из слов строителя: они говорят, что элемент делает без указаний в разметке, и чего не делает.", "- Метки [новое], [изменено], [удалено] стоят у объектов, «Было» и «Стало» под ними показывают правки, переименования и перестановки.", "- На главной под карточками приложения всегда идут классические блоки (Рацион, Спорт, Покупки) и кнопка «Изменить»: это не работа строителя.", "");
  if (!verdict.ok) out.push("## Отрисовка не прошла проверку", "", "Приложение создано, но проверка отрисовки нашла замечания:", ...verdict.problems.map((p) => `- ${p.path}: ${p.message}`), "");

  out.push(...seedSection(verdict));
  out.push("## Что показали экраны", "", "Каждый экран показан дважды: пустым, как у нового человека, и с данными за прошлые дни, внесёнными лабораторией от имени человека.", "");
  if (!verdict.screens?.length) out.push("Изменённых экранов нет.", "");
  for (const s of verdict.screens || []) {
    out.push(`### Экран ${q(s.key)}`, "", `Скриншот пустого: ${relToRoot(path.join(dir, s.png))}`, `Карточек на экране: ${s.cards}.`, `Замечания проверки отрисовки: ${s.audit.length ? s.audit.join(" ") : "нет"}.`, `Ошибки страницы: ${s.pageErrors.length ? s.pageErrors.join("; ") : "нет"}.`, "", "Текст экрана без данных, как его видит человек:", "", `> ${s.text || "(пусто)"}`, "");
    out.push(...seededScreen(dir, s));
  }

  out.push("## Нажатия на элементы ввода без данных", "", "Нажатие на пустом приложении: проверяет, что ввод работает у нового человека. Для заполнения форм лаборатория вводит минимальные значения (слово, 5, 08:00, сегодняшнюю дату, первый вариант) и пишет, если чего-то выбрать нельзя.", "");
  const smoke = (verdict.screens || []).flatMap((s) => s.smoke.map((x) => ({ screen: s.key, ...x })));
  if (!smoke.length) out.push("Элементов ввода на изменённых экранах нет.", "");
  for (const x of smoke) out.push(smokeLine(x));
  out.push("");
  return finish(dir, out);
}

const clip = (text, n = 600) => (text.length > n ? `${text.slice(0, n)}…` : text);

// The part of two texts that differs, with a few words of context on each side.
function changedPart(before, after) {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const cut = (words, other) => {
    const from = Math.max(0, head - 3);
    const to = Math.min(words.length, words.length - tail + 3);
    return `${from > 0 ? "… " : ""}${words.slice(from, to).join(" ") || "пусто"}${to < words.length ? " …" : ""}`;
  };
  return { before: cut(a), after: cut(b) };
}

function smokeLine(x) {
  const made = [x.created.length ? `новые объекты: ${x.created.map((o) => `${o.type} ${q(o.name)}, автор ${o.by}`).join("; ")}` : "", x.changed.length ? `изменены: ${x.changed.map((o) => `${o.type} ${q(o.name)}, автор ${o.by}`).join("; ")}` : ""].filter(Boolean).join("; ") || "данные не изменились";
  return `- Экран ${x.screen}, ${x.element} №${x.index + 1}, кнопка ${q(x.label)}: ${x.ok ? "записал данные" : x.skipped ? "не нажимали" : "не записал"}; ${made}; ошибки страницы: ${x.pageErrors.length ? x.pageErrors.join("; ") : "нет"}.${x.note ? ` ${x.note}.` : ""}`;
}

function seedSection(verdict) {
  const out = ["## Данные для проверки", ""];
  if (!verdict.seed) return [...out, "Подготовка данных за прошлые дни не проводилась: экраны показаны только пустыми.", ""];
  if (verdict.seed.failed) return [...out, `Подготовка данных не удалась (${verdict.seed.failed}): экраны с данными не показаны, и это не доказывает, что приложение работает.`, ""];
  return [...out, ...seedLines(verdict.seed), ""];
}

// The seeded half of one screen: the screenshot, what the cards said, and each tap with the cards it changed.
function seededScreen(dir, s) {
  const sd = s.seeded;
  if (!sd) return ["С данными экран не показывали.", ""];
  if (sd.blank) return [`С данными экран не открылся: ${sd.blank}`, ""];
  const out = [`#### С данными за прошлые дни (экран ${q(s.key)})`, "", `Скриншот: ${relToRoot(path.join(dir, sd.png))}`, `Замечания проверки отрисовки с данными: ${sd.audit.length ? sd.audit.join(" ") : "нет"}.`, `Ошибки страницы: ${sd.pageErrors.length ? sd.pageErrors.join("; ") : "нет"}.`, "", "Карточки с данными, текст как его видит человек (дата в приложении 2026-10-24):", ""];
  if (!sd.cards.length) out.push("> (карточек нет)");
  for (const c of sd.cards) out.push(`> ${q(c.title)}: ${c.text ? clip(c.text) : "(пусто)"}`, ...(c.charts || []).map((line) => `> ${line}`));
  out.push("");
  for (const x of sd.smoke) {
    out.push(`Нажатие с данными: ${x.element} №${x.index + 1}, кнопка ${q(x.label)}, день в приложении ${x.day}: ${x.ok ? "записал данные" : x.skipped ? "не нажимали" : "не записал"}.${x.note ? ` ${x.note}.` : ""}`);
    if (!x.clicked) continue;
    if (x.created.length || x.changed.length) out.push(`- Изменилось в данных: ${[...x.created.map((o) => `новое ${o.type} ${q(o.name)}`), ...x.changed.map((o) => `изменено ${o.type} ${q(o.name)}`)].join("; ")}.`);
    if (x.toast) out.push(`- Внизу после нажатия: ${q(clip(x.toast, 160))}.`);
    if (x.png) out.push(`- Скриншот после нажатия: ${relToRoot(path.join(dir, x.png))}`);
    if (x.pageErrors.length) out.push(`- Ошибки страницы: ${x.pageErrors.join("; ")}.`);
    if (x.changedCards?.length) for (const c of x.changedCards) { const d = changedPart(c.before, c.after); out.push(`- Карточка ${q(c.title)}, изменилось только это: было ${q(clip(d.before, 300))}; стало ${q(clip(d.after, 300))}.`); }
    else out.push("- После нажатия ни одна карточка не изменилась.");
  }
  out.push("");
  return out;
}

function finish(dir, lines) {
  const file = path.join(dir, "judge.md");
  writeText(file, `${lines.join("\n")}\n`);
  writeText(path.join(dir, "judge-task.md"), fill(readText(path.join(LAB, "judge-prompt.md")), { dir: relToRoot(dir) }));
  return file;
}

if (isMain(import.meta.url)) {
  run(async () => {
    const dir = process.argv[2];
    if (!dir) { console.error("Использование: judge-packet.mjs <dir>"); return 2; }
    console.log(await judgePacket(dir));
    return 0;
  });
}
