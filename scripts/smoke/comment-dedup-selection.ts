import { commentFilterRejectionReason } from "../../apps/server/src/modules/crawl/ranking/post-filters";
import {
  buildOutputCommentsFromRawPost,
  evaluateRawPostForOutput,
} from "../../apps/server/src/modules/crawl/selection/post-evaluation";
import type {
  CrawlRequest,
  RawComment,
  RawPost,
  TopicFilter,
} from "../../apps/server/src/modules/crawl/types";

const topic: TopicFilter = {
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
  topic_intent: "viral",
  topic_title: "viral feed",
};

const request: CrawlRequest = {
  created_at: "2026-06-24T00:00:00Z",
  filters: {
    date_range: {
      end_date: "2026-12-31",
      preset: "custom",
      start_date: "2020-01-01",
    },
    exclude_commerce_content: false,
    exclude_posts_with_links: false,
    exclude_usernames: [],
    global_excluded_keywords: [],
    include_usernames: [],
    languages: ["vi"],
    max_posts_per_topic: 1,
    max_text_length: 5000,
    min_comment_likes: 0,
    min_comments: 0,
    min_loaded_top_comments: 0,
    min_post_likes: 0,
    min_post_replies: 0,
    min_post_reposts: 0,
    min_post_score: 0,
    min_post_shares: 0,
    min_post_views: 0,
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
    sort_by: "likes",
    source: "threads_search",
    text_contains_all: [],
    text_contains_any: [],
    text_excludes_any: [],
    top_comments_per_post: 5,
    topics: [topic],
  },
  notes: "smoke dedupe selection",
  request_id: "smoke-dedupe-selection",
  runtime_overrides: {},
  ui_state: { advancedEnabled: true },
};

const rawPost: RawPost = {
  comments: [
    {
      avatar_asset_path: "",
      avatar_url: "https://example.com/share-avatar.jpg",
      comment_id: "demo-comment-share",
      created_at: "",
      display_name: "shareuser",
      language: "vi",
      like_count: 20000,
      media: [],
      reply_count: 15,
      text: "Ao soc nau: s.shopee.vn/9AOes...",
      username: "shareuser",
    },
    {
      avatar_asset_path: "data/assets/threads/demo/comments/demo-comment-1-avatar.jpg",
      avatar_url: "https://example.com/shared-avatar.jpg",
      comment_id: "demo-comment-1",
      created_at: "",
      display_name: "_.nh4.diwz",
      language: "vi",
      like_count: 1300,
      media: [],
      reply_count: 1,
      text: "Có khi nguu chả đứa n bt 11",
      username: "_.nh4.diwz",
    },
    {
      avatar_asset_path: "",
      avatar_url: "https://example.com/nh4-correct-avatar.jpg",
      comment_id: "demo-comment-2",
      created_at: "",
      display_name: "_.nh4.diwz",
      language: "vi",
      like_count: 11,
      media: [],
      reply_count: 0,
      text: "Có khi nguu chả đứa n bt",
      username: "_.nh4.diwz",
    },
    {
      avatar_asset_path: "data/assets/threads/demo/comments/demo-comment-3-avatar.jpg",
      avatar_url: "https://example.com/shared-avatar.jpg",
      comment_id: "demo-comment-3",
      created_at: "",
      display_name: "hamy__kk",
      language: "vi",
      like_count: 1300,
      media: [],
      reply_count: 1,
      text: "comment khac",
      username: "hamy__kk",
    },
  ],
  created_at: "2026-06-13T00:00:00Z",
  display_name: "author",
  language: "vi",
  like_count: 999,
  media: [],
  post_id: "demo-post",
  quote_count: 0,
  reply_count: 10,
  repost_count: 0,
  share_count: 0,
  text: "Bai viet demo",
  url: "https://www.threads.com/@author/post/demo-post",
  username: "author",
  view_count: 1000,
};

const result = evaluateRawPostForOutput(rawPost, topic, request, {});

if (!result.accepted) {
  throw new Error(`Expected accepted post, got ${result.reason}.`);
}

const contaminated = result.post.top_comments.find(
  (comment) => comment.username === "_.nh4.diwz",
);

if (!contaminated) {
  throw new Error("Expected deduped _.nh4.diwz comment to remain.");
}

if (contaminated.like_count !== 11 || contaminated.reply_count !== 0) {
  throw new Error(
    `Expected clean duplicate candidate to win with 11 likes / 0 replies, got ${String(contaminated.like_count)} / ${String(contaminated.reply_count)}.`,
  );
}

if (contaminated.avatar_url !== "https://example.com/nh4-correct-avatar.jpg") {
  throw new Error(`Expected clean duplicate avatar to win, got ${String(contaminated.avatar_url)}.`);
}

if (result.post.top_comments.some((comment) => comment.username === "shareuser")) {
  throw new Error("Expected a shortened shopping-link comment to always be excluded.");
}

const excludeLinksRequest = structuredClone(request);
excludeLinksRequest.filters.exclude_posts_with_links = true;
excludeLinksRequest.filters.top_comments_per_post = 2;
const excludedLinksResult = evaluateRawPostForOutput(rawPost, topic, excludeLinksRequest, {});
if (!excludedLinksResult.accepted) {
  throw new Error(`Expected accepted post with link exclusion enabled, got ${excludedLinksResult.reason}.`);
}
if (excludedLinksResult.post.top_comments.some((comment) => comment.username === "shareuser")) {
  throw new Error("Expected a shortened shopping-link comment to remain excluded.");
}

for (const text of [
  "Xem tai https://example.org/watch",
  "Ao soc nau: s.shopee.vn/9AOes...",
]) {
  if (
    commentFilterRejectionReason({ text } as RawComment, request.filters) !==
    "comment_has_link"
  ) {
    throw new Error(`Expected linked comment to be excluded: ${text}`);
  }
}

const nearDuplicateComments = buildOutputCommentsFromRawPost(
  {
    comments: [
      {
        avatar_url: "https://example.com/mayonair.jpg",
        is_reply: false,
        like_count: 2,
        media: [
          {
            asset_path: "",
            height: 200,
            order: 1,
            remote_url: "https://cdn.example.com/media/mayonair.jpg?sig=old",
            type: "image",
            width: 200,
          },
        ],
        reply_count: 2,
        text: "(Con dan ba do) vn mayonair 31/05/2026 Gui may dua thich nhac anh 2 /",
        username: "mayonair",
      },
      {
        avatar_url: "",
        is_reply: false,
        like_count: 0,
        media: [
          {
            asset_path: "",
            height: 200,
            order: 1,
            remote_url: "https://cdn.example.com/media/mayonair.jpg?sig=new",
            type: "image",
            width: 200,
          },
        ],
        reply_count: 0,
        text: "(Con dan ba do) vn mayonair 31/05/2026",
        username: "mayonair",
      },
      {
        avatar_url: "https://example.com/mayonair.jpg",
        is_reply: false,
        like_count: 990,
        media: [
          {
            asset_path: "",
            height: 200,
            order: 1,
            remote_url: "https://cdn.example.com/media/mayonair-other.jpg",
            type: "image",
            width: 200,
          },
        ],
        reply_count: 124,
        text: "(Con dan ba do) vn mayonair 31/05/2026 Tac gia danh cho may dua thuong dang",
        username: "mayonair",
      },
    ],
  },
  { top_comments_per_post: 10 },
);

if (nearDuplicateComments.comments.length !== 2) {
  throw new Error(
    `Expected one repeated media comment to be collapsed, got ${String(nearDuplicateComments.comments.length)}.`,
  );
}

const retainedRepeatedMediaComment = nearDuplicateComments.comments.find((comment) =>
  comment.media.some((media) => media.remote_url.includes("/media/mayonair.jpg")),
);
if (retainedRepeatedMediaComment?.like_count !== 2) {
  throw new Error("Expected the richer duplicate candidate to be retained.");
}

if (nearDuplicateComments.comments.some((comment) => comment.like_count === 0)) {
  throw new Error("Expected the empty placeholder duplicate to be removed.");
}

console.log("smoke:comment-dedup-selection ok");
