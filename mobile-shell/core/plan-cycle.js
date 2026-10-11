// Shared scheme of the Рацион and the План тренировок: a cycle of days from an
// anchor date (a seven-day cycle may follow weekdays), versions effective
// from a date and Особые дни that override the cycle for one date. Each
// domain stores its own day content (meals or sessions); this module only
// decides which day of which version a date gets.

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DAY_MS = 86400000;

export function parsePlanDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function formatPlanDate(value) {
  const date = value instanceof Date ? value : parsePlanDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validPlanDate(value) {
  const date = value instanceof Date ? value : parsePlanDate(value);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function shiftPlanDate(dateKey, days) {
  return formatPlanDate(new Date(validPlanDate(dateKey).getTime() + days * DAY_MS));
}

export function planOwnerKey(value) {
  return String(value || "local").trim().toLowerCase() || "local";
}

export function planTimestamp(value) {
  const result = Date.parse(value || "");
  return Number.isFinite(result) ? result : 0;
}

// The version in force on a date. On the same start date the version
// released later wins.
export function activePlanVersion(plan, owner, dateKey) {
  const versions = (plan?.versions || []).filter((version) =>
    (version.owner || "local") === planOwnerKey(owner) && DATE_PATTERN.test(version.effectiveFrom || "")
  );
  if (!versions.length) return null;
  const sorted = versions.slice().sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom)
    || planTimestamp(a.createdAt) - planTimestamp(b.createdAt)
    || String(a.id).localeCompare(String(b.id))
  );
  if (String(dateKey) < sorted[0].effectiveFrom) return null;
  let active = sorted[0];
  for (const version of sorted) {
    if (version.effectiveFrom <= dateKey) active = version;
    else break;
  }
  return active;
}

export function cycleDayFor(cycle, dateKey) {
  const days = cycle?.days || [];
  if (!days.length) return null;
  const anchor = validPlanDate(cycle.anchor);
  const target = validPlanDate(dateKey);
  if (!anchor || !target) return null;
  const index = cycle.weekdayBinding && days.length === 7
    ? (target.getDay() - anchor.getDay() + 7) % 7
    : ((Math.round((target - anchor) / DAY_MS) % days.length) + days.length) % days.length;
  return days[index] || null;
}

// The plan of one date: its Особый день, else the cycle day of the version in
// force. `field` names the day content ("meals" or "sessions").
export function readPlanDay(plan, owner, dateKey, field) {
  if (!DATE_PATTERN.test(String(dateKey || ""))) return null;
  const special = plan?.specialDays?.[`${owner}|${dateKey}`];
  if (special) {
    return {
      date: dateKey,
      owner,
      source: "special",
      [field]: special[field] || [],
      updatedAt: special.updatedAt || "",
      updatedBy: special.updatedBy || "",
    };
  }
  const version = activePlanVersion(plan, owner, dateKey);
  if (!version) return null;
  const cycleDay = cycleDayFor(version.cycle, dateKey);
  if (!cycleDay) return null;
  return {
    date: dateKey,
    owner,
    source: "cycle",
    versionId: version.id,
    [field]: cycleDay[field] || [],
    updatedAt: version.updatedAt || version.createdAt || "",
    updatedBy: version.updatedBy || "",
  };
}

// A new version from `effectiveFrom`; the days keep their content under `field`.
export function buildPlanVersion({ id, owner, days, anchor, effectiveFrom, weekdayBinding, field, now, actor }) {
  return {
    id,
    owner,
    effectiveFrom,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
    cycle: {
      anchor,
      weekdayBinding: Boolean(weekdayBinding),
      days: days.map((day, index) => {
        const source = day && typeof day === "object" ? day : {};
        return { id: source.id || `cycle_day_${effectiveFrom}_${index}`, [field]: structuredClone(source[field] || []) };
      }),
    },
  };
}

export function normalizePlanVersion(version, index, field, prefix) {
  const source = version && typeof version === "object" ? version : {};
  const cycle = source.cycle && typeof source.cycle === "object" ? source.cycle : {};
  return {
    ...source,
    id: source.id || `${prefix}_${index}`,
    owner: planOwnerKey(source.owner),
    effectiveFrom: DATE_PATTERN.test(source.effectiveFrom || "") ? source.effectiveFrom : "",
    cycle: {
      anchor: DATE_PATTERN.test(cycle.anchor || "") ? cycle.anchor : "",
      weekdayBinding: Boolean(cycle.weekdayBinding),
      days: (Array.isArray(cycle.days) ? cycle.days : []).map((day, dayIndex) => {
        const sourceDay = day && typeof day === "object" ? day : {};
        return { id: sourceDay.id || `cycle_day_${dayIndex}`, [field]: Array.isArray(sourceDay[field]) ? sourceDay[field] : [] };
      }),
    },
  };
}

export function normalizePlanSpecialDays(source, field) {
  const result = {};
  const values = source && typeof source === "object" ? Object.values(source) : [];
  values.forEach((day) => {
    if (!day?.date || !DATE_PATTERN.test(day.date)) return;
    const owner = planOwnerKey(day.owner);
    result[`${owner}|${day.date}`] = { ...day, [field]: day[field] || [], owner };
  });
  return result;
}
