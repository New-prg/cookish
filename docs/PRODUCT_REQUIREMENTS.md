# Cookish — Product Requirements & UI/UX Behavior Spec

**Product name:** Cookish
**Platform:** Android (Capacitor WebView, native barcode scan, in-app APK update)
**Primary language:** Russian UI
**Updated:** 2026-08-19
**Package id:** `ru.listok.purchases`

This file is the source of truth for **what problems the app must solve** and
**how UI/UX must behave**. Domain terms live in [`CONTEXT.md`](../CONTEXT.md).
How data is stored today is documented in [`README.md`](../README.md).
Implementation may lag; when code and this file disagree, treat this file as
the intended product unless a deliberate product change is recorded here.

---

## 1. Product summary

### 1.1 Job to be done

Cookish helps a small household plan food, turn the plan into a shopping list,
record purchases and spend, and keep a personal meal ration. The phone is the
system of record. There is no custom backend and no account.

### 1.2 Core value propositions

| Value | User-facing outcome |
|---|---|
| Instant start | Open the app, land on Summary. No sign-in, no spreadsheet, no setup wizard |
| Offline | Everything works without network. Open Food Facts search is the only optional online lookup |
| Keep-like lists | Creating a request feels like a note checklist, not a multi-step form |
| Ration → basket | Meal plan portions convert into purchase quantities |
| Light nutrition | Products carry optional nutrition for ration totals |

### 1.3 Non-goals (for now)

- Google sign-in or Google Sheets as storage or sync
- Accounts, multi-device merge, or a custom backend
- Public multi-tenant SaaS
- Retailer price scraping or live store catalogs
- Full inventory / warehouse stock ledger
- iOS
- Social feed, recipes marketplace, calorie dieting coach AI

---

## 2. Current architecture (product snapshot)

| Layer | Reality |
|---|---|
| UI shell | Single-page vanilla JS `mobile-shell/app.js` + `styles.css` |
| Navigation | Bottom tabs: Сводка · Запросы · Рацион · Профиль; stack routes for products / request edit / purchase editor |
| Data | Local data on the device. See README |
| Auth | None. The app opens Summary |
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
8. Ration selection toolbar is a stable grid, not overlapping controls.
9. Ration selection «Удалить» deletes selected meals/items/days.
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
4. **Plan meals:** Ration week view → add meals/products → select → Запросить → request prefilled with package rounding.
5. **Catalog:** scan barcode / search Open Food Facts → save nutrition → reuse in ration and lists.

---

## 4. Information architecture

### 4.1 Bottom navigation (required)

| Tab | Purpose | Primary actions |
|---|---|---|
| **Сводка** | Home health: active lists, spend signals, shortcuts | Create request; open products |
| **Запросы** | All shopping notes | Create; open note |
| **Рацион** | Personal meal calendar | Navigate period; select; request; delete selection |
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
| Undo for destructive soft ops | Delete product / template / selection / purchase uncheck → toast with Отменить when feasible |

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
| Ration | Selection/delete must not reshuffle toolbar layout |
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

**Solves:** “What do we eat when, and what should we buy?”

| ID | Requirement |
|---|---|
| RAT-1 | Views: day / week / month with period navigation and Сегодня |
| RAT-2 | Meals have time, name, products with portion + package size |
| RAT-3 | Nutrition totals from product nutrition when available |
| RAT-4 | Selection mode: days and/or meals/items |
| RAT-5 | Запросить selected → request with package rounding |
| RAT-6 | Удалить selected meals/items/days with confirm + undo |
| RAT-7 | Day templates: create / rename / apply / delete template |
| RAT-8 | Ration belongs to this device |
| RAT-9 | Toolbar layout stable on all phone widths (no overlapping controls) |
| RAT-10 | Editing meal dialog must not flicker from unrelated rerenders |

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

### 7.2 Ration selection sheet

```
[ N дн · M приём · K поз ]
[ Запросить ] [ Удалить ]
[ Отмена ]
[ template controls ]
[ selected items list ]
```

Must not collide with bottom nav; must not scramble date toolbar.

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
- [ ] Ration toolbar + selection actions usable on ≤360 px width
- [ ] App opens Summary without an account
- [ ] Existing local products, requests, purchases, and ration load after update
- [ ] Tests for local domain helpers pass

---

## 12. Glossary

Canonical terms and relationships are in [`CONTEXT.md`](../CONTEXT.md).
Do not reintroduce Google Sheets, OAuth, or a shared spreadsheet as current
product language.

---

*End of product requirements. Update this file when intentional product behavior changes; do not silently diverge in code.*
