import type { CrawlFilters, RawComment, RawPost, TopicFilter } from "../types.js";
import { buildPublishTimeMetadata, resolveRequestedDateRange } from "../utils/date-range.js";
import { containsKeyword, isLikelyVietnameseText } from "../utils/text.js";

export interface PostFilterAnalysis {
  date_key: string;
  date_filter_end: string;
  date_filter_start: string;
  date_filter_timezone: string;
  matched_excluded_keyword_sources: Array<{ keyword: string; source: "global" | "request" | "topic" }>;
  matched_excluded_keywords: string[];
  matched_link_patterns: string[];
  matched_required_keywords: string[];
  missing_required_keywords: string[];
  reason: string;
  required_keywords_mode: "all" | "any";
}

export function analyzePostFilters(
  post: RawPost,
  topic: TopicFilter,
  filters: CrawlFilters,
  score: number,
  referenceTime = "",
  options: { skipLanguageGate?: boolean } = {},
): PostFilterAnalysis {
  const publishTime = buildPublishTimeMetadata({
    createdAt: post.created_at,
    dateRange: filters.date_range,
    referenceTime,
    source: String(post.created_at_source ?? ""),
  });
  const postDate = publishTime.date_key;
  const { startDate, endDate, hasDateFilter } = resolveDateRange(filters, referenceTime);
  const text = String(post.text ?? "");
  const requiredMatch = requiredKeywordMatch(text, topic);
  const matchedExcludedSources: Array<{ keyword: string; source: "global" | "request" | "topic" }> = [];
  const matchedLinkPatterns: string[] = [];
  const dateContext = { dateKey: postDate, endDate, startDate, timezone: publishTime.timezone };

  if (hasDateFilter && !postDate) return filterResult("missing_created_at", requiredMatch, matchedExcludedSources, [], dateContext);
  if (startDate && postDate && postDate < startDate) return filterResult("date_before_start", requiredMatch, matchedExcludedSources, [], dateContext);
  if (endDate && postDate && postDate > endDate) return filterResult("date_after_end", requiredMatch, matchedExcludedSources, [], dateContext);

  const username = String(post.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (filters.include_usernames.length > 0 && !filters.include_usernames.includes(username)) {
    return filterResult("username_not_in_include_list", requiredMatch, matchedExcludedSources);
  }
  if (filters.exclude_usernames.includes(username)) return filterResult("username_excluded", requiredMatch, matchedExcludedSources);

  if (!options.skipLanguageGate) {
    const language = String(post.language ?? "").trim().toLowerCase();
    const allowedLanguages = new Set(filters.languages.map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (allowedLanguages.size > 0) {
      if (!language || language === "unknown") {
        const likelyVietnamese = allowedLanguages.has("vi") && isLikelyVietnameseText(text);
        if (!likelyVietnamese) return filterResult("language_missing", requiredMatch, matchedExcludedSources);
      }
      if (!allowedLanguages.has(language)) return filterResult("language_not_allowed", requiredMatch, matchedExcludedSources);
    }
  }

  const textLength = text.trim().length;
  if (filters.min_text_length && textLength < filters.min_text_length) return filterResult("text_too_short", requiredMatch, matchedExcludedSources);
  if (filters.max_text_length && textLength > filters.max_text_length) return filterResult("text_too_long", requiredMatch, matchedExcludedSources);

  if (requiredMatch.reason) {
    return filterResult(requiredMatch.reason, requiredMatch, matchedExcludedSources);
  }

  collectExcludedKeywordMatches(matchedExcludedSources, filters.global_excluded_keywords, "global", text);
  collectExcludedKeywordMatches(matchedExcludedSources, filters.text_excludes_any, "request", text);
  collectExcludedKeywordMatches(matchedExcludedSources, topic.excluded_keywords, "topic", text);
  if (matchedExcludedSources.length > 0) {
    return filterResult("excluded_keyword_matched", requiredMatch, matchedExcludedSources);
  }

  if (filters.text_contains_any.length > 0 && !containsAnyKeyword(text, filters.text_contains_any)) {
    return filterResult("global_contains_any_not_matched", requiredMatch, matchedExcludedSources);
  }
  if (filters.text_contains_all.length > 0 && !containsAllKeywords(text, filters.text_contains_all)) {
    return filterResult("global_contains_all_missing", requiredMatch, matchedExcludedSources);
  }
  if (filters.exclude_posts_with_links) {
    matchedLinkPatterns.push(...findExternalLinkPatterns(text));
    if (matchedLinkPatterns.length > 0) {
      return filterResult("post_has_link", requiredMatch, matchedExcludedSources, matchedLinkPatterns);
    }
  }
  if (filters.exclude_commerce_content) {
    const commerceSignals = detectCommerceSignals(text);
    if (commerceSignals.length > 0) {
      return filterResult("commerce_content_detected", requiredMatch, matchedExcludedSources, commerceSignals);
    }
  }

  const likeCount = numberValue(post.like_count);
  const viewCount = numberValue(post.view_count);
  const replyCount = numberValue(post.reply_count);
  const repostCount = numberValue(post.repost_count);
  const quoteCount = numberValue(post.quote_count);
  const shareCount = numberValue(post.share_count);
  const loadedCommentCount = Array.isArray(post.comments) ? post.comments.length : 0;
  const commentCount = Math.max(replyCount, loadedCommentCount);

  if (filters.require_comments && commentCount === 0) return filterResult("comments_required", requiredMatch, matchedExcludedSources);
  if (filters.min_comments && commentCount < filters.min_comments) return filterResult("not_enough_comments", requiredMatch, matchedExcludedSources);
  if (filters.require_metrics && likeCount + replyCount + repostCount + quoteCount + shareCount <= 0) {
    return filterResult("metrics_required", requiredMatch, matchedExcludedSources);
  }
  if (likeCount < filters.min_post_likes) return filterResult("not_enough_likes", requiredMatch, matchedExcludedSources);
  if (viewCount < filters.min_post_views) return filterResult("not_enough_views", requiredMatch, matchedExcludedSources);
  if (replyCount < filters.min_post_replies) return filterResult("not_enough_replies", requiredMatch, matchedExcludedSources);
  if (repostCount < filters.min_post_reposts) return filterResult("not_enough_reposts", requiredMatch, matchedExcludedSources);
  if (shareCount < filters.min_post_shares) return filterResult("not_enough_shares", requiredMatch, matchedExcludedSources);
  if (filters.require_repost_or_share && repostCount + shareCount <= 0) {
    return filterResult("missing_repost_or_share", requiredMatch, matchedExcludedSources);
  }
  if (score < filters.min_post_score) return filterResult("score_below_minimum", requiredMatch, matchedExcludedSources);
  return filterResult("", requiredMatch, matchedExcludedSources, [], dateContext);
}

export function postFilterRejectionReason(
  post: RawPost,
  topic: TopicFilter,
  filters: CrawlFilters,
  score: number,
  referenceTime = "",
): string {
  return analyzePostFilters(post, topic, filters, score, referenceTime).reason;
}

export function commentFilterRejectionReason(comment: RawComment, filters: CrawlFilters): string {
  const text = String(comment.text ?? "").trim();
  if (textHasExternalLink(text)) {
    return "comment_has_link";
  }
  const allowedLanguages = new Set(filters.languages.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const language = String(comment.language ?? "").trim().toLowerCase();
  if (allowedLanguages.size > 0) {
    if (!language || language === "unknown") return "";
    if (!allowedLanguages.has(language)) return "comment_language_not_allowed";
  }
  if (numberValue(comment.like_count) < filters.min_comment_likes) return "comment_not_enough_likes";
  if (text.length < 3) return "comment_text_too_short";
  return "";
}

function filterResult(
  reason: string,
  requiredMatch: {
    matched_required_keywords: string[];
    missing_required_keywords: string[];
    required_keywords_mode: "all" | "any";
  },
  matchedExcludedSources: Array<{ keyword: string; source: "global" | "request" | "topic" }>,
  matchedLinkPatterns: string[] = [],
  dateContext: { dateKey?: string; endDate?: string; startDate?: string; timezone?: string } = {},
): PostFilterAnalysis {
  return {
    date_key: String(dateContext.dateKey ?? ""),
    date_filter_end: String(dateContext.endDate ?? ""),
    date_filter_start: String(dateContext.startDate ?? ""),
    date_filter_timezone: String(dateContext.timezone ?? ""),
    matched_excluded_keyword_sources: matchedExcludedSources,
    matched_excluded_keywords: matchedExcludedSources.map((item) => item.keyword),
    matched_link_patterns: matchedLinkPatterns,
    matched_required_keywords: requiredMatch.matched_required_keywords,
    missing_required_keywords: requiredMatch.missing_required_keywords,
    reason,
    required_keywords_mode: requiredMatch.required_keywords_mode,
  };
}

function requiredKeywordMatch(
  text: string,
  topic: TopicFilter,
): {
  matched_required_keywords: string[];
  missing_required_keywords: string[];
  reason: string;
  required_keywords_mode: "all" | "any";
} {
  const requiredKeywords = topic.required_keywords.map((item) => item.trim()).filter(Boolean);
  const matched = requiredKeywords.filter((keyword) => containsKeyword(text, keyword));
  const missing = requiredKeywords.filter(
    (keyword) => !matched.some((matchedKeyword) => matchedKeyword.toLowerCase() === keyword.toLowerCase())
  );
  if (requiredKeywords.length === 0) {
    return {
      matched_required_keywords: [],
      missing_required_keywords: [],
      reason: "",
      required_keywords_mode: topic.required_keywords_mode,
    };
  }

  if (topic.required_keywords_mode === "any") {
    return {
      matched_required_keywords: matched,
      missing_required_keywords: missing,
      reason: matched.length > 0 ? "" : "required_keywords_any_not_matched",
      required_keywords_mode: "any",
    };
  }

  return {
    matched_required_keywords: matched,
    missing_required_keywords: missing,
    reason: missing.length === 0 ? "" : "required_keywords_all_not_matched",
    required_keywords_mode: "all",
  };
}

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => containsKeyword(text, keyword));
}

function containsAllKeywords(text: string, keywords: string[]): boolean {
  return keywords.every((keyword) => containsKeyword(text, keyword));
}

function collectExcludedKeywordMatches(
  target: Array<{ keyword: string; source: "global" | "request" | "topic" }>,
  keywords: string[],
  source: "global" | "request" | "topic",
  text: string,
): void {
  for (const keyword of keywords.map((item) => item.trim()).filter(Boolean)) {
    if (!containsKeyword(text, keyword)) continue;
    target.push({ keyword, source });
  }
}

function findExternalLinkPatterns(text: string): string[] {
  if (!text) return [];
  const matches: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/https?:\/\/\S+/iu, "http_url"],
    [/(^|\s)www\.[^\s]+/iu, "www_url"],
    [/(^|\s)(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/iu, "domain_like"],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) matches.push(label);
  }
  return matches;
}

function detectCommerceSignals(text: string): string[] {
  if (!text) return [];
  const signals = [
    "shopee",
    "tiktok shop",
    "link bio",
    "link shop",
    "freeship",
    "free ship",
    "affiliate",
    "mua ngay",
    "dat hang",
    "dat hang online",
    "đặt hàng",
    "order",
    "sale",
    "sale off",
    "voucher",
    "ma giam gia",
    "mã giảm giá",
    "gia tot",
    "giá tốt",
    "gia re",
    "giá rẻ",
    "pass nhanh",
    "ib mua",
    "inbox mua",
    "zalo",
    "sdt",
    "số điện thoại",
    "tu van",
    "tư vấn",
    "rcm",
    "recommend",
    "de xuat",
    "xin de xuat",
    "cho minh hoi",
    "xin y kien",
    "minh dang tim",
    "t dang tim",
    "tim shop",
    "shop hoa",
    "shop",
    "khong co don",
    "không có đơn",
    "san pham",
    "sản phẩm",
    "don hang",
    "đơn hàng",
    "chot don",
    "chốt đơn",
    "khach hang",
    "khách hàng",
    "scam",
    "target",
    "o dau ngon",
    "quan nao",
    "co quan",
    "quan chuyen",
    "dia diem",
    "co ai tung",
    "xin review",
    "review giup",
    "oke k",
    "on khong",
    "co nen",
    "mua o dau",
    "mua ở đâu",
    "xin link",
    "cho xin link",
    "apply",
    "ung tuyen",
    "ứng tuyển",
    "tuyen dung",
    "tuyển dụng",
    "can yeu cau",
    "cần yêu cầu",
  ];
  return signals.filter((signal) => containsKeyword(text, signal));
}

function resolveDateRange(filters: CrawlFilters, referenceTime = ""): {
  startDate?: string;
  endDate?: string;
  hasDateFilter: boolean;
} {
  return resolveRequestedDateRange({
    endValue: filters.date_range.end_date,
    presetValue: filters.date_range.preset,
    referenceTime,
    startValue: filters.date_range.start_date,
    timezone: filters.date_range.timezone,
  });
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textHasExternalLink(text: string): boolean {
  if (!text) return false;
  const patterns = [
    /https?:\/\/\S+/iu,
    /(^|\s)www\.[^\s]+/iu,
    /(^|\s)(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/iu,
  ];
  return patterns.some((pattern) => pattern.test(text));
}
