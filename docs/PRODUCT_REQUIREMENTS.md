# Cookish — Product Requirements & UI/UX Behavior Spec

**Product name:** Cookish
**Platform:** Android (Capacitor WebView, native barcode scan, in-app APK update)
**Primary language:** Russian UI
**Updated:** 2026-10-02
**Package id:** `ru.listok.purchases`

This file is the source of truth for **what problems the app must solve** and
**how UI/UX must behave**. Domain terms live in [`CONTEXT.md`](../CONTEXT.md).
How data is stored today is documented in [`README.md`](../README.md).
Implementation may lag; when code and this file disagree, treat this file as
the intended product unless a deliberate product change is recorded here.
The approved data scheme is offline-first with account sync, see
[ADR-0001](adr/0001-offline-first-with-account-sync.md). While the assistant is
in test mode (epic #44), the app calls the AI provider directly with a key from
a temporary Profile field; the ADR rule «AI only through the backend and an
account» is suspended until the AI proxy (#31).

---

## 1. Product summary

### 1.1 Job to be done

Cookish helps one person plan food and physical activity, follow both plans
day by day, turn the food plan into a shopping list, and record purchases and
spend. One assistant plans across the pages and proposes changes that the
person confirms. The phone is the system of record. Local features work
without an account; account sync stays off until an account exists
(ADR-0001). The test assistant is the only network feature without an
account, and only with a provider key the person enters (§6.6.6).

### 1.2 Core value propositions

| Value | User-facing outcome |
|---|---|
| Instant start | Open the app, land on Рацион. No sign-in, no spreadsheet, no setup wizard |
| Offline | Local features work without network. Open Food Facts search and the test assistant are the only online features |
| Today first | Рацион and Спорт open in Учёт on the «Сегодня» card, not on a calendar editor |
| Keep-like lists | Creating a request feels like a note checklist, not a multi-step form |
| Plan → basket | Planned future days convert into purchase quantities with package rounding |
| Light nutrition | Products carry optional nutrition for ration totals |
| Nothing in secret | The assistant proposes changes in a feed; goals and plans never change without confirmation, and every change can be undone from the journal |

### 1.3 Non-goals (for now)

- Google sign-in or Google Sheets as storage or sync
- Public multi-tenant SaaS
- Retailer price scraping or live store catalogs
- Full inventory / warehouse stock ledger
- iOS
- Social feed, recipes marketplace
- Medical advice: the assistant is a planner for food and activity; it never treats, diagnoses or prescribes, and on risky requests it refuses and suggests a doctor
- A product catalog screen; the assistant manages the catalog (§6.3)
- Fitness tracker integration (Health Connect, Huawei Health via Health Sync)
- Rework of Покупки and the budget
- Notifications and the evening checklist (#15); the assistant reacts only inside the app
- Allergens (#16)
- Sharing, several rations per device, final export (#17)
- Chat and document deletion policy; the prototype stores everything (#18)
- Rework of the connection between ration and Requests (#19); current behavior stays
- Product metrics (#20); Summary and spend metrics return after the page shell settles

Accounts, backend sync, the AI proxy and billing (#29–#32) are part of the
approved scheme (ADR-0001, epic #21) and come after epic #44.

---

## 2. Current architecture (product snapshot)

| Layer | Reality |
|---|---|
| UI shell | Single-page vanilla JS `mobile-shell/app.js` + `styles.css` |
| Ration rules | `mobile-shell/ration-domain.js`, a deep in-process module; UI, sync and AI tools call one command/projection interface (#23) |
| Sport rules | Planned module mirroring the ration domain (#53) |
| Assistant | Planned `ai-tools.js` (#50) over a provider port: routerai.ru adapter and a mock for tests (#49) |
| Navigation | Three root pages Рацион → Спорт → Покупки switched by a horizontal swipe; a slider shows the page and the mode; Profile from a header button; stack routes for request note, purchase editor, product card and forms |
| Data | Local data on the device. See README |
| Auth | None yet. Account + backend sync are planned (#29, #30); sync stays off without an account |
| Updates | Profile checks the latest public GitHub Release and can install `Cookish.apk` |
| Tests | Node tests for local domain helpers; Playwright UI smoke tests |

### 2.1 Must-not-regress behaviors

These are **requirements**, not nice-to-haves:

1. Request opens as the same Keep-style list as create (not a separate “detail report” as primary view).
2. Product name does **not** persist on every keystroke; only on blur / Enter / leave (Готово).
3. Request line unit is **request-local**, defaulted from product, editable without changing product card.
4. Purchase marking is **checkbox on the request list**, not a separate «Отметить покупки» primary CTA. **One request = one receipt (чек)**.
5. Purchase price is saved against the **real product id** (not catalog suggestion ids) and shown on the line / request total.
6. «Готово» on request edit commits pending fields and returns to the list **without** an “unsaved data” confirm.
7. The header and the page slider stay pinned; content scrolls inside `main`.
8. Рацион opens in Учёт on the «Сегодня» card; switching modes never moves the slider or scrambles the date header.
9. A meal starts as `не отмечено`; explicit states come from the human or a permitted actor, and AI can never write past history.
10. Existing local data continues to load after an app update.
11. Goals and plans never change without confirmation: every assistant change goes through the feed and lands in the change journal.

---

## 3. Personas & scenarios

### 3.1 Personas

**A — Planner**
Plans meals and workouts for the week, builds shopping lists, cares about calories/portions roughly.

**B — Buyer**
Opens a request in the store, checks off bought items, sometimes replaces a product via barcode, enters price occasionally.

On one phone these are the same person at different times.

### 3.2 Primary scenarios

1. **First run:** land on Рацион in Учёт. No account gate.
2. **Quick list:** swipe to Покупки → Создать → empty note → type products → leave.
3. **Shop:** open request → check items as bought → optional price via swipe / long-press → totals update.
4. **Follow the ration:** Рацион, Учёт → «Сегодня» card → mark meals eaten / changed / skipped → scroll down to fix yesterday.
5. **Change the future:** tap the slider → План → pick a future day → edit its Особый день, repeat the day or week, or request a range of days with package rounding.
6. **Follow the training plan:** swipe to Спорт → mark today's workout done / changed / skipped or add an unplanned activity; in План edit the week schedule or one date.
7. **Ask the assistant:** pull the handle → ask → review Предложения in the feed → apply all or one by one → undo from a card if needed.
8. **Product card:** tap a chip in a request → scan a barcode / search Open Food Facts → save nutrition → reuse in ration and lists.

---

## 4. Information architecture

### 4.1 Root pages (required)

| Page | Purpose | Modes |
|---|---|---|
| **Рацион** | Food plan and adherence | Учёт: «Сегодня» and past days. План: tomorrow and future days |
| **Спорт** | Training plan and its log | Учёт and План, as on Рацион |
| **Покупки** | All shopping notes (Запросы) | None |

- Root pages go in the order Рацион → Спорт → Покупки. The app always opens on Рацион in Учёт.
- There is no bottom tab bar. A horizontal swipe over the content switches root pages; it works only on root pages (§5.1).
- A slider at the bottom right shows the page and its mode; a tap switches the mode, never the page (§5.1).
- Profile opens from a small button in the header corner. It holds settings and, later, the account; it is not part of the main UI.
- There is no Summary screen.
- Покупки is the former Запросы list as is; the domain term stays Запрос.

### 4.2 Stack routes and overlays (not root pages)

- Request edit (the note)
- Request purchase editor only as an advanced editor for the existing receipt (not the main buy flow)
- Product card: opens from a chip and returns there; there is no product list screen
- Profile and the ration profile form
- Assistant chat: an overlay from the right edge of any root page (§6.6)

### 4.3 IA rules

- **One primary surface per job.** Buying happens on the request note, not a parallel wizard.
- **Create = open empty artifact**, never a “confirm create” form with Submit at the end for requests.
- **Destructive and system settings live in Profile**, not on root pages.
- **Products have no list screen.** The assistant manages the catalog; the human edits a card from a chip.

---

## 5. Global UX patterns (must implement)

### 5.1 Shell & navigation

| Pattern | Requirement |
|---|---|
| Fixed chrome | Top bar and the page slider are outside the scrollport; only `main` scrolls |
| Safe areas | Respect notch / gesture inset top and bottom |
| Page swipe | A horizontal swipe over the content switches root pages in the order Рацион → Спорт → Покупки. It works only on root pages; screens over a page (request note, product card, Profile, forms), dialogs and the assistant chat keep horizontal gestures for themselves. Swipes that start at the screen edges belong to the system back gesture |
| Page slider | Bottom right, about a third of the screen wide (a guide, not a fixed value). The current page name is in the centre with its neighbours small and translucent on the sides; under it the line «учёт · план» highlights the active mode. A tap switches Учёт ⇄ План; the slider never switches pages. On Покупки there is no mode line and a tap does nothing |
| Mode memory | Each page keeps its mode for the session; a new launch opens Рацион in Учёт |
| Profile button | A small button in the header corner of root pages; Profile returns to the page it was opened from |
| Assistant handle | At the right edge, at the same height on every root page, at most 200 dp tall and excluded from system gestures. Pulling it left (or a tap) opens the chat (§6.6.1) |
| Back | Android back: close dialog → close the assistant chat → leave stack route with save if needed → on Спорт or Покупки return to Рацион → on Рацион system default |
| Header actions | Contextual: Создать / Добавить / Готово / Сохранить; never ambiguous «Отмена» for primary complete. Forms (product, ration profile) save from the header; a back arrow on the left leaves, asking with an in-app dialog when there are unsaved changes |
| No forced re-render while typing | Background work must not rebuild focused inputs/dialogs |

### 5.2 Persistence & input

| Pattern | Requirement |
|---|---|
| Commit on leave | Text fields save on **blur**, **Enter**, or explicit **Готово** / navigate away |
| No spam create | Typing a product name must not create many product versions mid-keystroke |
| Debounced search only | OFF/name search may debounce; **commit** of domain objects must not use the same timer as search |
| Immediate local | UI updates immediately; the device is the store |
| Undo for destructive soft ops | Delete meal / purchase uncheck → toast with Отменить when feasible |

### 5.3 Lists & notes (Keep-like)

| Pattern | Requirement |
|---|---|
| Empty note first | Create request opens blank checklist immediately |
| Trailing blank line | Always one empty line for “type next item” |
| Enter | Commits current line and focuses/creates next |
| ＋ Позиция | Tappable text aligned with list content, not a misaligned block button |
| One product once | Duplicate product in same request is rejected with clear message |
| Name-only text input | Line text is product name only (no qty/unit parsing from free text) |
| No qty on the line | The note line shows no quantity control; quantity is a legacy field, defaults to `1` and is only edited in the purchase sheet |
| Line unit | Taken from product card default; not a separate always-visible input |
| Product chip | Resolved product becomes a tappable chip → product card; long-press/dblclick renames line |
| Remove × | Visible for every non-empty line; hidden (space reserved) for blank trailing line |
| Check = bought | Tap on the check at the end of the row marks the line bought with a short confirmation animation; the check is a real `role=checkbox` control |
| Uncheck = undo latest mark | Unchecking removes latest purchase contribution for that product when possible; a toast offers Отменить |
| Purchase sheet | Swipe left opens price / bought qty / barcode sheet (no ··· button); on a bought row the same swipe unmarks it |
| Unconfirmed update | Barcode/OFF may rewrite only **unconfirmed** products; confirmed products get a separate purchased SKU |
| Bought styling | Minimal check vs filled details (price / other SKU) are visually distinct |

### 5.4 Dialogs & confirms

| Pattern | Requirement |
|---|---|
| In-app confirms | Destructive confirms use app dialog (not browser `confirm` when avoidable) |
| Dialogs | Focus trap, backdrop dismiss = safe cancel or soft-save as defined per dialog |
| Purchase details | Closing details should not discard a simple mark without reason; soft-save defaults OK |

### 5.5 Empty, error, loading

| Pattern | Requirement |
|---|---|
| Empty states | Title + one-line help + primary CTA |
| Errors | Inline near action + toast for transient |
| Loading | Disable double-submit; prefer button label change over full-page spinner |

### 5.6 Accessibility & touch

| Pattern | Requirement |
|---|---|
| Touch targets | ≥ 44×44 px for icons, checks, the slider and the handle |
| Font floor | Body ≥ 16 px inputs (Android zoom); UI chrome ≥ 12 px |
| Contrast | Text/icons readable on white; status not color-only |
| Screen readers | Meaningful labels on icon-only controls; avoid `aria-live` on entire `main` |

### 5.7 Performance feel

| Pattern | Requirement |
|---|---|
| Partial updates preferred | Prefer updating one row over re-render whole note after check |
| Ration | Switching modes or marking a state must not reshuffle the «Сегодня» card |
| Keyboard | Opening keyboard must not permanently detach the header or the slider |

---

## 6. Feature requirements by area

### 6.1 First run

**Solves:** “The app is usable immediately.”

| ID | Requirement |
|---|---|
| ONB-1 | First launch opens Рацион in Учёт. No account or spreadsheet step |
| ONB-2 | Android notification / battery prompts are optional and must not block the main app |

### 6.2 Покупки (Запросы)

**Solves:** “Shopping notes on this phone.”

| ID | Requirement |
|---|---|
| REQ-1 | List all non-deleted requests; status open/done |
| REQ-2 | Создать creates empty request and opens note |
| REQ-3 | Open always = Keep note editor (same as create) |
| REQ-4 | One product id once per request |
| REQ-5 | Autosave of structure on field commit (see 5.2), not on every key |
| REQ-6 | Check purchase flow on the note: tap or swipe (see 5.3) |
| REQ-7 | Optional purchase details via swipe/long-press sheet (qty, price, scan); no ··· button |
| REQ-8 | Partial fulfillment keeps request open until all quantities met |
| REQ-9 | Local history + rollback on the note |
| REQ-10 | Soft-delete request and its purchases with confirm |
| REQ-11 | Cannot remove request line that has purchase data (clear message) |
| REQ-12 | Cannot lower quantity below already purchased |

### 6.3 Products

**Solves:** “Reusable catalog with optional nutrition and barcodes.”

| ID | Requirement |
|---|---|
| PRD-1 | There is no product list screen. The assistant manages the catalog: it creates products and fixes КБЖУ through confirmed Предложения (#50). The human opens a card from a request chip, edits it there and returns to the note |
| PRD-2 | Fields: name, category, unit, barcode, ingredients, nutrition block; plus kind/genericKey/brand/confirmed |
| PRD-3 | Barcode scan + Open Food Facts lookup with user confirmation before save |
| PRD-4 | Name search suggestions: local + catalog + OFF (debounced) |
| PRD-5 | Deletion is a data command, blocked while the product is used in requests or purchases. The card has no delete button: a card opened from a chip always belongs to a request |
| PRD-7 | Free-text create → unconfirmed product; saving product card sets confirmed |
| PRD-8 | Category/generic from OFF when available; SKU purchase must not rewrite a different confirmed product |

### 6.4 Рацион

**Solves:** “What do we eat today, did we follow the plan, and what will we eat next?”

Рацион has two modes, two feeds that start at «Сегодня»: Учёт scrolls into the
past, План into the future. The user never edits a calendar, a cycle or
versions directly.

#### 6.4.1 Учёт: today and the past

| ID | Requirement |
|---|---|
| RAT-1 | Учёт opens on the «Сегодня» card: the current date and today's meals ordered by time. Past days follow below in reverse order |
| RAT-2 | Each meal card shows time, name, composition with portions, КБЖУ and the meal state |
| RAT-3 | Meal state starts as `не отмечено` and never implies the person skipped food |
| RAT-4 | One short action marks `съедено`; `изменено`, `не съедено` and other actions open from the meal card |
| RAT-5 | Discrepancy recording (added / excluded / replaced product, actual amount) opens from the meal card and stores against the version that was in force |
| RAT-6 | One-time transfer shifts the chosen meal and every following unmarked meal of the day by the same amount; midnight crossing needs explicit confirmation |
| RAT-7 | The page works fully offline and renders only ration module projections |
| RAT-12 | Past days show states and discrepancies and let the human correct past entries |

#### 6.4.2 План: tomorrow and the future

| ID | Requirement |
|---|---|
| RAT-8 | A tap on the slider switches Учёт ⇄ План. Each mode keeps its feed and scroll position until the end of the session (#47) |
| RAT-9 | План starts with tomorrow, then future days with meals and КБЖУ; the terms Цикл рациона and Версия рациона never appear in UI |
| RAT-10 | In План the user picks a future date and creates or edits its Особый день, or makes the day or the week repeat from that date; this works offline without AI |
| RAT-11 | In План the user turns a chosen range of future days into a request with package rounding (one product once per request) |
| RAT-13 | Viewing a mode never changes the plan |

#### 6.4.3 Hidden model

| ID | Requirement |
|---|---|
| RAT-14 | A Цикл рациона (ordered days, anchor date, optional weekday binding) plus the active Версия рациона compute any date's plan; a Особый day overrides the cycle for its date only |
| RAT-15 | Editing the future plan releases a new Версия рациона with an effective date; past history keeps the version that was in force |
| RAT-16 | Changing a shared product card recalculates past and future КБЖУ |
| RAT-17 | A deterministic nutrition profile supplies КБЖУ targets (#26) |

#### 6.4.4 Authority matrix

| Period | Human | Assistant |
|---|---|---|
| Past (История питания) | Read and correct states / discrepancies | Reads aggregates always and details on request (§6.6.1); never writes |
| Today | Mark states, record discrepancies, transfer meals | May propose changes to today's plan through the confirmed feed (по умолчанию); never marks states or records discrepancies |
| Future | Create/edit Особый день, repeat a day or week, request a range in План | Proposes a Особый день or a new Версия рациона through the confirmed feed, gated by the КБЖУ checks (§6.6.2, #36) |

#### 6.4.5 Fate of earlier ration UI

The approved scheme (epic #21) retired three features of the old calendar
editor (#27/#28), and epic #44 retires the overlays (#47).

- **Day / week / month view modes.** Removed. Past dates are Учёт, future
  dates are План. There is no month view.
- **Day templates (создать / переименовать / применить / удалить).** Removed.
  The stored ration days and templates convert during migration (#23) into the
  initial Версия рациона of the cycle. No template UI returns.
- **Selection UI (selection mode, toolbar, checkbox lists).** Removed. Deletion
  happens through meal card actions and План; Запросить works from План on a
  chosen range of future days (RAT-11).
- **The right rail of План / История flags and both overlays.** Replaced by the
  Учёт and План modes.

#### 6.4.6 Storage ownership

| ID | Requirement |
|---|---|
| RAT-18 | Without an account the whole ration (plan, history, profile) is local to this device; sync stays off |
| RAT-19 | UI never rewrites ration structure directly; all changes go through ration module commands |
| RAT-20 | Deleting a meal / item / day requires confirm and offers undo when feasible |

### 6.5 Спорт

**Solves:** “What training is planned, did I do it, and how much energy did it take?”

Спорт mirrors Рацион: a План тренировок and an Учёт тренировок, shown in the
same two modes. Until #54 the page shows a «Скоро» stub.

#### 6.5.1 Modes

| ID | Requirement |
|---|---|
| SPT-1 | Учёт opens on the «Сегодня» card: planned Тренировки with the marks «выполнено», «изменено», «пропущено» and «Добавить активность» for an unplanned one. Past days follow below |
| SPT-2 | План starts with tomorrow, then future days. Editing one date creates a Особый день; editing the week schedule releases a version from the chosen date |
| SPT-3 | Cards show planned and actual energy in ккал. The estimate needs the weight from the profile; without it the card shows a hint |
| SPT-4 | The page works fully offline; Учёт opens by default |

#### 6.5.2 Model

| ID | Requirement |
|---|---|
| SPT-5 | The План тренировок uses the ration scheme: a weekly cycle with an anchor date, versions from a date and Особые дни. The shared cycle and version logic lives in one module, not a copy |
| SPT-6 | A Тренировка has a type (силовая, бег, плавание, велосипед, ходьба, йога, другое), time, duration in minutes, intensity (низкая, средняя, высокая) and a note; sets and repetitions are reserved for later |
| SPT-7 | Energy estimate: MET by type and intensity × weight from the profile × hours, with a projection of the planned energy per day |
| SPT-8 | Учёт тренировок stores, per date and session, the state «не отмечено», «выполнено», «изменено» or «пропущено» with the actual duration and intensity, plus unplanned sessions |
| SPT-9 | План тренировок commands write change sets (§6.6.3); Учёт тренировок is a fact and is not journaled |

#### 6.5.3 Authority and the link to food

| ID | Requirement |
|---|---|
| SPT-10 | The human edits the plan and the log. The assistant never writes Учёт тренировок; it proposes plan changes through the confirmed feed |
| SPT-11 | The КБЖУ goal never changes automatically. The assistant may propose ration changes for training days as ordinary Предложения; one batch may touch both pages |

### 6.6 Ассистент

**Solves:** “Plan and adjust food and training by talking, without losing control.”

One Ассистент serves the whole app. It runs in test mode (§6.6.6) until the
backend AI proxy (#31).

#### 6.6.1 Entry and context

| ID | Requirement |
|---|---|
| AST-1 | One assistant for the whole app; it can act across pages |
| AST-2 | It opens with the handle at the right edge of any root page (§5.1): pulling it left opens a chat overlay from the right; a tap also opens it |
| AST-3 | The chat header shows where it was called from, e.g. «Рацион · План»; the assistant knows that page and mode |
| AST-4 | On open the chat shows an empty input and 2–3 suggestions for the page and mode (по умолчанию). No LLM call happens until the user sends a message |
| AST-5 | The assistant always receives the page and mode, the profile and 28-day aggregates: ration adherence, average КБЖУ against the goal, frequent Расхождения, spend from receipts and, with Спорт, workouts planned/done and energy. Details (plan, История питания, catalog, journal) are read only on request, and every such read shows a visible progress line in the chat |
| AST-6 | Without a key the handle says «ИИ недоступен: добавьте ключ в Профиле» |

#### 6.6.2 Feed and confirmation

| ID | Requirement |
|---|---|
| AST-7 | Changes come as Предложения in a feed: affected days, было/стало and the КБЖУ delta |
| AST-8 | «Применить все» applies the batch as one Набор изменений; each card also has «Применить» and «Убрать», and applying one by one writes one set per Предложение. An applied card offers «Отменить» |
| AST-9 | Applying re-checks every Предложение against the current plan; a stale one gets a conflict instead of applying |
| AST-10 | A Предложение writes nothing by itself. The assistant never writes История питания or Учёт тренировок; past dates are forbidden; today and the future change only through confirmed Предложения (по умолчанию). Gesture direction never grants permissions |
| AST-11 | КБЖУ gate in code: not below 1200 ккал, within ±15% of the target, protein at least 75% of the target, no excluded products. A failed check goes back to the model to fix the plan |
| AST-12 | Safety: no treatment or diagnoses; on risky requests the assistant refuses and suggests a doctor. Eval fixtures live in #36 |

#### 6.6.3 Change journal and undo

| ID | Requirement |
|---|---|
| AST-13 | Every plan change, by the human or the assistant, is a Набор изменений: id, time, actor, page, short description and a snapshot of the affected plan parts before and after (Особые дни by date, released versions, the profile, later the План тренировок) |
| AST-14 | Undo restores the «before» snapshot when the affected parts still match «after», and writes itself as a new set. If other changes landed on top, undo refuses with a conflict and the affected dates |
| AST-15 | The assistant may propose undoing any set, its own or manual. A manual undo UI comes later |
| AST-16 | История питания and Учёт тренировок are facts and never enter the journal. The journal is bounded (for example the last 200 sets) |

#### 6.6.4 Nudges and strictness

| ID | Requirement |
|---|---|
| AST-17 | Every deviation from the plan becomes a Тычок: a meal marked «изменено» or «не съедено», a recorded Расхождение, a transferred meal; with Спорт, a Тренировка «пропущено» or «изменено» and unplanned activity. `не отмечено` is never a deviation |
| AST-18 | Detection is code, without an LLM. Тычки queue in local data, survive a restart and wait for the network |
| AST-19 | The assistant decides whether to tell the person. Bursts merge into one call (for example several marks within 30 s). If it decides to notify, the handle shows a badge and a teaser line, and the text becomes the first message when the chat opens; Предложения are built only after the person acts in the chat |
| AST-20 | Жёсткость in Profile: «Любое отклонение» (по умолчанию), «Заметные» or «Только серьёзные», plus an optional free text «Как реагировать». There are no system notifications (#15) |

#### 6.6.5 Threads and bookmarks

| ID | Requirement |
|---|---|
| AST-21 | Every chat is a separate thread held only in memory; after closing nothing remains except threads saved as Закладки |
| AST-22 | Closing with unapplied Предложения asks «Применить N / Отбросить / В закладки» |
| AST-23 | A Закладка keeps the messages and unapplied Предложения locally and survives a restart. Opening it re-checks the Предложения against the current plan and marks stale ones as conflicts. A Закладка can be deleted |

#### 6.6.6 Test access

| ID | Requirement |
|---|---|
| AST-24 | Profile has a temporary field «Ключ ИИ (тест)»: hidden input, «Проверить» shows whether the key works, «Удалить» removes it |
| AST-25 | The key stays only on the device, apart from local data. It never enters export, sync, logs or error texts, and it is never in the repository or the APK |
| AST-26 | Provider: routerai.ru, OpenAI-compatible chat completions; model `z-ai/glm-5.3-flash` by default, set in module config, not in UI; timeout 120 s; up to 2 retries on 5xx and network errors |
| AST-27 | Before the first use a one-time warning says that plan and statistics data are sent to the external provider routerai.ru |

### 6.7 Profile & system

**Solves:** “Trust, recovery, staying on a current build.”

| ID | Requirement |
|---|---|
| PRO-1 | Profile opens from a small header button on root pages and returns to that page. It holds settings: the ration profile, the temporary AI key and Жёсткость (§6.6), app update and the danger zone. No product list entry, no spend metrics |
| PRO-2 | Check GitHub Release and install `Cookish.apk` when newer |
| PRO-3 | Clear local data with strong confirm → empty local data, Рацион |
| PRO-4 | No Google connect, spreadsheet connect, or manual sheet sync |

---

## 7. Screen-level UX contracts

### 7.1 Request note (canonical)

```
[ Status · date ]
[×] [ product chip / name text ]                  [ ✓ ]
[×] [ ... ]                                       [ ✓ ]
[ ＋ Позиция ]

[ History optional ]
[ Удалить запрос ]
```

**Interactions**

- Type product name only → suggestions; no quantity on the line; unit from product card.
- Blur/Enter → persist lines + create unconfirmed product if new; show chip.
- Tap chip → product card (return to note).
- Tap ✓ → mark the line bought (partial row update, short animation).
- Uncheck → undo latest mark for that product if possible.
- Swipe left → purchase sheet (price, bought qty, barcode).
- Готово / back → commit pending field edits, return to list.

### 7.2 Root page with slider and handle (canonical)

```
[ Рацион                                  (профиль) ]
[ Сегодня · date · КБЖУ / цель ]                   ▐
[ ✓ съедено ] Приём пищи 08:00 · КБЖУ   [ card → ] ▐  ← handle: assistant
[ не отмечено ] Приём пищи 13:00 · КБЖУ [ card → ] ▐
[ вчера … ]
                              ╭───────────────────╮
                              │   Рацион  Спорт   │
                              │   учёт · план     │  ← tap: mode
                              ╰───────────────────╯
  ← swipe over the content: Рацион → Спорт → Покупки →

Учёт: Сегодня → вчера → …   states · расхождения · human corrections
План: завтра → …            Особый день · repeat · range → Запросить · КБЖУ
```

The header and the slider stay pinned; switching modes never scrambles the
date header. On Покупки the slider has no mode line.

### 7.3 Assistant chat (canonical)

```
[ Рацион · План                                  × ]
[ suggestions for the page and mode ]
[ you: … ]
[ · читаю план… ]                    ← progress line per read
[ assistant: … ]
[ Предложение · 5–7 окт · было → стало · Δ КБЖУ ]
[                         [ Убрать ] [ Применить ] ]
[ Применить все ]
[ message …                                      ➤ ]
```

- Applied card → «Отменить» (undo through the journal).
- Close with unapplied Предложения → «Применить N / Отбросить / В закладки».

### 7.4 Purchase details dialog

- Qty (capped by remaining when adding), price optional, scan optional.
- Готово applies; back/dismiss soft-saves defaults when marking.

---

## 8. Content & tone

- Russian UI; short imperative labels (Создать, Готово, Удалить).
- Prefer household language over developer jargon (“Покупка” over “Транзакция” in primary UI).
- Errors: what failed + what to do next.
- Never show raw stack traces.

---

## 9. Visual design principles

| Principle | Spec |
|---|---|
| Calm utility | White surfaces, green accent `#1f5d3b`, muted text |
| One radius system | Prefer 8–12 px interactive; avoid 2 px forms vs 20 px sheets without reason |
| Density | Shopping list rows ~48 px tall; ration and training feeds may be denser but ≥ 12 px type |
| Motion | Short, optional; respect `prefers-reduced-motion` |
| Brand | Display name **Cookish** everywhere user-visible; align iconography over time |

---

## 10. Metrics (product success)

Track qualitatively in early household use; instrument later if needed:

1. Time from install → first request.
2. % requests closed with ≥1 purchase mark.
3. Use of ration → request path at least weekly.

---

## 11. Acceptance checklist (release gate)

A build may ship for household use only if:

- [ ] Create request is empty note; multi-line add works after Enter/blur commit
- [ ] No quantity control on the note line; unit from product (no free-text unit field on line)
- [ ] No product spam while typing names
- [ ] Tap-or-swipe buy/unbuy on request note; swipe for purchase details (no ···)
- [ ] Confirmed product is not rewritten when a different SKU is scanned
- [ ] Header and slider stay pinned on Profile and long pages
- [ ] App opens on Рацион in Учёт; a swipe moves Рацион → Спорт → Покупки; meal states and modes are usable on ≤360 px width
- [ ] Terms Цикл рациона and Версия рациона never appear in the UI
- [ ] App opens without an account; sync is off without one; the assistant works only with a test key entered in Profile
- [ ] No assistant change applies without confirmation; every applied batch lands in the change journal
- [ ] Existing local products, requests, purchases, and ration load after update
- [ ] Unit and UI smoke tests pass

---

## 12. Glossary

Canonical terms and relationships are in [`CONTEXT.md`](../CONTEXT.md).
Do not reintroduce Google Sheets, OAuth, or a shared spreadsheet as current
product language.

---

*End of product requirements. Update this file when intentional product behavior changes; do not silently diverge in code.*
