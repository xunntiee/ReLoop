import { buildThreadsQueries } from "../../apps/server/src/modules/crawl/collectors/threads-query-builder";
import type { TopicFilter } from "../../apps/server/src/modules/crawl/types";
import { splitDateRangeWindows } from "../../apps/server/src/modules/crawl/utils/date-range";

const placeholderTopic: TopicFilter = {
  category: "smoke",
  excluded_keywords: [],
  keywords: [],
  lexicon: {
    abbreviations: [],
    canonical: [],
    no_diacritics: [],
    teencode: [],
  },
  query_variants: [],
  required_keywords: [],
  required_keywords_mode: "any",
  search_queries: [],
  seed_post_urls: [],
  topic_intent: "viral feed",
  topic_title: "Viral feed",
};

const worldCupTopic: TopicFilter = {
  ...placeholderTopic,
  keywords: ["bong da"],
  search_queries: ["bong da"],
  topic_intent: "world cup",
  topic_title: "World cup",
};

const placeholderQueries = buildThreadsQueries(placeholderTopic, {
  dateEnd: "2025-03-15",
  dateQueryWindows: [
    {
      endDate: "2025-03-15",
      startDate: "2025-03-01",
    },
  ],
  dateStart: "2025-01-01",
});

const worldCupQueries = buildThreadsQueries(worldCupTopic, {
  dateEnd: "2026-06-16",
  dateQueryWindows: [
    {
      endDate: "2026-06-16",
      startDate: "2026-06-10",
    },
  ],
  dateStart: "2026-06-10",
});

if (placeholderQueries.some((query) => /\b(?:thang|ngay|nam|2025)\b/i.test(query))) {
  throw new Error(
    `Expected blank viral queries to avoid date bait, got ${placeholderQueries.join(" || ")}`,
  );
}

if (!placeholderQueries.some((query) => query.toLowerCase().includes("mọi người nghĩ sao"))) {
  throw new Error("Expected blank viral queries to use discussion bait instead of date bait.");
}

if (!worldCupQueries.some((query) => query.toLowerCase().includes("world cup thang 6 2026"))) {
  throw new Error("Expected topic query to combine title with date hint.");
}

if (!worldCupQueries.some((query) => query.toLowerCase().includes("cup the gioi"))) {
  throw new Error("Expected world cup variants to include Vietnamese synonym.");
}

const longRangePlaceholderQueries = buildThreadsQueries(placeholderTopic, {
  dateEnd: "2026-06-22",
  dateQueryWindows: splitDateRangeWindows("2026-01-01", "2026-06-22", 21, 8),
  dateStart: "2026-01-01",
});

const firstTwelveLongRangeQueries = longRangePlaceholderQueries.slice(0, 12).join(" || ").toLowerCase();
if (/\b(?:thang|ngay|nam|2026)\b/i.test(firstTwelveLongRangeQueries)) {
  throw new Error(
    `Expected long-range blank viral queries to avoid monthly date bait, got ${firstTwelveLongRangeQueries}`,
  );
}

console.log("smoke:date-query-builder ok");
