import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { Configuration, PlaywrightCrawler, type RequestOptions } from "crawlee";
import type { Page } from "playwright";
import type {
  CollectorStats,
  CrawlRequest,
  CrawlProgressSnapshot,
  MediaAsset,
  RawComment,
  RawPost,
  TopicFilter,
} from "../types.js";
import { ensureChromiumLaunchHealthy } from "../browser-launch.js";
import {
  buildCommentScanProfile,
  buildCommentTopFrontier,
  commentCandidateRank,
  sourceOrderedCommentAssetIndexes,
} from "./threads-comment-scan.js";
import { buildThreadsQueries } from "./threads-query-builder.js";
import { nowIso } from "../types.js";
import {
  evaluateRawPostForOutput,
  resolveAcceptedPostSelectionStrategy,
  selectAcceptedPostResults,
  STRICT_BLANK_VIRAL_MIN_SCORE,
} from "../selection/post-evaluation.js";
import { buildPostMetricPeaks } from "../ranking/viral-score.js";
import { createAuthApplicator } from "./threads-auth.js";
import {
  collectListingCandidates,
  dismissOverlays,
  ensureTopCommentsSort,
  extractActivityMetrics,
  goto,
  scroll,
  type ThreadsListingUserData,
} from "./threads-browser.js";
import {
  cacheHasCurrentExtraction,
  cacheHasFullExtraction,
  cacheHasRequestedCommentCount,
  cleanCachedAssetPaths,
  isUsableCachedPost,
  loadPostCache,
  savePostCache,
  THREADS_EXTRACTION_VERSION,
} from "./threads-cache.js";
import {
  assetJsonPath,
  detectAssetDimensions,
  extensionForAsset,
  isLikelyVideoPosterUrl,
  mediaAssetIdentityKey,
  normalizePostMedia,
  normalizeRawMedia,
  normalizeRemoteAssetUrl,
  safePathSegment,
} from "./threads-media.js";
import {
  dedupeUrlList,
  isStrictBlankViralTopic,
  resolveDiscoveryStrategy,
  selectFinalPostsForOutput,
  selectPostsForDetail,
  uniqueRawPosts,
} from "./threads-post-selection.js";
import {
  cacheKey,
  expandSeedTargetUrls,
  extractPostUrls,
  matchPostUrl,
  matchShareUrl,
  normalizePostUrl,
  normalizeThreadsNavigationUrl,
  normalizeThreadsUrl,
  postUrlVariants,
  uniqueCandidates,
} from "./threads-url.js";
import { parseCreatedAtDateKey } from "../utils/date-range.js";
import {
  asStringList,
  cleanPostText,
  extractDisplayName,
  extractFormattedPostTextFromArticle,
  extractInitialPostText,
  extractPostText,
  extractPostMetrics,
  guessLanguage,
  isRecord,
  isValidPostText,
  looksLikeThreadsPageShell,
  metricNumber,
  pageIsUnavailable,
  parseDateKey,
  parseCommentBlocks,
  resolvePostMetrics,
  restorePostIntroFromActivityTexts,
  skipReasonBeforeDeepExtraction,
} from "./threads-parsing.js";
import {
  attachCrawlerAbort,
  isAbortRequested,
  throwIfAbortRequested,
  waitForDelay,
} from "./threads-runtime.js";

const DEFAULT_MAX_MEDIA_PER_COMMENT = 6;

export function limitCommentMedia(
  value: unknown,
  maxMediaPerComment = DEFAULT_MAX_MEDIA_PER_COMMENT,
): MediaAsset[] {
  const limit = Number.isFinite(maxMediaPerComment)
    ? Math.max(0, Math.trunc(maxMediaPerComment))
    : DEFAULT_MAX_MEDIA_PER_COMMENT;
  return normalizeRawMedia(value).slice(0, limit);
}

export interface ThreadsWebCollectorConfig {
  baseUrl: string;
  headless: boolean;
  searchScrollRounds: number;
  homeScrollRounds: number;
  postScrollRounds: number;
  commentScrollRounds: number;
  delayMs: number;
  maxCandidateLinks: number;
  maxCollectedPostsPerTopic: number;
  maxDetailRequests: number;
  maxCommentScanPosts: number;
  maxAssetDownloadPosts: number;
  targetOutputPosts: number;
  topCommentsPerPost: number;
  timeoutMs: number;
  authStatePath: string;
  browserChannel: string;
  executablePath: string;
  maxSearchQueriesPerTopic: number;
  cachePath: string;
  cacheTtlMinutes: number;
  assetDir: string;
  assetPathPrefix: string;
  crawlAssets: boolean;
  downloadAvatars: boolean;
  downloadAssets: boolean;
  includeCommentAssets: boolean;
  maxMediaPerPost: number;
  maxMediaPerComment: number;
  validatePostUrls: boolean;
  includeHomeFeed: boolean;
  maxConcurrency: number;
  onProgress?: (progress: Partial<CrawlProgressSnapshot>) => void;
  sortBy: string;
  summaryFirst: boolean;
  allowedLanguages: string[];
  dateStart: string;
  dateEnd: string;
  dateTimezone?: string;
  dateQueryWindows: Array<{ startDate: string; endDate: string }>;
  selectionRequest?: CrawlRequest;
  signal?: AbortSignal;
}

type ListingSource = "home_feed" | "profile" | "search" | "trend_search";
type RequestUserData =
  | {
      kind: "listing";
      matchedQuery: string;
      source: ListingSource;
      windowEndDate?: string;
      windowStartDate?: string;
    }
  | {
      kind: "post";
      matchedQuery: string;
      source: "seed_post_urls" | ListingSource;
      windowEndDate?: string;
      windowStartDate?: string;
    };

type PostCache = Record<string, RawPost>;
type Candidate = {
  url: string;
  matchedQuery: string;
  source: "seed_post_urls" | ListingSource;
  windowEndDate?: string;
  windowStartDate?: string;
};
type SearchQueryPlan = {
  query: string;
  windowEndDate?: string;
  windowStartDate?: string;
};
type CommentBlock = {
  username: string;
  text: string;
  href: string;
  metricTexts: string[];
  likeCount?: number;
  replyCount?: number;
  isReply?: boolean;
  isRootPost?: boolean;
  isBeforeCommentSection?: boolean;
  top?: number;
  commentSectionTop?: number | null;
  avatarUrl?: string;
  media?: MediaAsset[];
};
type CommentScrollState = {
  bottomGap: number;
  innerHeight: number;
  scrollHeight: number;
  scrollY: number;
};
type PostMeta = {
  title: string;
  ogTitle: string;
  ogDescription: string;
  ogType: string;
  canonical: string;
  articlePostUrl: string;
  bodyText: string;
  articleText: string;
  metricTexts: string[];
  authorAvatarUrl: string;
  hasVideoCandidate: boolean;
  media: MediaAsset[];
  createdAt: string;
  finalUrl: string;
  contextRootUrl?: string;
};

class ThreadsSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadsSearchUnavailableError";
  }
}

const createLocalCrawleeConfig = (): Configuration =>
  new Configuration({
    // Crawlee's legacy system-info path uses @apify/ps-tree, which invokes
    // WMIC on Windows. WMIC is removed from Windows 11 24H2+, so use the
    // PowerShell/CIM-based implementation instead.
    systemInfoV2: true,
  });

const POST_META_SCRIPT = `(() => {
  const getMeta = (selector) => document.querySelector(selector)?.getAttribute("content") || "";
  return {
    title: document.title || "",
    ogTitle: getMeta('meta[property="og:title"]'),
    ogDescription: getMeta('meta[property="og:description"]'),
    ogType: getMeta('meta[property="og:type"]'),
    canonical: document.querySelector('link[rel="canonical"]')?.href || location.href,
    articlePostUrl: articlePermalink(),
    bodyText: document.body?.innerText || "",
    articleText: articleText(),
    metricTexts: metricTexts(),
    authorAvatarUrl: avatarUrl(articleRoot()),
    hasVideoCandidate: hasVideoCandidate(articleRoot()),
    media: mediaItems(articleRoot()),
    createdAt: document.querySelector("time[datetime]")?.getAttribute("datetime") || "",
    finalUrl: location.href,
    contextRootUrl: contextRootPostUrl()
  };

  function articleRoot() {
    const time = document.querySelector("time[datetime]");
    let node = time;
    let best = null;
    for (let depth = 0; depth < 12 && node; depth += 1) {
      const text = (node.innerText || "").trim();
      if (text.length >= 40 && text.length <= 9000) best = node;
      const role = node.getAttribute("role") || "";
      if (node.tagName === "ARTICLE" || role.toLowerCase() === "article") return node;
      node = node.parentElement;
    }
    return best || document.body;
  }

  function articleText() {
    return (articleRoot()?.innerText || "").trim();
  }

  function articlePermalink() {
    const root = articleRoot();
    const anchors = Array.from(
      (root || document).querySelectorAll('a[href*="/post/"]')
    );
    for (const anchor of anchors) {
      const href = anchor.href || anchor.getAttribute("href") || "";
      try {
        const parsed = new URL(href, location.href);
        const hostname = parsed.hostname.toLowerCase();
        const isThreadsHost =
          hostname === "threads.com" ||
          hostname.endsWith(".threads.com") ||
          hostname === "threads.net" ||
          hostname.endsWith(".threads.net");
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (isThreadsHost && parts[0]?.startsWith("@") && parts[1] === "post" && parts[2]) {
          return parsed.href;
        }
      } catch {}
    }
    return "";
  }

  function contextRootPostUrl() {
    const sectionTop = resolveCommentSectionTop();
    if (!Number.isFinite(sectionTop)) return "";
    const currentPostId =
      extractPostId(location.href) ||
      extractPostId(document.querySelector('link[rel="canonical"]')?.href || "");
    if (!currentPostId) return "";

    const postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]'))
      .map((anchor) => {
        const href = anchor.href || "";
        const postId = extractPostId(href);
        const rect = anchor.getBoundingClientRect();
        return {
          href,
          postId,
          top: rect.top || 0,
          bottom: rect.bottom || 0,
          area: (rect.width || 0) * (rect.height || 0)
        };
      })
      .filter((item) =>
        item.href &&
        item.postId &&
        item.area > 0 &&
        item.top < sectionTop - 12 &&
        item.bottom > -600
      )
      .sort((a, b) => a.top - b.top);

    const uniqueLinks = [];
    const seen = new Set();
    for (const item of postLinks) {
      if (seen.has(item.postId)) continue;
      seen.add(item.postId);
      uniqueLinks.push(item);
    }

    if (uniqueLinks.length < 2) return "";
    const root = uniqueLinks[0];
    const focused = uniqueLinks.find((item) => item.postId === currentPostId);
    if (!root || !focused || root.postId === currentPostId) return "";
    return root.top <= focused.top - 18 ? root.href : "";
  }

  function resolveCommentSectionTop() {
    const candidates = Array.from(document.querySelectorAll("span, div, button, [role='button']"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = cleanLine(node.innerText || node.textContent || "");
        return { rect, text };
      })
      .filter((item) =>
        item.text &&
        item.text.length <= 180 &&
        item.rect.width > 0 &&
        item.rect.height > 0 &&
        isCommentSectionMarker(item.text)
      )
      .sort((a, b) => a.rect.top - b.rect.top);
    return candidates[0]?.rect.top ?? Number.NaN;
  }

  function isCommentSectionMarker(value) {
    const folded = cleanLine(value).toLowerCase();
    return (
      /^(?:↕\\s*)?(?:hàng đầu|hang dau|top)\\b/.test(folded) ||
      /^sắp xếp\\s*(?:hàng đầu|top)?/i.test(folded) ||
      /^sap xep\\s*(?:hang dau|top)?/i.test(folded) ||
      /^xem hoạt động\\b/.test(folded) ||
      /^xem hoat dong\\b/.test(folded) ||
      /^view activity\\b/.test(folded)
    );
  }

  function extractPostId(url) {
    const match = String(url || "").match(/\\/@[^/?#]+\\/post\\/([A-Za-z0-9_-]+)/);
    return match?.[1] || "";
  }

  function metricTexts() {
    const root = articleRoot() || document.body;
    return Array.from(root.querySelectorAll("[aria-label], [title], button, [role='button']"))
      .slice(0, 220)
      .map((node) => [
        node.getAttribute("aria-label") || "",
        node.getAttribute("title") || "",
        node.textContent || ""
      ].join(" ").replace(/\\s+/g, " ").trim())
      .filter(Boolean);
  }

  function avatarUrl(root) {
    const candidates = Array.from((root || document.body).querySelectorAll("img"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const src = imageSource(node, true);
        return {
          area: rect.width * rect.height,
          src,
          width: rect.width || node.naturalWidth || 0,
          height: rect.height || node.naturalHeight || 0
        };
      })
      .filter((item) => item.src && item.width >= 24 && item.height >= 24 && item.width <= 120 && item.height <= 120)
      .sort((a, b) => b.area - a.area);
    return candidates[0]?.src || "";
  }

  function mediaItems(root) {
    const candidates = [];
    const seen = new Set();
    for (const [index, node] of Array.from((root || document.body).querySelectorAll("img, video")).entries()) {
      const rect = node.getBoundingClientRect();
      const renderedWidth = Math.round(rect.width || 0);
      const renderedHeight = Math.round(rect.height || 0);
      const width = Math.round(node.naturalWidth || node.videoWidth || renderedWidth || 0);
      const height = Math.round(node.naturalHeight || node.videoHeight || renderedHeight || 0);
      if (width < 120 || height < 120) continue;
      const type = node.tagName.toLowerCase() === "video" ? "video" : "image";
      const src = type === "video" ? videoSource(node) : imageSource(node);
      if (isLikelyAvatarMedia(node, src, renderedWidth, renderedHeight, width, height)) continue;
      const identity = mediaIdentityKey(src);
      if (!src || seen.has(identity)) continue;
      seen.add(identity);
      candidates.push({
        type,
        remote_url: src,
        asset_path: "",
        width,
        height,
        index,
        left: Math.round(rect.left || 0),
        top: Math.round(rect.top || 0)
      });
    }
    candidates.sort((a, b) => {
      if (Math.abs(a.top - b.top) <= 24) {
        return a.left - b.left || a.index - b.index;
      }
      return a.top - b.top || a.left - b.left || a.index - b.index;
    });
    return candidates.slice(0, 12).map(({ index, left, top, ...item }, order) => ({
      ...item,
      order: order + 1
    }));
  }

  function hasVideoCandidate(root) {
    const scope = root || document.body;
    if (scope.querySelector("video")) return true;

    // Threads can initially render only a poster image. The play/mute control
    // remains in the card, so keep polling for the actual video source.
    const videoControlPattern = /(?:play(?:\\s+video)?|video|mute|unmute|sound\\s*(?:on|off)|am thanh|bat am thanh|tat am thanh)/i;
    return Array.from(scope.querySelectorAll("button, [role='button'], [aria-label], [title]"))
      .some((node) => {
        const label = [
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || "",
          node.textContent || ""
        ].join(" ").replace(/\\s+/g, " ").trim();
        return videoControlPattern.test(label);
      });
  }

  function mediaIdentityKey(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text, location.href);
      const cacheKey = String(url.searchParams.get("ig_cache_key") || "").trim();
      return [
        url.hostname.toLowerCase(),
        url.pathname,
        cacheKey ? "ig_cache_key=" + cacheKey : ""
      ].join("|");
    } catch {
      return text;
    }
  }

  function imageSource(node, preserveProfileParams = false) {
    const candidates = [
      largestSrcsetUrl(node.getAttribute("srcset") || ""),
      largestSrcsetUrl(node.parentElement?.querySelector("source")?.getAttribute("srcset") || ""),
      node.getAttribute("data-src") || "",
      node.currentSrc || "",
      node.src || "",
      node.getAttribute("src") || "",
    ].map((value) => normalizeMediaUrl(value, "image", preserveProfileParams)).filter(Boolean);
    return candidates[0] || "";
  }

  function videoSource(node) {
    const sourceNode = node.querySelector("source");
    const candidates = [
      sourceNode?.src || "",
      largestSrcsetUrl(sourceNode?.getAttribute("srcset") || ""),
      node.currentSrc || "",
      node.src || "",
    ].map((value) => normalizeMediaUrl(value, node.tagName.toLowerCase() === "video" ? "video" : "image")).filter(Boolean);
    return candidates[0] || "";
  }

  function largestSrcsetUrl(value) {
    const entries = String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const pieces = part.split(/\\s+/).filter(Boolean);
        const url = pieces[0] || "";
        const descriptor = pieces[1] || "";
        const width = /^(\\d+)w$/i.test(descriptor) ? Number(descriptor.replace(/w$/i, "")) : 0;
        return { url, width };
      })
      .filter((item) => item.url);
    entries.sort((a, b) => b.width - a.width || b.url.length - a.url.length);
    return entries[0]?.url || "";
  }

  function normalizeMediaUrl(value, type = "image", preserveExact = false) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text, location.href);
      if (type === "image") {
        if (preserveExact || shouldPreserveExactImageUrl(url)) return url.toString();
        const stp = String(url.searchParams.get("stp") || "").trim();
        if (stp) {
          const normalizedStp = stp
            .split("_")
            .map((part) => part.trim())
            .filter(Boolean)
            .filter((part) => !/^[sp]\\d+x\\d+$/i.test(part))
            .filter((part) => !/^sh\\d+(?:\\.\\d+)?$/i.test(part))
            .join("_");
          if (normalizedStp) url.searchParams.set("stp", normalizedStp);
          else url.searchParams.delete("stp");
        }
        url.searchParams.delete("width");
        url.searchParams.delete("height");
      }
      return url.toString();
    } catch {
      return text;
    }
  }

  function shouldPreserveExactImageUrl(url) {
    const loweredPath = String(url.pathname || "").toLowerCase();
    const loweredSearch = String(url.search || "").toLowerCase();
    return (
      loweredPath.includes("/t51.2885-19/") ||
      loweredPath.includes("/t51.82787-19/") ||
      loweredPath.includes("profile_pic") ||
      loweredPath.includes("anonymous_profile_pic") ||
      loweredSearch.includes("profile_pic") ||
      loweredSearch.includes("anonymous_profile_pic")
    );
  }

  function isLikelyAvatarMedia(node, src, renderedWidth, renderedHeight, width, height) {
    const loweredSrc = String(src || "").toLowerCase();
    const alt = String(node.getAttribute("alt") || "").toLowerCase();
    const squareLike = Math.abs(width - height) <= Math.max(12, Math.floor(Math.min(width, height) * 0.08));
    const tinyRendered = renderedWidth > 0 && renderedHeight > 0 && renderedWidth <= 180 && renderedHeight <= 180;
    const avatarMarkers =
      loweredSrc.includes("profile_pic") ||
      loweredSrc.includes("anonymous_profile_pic") ||
      loweredSrc.includes("/t51.2885-19/") ||
      loweredSrc.includes("/t51.82787-19/") ||
      loweredSrc.includes("static.cdninstagram.com/rsrc.php") ||
      alt.includes("profile picture");
    return Boolean(src) && avatarMarkers && squareLike && (tinyRendered || Math.max(width, height) <= 220);
  }

  function cleanLine(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }
})()`;

const COMMENT_BLOCKS_SCRIPT = `(() => {
  const targetPostId = resolveTargetPostId();
  const commentSectionMarker = resolveCommentSectionTop();
  const commentSectionTop = commentSectionMarker
    ? commentSectionMarker.getBoundingClientRect().top
    : null;
  const threadRegion = resolveThreadRegion(targetPostId, commentSectionMarker);
  // A direct permalink without a detected comment-section marker is not a
  // safe document-wide scan: it is commonly the home/feed fallback, where
  // unrelated post cards are rendered next to the requested card.
  //
  // The root post itself is not guaranteed to render an <a href=".../post/...">
  // on Threads. In that case resolveThreadRegion() cannot find the shared
  // ancestor even though the comment-section marker is valid. Keep scanning
  // the document in that specific case; isBeforeCommentSection() still
  // excludes the root post and anything above the comment list.
  if (targetPostId && !threadRegion && !commentSectionMarker) return [];
  const scopeRoot = threadRegion || document;
  const anchors = Array.from(scopeRoot.querySelectorAll('a[href*="/@"]'));
  const results = [];
  for (const anchor of anchors) {
    const href = anchor.href || "";
    const username = extractUsername(href);
    if (!username) continue;

    let node = anchor;
    let best = null;
    for (let depth = 0; depth < 11 && node; depth += 1) {
      const text = cleanBlockText(node.innerText || "");
      const score = commentNodeScore(node, text, username, depth, anchor);
      if (score > 0 && (!best || score > best.score)) {
        best = { node, score, text };
      }
      node = node.parentElement;
    }
    if (!best) continue;

    const scopedText = scopeCommentText(best.text, username);
    const metricTexts = collectMetricTexts(anchor, best.node);
    const counts = extractCounts(scopedText, metricTexts, username);
    const mediaRoot = resolveMediaRoot(best.node, scopedText, anchor);
    const blockRect = best.node.getBoundingClientRect();
    results.push({
      username,
      text: scopedText || best.text,
      href,
      metricTexts,
      likeCount: counts.like,
      replyCount: counts.reply,
      isRootPost: Boolean(
        targetPostId &&
        isBeforeCommentSection(blockRect, commentSectionTop) &&
        anchorBelongsToRootPost(anchor, targetPostId),
      ),
      isReply: isLikelyNestedReply(anchor, best.node),
      isBeforeCommentSection: isBeforeCommentSection(blockRect, commentSectionTop),
      top: blockRect.top || 0,
      commentSectionTop,
      avatarUrl: avatarUrl(anchor, best.node),
      media: mediaItems(mediaRoot, anchor, scopeRoot)
    });
  }
  // Do not infer a reply from the absolute position of every anchor in the
  // page. Threads can shift sibling top-level comments by a few pixels when
  // media, badges, or virtualization changes the layout. The structural
  // heuristic above is the only reply signal; it requires a real indent.
  return results;

  function extractUsername(href) {
    const match = String(href || "").match(/\\/\\@([^/?#]+)/);
    const username = decodeURIComponent(match?.[1] || "").replace(/^@/, "").trim();
    return username && /^[A-Za-z0-9_.]+$/.test(username) ? username : "";
  }

  function resolveTargetPostId() {
    const urls = [
      document.querySelector('link[rel="canonical"]')?.href || "",
      document.querySelector('meta[property="og:url"]')?.content || "",
      window.location.href || ""
    ];
    for (const url of urls) {
      const postId = extractPostId(url);
      if (postId) return postId;
    }
    return "";
  }

  function extractPostId(url) {
    const match = String(url || "").match(/\\/@[^/?#]+\\/post\\/([A-Za-z0-9_-]+)/);
    return match?.[1] || "";
  }

  function resolveThreadRegion(targetPostId, marker) {
    if (!targetPostId || !marker) return null;
    const rootAnchor = Array.from(document.querySelectorAll('a[href*="/post/"]'))
      .find((node) => extractPostId(node.href || "") === targetPostId);
    if (!rootAnchor) return null;

    const ancestors = new Set();
    let current = rootAnchor;
    while (current) {
      ancestors.add(current);
      current = current.parentElement;
    }
    current = marker;
    while (current && !ancestors.has(current)) current = current.parentElement;
    return current && current !== document.body && current !== document.documentElement
      ? current
      : null;
  }

  function anchorBelongsToRootPost(anchor, postId) {
    let current = anchor;
    for (let depth = 0; depth < 10 && current; depth += 1) {
      const hasTargetLink = Array.from(current.querySelectorAll?.('a[href*="/post/"]') || [])
        .some((link) => extractPostId(link.href || "") === postId);
      if (hasTargetLink) return true;
      if (
        current !== anchor &&
        (current.tagName === "ARTICLE" ||
          String(current.getAttribute?.("role") || "").toLowerCase() === "article")
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return false;
  }

  function resolveCommentSectionTop() {
    const candidates = Array.from(document.querySelectorAll("span, div, button, [role='button']"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = cleanLine(node.innerText || node.textContent || "");
        return { node, rect, text };
      })
      .filter((item) =>
        item.text &&
        item.text.length <= 180 &&
        item.rect.width > 0 &&
        item.rect.height > 0 &&
        isCommentSectionMarker(item.text)
      )
      .sort((a, b) => a.rect.top - b.rect.top);
    return candidates[0]?.node || null;
  }

  function isCommentSectionMarker(value) {
    const folded = foldLine(value);
    return (
      /^(?:[\\u2195v]\\s*)?(?:hang dau|top)\\b/.test(folded) ||
      /^sap xep\\s*(?:hang dau|top)?/i.test(folded) ||
      /^xem hoat dong\\b/.test(folded) ||
      /^view activity\\b/.test(folded) ||
      /^(?:↕\\s*)?(?:hàng đầu|hang dau|top)\\b/.test(folded) ||
      /^sắp xếp\\s*(?:hàng đầu|top)?/i.test(folded) ||
      /^sap xep\\s*(?:hang dau|top)?/i.test(folded) ||
      /^xem hoạt động\\b/.test(folded) ||
      /^xem hoat dong\\b/.test(folded) ||
      /^view activity\\b/.test(folded)
    );
  }

  function foldLine(value) {
    return cleanLine(value)
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[\\u0111\\u0110]/g, "d")
      .toLowerCase();
  }

  function isBeforeCommentSection(rect, sectionTop) {
    return Number.isFinite(sectionTop) && (rect.top || 0) < sectionTop - 8;
  }

  function isLikelyNestedReply(anchor, root) {
    const anchorRect = anchor?.getBoundingClientRect?.();
    if (!anchorRect) return false;

    const currentTop = anchorRect.top || 0;
    let current = root?.parentElement || anchor.parentElement;
    // A comment card containing media has a deeper DOM tree than a text-only
    // card. Walk far enough to reach the shared thread wrapper before giving
    // up, otherwise a visually indented reply is treated as top-level.
    for (let depth = 0; depth < 12 && current && current !== document.body; depth += 1) {
      const rect = current.getBoundingClientRect();
      const clusterText = cleanBlockText(current.innerText || "");
      const usernameAnchors = Array.from(current.querySelectorAll('a[href*="/@"]'))
        .map((node) => {
          const nestedUsername = extractUsername(node.href || "");
          if (!nestedUsername) return null;
          const nodeRect = node.getBoundingClientRect();
          return {
            isCurrent: node === anchor,
            left: nodeRect.left || 0,
            top: nodeRect.top || 0
          };
        })
        .filter(Boolean);

      if (
        rect.height > 0 &&
        rect.height <= 1400 &&
        clusterText.length > 0 &&
        clusterText.length <= 4800 &&
        usernameAnchors.length >= 2 &&
        usernameAnchors.length <= 12
      ) {
        const priorAnchors = usernameAnchors
          .filter((item) => !item.isCurrent && item.top <= currentTop - 6 && currentTop - item.top <= 260)
          .sort((a, b) => b.top - a.top);
        const nearestPriorAnchor = priorAnchors[0];
        // A later sibling in the same wrapper is not automatically a reply.
        // Require the visual indentation used by Threads for a nested branch.
        // This avoids classifying an entire top-level comment list as replies.
        if (
          nearestPriorAnchor &&
          anchorRect.left - nearestPriorAnchor.left >= 24
        ) {
          return true;
        }
      }

      current = current.parentElement;
    }

    return false;
  }

  function commentNodeScore(node, text, username, depth, anchor) {
    const scopedText = scopeCommentText(text, username);
    if (
      scopedText.length < 3 ||
      scopedText.length > 1600
    ) return 0;
    const lowered = scopedText.toLowerCase();
    if (
      lowered.includes("post activity") ||
      lowered.includes("activity for post") ||
      lowered.includes("hoạt động đối với bài viết") ||
      lowered.includes("hoat dong doi voi bai viet")
    ) {
      return 0;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 0;

    const allLines = textLines(scopedText);
    const bodyLines = commentBodyLines(scopedText, username);
    if (!bodyLines.some((line) => line.length >= 3)) return 0;

    const anchorCount = node.querySelectorAll('a[href*="/@"]').length;
    if (anchorCount > 12 || allLines.length > 26) return 0;

    const metricTexts = collectMetricTexts(anchor, node);
    const counts = extractCounts(scopedText, metricTexts, username);
    const actionText = metricTexts.join(" ").toLowerCase();
    const hasAction =
      /\\blike\\b|\\blikes\\b|\\breply\\b|\\breplies\\b|thích|thich|trả lời|tra loi|bình luận|binh luan/.test(actionText) ||
      counts.like > 0 ||
      counts.reply > 0;

    let score = 0;
    for (const line of bodyLines) {
      score += Math.min(70, line.length);
      if (line.length >= 16) score += 12;
      if (/[!?]/.test(line)) score += 2;
      if (/[a-zA-Z\\u00C0-\\u1EF9]/.test(line)) score += 6;
    }
    if (hasAction) score += 55;
    if (counts.like > 0) score += 22;
    if (counts.reply > 0) score += 10;
    if (bodyLines.length > 1) score += 8;
    score -= Math.max(0, anchorCount - 2) * 34;
    score -= Math.max(0, allLines.length - 8) * 7;
    score -= Math.max(0, text.length - 720) / 7;
    score -= depth * 2;
    return score;
  }

  function collectMetricTexts(anchor, root) {
    const anchorRect = anchor?.getBoundingClientRect?.() || null;
    return Array.from(root.querySelectorAll("[aria-label], [title], button, [role='button']"))
      .map((metricNode) => {
        const rect = metricNode.getBoundingClientRect();
        const text = [
          metricNode.getAttribute("aria-label") || "",
          metricNode.getAttribute("title") || "",
          metricNode.textContent || ""
        ].join(" ").replace(/\\s+/g, " ").trim();
        return { rect, text };
      })
      .filter((item) => item.text)
      .filter((item) => isNearbyMetricCandidate(item.rect, anchorRect))
      .slice(0, 48)
      .map((item) => item.text);
  }

  function isNearbyMetricCandidate(rect, anchorRect) {
    if (!anchorRect) return true;
    if (rect.bottom < anchorRect.top - 24) return false;
    if (rect.top > anchorRect.bottom + 220) return false;
    const centerYGap = Math.abs((rect.top + rect.height / 2) - (anchorRect.top + anchorRect.height / 2));
    const topGap = rect.top - anchorRect.bottom;
    return centerYGap <= 170 || (topGap >= -12 && topGap <= 170);
  }

  function avatarUrl(anchor, root) {
    const anchorRect = anchor?.getBoundingClientRect?.() || null;
    const candidates = Array.from((root || document.body).querySelectorAll("img"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const width = rect.width || node.naturalWidth || 0;
        const height = rect.height || node.naturalHeight || 0;
        const src = imageSource(node, true);
        return {
          area: rect.width * rect.height,
          score: avatarCandidateScore(node, src, rect, width, height, anchorRect),
          src,
          width,
          height
        };
      })
      .filter((item) => item.src && item.width >= 24 && item.height >= 24 && item.width <= 120 && item.height <= 120 && Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score || b.area - a.area);
    return candidates[0]?.src || "";
  }

  function avatarCandidateScore(node, src, rect, width, height, anchorRect) {
    if (!src) return Number.NEGATIVE_INFINITY;
    const renderedWidth = rect.width || width || 0;
    const renderedHeight = rect.height || height || 0;
    const squareLike = Math.abs(width - height) <= Math.max(12, Math.floor(Math.min(width, height) * 0.08));
    if (!squareLike) return Number.NEGATIVE_INFINITY;

    const loweredSrc = String(src || "").toLowerCase();
    const alt = String(node.getAttribute("alt") || "").toLowerCase();
    const avatarMarkers =
      loweredSrc.includes("profile_pic") ||
      loweredSrc.includes("anonymous_profile_pic") ||
      loweredSrc.includes("/t51.2885-19/") ||
      loweredSrc.includes("/t51.82787-19/") ||
      loweredSrc.includes("static.cdninstagram.com/rsrc.php") ||
      alt.includes("profile picture");

    let score = avatarMarkers ? 220 : 60;
    if (renderedWidth <= 80 && renderedHeight <= 80) score += 24;
    if (!anchorRect) return score;

    const rectCenterY = rect.top + rect.height / 2;
    const anchorCenterY = anchorRect.top + anchorRect.height / 2;
    const centerYGap = Math.abs(rectCenterY - anchorCenterY);
    const leftGap = anchorRect.left - (rect.left + rect.width);
    const rightGap = rect.left - anchorRect.right;
    const appearsLeftOfAnchor = leftGap >= -20 && leftGap <= 220;
    const rowAligned = centerYGap <= Math.max(32, anchorRect.height * 1.6);
    const sitsInsideAnchorBox =
      rect.left >= anchorRect.left - 8 &&
      rect.right <= anchorRect.right + 8 &&
      rect.top >= anchorRect.top - 12 &&
      rect.bottom <= anchorRect.bottom + 12;

    if (sitsInsideAnchorBox) score += 260;
    if (appearsLeftOfAnchor) score += 140;
    if (rowAligned) score += 90;
    if (rect.left <= anchorRect.left + 20) score += 20;
    if (rightGap > 24) score -= Math.min(220, rightGap);
    score -= Math.min(180, centerYGap * 2.2);
    score -= Math.min(120, Math.abs(leftGap) * 0.6);
    return score;
  }

  function mediaItems(root, anchor, rangeRoot) {
    const output = [];
    const seen = new Set();
    // The media wrapper can be smaller than the comment list and therefore
    // may not contain the next author anchor. Resolve the vertical boundary
    // from the full thread scope so a neighboring card cannot leak in.
    const mediaRange = resolveCommentMediaRange(rangeRoot || root, anchor);
    for (const node of Array.from((root || document.body).querySelectorAll("img, video"))) {
      const rect = node.getBoundingClientRect();
      const renderedWidth = Math.round(rect.width || 0);
      const renderedHeight = Math.round(rect.height || 0);
      const width = Math.round(node.naturalWidth || node.videoWidth || renderedWidth || 0);
      const height = Math.round(node.naturalHeight || node.videoHeight || renderedHeight || 0);
      if (width < 80 || height < 80) continue;
      if (mediaRange && (rect.bottom < mediaRange.top || rect.top >= mediaRange.bottom)) continue;
      const mediaAnchor = node.closest('a[href*="/@"]');
      if (mediaAnchor && renderedWidth <= 140 && renderedHeight <= 140) continue;
      const type = node.tagName.toLowerCase() === "video" ? "video" : "image";
      const src = type === "video" ? videoSource(node) : imageSource(node);
      if (isLikelyAvatarMedia(node, src, renderedWidth, renderedHeight, width, height)) continue;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      output.push({
        type,
        remote_url: src,
        asset_path: "",
        width,
        height,
        order: output.length + 1
      });
    }
    return output.slice(0, 6);
  }

  function resolveCommentMediaRange(root, anchor) {
    const anchorRect = anchor?.getBoundingClientRect?.();
    if (!anchorRect || anchorRect.width <= 0 || anchorRect.height <= 0) return null;

    const currentTop = anchorRect.top || 0;
    const currentLeft = anchorRect.left || 0;
    const nextTop = Array.from((root || document.body).querySelectorAll('a[href*="/@"]'))
      .map((candidate) => {
        if (candidate === anchor || !extractUsername(candidate.href || "")) return null;
        const rect = candidate.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        if (rect.top <= currentTop + Math.max(18, anchorRect.height * 1.5)) return null;
        // Same-level author anchors are aligned horizontally. This avoids
        // treating an @mention or an indented reply as the next comment card.
        if (Math.abs((rect.left || 0) - currentLeft) > 18) return null;
        return rect.top;
      })
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)[0];

    return {
      bottom: Number.isFinite(nextTop) ? nextTop - 18 : Number.POSITIVE_INFINITY,
      top: currentTop - 18,
    };
  }

  function resolveMediaRoot(node, text, anchor) {
    const bodyKey = cleanLine(text).toLowerCase().slice(0, 180);
    let current = node;
    let fallbackRoot = node;
    let fallbackMediaRoot = null;
    const anchorRect = anchor?.getBoundingClientRect?.() || null;

    for (let depth = 0; depth < 8 && current; depth += 1) {
      const currentText = cleanLine(cleanBlockText(current.innerText || "")).toLowerCase();
      const anchorCount = current.querySelectorAll('a[href*="/@"]').length;
      const lineCount = textLines(cleanBlockText(current.innerText || "")).length;
      const mediaCount = largeMediaCount(current);
      const containsBody = !bodyKey || currentText.includes(bodyKey) || bodyKey.includes(currentText);
      if (containsBody && anchorCount <= 8 && lineCount <= 22) {
        if (mediaCount > 0) {
          // Pick the nearest ancestor that contains this comment's text and
          // media. The previous media-count score preferred a larger wrapper,
          // which pulled media from adjacent comment cards into this one.
          if (!fallbackMediaRoot) fallbackMediaRoot = current;
          if (!anchorRect || !hasSiblingAuthorRow(current, anchor, anchorRect)) {
            return current;
          }
        }
      }
      current = current.parentElement;
    }

    return fallbackMediaRoot || fallbackRoot;
  }

  function hasSiblingAuthorRow(root, anchor, anchorRect) {
    return Array.from(root.querySelectorAll('a[href*="/@"]')).some((candidate) => {
      if (candidate === anchor || !extractUsername(candidate.href || "")) return false;
      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return (
        Math.abs((rect.top || 0) - (anchorRect.top || 0)) <= Math.max(18, anchorRect.height * 1.5) &&
        Math.abs((rect.left || 0) - (anchorRect.left || 0)) <= 24
      );
    });
  }

  function largeMediaCount(root) {
    return Array.from((root || document.body).querySelectorAll("img, video")).filter((node) => {
      const rect = node.getBoundingClientRect();
      const renderedWidth = Math.round(rect.width || 0);
      const renderedHeight = Math.round(rect.height || 0);
      const width = Math.round(node.naturalWidth || node.videoWidth || renderedWidth || 0);
      const height = Math.round(node.naturalHeight || node.videoHeight || renderedHeight || 0);
      if (width < 80 || height < 80) return false;
      const anchor = node.closest('a[href*="/@"]');
      if (anchor && renderedWidth <= 140 && renderedHeight <= 140) return false;
      const type = node.tagName.toLowerCase() === "video" ? "video" : "image";
      const src = type === "video" ? videoSource(node) : imageSource(node);
      if (isLikelyAvatarMedia(node, src, renderedWidth, renderedHeight, width, height)) return false;
      return true;
    }).length;
  }

  function imageSource(node, preserveProfileParams = false) {
    const candidates = [
      largestSrcsetUrl(node.getAttribute("srcset") || ""),
      largestSrcsetUrl(node.parentElement?.querySelector("source")?.getAttribute("srcset") || ""),
      node.getAttribute("data-src") || "",
      node.currentSrc || "",
      node.src || "",
      node.getAttribute("src") || "",
    ].map((value) => normalizeMediaUrl(value, "image", preserveProfileParams)).filter(Boolean);
    return candidates[0] || "";
  }

  function videoSource(node) {
    const sourceNode = node.querySelector("source");
    const candidates = [
      sourceNode?.src || "",
      largestSrcsetUrl(sourceNode?.getAttribute("srcset") || ""),
      node.currentSrc || "",
      node.src || "",
      node.poster || "",
    ].map((value) => normalizeMediaUrl(value, node.tagName.toLowerCase() === "video" ? "video" : "image")).filter(Boolean);
    return candidates[0] || "";
  }

  function largestSrcsetUrl(value) {
    const entries = String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const pieces = part.split(/\\s+/).filter(Boolean);
        const url = pieces[0] || "";
        const descriptor = pieces[1] || "";
        const width = /^(\\d+)w$/i.test(descriptor) ? Number(descriptor.replace(/w$/i, "")) : 0;
        return { url, width };
      })
      .filter((item) => item.url);
    entries.sort((a, b) => b.width - a.width || b.url.length - a.url.length);
    return entries[0]?.url || "";
  }

  function normalizeMediaUrl(value, type = "image", preserveExact = false) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text, location.href);
      if (type === "image") {
        if (preserveExact || shouldPreserveExactImageUrl(url)) return url.toString();
        const stp = String(url.searchParams.get("stp") || "").trim();
        if (stp) {
          const normalizedStp = stp
            .split("_")
            .map((part) => part.trim())
            .filter(Boolean)
            .filter((part) => !/^[sp]\\d+x\\d+$/i.test(part))
            .filter((part) => !/^sh\\d+(?:\\.\\d+)?$/i.test(part))
            .join("_");
          if (normalizedStp) url.searchParams.set("stp", normalizedStp);
          else url.searchParams.delete("stp");
        }
        url.searchParams.delete("width");
        url.searchParams.delete("height");
      }
      return url.toString();
    } catch {
      return text;
    }
  }

  function shouldPreserveExactImageUrl(url) {
    const loweredPath = String(url.pathname || "").toLowerCase();
    const loweredSearch = String(url.search || "").toLowerCase();
    return (
      loweredPath.includes("/t51.2885-19/") ||
      loweredPath.includes("/t51.82787-19/") ||
      loweredPath.includes("profile_pic") ||
      loweredPath.includes("anonymous_profile_pic") ||
      loweredSearch.includes("profile_pic") ||
      loweredSearch.includes("anonymous_profile_pic")
    );
  }

  function isLikelyAvatarMedia(node, src, renderedWidth, renderedHeight, width, height) {
    const loweredSrc = String(src || "").toLowerCase();
    const alt = String(node.getAttribute("alt") || "").toLowerCase();
    const squareLike = Math.abs(width - height) <= Math.max(12, Math.floor(Math.min(width, height) * 0.08));
    const tinyRendered = renderedWidth > 0 && renderedHeight > 0 && renderedWidth <= 180 && renderedHeight <= 180;
    const avatarMarkers =
      loweredSrc.includes("profile_pic") ||
      loweredSrc.includes("anonymous_profile_pic") ||
      loweredSrc.includes("/t51.2885-19/") ||
      loweredSrc.includes("/t51.82787-19/") ||
      loweredSrc.includes("static.cdninstagram.com/rsrc.php") ||
      alt.includes("profile picture");
    return Boolean(src) && avatarMarkers && squareLike && (tinyRendered || Math.max(width, height) <= 220);
  }

  function extractCounts(text, metricTexts, username) {
    const bodyLine = pickCommentBodyLine(text, username);
    const positional = extractPositionalCounts(text, bodyLine);
    const metrics = metricTexts.map(cleanLine).filter(Boolean);
    return {
      like: positional[0] || firstMetric(metrics, ["like", "likes", "thích", "thich", "lượt thích", "luot thich"]),
      reply: positional[1] || firstMetric(metrics, ["reply", "replies", "trả lời", "tra loi", "bình luận", "binh luan"])
    };
  }

  function pickCommentBodyLine(text, username) {
    return commentBodyLines(text, username).sort((a, b) => lineScore(b) - lineScore(a))[0] || "";
  }

  function scopeCommentText(text, username) {
    const rawLines = textLines(text);
    const startIndex = rawLines.findIndex((line) => isUsernameLine(line, username));
    if (startIndex < 0) return cleanBlockText(text);

    const section = [];
    for (let index = startIndex; index < rawLines.length && section.length < 12; index += 1) {
      const line = rawLines[index] || "";
      if (index > startIndex && isLikelyNextCommentHeader(rawLines, index, username)) break;
      section.push(index === startIndex ? trimAfterNextCommentHeader(line, username) : line);
    }
    return cleanBlockText(section.join("\\n"));
  }

  function commentBodyLines(text, username) {
    const normalizedUsername = String(username || "").replace(/^@/, "").toLowerCase();
    return textLines(text).filter((line) => !isMetaLine(line, normalizedUsername));
  }

  function extractPositionalCounts(text, bodyLine) {
    const rawLines = textLines(text);
    const normalizedBody = cleanLine(bodyLine).toLowerCase();
    if (!normalizedBody) return [];
    const textIndex = rawLines.findIndex((line) => {
      const normalizedLine = line.toLowerCase();
      return normalizedLine === normalizedBody || normalizedLine.includes(normalizedBody) || normalizedBody.includes(normalizedLine);
    });
    if (textIndex < 0) return [];

    let counts = inlineCommentActionCounts(rawLines[textIndex] || "", bodyLine);
    if (counts.length === 0) {
      const strippedBodyLine = stripTrailingStandaloneMetricToken(bodyLine);
      if (strippedBodyLine && strippedBodyLine !== cleanLine(bodyLine)) {
        counts = inlineCommentActionCounts(rawLines[textIndex] || "", strippedBodyLine);
      }
    }
    if (counts.length >= 2) return counts.slice(0, 2);

    for (const line of rawLines.slice(textIndex + 1, textIndex + 10)) {
      if (!isCountish(line)) continue;
      counts.push(parseCount(line));
      if (counts.length >= 2) break;
    }
    return counts;
  }

  function inlineCommentActionCounts(line, bodyLine) {
    const value = cleanLine(line);
    const normalizedValue = value.toLowerCase();
    const normalizedBody = cleanLine(bodyLine).toLowerCase();
    let startIndex = normalizedValue.indexOf(normalizedBody);
    if (startIndex < 0) {
      const shortened = normalizedBody.slice(0, Math.min(80, normalizedBody.length));
      startIndex = shortened.length >= 12 ? normalizedValue.indexOf(shortened) : -1;
    }
    if (startIndex < 0) return [];

    const afterBody = value.slice(startIndex + Math.min(value.length - startIndex, bodyLine.length));
    const actionTail = afterBody
      .split(/\\s@?[a-z0-9_.]{2,32}\\s+\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b/i)[0]
      ?.replace(/^.*?(?:Translate|Dịch|Like|Thích)\\b/i, "")
      .trim();
    // A carousel indicator such as "1 / 2" sits next to the media and is
    // not engagement. Treating it as likes/replies makes a popular comment
    // rank as 1 like and fall out of the requested top-comment set.
    const actionMetrics = actionTail
      ?.replace(/\\b\\d+\\s*\\/\\s*\\d+\\b/g, " ")
      .trim();
    if (!actionMetrics) return [];

    return Array.from(actionMetrics.matchAll(/\\b\\d+(?:[.,]\\d+)?\\s*[KkMmBb]?\\b/g))
      .map((match) => parseCount(match[0] || ""))
      .filter((count) => count > 0)
      .slice(0, 4);
  }

  function stripTrailingStandaloneMetricToken(value) {
    return cleanLine(String(value || "").replace(/\\s+\\d+(?:[.,]\\d+)?\\s*[KkMmBb]?\\s*$/, ""));
  }

  function isUsernameLine(line, username) {
    const normalized = cleanLine(line).toLowerCase();
    const value = normalized.replace(/^@/, "");
    const target = String(username || "").toLowerCase();
    return value === target || value.startsWith(target + " ");
  }

  function isLikelyNextCommentHeader(rawLines, index, currentUsername) {
    const line = cleanLine(rawLines[index] || "");
    const normalized = line.toLowerCase().replace(/^@/, "");
    const current = String(currentUsername || "").toLowerCase();
    if (!normalized) return false;
    if (normalized === current || normalized.startsWith(current + " ")) return false;
    if (/^[a-z0-9_.]{2,32}\\s+\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b/i.test(line)) return true;
    if (/^@?[a-z0-9_.]{2,32}$/i.test(line)) {
      const next = cleanLine(rawLines[index + 1] || "");
      return isDateish(next) || isRelativeTime(next) || /^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b/.test(next);
    }
    return false;
  }

  function trimAfterNextCommentHeader(line, currentUsername) {
    const value = cleanLine(line);
    const pattern = new RegExp(
      "\\\\s@?(?!" + escapeRegExp(currentUsername) + "\\\\b)[a-z0-9_.]{2,32}\\\\s+\\\\d{1,2}\\\\/\\\\d{1,2}\\\\/\\\\d{2,4}\\\\b",
      "i"
    );
    const match = pattern.exec(value.slice(1));
    if (!match || match.index < 0) return value;
    return value.slice(0, match.index + 1).trim();
  }

  function isDateish(value) {
    return /^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}$/.test(cleanLine(value));
  }

  function isRelativeTime(value) {
    return /^\\d+\\s*(s|m|h|d|w|mo|y|giây|giay|phút|phut|g|ngày|ngay|tuần|tuan|tháng|thang|năm|nam)$/i.test(
      cleanLine(value)
    );
  }

  function firstMetric(values, names) {
    const namePattern = names.map(escapeRegExp).join("|");
    const countPattern = "\\\\d+(?:[.,]\\\\d+)?\\\\s*[KkMmBb]?";
    const patterns = [
      new RegExp("(?<count>" + countPattern + ")\\\\s*(?:" + namePattern + ")", "i"),
      new RegExp("(?:" + namePattern + ")\\\\D{0,24}(?<count>" + countPattern + ")", "i")
    ];
    for (const value of values) {
      for (const pattern of patterns) {
        const match = pattern.exec(value);
        const count = match?.groups?.count;
        if (count) return parseCount(count);
      }
    }
    return 0;
  }

  function lineScore(line) {
    const value = cleanLine(line);
    if (value.length < 8) return 0;
    let score = Math.min(80, value.length);
    if (/[\\u00C0-\\u1EF9]/.test(value)) score += 8;
    if (value.includes("?")) score += 4;
    if (value.split(/\\s+/).length >= 5) score += 5;
    if (value.length > 220) score -= 30;
    return score;
  }

  function isMetaLine(line, normalizedUsername) {
    const lowered = cleanLine(line).toLowerCase();
    if (!lowered) return true;
    if (lowered === normalizedUsername || lowered === "@" + normalizedUsername) return true;
    if (
      lowered === "translate" ||
      lowered === "like" ||
      lowered === "likes" ||
      lowered === "reply" ||
      lowered === "replies" ||
      lowered === "repost" ||
      lowered === "share" ||
      lowered === "more"
    ) {
      return true;
    }
    if (/^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}$/.test(lowered)) return true;
    if (/^\\d+\\s*(s|m|h|d|w|mo|y|giây|giay|phút|phut|g|ngày|ngay|tuần|tuan|tháng|thang|năm|nam)$/.test(lowered)) return true;
    if (isCountish(line)) return true;
    if (isHeaderOnlyLine(lowered, normalizedUsername)) return true;
    return false;
  }

  function isHeaderOnlyLine(line, normalizedUsername) {
    const cleaned = cleanLine(line);
    if (!cleaned) return true;
    if (!normalizedUsername) return false;
    const prefix = normalizedUsername + " ";
    if (cleaned === normalizedUsername || cleaned === "@" + normalizedUsername) return true;
    if (!cleaned.startsWith(prefix) && !cleaned.startsWith("@" + prefix)) return false;
    const suffix = cleaned.startsWith("@" + prefix)
      ? cleaned.slice(prefix.length + 1).trim()
      : cleaned.slice(prefix.length).trim();
    return /^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}(?:\\s+\\d+)?$/.test(suffix);
  }

  function parseCount(value) {
    let text = String(value || "").trim().replace(/\\s+/g, "");
    if (!text) return 0;
    let multiplier = 1;
    const suffix = text.slice(-1).toLowerCase();
    if (suffix === "k") {
      multiplier = 1000;
      text = text.slice(0, -1);
    } else if (suffix === "m") {
      multiplier = 1000000;
      text = text.slice(0, -1);
    } else if (suffix === "b") {
      multiplier = 1000000000;
      text = text.slice(0, -1);
    }

    if (multiplier > 1) {
      text = text.includes(",") && !text.includes(".") ? text.replace(",", ".") : text.replace(/,/g, "");
    } else if (text.includes(",") && !text.includes(".")) {
      text = text.replace(/,/g, "");
    } else if (text.includes(".") && !text.includes(",") && text.split(".").at(-1)?.length === 3) {
      text = text.replace(/\\./g, "");
    } else {
      text = text.replace(/,/g, "");
    }

    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? Math.floor(parsed * multiplier) : 0;
  }

  function isCountish(value) {
    return /^\\d+(?:[.,]\\d+)?\\s*[KkMmBb]?$/.test(String(value || "").trim());
  }

  function textLines(value) {
    return cleanBlockText(value).split(/\\n+/).map(cleanLine).filter(Boolean);
  }

  function cleanBlockText(value) {
    return String(value || "").replace(/\\r/g, "").trim();
  }

  function cleanLine(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function escapeRegExp(value) {
    const specials = "\\\\^$*+?.()|{}[]";
    let output = "";
    for (const char of String(value)) {
      output += specials.includes(char) ? "\\\\" + char : char;
    }
    return output;
  }
})()`;

export class ThreadsWebCollector {
  readonly config: ThreadsWebCollectorConfig;
  readonly stats: CollectorStats = {
    topics: 0,
    queries: 0,
    home_feed_runs: 0,
    discovered_urls: 0,
    home_feed_urls: 0,
    cache_hits: 0,
    cache_misses: 0,
    collected_posts: 0,
    stale_cache: 0,
    invalid_urls: 0,
    skipped_posts: 0,
    summary_candidates: 0,
    summary_collected: 0,
    detail_reserved: 0,
    detail_opened: 0,
    detail_valid: 0,
    final_selected: 0,
    skipped_after_target: 0,
    detail_requests: 0,
    detail_enriched: 0,
    detail_failed: 0,
    finalist_reserved: 0,
    finalist_opened: 0,
    comments_scanned: 0,
    comments_selected: 0,
  };

  private homeFeedCandidates: Candidate[] | null = null;
  private readonly partialPostsByTopic = new Map<string, RawPost[]>();
  private readonly readyOutputPostsByTopic = new Map<string, RawPost[]>();
  private readonly partialProcessedUrlsByTopic = new Map<string, string[]>();
  private readonly partialResumeUrlsByTopic = new Map<string, string[]>();
  private readonly auditSnapshotsByTopic = new Map<string, Record<string, unknown>>();
  private readonly resumeCompletedUrlKeys: Set<string>;
  private readonly requestScope = `crawl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private diagnosticCount = 0;
  private readonly commentWarnings = new Set<string>();

  constructor(config: Partial<ThreadsWebCollectorConfig> = {}) {
    this.config = {
      baseUrl: "https://www.threads.com",
      headless: true,
      searchScrollRounds: 4,
      homeScrollRounds: 6,
      postScrollRounds: 2,
      commentScrollRounds: 1,
      delayMs: 1200,
      maxCandidateLinks: 40,
      maxCollectedPostsPerTopic: 16,
      maxDetailRequests: 0,
      maxCommentScanPosts: 0,
      maxAssetDownloadPosts: 0,
      targetOutputPosts: 0,
      topCommentsPerPost: 5,
      timeoutMs: 30_000,
      authStatePath: "",
      browserChannel: "chrome",
      executablePath: "",
      maxSearchQueriesPerTopic: 6,
      cachePath: "",
      cacheTtlMinutes: 0,
      assetDir: "data/assets/threads",
      assetPathPrefix: "data/assets/threads",
      crawlAssets: true,
      downloadAvatars: true,
      downloadAssets: true,
      includeCommentAssets: true,
      maxMediaPerPost: 4,
      maxMediaPerComment: 6,
      validatePostUrls: true,
      includeHomeFeed: true,
      maxConcurrency: 1,
      sortBy: "views",
      summaryFirst: true,
      allowedLanguages: [],
      dateStart: "",
      dateEnd: "",
      dateTimezone: "",
      dateQueryWindows: [],
      ...config,
    };
    this.resumeCompletedUrlKeys = new Set(
      Array.isArray(this.config.selectionRequest?.ui_state?.resume_completed_urls)
        ? this.config.selectionRequest.ui_state.resume_completed_urls
            .map((value) => cacheKey(String(value ?? "").trim()))
            .filter((value): value is string => Boolean(value))
        : [],
    );
  }

  private async persistPageDiagnostic(
    page: Page,
    input: {
      error?: unknown;
      requestUrl: string;
      stage: string;
      userData: RequestUserData;
    },
  ): Promise<void> {
    if (this.diagnosticCount >= 6) {
      return;
    }

    this.diagnosticCount += 1;
    const rootDir = resolveThreadsDiagnosticRoot(this.config);
    const runDir = join(rootDir, this.requestScope);
    mkdirSync(runDir, { recursive: true });

    const key = cacheKey(input.requestUrl) || input.requestUrl;
    const label = safePathSegment(
      [
        String(this.diagnosticCount).padStart(2, "0"),
        input.stage,
        safePathSegment(key).slice(-32) || "page",
      ].join("-"),
    );
    const htmlPath = join(runDir, `${label}.html`);
    const metaPath = join(runDir, `${label}.json`);
    const screenshotPath = join(runDir, `${label}.png`);

    const pageSnapshot = await page
      .evaluate(() => ({
        bodyText: (document.body?.innerText || "").slice(0, 8_000),
        title: document.title || "",
        url: location.href,
      }))
      .catch(() => ({
        bodyText: "",
        title: "",
        url: "",
      }));

    const html = await page.content().catch(() => "");
    if (html) {
      writeFileSync(htmlPath, truncateDiagnosticText(html, 1_000_000), "utf8");
    }
    await page
      .screenshot({ fullPage: false, path: screenshotPath })
      .catch(() => undefined);

    writeFileSync(
      metaPath,
      `${JSON.stringify(
        {
          artifact_paths: {
            html: html ? htmlPath : "",
            screenshot: screenshotPath,
          },
          captured_at: nowIso(),
          error: diagnosticError(input.error),
          matched_query: input.userData.matchedQuery,
          page: pageSnapshot,
          request_url: input.requestUrl,
          source: input.userData.source,
          stage: input.stage,
          window_end_date: input.userData.windowEndDate ?? "",
          window_start_date: input.userData.windowStartDate ?? "",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.warn(`[crawl-diagnostics] Saved ${input.stage} diagnostic: ${metaPath}`);
  }

  private emitProgress(progress: Partial<CrawlProgressSnapshot>): void {
    const warning = String(progress.comment_warning ?? "").trim();
    if (warning) this.commentWarnings.add(warning);
    const commentWarning = [...this.commentWarnings].slice(0, 3).join(" | ");
    this.config.onProgress?.({
      ...progress,
      comment_warning: commentWarning || undefined,
    });
  }

  private syncReadyOutputPosts(
    topicTitle: string,
    posts: RawPost[],
    options: { allowShrink?: boolean } = {},
  ): void {
    const nextPosts = structuredClone(posts);
    const currentPosts = this.readyOutputPostsByTopic.get(topicTitle) ?? [];
    if (!options.allowShrink && nextPosts.length < currentPosts.length) {
      return;
    }
    this.readyOutputPostsByTopic.set(topicTitle, nextPosts);
  }

  private resolveReadyOutputSnapshot(
    posts: RawPost[],
    topic: TopicFilter,
  ): {
    commentCount: number;
    posts: RawPost[];
  } {
    const uniquePosts = uniqueRawPosts(posts);
    const request = this.config.selectionRequest;
    if (!request || uniquePosts.length === 0) {
      return {
        commentCount: sumCommentCounts(uniquePosts),
        posts: structuredClone(uniquePosts),
      };
    }

    const metricPeaks = buildPostMetricPeaks(uniquePosts, request.created_at);
    const acceptedPosts = uniquePosts
      .map((rawPost) => {
        const evaluated = evaluateRawPostForOutput(rawPost, topic, request, {
          metricPeaks,
        });
        if (!evaluated.accepted) {
          return null;
        }
        return {
          post: evaluated.post,
          rawPost,
          score: evaluated.score,
          scoreBreakdown: evaluated.scoreBreakdown,
        };
      })
      .filter(
        (
          candidate,
        ): candidate is {
          post: typeof candidate extends null ? never : NonNullable<typeof candidate>["post"];
          rawPost: RawPost;
          score: number;
          scoreBreakdown: Record<string, number>;
        } => Boolean(candidate),
      );

    const selectedPosts = selectAcceptedPostResults(acceptedPosts, {
      limit: request.filters.max_posts_per_topic,
      referenceTime: request.created_at,
      sortBy: request.filters.sort_by,
      rankingMode: request.filters.ranking_mode,
      strategy: resolveAcceptedPostSelectionStrategy(topic, {
        dateRange: request.filters.date_range,
        sortBy: request.filters.sort_by,
      }),
    });

    return {
      commentCount: selectedPosts.reduce(
        (total, candidate) => total + candidate.post.top_comments.length,
        0,
      ),
      posts: structuredClone(selectedPosts.map((candidate) => candidate.rawPost)),
    };
  }

  async collectPosts(topic: TopicFilter): Promise<RawPost[]> {
    this.partialPostsByTopic.set(topic.topic_title, []);
    this.readyOutputPostsByTopic.set(topic.topic_title, []);
    this.partialProcessedUrlsByTopic.set(topic.topic_title, []);
    this.partialResumeUrlsByTopic.set(topic.topic_title, []);
    this.stats.topics += 1;
    const collectedPosts: RawPost[] = [];
    const cachePath = this.config.cachePath;
    const cache = loadPostCache(cachePath);
    let cacheDirty = false;
    const queuedKeys = new Set<string>();
    let acceptedCandidateCount = 0;
    let pendingCandidateCount = 0;
    const initialRequests: RequestOptions[] = [];
    let crawler!: PlaywrightCrawler;
    let blockingError: Error | null = null;
    const targetPostCount = Math.max(0, this.config.maxCollectedPostsPerTopic);
    let profileBackfillPostTarget = 0;
    let commentCompleted = 0;
    const discoveryStrategy = resolveDiscoveryStrategy(this.config);
    const feedOnlyMode = discoveryStrategy === "feed_only";
    const strictBlankViralMode = isStrictBlankViralSelectionRequest(this.config.selectionRequest);
    const diversifyBlankViralMode =
      strictBlankViralMode && this.config.includeHomeFeed;
    const candidateCountBySource = new Map<Candidate["source"], number>();
    const candidateCountByOrigin = new Map<string, number>();
    const candidateBacklog: Candidate[] = [];
    const directPostMode = isDirectPostTopic(topic, this.config);
    const useSummaryFirst =
      !directPostMode &&
      this.config.summaryFirst &&
      this.config.targetOutputPosts > 0 &&
      targetPostCount > this.config.targetOutputPosts;
    const summaryRequestBacklogLimit = resolveSummaryRequestBacklogLimit(
      this.config,
      targetPostCount,
      useSummaryFirst,
    );
    const syncDiscoverySnapshot = (): {
      readyCommentCount: number;
      readyPostCount: number;
    } => {
      const resumeUrls = dedupeUrlList(
        collectedPosts
          .map((post) => String(post.url ?? post.source_url ?? "").trim())
          .filter(Boolean),
      );
      this.partialResumeUrlsByTopic.set(topic.topic_title, resumeUrls);
      if (useSummaryFirst) {
        return {
          readyCommentCount: 0,
          readyPostCount: 0,
        };
      }
      this.partialPostsByTopic.set(topic.topic_title, structuredClone(collectedPosts));
      const readyOutput = this.resolveReadyOutputSnapshot(collectedPosts, topic);
      this.syncReadyOutputPosts(topic.topic_title, readyOutput.posts);
      return {
        readyCommentCount: readyOutput.commentCount,
        readyPostCount: readyOutput.posts.length,
      };
    };
    this.emitProgress({
      candidate_count: 0,
      comment_completed: 0,
      comment_target: Math.max(0, this.config.targetOutputPosts * Math.max(1, this.config.topCommentsPerPost)),
      committed_comments: 0,
      committed_posts: 0,
      detail_completed: 0,
      detail_target: 0,
      discovered_posts: 0,
      message: directPostMode
        ? `Đang mở ${topic.seed_post_urls.length} link bài viết`
        : feedOnlyMode
          ? "Đang quét viral feed để tìm bài phù hợp"
          : "Đang tìm và gom danh sách bài phù hợp",
      pending_posts: 0,
      preview_only_posts: 0,
      queued_candidates: 0,
      ready_output_comments: 0,
      ready_output_posts: 0,
      resume_ready: false,
      selected_posts: 0,
      stage: "discovering",
      summary_posts: 0,
      target_inspect_posts: targetPostCount,
      target_output_posts: Math.max(0, this.config.targetOutputPosts),
    });
    const crawlerNavigationTimeoutMs = Math.max(this.config.timeoutMs, 20_000);
    const hasDateCoverage = (): boolean => {
      if (!this.config.dateStart) return true;
      let oldestAcceptedDate = "";
      for (const post of collectedPosts) {
        const dateKey = parseCreatedAtDateKey(post.created_at, this.config.dateTimezone);
        if (!dateKey) continue;
        if (!oldestAcceptedDate || dateKey < oldestAcceptedDate) {
          oldestAcceptedDate = dateKey;
        }
      }
      if (!oldestAcceptedDate) return false;
      return oldestAcceptedDate <= this.config.dateStart;
    };
    const hasEnoughPosts = (): boolean => {
      if (profileBackfillPostTarget > 0) {
        const profilePostCount = collectedPosts.filter(
          (post) =>
            String(post.discovery_source || "").trim().toLowerCase() === "profile",
        ).length;
        // The profile backfill quota is a minimum source-diversity requirement,
        // not the overall discovery target. Once it is met, keep consuming the
        // remaining candidate backlog until the total inspection budget is met.
        if (profilePostCount < profileBackfillPostTarget) return false;
      }
      return (
        targetPostCount > 0 &&
        collectedPosts.length >= targetPostCount &&
        hasDateCoverage()
      );
    };

    const consumePendingCandidate = (): number => {
      pendingCandidateCount = Math.max(0, pendingCandidateCount - 1);
      return pendingCandidateCount;
    };

    const queuePostCandidate = (candidate: Candidate): RequestOptions | null => {
      if (isAbortRequested(this.config.signal)) return null;
      if (hasEnoughPosts()) return null;
      const url = normalizePostUrl(candidate.url, this.config.baseUrl);
      const navigationUrl = normalizeThreadsNavigationUrl(candidate.url, this.config.baseUrl);
      const key = cacheKey(url);
      if (!key) return null;
      if (queuedKeys.has(key)) {
        if (profileBackfillPostTarget > 0 && candidate.source === "profile") {
          const rediscoveredPost = collectedPosts.find(
            (post) =>
              cacheKey(String(post.url || post.source_url || post.post_id || "")) === key,
          );
          if (rediscoveredPost) {
            const discoverySources = new Set(
              Array.isArray(rediscoveredPost.discovery_sources)
                ? rediscoveredPost.discovery_sources.map((source) =>
                    String(source || "").trim().toLowerCase(),
                  )
                : [],
            );
            const previousSource = String(
              rediscoveredPost.discovery_source || "",
            ).trim().toLowerCase();
            if (previousSource) discoverySources.add(previousSource);
            discoverySources.add("profile");
            rediscoveredPost.discovery_sources = [...discoverySources].filter(Boolean);
            rediscoveredPost.discovery_source = "profile";
          }
        }
        return null;
      }
      if (this.resumeCompletedUrlKeys.has(key)) return null;
      if (acceptedCandidateCount >= this.config.maxCandidateLinks) return null;
      const sourceCount = candidateCountBySource.get(candidate.source) ?? 0;
      const sourceCap = candidateSourceCap(candidate.source, this.config, {
        diversifyBlankViralMode,
        targetPostCount,
      });
      if (sourceCount >= sourceCap) return null;
      const originKey = `${candidate.source}:${candidate.matchedQuery}`;
      const originCount = candidateCountByOrigin.get(originKey) ?? 0;
      const originCap = candidateOriginCap(candidate.source, this.config, {
        diversifyBlankViralMode,
        targetPostCount,
      });
      if (originCount >= originCap) return null;

      queuedKeys.add(key);
      acceptedCandidateCount += 1;
      this.stats.summary_candidates += 1;
      candidateCountBySource.set(candidate.source, sourceCount + 1);
      candidateCountByOrigin.set(originKey, originCount + 1);

      const cachedPost = cache[key];
      if (cachedPost) {
        if (
          isUsableCachedPost(cachedPost, key, this.config.validatePostUrls, this.config.cacheTtlMinutes, this.config) &&
          cacheHasRequestedCommentCount(cachedPost, this.config.topCommentsPerPost)
        ) {
          if (!matchesCollectorDateRange(cachedPost.created_at, this.config)) {
            this.stats.skipped_posts += 1;
            this.recordSkippedSample({
              created_at: String(cachedPost.created_at ?? ""),
              language: String(cachedPost.language ?? ""),
              matched_query: candidate.matchedQuery,
              reason: "date_range_mismatch",
              text_preview: String(cachedPost.text ?? "").slice(0, 180),
              url,
              username: String(cachedPost.username ?? ""),
            });
            return null;
          }
          this.stats.cache_hits += 1;
          if (!useSummaryFirst) {
            commentCompleted += countPostComments(cachedPost);
          }
          const cachedOutputPost = cleanCachedAssetPaths(
            structuredClone(cachedPost),
            this.config,
          );
          cachedOutputPost.media = selectCachedPostMediaFromCache(
            cache,
            key,
            cachedOutputPost,
            this.config,
          );
          collectedPosts.push({
            ...cachedOutputPost,
            discovery_source: candidate.source,
            matched_query: candidate.matchedQuery,
            discovery_window_end: candidate.windowEndDate,
            discovery_window_start: candidate.windowStartDate,
          });
          const readyOutput = syncDiscoverySnapshot();
          this.emitProgress({
            committed_comments: !useSummaryFirst ? readyOutput.readyCommentCount : undefined,
            committed_posts: !useSummaryFirst ? readyOutput.readyPostCount : undefined,
            current_query: candidate.matchedQuery,
            current_url: url,
            discovered_posts: this.stats.discovered_urls,
            message: `Đã nhặt thêm 1 bài tạm từ cache`,
            pending_posts: !useSummaryFirst ? 0 : undefined,
            preview_only_posts: !useSummaryFirst ? 0 : undefined,
            queued_candidates: pendingCandidateCount,
            ready_output_comments: !useSummaryFirst ? readyOutput.readyCommentCount : undefined,
            ready_output_posts: !useSummaryFirst ? readyOutput.readyPostCount : undefined,
            resume_ready: !useSummaryFirst ? readyOutput.readyPostCount > 0 : undefined,
            selected_posts: !useSummaryFirst ? readyOutput.readyPostCount : undefined,
            stage: "discovering",
            summary_posts: collectedPosts.length,
          });
          return null;
        }
        this.stats.stale_cache += 1;
      }

      this.stats.cache_misses += 1;
      pendingCandidateCount += 1;
      return makePostRequest(
        navigationUrl || key,
        candidate.matchedQuery,
        candidate.source,
        this.requestScope,
        "summary",
        candidate.windowStartDate,
        candidate.windowEndDate,
      );
    };
    const enqueuePendingCandidates = async (): Promise<void> => {
      const requests: RequestOptions[] = [];
      while (
        candidateBacklog.length > 0 &&
        !isAbortRequested(this.config.signal) &&
        !hasEnoughPosts() &&
        pendingCandidateCount < summaryRequestBacklogLimit
      ) {
        const candidate = candidateBacklog.shift();
        if (!candidate) break;
        const request = queuePostCandidate(candidate);
        if (request) requests.push(request);
      }
      if (requests.length > 0) {
        await crawler.addRequests(requests);
        this.emitProgress({
          discovered_posts: this.stats.discovered_urls,
          message: `Đã đưa ${requests.length} bài vào hàng đợi để mở sau`,
          queued_candidates: pendingCandidateCount,
          stage: "discovering",
          summary_posts: collectedPosts.length,
        });
      }
    };
    const addPostCandidates = async (candidates: Candidate[]): Promise<void> => {
      for (const candidate of candidates) {
        if (isAbortRequested(this.config.signal) || hasEnoughPosts()) break;
        candidateBacklog.push(candidate);
      }
      await enqueuePendingCandidates();
    };

    for (const value of expandSeedTargetUrls(topic.seed_post_urls, this.config.baseUrl)) {
      const target = normalizeThreadsUrl(value, this.config.baseUrl);
      if (target.kind === "post") {
        const request = queuePostCandidate({ url: target.url, matchedQuery: "seed_post_urls", source: "seed_post_urls" });
        if (request) initialRequests.push(request);
      } else if (target.kind === "profile") {
        this.stats.queries += 1;
        initialRequests.push(
          makeListingRequest(target.url, `profile:${target.url.split("/@")[1] || "unknown"}`, "profile", this.requestScope),
        );
      }
    }

    const homeFeedRequests: RequestOptions[] = [];
    const trendSearchRequests: RequestOptions[] = [];
    const searchRequests: RequestOptions[] = [];

    // A seed made only of direct post URLs must stay scoped to those URLs.
    // Without this guard, buildSearchQueryPlans falls back to the topic title
    // and opens an unrelated search after the requested post is already done.
    if (!directPostMode) {
      if (this.config.includeHomeFeed) {
        if (feedOnlyMode && this.homeFeedCandidates) {
          for (const candidate of this.homeFeedCandidates) {
            const request = queuePostCandidate(candidate);
            if (request) homeFeedRequests.push(request);
          }
        } else {
          homeFeedRequests.push(makeListingRequest(this.config.baseUrl.replace(/\/$/, ""), "home_feed", "home_feed", this.requestScope));
        }
      }

      for (const trendUrl of normalizeTrendSearchUrls(topic.trend_search_urls, this.config.baseUrl)) {
        this.stats.queries += 1;
        trendSearchRequests.push(
          makeListingRequest(
            trendUrl.url,
            trendUrl.label,
            "trend_search",
            this.requestScope,
          ),
        );
      }

      for (const queryPlan of buildSearchQueryPlans(topic, this.config).slice(0, this.config.maxSearchQueriesPerTopic)) {
        this.stats.queries += 1;
        const url = `${this.config.baseUrl.replace(/\/$/, "")}/search`;
        searchRequests.push(
          makeListingRequest(
            url,
            queryPlan.query,
            "search",
            this.requestScope,
            queryPlan.windowStartDate,
            queryPlan.windowEndDate,
          ),
        );
      }
    }
    initialRequests.push(...trendSearchRequests, ...searchRequests, ...homeFeedRequests);

    if (initialRequests.length > 0) {
      const launchOptions = await resolveCollectorLaunchOptions(this.config);
      const authApplicator = createAuthApplicator(this.config.authStatePath);
      crawler = new PlaywrightCrawler({
        maxConcurrency: Math.max(1, this.config.maxConcurrency),
        maxRequestRetries: 0,
        navigationTimeoutSecs: Math.ceil(crawlerNavigationTimeoutMs / 1000),
        requestHandlerTimeoutSecs: Math.ceil(crawlerNavigationTimeoutMs / 1000) + 90,
        launchContext: {
          launchOptions,
        },
        preNavigationHooks: [
          async ({ page }, gotoOptions) => {
            if (gotoOptions) gotoOptions.waitUntil = "commit";
            page.setDefaultTimeout(this.config.timeoutMs);
            await page.setViewportSize({ width: 1365, height: 900 }).catch(() => undefined);
            const languageHeader = preferredAcceptLanguage(this.config.allowedLanguages);
            await page.setExtraHTTPHeaders({ "Accept-Language": languageHeader }).catch(() => undefined);
            await page.addInitScript(
              ({ language, languages }) => {
                Object.defineProperty(navigator, "language", { configurable: true, get: () => language });
                Object.defineProperty(navigator, "languages", { configurable: true, get: () => languages });
              },
              {
                language: languageHeader.split(",")[0]?.split(";")[0]?.trim() || "en-US",
                languages: languageHeader
                  .split(",")
                  .map((item) => item.split(";")[0]?.trim())
                  .filter(Boolean),
              },
            ).catch(() => undefined);
            await authApplicator(page.context());
          },
        ],
        requestHandler: async ({ page, request }) => {
          const userData = request.userData as RequestUserData;
          if (userData.kind === "post" && isAbortRequested(this.config.signal)) {
            consumePendingCandidate();
            return;
          }
          if (userData.kind === "post" && hasEnoughPosts()) {
            consumePendingCandidate();
            return;
          }
          if (isAbortRequested(this.config.signal)) return;
          page.setDefaultTimeout(this.config.timeoutMs);
          await waitForDelay(page, this.config.delayMs, this.config.signal);

          if (userData.kind === "listing") {
            try {
              await this.handleListing(page, request.url, userData, addPostCandidates);
            } catch (error) {
              await this.persistPageDiagnostic(page, {
                error,
                requestUrl: request.url,
                stage: "listing-error",
                userData,
              });
              if (!blockingError && error instanceof ThreadsSearchUnavailableError) {
                blockingError = error;
                return;
              }
              throw error;
            }
            return;
          }

          if (isAbortRequested(this.config.signal)) {
            consumePendingCandidate();
            return;
          }
          let post: RawPost | null = null;
          try {
            post = await this.extractPost(page, request.url, userData.matchedQuery, {
              includeDetails: !useSummaryFirst,
              windowEndDate: userData.windowEndDate,
              windowStartDate: userData.windowStartDate,
            });
          } catch (error) {
            await this.persistPageDiagnostic(page, {
              error,
              requestUrl: request.url,
              stage: "post-extract-error",
              userData,
            });
            throw error;
          }
          const key = cacheKey(request.url);
          if (post) {
            if ((!Array.isArray(post.media) || post.media.length === 0) && cache[key]) {
              post.media = selectCachedPostMediaFromCache(cache, key, cache[key], this.config);
            }
            post.matched_query = userData.matchedQuery;
            post.discovery_source = userData.source;
            post.discovery_window_end = userData.windowEndDate;
            post.discovery_window_start = userData.windowStartDate;
            collectedPosts.push(post);
            if (useSummaryFirst) {
              this.stats.summary_collected += 1;
            }
            const readyOutput = syncDiscoverySnapshot();
            commentCompleted += countPostComments(post);
            consumePendingCandidate();
            await enqueuePendingCandidates();
            this.emitProgress({
              comment_completed: commentCompleted,
              committed_comments: !useSummaryFirst ? readyOutput.readyCommentCount : undefined,
              committed_posts: !useSummaryFirst ? readyOutput.readyPostCount : undefined,
              current_post: post.username,
              current_query: userData.matchedQuery,
              current_url: post.url,
            discovered_posts: this.stats.discovered_urls,
            detail_completed: !useSummaryFirst ? collectedPosts.length : undefined,
            detail_target: !useSummaryFirst
              ? Math.max(1, Math.min(targetPostCount, this.config.targetOutputPosts || targetPostCount))
              : undefined,
            message: !useSummaryFirst
              ? `Đã lấy xong bài @${post.username}`
              : `Đã tìm thấy thêm 1 bài phù hợp`,
            pending_posts: !useSummaryFirst ? 0 : undefined,
            preview_only_posts: !useSummaryFirst ? 0 : undefined,
            queued_candidates: pendingCandidateCount,
            ready_output_comments: !useSummaryFirst ? readyOutput.readyCommentCount : undefined,
            ready_output_posts: !useSummaryFirst ? readyOutput.readyPostCount : undefined,
            resume_ready: !useSummaryFirst ? readyOutput.readyPostCount > 0 : undefined,
            selected_posts: !useSummaryFirst ? readyOutput.readyPostCount : undefined,
            stage: !useSummaryFirst ? "extracting_comments" : "discovering",
            summary_posts: collectedPosts.length,
          });
            if (!useSummaryFirst) {
              cache[key] = post;
              cacheDirty = true;
            }
          } else {
            await this.persistPageDiagnostic(page, {
              requestUrl: request.url,
              stage: "post-empty",
              userData,
            });
            const cachedPost = cache[key];
            if (
              cachedPost &&
              isUsableCachedPost(
                cachedPost,
                key,
                false,
                this.config.cacheTtlMinutes,
                this.config,
              )
            ) {
              const fallbackPost = cleanCachedAssetPaths(
                structuredClone(cachedPost),
                this.config,
              );
              fallbackPost.media = selectCachedPostMediaFromCache(
                cache,
                key,
                fallbackPost,
                this.config,
              );
              fallbackPost.discovery_source = userData.source;
              fallbackPost.matched_query = userData.matchedQuery;
              collectedPosts.push(fallbackPost);
              this.stats.cache_hits += 1;
              consumePendingCandidate();
              await enqueuePendingCandidates();
              return;
            }
            consumePendingCandidate();
            await enqueuePendingCandidates();
            this.stats.invalid_urls += 1;
            this.stats.skipped_posts += 1;
            if (cache[key]) {
              delete cache[key];
              cacheDirty = true;
            }
            this.emitProgress({
              current_query: userData.matchedQuery,
              current_url: request.url,
              queued_candidates: pendingCandidateCount,
              stage: "discovering",
              summary_posts: collectedPosts.length,
            });
          }
        },
        failedRequestHandler: async ({ request }) => {
          if ((request.userData as RequestUserData).kind === "post") {
            consumePendingCandidate();
            await enqueuePendingCandidates();
            this.stats.invalid_urls += 1;
            this.stats.skipped_posts += 1;
          }
        },
      }, createLocalCrawleeConfig());
      const detachAbort = attachCrawlerAbort(this.config.signal, crawler);
      try {
        await crawler.run(initialRequests);
        const desiredProfilePosts = resolveViralProfileSummaryTarget(
          this.config.targetOutputPosts,
        );
        const currentProfilePosts = collectedPosts.filter(
          (post) =>
            String(post.discovery_source || "").trim().toLowerCase() === "profile",
        ).length;
        if (
          feedOnlyMode &&
          strictBlankViralMode &&
          collectedPosts.length > 0 &&
          currentProfilePosts < desiredProfilePosts &&
          !isAbortRequested(this.config.signal)
        ) {
          const profileRequests = buildDatedProfileBackfillRequests(
            collectedPosts,
            this.config,
            this.requestScope,
          );
          if (profileRequests.length > 0) {
            candidateBacklog.length = 0;
            profileBackfillPostTarget = desiredProfilePosts;
            this.stats.queries += profileRequests.length;
            this.emitProgress({
              message: `Đang bổ sung bài từ ${profileRequests.length} profile viral`,
              stage: "discovering",
              summary_posts: collectedPosts.length,
            });
            try {
              await crawler.run(profileRequests);
            } finally {
              profileBackfillPostTarget = 0;
            }
          }
        }
      } finally {
        detachAbort();
      }
    }

    const abortedDuringDiscovery = isAbortRequested(this.config.signal);
    if (abortedDuringDiscovery && useSummaryFirst && collectedPosts.length > 0) {
      this.emitProgress({
        current_post: "",
        current_query: "",
        current_url: "",
        message: "Đã nhận lệnh dừng, đang lưu mốc tiếp tục",
        pending_posts: collectedPosts.length,
        queued_candidates: 0,
        resume_ready: true,
        stage: "saving",
      });
      if (cacheDirty) savePostCache(cachePath, cache);
    }
    throwIfAbortRequested(this.config.signal);
    if (collectedPosts.length === 0 && blockingError) {
      throw blockingError;
    }
    let outputPosts = collectedPosts;
    if (useSummaryFirst) {
      try {
        const enrichment = await this.enrichSelectedPosts(topic, collectedPosts, cache);
        outputPosts = enrichment.posts;
        cacheDirty = cacheDirty || enrichment.cacheDirty;
        commentCompleted = sumCommentCounts(outputPosts);
        this.partialPostsByTopic.set(topic.topic_title, structuredClone(outputPosts));
        this.syncReadyOutputPosts(
          topic.topic_title,
          outputPosts.filter((post) => hasFullPreviewExtraction(post)),
          { allowShrink: true },
        );
      } catch (error) {
        savePostCache(cachePath, cache);
        throw error;
      }
    }
    if (cacheDirty) savePostCache(cachePath, cache);
    throwIfAbortRequested(this.config.signal);
    this.stats.collected_posts += outputPosts.length;
    this.emitProgress({
      comment_completed: commentCompleted,
      committed_comments: commentCompleted,
      committed_posts: outputPosts.length,
      detail_completed: outputPosts.length,
      detail_target: Math.max(0, outputPosts.length),
      discovered_posts: this.stats.discovered_urls,
      pending_posts: 0,
      preview_only_posts: 0,
      queued_candidates: 0,
      message: "Đang lưu file kết quả",
      ready_output_comments: commentCompleted,
      ready_output_posts: outputPosts.length,
      resume_ready: outputPosts.length > 0,
      selected_posts: outputPosts.length,
      stage: "saving",
      summary_posts: outputPosts.length,
    });
    throwIfAbortRequested(this.config.signal);
    return outputPosts;
  }

  getPartialPosts(topic: TopicFilter): RawPost[] {
    const readyPosts = this.readyOutputPostsByTopic.get(topic.topic_title) ?? [];
    if (readyPosts.length > 0) {
      return structuredClone(readyPosts);
    }
    return structuredClone(this.partialPostsByTopic.get(topic.topic_title) ?? []);
  }

  getPartialSnapshot(topic: TopicFilter): {
    completedPostUrls: string[];
    pendingPostUrls: string[];
    posts: RawPost[];
    previewOnlyPostUrls: string[];
    processedPostUrls: string[];
    resumeSeedUrls: string[];
  } {
    const readyPosts = structuredClone(
      this.readyOutputPostsByTopic.get(topic.topic_title) ?? [],
    );
    const snapshotPosts = structuredClone(
      this.partialPostsByTopic.get(topic.topic_title) ?? [],
    );
    const posts = readyPosts.length > 0 ? readyPosts : snapshotPosts;
    const resumeSeedUrls = dedupeUrlList(
      this.partialResumeUrlsByTopic.get(topic.topic_title) ?? [],
    );
    const completedPostUrls = dedupeUrlList(
      posts
        .filter((post) => hasFullPreviewExtraction(post))
        .map((post) => String(post.url ?? post.source_url ?? "").trim())
        .filter(Boolean),
    );
    const previewOnlyPostUrls = dedupeUrlList(
      snapshotPosts
        .filter((post) => !hasFullPreviewExtraction(post))
        .map((post) => String(post.url ?? post.source_url ?? "").trim())
        .filter(Boolean),
    );
    const processedPostUrls = dedupeUrlList(
      (() => {
        const trackedUrls =
          this.partialProcessedUrlsByTopic.get(topic.topic_title) ?? [];
        return trackedUrls.length > 0 ? trackedUrls : completedPostUrls;
      })(),
    );
    const processedSet = new Set(processedPostUrls);
    const pendingPostUrls = resumeSeedUrls.filter((url: string) => !processedSet.has(url));

    return {
      completedPostUrls,
      pendingPostUrls,
      posts,
      previewOnlyPostUrls,
      processedPostUrls,
      resumeSeedUrls: resumeSeedUrls.length > 0
        ? resumeSeedUrls
        : dedupeUrlList([...completedPostUrls, ...previewOnlyPostUrls]),
    };
  }

  private async enrichSelectedPosts(
    topic: TopicFilter,
    summaryPosts: RawPost[],
    cache: PostCache,
    options: {
      allowAfterAbort?: boolean;
    } = {},
  ): Promise<{ posts: RawPost[]; cacheDirty: boolean }> {
    if (summaryPosts.length === 0) return { posts: [], cacheDirty: false };

    const selectionRequest = this.config.selectionRequest;
    const detailSignal = options.allowAfterAbort ? undefined : this.config.signal;
    const detailConfig =
      detailSignal === this.config.signal
        ? this.config
        : { ...this.config, signal: detailSignal };
    const metricPeaks = selectionRequest
      ? buildPostMetricPeaks(uniqueRawPosts(summaryPosts), selectionRequest.created_at)
      : undefined;
    const selectedPosts = selectPostsForDetail(
      summaryPosts,
      this.config,
      topic,
      selectionRequest,
    );
    this.stats.detail_reserved += selectedPosts.length;
    if (selectedPosts.length === 0) {
      const fallbackResumeSeedUrls = options.allowAfterAbort
        ? dedupeUrlList(
            summaryPosts
              .map((post) => String(post.url ?? post.source_url ?? "").trim())
              .filter(Boolean),
          )
        : [];
      this.partialPostsByTopic.set(topic.topic_title, []);
      this.readyOutputPostsByTopic.set(topic.topic_title, []);
      this.partialProcessedUrlsByTopic.set(topic.topic_title, []);
      this.partialResumeUrlsByTopic.set(topic.topic_title, fallbackResumeSeedUrls);
      return { posts: [], cacheDirty: false };
    }
    const commitTarget = Math.max(
      1,
      Math.trunc(this.config.targetOutputPosts || 1),
    );
    const compareFullReserveBeforeFinalSelection = Boolean(
      selectionRequest &&
        selectionRequest.runtime_overrides?.deepViralCompare !== false &&
        selectionRequest.ui_state?.deep_viral_compare !== false &&
        !options.allowAfterAbort,
    );
    const adaptiveViralReserveTarget =
      compareFullReserveBeforeFinalSelection &&
      selectionRequest &&
      isStrictBlankViralTopic(topic)
        ? resolveAdaptiveViralReserveTarget(commitTarget)
        : 0;
    const resumeSeedUrls = dedupeUrlList(
      selectedPosts
        .map((post) => String(post.url ?? post.source_url ?? "").trim())
        .filter(Boolean),
    );
    this.partialResumeUrlsByTopic.set(topic.topic_title, resumeSeedUrls);
    const enrichedByKey = new Map<string, RawPost>();
    const detailAuditByKey = new Map<string, Record<string, unknown>>();
    const processedKeys = new Set<string>();
    const detailRequests: RequestOptions[] = [];
    let cacheDirty = false;
    let committedComments = 0;
    const commentTarget = Math.max(
      0,
      commitTarget * Math.max(0, this.config.topCommentsPerPost),
    );
    const hasReachedCommitTarget = (): boolean =>
      !compareFullReserveBeforeFinalSelection &&
      enrichedByKey.size >= commitTarget;
    const hasReachedAdaptiveViralReserve = (): boolean =>
      Boolean(selectionRequest) &&
      isAdaptiveViralReserveReady(
        [...enrichedByKey.values()],
        topic,
        selectionRequest!,
        adaptiveViralReserveTarget,
      );
    const normalizeTargetReachedPatch = (
      patch: Partial<CrawlProgressSnapshot>,
    ): Partial<CrawlProgressSnapshot> => {
      if (!hasReachedCommitTarget()) {
        return patch;
      }
      return {
        ...patch,
        message: "Đã đủ số bài cần lấy, đang lưu kết quả",
        pending_posts: 0,
        resume_ready: false,
        stage: "saving",
      };
    };
    const syncProgress = (
      patch: Partial<CrawlProgressSnapshot>,
    ): void => {
      const pendingPosts = hasReachedCommitTarget()
        ? 0
        : Math.max(0, selectedPosts.length - processedKeys.size);
      const snapshotPosts = [...enrichedByKey.values()];
      const readySnapshotPosts = compareFullReserveBeforeFinalSelection
        ? []
        : snapshotPosts.filter((post) => hasFullPreviewExtraction(post));
      const readyOutputPosts = readySnapshotPosts.length;
      const readyOutputComments = committedComments;
      this.syncReadyOutputPosts(topic.topic_title, readySnapshotPosts);
      this.emitProgress({
        comment_completed: committedComments,
        comment_target: commentTarget,
        committed_comments: committedComments,
        committed_posts: compareFullReserveBeforeFinalSelection
          ? readyOutputPosts
          : enrichedByKey.size,
        detail_completed: processedKeys.size,
        detail_target: selectedPosts.length,
        discovered_posts: this.stats.discovered_urls,
        pending_posts: pendingPosts,
        preview_only_posts: Math.max(0, snapshotPosts.length - readyOutputPosts),
        resume_ready: pendingPosts > 0,
        ready_output_comments: readyOutputComments,
        ready_output_posts: readyOutputPosts,
        selected_posts: selectedPosts.length,
        summary_completed: processedKeys.size,
        summary_target: selectedPosts.length,
        summary_posts: enrichedByKey.size,
        target_output_posts: Math.max(0, this.config.targetOutputPosts),
        ...normalizeTargetReachedPatch(patch),
      });
    };
    const syncProcessedUrls = () => {
      const processedUrls = selectedPosts
        .map((post) => {
          const url = String(post.url ?? post.source_url ?? "").trim();
          const key = cacheKey(url);
          return key && processedKeys.has(key) ? url : "";
        })
        .filter(Boolean);
      this.partialProcessedUrlsByTopic.set(
        topic.topic_title,
        dedupeUrlList(processedUrls),
      );
    };
    const syncPartialPosts = () => {
      const completedPosts = selectedPosts
        .map((post) => {
          const key = cacheKey(String(post.url || post.source_url || ""));
          return (key && enrichedByKey.get(key)) || null;
        })
        .filter((post): post is RawPost => Boolean(post));
      this.partialPostsByTopic.set(topic.topic_title, structuredClone(completedPosts));
    };
    const markProcessed = (key: string | null | undefined) => {
      if (!key) return;
      processedKeys.add(key);
      syncProcessedUrls();
    };
    const tryCommitResolvedPost = (
      rawPost: RawPost,
      matchedQuery: string,
      options: { fromCache?: boolean } = {},
    ): boolean => {
      const key = cacheKey(String(rawPost.url ?? rawPost.source_url ?? ""));
      if (
        !key ||
        (!compareFullReserveBeforeFinalSelection &&
          enrichedByKey.size >= commitTarget)
      ) return false;
      const prepared = options.fromCache
        ? (() => {
            const cleaned = cleanCachedAssetPaths(structuredClone(rawPost), this.config);
            cleaned.media = selectCachedPostMediaFromCache(cache, key, cleaned, this.config);
            return {
              ...cleaned,
              matched_query: String(matchedQuery || rawPost.matched_query || ""),
            };
          })()
        : {
            ...structuredClone(rawPost),
            matched_query: String(matchedQuery || rawPost.matched_query || ""),
          };

      if (!selectionRequest) {
        detailAuditByKey.set(key, buildBasicCollectorAuditRow(prepared, "accepted"));
        if (!enrichedByKey.has(key)) {
          enrichedByKey.set(key, prepared);
          committedComments += countPostComments(prepared);
          syncPartialPosts();
        }
        return true;
      }

      const evaluated = evaluateRawPostForOutput(
        prepared,
        topic,
        selectionRequest,
        {
          metricPeaks,
          skipLoadedCommentGate: compareFullReserveBeforeFinalSelection,
        },
      );
      detailAuditByKey.set(key, {
        ...buildBasicCollectorAuditRow(
          prepared,
          evaluated.accepted ? "accepted" : evaluated.reason,
        ),
        score: evaluated.accepted ? evaluated.score : Number(evaluated.score ?? 0),
      });
      if (
        !shouldRetainDetailedPostForFinalComparison(
          evaluated.accepted,
          compareFullReserveBeforeFinalSelection,
        )
      ) {
        return false;
      }
      if (!enrichedByKey.has(key)) {
        enrichedByKey.set(key, prepared);
        if (!compareFullReserveBeforeFinalSelection && evaluated.accepted) {
          committedComments += evaluated.post.top_comments.length;
        }
        syncPartialPosts();
      }
      return true;
    };

    for (const summaryPost of selectedPosts) {
      if (
        !compareFullReserveBeforeFinalSelection &&
        enrichedByKey.size >= commitTarget
      ) {
        break;
      }
      const key = cacheKey(String(summaryPost.url || summaryPost.source_url || ""));
      if (!key) continue;

      const cachedPost = cache[key];
      if (
        cachedPost &&
        cacheHasFullExtraction(cachedPost) &&
        isUsableCachedPost(cachedPost, key, this.config.validatePostUrls, this.config.cacheTtlMinutes, this.config) &&
        cacheHasRequestedCommentCount(cachedPost, this.config.topCommentsPerPost)
      ) {
        tryCommitResolvedPost(
          {
            ...cachedPost,
            discovery_source:
              String(summaryPost.discovery_source ?? "") ||
              String(cachedPost.discovery_source ?? ""),
            discovery_window_end:
              String(summaryPost.discovery_window_end ?? "") ||
              String(cachedPost.discovery_window_end ?? ""),
            discovery_window_start:
              String(summaryPost.discovery_window_start ?? "") ||
              String(cachedPost.discovery_window_start ?? ""),
          },
          String(summaryPost.matched_query || cachedPost.matched_query || ""),
          { fromCache: true },
        );
        markProcessed(key);
        continue;
      }

      if (
        cacheHasFullExtraction(summaryPost) &&
        cacheHasRequestedCommentCount(summaryPost, this.config.topCommentsPerPost)
      ) {
        tryCommitResolvedPost(summaryPost, String(summaryPost.matched_query || ""));
        cache[key] = summaryPost;
        cacheDirty = true;
        markProcessed(key);
        continue;
      }

      detailRequests.push(
        makePostRequest(
          key,
          String(summaryPost.matched_query || ""),
          normalizeRequestSource(summaryPost),
          this.requestScope,
          "detail",
          String(summaryPost.discovery_window_start || ""),
          String(summaryPost.discovery_window_end || ""),
        ),
      );
    }
    this.stats.detail_requests += detailRequests.length;
    syncPartialPosts();
    syncProgress({
      comment_completed: committedComments,
      committed_comments: committedComments,
      committed_posts: compareFullReserveBeforeFinalSelection ? 0 : enrichedByKey.size,
      comment_target: commentTarget,
      detail_completed: processedKeys.size,
      detail_target: selectedPosts.length,
      discovered_posts: this.stats.discovered_urls,
      message: detailRequests.length > 0
        ? compareFullReserveBeforeFinalSelection
          ? "Đang kiểm tra nội dung và mức tương tác của các bài tiềm năng"
          : "Đang mở từng bài đã chọn để lấy thông tin và bình luận"
        : "Đang hoàn thiện dữ liệu từ bài đã có sẵn",
      pending_posts: Math.max(0, selectedPosts.length - processedKeys.size),
      resume_ready: Math.max(0, selectedPosts.length - processedKeys.size) > 0,
      selected_posts: selectedPosts.length,
      stage: detailRequests.length > 0 ? "extracting_posts" : "saving",
      summary_posts: enrichedByKey.size,
      target_output_posts: Math.max(0, this.config.targetOutputPosts),
    });

    let adaptiveDetailStoppedEarly = false;
    if (detailRequests.length > 0) {
      const launchOptions = await resolveCollectorLaunchOptions(detailConfig);
      const crawlerNavigationTimeoutMs = Math.max(this.config.timeoutMs, 20_000);
      const authApplicator = createAuthApplicator(this.config.authStatePath);
      let stoppedAfterCommitTarget = false;
      let detailCrawler: PlaywrightCrawler | null = null;
      const stopDetailCrawlerIfComplete = () => {
        const adaptiveReserveReady = hasReachedAdaptiveViralReserve();
        if (
          stoppedAfterCommitTarget ||
          (!hasReachedCommitTarget() && !adaptiveReserveReady) ||
          !detailCrawler
        ) {
          return;
        }
        adaptiveDetailStoppedEarly = adaptiveReserveReady;
        stoppedAfterCommitTarget = true;
        void detailCrawler.autoscaledPool?.abort().catch(() => undefined);
      };

      detailCrawler = new PlaywrightCrawler({
        maxConcurrency: resolveDetailConcurrency(this.config),
        maxRequestRetries: 0,
        navigationTimeoutSecs: Math.ceil(crawlerNavigationTimeoutMs / 1000),
        requestHandlerTimeoutSecs: Math.ceil(resolveDetailRequestTimeoutMs(this.config) / 1000),
        launchContext: {
          launchOptions,
        },
        preNavigationHooks: [
          async ({ page }, gotoOptions) => {
            if (gotoOptions) gotoOptions.waitUntil = "commit";
            page.setDefaultTimeout(this.config.timeoutMs);
            await page.setViewportSize({ width: 1365, height: 900 }).catch(() => undefined);
            const languageHeader = preferredAcceptLanguage(this.config.allowedLanguages);
            await page.setExtraHTTPHeaders({ "Accept-Language": languageHeader }).catch(() => undefined);
            await page.addInitScript(
              ({ language, languages }) => {
                Object.defineProperty(navigator, "language", { configurable: true, get: () => language });
                Object.defineProperty(navigator, "languages", { configurable: true, get: () => languages });
              },
              {
                language: languageHeader.split(",")[0]?.split(";")[0]?.trim() || "en-US",
                languages: languageHeader
                  .split(",")
                  .map((item) => item.split(";")[0]?.trim())
                  .filter(Boolean),
              },
            ).catch(() => undefined);
            await authApplicator(page.context());
          },
        ],
        requestHandler: async ({ page, request }) => {
          const userData = request.userData as RequestUserData;
          if (isAbortRequested(detailSignal)) return;
          if (userData.kind !== "post") return;
          if (
            stoppedAfterCommitTarget ||
            (!compareFullReserveBeforeFinalSelection &&
              enrichedByKey.size >= commitTarget)
          ) {
            stopDetailCrawlerIfComplete();
            return;
          }
          syncProgress({
            current_query: userData.matchedQuery,
            current_url: request.url,
            detail_completed: processedKeys.size,
            detail_target: selectedPosts.length,
            discovered_posts: this.stats.discovered_urls,
            message: "Đang mở bài viết để lấy thông tin chi tiết",
            pending_posts: Math.max(0, selectedPosts.length - processedKeys.size),
            resume_ready: Math.max(0, selectedPosts.length - processedKeys.size) > 0,
            selected_posts: selectedPosts.length,
            stage: "extracting_posts",
          });
          this.stats.detail_opened += 1;
          page.setDefaultTimeout(this.config.timeoutMs);
          await waitForDelay(page, this.config.delayMs, detailSignal);

          let post: RawPost | null = null;
          try {
            post = await this.extractPost(page, request.url, userData.matchedQuery, {
              attachAssets: false,
              attachPreviewAssets: !compareFullReserveBeforeFinalSelection,
              includeComments: !compareFullReserveBeforeFinalSelection,
              includeDetails: true,
              includeRichMedia: !compareFullReserveBeforeFinalSelection,
              signal: detailSignal,
              windowEndDate: userData.windowEndDate,
              windowStartDate: userData.windowStartDate,
            });
          } catch (error) {
            await this.persistPageDiagnostic(page, {
              error,
              requestUrl: request.url,
              stage: "detail-extract-error",
              userData,
            });
            throw error;
          }
          const key = cacheKey(request.url);
          if (!post) {
            await this.persistPageDiagnostic(page, {
              requestUrl: request.url,
              stage: "detail-empty",
              userData,
            });
            markProcessed(key);
            if (key) {
              detailAuditByKey.set(key, {
                post_id: key,
                reason: "detail_empty",
                url: request.url,
              });
            }
            this.stats.invalid_urls += 1;
            this.stats.skipped_posts += 1;
            this.stats.detail_failed += 1;
            return;
          }

          post.matched_query = userData.matchedQuery;
          post.discovery_source = userData.source;
          markProcessed(key);
          cache[key] = post;
          cacheDirty = true;
          this.stats.detail_enriched += 1;
          tryCommitResolvedPost(post, userData.matchedQuery);
          if (
            adaptiveViralReserveTarget > 0 ||
            (!compareFullReserveBeforeFinalSelection &&
              enrichedByKey.size >= commitTarget)
          ) {
            stopDetailCrawlerIfComplete();
          }
          syncPartialPosts();
          syncProgress({
            comment_completed: committedComments,
            comment_target: commentTarget,
            committed_comments: committedComments,
            committed_posts: compareFullReserveBeforeFinalSelection ? 0 : enrichedByKey.size,
            current_post: post.username,
            current_query: userData.matchedQuery,
            current_url: post.url,
            detail_completed: processedKeys.size,
            detail_target: selectedPosts.length,
            discovered_posts: this.stats.discovered_urls,
            message: compareFullReserveBeforeFinalSelection
              ? `Đang kiểm tra mức tương tác của bài @${post.username}`
              : `Đang lấy bình luận cho @${post.username}`,
            pending_posts: Math.max(0, selectedPosts.length - processedKeys.size),
            resume_ready: Math.max(0, selectedPosts.length - processedKeys.size) > 0,
            selected_posts: selectedPosts.length,
            stage: compareFullReserveBeforeFinalSelection
              ? "extracting_posts"
              : "extracting_comments",
            summary_posts: enrichedByKey.size,
          });
        },
        failedRequestHandler: async ({ request }) => {
          if ((request.userData as RequestUserData).kind === "post") {
            const key = cacheKey(request.url);
            if (key && enrichedByKey.has(key)) return;
            markProcessed(key);
            if (key) {
              detailAuditByKey.set(key, {
                post_id: key,
                reason: "detail_request_failed",
                url: request.url,
              });
            }
            this.stats.invalid_urls += 1;
            this.stats.skipped_posts += 1;
            this.stats.detail_failed += 1;
          }
        },
      }, createLocalCrawleeConfig());

      const detachAbort = attachCrawlerAbort(detailSignal, detailCrawler);
      try {
        await detailCrawler.run(detailRequests);
      } catch (error) {
        if (!stoppedAfterCommitTarget) {
          throw error;
        }
      } finally {
        detachAbort();
      }
    }

    const adaptiveDetailSkipped = adaptiveDetailStoppedEarly
      ? Math.max(0, selectedPosts.length - processedKeys.size)
      : 0;
    this.stats.skipped_after_target += adaptiveDetailSkipped;
    const effectiveDetailTarget = adaptiveDetailStoppedEarly
      ? processedKeys.size
      : selectedPosts.length;
    if (adaptiveDetailStoppedEarly) {
      syncProgress({
        detail_completed: processedKeys.size,
        detail_target: effectiveDetailTarget,
        message: `Đã đủ ${adaptiveViralReserveTarget} ứng viên viral chất lượng, chuyển sang so sánh bài cuối`,
        pending_posts: 0,
        resume_ready: false,
        selected_posts: effectiveDetailTarget,
        stage: "extracting_comments",
        summary_completed: processedKeys.size,
        summary_target: effectiveDetailTarget,
      });
    }

    if (options.allowAfterAbort && enrichedByKey.size < commitTarget) {
      let fallbackPreviewCount = 0;
      for (const summaryPost of selectedPosts) {
        if (enrichedByKey.size >= commitTarget) {
          break;
        }
        const key = cacheKey(String(summaryPost.url || summaryPost.source_url || ""));
        if (!key || enrichedByKey.has(key)) {
          continue;
        }
        if (cacheHasCurrentExtraction(summaryPost)) {
          cache[key] = structuredClone(summaryPost);
          cacheDirty = true;
        }
        if (tryCommitResolvedPost(summaryPost, String(summaryPost.matched_query || ""))) {
          fallbackPreviewCount += 1;
        }
      }
      if (fallbackPreviewCount > 0) {
        syncPartialPosts();
        syncProgress({
          comment_completed: committedComments,
          committed_comments: committedComments,
          committed_posts: enrichedByKey.size,
          detail_completed: processedKeys.size,
          detail_target: selectedPosts.length,
          discovered_posts: this.stats.discovered_urls,
          message: "Đã lưu preview tạm từ các bài đã chọn trước khi dừng",
          pending_posts: Math.max(0, selectedPosts.length - processedKeys.size),
          resume_ready: true,
          selected_posts: selectedPosts.length,
          stage: "saving",
          summary_posts: enrichedByKey.size,
          target_output_posts: Math.max(0, this.config.targetOutputPosts),
        });
      }
    }

    const enrichedPosts = selectedPosts
      .map((post) => {
        const key = cacheKey(String(post.url || post.source_url || ""));
        return (key && enrichedByKey.get(key)) || null;
      })
      .filter((post): post is RawPost => Boolean(post));
    this.auditSnapshotsByTopic.set(topic.topic_title, {
      discovered_urls: this.stats.discovered_urls,
      summary_candidates: this.stats.summary_candidates,
      summary_collected: this.stats.summary_collected,
      adaptive_detail_stop_target: adaptiveViralReserveTarget,
      adaptive_detail_stopped_early: adaptiveDetailStoppedEarly,
      adaptive_detail_skipped: adaptiveDetailSkipped,
      detail_reserved: selectedPosts.length,
      detail_valid: enrichedPosts.length,
      detail_shortlist: rankCollectorAuditRows(
        selectedPosts.map((post) => {
          const key = cacheKey(String(post.url || post.source_url || ""));
          return detailAuditByKey.get(key) ?? {
            ...buildBasicCollectorAuditRow(post, "not_processed"),
            score: 0,
          };
        }),
      ),
      detail_rejected: Math.max(0, selectedPosts.length - enrichedPosts.length),
      source_breakdown: buildRawPostSourceBreakdown(enrichedPosts),
    });
    let fullyEnrichedPosts = enrichedPosts;
    let finalistAuditRows: Array<Record<string, unknown>> = [];
    let finalViralScoreFloorOverride: number | undefined =
      isStrictBlankViralTopic(topic) && !options.allowAfterAbort
        ? STRICT_BLANK_VIRAL_MIN_SCORE
        : undefined;

    if (compareFullReserveBeforeFinalSelection && selectionRequest) {
      const finalistReserveCount = Math.min(
        enrichedPosts.length,
        this.config.maxCommentScanPosts > 0
          ? Math.max(commitTarget, this.config.maxCommentScanPosts)
          : Math.max(commitTarget + 2, Math.ceil(commitTarget * 1.35)),
      );
      const finalistCandidates = selectFinalPostsForOutput(
        enrichedPosts,
        topic,
        selectionRequest,
        finalistReserveCount,
        { skipLoadedCommentGate: true, skipScoreGate: true },
      );
      const qualifiedFinalistCount = selectFinalPostsForOutput(
        enrichedPosts,
        topic,
        selectionRequest,
        commitTarget,
        { skipLoadedCommentGate: true },
      ).length;
      if (
        isStrictBlankViralTopic(topic) &&
        !options.allowAfterAbort &&
        qualifiedFinalistCount < commitTarget
      ) {
        this.emitProgress({
          committed_posts: qualifiedFinalistCount,
          finalist_completed: 0,
          finalist_target: finalistCandidates.length,
          message: `Chua du ${commitTarget} bai dat diem viral ${STRICT_BLANK_VIRAL_MIN_SCORE}, se chi giu bai dat san chat luong`,
          pending_posts: Math.max(0, finalistCandidates.length),
          ready_output_posts: qualifiedFinalistCount,
          resume_ready: finalistCandidates.length > 0,
          stage: "extracting_posts",
        });
      }
      const shortlistAudit = this.auditSnapshotsByTopic.get(topic.topic_title) ?? {};
      this.auditSnapshotsByTopic.set(topic.topic_title, {
        ...shortlistAudit,
        finalist_ids: finalistCandidates.map((post) => String(post.post_id ?? "")),
        finalist_reserved: finalistCandidates.length,
      });
      this.stats.finalist_reserved = finalistCandidates.length;
      const finalistByKey = new Map<string, RawPost>();
      const finalistAuditByKey = new Map<string, Record<string, unknown>>();
      const finalistProcessedKeys = new Set<string>();
      const finalistRequests: RequestOptions[] = [];

      const syncFinalistProgress = (patch: Partial<CrawlProgressSnapshot> = {}) => {
        const finalistPosts = [...finalistByKey.values()];
        const commentsScanned = sumCommentCounts(finalistPosts);
        const comparisonComplete =
          finalistProcessedKeys.size >= finalistCandidates.length;
        const readyFinalists = comparisonComplete
          ? selectFinalPostsForOutput(
              finalistPosts,
              topic,
              selectionRequest,
              commitTarget,
              { viralScoreFloorOverride: finalViralScoreFloorOverride },
            )
          : [];
        const commentsSelected = readyFinalists.reduce((total, post) => {
          const evaluated = evaluateRawPostForOutput(post, topic, selectionRequest, {
            viralScoreFloorOverride: finalViralScoreFloorOverride,
          });
          return total + (evaluated.accepted ? evaluated.post.top_comments.length : 0);
        }, 0);
        committedComments = commentsSelected;
        this.stats.comments_scanned = commentsScanned;
        this.stats.comments_selected = commentsSelected;
        this.syncReadyOutputPosts(topic.topic_title, readyFinalists, {
          allowShrink: true,
        });
        this.partialPostsByTopic.set(topic.topic_title, structuredClone(finalistPosts));
        this.emitProgress({
          comment_completed: commentsSelected,
          comments_scanned: commentsScanned,
          comments_selected: commentsSelected,
          comment_target: commentTarget,
          committed_comments: commentsSelected,
          committed_posts: readyFinalists.length,
          detail_completed: processedKeys.size,
          detail_target: effectiveDetailTarget,
          finalist_completed: finalistProcessedKeys.size,
          finalist_target: finalistCandidates.length,
          pending_posts: Math.max(0, finalistCandidates.length - finalistProcessedKeys.size),
          ready_output_comments: commentsSelected,
          ready_output_posts: readyFinalists.length,
          resume_ready: comparisonComplete && readyFinalists.length > 0,
          selected_posts: effectiveDetailTarget,
          stage: comparisonComplete ? "saving" : "extracting_comments",
          summary_completed: processedKeys.size,
          summary_target: effectiveDetailTarget,
          target_output_posts: Math.max(0, this.config.targetOutputPosts),
          ...patch,
        });
      };
      for (const candidate of finalistCandidates) {
        const key = cacheKey(String(candidate.url || candidate.source_url || ""));
        if (!key) continue;
        if (
          cacheHasFullExtraction(candidate) &&
          cacheHasRequestedCommentCount(candidate, this.config.topCommentsPerPost)
        ) {
          const evaluated = evaluateRawPostForOutput(candidate, topic, selectionRequest, {
            viralScoreFloorOverride: finalViralScoreFloorOverride,
          });
          finalistAuditByKey.set(key, {
            ...buildBasicCollectorAuditRow(
              candidate,
              evaluated.accepted ? "accepted" : evaluated.reason,
            ),
            score: evaluated.accepted ? evaluated.score : Number(evaluated.score ?? 0),
          });
          if (evaluated.accepted) finalistByKey.set(key, candidate);
          finalistProcessedKeys.add(key);
          continue;
        }
        finalistRequests.push(
          makePostRequest(
            key,
            String(candidate.matched_query || ""),
            normalizeRequestSource(candidate),
            this.requestScope,
            "detail-finalist",
            String(candidate.discovery_window_start || ""),
            String(candidate.discovery_window_end || ""),
          ),
        );
      }

      syncFinalistProgress({
        message: finalistRequests.length > 0
          ? `Đang lấy bình luận cho ${finalistCandidates.length} bài nổi bật nhất`
          : "Đang chọn kết quả từ các bài đã kiểm tra kỹ",
      });

      if (finalistRequests.length > 0) {
        const launchOptions = await resolveCollectorLaunchOptions(detailConfig);
        const crawlerNavigationTimeoutMs = Math.max(this.config.timeoutMs, 20_000);
        const authApplicator = createAuthApplicator(this.config.authStatePath);
        let finalistCrawler: PlaywrightCrawler | null = null;

        finalistCrawler = new PlaywrightCrawler({
          maxConcurrency: resolveDetailConcurrency(this.config),
          maxRequestRetries: 0,
          navigationTimeoutSecs: Math.ceil(crawlerNavigationTimeoutMs / 1000),
          requestHandlerTimeoutSecs: Math.ceil(resolveDetailRequestTimeoutMs(this.config) / 1000),
          launchContext: { launchOptions },
          preNavigationHooks: [
            async ({ page }, gotoOptions) => {
              if (gotoOptions) gotoOptions.waitUntil = "commit";
              page.setDefaultTimeout(this.config.timeoutMs);
              await page.setViewportSize({ width: 1365, height: 900 }).catch(() => undefined);
              const languageHeader = preferredAcceptLanguage(this.config.allowedLanguages);
              await page.setExtraHTTPHeaders({ "Accept-Language": languageHeader }).catch(() => undefined);
              await authApplicator(page.context());
            },
          ],
          requestHandler: async ({ page, request }) => {
            const userData = request.userData as RequestUserData;
            if (isAbortRequested(detailSignal) || userData.kind !== "post") return;

            this.stats.finalist_opened = (this.stats.finalist_opened ?? 0) + 1;
            syncFinalistProgress({
              current_query: userData.matchedQuery,
              current_url: request.url,
              message: `Đang lấy bình luận và hình ảnh của bài nổi bật ${finalistProcessedKeys.size + 1}/${finalistCandidates.length}`,
              stage: "extracting_comments",
            });
            await waitForDelay(page, this.config.delayMs, detailSignal);
            const post = await this.extractPost(page, request.url, userData.matchedQuery, {
              attachAssets: false,
              attachPreviewAssets: false,
              includeComments: true,
              includeDetails: true,
              includeRichMedia: true,
              signal: detailSignal,
              windowEndDate: userData.windowEndDate,
              windowStartDate: userData.windowStartDate,
            });
            const key = cacheKey(request.url);
            if (!key) return;
            finalistProcessedKeys.add(key);
            if (!post) {
              this.stats.detail_failed += 1;
              finalistAuditByKey.set(key, {
                post_id: key,
                reason: "finalist_detail_empty",
                url: request.url,
              });
              syncFinalistProgress();
              return;
            }
            post.matched_query = userData.matchedQuery;
            post.discovery_source = userData.source;
            cache[key] = post;
            cacheDirty = true;
            const evaluated = evaluateRawPostForOutput(post, topic, selectionRequest, {
            viralScoreFloorOverride: finalViralScoreFloorOverride,
          });
            finalistAuditByKey.set(key, {
              ...buildBasicCollectorAuditRow(
                post,
                evaluated.accepted ? "accepted" : evaluated.reason,
              ),
              score: evaluated.accepted ? evaluated.score : Number(evaluated.score ?? 0),
            });
            if (evaluated.accepted) finalistByKey.set(key, post);
            syncFinalistProgress({ current_post: post.username });
          },
          failedRequestHandler: async ({ request }) => {
            const key = cacheKey(request.url);
            if (key) {
              finalistProcessedKeys.add(key);
              finalistAuditByKey.set(key, {
                post_id: key,
                reason: "finalist_request_failed",
                url: request.url,
              });
            }
            this.stats.detail_failed += 1;
            syncFinalistProgress();
          },
        }, createLocalCrawleeConfig());
        const detachAbort = attachCrawlerAbort(detailSignal, finalistCrawler);
        try {
          await finalistCrawler.run(finalistRequests);
        } finally {
          detachAbort();
        }
        const skippedFinalists = Math.max(
          0,
          finalistCandidates.length - finalistProcessedKeys.size,
        );
        this.stats.skipped_after_target += skippedFinalists;
        syncFinalistProgress({
          finalist_completed: finalistProcessedKeys.size,
          finalist_target: finalistProcessedKeys.size,
          message: finalistByKey.size >= commitTarget
            ? "Đã đủ số bài cần lấy, đang lưu kết quả"
            : "Đã kiểm tra xong các bài nổi bật",
          pending_posts: 0,
          stage: "saving",
        });
      }

      fullyEnrichedPosts = finalistCandidates
        .map((post) => {
          const key = cacheKey(String(post.url || post.source_url || ""));
          return (key && finalistByKey.get(key)) || null;
        })
        .filter((post): post is RawPost => Boolean(post));
      finalistAuditRows = rankCollectorAuditRows(
        finalistCandidates.map((post) => {
          const key = cacheKey(String(post.url || post.source_url || ""));
          return finalistAuditByKey.get(key) ?? {
            ...buildBasicCollectorAuditRow(post, "not_processed"),
            score: 0,
          };
        }),
      );
    }

    const finalPosts = selectionRequest
      ? selectFinalPostsForOutput(fullyEnrichedPosts, topic, selectionRequest, commitTarget, {
          viralScoreFloorOverride: finalViralScoreFloorOverride,
        })
      : fullyEnrichedPosts;
    const strictViralTargetRequired = Boolean(
      selectionRequest && isStrictBlankViralTopic(topic) && !options.allowAfterAbort,
    );
    const finalHomeFeedCount = finalPosts.filter(
      (post) => String(post.discovery_source || "").trim().toLowerCase() === "home_feed",
    ).length;
    const maxHomeFeedPosts = Math.max(1, Math.floor(commitTarget * 0.4));
    const targetMet =
      finalPosts.length >= commitTarget &&
      (!strictViralTargetRequired || finalHomeFeedCount <= maxHomeFeedPosts);
    const finalistAudit = this.auditSnapshotsByTopic.get(topic.topic_title) ?? {};
    this.auditSnapshotsByTopic.set(topic.topic_title, {
      ...finalistAudit,
      comments_scanned: sumCommentCounts(fullyEnrichedPosts),
      final_ids: finalPosts.map((post) => String(post.post_id ?? "")),
      final_selected: finalPosts.length,
      finalist_valid: fullyEnrichedPosts.length,
      finalist_results: finalistAuditRows.length > 0
        ? finalistAuditRows
        : buildCollectorAuditRows(
            fullyEnrichedPosts,
            topic,
            selectionRequest,
            false,
          ),
      final_source_breakdown: buildRawPostSourceBreakdown(finalPosts),
      max_home_feed_posts: strictViralTargetRequired ? maxHomeFeedPosts : undefined,
      target_met: targetMet,
      target_output_posts: commitTarget,
      target_shortfall: Math.max(0, commitTarget - finalPosts.length),
    });
    if (strictViralTargetRequired && !targetMet) {
      this.emitProgress({
        committed_posts: finalPosts.length,
        message: `Khong du ${commitTarget} bai dat chuan cao, dang luu ${finalPosts.length} bai tot nhat co san`,
        ready_output_posts: finalPosts.length,
        stage: "saving",
      });
    }
    this.emitProgress({
      detail_completed: processedKeys.size,
      detail_target: effectiveDetailTarget,
      message: `Dang hoan thien media va avatar cho ${finalPosts.length} bai da chot`,
      selected_posts: effectiveDetailTarget,
      stage: "saving",
      target_output_posts: Math.max(0, this.config.targetOutputPosts),
    });
    const outputPosts = await this.attachAssetsToFinalPosts(finalPosts);
    this.stats.detail_valid = Math.max(this.stats.detail_valid, fullyEnrichedPosts.length);
    this.stats.final_selected = Math.max(this.stats.final_selected, outputPosts.length);
    this.partialPostsByTopic.set(topic.topic_title, structuredClone(outputPosts));
    this.syncReadyOutputPosts(
      topic.topic_title,
      outputPosts.filter((post) => hasFullPreviewExtraction(post)),
      { allowShrink: true },
    );

    return {
      cacheDirty,
      posts: outputPosts,
    };
  }

  getAuditSnapshot(topic: TopicFilter): Record<string, unknown> {
    return structuredClone(this.auditSnapshotsByTopic.get(topic.topic_title) ?? {});
  }

  private async handleListing(
    page: Page,
    listingUrl: string,
    userData: Extract<RequestUserData, { kind: "listing" }>,
    addPostCandidates: (candidates: Candidate[]) => Promise<void>,
  ): Promise<void> {
    if (isAbortRequested(this.config.signal)) return;
    if (userData.source === "home_feed") this.stats.home_feed_runs += 1;
    this.emitProgress({
      current_query: userData.matchedQuery,
      current_url:
        userData.source === "home_feed"
          ? this.config.baseUrl
          : userData.source === "trend_search" || userData.source === "profile"
            ? listingUrl
            : `${this.config.baseUrl.replace(/\/$/, "")}/search`,
      message: userData.source === "home_feed"
        ? "Đang quét viral feed"
        : userData.source === "trend_search"
          ? `Đang quét trend "${userData.matchedQuery}"`
        : userData.source === "profile"
          ? `Đang quét ${userData.matchedQuery.replace(/^profile:/, "@")}`
          : `Đang tìm bài với từ khóa "${userData.matchedQuery}"`,
      stage: "discovering",
    });
    if (userData.source === "search") {
      await prepareSearchResults(page, this.config, userData.matchedQuery, this.config.signal);
    } else if (userData.source === "trend_search" || userData.source === "profile") {
      await goto(page, listingUrl, this.config.timeoutMs, this.config.delayMs, this.config.signal);
    } else {
      await goto(page, this.config.baseUrl.replace(/\/$/, ""), this.config.timeoutMs, this.config.delayMs, this.config.signal);
    }
    await dismissOverlays(page);
    const discoveredCandidates = await collectListingCandidates(
      page,
      userData,
      this.config.baseUrl,
      userData.source === "home_feed"
        ? this.config.homeScrollRounds
        : userData.source === "profile" &&
            ((this.config.dateStart || this.config.dateEnd) ||
              resolveDiscoveryStrategy(this.config) === "feed_only")
          ? (this.config.dateStart || this.config.dateEnd)
            ? Math.min(12, Math.max(8, Math.ceil(this.config.homeScrollRounds / 2)))
            : Math.min(8, Math.max(5, Math.ceil(this.config.homeScrollRounds / 2)))
          : this.config.searchScrollRounds,
      this.config.delayMs,
      this.config.signal,
    );
    const candidates =
      userData.source === "home_feed" &&
        ((this.config.dateStart || this.config.dateEnd) ||
          resolveDiscoveryStrategy(this.config) === "feed_only")
        ? spreadCandidatesAcrossListingDepth(
            discoveredCandidates,
            homeFeedCandidateBudget(this.config),
          )
        : discoveredCandidates;

    this.stats.discovered_urls += candidates.length;
    this.emitProgress({
      candidate_count: this.stats.discovered_urls,
      discovered_posts: this.stats.discovered_urls,
      current_query: userData.matchedQuery,
      message: `Da tim thay ${this.stats.discovered_urls} bai ung vien`,
      stage: "discovering",
    });
    if (userData.source === "home_feed") {
      this.stats.home_feed_urls += candidates.length;
      if (resolveDiscoveryStrategy(this.config) === "feed_only") {
        this.homeFeedCandidates = candidates;
      }
    }

    if (isAbortRequested(this.config.signal)) return;
    await addPostCandidates(candidates);
  }

  private async extractPost(
    page: Page,
    url: string,
    matchedQuery = "",
    options: {
      attachAssets?: boolean;
      attachPreviewAssets?: boolean;
      includeComments?: boolean;
      includeDetails?: boolean;
      includeRichMedia?: boolean;
      signal?: AbortSignal;
      windowEndDate?: string;
      windowStartDate?: string;
    } = {},
  ): Promise<RawPost | null> {
    const includeDetails = options.includeDetails ?? true;
    const includeComments = options.includeComments ?? includeDetails;
    const includeRichMedia = options.includeRichMedia ?? includeDetails;
    const attachAssets = options.attachAssets ?? true;
    const attachPreviewAssets = options.attachPreviewAssets ?? true;
    const signal = options.signal ?? this.config.signal;
    const runtimeConfig =
      signal === this.config.signal
        ? this.config
        : { ...this.config, signal };
    const sourceUrl = normalizeThreadsNavigationUrl(url, this.config.baseUrl);
    const sourceMatch = matchPostUrl(sourceUrl);
    const shareRedirectUrl = matchShareUrl(sourceUrl)
      ? await resolveShareRedirectUrl(sourceUrl, this.config.baseUrl, signal)
      : "";
    const shareFallbackUrls = shareRedirectUrl
      ? [
          ...postUrlVariants(
            normalizePostUrl(shareRedirectUrl, this.config.baseUrl),
            this.config.baseUrl,
          ),
          sourceUrl,
        ]
      : [];
    // A share redirect can be session-dependent. Open the original share URL
    // in the same browser context first so a logged-in Threads session decides
    // the target. The Node fetch redirect remains only a fallback for pages
    // that do not expose their target until navigation.
    const candidateUrls = shareRedirectUrl
      ? [...new Set([sourceUrl, shareRedirectUrl, ...shareFallbackUrls])]
      : [sourceUrl];
    const triedCandidateUrls = new Set<string>();
    const promotedRootPostIds = new Set<string>();

    for (let candidateIndex = 0; candidateIndex < candidateUrls.length; candidateIndex += 1) {
      const candidateUrl = candidateUrls[candidateIndex];
      if (!candidateUrl || triedCandidateUrls.has(candidateUrl)) continue;
      triedCandidateUrls.add(candidateUrl);
      if (isAbortRequested(signal)) return null;
      try {
        await goto(page, candidateUrl, resolvePostNavigationTimeoutMs(this.config), this.config.delayMs, signal);
      } catch (error) {
        this.recordSkippedSample({
          error: navigationErrorMessage(error),
          matched_query: matchedQuery,
          reason: "navigation_failed",
          url: candidateUrl,
        });
        continue;
      }
      await dismissOverlays(page);
      if (includeDetails) {
        await scroll(page, this.config.postScrollRounds, this.config.delayMs, signal);
      }
      if (isAbortRequested(signal)) return null;

      let meta = await page.evaluate<PostMeta>(POST_META_SCRIPT);

      // Threads may render the requested post in the initial document, then
      // let the client router fall back to the home feed. The stale canonical
      // tag still points at the requested permalink in that state, so using
      // it as proof would make the comment scanner absorb unrelated feed
      // cards. Recover through the exact rendered permalink first, and never
      // scan comments while the browser is still on the feed.
      if (sourceMatch && !pageUrlMatchesPost(meta.finalUrl, sourceMatch.postId)) {
        const recovered = await recoverPostRouteFromRenderedLink(
          page,
          sourceMatch.postId,
          this.config.delayMs,
          signal,
        );
        if (recovered) {
          meta = await page.evaluate<PostMeta>(POST_META_SCRIPT);
        }
        if (!pageUrlMatchesPost(meta.finalUrl, sourceMatch.postId)) {
          this.recordSkippedSample({
            canonical: String(meta.canonical || ""),
            final_url: String(meta.finalUrl || ""),
            matched_query: matchedQuery,
            reason: "post_request_did_not_remain_on_requested_post",
            requested_post_id: sourceMatch.postId,
            url: candidateUrl,
          });
          continue;
        }
      }

      // A /share/ URL does not contain the final post id. Threads can render
      // the shared post in the first feed card while the client URL remains
      // on the home route. In that state the document also contains unrelated
      // feed cards, so scanning it would incorrectly turn those cards into
      // comments. Resolve the rendered article permalink first, then require
      // the browser to remain on that exact post route before parsing any
      // comments.
      if (!sourceMatch) {
        const candidateShareMatch = matchPostUrl(
          normalizePostUrl(candidateUrl, this.config.baseUrl),
        );
        const renderedShareMatch = [
          meta.articlePostUrl,
          meta.canonical,
          meta.finalUrl,
        ]
          .map((value) =>
            matchPostUrl(normalizePostUrl(String(value || ""), this.config.baseUrl)),
          )
          .find((value): value is { username: string; postId: string } => Boolean(value));
        const fallbackShareMatch = matchPostUrl(
          normalizePostUrl(shareRedirectUrl, this.config.baseUrl),
        );
        const resolvedShareMatch =
          candidateShareMatch || renderedShareMatch || fallbackShareMatch;
        if (!resolvedShareMatch) {
          this.recordSkippedSample({
            canonical: String(meta.canonical || ""),
            final_url: String(meta.finalUrl || ""),
            matched_query: matchedQuery,
            reason: "shared_post_url_not_confirmed",
            url: candidateUrl,
          });
          continue;
        }
        if (!pageUrlMatchesPost(meta.finalUrl, resolvedShareMatch.postId)) {
          const resolvedShareUrl = [meta.articlePostUrl, meta.canonical]
            .map((value) => normalizePostUrl(String(value || ""), this.config.baseUrl))
            .find((value) => matchPostUrl(value)?.postId === resolvedShareMatch.postId);
          if (resolvedShareUrl) {
            // Some share pages expose the canonical post permalink but keep
            // the browser on the feed until that permalink is opened once.
            // Try that exact route before falling back to the rendered-link
            // recovery used for direct permalinks.
            await goto(
              page,
              resolvedShareUrl,
              resolvePostNavigationTimeoutMs(this.config),
              this.config.delayMs,
              signal,
            ).catch(() => undefined);
            meta = await page.evaluate<PostMeta>(POST_META_SCRIPT);
          }
          if (!pageUrlMatchesPost(meta.finalUrl, resolvedShareMatch.postId)) {
            const recovered = await recoverPostRouteFromRenderedLink(
              page,
              resolvedShareMatch.postId,
              this.config.delayMs,
              signal,
            );
            if (recovered) {
              meta = await page.evaluate<PostMeta>(POST_META_SCRIPT);
            }
          }
        }
        if (!pageUrlMatchesPost(meta.finalUrl, resolvedShareMatch.postId)) {
          this.recordSkippedSample({
            article_post_url: String(meta.articlePostUrl || ""),
            canonical: String(meta.canonical || ""),
            final_url: String(meta.finalUrl || ""),
            matched_query: matchedQuery,
            reason: "shared_post_request_did_not_remain_on_resolved_post",
            resolved_post_id: resolvedShareMatch.postId,
            url: candidateUrl,
          });
          continue;
        }
      }

      if (pageIsUnavailable(meta)) {
        this.recordSkippedSample({
          body_preview: String(meta.bodyText || "").slice(0, 180),
          canonical: String(meta.canonical || ""),
          final_url: String(meta.finalUrl || ""),
          matched_query: matchedQuery,
          reason: "page_unavailable",
          title: String(meta.ogTitle || meta.title || "").slice(0, 180),
          url: candidateUrl,
        });
        continue;
      }

      const canonical = normalizePostUrl(String(meta.canonical || ""), this.config.baseUrl);
      const finalUrl = normalizePostUrl(String(meta.finalUrl || ""), this.config.baseUrl);
      const contextRootUrl = normalizePostUrl(String(meta.contextRootUrl || ""), this.config.baseUrl);
      const articlePostUrl = normalizePostUrl(
        String(meta.articlePostUrl || ""),
        this.config.baseUrl,
      );
      const landedOnProfile = [meta.canonical, meta.finalUrl].some(
        (value) =>
          normalizeThreadsUrl(String(value || ""), this.config.baseUrl).kind ===
          "profile",
      );
      if (sourceMatch && landedOnProfile) {
        this.recordSkippedSample({
          body_preview: String(meta.bodyText || "").slice(0, 180),
          canonical,
          final_url: finalUrl,
          matched_query: matchedQuery,
          reason: "post_request_landed_on_profile",
          requested_post_id: sourceMatch.postId,
          title: String(meta.ogTitle || meta.title || "").slice(0, 180),
          url: candidateUrl,
        });
        continue;
      }
      const contextRootMatch = matchPostUrl(contextRootUrl);
      if (
        includeDetails &&
        sourceMatch &&
        contextRootMatch &&
        contextRootMatch.postId !== sourceMatch.postId &&
        !triedCandidateUrls.has(contextRootUrl)
      ) {
        promotedRootPostIds.add(contextRootMatch.postId);
        for (const variant of postUrlVariants(contextRootUrl, this.config.baseUrl).reverse()) {
          if (!triedCandidateUrls.has(variant) && !candidateUrls.includes(variant)) {
            candidateUrls.splice(candidateIndex + 1, 0, variant);
          }
        }
        continue;
      }
      const canonicalMatch = matchPostUrl(canonical);
      const finalMatch = matchPostUrl(finalUrl);
      const articleMatch = matchPostUrl(articlePostUrl);
      const hasResolvedMatch = Boolean(canonicalMatch || finalMatch || articleMatch);
      if (sourceMatch && !hasResolvedMatch) {
        this.recordSkippedSample({
          body_preview: String(meta.bodyText || "").slice(0, 180),
          canonical,
          final_url: finalUrl,
          matched_query: matchedQuery,
          reason: "post_url_not_confirmed",
          requested_post_id: sourceMatch.postId,
          title: String(meta.ogTitle || meta.title || "").slice(0, 180),
          url: candidateUrl,
        });
        continue;
      }
      const match = canonicalMatch || finalMatch || articleMatch || sourceMatch;
      if (!match) {
        this.recordSkippedSample({
          body_preview: String(meta.bodyText || "").slice(0, 180),
          canonical,
          final_url: finalUrl,
          matched_query: matchedQuery,
          reason: "post_url_not_found",
          title: String(meta.ogTitle || meta.title || "").slice(0, 180),
          url: candidateUrl,
        });
        continue;
      }
      if (
        sourceMatch &&
        hasResolvedMatch &&
        match.postId !== sourceMatch.postId &&
        !promotedRootPostIds.has(match.postId)
      ) {
        this.recordSkippedSample({
          canonical,
          expected_post_id: sourceMatch.postId,
          final_post_id: finalMatch?.postId ?? "",
          final_url: finalUrl,
          matched_post_id: match.postId,
          matched_query: matchedQuery,
          reason: "post_id_mismatch",
          url: candidateUrl,
        });
        continue;
      }
      const resolvedPostUrl = canonicalMatch
        ? canonical
        : finalMatch
          ? finalUrl
          : articleMatch
            ? articlePostUrl
            : sourceUrl;

      const username = match.username;
      const postId = match.postId;
      const title = String(meta.ogTitle || meta.title || "");
      const description = String(meta.ogDescription || "");
      const bodyText = String(meta.bodyText || "");
      const articleText = String(meta.articleText || bodyText);
      const displayName = extractDisplayName(title, username);
      const metaPostText = extractReliablePostMetaText(meta, displayName, username);
      let text = metaPostText || extractInitialPostText(description, displayName, username, bodyText);
      if (!metaPostText) {
        const formattedArticleText = extractFormattedPostTextFromArticle(articleText, username, text);
        if (formattedArticleText && isValidPostText(formattedArticleText)) {
          text = formattedArticleText;
        }
      }
      if (!isValidPostText(text)) {
        this.recordSkippedSample({
          article_preview: articleText.slice(0, 180),
          body_preview: bodyText.slice(0, 180),
          canonical,
          final_url: finalUrl,
          matched_query: matchedQuery,
          reason: "invalid_post_text",
          text_preview: text.slice(0, 180),
          title: title.slice(0, 180),
          url: resolvedPostUrl,
          username,
        });
        continue;
      }
      const createdAt = String(meta.createdAt || "");
      const language = guessLanguage(text);
      const earlySkipReason = skipReasonBeforeDeepExtraction({ createdAt, language }, this.config);
      if (earlySkipReason) {
        this.recordSkippedSample({
          created_at: createdAt,
          language,
              matched_query: matchedQuery,
              reason: earlySkipReason,
              text_preview: text.slice(0, 180),
              url: resolvedPostUrl,
              username,
            });
        return null;
      }
      if (!matchesCollectorDateRange(createdAt, this.config)) {
        this.recordSkippedSample({
          created_at: createdAt,
          language,
          matched_query: matchedQuery,
          reason: "date_range_mismatch",
          text_preview: text.slice(0, 180),
          url: resolvedPostUrl,
          username,
        });
        return null;
      }

      const metricTexts = asStringList(meta.metricTexts);
      const visibleMetrics = extractPostMetrics(articleText, bodyText, text, metricTexts);
      const directPostRequest = isDirectPostRequest(this.config);
      const activity = includeDetails &&
          (!directPostRequest || !hasSufficientVisibleMetrics(visibleMetrics))
        ? await extractActivityMetrics(page, this.config.delayMs, signal)
        : { debug: {}, metrics: {}, rawTexts: [], source: "" };
      const activityRestoredText = restorePostIntroFromActivityTexts(text, activity.rawTexts);
      if (activityRestoredText && isValidPostText(activityRestoredText)) {
        text = activityRestoredText;
      }
      const resolvedMetrics = resolvePostMetrics(visibleMetrics, activity.metrics, {
        extractionDepth: includeDetails ? "full" : "summary",
      });
      let authorAvatarUrl = String(meta.authorAvatarUrl || "");
      let assets: {
        authorAvatarAssetPath: string;
        authorAvatarUrl: string;
        authorAvatarWarning: string;
        comments: RawComment[];
        postMedia: MediaAsset[];
      } = {
        authorAvatarAssetPath: "",
        authorAvatarUrl,
        authorAvatarWarning: "",
        comments: [],
        postMedia: [],
      };
      const expectedCommentCount = Math.max(
        0,
        metricNumber(resolvedMetrics.metrics.reply_count),
      );
      let commentExtractionWarning = "";
      if (includeDetails) {
        if (includeComments) {
          await ensureTopCommentsSort(page, this.config.delayMs, signal);
        }
        await revealSensitivePostContent(page, this.config.delayMs, signal);
        const refreshedMeta = await page.evaluate<PostMeta>(POST_META_SCRIPT).catch(() => meta);
        const refreshedArticleText = String(refreshedMeta.articleText || refreshedMeta.bodyText || "");
        const refreshedMetaPostText = extractReliablePostMetaText(refreshedMeta, displayName, username);
        if (refreshedMetaPostText) {
          text = refreshedMetaPostText;
        } else if (!metaPostText) {
          const refreshedFormattedText = extractFormattedPostTextFromArticle(refreshedArticleText, username, text);
          if (refreshedFormattedText && isValidPostText(refreshedFormattedText)) {
            text = refreshedFormattedText;
          }
        }
        const refreshedActivityRestoredText = restorePostIntroFromActivityTexts(text, activity.rawTexts);
        if (refreshedActivityRestoredText && isValidPostText(refreshedActivityRestoredText)) {
          text = refreshedActivityRestoredText;
        }
        let postMedia = includeRichMedia
          ? await collectPostMediaWithCarousel(
              page,
              normalizePostMedia(refreshedMeta.media),
              runtimeConfig,
              Boolean(refreshedMeta.hasVideoCandidate),
              postId,
            )
          : normalizePostMedia(refreshedMeta.media).slice(0, this.config.maxMediaPerPost);
        let comments = includeComments
          ? await this.extractComments(
              page,
              postId,
              username,
              text,
              resolvedMetrics.metrics.reply_count,
              signal,
            )
          : [];
        const rootPostComment = findRootPostComment(comments, username, resolvedMetrics.metrics);
        if (rootPostComment) {
          const recoveredRootText = String(rootPostComment.text || "").trim();
          if (isValidPostText(recoveredRootText)) text = recoveredRootText;
          comments = comments.filter((comment) => comment !== rootPostComment);
        }
        postMedia = await materializeBrowserLocalMedia(page, runtimeConfig, {
          filename: (index) => `post-${String(index + 1).padStart(2, "0")}`,
          logLabel: (index) => `post media #${index + 1}`,
          media: postMedia,
          postId,
          subdir: "",
        });
        comments = await materializeBrowserLocalCommentMedia(
          page,
          runtimeConfig,
          postId,
          comments,
        );
        commentExtractionWarning =
          includeComments && expectedCommentCount > 0 && comments.length === 0
            ? `Khong lay duoc comment cua @${username} (Threads hien ${expectedCommentCount} comment). Kiem tra lai dang nhap Threads hoac thu crawl lai.`
            : "";
        if (commentExtractionWarning) {
          this.recordSkippedSample({
            expected_comment_count: expectedCommentCount,
            extracted_comment_count: comments.length,
            matched_query: matchedQuery,
            post_id: postId,
            reason: "comments_not_extracted",
            url: resolvedPostUrl,
            username,
          });
          this.emitProgress({
            current_post: username,
            current_url: resolvedPostUrl,
            comment_warning: commentExtractionWarning,
            message: commentExtractionWarning,
            stage: "extracting_comments",
          });
        }
        authorAvatarUrl ||= String(refreshedMeta.authorAvatarUrl || "") || await extractAuthorAvatarUrl(page, username);
        assets = attachAssets
          ? await this.attachAssets(page, {
              authorAvatarUrl,
              authorUsername: username,
              comments,
              postId,
              postMedia,
            })
          : attachPreviewAssets
            ? {
              ...(await this.attachPreviewAvatars(page, {
                authorAvatarUrl,
                authorUsername: username,
                comments,
                postId,
              })),
              postMedia,
            }
            : {
                authorAvatarAssetPath: "",
                authorAvatarUrl,
                authorAvatarWarning: "",
                comments,
                postMedia,
              };
      }
      const crawledAt = nowIso();
      if (isAbortRequested(signal)) return null;

      return {
        post_id: postId,
        url: resolvedPostUrl,
        source_url: sourceUrl,
        username,
        display_name: displayName || username,
        avatar_url: assets.authorAvatarUrl,
        avatar_asset_path: assets.authorAvatarAssetPath,
        language,
        text,
        view_count: resolvedMetrics.metrics.view_count,
        like_count: resolvedMetrics.metrics.like_count,
        reply_count: resolvedMetrics.metrics.reply_count,
        repost_count: resolvedMetrics.metrics.repost_count,
        quote_count: resolvedMetrics.metrics.quote_count,
        share_count: resolvedMetrics.metrics.share_count,
        created_at: createdAt,
        created_at_source: createdAt ? "threads_time_datetime" : "missing",
        crawled_at: crawledAt,
        discovery_window_end: options.windowEndDate,
        discovery_window_start: options.windowStartDate,
        metrics_snapshot: {
          crawled_at: crawledAt,
          extraction_depth:
            includeDetails && includeComments && includeRichMedia
              ? "full"
              : includeDetails
                ? "detail_metrics"
                : "summary",
          extraction_version: THREADS_EXTRACTION_VERSION,
          source: activity.source || visibleMetrics.source || "",
          metric_confidence: resolvedMetrics.confidence,
          metric_issues: resolvedMetrics.issues,
          metric_sources: resolvedMetrics.fieldSources,
          raw_metric_texts: metricTexts.slice(0, 40),
          raw_activity_texts: activity.rawTexts.slice(0, 40),
          activity_debug: activity.debug,
          comments_requested: includeComments ? this.config.topCommentsPerPost : 0,
          comments_extracted: assets.comments.length,
          comments_expected: expectedCommentCount,
          comments_warning: commentExtractionWarning,
        },
        url_status: {
          accessible: true,
          author_avatar_warning: assets.authorAvatarWarning,
          checked_url: candidateUrl,
          canonical_url: resolvedPostUrl,
          promoted_from_reply_context: promotedRootPostIds.has(postId),
          final_url: cacheKey(String(meta.finalUrl || "")),
          comments_warning: commentExtractionWarning,
        },
        media: assets.postMedia,
        comments: assets.comments,
      };
    }

    return null;
  }

  private recordSkippedSample(sample: Record<string, unknown>): void {
    this.stats.skipped_samples ??= [];
    if (this.stats.skipped_samples.length >= 20) return;
    this.stats.skipped_samples.push(sample);
  }

  private async attachAssets(
    page: Page | undefined,
    input: {
      authorAvatarUrl: string;
      authorUsername: string;
      comments: RawComment[];
      postId: string;
      postMedia: MediaAsset[];
    }
  ): Promise<{
    authorAvatarAssetPath: string;
    authorAvatarUrl: string;
    authorAvatarWarning: string;
    comments: RawComment[];
    postMedia: MediaAsset[];
  }> {
    if (!this.config.crawlAssets) {
      return {
        authorAvatarAssetPath: "",
        authorAvatarUrl: "",
        authorAvatarWarning: "",
        comments: input.comments,
        postMedia: [],
      };
    }

    const postId = safePathSegment(input.postId);
    const authorAvatarAssetPathPromise = downloadAssetIfEnabled(page, this.config, {
      enabled: this.config.downloadAvatars || this.config.downloadAssets,
      filename: "author-avatar",
      logLabel: `author avatar @${safePathSegment(String(input.authorUsername || "unknown"))}`,
      postId,
      remoteUrl: input.authorAvatarUrl,
      subdir: "",
    });
    const postMediaPromise = Promise.all(
      input.postMedia.slice(0, this.config.maxMediaPerPost).map(async (media, index) => {
        const downloaded = await downloadAssetIfEnabled(page, this.config, {
          filename: `post-${String(index + 1).padStart(2, "0")}`,
          logLabel: `post media #${index + 1}`,
          mediaType: media.type,
          postId,
          remoteUrl: media.remote_url,
          subdir: "",
        });
        return {
          ...media,
          asset_path: downloaded.assetPath || media.asset_path,
          ...(downloaded.durationSeconds && downloaded.durationSeconds > 0
            ? { duration_seconds: downloaded.durationSeconds }
            : {}),
          height: Math.max(metricNumber(media.height), downloaded.height),
          order: index + 1,
          remote_url: downloaded.remoteUrl || media.remote_url,
          width: Math.max(metricNumber(media.width), downloaded.width),
          downloadError: downloaded.error,
        };
      })
    ).then((media) =>
      media.flatMap(({ downloadError, ...item }) =>
        isDefinitiveAssetDownloadFailure(downloadError) ? [] : [item],
      ),
    );

    const comments = input.comments.map((comment) => ({
      ...comment,
      media: this.config.includeCommentAssets
        ? filterUnmaterializedBrowserLocalMedia(
            limitCommentMedia(comment.media, this.config.maxMediaPerComment),
          )
        : [],
    }));
    const commentAssetIndexes = sourceOrderedCommentAssetIndexes(
      comments.length,
      this.config.topCommentsPerPost,
    );
    const commentAssetPromise = Promise.all(commentAssetIndexes.map(async (index) => {
      const comment = comments[index];
      if (!comment) return;
      const commentId = safePathSegment(String(comment.comment_id || `comment-${index + 1}`));
      const avatarUrl = String(comment.avatar_url ?? "");
      comment.avatar_asset_path = (await downloadAssetIfEnabled(page, this.config, {
        enabled: this.config.downloadAvatars || this.config.downloadAssets,
        filename: `${commentId}-avatar`,
        postId,
        remoteUrl: avatarUrl,
        subdir: "comments",
      })).assetPath;
      if (!this.config.includeCommentAssets) return;
      comment.media = await Promise.all(
        limitCommentMedia(comment.media, this.config.maxMediaPerComment).map(async (media, mediaIndex) => {
          const downloaded = await downloadAssetIfEnabled(page, this.config, {
            filename: `${commentId}-image-${String(mediaIndex + 1).padStart(2, "0")}`,
            logLabel: `comment ${commentId} media #${mediaIndex + 1}`,
            mediaType: media.type,
            postId,
            remoteUrl: media.remote_url,
            subdir: "comments",
          });
          return {
            ...media,
            asset_path: downloaded.assetPath || media.asset_path,
            ...(downloaded.durationSeconds && downloaded.durationSeconds > 0
              ? { duration_seconds: downloaded.durationSeconds }
              : {}),
            height: Math.max(metricNumber(media.height), downloaded.height),
            order: mediaIndex + 1,
            remote_url: downloaded.remoteUrl || media.remote_url,
            width: Math.max(metricNumber(media.width), downloaded.width),
            downloadError: downloaded.error,
          };
        })
      ).then((media) =>
        media.flatMap(({ downloadError, ...item }) =>
          isDefinitiveAssetDownloadFailure(downloadError) ? [] : [item],
        ),
      );
    }));
    const [authorAvatarDownload, postMedia] = await Promise.all([
      authorAvatarAssetPathPromise,
      postMediaPromise,
      commentAssetPromise.then(() => undefined),
    ]).then(([authorAsset, media]) => [authorAsset, media] as const);

    return {
      authorAvatarAssetPath: authorAvatarDownload.assetPath,
      authorAvatarUrl: input.authorAvatarUrl,
      authorAvatarWarning: authorAvatarDownload.error || "",
      comments,
      postMedia,
    };
  }

  private async attachPreviewAvatars(
    page: Page,
    input: {
      authorAvatarUrl: string;
      authorUsername: string;
      comments: RawComment[];
      postId: string;
    },
  ): Promise<{
    authorAvatarAssetPath: string;
    authorAvatarUrl: string;
    authorAvatarWarning: string;
    comments: RawComment[];
  }> {
    const comments = input.comments.map((comment) => ({ ...comment }));
    if (!this.config.crawlAssets) {
      return {
        authorAvatarAssetPath: "",
        authorAvatarUrl: "",
        authorAvatarWarning: "",
        comments,
      };
    }

    const postId = safePathSegment(input.postId);
    const authorAvatarPromise = downloadAssetIfEnabled(page, this.config, {
      enabled: this.config.downloadAvatars || this.config.downloadAssets,
      filename: "author-avatar",
      logLabel: `author avatar @${safePathSegment(String(input.authorUsername || "unknown"))}`,
      postId,
      remoteUrl: input.authorAvatarUrl,
      subdir: "",
    });
    const commentAvatarIndexes = sourceOrderedCommentAssetIndexes(
      comments.length,
      this.config.topCommentsPerPost,
    );
    await Promise.all(commentAvatarIndexes.map(async (index) => {
      const comment = comments[index];
      if (!comment) return;
      const commentId = safePathSegment(String(comment.comment_id || `comment-${index + 1}`));
      comment.avatar_asset_path = (await downloadAssetIfEnabled(page, this.config, {
        enabled: this.config.downloadAvatars || this.config.downloadAssets,
        filename: `${commentId}-avatar`,
        postId,
        remoteUrl: String(comment.avatar_url ?? ""),
        subdir: "comments",
      })).assetPath;
    }));
    const authorAvatar = await authorAvatarPromise;
    return {
      authorAvatarAssetPath: authorAvatar.assetPath,
      authorAvatarUrl: input.authorAvatarUrl,
      authorAvatarWarning: authorAvatar.error || "",
      comments,
    };
  }

  private async attachAssetsToFinalPosts(posts: RawPost[]): Promise<RawPost[]> {
    if (posts.length === 0) return [];

    const output = new Array<RawPost>(posts.length);
    const downloadLimit = this.config.maxAssetDownloadPosts > 0
      ? Math.min(posts.length, this.config.maxAssetDownloadPosts)
      : posts.length;
    let nextIndex = 0;
    const workerCount = Math.min(resolveDetailConcurrency(this.config), posts.length);
    const worker = async () => {
      while (nextIndex < posts.length) {
        const index = nextIndex;
        nextIndex += 1;
        const post = structuredClone(posts[index] as RawPost);
        if (index >= downloadLimit) {
          output[index] = post;
          continue;
        }
        const assets = await this.attachAssets(undefined, {
          authorAvatarUrl: String(post.avatar_url || ""),
          authorUsername: String(post.username || ""),
          comments: Array.isArray(post.comments) ? post.comments : [],
          postId: String(post.post_id || ""),
          postMedia: filterUnmaterializedBrowserLocalMedia(normalizePostMedia(post.media)),
        });
        output[index] = {
          ...post,
          avatar_asset_path: assets.authorAvatarAssetPath,
          avatar_url: assets.authorAvatarUrl,
          comments: assets.comments,
          media: assets.postMedia,
          url_status: {
            ...(isRecord(post.url_status) ? post.url_status : {}),
            author_avatar_warning: assets.authorAvatarWarning,
          },
        };
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return output;
  }

  private async extractComments(
    page: Page,
    postId: string,
    authorUsername: string,
    postText: string,
    expectedCommentCount: number,
    signal: AbortSignal | undefined = this.config.signal,
  ): Promise<RawComment[]> {
    const desiredTopComments = Math.max(
      1,
      Math.trunc(this.config.topCommentsPerPost || 1),
    );
    const scanTargetTopComments =
      desiredTopComments +
      Math.min(6, Math.max(2, Math.ceil(desiredTopComments * 0.8)));
    this.emitProgress({
      comments_scanned: 0,
      message: `Đang lấy tối đa ${desiredTopComments} bình luận`,
      stage: "extracting_comments",
    });
    const blocks = await collectCommentBlocks(
      page,
      this.config.commentScrollRounds,
      this.config.delayMs,
      expectedCommentCount,
      scanTargetTopComments,
      signal,
      (collectedCount) => {
        this.emitProgress({
          comments_scanned: collectedCount,
          message: `Đang lấy bình luận: đã thấy ${collectedCount}/${desiredTopComments}`,
          stage: "extracting_comments",
        });
      },
    );
    const comments = parseCommentBlocks(
      blocks,
      postId,
      authorUsername,
      postText,
      { includeNestedReplies: false, preserveSourceOrder: true },
    );
    if (comments.length > 0 || blocks.length === 0 || expectedCommentCount <= 0) {
      return comments;
    }

    // Threads can render the comment anchors inside a shared container. On a
    // packaged browser/viewport the DOM heuristic may then mark every anchor
    // as a reply (or before the comment marker), producing zero comments.
    // Only relax those layout-only checks after the strict parser found none.
    return parseCommentBlocks(
      blocks,
      postId,
      authorUsername,
      postText,
      {
        includeNestedReplies: false,
        preserveSourceOrder: true,
        relaxedThreadContext: true,
      },
    );
  }
}

async function materializeBrowserLocalMedia(
  page: Page,
  config: ThreadsWebCollectorConfig,
  input: {
    filename: (index: number) => string;
    logLabel: (index: number) => string;
    media: MediaAsset[];
    postId: string;
    subdir: string;
  },
): Promise<MediaAsset[]> {
  if (!config.crawlAssets || !config.downloadAssets) return input.media;

  const materialized: MediaAsset[] = [];
  for (const [index, media] of input.media.entries()) {
    const browserDurationSeconds =
      media.type === "video"
        ? await resolveBrowserVideoDurationSeconds(page, media.remote_url)
        : undefined;
    if (!/^blob:/i.test(media.remote_url) || media.asset_path) {
      materialized.push({
        ...media,
        ...(browserDurationSeconds && browserDurationSeconds > 0
          ? { duration_seconds: browserDurationSeconds }
          : {}),
      });
      continue;
    }
    const downloaded = await downloadAssetIfEnabled(page, config, {
      filename: input.filename(index),
      logLabel: input.logLabel(index),
      mediaType: media.type,
      postId: input.postId,
      remoteUrl: media.remote_url,
      subdir: input.subdir,
    });
    materialized.push({
      ...media,
      asset_path: downloaded.assetPath || media.asset_path,
      ...(downloaded.durationSeconds && downloaded.durationSeconds > 0
        ? { duration_seconds: downloaded.durationSeconds }
        : browserDurationSeconds && browserDurationSeconds > 0
          ? { duration_seconds: browserDurationSeconds }
          : {}),
      height: Math.max(metricNumber(media.height), downloaded.height),
      remote_url: downloaded.remoteUrl || media.remote_url,
      width: Math.max(metricNumber(media.width), downloaded.width),
    });
  }
  return filterUnmaterializedBrowserLocalMedia(materialized);
}

async function materializeBrowserLocalCommentMedia(
  page: Page,
  config: ThreadsWebCollectorConfig,
  postId: string,
  comments: RawComment[],
): Promise<RawComment[]> {
  if (!config.includeCommentAssets) return comments;

  const materialized: RawComment[] = [];
  for (const [commentIndex, comment] of comments.entries()) {
    const commentId = safePathSegment(
      String(comment.comment_id || `comment-${commentIndex + 1}`),
    );
    materialized.push({
      ...comment,
      media: await materializeBrowserLocalMedia(page, config, {
        filename: (mediaIndex) =>
          `${commentId}-image-${String(mediaIndex + 1).padStart(2, "0")}`,
        logLabel: (mediaIndex) =>
          `comment ${commentId} media #${mediaIndex + 1}`,
        media: normalizeRawMedia(comment.media),
        postId,
        subdir: "comments",
      }),
    });
  }
  return materialized;
}

function isDirectPostRequest(
  config: Pick<
    ThreadsWebCollectorConfig,
    "baseUrl" | "includeHomeFeed" | "selectionRequest"
  >,
): boolean {
  const topics = config.selectionRequest?.filters.topics ?? [];
  return topics.length > 0 && topics.every((topic) => isDirectPostTopic(topic, config));
}

function pageUrlMatchesPost(url: string, postId: string): boolean {
  const expectedId = String(postId || "").trim();
  if (!expectedId) return false;
  if (matchPostUrl(String(url || ""))?.postId === expectedId) return true;
  try {
    const pathname = new URL(String(url || "")).pathname.replace(/\/+$/, "");
    return pathname === `/t/${expectedId}`;
  } catch {
    return false;
  }
}

async function resolveShareRedirectUrl(
  shareUrl: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  let currentUrl = String(shareUrl || "").trim();
  for (let hop = 0; hop < 4 && currentUrl; hop += 1) {
    throwIfAbortRequested(signal);
    try {
      const response = await fetch(currentUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0",
        },
        redirect: "manual",
        signal,
      });
      const location = response.headers.get("location");
      if (!location) return "";

      const nextUrl = new URL(location, currentUrl).toString();
      const normalizedTarget = normalizeThreadsUrl(nextUrl, baseUrl);
      const directTarget = matchPostUrl(normalizedTarget.url);
      if (directTarget) {
        // Keep Threads' signed `xmt` query on the navigation URL. It can be
        // required to resolve an older /share/ alias to the intended post;
        // normalization still removes it when the URL is stored in cache.
        return nextUrl;
      }
      if (normalizedTarget.kind !== "post" || !matchShareUrl(normalizedTarget.url)) {
        return "";
      }
      currentUrl = normalizedTarget.url;
    } catch {
      return "";
    }
  }
  return "";
}

async function recoverPostRouteFromRenderedLink(
  page: Page,
  postId: string,
  delayMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline =
    Date.now() + Math.max(8_000, Math.min(15_000, Math.max(2_000, delayMs) * 4));
  const renderedPostLink = page.locator(`a[href*="/post/${postId}"]`).first();
  const waitUntilPostRoute = async (timeoutMs: number): Promise<boolean> => {
    const routeDeadline = Math.min(deadline, Date.now() + timeoutMs);
    while (Date.now() < routeDeadline) {
      throwIfAbortRequested(signal);
      const reached = await page
        .evaluate((targetPostId) => {
          const href = String(window.location.href || "");
          if (new RegExp(`/@[^/?#]+/post/${targetPostId}(?:[/?#]|$)`, "i").test(href)) {
            return true;
          }
          return new RegExp(`/t/${targetPostId}(?:[/?#]|$)`, "i").test(href);
        }, postId)
        .catch(() => false);
      if (reached) return true;
      await waitForDelay(page, 150, signal);
    }
    return false;
  };

  while (Date.now() < deadline) {
    throwIfAbortRequested(signal);
    if ((await renderedPostLink.count().catch(() => 0)) > 0) {
      const actions: Array<() => Promise<void>> = [
        () => renderedPostLink.click({ force: true, noWaitAfter: true, timeout: 1_000 }).then(() => undefined),
        () => renderedPostLink.focus().then(() => renderedPostLink.press("Enter")),
        () =>
          page
            .evaluate((targetPostId) => {
              const extractPostId = (value: string): string =>
                String(value || "").match(/\/@[^/?#]+\/post\/([A-Za-z0-9_-]+)/)?.[1] || "";
              const anchor = Array.from(document.querySelectorAll('a[href*="/post/"]')).find(
                (candidate) =>
                  extractPostId((candidate as HTMLAnchorElement).href || "") === targetPostId,
              );
              if (!anchor) return false;
              anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
              return true;
            }, postId)
            .then(() => undefined),
        async () => {
          const box = await renderedPostLink.boundingBox();
          if (!box) return;
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        },
      ];
      for (const action of actions) {
        await action().catch(() => undefined);
        if (await waitUntilPostRoute(1_500)) return true;
        if (Date.now() >= deadline) break;
      }
    }
    await waitForDelay(page, 250, signal);
  }
  return false;
}

function hasSufficientVisibleMetrics(
  metrics: Record<string, number | string>,
): boolean {
  if (!String(metrics.source ?? "").trim()) return false;
  const positiveMetricCount = [
    "view_count",
    "reply_count",
    "repost_count",
    "like_count",
    "share_count",
  ].filter((field) => metricNumber(metrics[field]) > 0).length;
  return metricNumber(metrics.like_count) > 0 && positiveMetricCount >= 3;
}

function isDirectPostTopic(
  topic: TopicFilter,
  config: Pick<ThreadsWebCollectorConfig, "baseUrl" | "includeHomeFeed">,
): boolean {
  const seeds = expandSeedTargetUrls(topic.seed_post_urls, config.baseUrl);
  return (
    seeds.length > 0 &&
    !config.includeHomeFeed &&
    topic.search_queries.length === 0 &&
    topic.query_variants.length === 0 &&
    topic.trend_search_urls.length === 0 &&
    seeds.every(
      (value) => normalizeThreadsUrl(value, config.baseUrl).kind === "post",
    )
  );
}

function extractReliablePostMetaText(
  meta: Pick<PostMeta, "ogDescription" | "ogType">,
  displayName: string,
  username: string,
): string {
  const description = String(meta.ogDescription || "");
  const type = String(meta.ogType || "").trim().toLowerCase();
  if (type && type !== "article") return "";

  const text = extractPostText(description, displayName, username);
  return text.length >= 10 && isValidPostText(text) && !looksLikeThreadsPageShell(text)
    ? text
    : "";
}

function findRootPostComment(
  comments: RawComment[],
  authorUsername: string,
  metrics: Record<string, number | string>,
): RawComment | null {
  const normalizedAuthor = authorUsername.trim().replace(/^@/, "").toLowerCase();
  const postLikeCount = metricNumber(metrics.like_count);
  const postReplyCount = metricNumber(metrics.reply_count);
  if (!normalizedAuthor || postLikeCount <= 0 || postReplyCount <= 0) return null;

  return comments.find(
    (comment) =>
      String(comment.username || "").trim().replace(/^@/, "").toLowerCase() === normalizedAuthor &&
      metricNumber(comment.like_count) === postLikeCount &&
      metricNumber(comment.reply_count) === postReplyCount,
  ) ?? null;
}

function countPostComments(post: Pick<RawPost, "comments">): number {
  return Array.isArray(post.comments) ? post.comments.length : 0;
}

function sumCommentCounts(posts: Array<Pick<RawPost, "comments">>): number {
  return posts.reduce((total, post) => total + countPostComments(post), 0);
}

function hasFullPreviewExtraction(post: RawPost): boolean {
  return cacheHasFullExtraction(post);
}

async function collectPostMediaWithCarousel(
  page: Page,
  initialMedia: MediaAsset[],
  config: ThreadsWebCollectorConfig,
  hasVideoCandidate = false,
  postId = "",
): Promise<MediaAsset[]> {
  const maxMedia = Math.max(0, config.maxMediaPerPost);
  if (!config.crawlAssets || maxMedia === 0) return [];
  await revealSensitivePostContent(page, config.delayMs, config.signal);
  const hydratedInitialMedia = await waitForPostVideoHydration(
    page,
    initialMedia,
    config,
    hasVideoCandidate,
  );
  const media = mergeMediaAssets([], normalizePostMedia(hydratedInitialMedia));
  mergeMediaAssets(
    media,
    normalizePostMedia(await collectVisibleDocumentVideoMedia(page)),
  );
  if (postId) {
    const materialized = await materializeBrowserLocalMedia(page, config, {
      filename: (index) => `post-${String(index + 1).padStart(2, "0")}`,
      logLabel: (index) => `post media #${index + 1}`,
      media,
      postId,
      subdir: "",
    });
    mergeMediaAssets(media, materialized);
  }
  const initialMeta = await page.evaluate<PostMeta>(POST_META_SCRIPT).catch(() => null);
  mergeMediaAssets(media, normalizePostMedia(initialMeta && "media" in initialMeta ? initialMeta.media : []));
  if (postId) {
    const materialized = await materializeBrowserLocalMedia(page, config, {
      filename: (index) => `post-${String(index + 1).padStart(2, "0")}`,
      logLabel: (index) => `post media #${index + 1}`,
      media,
      postId,
      subdir: "",
    });
    mergeMediaAssets(media, materialized);
  }
  const hasMaterializedVideo = media.some(
    (item) => item.type === "video" && (!config.downloadAssets || item.asset_path),
  );
  if (hasMaterializedVideo || media.length >= maxMedia) {
    return selectCachedPostMedia(
      filterUnmaterializedBrowserLocalMedia(media),
      config.assetDir,
      config.assetPathPrefix,
    ).slice(0, maxMedia);
  }

  const attempts =
    hasVideoCandidate || media.some((item) => item.type === "video")
      ? 1
      : Math.max(0, Math.min(6, maxMedia + 2));
  const allowTranslationFallback = !hasMaterializedVideo && hasVideoCandidate;
  for (let attempt = 0; attempt < attempts && media.length < maxMedia; attempt += 1) {
    const clicked = await clickNextPostMedia(page, allowTranslationFallback);
    if (!clicked) break;
    await page.waitForTimeout(Math.min(Math.max(config.delayMs, 250), 800));
    await revealSensitivePostContent(page, config.delayMs, config.signal);
    const meta = await page.evaluate<PostMeta>(POST_META_SCRIPT).catch(() => null);
    const stateMedia = normalizePostMedia(meta && "media" in meta ? meta.media : []);
    if (postId) {
      const materialized = await materializeBrowserLocalMedia(page, config, {
        filename: (index) => `post-${String(index + 1).padStart(2, "0")}`,
        logLabel: (index) => `post media #${index + 1}`,
        media: stateMedia,
        postId,
        subdir: "",
      });
      mergeMediaAssets(media, materialized);
    } else {
      mergeMediaAssets(media, stateMedia);
    }
  }

  return selectCachedPostMedia(
    filterUnmaterializedBrowserLocalMedia(media),
    config.assetDir,
    config.assetPathPrefix,
  )
    .slice(0, maxMedia)
    .map((item, index) => ({ ...item, order: index + 1 }));
}

async function collectVisibleDocumentVideoMedia(page: Page): Promise<MediaAsset[]> {
  return page.evaluate<MediaAsset[]>(() =>
    Array.from(document.querySelectorAll("video"))
      .map((node, index) => {
        const video = node as HTMLVideoElement;
        const rect = node.getBoundingClientRect();
        const width = Math.round(video.videoWidth || rect.width || 0);
        const height = Math.round(video.videoHeight || rect.height || 0);
        const remoteUrl = String(
          video.currentSrc || video.src || video.querySelector("source")?.src || "",
        ).trim();
        return {
          asset_path: "",
          ...(Number.isFinite(video.duration) && video.duration > 0
            ? { duration_seconds: Math.min(120, Math.max(0.5, video.duration)) }
            : {}),
          height,
          order: index + 1,
          remote_url: remoteUrl,
          type: "video" as const,
          width,
          visible:
            rect.width >= 120 &&
            rect.height >= 120 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight,
        };
      })
      .filter((item) => item.visible && item.remote_url && item.width >= 120 && item.height >= 120)
      .map(({ visible: _visible, ...item }) => item),
  ).catch(() => []);
}

function filterUnmaterializedBrowserLocalMedia(media: MediaAsset[]): MediaAsset[] {
  return media.filter(
    (item) => !/^blob:/i.test(String(item.remote_url || "")) || Boolean(item.asset_path),
  );
}

function selectCachedPostMedia(
  value: unknown,
  assetDir = "",
  assetPathPrefix = "",
): MediaAsset[] {
  const media = filterUnmaterializedBrowserLocalMedia(normalizePostMedia(value));
  const videos = media.filter((item) => item.type === "video");
  if (videos.length < 2) return media;

  const sizes = new Map<string, number>();
  let largestSize = 0;
  for (const item of videos) {
    const assetPath = String(item.asset_path || "");
    let size = 0;
    try {
      size = assetPath ? cachedAssetSize(assetPath, assetDir, assetPathPrefix) : 0;
    } catch {
      size = 0;
    }
    sizes.set(assetPath, size);
    largestSize = Math.max(largestSize, size);
  }
  if (largestSize <= 0) return media;

  return media
    .filter((item) => {
      if (item.type !== "video") return true;
      const size = sizes.get(String(item.asset_path || "")) || 0;
      return size <= 0 || size * 4 >= largestSize;
    })
    .map((item, index) => ({ ...item, order: index + 1 }));
}

function selectCachedPostMediaFromCache(
  cache: PostCache,
  key: string,
  post: RawPost,
  config: Pick<ThreadsWebCollectorConfig, "assetDir" | "assetPathPrefix">,
): MediaAsset[] {
  const merged: MediaAsset[] = [];
  const postId = String(post.post_id || "").trim();
  const addMedia = (candidate: RawPost | undefined) => {
    if (!candidate) return;
    mergeMediaAssets(
      merged,
      selectCachedPostMedia(candidate.media, config.assetDir, config.assetPathPrefix),
    );
  };

  addMedia(post);
  if (!postId) return merged.map((item, index) => ({ ...item, order: index + 1 }));

  // A Threads share URL and its canonical /@user/post URL can be stored under
  // different cache keys. Prefer the union so a later empty extraction cannot
  // hide a valid local video saved by the equivalent URL.
  for (const [candidateKey, candidate] of Object.entries(cache)) {
    if (candidateKey === key || String(candidate.post_id || "").trim() !== postId) continue;
    addMedia(candidate);
  }
  return selectCachedPostMedia(merged, config.assetDir, config.assetPathPrefix);
}

function cachedAssetSize(assetPath: string, assetDir: string, assetPathPrefix: string): number {
  try {
    const normalizedPath = assetPath.replace(/\\/g, "/");
    const normalizedPrefix = assetPathPrefix.replace(/\\/g, "/").replace(/\/+$/, "");
    const filePath =
      normalizedPrefix && normalizedPath.startsWith(`${normalizedPrefix}/`)
        ? join(assetDir, ...normalizedPath.slice(normalizedPrefix.length + 1).split("/"))
        : assetPath;
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

async function waitForPostVideoHydration(
  page: Page,
  initialMedia: MediaAsset[],
  config: Pick<ThreadsWebCollectorConfig, "delayMs" | "signal">,
  hasVideoCandidate = false,
): Promise<MediaAsset[]> {
  const normalizedInitialMedia = normalizePostMedia(initialMedia);
  const expectsVideo =
    !normalizedInitialMedia.some((item) => item.type === "video") &&
    (hasVideoCandidate ||
      normalizedInitialMedia.some(
        (item) =>
          item.type === "image" &&
          isLikelyVideoPosterUrl(item.remote_url),
      ));
  if (!expectsVideo) return normalizedInitialMedia;

  const timeoutMs = Math.min(6_500, Math.max(5_000, config.delayMs * 24));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    throwIfAbortRequested(config.signal);
    await waitForDelay(
      page,
      Math.min(500, Math.max(100, deadline - Date.now())),
      config.signal,
    );
    const meta = await page.evaluate<PostMeta>(POST_META_SCRIPT).catch(() => null);
    const hydratedMedia = normalizePostMedia(
      meta && "media" in meta ? meta.media : [],
    );
    if (hydratedMedia.some((item) => item.type === "video")) {
      const orderedMedia = [...hydratedMedia];
      mergeMediaAssets(orderedMedia, normalizedInitialMedia);
      return normalizePostMedia(orderedMedia);
    }
  }

  return normalizedInitialMedia;
}

async function extractAuthorAvatarUrl(page: Page, username: string): Promise<string> {
  return page
    .evaluate((authorUsername) => {
      const normalizedUsername = String(authorUsername || "").trim().replace(/^@/, "").toLowerCase();
      if (!normalizedUsername) return "";

      const images = Array.from(document.querySelectorAll("img"));
      const candidates = images
        .map((node, index) => {
          const element = node as HTMLImageElement;
          const rect = element.getBoundingClientRect();
          const width = Math.round(rect.width || element.naturalWidth || 0);
          const height = Math.round(rect.height || element.naturalHeight || 0);
          if (width < 24 || height < 24 || width > 140 || height > 140) return null;

          const src = element.currentSrc || element.src || element.getAttribute("src") || "";
          if (!src) return null;

          const alt = String(element.getAttribute("alt") || "").trim();
          const anchor = element.closest("a[href]") as HTMLAnchorElement | null;
          const href = String(anchor?.href || "");
          const text = String(anchor?.innerText || element.parentElement?.innerText || "").replace(/\s+/g, " ").trim();
          const top = rect.top || 0;
          let score = 0;

          if (alt.toLowerCase().includes(normalizedUsername)) score += 200;
          if (href.toLowerCase().includes(`/@${normalizedUsername}`)) score += 180;
          if (text.toLowerCase().includes(normalizedUsername)) score += 80;
          if (alt.toLowerCase().includes("profile picture")) score += 40;
          if (top >= 0 && top <= 420) score += 40;
          if (top > 420) score -= Math.min(120, Math.floor((top - 420) / 8));

          return {
            index,
            score,
            src,
            top,
            width,
            height,
          };
        })
        .filter((item): item is { index: number; score: number; src: string; top: number; width: number; height: number } => Boolean(item))
        .sort((a, b) => b.score - a.score || a.top - b.top || a.index - b.index);

      const best = candidates[0];
      return best && best.score > 0 ? best.src : "";
    }, username)
    .catch(() => "");
}

function mergeMediaAssets(target: MediaAsset[], incoming: MediaAsset[]): MediaAsset[] {
  const indexes = new Map<string, number>();
  for (const [index, item] of target.entries()) {
    const key = mediaAssetIdentityKey(item.remote_url, item.asset_path);
    if (key) indexes.set(key, index);
  }
  for (const item of incoming) {
    const key = mediaAssetIdentityKey(item.remote_url, item.asset_path);
    if (!key) continue;
    const existingIndex = indexes.get(key);
    if (existingIndex !== undefined) {
      const existing = target[existingIndex];
      if (existing && !existing.asset_path && item.asset_path) {
        target[existingIndex] = { ...existing, ...item, order: existing.order };
      }
      continue;
    }
    indexes.set(key, target.length);
    target.push({
      ...item,
      order: target.length + 1,
    });
  }
  return target;
}

async function clickNextPostMedia(
  page: Page,
  allowTranslationFallback = false,
): Promise<boolean> {
  return page.evaluate<boolean>(`(() => {
    function articleRoot() {
      const links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
      const anchor = links.find((link) => /\\/@[^/]+\\/post\\/[^/?#]+/.test(link.href || "")) || links[0];
      let node = anchor || null;
      let best = null;
      while (node && node !== document.body) {
        const text = (node.innerText || "").trim();
        if (text.length >= 40 && text.length <= 9000) best = node;
        const role = node.getAttribute("role") || "";
        if (node.tagName === "ARTICLE" || role.toLowerCase() === "article") return node;
        node = node.parentElement;
      }
      return best || document.body;
    }

    const root = articleRoot();
    const mediaRects = Array.from(root.querySelectorAll("img, video"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const naturalWidth = "naturalWidth" in node ? node.naturalWidth : node.videoWidth;
        const naturalHeight = "naturalHeight" in node ? node.naturalHeight : node.videoHeight;
        const width = Math.round(rect.width || naturalWidth || 0);
        const height = Math.round(rect.height || naturalHeight || 0);
        return { height, rect, width };
      })
      .filter((item) => item.width >= 120 && item.height >= 120);
    if (!mediaRects.length) return false;

    const mediaBox = mediaRects.reduce(
      (box, item) => ({
        bottom: Math.max(box.bottom, item.rect.bottom),
        left: Math.min(box.left, item.rect.left),
        right: Math.max(box.right, item.rect.right),
        top: Math.min(box.top, item.rect.top),
      }),
      {
        bottom: Number.NEGATIVE_INFINITY,
        left: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
      }
    );
    const mediaWidth = Math.max(1, mediaBox.right - mediaBox.left);
    const blockedPattern = /(play|pause|mute|unmute|sound|volume|fullscreen|full screen|close|like|comment|reply|share|repost${allowTranslationFallback ? "" : "|translate|dich|dịch"})/i;
    const nextPattern = /(next|ti[eế]p|sau|show next|next media|media next)/i;
    const candidates = Array.from(root.querySelectorAll("button, [role='button']"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const label = [
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || "",
          node.textContent || "",
        ].join(" ").replace(/\s+/g, " ").trim();
        const disabled = node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true";
        return { disabled, label, node, rect };
      })
      .filter((item) => {
        if (item.disabled || blockedPattern.test(item.label)) return false;
        if (item.rect.width < 16 || item.rect.height < 16) return false;
        if (item.rect.top >= mediaBox.bottom || item.rect.bottom <= mediaBox.top) return false;
        if (item.rect.left < mediaBox.left + mediaWidth * 0.45) return false;
        if (!nextPattern.test(item.label) && item.rect.left < mediaBox.left + mediaWidth * 0.72) return false;
        if (!nextPattern.test(item.label)) {
          const mediaCenterY = (mediaBox.top + mediaBox.bottom) / 2;
          const controlCenterY = item.rect.top + item.rect.height / 2;
          if (Math.abs(controlCenterY - mediaCenterY) > (mediaBox.bottom - mediaBox.top) * 0.35) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aExplicit = nextPattern.test(a.label) ? 1 : 0;
        const bExplicit = nextPattern.test(b.label) ? 1 : 0;
        return bExplicit - aExplicit || b.rect.left - a.rect.left;
      });

    const candidate = candidates[0];
    if (!candidate) return false;
    const progress = Array.from(root.querySelectorAll("[aria-label], [title], span, div"))
      .map((node) => [node.getAttribute("aria-label") || "", node.getAttribute("title") || "", node.textContent || ""].join(" ").trim())
      .map((value) => value.match(/^\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*$/))
      .filter(Boolean)
      .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
      .find((item) => item.total > 1);
    if (progress && progress.current >= progress.total) return false;
    candidate.node.click();
    return true;
  })()`);
}

async function clickNextVisibleCommentMedia(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(`(() => {
    const fold = (value) => String(value || "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[\\u0111\\u0110]/g, "d")
      .toLowerCase();
    const markerPattern = /^(?:[\\u2195v]\\s*)?(?:top|hang dau|xem hoat dong|view activity)\\b/i;
    const markerTop = Array.from(document.querySelectorAll("button, [role='button']"))
      .map((node) => ({ rect: node.getBoundingClientRect(), text: fold(String(node.textContent || "").replace(/\\s+/g, " ").trim()) }))
      .filter((item) => item.rect.width > 0 && item.rect.height > 0 && item.text.length <= 180 && markerPattern.test(item.text))
      .sort((a, b) => a.rect.top - b.rect.top)[0]?.rect.top;
    if (!Number.isFinite(markerTop)) return false;

    const nextPattern = /(next|tiep|sau|show next|next media|media next|go to next|next slide|next photo|next image|anh tiep)/i;
    const blockedPattern = /(play|pause|mute|unmute|sound|volume|fullscreen|full screen|close|like|comment|reply|share|repost)/i;

    const visibleMedia = Array.from(document.querySelectorAll("img, video"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { node, rect, width: Math.round(rect.width || node.naturalWidth || node.videoWidth || 0), height: Math.round(rect.height || node.naturalHeight || node.videoHeight || 0) };
      })
      .filter((item) => item.width >= 80 && item.height >= 80 && item.rect.bottom > 0 && item.rect.top < window.innerHeight && item.rect.top >= markerTop - 20)
      .slice(0, 24);
    const candidates = [];
    const seenControls = new Set();
    for (const media of visibleMedia) {
      let current = media.node.parentElement;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        const controls = [];
        if (current.matches?.("button, [role='button']")) controls.push(current);
        const nestedControls = Array.from(current.querySelectorAll("button, [role='button']"));
        if (nestedControls.length > 0 && nestedControls.length <= 12) controls.push(...nestedControls);
        for (const node of controls) {
          if (seenControls.has(node)) continue;
          seenControls.add(node);
          const rect = node.getBoundingClientRect();
          const label = [node.getAttribute("aria-label") || "", node.getAttribute("title") || "", node.textContent || ""]
            .join(" ").replace(/\\s+/g, " ").trim();
          const explicit = nextPattern.test(label);
          const disabled = node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true";
          const progressMatch = String(current.textContent || "").match(/\\b(\\d+)\\s*\\/\\s*(\\d+)\\b/);
          const progress = progressMatch ? { current: Number(progressMatch[1]), total: Number(progressMatch[2]) } : null;
          candidates.push({ explicit, label, node, progress, rect, mediaRect: media.rect, disabled });
        }
        if (controls.length > 0) break;
        current = current.parentElement;
      }
    }

    const eligible = candidates
      .filter((item) => {
        if (item.disabled || blockedPattern.test(item.label)) return false;
        if (item.rect.bottom <= 0 || item.rect.top >= window.innerHeight || item.rect.width < 16 || item.rect.height < 16) return false;
        if (item.rect.top < markerTop - 20 || item.rect.bottom < item.mediaRect.top || item.rect.top > item.mediaRect.bottom) return false;
        if (item.progress && item.progress.total > 1 && item.progress.current >= item.progress.total) return false;
        if (item.rect.left < item.mediaRect.left + item.mediaRect.width * 0.45) return false;
        if (!item.explicit && item.rect.left < item.mediaRect.right - item.mediaRect.width * 0.28) return false;
        if (!item.explicit) {
          const mediaCenterY = (item.mediaRect.top + item.mediaRect.bottom) / 2;
          const controlCenterY = item.rect.top + item.rect.height / 2;
          if (Math.abs(controlCenterY - mediaCenterY) > item.mediaRect.height * 0.35) return false;
        }
        return true;
      })
      .sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.rect.top - a.rect.top || b.rect.left - a.rect.left);

    const candidate = eligible[0];
    if (!candidate) return false;
    candidate.node.click();
    return true;
  })()`);
}

async function revealSensitivePostContent(page: Page, delayMs: number, signal?: AbortSignal): Promise<void> {
  const sensitiveLabel = /(?:Reveal content|Show content|View content|Show sensitive content|Reveal media|Tiet lo noi dung|Xem noi dung|Hien thi noi dung)/i;

  for (let pass = 0; pass < 3; pass += 1) {
    throwIfAbortRequested(signal);
    const control = page
      .locator("button, [role='button'], a")
      .filter({ hasText: sensitiveLabel })
      .first();
    if (!(await control.isVisible().catch(() => false))) break;
    const clicked = await control
      .click({ timeout: 600 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) break;
    await waitForDelay(page, Math.min(700, Math.max(250, delayMs * 2)), signal);
  }
}

async function resolveBrowserVideoDurationSeconds(
  page: Page | undefined,
  remoteUrl: string,
): Promise<number | undefined> {
  if (!page || !remoteUrl) return undefined;
  const durationSeconds = await page
    .evaluate((url) => {
      const video = Array.from(document.querySelectorAll("video")).find(
        (candidate) => {
          const element = candidate as HTMLVideoElement;
          return [
            element.currentSrc,
            element.src,
            element.querySelector("source")?.src,
          ].includes(url);
        },
      ) as HTMLVideoElement | undefined;
      const duration = video?.duration ?? 0;
      return Number.isFinite(duration) && duration > 0 ? duration : 0;
    }, remoteUrl)
    .catch(() => 0);

  return durationSeconds > 0
    ? Math.min(120, Math.max(0.5, durationSeconds))
    : undefined;
}

async function downloadAssetIfEnabled(
  page: Page | undefined,
  config: ThreadsWebCollectorConfig,
  input: {
    enabled?: boolean;
    filename: string;
    logLabel?: string;
    mediaType?: MediaAsset["type"];
    postId: string;
    remoteUrl: string;
    subdir: string;
  }
): Promise<{
  assetPath: string;
  durationSeconds?: number;
  error?: string;
  height: number;
  remoteUrl: string;
  width: number;
}> {
  const remoteUrl = normalizeRemoteAssetUrl(String(input.remoteUrl || "").trim());
  const enabled = input.enabled ?? config.downloadAssets;
  const isBrowserLocalUrl = /^blob:/i.test(remoteUrl);
  if (!enabled || !remoteUrl || (!/^https?:\/\//i.test(remoteUrl) && !isBrowserLocalUrl)) {
    return { assetPath: "", height: 0, remoteUrl, width: 0 };
  }

  try {
    let durationSeconds =
      input.mediaType === "video"
        ? await resolveBrowserVideoDurationSeconds(page, remoteUrl)
        : undefined;
    const directorySegments = [safePathSegment(input.postId), input.subdir].filter(Boolean);
    const filename = assetFilenameWithRemoteFingerprint(input.filename, remoteUrl);
    const existingAsset = findExistingAsset(config, directorySegments, filename);
    if (existingAsset) {
      const dimensions = detectAssetDimensions(readFileSync(existingAsset.filePath), "", remoteUrl);
      return {
        assetPath: existingAsset.assetPath,
        ...(durationSeconds && durationSeconds > 0 ? { durationSeconds } : {}),
        height: dimensions?.height ?? 0,
        remoteUrl,
        width: dimensions?.width ?? 0,
      };
    }

    const fetched = await fetchAssetBytes(page, remoteUrl, config.timeoutMs);
    if (!fetched || "error" in fetched) {
      const errorMessage =
        fetched && "error" in fetched ? fetched.error : "Asset fetch returned no data.";
      if (input.logLabel) {
        console.warn(`[crawl-assets] Failed to download ${input.logLabel}: ${errorMessage} (${remoteUrl})`);
      }
      return { assetPath: "", error: errorMessage, height: 0, remoteUrl, width: 0 };
    }
    if (!durationSeconds && input.mediaType === "video") {
      durationSeconds = await resolveBrowserVideoDurationSeconds(page, remoteUrl);
    }
    const contentType =
      fetched.contentType || (input.mediaType === "video" ? "video/mp4" : "");
    const extension = extensionForAsset(remoteUrl, contentType);
    const segments = [...directorySegments, `${filename}${extension}`].filter(Boolean);
    const filePath = join(config.assetDir, ...segments);
    const body = Buffer.from(fetched.bytes);
    const dimensions = detectAssetDimensions(body, contentType, remoteUrl);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, body);
    return {
      assetPath: assetJsonPath(config.assetPathPrefix, segments),
      ...(durationSeconds && durationSeconds > 0 ? { durationSeconds } : {}),
      height: dimensions?.height ?? 0,
      remoteUrl,
      width: dimensions?.width ?? 0,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unexpected asset download failure.";
    if (input.logLabel) {
      console.warn(`[crawl-assets] Failed to persist ${input.logLabel}: ${errorMessage} (${remoteUrl})`);
    }
    return { assetPath: "", error: errorMessage, height: 0, remoteUrl, width: 0 };
  }
}

export async function fetchAssetBytes(
  page: Page | undefined,
  remoteUrl: string,
  timeoutMs: number,
): Promise<
  | { bytes: Uint8Array; contentType: string }
  | { error: string }
  | null
> {
  const effectiveTimeoutMs = Math.max(5_000, Math.min(timeoutMs, 20_000));
  const failureReasons: string[] = [];
  if (page) {
    if (/^blob:/i.test(remoteUrl)) {
      try {
        const browserFetched = await fetchBrowserLocalAssetBytes(page, remoteUrl);
        if (browserFetched && !("error" in browserFetched)) return browserFetched;
        failureReasons.push(
          `browser:${browserFetched && "error" in browserFetched ? browserFetched.error : "request_failed"}`,
        );
      } catch (error) {
        failureReasons.push(
          `browser:${error instanceof Error ? error.message : "request_failed"}`,
        );
      }
      return {
        error:
          failureReasons.length > 0
            ? failureReasons.join(" | ")
            : "Browser-local asset fetch failed.",
      };
    }
    try {
      const response = await page.context().request.get(remoteUrl, {
        failOnStatusCode: false,
        headers: {
          Accept: "video/mp4,video/webm,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: /^https?:\/\//i.test(page.url())
            ? page.url()
            : "https://www.threads.com/",
        },
        timeout: effectiveTimeoutMs,
      });
      if (response.ok()) {
        return {
          bytes: new Uint8Array(await response.body()),
          contentType: response.headers()["content-type"] ?? "",
        };
      }
      failureReasons.push(`playwright:${response.status()}`);
    } catch (error) {
      failureReasons.push(
        `playwright:${error instanceof Error ? error.message : "request_failed"}`,
      );
    }
  }

  const attemptHeaders: Array<Record<string, string>> = [
    {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
    },
    {
      Accept: "image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
    },
    {},
  ];
  for (const headers of attemptHeaders) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    try {
      const response = await fetch(remoteUrl, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        failureReasons.push(`fetch:${response.status}`);
        continue;
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || "",
      };
    } catch (error) {
      failureReasons.push(
        `fetch:${error instanceof Error ? error.message : "request_failed"}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    error:
      failureReasons.length > 0
        ? failureReasons.join(" | ")
        : "Asset fetch failed.",
  };
}

export async function fetchBrowserLocalAssetBytes(
  page: Page,
  remoteUrl: string,
): Promise<
  | { bytes: Uint8Array; contentType: string }
  | { error: string }
  | null
> {
  const result = await page.evaluate(
    async (url): Promise<{ base64: string; contentType: string } | { error: string } | null> => {
      try {
        const response = await fetch(url);
        if (!response.ok) return { error: `status_${response.status}` };
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return {
          base64: btoa(binary),
          contentType: response.headers.get("content-type") || "",
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "request_failed" };
      }
    },
    remoteUrl,
  );
  if (!result) return null;
  if ("error" in result) {
    const captured = await captureBrowserVideoBytes(page, remoteUrl);
    if (captured && !("error" in captured)) return captured;
    return {
      error: [result.error, captured && "error" in captured ? `capture:${captured.error}` : ""]
        .filter(Boolean)
        .join(" | "),
    };
  }
  return {
    bytes: Buffer.from(result.base64, "base64"),
    contentType: result.contentType,
  };
}

async function captureBrowserVideoBytes(
  page: Page,
  remoteUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string } | { error: string } | null> {
  const result = await page.evaluate(
    async (url): Promise<
      | { base64: string; contentType: string; declaredDurationMs: number; recordedDurationMs: number }
      | { error: string }
      | null
    > => {
      const video = Array.from(document.querySelectorAll("video")).find((candidate) => {
        const element = candidate as HTMLVideoElement;
        return [element.currentSrc, element.src, element.querySelector("source")?.src].includes(url);
      }) as HTMLVideoElement | undefined;
      if (!video) return { error: "video_element_not_found" };
      const captureStream = (video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
      }).captureStream;
      if (typeof captureStream !== "function") return { error: "capture_stream_unsupported" };
      if (typeof MediaRecorder === "undefined") return { error: "media_recorder_unsupported" };

      const mimeTypes = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
      const mimeType = mimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
      const stream = captureStream.call(video);
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const stopped = new Promise<void>((resolve) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        });
        recorder.addEventListener("stop", () => resolve(), { once: true });
      });
      const wasMuted = video.muted;
      const wasPaused = video.paused;
      try {
        video.muted = true;
        if (video.readyState < 2) {
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            video.addEventListener("loadeddata", done, { once: true });
            setTimeout(done, 4_000);
          });
        }
        try {
          video.currentTime = 0;
        } catch {
          // Some MediaSource videos do not allow seeking before playback starts.
        }
        recorder.start(250);
        try {
          await video.play();
        } catch {
          // The video may already be playing or autoplay may be blocked.
        }
        const durationMs = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(120_000, Math.max(2_000, video.duration * 1_000 + 750))
          : 30_000;
        await Promise.race([
          new Promise<void>((resolve) => video.addEventListener("ended", () => resolve(), { once: true })),
          new Promise<void>((resolve) => setTimeout(resolve, durationMs)),
        ]);
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;
      } finally {
        if (recorder.state !== "inactive") recorder.stop();
        video.muted = wasMuted;
        if (wasPaused) video.pause();
        for (const track of stream.getTracks()) track.stop();
      }
      if (chunks.length === 0) return { error: "capture_empty" };
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const declaredDurationMs = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration * 1_000
        : 0;
      const recordedDurationMs = Math.max(0, video.currentTime * 1_000);
      let binary = "";
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return {
        base64: btoa(binary),
        contentType: blob.type || "video/webm",
        declaredDurationMs,
        recordedDurationMs,
      };
    },
    remoteUrl,
  );
  if (!result) return null;
  if ("error" in result) return result;
  return {
    bytes: Buffer.from(result.base64, "base64"),
    contentType: result.contentType,
  };
}

export function isDefinitiveAssetDownloadFailure(error: string | undefined): boolean {
  return /\b(?:400|401|403|404|410)\b/.test(String(error || ""));
}

function findExistingAsset(
  config: ThreadsWebCollectorConfig,
  directorySegments: string[],
  filename: string,
): { assetPath: string; filePath: string } | null {
  const directory = join(config.assetDir, ...directorySegments);
  if (!existsSync(directory)) return null;
  try {
    const match = readdirSync(directory)
      .filter((entry) => entry.startsWith(`${filename}.`))
      .sort()[0];
    return match
      ? {
          assetPath: assetJsonPath(config.assetPathPrefix, [...directorySegments, match]),
          filePath: join(directory, match),
        }
      : null;
  } catch {
    return null;
  }
}

function assetFilenameWithRemoteFingerprint(filename: string, remoteUrl: string): string {
  const baseName = safePathSegment(filename);
  const assetKey = stableAssetCacheKey(remoteUrl);
  if (!assetKey) return baseName;
  const fingerprint = createHash("sha1").update(assetKey).digest("hex").slice(0, 10);
  return safePathSegment(`${baseName}-${fingerprint}`);
}

function stableAssetCacheKey(remoteUrl: string): string {
  const normalized = normalizeRemoteAssetUrl(String(remoteUrl || "").trim());
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    const stableParams = new URLSearchParams();
    for (const key of ["ig_cache_key", "stp"]) {
      const value = String(url.searchParams.get(key) || "").trim();
      if (value) stableParams.set(key, value);
    }
    const query = stableParams.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return normalized;
  }
}

async function collectCommentBlocks(
  page: Page,
  scrollRounds: number,
  delayMs: number,
  expectedCommentCount: number,
  targetTopComments: number,
  signal?: AbortSignal,
  onProgress?: (collectedCount: number) => void,
): Promise<CommentBlock[]> {
  const collected = new Map<string, CommentBlock>();
  const expectedCount = Math.max(0, Math.trunc(expectedCommentCount || 0));
  const desiredTopComments = Math.max(1, Math.trunc(targetTopComments || 1));
  const expectedCoversRequestedTarget = expectedCount >= desiredTopComments;
  const profile = buildCommentScanProfile(scrollRounds, expectedCount, desiredTopComments, delayMs);
  const maxRounds = profile.maxRounds;
  const minRoundsBeforeStableStop = Math.min(
    maxRounds,
    Math.max(profile.minStableRounds, profile.minimumCollectedTarget > 0 ? Math.ceil(profile.minimumCollectedTarget * 0.5) : 0),
  );
  const scanDelayMs = profile.scanDelayMs;
  let stableBottomRounds = 0;
  let stableTopRounds = 0;
  let previousFrontierSignature = "";
  let previousState: CommentScrollState | null = null;
  await page.mouse.move(760, 760).catch(() => undefined);
  const mediaPassLimit = expectedCount >= 500 ? 3 : 6;

  for (let round = 0; round < maxRounds; round += 1) {
    throwIfAbortRequested(signal);
    if (page.isClosed()) break;
    if (round === 0 || round === 2 || (round >= 8 && round % 4 === 0)) {
      await expandCommentListControls(page, delayMs, signal);
    }
    if (round === 1 || (round >= 5 && round % 5 === 0)) {
      await expandCommentControls(page, delayMs, signal);
    }
    let blocks: Array<CommentBlock> = [];
    try {
      blocks = await page.evaluate<Array<CommentBlock>>(COMMENT_BLOCKS_SCRIPT);
    } catch (error) {
      if (page.isClosed() || isClosedPageError(error)) break;
      throw error;
    }
    let added = 0;
    for (const block of blocks) {
      if (upsertCommentBlock(collected, block)) added += 1;
    }

    // A comment carousel exposes one slide at a time. Walk the visible
    // comment carousels before deciding that the current scroll pass is
    // stable, then merge each newly exposed slide into the same comment.
    for (let mediaPass = 0; mediaPass < mediaPassLimit; mediaPass += 1) {
      let clicked = false;
      try {
        clicked = await clickNextVisibleCommentMedia(page);
      } catch (error) {
        if (page.isClosed() || isClosedPageError(error)) break;
        throw error;
      }
      if (!clicked) break;
      await waitForDelay(page, Math.min(700, Math.max(180, delayMs)), signal);
      const carouselBlocks = await page.evaluate<Array<CommentBlock>>(COMMENT_BLOCKS_SCRIPT).catch(() => []);
      for (const block of carouselBlocks) {
        if (upsertCommentBlock(collected, block)) added += 1;
      }
    }
    onProgress?.(countTopLevelCommentBlocks(collected));

    const frontier = buildCommentTopFrontier(collected.values(), desiredTopComments, expectedCount);
    const hasEnoughTopCandidates = frontier ? frontier.loadedCount >= frontier.targetCount : false;
    if (frontier && hasEnoughTopCandidates) {
      stableTopRounds =
        frontier.signature === previousFrontierSignature
          ? stableTopRounds + 1
          : 1;
      previousFrontierSignature = frontier.signature;
    } else {
      stableTopRounds = 0;
      previousFrontierSignature = frontier?.signature ?? "";
    }

    if (page.isClosed()) break;
    const state = await readCommentScrollState(page);
    const atBottom = state.bottomGap <= Math.max(900, state.innerHeight * 0.75);
    const heightStable = previousState ? Math.abs(state.scrollHeight - previousState.scrollHeight) < 80 : false;
    const yStable = previousState ? Math.abs(state.scrollY - previousState.scrollY) < 80 : false;
    if (atBottom && heightStable && yStable && added === 0) stableBottomRounds += 1;
    else if (!atBottom || added > 0) stableBottomRounds = 0;
    const enoughRoundsForKnownCount =
      round >= minRoundsBeforeStableStop ||
      collected.size >= profile.minimumCollectedTarget ||
      (expectedCoversRequestedTarget &&
        collected.size >= Math.min(expectedCount, profile.expectedCountStopTarget));
    const enoughTopConfidence = frontier
      ? frontier.loadedCount >= frontier.targetCount &&
        round >= profile.minTopConfidenceRounds &&
        stableTopRounds >= profile.topFrontierStableRounds
      : false;
    if (enoughTopConfidence) break;
    if (enoughRoundsForKnownCount && stableBottomRounds >= profile.stableBottomRounds) break;
    previousState = state;

    // One scroll event is enough to trigger Threads' virtualized comment
    // loader. Sending both a mouse wheel and window.scrollBy here causes two
    // layouts/network loads per round and can skip over lazy-loaded blocks.
    await page.mouse
      .wheel(0, Math.max(2200, Math.floor(state.innerHeight * 1.8)))
      .catch(() => undefined);
    await waitForDelay(page, scanDelayMs, signal);
  }

  if (!page.isClosed()) {
    await expandCommentListControls(page, delayMs, signal);
    await expandCommentControls(page, delayMs, signal);
  }
  const finalBlocks = page.isClosed()
    ? []
    : await page.evaluate<Array<CommentBlock>>(COMMENT_BLOCKS_SCRIPT).catch(() => []);
  for (const block of finalBlocks) {
    upsertCommentBlock(collected, block);
  }

  return [...collected.values()];
}

function isClosedPageError(error: unknown): boolean {
  return /target page, context or browser has been closed/i.test(
    error instanceof Error ? error.message : String(error ?? ""),
  );
}

function countTopLevelCommentBlocks(collected: Map<string, CommentBlock>): number {
  let count = 0;
  for (const block of collected.values()) {
    if (!block.isReply) count += 1;
  }
  return count;
}

async function readCommentScrollState(page: Page): Promise<CommentScrollState> {
  return page
    .evaluate<CommentScrollState>(() => {
      const scrollingElement = document.scrollingElement || document.documentElement;
      const scrollY = window.scrollY || scrollingElement.scrollTop || 0;
      const innerHeight = window.innerHeight || scrollingElement.clientHeight || 0;
      const scrollHeight = Math.max(
        scrollingElement.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0
      );
      return {
        bottomGap: Math.max(0, scrollHeight - scrollY - innerHeight),
        innerHeight,
        scrollHeight,
        scrollY,
      };
    })
    .catch(() => ({ bottomGap: 0, innerHeight: 0, scrollHeight: 0, scrollY: 0 }));
}

function upsertCommentBlock(collected: Map<string, CommentBlock>, block: unknown): boolean {
  if (!isRecord(block)) return false;
  if (Boolean(block.isRootPost)) return false;
  if (Boolean(block.isBeforeCommentSection)) return false;
  const username = String(block.username ?? "").trim().replace(/^@/, "");
  const text = cleanPostText(String(block.text ?? ""));
  if (!username || !text) return false;
  const key = `${username.toLowerCase()}\n${text.toLowerCase()}`;
  const normalized: CommentBlock = {
    avatarUrl: String(block.avatarUrl ?? ""),
    href: String(block.href ?? ""),
    isRootPost: Boolean(block.isRootPost),
    isBeforeCommentSection: Boolean(block.isBeforeCommentSection),
    isReply: Boolean(block.isReply),
    likeCount: metricNumber(block.likeCount),
    media: normalizeRawMedia(block.media),
    metricTexts: asStringList(block.metricTexts),
    replyCount: metricNumber(block.replyCount),
    text,
    top: finiteNumber(block.top),
    commentSectionTop: finiteNumberOrNull(block.commentSectionTop),
    username,
  };
  const existing = collected.get(key);
  if (existing) {
    const existingMedia = normalizeRawMedia(existing.media);
    const normalizedMedia = normalizeRawMedia(normalized.media);
    const mergedMedia = normalizeRawMedia([
      ...existingMedia,
      ...normalizedMedia,
    ]);
    const mediaChanged = mergedMedia.length > existingMedia.length;
    // A virtualized Threads tree can expose the same card with different
    // wrappers on different scroll passes. If any pass identifies it as a
    // reply, keep that stronger classification so a popular reply cannot
    // later consume a top-level comment slot.
    if (normalized.isReply && !existing.isReply) {
      collected.set(key, { ...normalized, media: mergedMedia });
      return true;
    }
    if (existing.isReply && !normalized.isReply) {
      if (mediaChanged) collected.set(key, { ...existing, media: mergedMedia });
      return mediaChanged;
    }
    const existingRank = commentBlockRank(existing);
    const normalizedRank = commentBlockRank(normalized);
    if (existingRank >= normalizedRank) {
      if (!mediaChanged) return false;
      collected.set(key, { ...existing, media: mergedMedia });
      return true;
    }
    normalized.media = mergedMedia;
  }
  collected.set(key, normalized);
  return true;
}

function commentBlockRank(block: CommentBlock): number {
  return commentCandidateRank(block);
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function expandCommentControls(page: Page, delayMs: number, signal?: AbortSignal): Promise<void> {
  const labels = [
    "View replies",
    "View more replies",
    "More replies",
    "Show more replies",
    "Load more replies",
    "View more comments",
    "Load more comments",
    "See more replies",
    "Xem câu trả lời",
    "Xem thêm câu trả lời",
    "Thêm câu trả lời",
    "Xem thêm bình luận",
    "Tải thêm bình luận",
  ];

  for (let pass = 0; pass < 3; pass += 1) {
    throwIfAbortRequested(signal);
    let clicked = false;
    for (const label of labels) {
      try {
        const locator = page.locator("button, [role='button'], a, div").filter({ hasText: label });
        const count = Math.min(5, await locator.count().catch(() => 0));
        for (let index = 0; index < count; index += 1) {
          throwIfAbortRequested(signal);
          await locator.nth(index).click({ force: true, timeout: 800 });
          clicked = true;
          await waitForDelay(page, Math.min(700, Math.max(250, delayMs / 2)), signal);
        }
      } catch {
        continue;
      }
    }
    if (!clicked) break;
  }
}

async function expandCommentListControls(page: Page, delayMs: number, signal?: AbortSignal): Promise<void> {
  const loadMoreLabel = /(?:View more comments|More comments|Load more comments|See more comments|Xem thêm bình luận|Tải thêm bình luận|Thêm bình luận)/i;

  for (let pass = 0; pass < 3; pass += 1) {
    throwIfAbortRequested(signal);
    const controls = page
      .locator("button, [role='button'], a")
      .filter({ hasText: loadMoreLabel });
    const count = Math.min(3, await controls.count().catch(() => 0));
    let clicked = false;
    for (let index = 0; index < count; index += 1) {
      throwIfAbortRequested(signal);
      const control = controls.nth(index);
      if (!(await control.isVisible().catch(() => false))) continue;
      clicked = await control
        .click({ force: true, timeout: 600 })
        .then(() => true)
        .catch(() => false);
      if (clicked) break;
    }
    if (!clicked) break;
    await waitForDelay(page, Math.min(500, Math.max(180, delayMs / 2)), signal);
  }
}

function makeListingRequest(
  url: string,
  matchedQuery: string,
  source: ListingSource,
  scope: string,
  windowStartDate?: string,
  windowEndDate?: string,
): RequestOptions {
  return {
    url,
    uniqueKey: `${scope}:listing:${source}:${matchedQuery}:${windowStartDate || ""}:${windowEndDate || ""}:${url}`,
    userData: {
      kind: "listing",
      matchedQuery,
      source,
      windowEndDate,
      windowStartDate,
    } satisfies RequestUserData,
  };
}

function normalizeTrendSearchUrls(
  values: string[] | undefined,
  baseUrl: string,
): Array<{ label: string; url: string }> {
  const base = new URL(baseUrl.replace(/\/$/, ""));
  const seen = new Set<string>();
  const output: Array<{ label: string; url: string }> = [];

  for (const value of values ?? []) {
    const raw = String(value || "").trim();
    if (!raw) continue;

    let parsed: URL;
    try {
      parsed = new URL(raw, base);
    } catch {
      continue;
    }

    if (!parsed.pathname.startsWith("/search")) continue;
    const trendFbid = parsed.searchParams.get("trend_fbid")?.trim() ?? "";
    const serpType = parsed.searchParams.get("serp_type")?.trim().toLowerCase() ?? "";
    if (!trendFbid && serpType !== "trends") continue;

    parsed.protocol = base.protocol;
    parsed.host = base.host;
    const url = parsed.toString();
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const queryLabel = parsed.searchParams.get("q")?.trim();
    output.push({
      label: queryLabel ? `trend:${queryLabel}` : `trend_fbid:${trendFbid || "unknown"}`,
      url,
    });
  }

  return output;
}

function makePostRequest(
  url: string,
  matchedQuery: string,
  source: "seed_post_urls" | ListingSource,
  scope: string,
  stage = "summary",
  windowStartDate?: string,
  windowEndDate?: string,
): RequestOptions {
  return {
    url,
    uniqueKey: `${scope}:post:${stage}:${cacheKey(url)}:${windowStartDate || ""}:${windowEndDate || ""}`,
    userData: {
      kind: "post",
      matchedQuery,
      source,
      windowEndDate,
      windowStartDate,
    } satisfies RequestUserData,
  };
}

function buildCollectorAuditRows(
  posts: RawPost[],
  topic: TopicFilter,
  request: CrawlRequest | undefined,
  skipLoadedCommentGate: boolean,
): Array<Record<string, unknown>> {
  if (!request) {
    return posts.map((post, index) => ({
      discovery_source: String(post.discovery_source ?? ""),
      post_id: String(post.post_id ?? ""),
      rank: index + 1,
      url: String(post.url ?? post.source_url ?? ""),
      username: String(post.username ?? ""),
    }));
  }
  const metricPeaks = buildPostMetricPeaks(posts, request.created_at);
  const rows = posts.map((post) => {
    const evaluated = evaluateRawPostForOutput(post, topic, request, {
      metricPeaks,
      skipLoadedCommentGate,
    });
    return {
      created_at: String(post.created_at ?? ""),
      discovery_source: String(post.discovery_source ?? ""),
      post_id: String(post.post_id ?? ""),
      reason: evaluated.accepted ? "accepted" : evaluated.reason,
      score: evaluated.accepted ? evaluated.score : Number(evaluated.score ?? 0),
      url: String(post.url ?? post.source_url ?? ""),
      username: String(post.username ?? ""),
    };
  });
  rows.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildBasicCollectorAuditRow(
  post: RawPost,
  reason: string,
): Record<string, unknown> {
  return {
    created_at: String(post.created_at ?? ""),
    discovery_source: String(post.discovery_source ?? ""),
    post_id: String(post.post_id ?? ""),
    reason,
    url: String(post.url ?? post.source_url ?? ""),
    username: String(post.username ?? ""),
  };
}

function rankCollectorAuditRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return [...rows]
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildRawPostSourceBreakdown(posts: RawPost[]): Record<string, number> {
  return posts.reduce<Record<string, number>>((counts, post) => {
    const source = String(post.discovery_source ?? "unknown").trim() || "unknown";
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizeRequestSource(
  post: Pick<RawPost, "discovery_source" | "matched_query">,
): "seed_post_urls" | ListingSource {
  const source = String(post.discovery_source ?? "").trim();
  if (
    source === "seed_post_urls" ||
    source === "home_feed" ||
    source === "profile" ||
    source === "search" ||
    source === "trend_search"
  ) {
    return source;
  }
  return String(post.matched_query ?? "") === "seed_post_urls"
    ? "seed_post_urls"
    : "search";
}

export function candidateSourceCap(
  source: Candidate["source"],
  config: ThreadsWebCollectorConfig,
  options: {
    diversifyBlankViralMode: boolean;
    targetPostCount: number;
  },
): number {
  if (!options.diversifyBlankViralMode || source !== "home_feed") {
    return Number.POSITIVE_INFINITY;
  }

  const candidateLimit = Math.max(1, Math.trunc(config.maxCandidateLinks || 1));
  const targetOutputPosts = Math.max(1, Math.trunc(config.targetOutputPosts || 1));
  const targetInspectPosts = Math.max(targetOutputPosts, Math.trunc(options.targetPostCount || 0));
  return Math.max(
    targetOutputPosts + 5,
    Math.ceil(targetInspectPosts * 0.42),
    Math.ceil(candidateLimit * 0.24),
    10,
  );
}

export function candidateOriginCap(
  source: Candidate["source"],
  config: ThreadsWebCollectorConfig,
  options: {
    diversifyBlankViralMode: boolean;
    targetPostCount: number;
  },
): number {
  if (!options.diversifyBlankViralMode || source !== "profile") {
    return Number.POSITIVE_INFINITY;
  }

  const targetOutputPosts = Math.max(1, Math.trunc(config.targetOutputPosts || 1));
  const targetInspectPosts = Math.max(targetOutputPosts, Math.trunc(options.targetPostCount || 0));
  return Math.max(
    4,
    Math.min(
      8,
      targetOutputPosts + 3,
      Math.max(4, Math.ceil(targetInspectPosts * 0.25)),
    ),
  );
}

function spreadCandidatesAcrossListingDepth(
  candidates: Candidate[],
  limit: number,
): Candidate[] {
  const safeLimit = Math.max(1, Math.trunc(limit || 1));
  if (candidates.length <= safeLimit) return candidates;

  const recentQuota = Math.max(4, Math.ceil(safeLimit * 0.25));
  const selectedIndexes = new Set<number>();
  for (let index = 0; index < Math.min(recentQuota, candidates.length); index += 1) {
    selectedIndexes.add(index);
  }

  const remainingQuota = safeLimit - selectedIndexes.size;
  const depthStart = Math.min(recentQuota, candidates.length - 1);
  const depthSpan = Math.max(1, candidates.length - 1 - depthStart);
  for (let index = 0; index < remainingQuota; index += 1) {
    const ratio = remainingQuota <= 1 ? 1 : index / (remainingQuota - 1);
    selectedIndexes.add(Math.round(depthStart + depthSpan * ratio));
  }

  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => candidates[index])
    .filter((candidate): candidate is Candidate => Boolean(candidate));
}

function homeFeedCandidateBudget(config: ThreadsWebCollectorConfig): number {
  const candidateLimit = Math.max(1, Math.trunc(config.maxCandidateLinks || 1));
  const summaryLimit = Math.max(
    1,
    Math.trunc(config.maxCollectedPostsPerTopic || candidateLimit),
  );
  const sourcePool = Math.min(candidateLimit, summaryLimit);
  return Math.max(24, Math.min(candidateLimit, Math.ceil(sourcePool * 0.6)));
}

function buildDatedProfileBackfillRequests(
  posts: RawPost[],
  config: ThreadsWebCollectorConfig,
  scope: string,
): RequestOptions[] {
  const ranked = [...posts].sort(
    (left, right) => profileBackfillSeedScore(right) - profileBackfillSeedScore(left),
  );
  const seen = new Set<string>();
  const requests: RequestOptions[] = [];
  const profileLimit = resolveProfileBackfillLimit(config.targetOutputPosts);
  for (const post of ranked) {
    const username = String(post.username || "").trim().replace(/^@/, "");
    const key = username.toLowerCase();
    if (!username || seen.has(key) || !/^[a-zA-Z0-9._]+$/.test(username)) continue;
    seen.add(key);
    const url = `${config.baseUrl.replace(/\/$/, "")}/@${username}`;
    requests.push(makeListingRequest(url, `profile:${username}`, "profile", scope));
    if (requests.length >= profileLimit) break;
  }
  return requests;
}

export function resolveAdaptiveViralReserveTarget(targetInput: number): number {
  const target = Math.max(1, Math.trunc(targetInput || 1));
  if (target <= 10) {
    return Math.max(target + 8, Math.ceil(target * 3), 18);
  }
  const reserveMultiplier = target <= 20 ? 1.6 : 1.35;
  return Math.max(target + 6, Math.ceil(target * reserveMultiplier));
}

export function shouldRetainDetailedPostForFinalComparison(
  evaluatedAccepted: boolean,
  compareFullReserveBeforeFinalSelection: boolean,
): boolean {
  return evaluatedAccepted || compareFullReserveBeforeFinalSelection;
}

export function resolveProfileBackfillLimit(targetInput: number): number {
  const target = Math.max(1, Math.trunc(targetInput || 1));
  if (target <= 3) return Math.min(10, Math.max(8, target + 5));
  if (target <= 10) return 32;
  return Math.min(40, Math.max(18, Math.ceil(target * 1.8)));
}

export function resolveViralProfileSummaryTarget(targetInput: number): number {
  const target = Math.max(1, Math.trunc(targetInput || 1));
  const requiredNonHomePosts = target - Math.floor(target * 0.4);
  const smallTargetReserve = target <= 10 ? 32 : target + 8;
  const nonHomeMultiplier = target <= 10 ? 10 : 2.5;
  return Math.min(
    target <= 10 ? 32 : 40,
    Math.max(smallTargetReserve, Math.ceil(requiredNonHomePosts * nonHomeMultiplier)),
  );
}

export function isAdaptiveViralReserveReady(
  posts: RawPost[],
  topic: TopicFilter,
  request: CrawlRequest,
  reserveTargetInput: number,
): boolean {
  const reserveTarget = Math.max(0, Math.trunc(reserveTargetInput || 0));
  if (reserveTarget <= 0 || posts.length < reserveTarget) return false;
  return selectFinalPostsForOutput(posts, topic, request, reserveTarget, {
    skipLoadedCommentGate: true,
  }).length >= reserveTarget;
}

function profileBackfillSeedScore(post: RawPost): number {
  return (
    safeMetricNumber(post.view_count) +
    safeMetricNumber(post.like_count) * 55 +
    safeMetricNumber(post.reply_count) * 130 +
    (safeMetricNumber(post.repost_count) +
      safeMetricNumber(post.share_count) +
      safeMetricNumber(post.quote_count)) *
      210
  );
}

function safeMetricNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function resolveSummaryRequestBacklogLimit(
  config: ThreadsWebCollectorConfig,
  targetPostCount: number,
  useSummaryFirst: boolean,
): number {
  if (!useSummaryFirst) return Number.POSITIVE_INFINITY;
  const targetOutputPosts = Math.max(1, Math.trunc(config.targetOutputPosts || 1));
  const targetInspectPosts = Math.max(targetOutputPosts, Math.trunc(targetPostCount || 0));
  return Math.max(
    24,
    Math.min(
      80,
      Math.max(
        targetOutputPosts * 4,
        targetOutputPosts + 24,
        Math.ceil(targetInspectPosts * 0.45),
      ),
    ),
  );
}

function resolveDetailRequestTimeoutMs(config: ThreadsWebCollectorConfig): number {
  const base = Math.max(120_000, config.timeoutMs * 4);
  return Math.min(180_000, base);
}

function resolveDetailConcurrency(config: ThreadsWebCollectorConfig): number {
  const configured = Math.max(1, Math.trunc(config.maxConcurrency || 1));
  return Math.max(1, Math.min(3, configured));
}

function resolvePostNavigationTimeoutMs(config: ThreadsWebCollectorConfig): number {
  return Math.max(10_000, Math.min(config.timeoutMs, 30_000));
}

function navigationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

function buildSearchQueryPlans(
  topic: TopicFilter,
  config: ThreadsWebCollectorConfig,
): SearchQueryPlan[] {
  const exploratoryViralTopic = isExploratoryViralTopic(topic, config);
  const queryWindows =
    config.dateQueryWindows.length > 0
      ? config.dateQueryWindows
      : exploratoryViralTopic
        ? buildExploratoryQueryWindows(12)
        : [];
  const baseQueries = buildThreadsQueries(topic, {
    dateEnd: config.dateEnd,
    dateQueryWindows: queryWindows,
    dateStart: config.dateStart,
  }).map((query) => ({ query }));
  if (!shouldUseWindowedSearchPlans(topic, config) || queryWindows.length === 0) {
    return baseQueries;
  }

  const queriesPerWindow = config.dateStart || config.dateEnd ? 2 : 3;
  const perWindowPlans = queryWindows
    .map((window, windowIndex) => {
      const windowQueries = buildThreadsQueries(topic, {
        dateEnd: window.endDate,
        dateQueryWindows: [],
        dateStart: window.startDate,
      });
      const queries = exploratoryViralTopic
        ? rotateWindowQueries(windowQueries, windowIndex, queriesPerWindow)
        : windowQueries.slice(0, queriesPerWindow);
      return queries.map((query) => ({
        query,
        windowEndDate: window.endDate,
        windowStartDate: window.startDate,
      }));
    })
    .filter((plans) => plans.length > 0);

  const interleaved: SearchQueryPlan[] = [];
  const maxLength = perWindowPlans.reduce((max, plans) => Math.max(max, plans.length), 0);
  for (let index = 0; index < maxLength; index += 1) {
    for (const plans of perWindowPlans) {
      const plan = plans[index];
      if (plan) interleaved.push(plan);
    }
  }

  return dedupeQueryPlans([...interleaved, ...baseQueries]);
}

function rotateWindowQueries(
  queries: string[],
  windowIndex: number,
  count: number,
): string[] {
  const cleanQueries = queries.map((query) => query.trim()).filter(Boolean);
  if (cleanQueries.length === 0) return [];
  const safeCount = Math.max(1, Math.trunc(count || 1));
  const startIndex = (Math.max(0, windowIndex) * safeCount) % cleanQueries.length;
  const output: string[] = [];
  for (let offset = 0; offset < safeCount && offset < cleanQueries.length; offset += 1) {
    output.push(cleanQueries[(startIndex + offset) % cleanQueries.length] ?? "");
  }
  return output.filter(Boolean);
}

function buildExploratoryQueryWindows(
  monthCount: number,
): Array<{ startDate: string; endDate: string }> {
  const safeMonthCount = Math.max(1, Math.trunc(monthCount || 1));
  const windows: Array<{ startDate: string; endDate: string }> = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);

  for (let index = 0; index < safeMonthCount; index += 1) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index, 1));
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index + 1, 0));
    windows.push({
      endDate: monthEnd.toISOString().slice(0, 10),
      startDate: monthStart.toISOString().slice(0, 10),
    });
  }

  return windows;
}

function shouldUseWindowedSearchPlans(
  topic: TopicFilter,
  config: ThreadsWebCollectorConfig,
): boolean {
  if (isExploratoryViralTopic(topic, config)) {
    return true;
  }
  if (!(config.dateStart || config.dateEnd)) {
    return false;
  }

  const title = normalizeLooseLabel(topic.topic_title);
  const intent = normalizeLooseLabel(topic.topic_intent);
  const hasSignalQueries =
    topic.search_queries.some((value) => String(value || "").trim()) ||
    topic.query_variants.some((value) => String(value || "").trim()) ||
    topic.required_keywords.some((value) => String(value || "").trim()) ||
    topic.keywords.some((value) => String(value || "").trim()) ||
    topic.seed_post_urls.some((value) => String(value || "").trim()) ||
    (topic.trend_search_urls ?? []).some((value) => String(value || "").trim());
  const viralLike =
    title === "" ||
    title === "viral" ||
    title === "viral feed" ||
    intent === "" ||
    intent === "viral" ||
    intent === "viral feed";
  return viralLike && !hasSignalQueries;
}

function dedupeQueryPlans(plans: SearchQueryPlan[]): SearchQueryPlan[] {
  const seen = new Set<string>();
  const output: SearchQueryPlan[] = [];
  for (const plan of plans) {
    const query = String(plan.query || "").trim();
    if (!query) continue;
    const key = [
      query.toLowerCase(),
      String(plan.windowStartDate || ""),
      String(plan.windowEndDate || ""),
    ].join("\n");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      query,
      windowEndDate: plan.windowEndDate,
      windowStartDate: plan.windowStartDate,
    });
  }
  return output;
}

function isExploratoryViralTopic(
  topic: TopicFilter,
  config: ThreadsWebCollectorConfig,
): boolean {
  if (config.dateStart || config.dateEnd) return false;
  const title = normalizeLooseLabel(topic.topic_title);
  const intent = normalizeLooseLabel(topic.topic_intent);
  const hasSignalQueries =
    topic.search_queries.some((value) => String(value || "").trim()) ||
    topic.query_variants.some((value) => String(value || "").trim()) ||
    topic.required_keywords.some((value) => String(value || "").trim()) ||
    topic.keywords.some((value) => String(value || "").trim()) ||
    topic.seed_post_urls.some((value) => String(value || "").trim()) ||
    (topic.trend_search_urls ?? []).some((value) => String(value || "").trim());
  const viralLike =
    title === "" ||
    title === "viral" ||
    title === "viral feed" ||
    intent === "" ||
    intent === "viral" ||
    intent === "viral feed";
  return viralLike && !hasSignalQueries;
}

function matchesCollectorDateRange(
  createdAt: unknown,
  config: Pick<ThreadsWebCollectorConfig, "dateEnd" | "dateQueryWindows" | "dateStart" | "dateTimezone">,
): boolean {
  const { startDate, endDate } = resolveCollectorDateRangeBounds(config);
  return matchesDateWindow(createdAt, startDate, endDate, config.dateTimezone);
}

function resolveCollectorDateRangeBounds(
  config: Pick<ThreadsWebCollectorConfig, "dateEnd" | "dateQueryWindows" | "dateStart">,
): { startDate?: string; endDate?: string } {
  const explicitStart = String(config.dateStart || "").trim();
  const explicitEnd = String(config.dateEnd || "").trim();
  if (explicitStart || explicitEnd) {
    return {
      endDate: explicitEnd || undefined,
      startDate: explicitStart || undefined,
    };
  }

  let startDate = "";
  let endDate = "";
  for (const window of config.dateQueryWindows) {
    const windowStart = String(window.startDate || "").trim();
    const windowEnd = String(window.endDate || "").trim();
    if (windowStart && (!startDate || windowStart < startDate)) {
      startDate = windowStart;
    }
    if (windowEnd && (!endDate || windowEnd > endDate)) {
      endDate = windowEnd;
    }
  }

  return {
    endDate: endDate || undefined,
    startDate: startDate || undefined,
  };
}

function matchesDateWindow(
  createdAt: unknown,
  startDate?: string,
  endDate?: string,
  timezone?: string,
): boolean {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  if (!start && !end) return true;
  const dateKey = parseCreatedAtDateKey(createdAt, timezone);
  if (!dateKey) return false;
  if (start && dateKey < start) return false;
  if (end && dateKey > end) return false;
  return true;
}

function normalizeLooseLabel(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isStrictBlankViralSelectionRequest(request?: CrawlRequest): boolean {
  if (!request) return false;
  return request.filters.topics.some((topic) => {
    const hasSignals =
      topic.search_queries.some((value) => String(value || "").trim()) ||
      topic.query_variants.some((value) => String(value || "").trim()) ||
      topic.required_keywords.some((value) => String(value || "").trim()) ||
      topic.keywords.some((value) => String(value || "").trim()) ||
      topic.seed_post_urls.some((value) => String(value || "").trim()) ||
      (topic.trend_search_urls ?? []).some((value) => String(value || "").trim());
    if (hasSignals) return false;

    const title = normalizeLooseLabel(topic.topic_title);
    const intent = normalizeLooseLabel(topic.topic_intent);
    return (
      (title === "" ||
        title === "viral" ||
        title === "viral feed" ||
        title === "trending" ||
        title === "hot" ||
        title === "top" ||
        title === "top threads" ||
        title === "xu huong") &&
      (intent === "" ||
        intent === "viral" ||
        intent === "viral feed" ||
        intent === "trending" ||
        intent === "hot" ||
        intent === "top" ||
        intent === "top threads" ||
        intent === "xu huong")
    );
  });
}

function resolveThreadsDiagnosticRoot(config: ThreadsWebCollectorConfig): string {
  if (config.cachePath) {
    return join(dirname(config.cachePath), "threads_diagnostics");
  }
  return join(dirname(config.assetDir), "threads_diagnostics");
}

function diagnosticError(error: unknown): Record<string, string> {
  if (!error) {
    return {};
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: truncateDiagnosticText(error.stack ?? "", 8_000),
    };
  }
  return {
    message: truncateDiagnosticText(String(error), 8_000),
    name: "UnknownError",
    stack: "",
  };
}

function truncateDiagnosticText(value: string, maxLength: number): string {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n<!-- truncated diagnostic snapshot -->`;
}

async function resolveCollectorLaunchOptions(config: ThreadsWebCollectorConfig): Promise<Record<string, unknown>> {
  const { chromium } = await import("playwright");
  return ensureChromiumLaunchHealthy(chromium, {
    headless: config.headless,
    channel: config.browserChannel,
    executablePath: config.executablePath,
    timeout: 30_000,
  });
}


function preferredAcceptLanguage(languages: string[]): string {
  const preferred = languages.map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (preferred.includes("vi")) {
    return "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7";
  }
  return "en-US,en;q=0.9";
}

async function prepareSearchResults(
  page: Page,
  config: ThreadsWebCollectorConfig,
  query: string,
  signal?: AbortSignal,
): Promise<void> {
  await goto(page, `${config.baseUrl.replace(/\/$/, "")}/search`, config.timeoutMs, config.delayMs, signal);
  await dismissOverlays(page);
  await page
    .waitForFunction(
      () =>
        Boolean(document.querySelector('input[type="search"], input[placeholder], textarea')) ||
        /continue with instagram|log in or sign up for threads|dang nhap hoac dang ky threads/i.test(
          document.body?.innerText || ""
        ) ||
        /for you|new thread|activity/i.test(document.body?.innerText || ""),
      undefined,
      { timeout: Math.max(6_000, config.timeoutMs) }
    )
    .catch(() => undefined);

  const initialState = await inspectSearchPageState(page);
  if (initialState.state !== "ready") {
    throw new ThreadsSearchUnavailableError(searchUnavailableMessage(initialState.state));
  }

  const searchInput = page
    .locator(
      [
        'input[type="search"]',
        'input[aria-label*="search" i]',
        'input[placeholder*="search" i]',
        'input[aria-label*="tìm kiếm" i]',
        'input[placeholder*="tìm kiếm" i]',
      ].join(", ")
    )
    .first();
  await searchInput.click({ timeout: 5_000 }).catch(() => undefined);
  await searchInput.fill("").catch(() => undefined);
  await searchInput.fill(query).catch(() => undefined);
  await waitForDelay(page, Math.max(1_500, config.delayMs * 6), signal);
  await page.keyboard.press("Enter").catch(() => undefined);
  await waitForDelay(page, Math.max(1_500, config.delayMs * 6), signal);

  const afterState = await inspectSearchPageState(page);
  if (afterState.state !== "ready") {
    throw new ThreadsSearchUnavailableError(searchUnavailableMessage(afterState.state));
  }
}

async function inspectSearchPageState(page: Page): Promise<{ state: "unknown" | "ready" | "login_prompt" | "onboarding" }> {
  const snapshot = await page
    .evaluate((searchSelector) => ({
      hasSearchInput: Boolean(document.querySelector(searchSelector)),
      text: (document.body?.innerText || "").slice(0, 4000),
      url: location.href,
    }), [
      'input[type="search"]',
      'input[aria-label*="search" i]',
      'input[placeholder*="search" i]',
      'input[aria-label*="tìm kiếm" i]',
      'input[placeholder*="tìm kiếm" i]',
    ].join(", "))
    .catch(() => ({ hasSearchInput: false, text: "", url: "" }));

  const folded = foldText(snapshot.text);
  const hasSearchShell =
    foldTextIncludesAll(folded, ["for you", "search", "activity"]) ||
    foldTextIncludesAll(folded, ["danh cho ban", "tim kiem", "hoat dong"]) ||
    (snapshot.url.includes("/search") &&
      (folded.includes("tim kiem") || folded.includes("search")) &&
      (folded.includes("hoat dong") || folded.includes("activity")));
  if (snapshot.url.includes("/onboarding")) {
    return { state: "onboarding" };
  }
  if (snapshot.url.includes("/login")) {
    return { state: "login_prompt" };
  }
  if (
    folded.includes("dang nhap hoac dang ky threads") ||
    folded.includes("log in or sign up for threads") ||
    folded.includes("continue with instagram") ||
    folded.includes("log in with your instagram account") ||
    folded.includes("dang nhap voi tai khoan instagram") ||
    (folded.includes("forgot password") && folded.includes("password"))
  ) {
    return { state: "login_prompt" };
  }
  if (snapshot.hasSearchInput || (snapshot.url.includes("/search") && hasSearchShell)) {
    return { state: "ready" };
  }
  return { state: "unknown" };
}

function searchUnavailableMessage(state: "unknown" | "ready" | "login_prompt" | "onboarding"): string {
  if (state === "onboarding") {
    return "Threads search is blocked because this session is still in onboarding. Open Session > Đăng nhập Threads and finish Threads setup first.";
  }
  if (state === "login_prompt") {
    return "Threads search is not ready in the current local session. Open Session > Đăng nhập Threads and log in to Threads search first.";
  }
  return "Threads search is not available in the current local session.";
}

function foldText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase();
}

function foldTextIncludesAll(value: string, parts: string[]): boolean {
  return parts.every((part) => value.includes(foldText(part)));
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
