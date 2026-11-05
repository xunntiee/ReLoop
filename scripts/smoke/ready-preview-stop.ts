import { ThreadsWebCollector } from "../../apps/server/src/modules/crawl/collectors/threads-web";
import { THREADS_EXTRACTION_VERSION } from "../../apps/server/src/modules/crawl/collectors/threads-cache";
import { buildTopicDataFromRawPosts } from "../../apps/server/src/modules/crawl/pipeline/crawl-pipeline";
import { resolveCheckpointOutputRawPosts } from "../../apps/server/src/modules/crawl/service";
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
  topic_title: "Viral feed",
};

const request: CrawlRequest = {
  created_at: "2026-06-26T00:00:00Z",
  filters: {
    date_range: {
      end_date: "2026-06-26",
      preset: "custom",
      start_date: "2026-06-01",
    },
    exclude_commerce_content: false,
    exclude_posts_with_links: false,
    exclude_usernames: [],
    global_excluded_keywords: [],
    include_usernames: [],
    languages: ["vi"],
    max_posts_per_topic: 5,
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
    sort_by: "views",
    source: "threads",
    text_contains_all: [],
    text_contains_any: [],
    text_excludes_any: [],
    top_comments_per_post: 5,
    topics: [topic],
  },
  notes: "smoke ready preview stop",
  request_id: "smoke-ready-preview-stop",
  runtime_overrides: {},
  ui_state: { advancedEnabled: true },
};

function makeComment(postIndex: number, commentIndex: number): RawComment {
  return {
    avatar_url: "",
    comment_id: `comment-${postIndex}-${commentIndex}`,
    created_at: "2026-06-26T00:00:00Z",
    display_name: `Demo ${postIndex}`,
    language: "vi",
    like_count: commentIndex,
    media: [],
    reply_count: 0,
    text: `Binh luan ${commentIndex}`,
    username: `demo${postIndex}`,
  };
}

function makeFullPost(index: number, commentCount = 5): RawPost {
  return {
    avatar_url: "",
    comments: Array.from({ length: commentCount }, (_, commentIndex) =>
      makeComment(index, commentIndex + 1),
    ),
    created_at: "2026-06-26T00:00:00Z",
    crawled_at: "2026-06-26T00:00:00Z",
    display_name: `Demo ${index}`,
    language: "vi",
    like_count: 240 + index,
    matched_query: "viral",
    media: [],
    metrics_snapshot: {
      crawled_at: "2026-06-26T00:00:00Z",
      extraction_depth: "full",
      extraction_version: THREADS_EXTRACTION_VERSION,
    },
    post_id: `post-${index}`,
    quote_count: 0,
    reply_count: 30,
    repost_count: 10,
    share_count: 6,
    source_url: `https://www.threads.com/@demo/post/post-${index}`,
    text: `Noi dung bai ${index} rat dai de qua bo loc.`,
    url: `https://www.threads.com/@demo/post/post-${index}`,
    username: `demo${index}`,
    view_count: 25_000 + index,
  };
}

const collector = new ThreadsWebCollector();
const collectorState = collector as unknown as {
  partialPostsByTopic: Map<string, RawPost[]>;
  readyOutputPostsByTopic: Map<string, RawPost[]>;
  partialProcessedUrlsByTopic: Map<string, string[]>;
  partialResumeUrlsByTopic: Map<string, string[]>;
};

const partialReadyPosts = Array.from({ length: 4 }, (_, index) =>
  makeFullPost(index + 1, index === 0 ? 1 : 3),
);
collectorState.partialPostsByTopic.set(topic.topic_title, []);
collectorState.readyOutputPostsByTopic.set(topic.topic_title, partialReadyPosts);
collectorState.partialProcessedUrlsByTopic.set(
  topic.topic_title,
  partialReadyPosts.map((post) => String(post.url)),
);
collectorState.partialResumeUrlsByTopic.set(topic.topic_title, [
  ...partialReadyPosts.map((post) => String(post.url)),
  "https://www.threads.com/@demo/post/post-5",
  "https://www.threads.com/@demo/post/post-6",
  "https://www.threads.com/@demo/post/post-7",
]);

const partialSnapshot = collector.getPartialSnapshot(topic);
if (partialSnapshot.posts.length !== 4) {
  throw new Error(
    `Expected partial snapshot to keep 4 ready preview posts, got ${partialSnapshot.posts.length}.`,
  );
}

const partialOutput = buildTopicDataFromRawPosts({
  collectorStats: undefined,
  partialSnapshot,
  rawPosts: resolveCheckpointOutputRawPosts(partialSnapshot, {}),
  request,
  topicFilter: topic,
});

if (partialOutput.posts.length !== 4) {
  throw new Error(
    `Expected stopped partial output to retain 4 preview posts, got ${partialOutput.posts.length}.`,
  );
}

if ((partialOutput.crawl_audit?.pending_post_urls as string[] | undefined)?.length !== 3) {
  throw new Error("Expected partial output to preserve 3 pending resume URLs.");
}

const fullReadyPosts = Array.from({ length: 5 }, (_, index) => makeFullPost(index + 11, 5));
collectorState.partialPostsByTopic.set(topic.topic_title, []);
collectorState.readyOutputPostsByTopic.set(topic.topic_title, fullReadyPosts);
collectorState.partialProcessedUrlsByTopic.set(topic.topic_title, []);
collectorState.partialResumeUrlsByTopic.set(topic.topic_title, Array.from({ length: 18 }, (_, index) =>
  `https://www.threads.com/@demo/post/future-${index + 1}`,
));

const fullSnapshot = collector.getPartialSnapshot(topic);
if (fullSnapshot.posts.length !== 5) {
  throw new Error(
    `Expected full snapshot to keep 5 ready posts, got ${fullSnapshot.posts.length}.`,
  );
}

const completedOutput = buildTopicDataFromRawPosts({
  collectorStats: undefined,
  partialSnapshot: null,
  rawPosts: resolveCheckpointOutputRawPosts(fullSnapshot, {}),
  request,
  topicFilter: topic,
});

if (completedOutput.posts.length !== 5) {
  throw new Error(
    `Expected reached-target output to retain 5 preview posts, got ${completedOutput.posts.length}.`,
  );
}

if (
  completedOutput.crawl_audit &&
  "pending_post_urls" in completedOutput.crawl_audit
) {
  throw new Error("Expected reached-target output to drop checkpoint-only pending URLs.");
}

console.log("smoke:ready-preview-stop ok");
