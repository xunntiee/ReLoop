import type { CrawlRequestMeta, StartCrawlRunPayload } from "@/lib/api";
import { localTimestampForId, slugify, splitList } from "@/lib/formatters";
import type { CrawlFormState, RuntimeProfile } from "./form-state";
import { defaultForm } from "./form-state";
import { resolveImplicitViralRuntimeBudget } from "./viral-runtime-budget";

export { resolveImplicitViralRuntimeBudget } from "./viral-runtime-budget";

const EMBEDDED_THREADS_TARGET_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)?threads\.(?:com|net)\/(?:@[^/\s"'<>]+\/post\/[A-Za-z0-9_-]+|share\/[A-Za-z0-9_-]+|t\/[A-Za-z0-9_-]+)\/?/gi;

export function buildStartPayload(form: CrawlFormState): StartCrawlRunPayload {
  const sourceMode = form.sourceMode;
  const searchKeywords = splitList(form.searchQueries);
  const topicKeywords = splitList(form.keywords);
  const requiredKeywords = splitList(form.requiredKeywords);
  const seedPostUrls = expandSeedInputs(form.seedPostUrls);
  const trendSearchUrls = splitList(form.trendSearchUrls);
  const searchQueries =
    sourceMode === "seed_only"
      ? []
      : searchKeywords.length > 0
        ? searchKeywords
        : requiredKeywords;
  const topicTitle = form.topicTitle.trim();
  const isFeedOnlyMode =
    sourceMode === "discover" &&
    isFeedOnlyTopicTitle(topicTitle) &&
    searchQueries.length === 0 &&
    seedPostUrls.length === 0 &&
    trendSearchUrls.length === 0;
  const dateRangeMode =
    sourceMode === "seed_only" ? "preset" : resolveDateRangeMode(form.datePreset);
  const normalizedTopicTitle = topicTitle || "Viral feed";
  const keywords = dedupeList([...topicKeywords, ...searchKeywords, ...requiredKeywords]);
  const seedTargetKinds = seedPostUrls.map(classifySeedTarget);
  const hasProfileSeed = seedTargetKinds.includes("profile");
  const isDirectPostSeedOnly =
    sourceMode === "seed_only" &&
    seedPostUrls.length > 0 &&
    seedTargetKinds.every((kind) => kind === "post");
  const maxPosts =
    sourceMode === "seed_only"
      ? hasProfileSeed
        ? Math.max(1, Math.trunc(form.wantedPosts))
        : Math.max(1, seedPostUrls.length || 1)
      : Math.max(1, Math.trunc(form.wantedPosts));
  const topComments = Math.max(0, Math.trunc(form.topCommentsPerPost));
  const requestId = buildOutputRequestId(normalizedTopicTitle, form, maxPosts, topComments);
  const advancedEnabled = Boolean(form.advancedEnabled);
  const minLoadedTopComments = advancedEnabled ? Math.max(0, Math.trunc(form.minLoadedTopComments)) : 0;
  const minCommentLikes = advancedEnabled ? Math.max(0, Math.trunc(form.minCommentLikes)) : 0;
  const minPostReposts = advancedEnabled ? Math.max(0, Math.trunc(form.minPostReposts)) : 0;
  const minPostReplies = advancedEnabled ? Math.max(0, Math.trunc(form.minPostReplies)) : 0;
  const minPostShares = advancedEnabled ? Math.max(0, Math.trunc(form.minPostShares)) : 0;
  const minTextLength = advancedEnabled ? Math.max(0, Math.trunc(form.minTextLength)) : 0;
  const maxTextLength = advancedEnabled ? Math.max(0, Math.trunc(form.maxTextLength)) : 0;
  const textExcludesAny = advancedEnabled ? splitList(form.textExcludesAny) : [];
  const excludedKeywords = advancedEnabled ? splitList(form.excludedKeywords) : [];
  const excludePostsWithLinks = advancedEnabled ? Boolean(form.excludePostsWithLinks) : false;
  const excludeCommerceContent = advancedEnabled ? Boolean(form.excludeCommerceContent) : false;
  const minTopicMatchScore = advancedEnabled
    ? Math.max(0, Number(form.minTopicMatchScore) || 0)
    : resolveTopicGateScore(
        topicTitle,
        searchQueries,
        requiredKeywords,
        isFeedOnlyMode,
        sourceMode,
        seedPostUrls,
        trendSearchUrls,
      );
  const runtimeProfile = resolveRuntimeProfile(form, {
    feedOnlyMode: isFeedOnlyMode,
    queryCount: searchQueries.length,
    profileSeedCount: seedTargetKinds.filter((kind) => kind === "profile").length,
    seedUrlCount: seedPostUrls.length,
    trendUrlCount: trendSearchUrls.length,
  });
  const effectiveDatePreset =
    sourceMode === "seed_only" ? "" : resolveTransportDatePreset(form.datePreset);
  const normalizedDateRange =
    sourceMode === "seed_only"
      ? { endDate: "", startDate: "" }
      : normalizeDateRangeForPayload(form, dateRangeMode);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const rankingWeights = {
    comments: Math.max(0, Number(form.rankingWeightComments) || 0),
    likes: Math.max(0, Number(form.rankingWeightLikes) || 0),
    recency: Math.max(0, Number(form.rankingWeightRecency) || 0),
    reposts: Math.max(0, Number(form.rankingWeightReposts) || 0),
    shares: Math.max(0, Number(form.rankingWeightShares) || 0),
    topic_match: Math.max(0, Number(form.rankingWeightTopicMatch) || 0),
    views: Math.max(0, Number(form.rankingWeightViews) || 0),
  };

  return {
    overrides: runtimeProfile as unknown as Record<string, unknown>,
    request: {
      created_at: new Date().toISOString(),
      filters: {
        date_range: {
          end_date: normalizedDateRange.endDate,
          preset: effectiveDatePreset === "none" ? "" : effectiveDatePreset,
          start_date: normalizedDateRange.startDate,
          timezone,
        },
        exclude_usernames: [],
        include_usernames: [],
        languages: isDirectPostSeedOnly
          ? []
          : dedupeList(splitList(form.languages)).length
            ? dedupeList(splitList(form.languages))
            : ["vi"],
        max_posts_per_topic: maxPosts,
        max_text_length: maxTextLength,
        min_comment_likes: minCommentLikes,
        min_comments: 0,
        min_loaded_top_comments: minLoadedTopComments,
        min_post_likes: 0,
        min_post_views: 0,
        min_post_replies: minPostReplies,
        min_post_reposts: minPostReposts,
        min_post_score: 0,
        min_post_shares: minPostShares,
        min_text_length: minTextLength,
        min_topic_match_score: minTopicMatchScore,
        recency_half_life_hours: 168,
        ranking_mode: form.sortBy === "score" ? "weighted" : "sort_by",
        ranking_weights: rankingWeights,
        require_comments: false,
        require_metrics: false,
        require_repost_or_share: false,
        exclude_posts_with_links: excludePostsWithLinks,
        exclude_commerce_content: excludeCommerceContent,
        global_excluded_keywords: [],
        sort_by: form.sortBy,
        source: "threads",
        text_contains_all: [],
        text_contains_any: [],
        text_excludes_any: textExcludesAny,
        top_comments_per_post: topComments,
        topics: [
          {
            category: form.category.trim() || "general",
            excluded_keywords: excludedKeywords,
            keywords,
            lexicon: {
              abbreviations: [],
              canonical: [],
              no_diacritics: [],
              teencode: [],
            },
            query_variants: [],
            required_keywords: requiredKeywords,
            required_keywords_mode: form.requiredKeywordsMode,
            search_queries: searchQueries,
            seed_post_urls: sourceMode === "discover" ? [] : seedPostUrls,
            trend_search_urls: sourceMode === "seed_only" ? [] : trendSearchUrls,
            topic_intent: normalizedTopicTitle,
            topic_title: normalizedTopicTitle,
          },
        ],
      },
      notes: "Created from Crawl Console UI.",
      request_id: requestId,
      runtime_overrides: runtimeProfile as unknown as Record<string, unknown>,
      ui_state: formToSerializableState(form),
    },
  };
}

function dedupeList(values: string[]): string[] {
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

export function classifySeedTarget(value: string): "post" | "profile" | "unsupported" {
  if (isStandaloneThreadsTarget(value)) {
    try {
      const url = new URL(value.trim());
      if (/^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) return "post";
      if (/^\/share\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) return "post";
      if (/^\/t\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) return "post";
      if (/^\/@[^/]+\/?$/i.test(url.pathname)) return "profile";
    } catch {
      return "unsupported";
    }
  }

  const embeddedTargets = extractEmbeddedSeedTargets(value);
  if (embeddedTargets.length > 0 && embeddedTargets[0] !== String(value || "").trim()) {
    return classifySeedTarget(embeddedTargets[0]);
  }
  try {
    const url = new URL(value);
    if (!/(^|\.)threads\.(?:com|net)$/i.test(url.hostname)) return "unsupported";
    if (/^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) return "post";
    if (/^\/share\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) return "post";
    if (/^\/t\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) return "post";
    if (/^\/@[^/]+\/?$/i.test(url.pathname)) return "profile";
  } catch {
    return "unsupported";
  }
  return "unsupported";
}

export function invalidSeedTargets(value: string): string[] {
  if (isThreadsEmbedInput(value)) return [];
  return splitList(value).filter((item) => {
    if (isThreadsEmbedInput(item)) return false;
    return classifySeedTarget(item) === "unsupported";
  });
}

function extractEmbeddedSeedTargets(value: string): string[] {
  const matches = String(value || "").match(EMBEDDED_THREADS_TARGET_RE) ?? [];
  return dedupeList(matches);
}

function isThreadsEmbedInput(value: string): boolean {
  const text = String(value || "");
  return (
    /<blockquote\b/i.test(text) &&
    /data-text-post-permalink\s*=/i.test(text) &&
    extractEmbeddedSeedTargets(text).length > 0
  );
}

function expandSeedInput(value: string): string[] {
  if (isStandaloneThreadsTarget(value)) return [String(value || "").trim()];
  const embeddedTargets = extractEmbeddedSeedTargets(value);
  return embeddedTargets.length > 0 ? embeddedTargets : [value];
}

function expandSeedInputs(value: string): string[] {
  return splitList(value).flatMap(expandSeedInput);
}

function isStandaloneThreadsTarget(value: string): boolean {
  try {
    const url = new URL(String(value || "").trim());
    if (!/(^|\.)threads\.(?:com|net)$/i.test(url.hostname)) return false;
    return (
      /^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname) ||
      /^\/share\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname) ||
      /^\/t\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname) ||
      /^\/@[^/]+\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function resolveTopicGateScore(
  topicTitle: string,
  queries: string[],
  requiredKeywords: string[],
  isFeedOnlyMode: boolean,
  sourceMode: CrawlFormState["sourceMode"],
  seedPostUrls: string[],
  trendSearchUrls: string[],
): number {
  if (sourceMode === "seed_only" && seedPostUrls.length > 0) return 0;
  if (isFeedOnlyMode) return 0;
  let score = 0;
  if (topicTitle.trim()) score = 0.08;
  if (queries.length > 0) score = Math.max(score, 0.1);
  if (trendSearchUrls.length > 0) score = Math.max(score, 0.1);
  if (requiredKeywords.length > 0) score = Math.max(score, 0.12);
  return score;
}

function isFeedOnlyTopicTitle(value: string): boolean {
  const normalized = normalizeLooseLabel(value);
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

function normalizeLooseLabel(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function restoreFormFromRequestMeta(requestMeta: CrawlRequestMeta | undefined): CrawlFormState {
  if (!requestMeta) return defaultForm;
  const snapshot = requestMeta.ui_state;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    return {
      ...defaultForm,
      ...coerceFormSnapshot(snapshot),
    };
  }

  const topic = requestMeta.topic;
  const datePreset = inferDatePreset(
    String(requestMeta.date_range.preset || "none"),
    String(requestMeta.date_range.start_date || ""),
    String(requestMeta.date_range.end_date || ""),
  );
  const restoredSearchQueries = (
    topic.search_queries?.length ? topic.search_queries : topic.required_keywords ?? []
  );
  const restoredSeedUrls = topic.seed_post_urls ?? [];
  const restoredTrendUrls = topic.trend_search_urls ?? [];
  const restoredSourceMode = resolveSourceMode(restoredSearchQueries, restoredSeedUrls);
  return {
    ...defaultForm,
    advancedEnabled: hasAdvancedFilters(requestMeta),
    datePreset: datePreset || "none",
    endDate: requestMeta.date_range.end_date || "",
    excludedKeywords: (topic.excluded_keywords ?? []).join("\n"),
    keywords: (topic.keywords ?? []).join("\n"),
    languages: (requestMeta.languages ?? ["vi"]).join("\n"),
    maxTextLength: defaultNumber(defaultForm.maxTextLength, requestMeta.ui_state?.maxTextLength),
    minCommentLikes: 0,
    minLoadedTopComments: 0,
    minPostReposts: 0,
    minPostShares: 0,
    minTextLength: defaultNumber(defaultForm.minTextLength, requestMeta.ui_state?.minTextLength),
    rankingWeightComments: defaultNumber(defaultForm.rankingWeightComments, requestMeta.ranking_weights?.comments),
    rankingWeightLikes: defaultNumber(defaultForm.rankingWeightLikes, requestMeta.ranking_weights?.likes),
    rankingWeightRecency: defaultNumber(defaultForm.rankingWeightRecency, requestMeta.ranking_weights?.recency),
    rankingWeightReposts: defaultNumber(defaultForm.rankingWeightReposts, requestMeta.ranking_weights?.reposts),
    rankingWeightShares: defaultNumber(defaultForm.rankingWeightShares, requestMeta.ranking_weights?.shares),
    rankingWeightTopicMatch: defaultNumber(defaultForm.rankingWeightTopicMatch, requestMeta.ranking_weights?.topic_match),
    rankingWeightViews: defaultNumber(defaultForm.rankingWeightViews, requestMeta.ranking_weights?.views),
    requiredKeywords: (topic.required_keywords ?? []).join("\n"),
    requiredKeywordsMode: topic.required_keywords_mode === "any" ? "any" : "all",
    searchQueries: restoredSearchQueries.join("\n"),
    seedPostUrls: restoredSeedUrls.join("\n"),
    sourceMode: restoredSourceMode,
    sortBy: requestMeta.sort_by || "score",
    startDate: requestMeta.date_range.start_date || "",
    textExcludesAny: (requestMeta.text_excludes_any ?? []).join("\n"),
    excludePostsWithLinks:
      typeof requestMeta.exclude_posts_with_links === "boolean"
        ? requestMeta.exclude_posts_with_links
        : defaultForm.excludePostsWithLinks,
    excludeCommerceContent:
      typeof requestMeta.exclude_commerce_content === "boolean"
        ? requestMeta.exclude_commerce_content
        : defaultForm.excludeCommerceContent,
    topCommentsPerPost: requestMeta.top_comments_per_post || defaultForm.topCommentsPerPost,
    topicTitle: topic.topic_title || "",
    trendSearchUrls: restoredTrendUrls.join("\n"),
    wantedPosts: requestMeta.max_posts_per_topic || defaultForm.wantedPosts,
  };
}

function buildOutputRequestId(
  normalizedTopicTitle: string,
  form: CrawlFormState,
  maxPosts: number,
  topComments: number
): string {
  const topicSlug = slugify(normalizedTopicTitle);
  const datePart = buildDateSegment(form);
  return [
    "threads",
    topicSlug,
    datePart,
    `p${maxPosts}`,
    `c${topComments}`,
    localTimestampForId(),
  ]
    .filter(Boolean)
    .join("-");
}

function buildDateSegment(form: CrawlFormState): string {
  if (form.sourceMode === "seed_only") return "all";
  if (form.datePreset === "today") return "today";
  if (form.datePreset === "last_7_days") return "d7";
  if (form.datePreset === "last_30_days") return "d30";
  if (form.datePreset === "after_date") {
    const start = compactDate(form.startDate);
    if (start) return `after-${start}`;
  }
  if (form.datePreset === "before_date") {
    const end = compactDate(form.endDate);
    if (end) return `before-${end}`;
  }
  if (form.datePreset === "date_range" || form.datePreset === "custom") {
    const start = compactDate(form.startDate);
    const end = compactDate(form.endDate);
    if (start && end) return `${start}-${end}`;
    if (start) return `from-${start}`;
    if (end) return `to-${end}`;
  }
  return "all";
}

function compactDate(value: string): string {
  return String(value || "").trim().replace(/-/g, "");
}

function resolveDateRangeMode(
  preset: string,
): "after_date" | "before_date" | "date_range" | "preset" {
  if (preset === "after_date") return "after_date";
  if (preset === "before_date") return "before_date";
  if (preset === "date_range" || preset === "custom") return "date_range";
  return "preset";
}

function resolveTransportDatePreset(preset: string): string {
  if (preset === "date_range" || preset === "after_date" || preset === "before_date" || preset === "custom") {
    return "";
  }
  return preset;
}

function normalizeDateRangeForPayload(
  form: CrawlFormState,
  mode: "after_date" | "before_date" | "date_range" | "preset",
): { startDate: string; endDate: string } {
  const startDate = String(form.startDate || "").trim();
  const endDate = String(form.endDate || "").trim();
  if (mode === "after_date") {
    return {
      startDate,
      endDate: "",
    };
  }
  if (mode === "before_date") {
    return {
      startDate: "",
      endDate,
    };
  }
  if (mode === "date_range") {
    return {
      startDate,
      endDate,
    };
  }
  return {
    startDate: "",
    endDate: "",
  };
}

function formToSerializableState(form: CrawlFormState): Record<string, unknown> {
  if (form.sourceMode === "seed_only") {
    return { ...form, datePreset: "none", endDate: "", startDate: "" };
  }
  return { ...form };
}

function coerceFormSnapshot(snapshot: Record<string, unknown>): Partial<CrawlFormState> {
  return {
    advancedEnabled: booleanValue(snapshot.advancedEnabled, defaultForm.advancedEnabled),
    cacheTtlMinutes: numberValue(snapshot.cacheTtlMinutes, defaultForm.cacheTtlMinutes),
    category: stringValue(snapshot.category, defaultForm.category),
    commentScrollRounds: numberValue(snapshot.commentScrollRounds, defaultForm.commentScrollRounds),
    configPath: stringValue(snapshot.configPath, defaultForm.configPath),
    datePreset: coerceDatePreset(stringValue(snapshot.datePreset, defaultForm.datePreset)),
    delayMs: numberValue(snapshot.delayMs, defaultForm.delayMs),
    endDate: stringValue(snapshot.endDate, defaultForm.endDate),
    excludeCommerceContent: booleanValue(
      snapshot.excludeCommerceContent,
      defaultForm.excludeCommerceContent
    ),
    excludePostsWithLinks: booleanValue(
      snapshot.excludePostsWithLinks,
      defaultForm.excludePostsWithLinks
    ),
    excludedKeywords: stringValue(snapshot.excludedKeywords, defaultForm.excludedKeywords),
    headless: booleanValue(snapshot.headless, defaultForm.headless),
    includeHomeFeed: booleanValue(snapshot.includeHomeFeed, defaultForm.includeHomeFeed),
    keywords: stringValue(snapshot.keywords, defaultForm.keywords),
    languages: stringValue(snapshot.languages, defaultForm.languages),
    maxCandidateLinks: numberValue(snapshot.maxCandidateLinks, defaultForm.maxCandidateLinks),
    maxCollectedPostsPerTopic: numberValue(snapshot.maxCollectedPostsPerTopic, defaultForm.maxCollectedPostsPerTopic),
    maxSearchQueriesPerTopic: numberValue(snapshot.maxSearchQueriesPerTopic, defaultForm.maxSearchQueriesPerTopic),
    maxTextLength: numberValue(snapshot.maxTextLength, defaultForm.maxTextLength),
    minCommentLikes: numberValue(snapshot.minCommentLikes, defaultForm.minCommentLikes),
    minLoadedTopComments: numberValue(snapshot.minLoadedTopComments, defaultForm.minLoadedTopComments),
    minPostReplies: numberValue(snapshot.minPostReplies, defaultForm.minPostReplies),
    minPostReposts: numberValue(snapshot.minPostReposts, defaultForm.minPostReposts),
    minPostShares: numberValue(snapshot.minPostShares, defaultForm.minPostShares),
    minTextLength: numberValue(snapshot.minTextLength, defaultForm.minTextLength),
    minTopicMatchScore: numberValue(snapshot.minTopicMatchScore, defaultForm.minTopicMatchScore),
    postScrollRounds: numberValue(snapshot.postScrollRounds, defaultForm.postScrollRounds),
    rankingWeightComments: numberValue(snapshot.rankingWeightComments, defaultForm.rankingWeightComments),
    rankingWeightLikes: numberValue(snapshot.rankingWeightLikes, defaultForm.rankingWeightLikes),
    rankingWeightRecency: numberValue(snapshot.rankingWeightRecency, defaultForm.rankingWeightRecency),
    rankingWeightReposts: numberValue(snapshot.rankingWeightReposts, defaultForm.rankingWeightReposts),
    rankingWeightShares: numberValue(snapshot.rankingWeightShares, defaultForm.rankingWeightShares),
    rankingWeightTopicMatch: numberValue(snapshot.rankingWeightTopicMatch, defaultForm.rankingWeightTopicMatch),
    rankingWeightViews: numberValue(snapshot.rankingWeightViews, defaultForm.rankingWeightViews),
    requiredKeywords: stringValue(snapshot.requiredKeywords, defaultForm.requiredKeywords),
    requiredKeywordsMode: snapshot.requiredKeywordsMode === "any" ? "any" : defaultForm.requiredKeywordsMode,
    searchQueries: stringValue(snapshot.searchQueries, defaultForm.searchQueries),
    searchScrollRounds: numberValue(snapshot.searchScrollRounds, defaultForm.searchScrollRounds),
    seedPostUrls: stringValue(snapshot.seedPostUrls, defaultForm.seedPostUrls),
    sourceMode:
      snapshot.sourceMode === "seed_only" || snapshot.sourceMode === "hybrid"
        ? "seed_only"
        : defaultForm.sourceMode,
    sortBy: stringValue(snapshot.sortBy, defaultForm.sortBy),
    startDate: stringValue(snapshot.startDate, defaultForm.startDate),
    textExcludesAny: stringValue(snapshot.textExcludesAny, defaultForm.textExcludesAny),
    timeoutMs: numberValue(snapshot.timeoutMs, defaultForm.timeoutMs),
    topCommentsPerPost: numberValue(snapshot.topCommentsPerPost, defaultForm.topCommentsPerPost),
    topicTitle: stringValue(snapshot.topicTitle, defaultForm.topicTitle),
    trendSearchUrls: stringValue(snapshot.trendSearchUrls, defaultForm.trendSearchUrls),
    useCache: booleanValue(snapshot.useCache, defaultForm.useCache),
    validatePostUrls: booleanValue(snapshot.validatePostUrls, defaultForm.validatePostUrls),
    wantedPosts: numberValue(snapshot.wantedPosts, defaultForm.wantedPosts),
  };
}

function hasAdvancedFilters(requestMeta: CrawlRequestMeta): boolean {
  return Boolean(
    requestMeta.topic.required_keywords.length > 0
  );
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function defaultNumber(fallback: number, value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inferDatePreset(preset: string, startDate: string, endDate: string): string {
  const normalizedPreset = coerceDatePreset(preset);
  if (normalizedPreset !== "custom" && normalizedPreset !== "none") {
    return normalizedPreset;
  }
  const hasStart = Boolean(startDate.trim());
  const hasEnd = Boolean(endDate.trim());
  if (hasStart && hasEnd) return "date_range";
  if (hasStart) return "after_date";
  if (hasEnd) return "before_date";
  return normalizedPreset === "custom" ? "date_range" : "none";
}

function coerceDatePreset(value: string): string {
  if (
    value === "none" ||
    value === "today" ||
    value === "last_7_days" ||
    value === "last_30_days" ||
    value === "after_date" ||
    value === "before_date" ||
    value === "date_range"
  ) {
    return value;
  }
  if (value === "custom") return "date_range";
  return defaultForm.datePreset;
}

export function resolveRuntimeProfile(
  form: CrawlFormState,
  options: {
    feedOnlyMode?: boolean;
    profileSeedCount?: number;
    queryCount: number;
    seedUrlCount?: number;
    trendUrlCount?: number;
  }
): RuntimeProfile {
  const feedOnlyMode = Boolean(options.feedOnlyMode);
  const trendUrlCount = Math.max(0, Math.trunc(options.trendUrlCount || 0));
  const queryCount = options.queryCount + trendUrlCount;
  const seedUrlCount = Math.max(0, Math.trunc(options.seedUrlCount || 0));
  const seedOnlyMode = form.sourceMode === "seed_only";
  const hasProfileSeed = Math.max(0, Math.trunc(options.profileSeedCount || 0)) > 0;
  const maxPosts = Math.max(1, Math.trunc(form.wantedPosts));
  const implicitViralBudget = resolveImplicitViralRuntimeBudget(maxPosts);
  const smallRunMode = maxPosts <= 3;
  const hasImplicitViralWindow = feedOnlyMode && form.datePreset === "none";
  const datedFeedWindow = feedOnlyMode && form.datePreset !== "none";
  const hasDateFilter =
    hasImplicitViralWindow ||
    form.datePreset === "today" ||
    form.datePreset === "last_7_days" ||
    form.datePreset === "last_30_days" ||
    ((form.datePreset === "after_date" ||
      form.datePreset === "before_date" ||
      form.datePreset === "date_range" ||
      form.datePreset === "custom") &&
      (form.startDate.trim() || form.endDate.trim()));
  const queryLimit = Math.max(1, queryCount || 1);
  if (seedOnlyMode) {
    const seededCandidateCount = hasProfileSeed
      ? Math.max(maxPosts, seedUrlCount || maxPosts)
      : Math.max(1, seedUrlCount || 1);
    return {
      crawlAssets: true,
      cacheTtlMinutes: form.useCache ? Math.max(1, Math.trunc(form.cacheTtlMinutes)) : 0,
      commentScrollRounds: 1,
      delayMs: 150,
      deepViralCompare: false,
      downloadAvatars: true,
      downloadAssets: true,
      homeScrollRounds: 0,
      includeCommentAssets: true,
      includeHomeFeed: false,
      maxCandidateLinks: seededCandidateCount,
      maxCollectedPostsPerTopic: seededCandidateCount,
      maxDetailRequests: seededCandidateCount,
      maxCommentScanPosts: seededCandidateCount,
      maxAssetDownloadPosts: seededCandidateCount,
      maxConcurrency: 2,
      maxMediaPerComment: 6,
      maxMediaPerPost: 4,
      maxSearchQueriesPerTopic: 0,
      postScrollRounds: 0,
      searchScrollRounds: hasProfileSeed ? Math.min(12, Math.max(3, Math.ceil(maxPosts / 2) + 2)) : 0,
      timeoutMs: 10_000,
      validatePostUrls: true,
    };
  }
  const searchQueryLimit = smallRunMode
    ? Math.min(hasDateFilter ? 4 : 3, Math.max(1, queryLimit))
    : Math.min(10, Math.max(2, queryLimit + 2, Math.ceil(maxPosts / 2) + 2));
  const searchScrollRounds = feedOnlyMode
    ? 0
    : smallRunMode
    ? hasDateFilter
      ? 2
      : 1
    : Math.min(5, Math.max(3, Math.ceil(maxPosts / 4) + 2));
  const homeScrollRounds = hasImplicitViralWindow
    ? Math.min(22, Math.max(18, Math.ceil(maxPosts * 1.2) + 12))
    : datedFeedWindow
      ? form.datePreset === "last_30_days"
        ? 18
        : form.datePreset === "today"
          ? 8
          : 12
      : smallRunMode
        ? 2
        : Math.min(10, Math.max(4, Math.ceil(maxPosts / 2) + 2));
  const maxCandidateLinks = hasImplicitViralWindow
    ? implicitViralBudget.maxCandidateLinks
    : datedFeedWindow
      ? form.datePreset === "last_30_days"
        ? Math.min(110, Math.max(maxPosts * 16, maxPosts + 45, 72))
        : Math.min(90, Math.max(maxPosts * 12, maxPosts + 30, 54))
      : smallRunMode
        ? hasDateFilter
          ? 14
          : 8
        : Math.min(80, Math.max(maxPosts * 10, 40));
  const maxCollectedPostsPerTopic = Math.min(
    maxCandidateLinks,
    hasImplicitViralWindow
      ? implicitViralBudget.maxCollectedPostsPerTopic
      : datedFeedWindow
        ? form.datePreset === "last_30_days"
          ? Math.max(maxPosts * 8, maxPosts + 28, 40)
          : Math.max(maxPosts * 6, maxPosts + 18, 30)
        : smallRunMode
          ? maxPosts + 3
          : Math.max(maxPosts * 3, maxPosts + 4, 12),
  );
  return {
    crawlAssets: true,
    cacheTtlMinutes: form.useCache ? Math.max(1, Math.trunc(form.cacheTtlMinutes)) : 0,
    commentScrollRounds: feedOnlyMode ? 3 : 2,
    delayMs: 150,
    deepViralCompare: true,
    downloadAvatars: true,
    downloadAssets: true,
    homeScrollRounds: Math.max(1, homeScrollRounds),
    includeCommentAssets: true,
    includeHomeFeed: feedOnlyMode || form.includeHomeFeed,
    maxCandidateLinks: Math.max(maxPosts, maxCandidateLinks),
    maxCollectedPostsPerTopic: Math.max(maxPosts, maxCollectedPostsPerTopic),
    maxDetailRequests: feedOnlyMode
      ? hasImplicitViralWindow
        ? implicitViralBudget.maxDetailRequests
        : Math.max(Math.ceil(maxPosts * 2.4), maxPosts + 6, 10)
      : Math.max(maxPosts * 2, maxPosts + 4),
    maxCommentScanPosts: feedOnlyMode
      ? hasImplicitViralWindow
        ? implicitViralBudget.maxCommentScanPosts
        : Math.max(maxPosts + 2, Math.ceil(maxPosts * 1.4))
      : Math.max(maxPosts + 2, Math.ceil(maxPosts * 1.35)),
    maxAssetDownloadPosts: maxPosts,
    // Larger Viral feed targets use one extra browser page to reduce wall-clock
    // time without increasing per-request retries or lowering quality gates.
    maxConcurrency: hasImplicitViralWindow && maxPosts >= 5 ? 3 : 2,
    maxMediaPerComment: 6,
    maxMediaPerPost: 4,
    maxSearchQueriesPerTopic: feedOnlyMode ? 0 : searchQueryLimit,
    postScrollRounds: 0,
    searchScrollRounds: feedOnlyMode ? 0 : Math.max(2, searchScrollRounds),
    timeoutMs: 10_000,
    validatePostUrls: true,
  };
}

function resolveSourceMode(_searchQueries: string[], seedPostUrls: string[]): CrawlFormState["sourceMode"] {
  const hasSeedUrls = seedPostUrls.length > 0;
  if (hasSeedUrls) return "seed_only";
  return "discover";
}
