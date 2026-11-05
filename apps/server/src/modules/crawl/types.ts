export interface DateRangeFilter {
  start_date: string;
  end_date: string;
  preset: string;
  timezone?: string;
}

export interface TopicLexicon {
  canonical: string[];
  abbreviations: string[];
  teencode: string[];
  no_diacritics: string[];
}

export type CrawlProgressStage =
  | "preparing"
  | "discovering"
  | "extracting_posts"
  | "extracting_comments"
  | "saving"
  | "completed";

export interface CrawlProgressSnapshot {
  baseline_comment_target?: number;
  baseline_committed_comments?: number;
  baseline_committed_posts?: number;
  baseline_target_output_posts?: number;
  candidate_count?: number;
  comment_completed?: number;
  comment_warning?: string;
  comments_scanned?: number;
  comments_selected?: number;
  comment_target?: number;
  committed_comments?: number;
  committed_posts?: number;
  current_post?: string;
  current_query?: string;
  current_url?: string;
  detail_completed?: number;
  detail_target?: number;
  discovered_posts?: number;
  message?: string;
  effective_ranking?: Record<string, unknown>;
  effective_runtime?: Record<string, unknown>;
  finalist_completed?: number;
  finalist_target?: number;
  pending_posts?: number;
  preview_only_posts?: number;
  queued_candidates?: number;
  ready_output_comments?: number;
  ready_output_posts?: number;
  resume_ready?: boolean;
  selected_posts?: number;
  stage: CrawlProgressStage;
  stage_started_at?: string;
  stage_durations_ms?: Partial<Record<CrawlProgressStage, number>>;
  summary_completed?: number;
  summary_target?: number;
  summary_posts?: number;
  target_inspect_posts?: number;
  target_output_posts?: number;
  updated_at: string;
}

export type RankingMode = "sort_by" | "weighted";

export interface RankingWeights {
  comments: number;
  likes: number;
  recency: number;
  reposts: number;
  shares: number;
  topic_match: number;
  views: number;
}

export interface TopicFilter {
  topic_title: string;
  topic_intent: string;
  keywords: string[];
  search_queries: string[];
  query_variants: string[];
  required_keywords: string[];
  required_keywords_mode: "all" | "any";
  excluded_keywords: string[];
  lexicon: TopicLexicon;
  seed_post_urls: string[];
  trend_search_urls: string[];
  category: string;
}

export interface CrawlFilters {
  topics: TopicFilter[];
  date_range: DateRangeFilter;
  languages: string[];
  include_usernames: string[];
  exclude_usernames: string[];
  text_contains_any: string[];
  text_contains_all: string[];
  text_excludes_any: string[];
  global_excluded_keywords: string[];
  exclude_posts_with_links: boolean;
  exclude_commerce_content: boolean;
  min_post_likes: number;
  min_post_views: number;
  min_post_replies: number;
  min_post_reposts: number;
  min_post_shares: number;
  require_repost_or_share: boolean;
  min_post_score: number;
  min_topic_match_score: number;
  min_comment_likes: number;
  min_text_length: number;
  max_text_length: number;
  min_comments: number;
  min_loaded_top_comments: number;
  require_comments: boolean;
  require_metrics: boolean;
  recency_half_life_hours: number;
  max_posts_per_topic: number;
  top_comments_per_post: number;
  ranking_mode: RankingMode;
  ranking_weights: RankingWeights;
  sort_by: string;
  source: string;
}

export interface CrawlRequest {
  request_id: string;
  filters: CrawlFilters;
  created_at: string;
  notes: string;
  runtime_overrides?: Record<string, unknown>;
  ui_state?: Record<string, unknown>;
}

export interface CrawlRequestMeta {
  created_at: string;
  date_range: DateRangeFilter;
  languages: string[];
  include_usernames: string[];
  exclude_usernames: string[];
  text_contains_any: string[];
  text_contains_all: string[];
  text_excludes_any: string[];
  global_excluded_keywords: string[];
  exclude_posts_with_links: boolean;
  exclude_commerce_content: boolean;
  min_post_likes: number;
  min_post_views: number;
  min_post_replies: number;
  min_post_reposts: number;
  min_post_shares: number;
  require_repost_or_share: boolean;
  min_post_score: number;
  min_topic_match_score: number;
  min_comment_likes: number;
  min_text_length: number;
  max_text_length: number;
  min_comments: number;
  min_loaded_top_comments: number;
  require_comments: boolean;
  require_metrics: boolean;
  max_posts_per_topic: number;
  notes: string;
  recency_half_life_hours: number;
  request_id: string;
  ranking_mode: RankingMode;
  ranking_weights: RankingWeights;
  runtime_overrides?: Record<string, unknown>;
  sort_by: string;
  source: string;
  top_comments_per_post: number;
  topic: TopicFilter;
  ui_state?: Record<string, unknown>;
}

export interface RawComment {
  comment_id?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  avatar_asset_path?: string;
  language?: string;
  text?: string;
  like_count?: number;
  reply_count?: number;
  created_at?: string;
  is_reply?: boolean;
  media?: MediaAsset[];
  source_order?: number;
  [key: string]: unknown;
}

export interface RawPost {
  post_id?: string;
  url?: string;
  source_url?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  avatar_asset_path?: string;
  language?: string;
  text?: string;
  view_count?: number;
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  quote_count?: number;
  share_count?: number;
  created_at?: string;
  created_at_source?: string;
  crawled_at?: string;
  discovery_source?: string;
  discovery_window_end?: string;
  discovery_window_start?: string;
  matched_query?: string;
  metrics_snapshot?: Record<string, unknown>;
  url_status?: Record<string, unknown>;
  media?: MediaAsset[];
  comments?: RawComment[];
  [key: string]: unknown;
}

export interface PublishTimeMetadata {
  date_key: string;
  detected_at: string;
  filter_end_date: string;
  filter_reason: string;
  filter_start_date: string;
  passed_date_filter: boolean;
  source: string;
  timezone: string;
}

export interface MediaAsset {
  duration_seconds?: number;
  type: "image" | "video";
  remote_url: string;
  asset_path: string;
  width: number;
  height: number;
  order: number;
}

export interface TopicMatch {
  score: number;
  matched_query: string;
  matched_keywords: string[];
  matched_lexicon: string[];
  matched_required_keywords: string[];
  missing_required_keywords: string[];
  required_keywords_mode: "all" | "any";
  matched_excluded_keywords: string[];
}

export interface CommentData {
  comment_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  avatar_asset_path: string;
  language: string;
  text: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  is_reply?: boolean;
  media: MediaAsset[];
  source_order: number;
}

export interface PostRankingData {
  breakdown: Record<string, number>;
  final_score: number;
  mode: RankingMode;
  sort_by: string;
}

export interface PostData {
  post_id: string;
  url: string;
  username: string;
  display_name: string;
  avatar_url: string;
  avatar_asset_path: string;
  text: string;
  source_url: string;
  language: string;
  view_count: number;
  like_count: number;
  reply_count: number;
  repost_count: number;
  quote_count: number;
  share_count: number;
  created_at: string;
  publish_time?: PublishTimeMetadata;
  crawled_at: string;
  discovery_source: string;
  discovery_window_end: string;
  discovery_window_start: string;
  matched_query: string;
  media: MediaAsset[];
  ranking: PostRankingData;
  top_comments: CommentData[];
}

export interface TopicData {
  topic_id: string;
  topic_title: string;
  keywords: string[];
  source: string;
  crawled_at: string;
  request_meta?: CrawlRequestMeta;
  crawl_audit?: Record<string, unknown>;
  posts: PostData[];
}

export interface PartialTopicSnapshot {
  posts: RawPost[];
  previewOnlyPostUrls?: string[];
  resumeSeedUrls?: string[];
  completedPostUrls?: string[];
  pendingPostUrls?: string[];
  processedPostUrls?: string[];
}

export interface CollectorStats {
  topics: number;
  queries: number;
  home_feed_runs: number;
  discovered_urls: number;
  home_feed_urls: number;
  cache_hits: number;
  cache_misses: number;
  collected_posts: number;
  stale_cache: number;
  invalid_urls: number;
  skipped_posts: number;
  skipped_samples?: Array<Record<string, unknown>>;
  summary_candidates: number;
  summary_collected: number;
  detail_reserved: number;
  detail_opened: number;
  detail_valid: number;
  final_selected: number;
  skipped_after_target: number;
  detail_requests: number;
  detail_enriched: number;
  detail_failed: number;
  finalist_reserved?: number;
  finalist_opened?: number;
  comments_scanned?: number;
  comments_selected?: number;
}

export interface PostCollector {
  stats?: CollectorStats;
  collectPosts(topic: TopicFilter): Promise<RawPost[]>;
  getAuditSnapshot?(topic: TopicFilter): Record<string, unknown>;
  getPartialPosts?(topic: TopicFilter): RawPost[];
  getPartialSnapshot?(topic: TopicFilter): PartialTopicSnapshot;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
