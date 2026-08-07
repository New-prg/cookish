# Cookish — Product Requirements & UI/UX Behavior Spec

**Product name:** Cookish  
**Platform:** Android (Capacitor WebView + native Google / WorkManager)  
**Primary language:** Russian UI  
**Last audit date:** 2026-08-04  
**Package id (OAuth):** `ru.listok.purchases`

This document is the product requirements source of truth for **what problems the app must solve** and **how UI/UX must behave**. Implementation may lag; when code and this file disagree, treat this file as the intended product unless a deliberate product change is recorded here.

---

## 1. Product summary

### 1.1 Job to be done

Cookish helps a **small household (1–2 people, optionally more later)** plan food, turn plans into shared shopping lists, record purchases and spend, and keep a personal meal ration — **without a custom backend**, using the phone as the system of record and **Google Sheets** as the shared sync fabric.

### 1.2 Core value propositions

| Value | User-facing outcome |
|---|---|
| Shared shopping | Partner sees new/changed requests and can mark bought items |
| Offline-first | App works without network; sync catches up later |
| Keep-like lists | Creating a request feels like a note checklist, not a multi-step form wizard |
| Ration → basket | Meal plan portions convert into purchase quantities |
| Light nutrition | Products carry optional nutrition for ration totals |

### 1.3 Non-goals (for now)

- Public multi-tenant SaaS / accounts other than Google
- Retailer price scraping or live store catalogs
- Full inventory / warehouse stock ledger
- iOS (unless later)
- Social feed, recipes marketplace, calorie dieting coach AI

---

## 2. Current architecture (audit snapshot)

| Layer | Reality |
|---|---|
| UI shell | Single-page vanilla JS `mobile-shell/app.js` (~4k LOC) + `styles.css` |
| Navigation | Bottom tabs: Сводка · Запросы · Рацион · Профиль; stack routes for products / request edit / answer edit |
| Local data | `localStorage` key `cookish.android.data.v1` |
| Shared data | Google Sheets sheets: Продукты, Запросы, Покупки, Рацион |
| Auth | Android Google Identity Authorization + OAuth client in `google_oauth.xml` |
| Background | WorkManager ~15 min; foreground poll ~30 s when app visible |
| Tests | Node tests for merge/sync domain helpers only |

### 2.1 Audit: strengths

- Domain model for multi-response purchases, dedupe, soft-delete, local version history is relatively mature.
- Request UX direction is correct: empty note → checklist lines → checkbox = bought.
- Ration calendar (day/week/month) + selection → request is a strong differentiator.
- Safe-area / flex shell reduces bottom-nav scroll bugs when done correctly.
- Product catalog research consciously avoids illegal retailer scraping.

### 2.2 Audit: open product/UX risks

| Severity | Issue | Why it matters |
|---|---|---|
| High | Dual merge/write paths (JS + Java worker) can drift; wipe-and-rewrite Sheets races under concurrent multi-user edits | Data loss / “ghost” overwrites |
| High | Full `innerHTML` re-renders after many actions (purchase check, ration edit) steal focus and feel janky | Breaks “note” mental model |
| Medium | God-file UI (`app.js`) couples routing, domain, Sheets, ration, OFF | Slow/safe iteration; regressions |
| Medium | Products still secondary (under Profile / summary metric), not first-class tab | Discoverability |
| Medium | Brand split: app **Cookish**, package **listok**, asset **COOK** logo unused in shell | Trust / store listing polish |
| Medium | History/rollback is **local-only** (not on Sheets); multi-device undo is incomplete | Partner confusion |
| Medium | Unicode tab icons, mixed radius/type scales still feel unfinished | Perceived quality |
| Low | No dark mode; limited empty-state illustration; no pull-to-refresh language | Polish |
| Low | Foreground Sheets every 30s still relatively chatty | Battery / quota |

### 2.3 Audit: must-not-regress behaviors (recent fixes)

These are now **requirements**, not nice-to-haves:

1. Request opens as the same Keep-style list as create (not a separate “detail report” as primary view).
2. Product name does **not** persist on every keystroke; only on blur / Enter / leave (Готово).
3. Request line unit is **request-local**, defaulted from product, editable without changing product card.
4. Purchase marking is **checkbox on the request list**, not a separate «Отметить покупки» primary CTA. **One request = one receipt (чек)** — no multi-purchase list UI under the note.
5. Purchase price is saved against the **real product id** (not catalog suggestion ids) and shown on the line / request total.
6. «Готово» on request edit commits pending fields and returns to the list **without** an “unsaved data” confirm.
7. Bottom navigation stays pinned; content scrolls inside `main`.
8. Ration selection toolbar is a stable grid, not overlapping controls.
9. Ration selection «Удалить» deletes selected meals/items/days.

---

## 3. Personas & scenarios

### 3.1 Personas

**A — Planner (often at home)**  
Plans meals for the week, builds shopping lists, cares about calories/portions roughly.

**B — Buyer (often in store)**  
Opens shared request, checks off bought items, sometimes replaces a product via barcode, enters price occasionally.

**C — Shared household**  
Same spreadsheet; both A and B may edit offline; notifications when the other creates a request.

### 3.2 Primary scenarios

1. **First run:** grant notifications/battery (skippable) → Google → create or attach sheet → land on Summary.
2. **Quick list:** Requests → Создать → empty note → type products → leave → partner sees list.
3. **Shop:** open request → check items as bought → optional price via ··· → totals update.
4. **Plan meals:** Ration week view → add meals/products → select → Запросить → request prefilled with package rounding.
5. **Catalog:** scan barcode / search OFF → save nutrition → reuse in ration and lists.

---

## 4. Information architecture

### 4.1 Bottom navigation (required)

| Tab | Purpose | Primary actions |
|---|---|---|
| **Сводка** | Home health: active lists, spend signals, shortcuts | Create request; open products |
| **Запросы** | All shopping notes | Create; open note |
| **Рацион** | Personal meal calendar | Navigate period; select; request; delete selection |
| **Профиль** | Account, sheet, permissions, danger zone | Connect Google/sheet; products entry; clear data |

### 4.2 Stack routes (not tabs)

- Product list / new / edit  
- Request edit (the note)  
- Request answer **only** as advanced editor for an existing purchase transaction (not the main buy flow)  
- Onboarding  

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
| Sync visibility | Non-blocking chip: syncing / ok / error; never full-screen lock for routine sync |
| No forced re-render while typing | Auto-sync or remote merge must not rebuild focused inputs/dialogs |

### 5.2 Persistence & input

| Pattern | Requirement |
|---|---|
| Commit on leave | Text fields save on **blur**, **Enter**, or explicit **Готово** / navigate away |
| No spam create | Typing a product name must not create many product versions mid-keystroke |
| Debounced search only | OFF/name search may debounce; **commit** of domain objects must not use the same timer as search |
| Optimistic local | UI updates immediately; network is background |
| Undo for destructive soft ops | Delete product / template / selection / purchase uncheck → toast with Отменить when feasible |

### 5.3 Lists & notes (Keep-like)

| Pattern | Requirement |
|---|---|
| Empty note first | Create request opens blank checklist immediately |
| Trailing blank line | Always one empty line for “type next item” |
| Enter | Commits current line and focuses/creates next |
| ＋ Позиция | Tappable text aligned with list content, not a misaligned block button |
| One product once | Duplicate product in same request is rejected with clear message |
| Line unit | Editable per request line; default from product; does not rewrite product.unit |
| Remove × | Visible for every non-empty line; hidden (space reserved) for blank trailing line |
| Check = bought | Checkbox on main request list marks remaining quantity purchased |
| Uncheck = undo latest mark | Unchecking removes latest purchase contribution for that product when possible |
| Details ··· | Optional price / qty / barcode without leaving the note |
| Bought styling | Checked/fully bought lines are visually distinct (e.g. strikethrough + muted) |

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
| Errors | Inline near action + toast for transient; Profile shows last background sync error |
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

### 6.1 Onboarding

**Solves:** “App is useless until shared storage + background checks work.”

| ID | Requirement |
|---|---|
| ONB-1 | Three steps: background access → Google → spreadsheet |
| ONB-2 | Background step skippable; Profile can finish later |
| ONB-3 | Explain battery exclusion in plain language |
| ONB-4 | Create new sheet or paste existing link/id |
| ONB-5 | Main app blocked until Google + spreadsheet complete |

### 6.2 Summary (Сводка)

**Solves:** “What needs attention right now?”

| ID | Requirement |
|---|---|
| SUM-1 | Show active request count, spend signals (e.g. 30 days / average), product count |
| SUM-2 | List open requests with one-tap open into note view |
| SUM-3 | Empty state CTA: create request |
| SUM-4 | Product metric/button opens product catalog |

### 6.3 Requests (Запросы)

**Solves:** “Shared shopping notes.”

| ID | Requirement |
|---|---|
| REQ-1 | List all non-deleted requests; status open/done; remote author visible when relevant |
| REQ-2 | Создать creates empty request and opens note |
| REQ-3 | Open always = Keep note editor (same as create) |
| REQ-4 | One product id once per request |
| REQ-5 | Autosave of structure on field commit (see 5.2), not on every key |
| REQ-6 | Checkbox purchase flow on the note (see 5.3) |
| REQ-7 | Optional purchase details dialog (qty, price, scan replacement) |
| REQ-8 | Partial fulfillment keeps request open until all quantities met |
| REQ-9 | Local history + rollback on note (disclose local-only if not synced) |
| REQ-10 | Soft-delete request + responses with confirm |
| REQ-11 | Cannot remove request line that has purchase data (clear message) |
| REQ-12 | Cannot lower quantity below already purchased |

### 6.4 Products

**Solves:** “Reusable catalog with optional nutrition and barcodes.”

| ID | Requirement |
|---|---|
| PRD-1 | List, add, edit, soft-delete |
| PRD-2 | Fields: name, category, unit, barcode, ingredients, nutrition block |
| PRD-3 | Barcode scan + Open Food Facts lookup with user confirmation before save |
| PRD-4 | Name search suggestions: local + catalog + OFF (debounced) |
| PRD-5 | Deleting product blocked if used in requests/purchases |
| PRD-6 | Undo delete via toast when allowed |

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
| RAT-8 | Ration is per-owner on shared sheet; products shared |
| RAT-9 | Toolbar layout stable on all phone widths (no overlapping controls) |
| RAT-10 | Editing meal dialog must not flicker from foreground sync |

### 6.6 Profile & system

**Solves:** “Trust, permissions, recovery.”

| ID | Requirement |
|---|---|
| PRO-1 | Google connect/disconnect |
| PRO-2 | Spreadsheet connect / create / open / share / disconnect |
| PRO-3 | Manual sync |
| PRO-4 | Notification + battery exemption status + re-request |
| PRO-5 | Last sync times and background errors |
| PRO-6 | Clear local data with strong confirm → onboarding |
| PRO-7 | Entry to products |

### 6.7 Sync & multi-device

**Solves:** “Two phones, one household truth.”

| ID | Requirement |
|---|---|
| SYN-1 | Local-first; offline edits queue to next sync |
| SYN-2 | Merge by id + updatedAt; responses merge by response id |
| SYN-3 | Background worker and foreground client must support same sheet set including Рацион |
| SYN-4 | Prefer non-destructive write strategy long-term (avoid clear-all races) |
| SYN-5 | Notify on new remote open requests (Android 13+ permission) |
| SYN-6 | While interactive editing, do not full-refresh UI |
| SYN-7 | Document schema version / migration expectations for household devices |

---

## 7. Screen-level UX contracts

### 7.1 Request note (canonical)

```
[ Status · date · author ]
[ ✓ ] [ product name ........ ] [ qty ] [ unit ] [···] [×]
[ ✓ ] [ ... ]
[ ＋ Позиция ]

[ Purchases list / history optional ]
[ Удалить запрос ]
```

**Interactions**

- Type name → suggestions; unit prefilled from product when appropriate.  
- Blur/Enter → persist lines + create product if new.  
- Check → mark remaining qty bought.  
- Uncheck → undo latest mark for that product if possible.  
- ··· → details dialog.  
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
- Never show raw stack traces; spreadsheet id may appear in Profile only.

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

1. Time from install → first shared request.  
2. % requests closed with ≥1 purchase mark.  
3. Sync error rate / user-reported conflicts.  
4. Use of ration → request path at least weekly.  
5. Drop-off at onboarding battery step (should remain skippable).

---

## 11. Acceptance checklist (release gate)

A build may ship for household use only if:

- [ ] Create request is empty note; multi-line add works after Enter/blur commit  
- [ ] Units are per-line and editable  
- [ ] No product spam while typing names  
- [ ] Checkbox buy/unbuy on request note without separate primary «Отметить покупки»  
- [ ] Bottom nav stable on Profile and long Ration  
- [ ] Ration toolbar + selection actions usable on ≤360 px width  
- [ ] Google login works with configured package + SHA-1  
- [ ] Foreground sync does not dismiss keyboard in meal editor  
- [ ] Tests for merge/sync domain pass  

---

## 12. Roadmap implications (from audit)

**P0 — Correctness**  
Unify sync writers; reduce wipe races; partial UI updates on purchase check.

**P1 — Clarity**  
Products as first-class entry; rename residual “транзакция” → “покупка”; brand/assets consistency.

**P2 — Craft**  
Icon set, empty illustrations, dark mode, pull-to-refresh, typed modules instead of single `app.js`.

**P3 — Scale**  
Server-side catalog index (per `PRODUCT_CATALOG_RESEARCH.md`); optional multi-household.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| Request / Запрос | Shared shopping note with lines |
| Purchase / Покупка | Response that records bought qty/price for request lines |
| Product / Продукт | Catalog entity (unit default, nutrition, barcode) |
| Ration / Рацион | Personal meal plan by day |
| Line unit | Unit stored on the request line, not on the product |
| Keep-like | Immediate note, checklist lines, low ceremony |

---

*End of product requirements. Update this file when intentional product behavior changes; do not silently diverge in code.*
