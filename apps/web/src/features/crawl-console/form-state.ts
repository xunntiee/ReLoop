export interface CrawlFormState {
  advancedEnabled: boolean;
  cacheTtlMinutes: number;
  category: string;
  commentScrollRounds: number;
  configPath: string;
  datePreset: string;
  delayMs: number;
  endDate: string;
  excludeCommerceContent: boolean;
  excludePostsWithLinks: boolean;
  excludedKeywords: string;
  headless: boolean;
  includeHomeFeed: boolean;
  keywords: string;
  languages: string;
  maxCandidateLinks: number;
  maxCollectedPostsPerTopic: number;
  maxSearchQueriesPerTopic: number;
  maxTextLength: number;
  minCommentLikes: number;
  minLoadedTopComments: number;
  minPostReplies: number;
  minPostReposts: number;
  minPostShares: number;
  minTextLength: number;
  minTopicMatchScore: number;
  postScrollRounds: number;
  rankingWeightComments: number;
  rankingWeightLikes: number;
  rankingWeightRecency: number;
  rankingWeightReposts: number;
  rankingWeightShares: number;
  rankingWeightTopicMatch: number;
  rankingWeightViews: number;
  requiredKeywords: string;
  requiredKeywordsMode: "all" | "any";
  searchQueries: string;
  searchScrollRounds: number;
  seedPostUrls: string;
  sourceMode: "discover" | "seed_only" | "hybrid";
  sortBy: string;
  startDate: string;
  textExcludesAny: string;
  timeoutMs: number;
  topCommentsPerPost: number;
  topicTitle: string;
  trendSearchUrls: string;
  useCache: boolean;
  validatePostUrls: boolean;
  wantedPosts: number;
}

export interface RuntimeProfile {
  crawlAssets: boolean;
  cacheTtlMinutes: number;
  commentScrollRounds: number;
  delayMs: number;
  deepViralCompare: boolean;
  downloadAvatars: boolean;
  downloadAssets: boolean;
  homeScrollRounds: number;
  includeCommentAssets: boolean;
  includeHomeFeed: boolean;
  maxCandidateLinks: number;
  maxCollectedPostsPerTopic: number;
  maxDetailRequests: number;
  maxCommentScanPosts: number;
  maxAssetDownloadPosts: number;
  maxConcurrency: number;
  maxMediaPerComment: number;
  maxMediaPerPost: number;
  maxSearchQueriesPerTopic: number;
  postScrollRounds: number;
  searchScrollRounds: number;
  timeoutMs: number;
  validatePostUrls: boolean;
}

export type UpdateCrawlForm = <TKey extends keyof CrawlFormState>(
  key: TKey,
  value: CrawlFormState[TKey]
) => void;

export const defaultForm: CrawlFormState = {
  advancedEnabled: false,
  cacheTtlMinutes: 1440,
  category: "general_quick",
  commentScrollRounds: 1,
  configPath: "",
  datePreset: "none",
  delayMs: 150,
  endDate: "",
  excludeCommerceContent: false,
  excludePostsWithLinks: false,
  excludedKeywords: "",
  headless: true,
  includeHomeFeed: false,
  keywords: "",
  languages: "vi",
  maxCandidateLinks: 12,
  maxCollectedPostsPerTopic: 6,
  maxSearchQueriesPerTopic: 2,
  maxTextLength: 2000,
  minCommentLikes: 0,
  minLoadedTopComments: 0,
  minPostReplies: 0,
  minPostReposts: 0,
  minPostShares: 0,
  minTextLength: 10,
  minTopicMatchScore: 0.05,
  postScrollRounds: 0,
  rankingWeightComments: 16,
  rankingWeightLikes: 14,
  rankingWeightRecency: 8,
  rankingWeightReposts: 24,
  rankingWeightShares: 22,
  rankingWeightTopicMatch: 8,
  rankingWeightViews: 8,
  requiredKeywords: "",
  requiredKeywordsMode: "any",
  searchQueries: "",
  searchScrollRounds: 1,
  seedPostUrls: "",
  sourceMode: "discover",
  sortBy: "score",
  startDate: "",
  textExcludesAny: "",
  timeoutMs: 10_000,
  topCommentsPerPost: 5,
  topicTitle: "",
  trendSearchUrls: "",
  useCache: true,
  validatePostUrls: false,
  wantedPosts: 5,
};

export const datePresetOptions = [
  { label: "Không lọc ngày", value: "none" },
  { label: "Hôm nay", value: "today" },
  { label: "7 ngày qua", value: "last_7_days" },
  { label: "30 ngày qua", value: "last_30_days" },
  { label: "Sau ngày...", value: "after_date" },
  { label: "Trước ngày...", value: "before_date" },
  { label: "Khoảng ngày...", value: "date_range" },
];

export const sortOptions = [
  { label: "Điểm viral", value: "score" },
  { label: "Lượt xem", value: "views" },
  { label: "Bình luận", value: "comments" },
  { label: "Lượt thích", value: "likes" },
  { label: "Đăng lại", value: "reposts" },
  { label: "Chia sẻ", value: "shares" },
  { label: "Mới nhất", value: "newest" },
  { label: "Tương tác", value: "engagement" },
];

export const keywordModeOptions = [
  { label: "Chỉ cần 1 từ khóa", value: "any" },
  { label: "Phải có tất cả", value: "all" },
];

export const sourceModeOptions = [
  { label: "Tìm tự động", value: "discover" },
  { label: "Dán link / mã nhúng bài viết", value: "seed_only" },
];
