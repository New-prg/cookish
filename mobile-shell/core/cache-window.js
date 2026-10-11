import { activeResponses } from "./local-data.js";
import { formatRationDate, parseRationDate } from "./ration-domain.js";

// The windows of the full Core the phone keeps in its Cache (ADR-0002).
// Plans and logs keep their versions and profiles whole; Особые дни, История
// питания and Учёт тренировок only for dated keys «owner|date» in the window.
export const CACHE_WINDOW = Object.freeze({
  pastDays: 14,
  futureDays: 14,
  closedRequests: 30,
  changeSets: 20,
});

export function addDays(dateKey, days) {
  const date = parseRationDate(dateKey);
  date.setDate(date.getDate() + days);
  return formatRationDate(date);
}

// The dates the Cache keeps around `today`; `from` widens it into the past
// for days loaded on demand.
export function windowDates(today, from = "") {
  const start = addDays(today, -CACHE_WINDOW.pastDays);
  return { from: from && from < start ? from : start, to: addDays(today, CACHE_WINDOW.futureDays) };
}

function datedIn(map, from, to) {
  return Object.fromEntries(Object.entries(map || {}).filter(([key]) => {
    const date = key.split("|").pop();
    return date >= from && date <= to;
  }));
}

function isClosed(request) {
  return request.status === "done";
}

function closedAt(request) {
  return String(request.completedAt || request.updatedAt || request.createdAt || "");
}

// Open Запросы and the newest closed ones; `all` keeps every closed one.
function windowRequests(requests, all) {
  const live = (requests || []).filter((request) => !request.deletedAt);
  const closed = live.filter(isClosed).sort((a, b) => closedAt(b).localeCompare(closedAt(a)));
  const kept = new Set(all ? closed : closed.slice(0, CACHE_WINDOW.closedRequests));
  return {
    kept: live.filter((request) => !isClosed(request) || kept.has(request)),
    dropped: closed.filter((request) => !kept.has(request)),
  };
}

// What the Запросы outside the window bought, per product: the quantity and
// the latest price. «Куплено за всё время» and «Последняя цена» add it.
function addPurchases(archive, requests) {
  const result = structuredClone(archive || {});
  requests.forEach((request) => activeResponses(request).forEach((response) => response.items.forEach((item) => {
    const productId = item.purchasedProductId || item.productId;
    const entry = result[productId] ||= { quantity: 0, price: 0, priceAt: "" };
    entry.quantity += Number(item.quantity) || 0;
    if (Number(item.price) && String(response.createdAt || "") > entry.priceAt) {
      entry.price = Number(item.price);
      entry.priceAt = String(response.createdAt || "");
    }
  })));
  return result;
}

// A Закладка in the Cache is its header; the thread loads when it opens.
export function bookmarkHeader(bookmark) {
  return {
    id: bookmark.id,
    title: bookmark.title || "",
    page: bookmark.page || "",
    mode: bookmark.mode || "",
    createdAt: bookmark.createdAt || "",
    updatedAt: bookmark.updatedAt || "",
    proposalCount: bookmark.header ? Number(bookmark.proposalCount) || 0 : (bookmark.proposals || []).length,
    header: true,
  };
}

// The part of `state` the Cache keeps. `from` widens the dated window,
// `allRequests` keeps every closed Запрос.
export function cacheSlice(state, { today, from = "", allRequests = false } = {}) {
  const dates = windowDates(today, from);
  const assistant = state.assistant || {};
  const requests = windowRequests(state.requests, allRequests);
  return {
    ...state,
    requests: requests.kept,
    purchaseArchive: addPurchases(state.purchaseArchive, requests.dropped),
    ration: {
      ...state.ration,
      specialDays: datedIn(state.ration?.specialDays, dates.from, dates.to),
      history: datedIn(state.ration?.history, dates.from, dates.to),
    },
    sport: {
      ...state.sport,
      specialDays: datedIn(state.sport?.specialDays, dates.from, dates.to),
      log: datedIn(state.sport?.log, dates.from, dates.to),
    },
    journal: (state.journal || []).slice(-CACHE_WINDOW.changeSets),
    assistant: { ...assistant, bookmarks: (assistant.bookmarks || []).map(bookmarkHeader) },
  };
}

// Dated parts of `state` between `from` and `to`, for days past the window.
export function rangeSlice(state, { from, to }) {
  return {
    ration: { specialDays: datedIn(state.ration?.specialDays, from, to), history: datedIn(state.ration?.history, from, to) },
    sport: { specialDays: datedIn(state.sport?.specialDays, from, to), log: datedIn(state.sport?.log, from, to) },
  };
}

// How many closed Запросы stay outside the window.
export function olderRequestCount(state) {
  const closed = (state.requests || []).filter((request) => !request.deletedAt && isClosed(request)).length;
  return Math.max(0, closed - CACHE_WINDOW.closedRequests);
}
