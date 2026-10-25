// The rows of the manual's «от просьбы к деталям» table: what a person says, what
// to build, and a piece of a checked answer that shows it. A piece is cut out of
// an example bundle by key, so the manual cannot show a form the validator
// refuses; a piece with `node` is a literal element over the classic sources,
// which need no track and are checked on the demo space.
//
// show[]: { base, card, at }            element number `at` of the card `card` of example `base`
//         { base, track, attrs }        the listed attributes of a track
//         { base, track, item, attrs }  the listed attributes of item number `item`
//         { node }                      a literal element
//
// Wording is neutral on purpose: no subject of scripts/primitives-lab/corpus.json
// or holdout.json may appear in a row (tests/kit-manual.test.mjs checks it).

export const DECISIONS = Object.freeze([
  {
    id: "week-count", wish: "сколько раз за неделю, сколько сделал",
    say: "stat, value done (сколько отмечено), range @thisWeek; у habit и list.",
    show: [{ base: "plants", card: "plants_week", at: 0 }],
  },
  {
    id: "missed", wish: "сколько пропустил, что не сделано",
    say: "у трека unmarked missed (день без отметки считается пропуском), потом stat, value skipped.",
    show: [{ base: "plants", track: "plants", attrs: ["unmarked"] }, { base: "plants", card: "plants_week", at: 1 }],
  },
  {
    id: "weekdays", wish: "по вторникам и пятницам, по будням, раз в три дня",
    say: "every у пункта: tue,fri, weekdays, 3d. В остальные дни пункта нет, серию они не рвут.",
    show: [{ base: "plants", track: "plants", item: 0, attrs: ["every"] }],
  },
  {
    id: "month", wish: "за месяц, за два месяца, за всё время",
    say: "range @thisMonth (с первого числа), @last30d, @last2m, @all.",
    show: [{ base: "walks", card: "walks_month", at: 0 }],
  },
  {
    id: "frequency", wish: "сколько раз какой вариант, чаще всего, где",
    say: "у записи поле choice; bars, by — ключ этого поля, fn count, без value. У habit by item или state.",
    show: [{ base: "walks", card: "walks_places", at: 0 }],
  },
  {
    id: "plan-fact", wish: "план против факта",
    say: "два элемента рядом с of ration: value kcal и value kcal_planned (белки: protein, protein_planned).",
    show: [{ node: { el: "bars", of: "ration", value: "kcal_planned", fn: "sum", range: "@last7d" } }],
  },
  {
    id: "course", wish: "курс на две недели, до даты",
    say: "у пункта until (from не нужен); на главной marks и meter с goal due, value done, range @all: «сделано 3 из 14». Календарь на 12 недель не нужен.",
    show: [{ base: "exam", track: "exam", item: 0, attrs: ["until"] }, { base: "exam", card: "exam_today", at: 1 }],
  },
  {
    id: "money-left", wish: "сколько осталось потратить, сумма списка",
    say: "list, поле number с unit ₽ и planned true, цена в plan пункта; stat с rows items, where state open, range @all.",
    show: [{ base: "repair", card: "repair_left", at: 0 }],
  },
  {
    id: "pace", wish: "сколько можно тратить в день до конца месяца",
    say: "у поля goal и goalPer month (лимит: goalType max); meter с pace left.",
    show: [{ base: "taxi", card: "taxi_month", at: 0 }],
  },
  {
    id: "week-avg", wish: "в среднем за неделю",
    say: "range @last7d (@thisWeek только для квоты); рядом stat с fn avg.",
    show: [],
  },
  {
    id: "ask-at-mark", wish: "спроси при отметке приёма, тренировки, покупки",
    say: "kind follow, follows ration, sport или shopping; поле с on [\"skipped\"] спросят и у пропуска.",
    show: [],
  },
  {
    id: "plan-per-item", wish: "у пункта своё время или длительность",
    say: "поле number или time, planned true, значение в plan пункта.",
    show: [],
  },
  {
    id: "last-delta", wish: "последнее значение, что изменилось",
    say: "fn last: последняя запись; fn delta: последняя минус первая за период.",
    show: [{ base: "odo", card: "odo_last", at: 0 }, { base: "odo", card: "odo_month", at: 0 }],
  },
  {
    id: "expiring", wish: "что скоро истекает",
    say: "поле date, where со знаком и днём: <=+60d (ближайшие 60 дней), <today (уже прошло). Знаки: != < <= > >=.",
    show: [{ base: "docs", card: "docs_soon", at: 0 }],
  },
  {
    id: "edit-search", wish: "править и удалять строки, искать по названию",
    say: "list или table с edit true и search true.",
    show: [{ base: "docs", card: "docs_all", at: 0 }],
  },
  {
    id: "one-record", wish: "подход, серия, круг, порция",
    say: "каждый из них одна запись: форма или quick на каждый. За день fn sum, число записей fn count.",
    show: [],
  },
  {
    id: "own-date", wish: "когда это было",
    say: "у записи уже есть дата, своё поле для дня записи не заводи; date только для другой даты, например срока.",
    show: [],
  },
  {
    id: "catalog-or-list", wish: "справочник или список",
    say: "catalog это справочник, на который ссылаются поля link других треков; то, что покупают, читают или делают и отмечают, это list (по расписанию habit).",
    show: [],
  },
  {
    id: "shopping", wish: "список покупок из плана Рациона",
    say: "своего списка не заводи: embed requests показывает запросы на покупки с отметкой «куплено».",
    show: [{ node: { el: "embed", what: "requests" } }],
  },
  {
    id: "streak", wish: "серия, чтобы не сбиться",
    say: "habit и streak. При grace 0 срыв начинает текущую серию заново, лучшая и доля за 30 дней остаются; grace 1–3 прощает столько пропусков.",
    show: [],
  },
  {
    id: "honest", wish: "что сказать человеку в reply",
    say: "только то, что показывают карточки ответа: назови их и экран. Напоминаний нет, записи вносит человек.",
    show: [],
  },
]);
