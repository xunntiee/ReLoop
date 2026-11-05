import type { TopicFilter } from "../types.js";
import { foldVietnameseAscii } from "../utils/text.js";

interface QueryBuilderOptions {
  dateEnd: string;
  dateQueryWindows?: Array<{ endDate: string; startDate: string }>;
  dateStart: string;
}

export function buildThreadsQueries(
  topic: TopicFilter,
  options: QueryBuilderOptions,
): string[] {
  const title = topic.topic_title.trim();
  const topicIntent = topic.topic_intent.trim();
  const titleIsPlaceholder = isPlaceholderTopic(title);
  const intentIsPlaceholder = isPlaceholderTopic(topicIntent);
  const searchQueries = topic.search_queries.map((query) => query.trim()).filter(Boolean);
  const queryVariants = topic.query_variants.map((query) => query.trim()).filter(Boolean);
  const titleVariants = titleIsPlaceholder ? [] : topicTitleSearchVariants(title);
  const alternateTitleVariants = titleVariants.filter((variant) => variant.toLowerCase() !== title.toLowerCase());
  const isBlankViralDiscovery =
    titleIsPlaceholder &&
    intentIsPlaceholder &&
    searchQueries.length === 0 &&
    queryVariants.length === 0 &&
    topic.required_keywords.every((query) => !query.trim()) &&
    topic.keywords.every((query) => !query.trim());
  const baseDateHints = buildDateQueryHints(options.dateStart, options.dateEnd);
  const windowHints = buildWindowQueryHints(options.dateQueryWindows ?? []);
  const dateHints = isBlankViralDiscovery
    ? []
    : uniqueStrings([...windowHints, ...baseDateHints]);
  const genericFallbackQueries = buildGenericFallbackQueries(dateHints);
  const genericDateQueries = dateHints.flatMap((hint) => [
    joinQueryParts("viral", hint),
    joinQueryParts("threads", hint),
    hint,
  ]);
  const dateAwareQueries = [
    ...dateHints.flatMap((hint) => [
      titleIsPlaceholder ? "" : joinQueryParts(title, hint),
      intentIsPlaceholder ? "" : joinQueryParts(topicIntent, hint),
    ]),
    ...searchQueries.flatMap((query) =>
      dateHints.flatMap((hint) => [joinQueryParts(titleIsPlaceholder ? "" : title, query, hint), joinQueryParts(query, hint)]),
    ),
    ...queryVariants.flatMap((query) =>
      dateHints.flatMap((hint) => [joinQueryParts(titleIsPlaceholder ? "" : title, query, hint), joinQueryParts(query, hint)]),
    ),
  ];
  const ordered = [
    ...(searchQueries.length === 0 && queryVariants.length === 0 && titleIsPlaceholder && intentIsPlaceholder
      ? dateHints.length > 0
        ? genericDateQueries
        : genericFallbackQueries
      : []),
    ...dateAwareQueries,
    ...(searchQueries.length === 0 && queryVariants.length === 0 && titleIsPlaceholder && intentIsPlaceholder
      ? dateHints.length > 0
        ? genericFallbackQueries
        : genericDateQueries
      : []),
    ...(titleIsPlaceholder ? [] : [title]),
    ...(intentIsPlaceholder ? [] : [topicIntent]),
    ...searchQueries.map((query) => joinQueryParts(titleIsPlaceholder ? "" : title, query)),
    ...queryVariants.map((query) => joinQueryParts(titleIsPlaceholder ? "" : title, query)),
    ...alternateTitleVariants,
    ...searchQueries.flatMap((query) =>
      alternateTitleVariants.map((titleVariant) => joinQueryParts(titleVariant, query)),
    ),
    ...queryVariants.flatMap((query) =>
      alternateTitleVariants.map((titleVariant) => joinQueryParts(titleVariant, query)),
    ),
    ...searchQueries.map((query) => joinQueryParts(query, titleIsPlaceholder ? "" : title)),
    ...queryVariants.map((query) => joinQueryParts(query, titleIsPlaceholder ? "" : title)),
    ...topic.required_keywords,
    ...topic.keywords,
    ...queryVariants,
    ...searchQueries,
  ];
  const output = uniqueStrings(
    [...ordered, ...ordered.map(foldVietnameseAscii)]
      .map((query) => query.trim())
      .filter(Boolean),
  );
  return output.length > 0 ? output : fallbackQueries(topic, dateHints);
}

function fallbackQueries(topic: TopicFilter, dateHints: string[]): string[] {
  const title = topic.topic_title.trim();
  if (title && !isPlaceholderTopic(title)) {
    return [title];
  }
  if (dateHints.length > 0) {
    return uniqueStrings([
      ...buildGenericFallbackQueries(dateHints),
      ...dateHints,
      ...dateHints.map((hint) => joinQueryParts("threads", hint)),
      ...dateHints.map((hint) => joinQueryParts("viral", hint)),
    ]);
  }
  return buildGenericFallbackQueries([]);
}

function buildGenericFallbackQueries(dateHints: string[]): string[] {
  const base = [
    "mọi người nghĩ sao",
    "quan điểm của mình",
    "góc nhìn",
    "unpopular opinion",
    "chuyện là",
    "có ai như mình không",
    "xin vía",
    "mọi người cứu mình",
    "nhờ mọi người tư vấn",
    "tâm sự",
    "hóng",
    "drama",
    "co ai",
    "xin y kien",
    "tam su",
    "sao moi nguoi",
    "threads viral",
    "viral",
    "trending",
    "hot",
    "việt nam",
  ];

  const filteredBase = base.filter((query) => foldVietnameseAscii(query).toLowerCase() !== "viet nam");

  if (dateHints.length === 0) {
    return uniqueStrings(filteredBase);
  }

  return uniqueStrings([
    ...filteredBase,
    ...filteredBase.flatMap((query) => dateHints.map((hint) => joinQueryParts(query, hint))),
  ]);
}

function buildWindowQueryHints(windows: Array<{ endDate: string; startDate: string }>): string[] {
  const perWindowHints = windows
    .slice(0, 8)
    .map((window) => buildDateQueryHints(window.startDate, window.endDate))
    .filter((hints) => hints.length > 0);
  const output: string[] = [];
  const maxLength = perWindowHints.reduce((max, hints) => Math.max(max, hints.length), 0);
  for (let index = 0; index < maxLength; index += 1) {
    for (const hints of perWindowHints) {
      const hint = hints[index];
      if (hint) output.push(hint);
    }
  }
  return uniqueStrings(output);
}

function buildDateQueryHints(startDate: string, endDate: string): string[] {
  const start = safeDateParts(startDate);
  const end = safeDateParts(endDate || startDate);
  if (!start || !end) return [];

  const monthHints: string[] = [];
  let year = end.year;
  let month = end.month;
  let guard = 0;
  while ((year > start.year || (year === start.year && month >= start.month)) && guard < 8) {
    monthHints.push(`thang ${month} ${year}`);
    monthHints.push(`${String(month).padStart(2, "0")}/${year}`);
    month -= 1;
    if (month <= 0) {
      month = 12;
      year -= 1;
    }
    guard += 1;
  }

  const yearHints = new Set<string>();
  for (let currentYear = start.year; currentYear <= end.year && yearHints.size < 4; currentYear += 1) {
    yearHints.add(String(currentYear));
  }

  const periodHints = uniqueStrings([
    ...monthHints,
    ...monthSegmentHints(start, end),
    ...weekOfMonthHints(start, end),
  ]);
  const dayHints = uniqueStrings([
    ...singleDayHints(start),
    ...singleDayHints(midpointDateParts(start, end)),
    ...singleDayHints(end),
  ]);

  return uniqueStrings([...periodHints, ...dayHints, ...yearHints]);
}

function safeDateParts(value: string): { day: number; month: number; year: number; key: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return { day, month, year, key: match[0] };
}

function midpointDateParts(
  start: { day: number; month: number; year: number; key: string },
  end: { day: number; month: number; year: number; key: string },
): { day: number; month: number; year: number; key: string } {
  const startTime = Date.parse(`${start.key}T00:00:00Z`);
  const endTime = Date.parse(`${end.key}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return end;
  }
  const midpoint = new Date(startTime + Math.floor((endTime - startTime) / 2));
  return safeDateParts(midpoint.toISOString().slice(0, 10)) ?? end;
}

function singleDayHints(date: { day: number; month: number; year: number; key: string } | null): string[] {
  if (!date) return [];
  const day = String(date.day).padStart(2, "0");
  const month = String(date.month).padStart(2, "0");
  return [
    `${day}/${month}/${date.year}`,
    `${date.day}/${date.month}/${date.year}`,
    `ngay ${date.day} thang ${date.month} ${date.year}`,
    `${date.day} thang ${date.month} ${date.year}`,
  ];
}

function monthSegmentHints(
  start: { day: number; month: number; year: number; key: string },
  end: { day: number; month: number; year: number; key: string },
): string[] {
  if (start.year !== end.year || start.month !== end.month) return [];
  return [
    `dau thang ${start.month} ${start.year}`,
    `giua thang ${start.month} ${start.year}`,
    `cuoi thang ${start.month} ${start.year}`,
  ];
}

function weekOfMonthHints(
  start: { day: number; month: number; year: number; key: string },
  end: { day: number; month: number; year: number; key: string },
): string[] {
  const output = new Set<string>();
  for (const date of [start, midpointDateParts(start, end), end]) {
    const week = Math.min(5, Math.max(1, Math.ceil(date.day / 7)));
    output.add(`tuan ${week} thang ${date.month} ${date.year}`);
  }
  return [...output];
}

function topicTitleSearchVariants(topicTitle: string): string[] {
  const value = topicTitle.trim();
  const folded = foldVietnameseAscii(value).toLowerCase();
  if (!/\bworld\s*cup\b/.test(folded)) return [value].filter(Boolean);
  return [value, "cup the gioi", "World Cup 2026", "FIFA World Cup"].filter(Boolean);
}

function isPlaceholderTopic(value: string): boolean {
  const normalized = foldVietnameseAscii(String(value || "").trim()).toLowerCase();
  return (
    normalized === "" ||
    normalized === "viral" ||
    normalized === "viral feed" ||
    normalized === "trending" ||
    normalized === "hot" ||
    normalized === "top" ||
    normalized === "top threads" ||
    normalized === "xu huong"
  );
}

function joinQueryParts(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}
