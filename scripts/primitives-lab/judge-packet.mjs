// Writes <dir>/judge.md for the judge model:
//   node scripts/primitives-lab/judge-packet.mjs <dir>
// It holds the request with its checks, the builder's reply to the person, a
// plain description of the built app, what the screens showed, the smoke
// interactions, the render audit and the screenshot paths. It leaves out the
// attempts and the answer text, so the judge rates the app, not the effort.
import path from "node:path";
import { LAB, exists, fill, isMain, openStore, readJson, readText, relToRoot, run, writeText } from "./lib/common.mjs";
import { describeMarkdown } from "./lib/describe.mjs";

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

  if (!verdict.ok) out.push("## Отрисовка не прошла проверку", "", "Приложение создано, но проверка отрисовки нашла замечания:", ...verdict.problems.map((p) => `- ${p.path}: ${p.message}`), "");

  out.push("## Что показали экраны", "");
  if (!verdict.screens?.length) out.push("Изменённых экранов нет.", "");
  for (const s of verdict.screens || []) {
    out.push(`### Экран ${q(s.key)}`, "", `Скриншот: ${relToRoot(path.join(dir, s.png))}`, `Карточек на экране: ${s.cards}.`, `Замечания проверки отрисовки: ${s.audit.length ? s.audit.join(" ") : "нет"}.`, `Ошибки страницы: ${s.pageErrors.length ? s.pageErrors.join("; ") : "нет"}.`, "", "Текст экрана, как его видит человек:", "", `> ${s.text || "(пусто)"}`, "");
  }

  out.push("## Нажатия на элементы ввода", "");
  const smoke = (verdict.screens || []).flatMap((s) => s.smoke.map((x) => ({ screen: s.key, ...x })));
  if (!smoke.length) out.push("Элементов ввода на изменённых экранах нет.", "");
  for (const x of smoke) {
    const made = [x.created.length ? `новые объекты: ${x.created.map((o) => `${o.type} ${q(o.name)}, автор ${o.by}`).join("; ")}` : "", x.changed.length ? `изменены: ${x.changed.map((o) => `${o.type} ${q(o.name)}, автор ${o.by}`).join("; ")}` : ""].filter(Boolean).join("; ") || "данные не изменились";
    out.push(`- Экран ${x.screen}, ${x.element} №${x.index + 1}, кнопка ${q(x.label)}: ${x.ok ? "записал данные" : x.skipped ? "не нажимали" : "не записал"}; ${made}; ошибки страницы: ${x.pageErrors.length ? x.pageErrors.join("; ") : "нет"}.${x.note ? ` ${x.note}.` : ""}`);
  }
  out.push("");
  return finish(dir, out);
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
