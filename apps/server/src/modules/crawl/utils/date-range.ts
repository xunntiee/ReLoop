export function resolveRequestedDateRange(input: {
  endValue?: string;
  presetValue?: string;
  referenceTime?: string;
  startValue?: string;
  timezone?: string;
}): { endDate: string; hasDateFilter: boolean; startDate: string; timezone: string } {
  const timezone = resolveTimeZone(input.timezone);
  let startDate = normalizeFlexibleDateBoundary(input.startValue, "start", timezone);
  let endDate = normalizeFlexibleDateBoundary(input.endValue, "end", timezone);
  const preset = String(input.presetValue ?? "")
    .trim()
    .toLowerCase();
  const referenceDate =
    parseCreatedAtDateKey(input.referenceTime, timezone) || dateKeyInTimeZone(new Date(), timezone);

  if (["today", "daily", "day"].includes(preset)) {
    startDate = referenceDate;
    endDate = referenceDate;
  } else if (preset === "yesterday") {
    startDate = addDays(referenceDate, -1);
    endDate = startDate;
  } else if (["last_24_hours", "latest"].includes(preset)) {
    startDate = addDays(referenceDate, -1);
    endDate = referenceDate;
  } else if (["last_7_days", "weekly", "week"].includes(preset)) {
    startDate = addDays(referenceDate, -6);
    endDate = referenceDate;
  } else if (preset === "this_week") {
    const day = new Date(`${referenceDate}T00:00:00Z`).getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    startDate = addDays(referenceDate, -daysSinceMonday);
    endDate = referenceDate;
  } else if (preset === "last_week") {
    const day = new Date(`${referenceDate}T00:00:00Z`).getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    endDate = addDays(referenceDate, -(daysSinceMonday + 1));
    startDate = addDays(endDate, -6);
  } else if (preset === "last_30_days") {
    startDate = addDays(referenceDate, -29);
    endDate = referenceDate;
  }

  if (startDate && endDate && startDate > endDate) {
    return {
      endDate: startDate,
      hasDateFilter: true,
      startDate: endDate,
      timezone,
    };
  }

  return {
    endDate,
    hasDateFilter: Boolean(startDate || endDate),
    startDate,
    timezone,
  };
}

export function parseCreatedAtDateKey(value: unknown, timezone?: string): string {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : dateKeyInTimeZone(parsed, resolveTimeZone(timezone));
}

export function normalizeFlexibleDateBoundary(
  value: unknown,
  boundary: "end" | "start",
  timezone?: string,
): string {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const yearOnly = /^(\d{4})$/.exec(text);
  if (yearOnly) {
    return boundary === "start" ? `${yearOnly[1]}-01-01` : `${yearOnly[1]}-12-31`;
  }

  const yearMonth = /^(\d{4})-(\d{2})$/.exec(text);
  if (yearMonth) {
    const [, year, month] = yearMonth;
    const monthNumber = Number(month);
    if (monthNumber < 1 || monthNumber > 12) return "";
    if (boundary === "start") return `${year}-${month}-01`;
    return `${year}-${month}-${String(daysInMonth(Number(year), monthNumber)).padStart(2, "0")}`;
  }

  return parseCreatedAtDateKey(text, timezone);
}

export function resolveTimeZone(value?: string): string {
  const requested = String(value ?? "").trim();
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  for (const candidate of [requested, local, "UTC"]) {
    if (!candidate) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
      return candidate;
    } catch {
      continue;
    }
  }
  return "UTC";
}

export function dateKeyInTimeZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildPublishTimeMetadata(input: {
  createdAt: unknown;
  dateRange: { end_date?: string; preset?: string; start_date?: string; timezone?: string };
  referenceTime?: string;
  source?: string;
}) {
  const range = resolveRequestedDateRange({
    endValue: input.dateRange.end_date,
    presetValue: input.dateRange.preset,
    referenceTime: input.referenceTime,
    startValue: input.dateRange.start_date,
    timezone: input.dateRange.timezone,
  });
  const detectedAt = String(input.createdAt ?? "").trim();
  const dateKey = parseCreatedAtDateKey(detectedAt, range.timezone);
  let reason = "";
  if (range.hasDateFilter && !dateKey) reason = "missing_created_at";
  else if (range.startDate && dateKey < range.startDate) reason = "date_before_start";
  else if (range.endDate && dateKey > range.endDate) reason = "date_after_end";
  return {
    date_key: dateKey,
    detected_at: detectedAt,
    filter_end_date: range.endDate,
    filter_reason: reason,
    filter_start_date: range.startDate,
    passed_date_filter: !reason,
    source: String(input.source || (detectedAt ? "threads_time_datetime" : "missing")),
    timezone: range.timezone,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function inclusiveDateSpanDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000) + 1);
}

export function splitDateRangeWindows(
  startDate: string,
  endDate: string,
  targetWindowDays = 60,
  maxWindows = 8,
): Array<{ startDate: string; endDate: string }> {
  const spanDays = inclusiveDateSpanDays(startDate, endDate);
  if (!startDate || !endDate || spanDays <= 0) return [];
  if (spanDays <= targetWindowDays || maxWindows <= 1) {
    return [{ startDate, endDate }];
  }

  const safeWindowDays = Math.max(7, Math.trunc(targetWindowDays));
  const windowsNeeded = Math.min(maxWindows, Math.max(1, Math.ceil(spanDays / safeWindowDays)));
  const windowSpan = Math.max(1, Math.ceil(spanDays / windowsNeeded));
  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = startDate;

  while (cursor <= endDate && windows.length < maxWindows) {
    const windowEnd = addDays(cursor, windowSpan - 1);
    const clampedEnd = windowEnd < endDate ? windowEnd : endDate;
    windows.push({ startDate: cursor, endDate: clampedEnd });
    if (clampedEnd >= endDate) break;
    cursor = addDays(clampedEnd, 1);
  }

  return windows;
}
