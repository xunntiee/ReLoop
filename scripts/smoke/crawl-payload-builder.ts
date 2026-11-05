import { buildStartPayload } from "../../apps/web/src/features/crawl-console/payload";
import { defaultForm, type CrawlFormState } from "../../apps/web/src/features/crawl-console/form-state";

const seedUrlA = "https://www.threads.com/@demo/post/ABC123";
const seedUrlB = "https://www.threads.com/@demo/post/DEF456";
const signedPostUrl =
  "https://www.threads.com/@jqklone/post/DdK8JePCcLK?xmt=AQG0g3mjqjnU36EOXUqnqDrf1WleS6QyT5-KopCMi77me6GRko_8osh2nAPmjZC_J2T8L9M";
const shareUrl = "https://www.threads.com/share/F2G13cPhn/";
const trendUrl =
  "https://www.threads.com/search?q=Ha%20An%20Huy&serp_type=trends&trend_fbid=1413677120519264";

const seedOnlyPayload = buildStartPayload({
  ...defaultForm,
  seedPostUrls: `${seedUrlA}\n${seedUrlB}`,
  sourceMode: "seed_only",
  topicTitle: "Seed 2 links",
  topCommentsPerPost: 4,
} satisfies CrawlFormState);

if (seedOnlyPayload.request?.filters.max_posts_per_topic !== 2) {
  throw new Error("Expected seed-only payload to target exactly the pasted links.");
}
if (seedOnlyPayload.request?.filters.topics[0]?.seed_post_urls.length !== 2) {
  throw new Error("Expected seed-only payload to carry both pasted post URLs.");
}
if ((seedOnlyPayload.overrides?.maxSearchQueriesPerTopic as number) !== 0) {
  throw new Error("Expected seed-only payload to disable search queries.");
}
if ((seedOnlyPayload.overrides?.maxCandidateLinks as number) !== 2) {
  throw new Error("Expected direct-link payload to budget only the pasted post URLs.");
}
if (seedOnlyPayload.overrides?.deepViralCompare !== false) {
  throw new Error("Expected direct-link payload to skip viral shortlist comparison.");
}
if (seedOnlyPayload.request?.filters.date_range.preset) {
  throw new Error("Expected seed-only payload without a selected date to have no date filter.");
}

const directUrlPayload = buildStartPayload({
  ...defaultForm,
  seedPostUrls: `${shareUrl}\n${signedPostUrl}`,
  sourceMode: "seed_only",
  topicTitle: "Direct Threads links",
} satisfies CrawlFormState);
const directUrls = directUrlPayload.request?.filters.topics[0]?.seed_post_urls ?? [];
if (directUrls.length !== 2 || directUrls[0] !== shareUrl || directUrls[1] !== signedPostUrl) {
  throw new Error(`Expected direct Threads links to reach the API unchanged: ${JSON.stringify(directUrls)}.`);
}

const datedSeedPayload = buildStartPayload({ ...defaultForm, datePreset: "date_range", endDate: "2026-07-11", seedPostUrls: seedUrlA, sourceMode: "seed_only", startDate: "2026-07-10" } satisfies CrawlFormState);
if (datedSeedPayload.request?.filters.date_range.preset || datedSeedPayload.request?.filters.date_range.start_date || datedSeedPayload.request?.filters.date_range.end_date || !datedSeedPayload.request.filters.date_range.timezone) {
  throw new Error("Expected direct-link crawl to ignore date filters while keeping the user timezone.");
}

const profilePayload = buildStartPayload({ ...defaultForm, seedPostUrls: "https://www.threads.com/@demo", sourceMode: "seed_only", wantedPosts: 4 } satisfies CrawlFormState);
if (profilePayload.request?.filters.max_posts_per_topic !== 4 || (profilePayload.overrides?.searchScrollRounds as number) < 3) {
  throw new Error("Expected profile crawl to use the requested count and listing scroll budget.");
}

const alignedOptionsPayload = buildStartPayload({ ...defaultForm, advancedEnabled: true, category: "sports", excludeCommerceContent: true, excludedKeywords: "quang cao\nma giam gia", excludePostsWithLinks: true, keywords: "football\nworld cup", languages: "vi\nen", minPostReplies: 12, minTopicMatchScore: 0.25, topicTitle: "World cup" } satisfies CrawlFormState);
const alignedFilters = alignedOptionsPayload.request?.filters;
const alignedTopic = alignedFilters?.topics[0];
if (alignedFilters?.languages.join(",") !== "vi,en" || alignedFilters.min_post_replies !== 12 || alignedFilters.min_topic_match_score !== 0.25 || !alignedFilters.exclude_posts_with_links || !alignedFilters.exclude_commerce_content || alignedTopic?.category !== "sports" || !alignedTopic.keywords.includes("football") || alignedTopic.excluded_keywords.length !== 2) {
  throw new Error("Expected all advanced topic/filter options to reach the API payload.");
}

const newestPayload = buildStartPayload({ ...defaultForm, sortBy: "newest", topicTitle: "World cup" } satisfies CrawlFormState);
if (newestPayload.request?.filters.ranking_mode !== "sort_by") {
  throw new Error("Expected an explicit newest sort to use sort_by ranking mode.");
}

const blankViralPayload = buildStartPayload({
  ...defaultForm,
  datePreset: "none",
  sourceMode: "discover",
  topicTitle: "",
  wantedPosts: 5,
} satisfies CrawlFormState);

if (blankViralPayload.request?.filters.date_range.preset) {
  throw new Error("Expected blank viral payload to leave date preset empty for server defaults.");
}
if (blankViralPayload.request?.filters.date_range.start_date || blankViralPayload.request?.filters.date_range.end_date) {
  throw new Error("Expected blank viral payload to leave date boundaries empty for server defaults.");
}
if ((blankViralPayload.overrides?.homeScrollRounds as number) < 18 || (blankViralPayload.overrides?.homeScrollRounds as number) > 22) {
  throw new Error("Expected blank viral payload to use a bounded home-feed seed scan.");
}
if ((blankViralPayload.overrides?.maxCandidateLinks as number) < 100 || (blankViralPayload.overrides?.maxCandidateLinks as number) > 130) {
  throw new Error("Expected blank viral payload to use a bounded but useful candidate pool.");
}
if ((blankViralPayload.overrides?.maxCollectedPostsPerTopic as number) < 50 || (blankViralPayload.overrides?.maxCollectedPostsPerTopic as number) > 70) {
  throw new Error("Expected blank viral payload to compare a production-sized summary pool.");
}
if ((blankViralPayload.overrides?.maxDetailRequests as number) < 20) {
  throw new Error("Expected blank viral payload to inspect at least four times the target deeply.");
}
if ((blankViralPayload.overrides?.maxCommentScanPosts as number) < 10) {
  throw new Error("Expected blank viral payload to compare at least twice the target before final selection.");
}
if ((blankViralPayload.overrides?.maxSearchQueriesPerTopic as number) !== 0) {
  throw new Error("Expected blank viral payload to disable generic search queries.");
}
if ((blankViralPayload.overrides?.searchScrollRounds as number) !== 0) {
  throw new Error("Expected blank viral payload to skip search scrolling.");
}
if ((blankViralPayload.request?.filters.ranking_weights.recency as number) <= 2) {
  throw new Error("Expected blank viral payload to preserve a useful recency weight.");
}

const trendPayload = buildStartPayload({
  ...defaultForm,
  sourceMode: "discover",
  topicTitle: "Ha An Huy trend",
  trendSearchUrls: trendUrl,
  wantedPosts: 5,
} satisfies CrawlFormState);

if (trendPayload.request?.filters.topics[0]?.trend_search_urls?.[0] !== trendUrl) {
  throw new Error("Expected trend search URL to be carried in the crawl payload.");
}
if ((trendPayload.overrides?.maxSearchQueriesPerTopic as number) < 1) {
  throw new Error("Expected trend URL payload to reserve discovery budget.");
}

const datedPayload = buildStartPayload({
  ...defaultForm,
  datePreset: "date_range",
  endDate: "2026-06-20",
  sourceMode: "discover",
  startDate: "2026-06-01",
  topicTitle: "Viral feed",
  wantedPosts: 3,
} satisfies CrawlFormState);

if (datedPayload.request?.filters.date_range.start_date !== "2026-06-01") {
  throw new Error("Expected date-range payload to carry start_date.");
}
if (datedPayload.request?.filters.date_range.end_date !== "2026-06-20") {
  throw new Error("Expected date-range payload to carry end_date.");
}
if (datedPayload.overrides?.maxSearchQueriesPerTopic !== 0) {
  throw new Error("Expected dated blank viral feed payload to disable generic search queries.");
}
if (datedPayload.overrides?.searchScrollRounds !== 0) {
  throw new Error("Expected dated blank viral feed payload to skip generic search scrolling.");
}
if (datedPayload.overrides?.includeHomeFeed !== true) {
  throw new Error("Expected dated blank viral feed payload to discover from the home feed.");
}
if ((datedPayload.overrides?.homeScrollRounds as number) < 8 || (datedPayload.overrides?.homeScrollRounds as number) > 12) {
  throw new Error("Expected dated viral feed payload to use a bounded home-feed scan.");
}
if ((datedPayload.overrides?.maxCandidateLinks as number) < 54 || (datedPayload.overrides?.maxCandidateLinks as number) > 90) {
  throw new Error("Expected dated viral feed payload to keep a bounded candidate pool.");
}
if ((datedPayload.overrides?.maxCollectedPostsPerTopic as number) < 30 || (datedPayload.overrides?.maxCollectedPostsPerTopic as number) >= 80) {
  throw new Error("Expected dated viral feed payload to compare enough date-diverse summaries.");
}

const thirtyDayPayload = buildStartPayload({
  ...defaultForm,
  datePreset: "last_30_days",
  sourceMode: "discover",
  topicTitle: "",
  wantedPosts: 3,
} satisfies CrawlFormState);
if ((thirtyDayPayload.overrides?.homeScrollRounds as number) < 18 || (thirtyDayPayload.overrides?.homeScrollRounds as number) > 20) {
  throw new Error("Expected 30-day viral feed to use a bounded deeper scan.");
}
if ((thirtyDayPayload.overrides?.maxCandidateLinks as number) < 72 || (thirtyDayPayload.overrides?.maxCandidateLinks as number) > 110) {
  throw new Error("Expected 30-day viral feed to keep a bounded broad candidate pool.");
}
if ((thirtyDayPayload.overrides?.maxCollectedPostsPerTopic as number) < 40 || (thirtyDayPayload.overrides?.maxCollectedPostsPerTopic as number) >= 120) {
  throw new Error("Expected 30-day viral feed to compare a bounded date-diverse pool.");
}

console.log("smoke:crawl-payload-builder ok");
