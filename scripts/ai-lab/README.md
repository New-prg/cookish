# AI lab

Стенд сравнения моделей для Рациона: GLM 5.3 Flash (агент с tool calls) и Jev 1.13 (decisions).
Работает на настоящем `mobile-shell/ration-domain.js`. Это референс для `ai-tools.js`, не код приложения.

- `fixture.mjs` — тестовый рацион, проекции для модели, конвертер «название + граммы» → domain meals, gate КБЖУ.
- `glm.mjs` — агентный цикл: system prompt, 5 tools, запись через домен с `actor: "ai"`.
- `jev.mjs` — маршрутизация через `/api/v1/decisions`, план строит код.
- `scenarios.mjs` — 8 сценариев с проверками состояния.
- `bench.mjs` — прогон: `node scripts/ai-lab/bench.mjs <glm|jev|both> [повторы] [S1,S2]`.

Ключ routerai.ru читается во время запуска из `~/.local/share/opencode/auth.json`
(`routerai.key`). Ключ не хранится в репозитории. Результаты пишутся в `output/ai-lab/` (gitignored).
Прогон тратит деньги с баланса ключа: GLM 0,02–0,5 ₽ на сценарий.

Результаты 2026-10-01: GLM прошла 7 из 8 сценариев (S8 — 88%), медиана ~24 с, на 503 нужны ретраи.
Jev прошёл 6 из 8 сценариев, ~1 с. На свободных просьбах Jev ошибается.
