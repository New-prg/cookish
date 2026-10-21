import assert from "node:assert/strict";
import { test } from "node:test";
import { openApp, rationWidget, shot, tapNav, text, useUi, waitText } from "./objects-ui-helpers.mjs";

useUi("objects-shots-assistant");

const KEY_STORAGE = "cookish.ai.key.test";
const CONSENT_STORAGE = "cookish.ai.consent.v1";
const THREAD_STORAGE = "cookish.objects.assistant.v1";
const SPACE_STORAGE = "cookish.objects.v1";

const keyOf = (date) => date.toLocaleDateString("sv-SE");
const TODAY = keyOf(new Date());
const TOMORROW = keyOf(new Date(Date.now() + 86400000));

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
let callNumber = 0;
const toolCall = (name, args) => ({ role: "assistant", content: "", tool_calls: [{ id: `call_${callNumber += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const answer = (content) => ({ role: "assistant", content });

// The model as routerai.ru would answer: it reads today's plan, then proposes
// a day built from what it read, so the test does not depend on the weekday.
function fakeModel(messages) {
  const last = messages.at(-1);
  const said = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  if (last.role === "user") {
    if (/бег/.test(said)) return toolCall("propose_day", { area: "sport", date: TOMORROW, sessions: [{ kind: "run", time: "07:30", duration: 30, intensity: "medium" }] });
    return toolCall("get_plan", { area: "ration", from: TODAY, to: TODAY });
  }
  const name = messages.flatMap((message) => message.tool_calls || []).find((entry) => entry.id === last.tool_call_id)?.function.name;
  const result = JSON.parse(last.content);
  if (name === "get_plan") {
    const factor = /900/.test(said) ? 0.4 : 1;
    const meals = result.days[0].meals.map((meal) => ({
      name: meal.name,
      time: meal.time,
      items: meal.name === "Ужин" && factor === 1
        ? [{ product: "product_salmon", amount: 200 }, { product: "product_rice", amount: 80 }, { product: "product_salad", amount: 150 }]
        : meal.items.filter((item) => item.id).map((item) => ({ product: item.id, amount: Math.round(item.amount * factor) })),
    }));
    return toolCall("propose_day", { area: "ration", date: TODAY, meals });
  }
  if (result.ok) return answer("Предложила, посмотрите карточку.");
  return answer(`Не получилось: ${(result.problems || [result.error]).join("; ")}`);
}

async function fakeProvider(context, sent) {
  await context.route("https://routerai.ru/**", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    const body = route.request().postDataJSON();
    sent.push(body);
    await route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ choices: [{ message: fakeModel(body.messages) }], usage: { prompt_tokens: 1200 } }) });
  });
}

async function startOnAssistant(options) {
  const app = await openApp(options);
  await app.page.getByRole("button", { name: "Начать с примера" }).click();
  await rationWidget(app.page).waitFor();
  await tapNav(app.page, "Ассистент");
  await app.page.getByRole("heading", { name: "Ассистент", level: 1 }).waitFor();
  return app;
}

const card = (page, summary) => page.locator("article.pcard", { hasText: summary });
const send = async (page, words) => {
  await page.getByLabel("Сообщение ассистенту").fill(words);
  await page.getByRole("button", { name: "Отправить" }).click();
};

test("without a key the assistant says where to get one and sends nothing", async () => {
  const { context, page, errors } = await startOnAssistant();
  await page.getByText("Нужен ключ ИИ").waitFor();
  assert.equal(await page.getByLabel("Сообщение ассистенту").isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Отправить" }).isDisabled(), true);
  await shot(page, "assistant-nokey-light");
  await page.getByRole("link", { name: "Открыть Профиль" }).click();
  await page.getByRole("heading", { name: "Профиль", level: 1 }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test("consent once, a proposal card, apply and undo, a refusal, two pending ones, reload and a stale one", async () => {
  const { context, page, errors } = await startOnAssistant();
  const sent = [];
  await fakeProvider(context, sent);
  await page.evaluate((key) => localStorage.setItem(key, "test-key"), KEY_STORAGE);
  await tapNav(page, "Главная");
  await tapNav(page, "Ассистент");
  await page.getByRole("button", { name: "Замени ужин сегодня на что-то с рыбой" }).waitFor();
  await shot(page, "assistant-empty-light");

  // The first request asks for the consent; nothing leaves before it.
  await page.getByRole("button", { name: "Замени ужин сегодня на что-то с рыбой" }).click();
  await page.waitForFunction(() => document.querySelector("textarea.assist-input")?.value === "Замени ужин сегодня на что-то с рыбой");
  await page.getByRole("button", { name: "Отправить" }).click();
  await page.getByText("отправляет данные плана").waitFor();
  await shot(page, "assistant-consent-light");
  assert.equal(sent.length, 0);
  await page.getByRole("button", { name: "Понятно, продолжить" }).click();

  const fish = card(page, "Особый день");
  await fish.waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), CONSENT_STORAGE), "1");
  assert.match(await text(page.locator(".assist-msg.from-user")), /что-то с рыбой/);
  await page.getByText("Предложила, посмотрите карточку.").waitFor();
  assert.match(await waitText(fish, /Ждёт решения/), /Ужин/);
  const body = await text(fish);
  assert.match(body, /ккал/);
  assert.match(body, /Было:.*Станет:.*Лосось 200 г/);
  assert.equal(await page.evaluate(([key, date]) => Object.values(JSON.parse(localStorage.getItem(key)).objects).some((o) => o.type === "day_plan" && o.props.date === date), [SPACE_STORAGE, TODAY]), false, "nothing is written before «Применить»");
  assert.match(JSON.stringify(sent[0].messages[0].content), /Контекст/, "the system prompt carries the context");
  await shot(page, "assistant-proposal-light");

  // A dark twin of the same screen, from the saved conversation.
  const dark = await openApp({ colorScheme: "dark", storageState: await context.storageState() });
  await dark.page.goto(`${dark.page.url().split("#")[0]}#/assistant`);
  await card(dark.page, "Особый день").waitFor();
  await shot(dark.page, "assistant-proposal-dark");
  await dark.context.close();

  await fish.getByRole("button", { name: "Применить" }).click();
  await waitText(fish.locator(".pcard-status"), /Применено/);
  const toast = page.locator(".toast", { hasText: "Применено: Особый день" });
  await toast.waitFor();
  assert.equal(await page.evaluate(([key, date]) => Object.values(JSON.parse(localStorage.getItem(key)).objects).some((o) => o.type === "day_plan" && o.props.date === date && !o.archivedAt), [SPACE_STORAGE, TODAY]), true);
  await shot(page, "assistant-applied-light");
  await toast.getByRole("button", { name: "Отменить" }).click();
  await waitText(fish.locator(".pcard-status"), /Отменено/);
  assert.equal(await page.evaluate(([key, date]) => Object.values(JSON.parse(localStorage.getItem(key)).objects).some((o) => o.type === "day_plan" && o.props.date === date && !o.archivedAt), [SPACE_STORAGE, TODAY]), false, "undo removes the Особый день");

  // A request the code refuses: no card, the model got the reason back.
  const cards = await page.locator("article.pcard").count();
  await send(page, "Хочу 900 ккал в день");
  await page.getByText(/Не получилось: .*ниже безопасного минимума/).waitFor();
  assert.equal(await page.locator("article.pcard").count(), cards, "a refused proposal leaves no card");
  assert.match(sent.at(-1).messages.at(-1).content, /ниже безопасного минимума/);
  await shot(page, "assistant-refusal-light");

  // Two pending proposals: apply all, then they survive a reload.
  await send(page, "Верни рыбу на ужин");
  await page.locator("article.pcard.is-pending").first().waitFor();
  await send(page, "Добавь бег завтра на 30 минут");
  await page.locator("article.pcard.is-pending").nth(1).waitFor();
  await page.getByRole("button", { name: "Применить все (2)" }).waitFor();
  await shot(page, "assistant-two-pending-light");
  await page.reload();
  await page.getByRole("heading", { name: "Ассистент", level: 1 }).waitFor();
  assert.equal(await page.locator("article.pcard.is-pending").count(), 2, "the conversation survives a reload");
  await page.getByRole("button", { name: "Применить все (2)" }).waitFor();

  // The space changed meanwhile: the waiting day no longer fits the targets.
  await page.evaluate((key) => {
    const space = JSON.parse(localStorage.getItem(key));
    const profile = Object.values(space.objects).find((o) => o.type === "profile");
    profile.props.targetCalories = 3600;
    localStorage.setItem(key, JSON.stringify(space));
  }, SPACE_STORAGE);
  await page.reload();
  await page.getByRole("heading", { name: "Ассистент", level: 1 }).waitFor();
  await page.locator(".pcard-status.is-conflict").waitFor();
  assert.match(await text(page.locator(".pcard-note.is-conflict")), /отличается от цели 3600/);
  assert.equal(await page.getByRole("button", { name: /Применить все/ }).count(), 0);
  await shot(page, "assistant-conflict-light");

  // The sport one still fits: apply it, then start over.
  const run = page.locator("article.pcard.is-pending", { hasText: "Тренировки" });
  await run.getByRole("button", { name: "Применить" }).click();
  await page.locator("article.pcard.is-applied", { hasText: "Тренировки" }).waitFor();
  await page.getByRole("button", { name: "Новый разговор" }).click();
  await page.getByRole("button", { name: "Замени ужин сегодня на что-то с рыбой" }).waitFor();
  assert.equal(await page.locator("article.pcard").count(), 0);
  assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).log.length, THREAD_STORAGE), 0);
  assert.deepEqual(errors, []);
  await context.close();
});
