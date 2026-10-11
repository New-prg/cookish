# AI lab

Стенд сравнения моделей для Рациона: GLM 5.3 Flash (агент с tool calls) и Jev 1.13 (decisions).
Работает на настоящем `mobile-shell/core/ration-domain.js`. Логика перенесена в `mobile-shell/services/assistant/ai-tools.js`; стенд остаётся для сравнения моделей.

- `fixture.mjs` — тестовый рацион, проекции для модели, конвертер «название + граммы» → domain meals, gate КБЖУ.
- `glm.mjs` — агентный цикл: system prompt, 5 tools, запись через домен с `actor: "ai"`.
- `jev.mjs` — маршрутизация через `/api/v1/decisions`, план строит код.
- `scenarios.mjs` — 8 сценариев с проверками состояния.
- `bench.mjs` — прогон: `node scripts/ai-lab/bench.mjs <glm|jev|both> [повторы] [S1,S2]`.
- `app-bench.mjs` — те же сценарии через Сервис ассистента приложения
  (агентный цикл, gate, Предложения и их применение), с ценой и долей кэша:
  `[AI_MODEL=glm] [AI_EFFORT=medium] node scripts/ai-lab/app-bench.mjs [S1,S2]`. По умолчанию — Haiku.
- `food-bench.mjs` — сценарии КБЖУ (#64) на настоящих модели и Open Food Facts: «гречка» → справочник,
  «Простоквашино молоко 2,5%» → OFF, «творог» без жирности → вопрос, несуществующий продукт → оценка:
  `[AI_MODEL=glm] node scripts/ai-lab/food-bench.mjs [F1,F2]`.
- `filler-bench.mjs` — Заполнитель (#65) на настоящих модели и Open Food Facts: пачка продуктов без КБЖУ
  через Сервис, ответ принимает Ядро: `node scripts/ai-lab/filler-bench.mjs ["Гречка" "Творог" …]`.
- `safety-bench.mjs` — сценарии безопасности (#36), каждый по 3 прогона (pass^3): обычное планирование,
  900 ккал, опасная неделя из безопасных дней, лечение болезни, признаки РПП, прошлое, спорт без еды:
  `[RUNS=3] node scripts/ai-lab/safety-bench.mjs [X1,X2]`.
- `cache-probe.mjs` — что routerai.ru пропускает к модели: `cache_control` и `cached_tokens`,
  `temperature`, `reasoning.effort`: `node scripts/ai-lab/cache-probe.mjs [модель]`.

Ключ routerai.ru читается во время запуска из `~/.local/share/opencode/auth.json`
(`routerai.key`). Ключ не хранится в репозитории. Результаты пишутся в `output/ai-lab/` (gitignored).
Прогон тратит деньги с баланса ключа: GLM 0,02–0,5 ₽ на сценарий.

Результаты 2026-10-01: GLM прошла 7 из 8 сценариев (S8 — 88%), медиана ~24 с, на 503 нужны ретраи.
Jev прошёл 6 из 8 сценариев, ~1 с. На свободных просьбах Jev ошибается.

Результаты 2026-10-11, `app-bench` (#60): Haiku 5.5 (low) — 8 из 8, медиана 13,1 с, 2,19 ₽ за прогон;
Haiku 5.5 (medium) — 8 из 8, 17,1 с, 2,15 ₽; GLM 5.3 Flash — 7 из 8, 29,4 с, 1,38 ₽.
