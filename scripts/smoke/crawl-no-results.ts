import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrawlPipeline } from "../../apps/server/src/modules/crawl/pipeline/crawl-pipeline";
import { CrawlJsonWriter } from "../../apps/server/src/modules/crawl/storage/json-writer";
import type {
  CrawlRequest,
  PostCollector,
  TopicFilter,
} from "../../apps/server/src/modules/crawl/types";

const topic: TopicFilter = {
  category: "smoke",
  excluded_keywords: [],
  keywords: ["world cup"],
  lexicon: {
    abbreviations: [],
    canonical: [],
    no_diacritics: [],
    teencode: [],
  },
  query_variants: [],
  required_keywords: [],
  required_keywords_mode: "any",
  search_queries: ["world cup"],
  seed_post_urls: [],
  topic_intent: "world cup",
  topic_title: "World cup",
};

const request: CrawlRequest = {
  created_at: "2026-06-16T00:00:00Z",
  filters: {
    date_range: {
      end_date: "2026-06-16",
      preset: "last_7_days",
      start_date: "2026-06-10",
    },
    exclude_commerce_content: false,
    exclude_posts_with_links: false,
    exclude_usernames: [],
    global_excluded_keywords: [],
    include_usernames: [],
    languages: ["vi"],
    max_posts_per_topic: 5,
    max_text_length: 2000,
    min_comment_likes: 0,
    min_comments: 0,
    min_loaded_top_comments: 0,
    min_post_likes: 0,
    min_post_views: 0,
    min_post_replies: 0,
    min_post_reposts: 0,
    min_post_score: 0,
    min_post_shares: 0,
    min_text_length: 0,
    min_topic_match_score: 0,
    ranking_mode: "weighted",
    ranking_weights: {
      comments: 0.2,
      likes: 0.1,
      recency: 0.05,
      reposts: 0.1,
      shares: 0.05,
      topic_match: 0.1,
      views: 0.4,
    },
    recency_half_life_hours: 48,
    require_comments: false,
    require_metrics: false,
    require_repost_or_share: false,
    sort_by: "views",
    source: "threads_search",
    text_contains_all: [],
    text_contains_any: [],
    text_excludes_any: [],
    top_comments_per_post: 5,
    topics: [topic],
  },
  notes: "smoke no results",
  request_id: `smoke-no-results-${Date.now()}`,
  runtime_overrides: {},
};

const collector: PostCollector = {
  async collectPosts() {
    return [];
  },
  stats: {
    cache_hits: 0,
    cache_misses: 0,
    collected_posts: 0,
    discovered_urls: 0,
    home_feed_runs: 0,
    home_feed_urls: 0,
    invalid_urls: 0,
    queries: 1,
    skipped_posts: 0,
    stale_cache: 0,
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
    topics: 1,
  },
};

const outputDir = mkdtempSync(join(tmpdir(), "tool-base-smoke-no-results-"));

try {
  const pipeline = new CrawlPipeline(collector, new CrawlJsonWriter(outputDir));
  const outputPath = await pipeline.run(request);

  if (!existsSync(outputPath)) {
    throw new Error(`Expected output file at ${outputPath}`);
  }

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as Array<{
    posts?: unknown[];
    crawl_audit?: Record<string, unknown>;
  }>;
  const posts = Array.isArray(payload[0]?.posts) ? payload[0].posts : [];
  const audit = payload[0]?.crawl_audit;

  if (!audit) {
    throw new Error("Expected crawl_audit in output JSON.");
  }

  if (posts.length !== 0) {
    throw new Error(`Expected 0 posts, received ${String(posts.length)}`);
  }

  if (Number(audit.accepted_posts ?? 0) !== 0) {
    throw new Error(`Expected accepted_posts=0, got ${String(audit.accepted_posts)}`);
  }

  console.log("smoke:crawl-no-results ok");
} finally {
  rmSync(outputDir, { force: true, recursive: true });
}
