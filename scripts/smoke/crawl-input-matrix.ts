import { buildThreadsQueries } from "../../apps/server/src/modules/crawl/collectors/threads-query-builder";
import {
  buildStartPayload,
  classifySeedTarget,
  invalidSeedTargets,
} from "../../apps/web/src/features/crawl-console/payload";
import {
  defaultForm,
  sourceModeOptions,
  type CrawlFormState,
} from "../../apps/web/src/features/crawl-console/form-state";

const payload = (patch: Partial<CrawlFormState>) =>
  buildStartPayload({ ...defaultForm, ...patch } satisfies CrawlFormState);

const dateCases = [
  { patch: { datePreset: "none" }, expected: ["", "", ""] },
  { patch: { datePreset: "today" }, expected: ["today", "", ""] },
  { patch: { datePreset: "last_7_days" }, expected: ["last_7_days", "", ""] },
  { patch: { datePreset: "last_30_days" }, expected: ["last_30_days", "", ""] },
  {
    patch: { datePreset: "after_date", startDate: "2026-07-01" },
    expected: ["", "2026-07-01", ""],
  },
  {
    patch: { datePreset: "before_date", endDate: "2026-07-20" },
    expected: ["", "", "2026-07-20"],
  },
  {
    patch: {
      datePreset: "date_range",
      startDate: "2026-07-01",
      endDate: "2026-07-20",
    },
    expected: ["", "2026-07-01", "2026-07-20"],
  },
] as const;

for (const testCase of dateCases) {
  const result = payload({ ...testCase.patch, topicTitle: "Skincare" });
  const range = result.request?.filters.date_range;
  const actual = [
    range?.preset ?? "",
    range?.start_date ?? "",
    range?.end_date ?? "",
  ];
  if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
    throw new Error(
      `Date option mismatch: expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}.`
    );
  }
  if (!range?.timezone)
    throw new Error("Every date payload must include the user's timezone.");
}

const topicPayload = payload({ topicTitle: "Skincare giá rẻ", wantedPosts: 5 });
const topic = topicPayload.request?.filters.topics[0];
if (
  topic?.topic_title !== "Skincare giá rẻ" ||
  topicPayload.overrides?.includeHomeFeed === true
) {
  throw new Error(
    "Topic crawl must preserve the topic and avoid home feed unless requested."
  );
}
const topicQueries = buildThreadsQueries(topic!, {
  dateEnd: "",
  dateStart: "",
});
if (!topicQueries.some((query) => query.toLowerCase().includes("skincare"))) {
  throw new Error(
    "Topic-only crawl must generate a usable Threads search query."
  );
}

const keywordPayload = payload({
  searchQueries: "world cup\nbóng đá",
  topicTitle: "Bóng đá",
});
const keywordTopic = keywordPayload.request?.filters.topics[0];
if (keywordTopic?.search_queries.join("|") !== "world cup|bóng đá") {
  throw new Error("Keyword crawl must preserve every search keyword.");
}
if (
  !keywordTopic.keywords.includes("world cup") ||
  !keywordTopic.keywords.includes("bóng đá")
) {
  throw new Error("Search keywords must also participate in topic matching.");
}

const requiredPayload = payload({
  requiredKeywords: "skincare\ngiá rẻ",
  requiredKeywordsMode: "all",
  topicTitle: "Review",
});
const requiredTopic = requiredPayload.request?.filters.topics[0];
if (
  requiredTopic?.required_keywords_mode !== "all" ||
  requiredTopic.search_queries.length !== 2
) {
  throw new Error(
    "Required-keyword crawl must search and enforce the configured terms."
  );
}

const seedUrl = "https://www.threads.com/@demo/post/ABC123";
const copiedShareUrl = "https://www.threads.com/share/Bg-p-Lak8R/";
const embeddedPost = `<blockquote data-text-post-permalink="https://www.threads.com/@callme_thor20/post/DdS8zX4lLJU">
  <a href="https://www.threads.com/@callme_thor20/post/DdS8zX4lLJU">Xem trên Threads</a>
  <svg><path d="M141.537 88.9883Z" /></svg>
</blockquote>
<script async src="https://www.threads.com/embed.js"></script>`;
if (classifySeedTarget(copiedShareUrl) !== "post") {
  throw new Error("Copied Threads /share/ URL must be accepted as a post target.");
}
if (classifySeedTarget("https://www.threads.com/share/FrYGnDdlO/") !== "post") {
  throw new Error("Threads /share/ URL without a hyphen must be accepted.");
}
if (classifySeedTarget(embeddedPost) !== "post") {
  throw new Error("Threads embed HTML must be accepted as a post target.");
}
if (invalidSeedTargets(embeddedPost).length !== 0) {
  throw new Error("Threads embed HTML must not be blocked by the seed URL validator.");
}
if (invalidSeedTargets(copiedShareUrl).length !== 0 || invalidSeedTargets(seedUrl).length !== 0) {
  throw new Error("Direct or share URLs must be accepted by the seed target validator.");
}
if (sourceModeOptions.some((option) => option.value === "hybrid") || sourceModeOptions.length !== 2) {
  throw new Error("The crawl form must expose only discover and direct-link/embed modes.");
}
const embeddedPayload = payload({
  seedPostUrls: embeddedPost,
  sourceMode: "seed_only",
});
if (
  embeddedPayload.request?.filters.topics[0]?.seed_post_urls[0] !==
  "https://www.threads.com/@callme_thor20/post/DdS8zX4lLJU"
) {
  throw new Error("Threads embed HTML must be reduced to its canonical post permalink.");
}
const sharePayload = payload({
  seedPostUrls: copiedShareUrl,
  sourceMode: "seed_only",
  wantedPosts: 15,
});
if (sharePayload.request?.filters.max_posts_per_topic !== 1) {
  throw new Error("A single Threads /share/ URL must use the one-post fast path.");
}
if ((sharePayload.request?.filters.languages ?? []).length !== 0) {
  throw new Error("A direct Threads post crawl must not apply the hidden default language filter.");
}
const linkPayload = payload({
  seedPostUrls: seedUrl,
  sourceMode: "seed_only",
  wantedPosts: 9,
});
if (
  linkPayload.request?.filters.max_posts_per_topic !== 1 ||
  linkPayload.request.filters.topics[0]?.seed_post_urls[0] !== seedUrl
) {
  throw new Error(
    "Direct-link crawl must target exactly the pasted post links."
  );
}
if (
  linkPayload.overrides?.includeHomeFeed === true ||
  linkPayload.overrides?.maxSearchQueriesPerTopic !== 0
) {
  throw new Error("Direct-link crawl must not open discovery sources.");
}

const hybridPayload = payload({
  seedPostUrls: seedUrl,
  searchQueries: "marketing",
  sourceMode: "hybrid",
  topicTitle: "Marketing",
});
const hybridTopic = hybridPayload.request?.filters.topics[0];
if (
  hybridTopic?.seed_post_urls.length !== 1 ||
  hybridTopic.search_queries[0] !== "marketing"
) {
  throw new Error(
    "Hybrid crawl must carry both pasted links and search keywords."
  );
}

const trendUrl =
  "https://www.threads.com/search?q=marketing&serp_type=trends&trend_fbid=123";
const trendPayload = payload({
  topicTitle: "Marketing trend",
  trendSearchUrls: trendUrl,
});
if (
  trendPayload.request?.filters.topics[0]?.trend_search_urls[0] !== trendUrl
) {
  throw new Error(
    "Trend-search crawl must preserve the pasted Threads trend URL."
  );
}

const advancedOff = payload({
  advancedEnabled: false,
  excludeCommerceContent: true,
  excludePostsWithLinks: true,
  minPostReplies: 50,
  requiredKeywords: "must stay",
});
if (
  advancedOff.request?.filters.min_post_replies !== 0 ||
  advancedOff.request.filters.exclude_commerce_content ||
  advancedOff.request.filters.exclude_posts_with_links
) {
  throw new Error(
    "Disabled advanced filters must not leak stale advanced values."
  );
}
const advancedOn = payload({
  advancedEnabled: true,
  excludeCommerceContent: true,
  excludePostsWithLinks: true,
  minPostReplies: 50,
  minTopicMatchScore: 0.3,
  topicTitle: "Marketing",
});
if (
  advancedOn.request?.filters.min_post_replies !== 50 ||
  !advancedOn.request.filters.exclude_commerce_content ||
  !advancedOn.request.filters.exclude_posts_with_links ||
  advancedOn.request.filters.min_topic_match_score !== 0.3
) {
  throw new Error("Enabled advanced filters must reach the API unchanged.");
}

const viralPayload = payload({
  sourceMode: "discover",
  topicTitle: "",
  wantedPosts: 5,
});
const viralRuntime = viralPayload.overrides ?? {};
if (
  viralRuntime.includeHomeFeed !== true ||
  viralRuntime.maxSearchQueriesPerTopic !== 0
) {
  throw new Error(
    "Blank Viral feed must use the dedicated diversified feed/profile strategy."
  );
}
if (
  Number(viralRuntime.maxCollectedPostsPerTopic) < 40 ||
  Number(viralRuntime.maxDetailRequests) < 20 ||
  Number(viralRuntime.maxCommentScanPosts) < 10
) {
  throw new Error(
    "Blank Viral feed must inspect enough candidates to satisfy the quality target."
  );
}

console.log("smoke:crawl-input-matrix ok");
