# Cookish — Product Requirements & UI/UX Behavior Spec

**Product name:** Cookish
**Platform:** Android (Capacitor WebView, native barcode scan, in-app APK update)
**Primary language:** Russian UI
**Updated:** 2026-08-29
**Package id:** `ru.listok.purchases`

This file is the source of truth for **what problems the app must solve** and
**how UI/UX must behave**. Domain terms live in [`CONTEXT.md`](../CONTEXT.md).
How data is stored today is documented in [`README.md`](../README.md).
Implementation may lag; when code and this file disagree, treat this file as
the intended product unless a deliberate product change is recorded here.
The approved data scheme is offline-first with account sync, see
[ADR-0001](adr/0001-offline-first-with-account-sync.md).

---

## 1. Product summary

### 1.1 Job to be done

Cookish helps a small household plan food, follow the plan day by day, turn the
plan into a shopping list, record purchases and spend, and keep a personal meal
ration. The phone is the system of record. Local features work without an
account; network features (account sync, AI) stay off until an account exists
(ADR-0001).

### 1.2 Core value propositions

| Value | User-facing outcome |
|---|---|
| Instant start | Open the app, land on Summary. No sign-in, no spreadsheet, no setup wizard |
| Offline | Local features work without network. Open Food Facts search is the only optional online lookup |
| Today first | Ration opens on today's date with meal states, not on a calendar editor |
| Keep-like lists | Creating a request feels like a note checklist, not a multi-step form |
| Plan → basket | Planned future days convert into purchase quantities with package rounding |
| Light nutrition | Products carry optional nutrition for ration totals |

### 1.3 Non-goals (for now)

- Google sign-in or Google Sheets as storage or sync
- Public multi-tenant SaaS
- Retailer price scraping or live store catalogs
- Full inventory / warehouse stock ledger
- iOS
- Social feed, recipes marketplace, calorie dieting coach AI
- Full AI access to food history (minimal context only until #14 is decided)
- Notifications and the evening checklist (#15)
- Allergens (#16)
- Sharing, several rations per device, final export (#17)
- Chat and document deletion policy; the prototype stores everything (#18)
- Rework of the connection between ration and Requests (#19); current behavior stays
- Product metrics (#20)

Accounts, backend sync and AI tools are part of the approved scheme
(ADR-0001, epic #21), but they come after the local slice ships and stay
disabled without an account.

---

## 2. Current architecture (product snapshot)

| Layer | Reality |
|---|---|
| UI shell | Single-page vanilla JS `mobile-shell/app.js` + `styles.css` |
| Ration rules | `mobile-shell/ration-domain.js`, a deep in-process module; UI, sync and AI tools call one command/projection interface (#23) |
| Navigation | Bottom tabs: Сводка · Запросы · Рацион · Профиль; stack routes for products / request edit / purchase editor |
| Data | Local data on the device. See README |
| Auth | None yet. Account + backend sync are planned (#29, #30); network features stay off without an account |
| Updates | Profile checks the latest public GitHub Release and can install `Cookish.apk` |
| Tests | Node tests for local domain helpers |

### 2.1 Must-not-regress behaviors

These are **requirements**, not nice-to-haves:

1. Request opens as the same Keep-style list as create (not a separate “detail report” as primary view).
2. Product name does **not** persist on every keystroke; only on blur / Enter / leave (Готово).
3. Request line unit is **request-local**, defaulted from product, editable without changing product card.
4. Purchase marking is **checkbox on the request list**, not a separate «Отметить покупки» primary CTA. **One request = one receipt (чек)**.
5. Purchase price is saved against the **real product id** (not catalog suggestion ids) and shown on the line / request total.
6. «Готово» on request edit commits pending fields and returns to the list **without** an “unsaved data” confirm.
7. Bottom navigation stays pinned; content scrolls inside `main`.
8. Ration main page shows only today; the План and История overlays never move the bottom nav or scramble the date header.
9. A meal starts as `не отмечено`; explicit states come from the human or a permitted actor, and AI can never write past history.
10. Existing local data continues to load after an app update.

---

## 3. Personas & scenarios

### 3.1 Personas

**A — Planner**
Plans meals for the week, builds shopping lists, cares about calories/portions roughly.

**B — Buyer**
Opens a request in the store, checks off bought items, sometimes replaces a product via barcode, enters price occasionally.

On one phone these are the same person at different times.

### 3.2 Primary scenarios

1. **First run:** land on Summary. No account gate.
2. **Quick list:** Requests → Создать → empty note → type products → leave.
3. **Shop:** open request → check items as bought → optional price via swipe / long-press → totals update.
4. **Follow the ration:** Рацион → today screen → mark meals eaten / changed / skipped → fix yesterday in История overlay.
5. **Change the future:** План overlay → pick a future date → edit that Особый день or shift the plan → request the planned days with package rounding.
6. **Catalog:** scan barcode / search Open Food Facts → save nutrition → reuse in ration and lists.

---

## 4. Information architecture

### 4.1 Bottom navigation (required)

| Tab | Purpose | Primary actions |
|---|---|---|
| **Сводка** | Home health: active lists, spend signals, shortcuts | Create request; open products |
| **Запросы** | All shopping notes | Create; open note |
| **Рацион** | Today's ration adherence screen | Mark meal states; open План / История overlays |
| **Профиль** | Products entry, app update, danger zone | Open products; check for update; clear local data |

### 4.2 Stack routes (not tabs)

- Product list / new / edit
- Request edit (the note)
- Request purchase editor only as an advanced editor for the existing receipt (not the main buy flow)

### 4.3 IA rules

- **One primary surface per job.** Buying happens on the request note, not a parallel wizard.
- **Create = open empty artifact**, never a “confirm create” form with Submit at the end for requests.
- **Destructive and system settings live in Profile**, not on home.

---

## 5. Global UX patterns (must implement)

### 5.1 Shell & navigation

| Pattern | Requirement |
|---|---|
| Fixed chrome | Top bar + bottom nav are outside the scrollport; only `main` scrolls |
| Safe areas | Respect notch / gesture inset top and bottom |
| Back | Android back: close dialog → leave stack route with save if needed → else system default |
| Header actions | Contextual: Создать / Добавить / Готово; never ambiguous «Отмена» for primary complete |
| No forced re-render while typing | Background work must not rebuild focused inputs/dialogs |

### 5.2 Persistence & input

| Pattern | Requirement |
|---|---|
| Commit on leave | Text fields save on **blur**, **Enter**, or explicit **Готово** / navigate away |
| No spam create | Typing a product name must not create many product versions mid-keystroke |
| Debounced search only | OFF/name search may debounce; **commit** of domain objects must not use the same timer as search |
| Immediate local | UI updates immediately; the device is the store |
| Undo for destructive soft ops | Delete product / meal / purchase uncheck → toast with Отменить when feasible |

### 5.3 Lists & notes (Keep-like)

| Pattern | Requirement |
|---|---|
| Empty note first | Create request opens blank checklist immediately |
| Trailing blank line | Always one empty line for “type next item” |
| Enter | Commits current line and focuses/creates next |
| ＋ Позиция | Tappable text aligned with list content, not a misaligned block button |
| One product once | Duplicate product in same request is rejected with clear message |
| Name-only text input | Line text is product name only (no qty/unit parsing from free text) |
| Qty control | Compact stepper on the line after the product is present; default `1` |
| Line unit | Taken from product card default; not a separate always-visible input |
| Product chip | Resolved product becomes a tappable chip → product card; long-press/dblclick renames line |
| Remove × | Visible for every non-empty line; hidden (space reserved) for blank trailing line |
| Check = bought | Checkbox on main request list marks remaining quantity purchased |
| Uncheck = undo latest mark | Unchecking removes latest purchase contribution for that product when possible |
| Purchase sheet | Swipe or long-press row opens price / bought qty / barcode sheet (no ··· button) |
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
| Touch targets | ≥ 44×44 px for icons, checks, nav |
| Font floor | Body ≥ 16 px inputs (Android zoom); UI chrome ≥ 12 px |
| Contrast | Text/icons readable on white; status not color-only |
| Screen readers | Meaningful labels on icon-only controls; avoid `aria-live` on entire `main` |

### 5.7 Performance feel

| Pattern | Requirement |
|---|---|
| Partial updates preferred | Prefer updating one row over re-render whole note after check |
| Ration | Opening an overlay or marking a state must not reshuffle the today layout |
| Keyboard | Opening keyboard must not permanently detach bottom nav |

---

## 6. Feature requirements by area

### 6.1 First run

**Solves:** “The app is usable immediately.”

| ID | Requirement |
|---|---|
| ONB-1 | First launch opens Summary. No account or spreadsheet step |
| ONB-2 | Android notification / battery prompts are optional and must not block the main app |

### 6.2 Summary (Сводка)

**Solves:** “What needs attention right now?”

| ID | Requirement |
|---|---|
| SUM-1 | Show active request count, spend signals (e.g. 30 days / average), product count |
| SUM-2 | List open requests with one-tap open into note view |
| SUM-3 | Empty state CTA: create request |
| SUM-4 | Product metric/button opens product catalog |

### 6.3 Requests (Запросы)

**Solves:** “Shopping notes on this phone.”

| ID | Requirement |
|---|---|
| REQ-1 | List all non-deleted requests; status open/done |
| REQ-2 | Создать creates empty request and opens note |
| REQ-3 | Open always = Keep note editor (same as create) |
| REQ-4 | One product id once per request |
| REQ-5 | Autosave of structure on field commit (see 5.2), not on every key |
| REQ-6 | Checkbox purchase flow on the note (see 5.3) |
| REQ-7 | Optional purchase details via swipe/long-press sheet (qty, price, scan); no ··· button |
| REQ-8 | Partial fulfillment keeps request open until all quantities met |
| REQ-9 | Local history + rollback on the note |
| REQ-10 | Soft-delete request and its purchases with confirm |
| REQ-11 | Cannot remove request line that has purchase data (clear message) |
| REQ-12 | Cannot lower quantity below already purchased |

### 6.4 Products

**Solves:** “Reusable catalog with optional nutrition and barcodes.”

| ID | Requirement |
|---|---|
| PRD-1 | List, add, edit, soft-delete |
| PRD-2 | Fields: name, category, unit, barcode, ingredients, nutrition block; plus kind/genericKey/brand/confirmed |
| PRD-3 | Barcode scan + Open Food Facts lookup with user confirmation before save |
| PRD-4 | Name search suggestions: local + catalog + OFF (debounced) |
| PRD-5 | Deleting product blocked if used in requests/purchases |
| PRD-6 | Undo delete via toast when allowed |
| PRD-7 | Free-text create → unconfirmed product; saving product card sets confirmed |
| PRD-8 | Category/generic from OFF when available; SKU purchase must not rewrite a different confirmed product |

### 6.5 Ration (Рацион)

**Solves:** “What do we eat today, did we follow the plan, and what will we eat next?”

The ration opens on a **today screen**. The user never edits a calendar, a
cycle or versions directly. Future dates live in the План overlay, past dates
in the История overlay; both hang on a right-side rail of flags over the today
screen.

#### 6.5.1 Today screen

| ID | Requirement |
|---|---|
| RAT-1 | Main page shows only the current date and today's meals ordered by time |
| RAT-2 | Each meal card shows time, name, composition with portions, КБЖУ and the meal state |
| RAT-3 | Meal state starts as `не отмечено` and never implies the person skipped food |
| RAT-4 | One short action marks `съедено`; `изменено`, `не съедено` and other actions open from the meal card |
| RAT-5 | Discrepancy recording (added / excluded / replaced product, actual amount) opens from the meal card and stores against the version that was in force |
| RAT-6 | One-time transfer shifts the chosen meal and every following unmarked meal of the day by the same amount; midnight crossing needs explicit confirmation |
| RAT-7 | The screen works fully offline and renders only ration module projections |

#### 6.5.2 Overlays (right rail)

| ID | Requirement |
|---|---|
| RAT-8 | A rail of right-side flags opens the План and История overlays without leaving the tab |
| RAT-9 | План overlay shows computed future days with meals and КБЖУ; the terms Цикл рациона and Версия рациона never appear in UI |
| RAT-10 | From the План overlay the user picks a future date and creates or edits its Особый день; this works offline without AI |
| RAT-11 | From the План overlay the user turns a chosen range of future days into a request with package rounding (one product once per request) |
| RAT-12 | История overlay shows past days with states and discrepancies and lets the human correct past entries |
| RAT-13 | Overlays keep their state when closed and never change the plan just by being viewed |

#### 6.5.3 Hidden model

| ID | Requirement |
|---|---|
| RAT-14 | A Цикл рациона (ordered days, anchor date, optional weekday binding) plus the active Версия рациона compute any date's plan; a Особый day overrides the cycle for its date only |
| RAT-15 | Editing the future plan releases a new Версия рациона with an effective date; past history keeps the version that was in force |
| RAT-16 | Changing a shared product card recalculates past and future КБЖУ |
| RAT-17 | A deterministic nutrition profile supplies КБЖУ targets (#26) |

#### 6.5.4 Authority matrix

| Period | Human | AI (after account exists) |
|---|---|---|
| Past (История питания) | Read and correct states / discrepancies | Read only, minimal context; never write |
| Today | Mark states, record discrepancies, transfer meals | Read; may suggest, never writes past or today |
| Future | Create/edit Особый день, shift plan in План overlay | May propose plan edits that land as a new Версия рациона or Особый день, gated by #36 |

#### 6.5.5 Fate of the previous ration editor

The approved scheme (epic #21) retires three features of the old calendar
editor. This is a product decision; implementation removes them in #27/#28.

- **Day / week / month view modes.** Removed. The main page is today only;
  future dates are the План overlay, past dates the История overlay. There is
  no month view.
- **Day templates (создать / переименовать / применить / удалить).** Removed.
  The stored ration days and templates convert during migration (#23) into the
  initial Версия рациона of the cycle. No template UI returns.
- **Selection UI (selection mode, toolbar, checkbox lists).** Removed. Deletion
  happens through meal card actions and the План overlay; Запросить works from
  the План overlay on a chosen range of future days (RAT-11).

#### 6.5.6 Storage ownership

| ID | Requirement |
|---|---|
| RAT-18 | Without an account the whole ration (plan, history, profile) is local to this device; network features stay off |
| RAT-19 | UI never rewrites ration structure directly; all changes go through ration module commands |
| RAT-20 | Deleting a meal / item / day requires confirm and offers undo when feasible |

### 6.6 Profile & system

**Solves:** “Trust, recovery, staying on a current build.”

| ID | Requirement |
|---|---|
| PRO-1 | Entry to products |
| PRO-2 | Check GitHub Release and install `Cookish.apk` when newer |
| PRO-3 | Clear local data with strong confirm → empty local data, Summary |
| PRO-4 | No Google connect, spreadsheet connect, or manual sheet sync |

---

## 7. Screen-level UX contracts

### 7.1 Request note (canonical)

```
[ Status · date ]
[ ✓ ] [ product chip / name text ] [ qty stepper ] [×]
[ ✓ ] [ ... ]
[ ＋ Позиция ]

[ History optional ]
[ Удалить запрос ]
```

**Interactions**

- Type product name only → suggestions; qty defaults to 1; unit from product card.
- Blur/Enter → persist lines + create unconfirmed product if new; show chip.
- Tap chip → product card (return to note).
- Check → mark remaining qty bought (partial row update).
- Uncheck → undo latest mark for that product if possible.
- Swipe / long-press row → purchase sheet (price, bought qty, barcode).
- Готово / back → commit pending field edits, return to list.

### 7.2 Ration today screen and overlays (canonical)

```
[ date: today ]                       ( rail: План · История )
[ ✓ съедено ] Приём пищи 08:00 · КБЖУ   [ card → ]
[ не отмечено ] Приём пищи 13:00 · КБЖУ [ card → ]

План overlay:   future days · Особый день per date · range → Запросить
История overlay: past days · states · расхождения · human corrections
```

Bottom nav stays pinned; overlays never scramble the date header.

### 7.3 Purchase details dialog

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
| Density | Shopping list rows ~48 px tall; ration calendar may be denser but ≥ 12 px type |
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
- [ ] Qty via compact stepper; unit from product (no free-text unit field on line)
- [ ] No product spam while typing names
- [ ] Checkbox buy/unbuy on request note; swipe/long-press for purchase details (no ···)
- [ ] Confirmed product is not rewritten when a different SKU is scanned
- [ ] Bottom nav stable on Profile and long Ration
- [ ] Ration opens on today; meal states and overlays usable on ≤360 px width
- [ ] Terms Цикл рациона and Версия рациона never appear in the UI
- [ ] App opens Summary without an account; network features are off without one
- [ ] Existing local products, requests, purchases, and ration load after update
- [ ] Tests for local domain helpers pass

---

## 12. Glossary

Canonical terms and relationships are in [`CONTEXT.md`](../CONTEXT.md).
Do not reintroduce Google Sheets, OAuth, or a shared spreadsheet as current
product language.

---

*End of product requirements. Update this file when intentional product behavior changes; do not silently diverge in code.*
