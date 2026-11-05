import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readAndRepairOutputFile,
  repairOutputMedia,
} from "../../apps/server/src/modules/crawl/storage/output-repair";
import type { RawPost, TopicData } from "../../apps/server/src/modules/crawl/types";

const tempDir = mkdtempSync(join(tmpdir(), "tool-base-output-repair-"));
const rawCachePath = join(tempDir, "threads_posts_cache.json");
const outputPath = join(tempDir, "demo-output.json");
const shareOutputPath = join(tempDir, "share-output.json");

const rawPost: RawPost = {
  comments: [
    {
      avatar_asset_path: "data/assets/threads/demo/comments/demo-comment-1-avatar.jpg",
      avatar_url:
        "https://instagram.fhan14-3.fna.fbcdn.net/v/t51.82787-19/720019503_shared.jpg?_nc_sid=10d13b",
      comment_id: "demo-comment-1",
      created_at: "",
      display_name: "_.nh4.diwz",
      language: "vi",
      like_count: 1300,
      media: [],
      reply_count: 1,
      text: "Co khi nugu cha dua n bt 11",
      username: "_.nh4.diwz",
    },
    {
      avatar_asset_path: "",
      avatar_url:
        "https://instagram.fhan14-1.fna.fbcdn.net/v/t51.82787-19/727497450_unique.jpg?_nc_sid=10d13b",
      comment_id: "demo-comment-2",
      created_at: "",
      display_name: "_.nh4.diwz",
      language: "vi",
      like_count: 11,
      media: [],
      reply_count: 0,
      text: "Co khi nugu cha dua n bt",
      username: "_.nh4.diwz",
    },
    {
      avatar_asset_path: "data/assets/threads/demo/comments/demo-comment-3-avatar.jpg",
      avatar_url:
        "https://instagram.fhan14-3.fna.fbcdn.net/v/t51.82787-19/720019503_shared.jpg?_nc_sid=10d13b",
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
  source_url: "https://www.threads.com/@author/post/demo-post",
  text: "Bai viet demo",
  url: "https://www.threads.com/@author/post/demo-post",
  username: "author",
  view_count: 1000,
};

const output: TopicData[] = [
  {
    crawled_at: "2026-06-24T00:00:00Z",
    crawl_audit: {},
    keywords: [],
    posts: [
      {
        avatar_asset_path: "",
        avatar_url: "",
        created_at: "2026-06-13T00:00:00Z",
        crawled_at: "2026-06-24T00:00:00Z",
        display_name: "author",
        language: "vi",
        like_count: 999,
        media: [],
        post_id: "demo-post",
        quote_count: 0,
        ranking: {
          breakdown: {},
          final_score: 1,
          mode: "weighted",
          sort_by: "score",
        },
        reply_count: 10,
        repost_count: 0,
        share_count: 0,
        source_url: "https://www.threads.com/@author/post/demo-post",
        text: "Bai viet demo",
        top_comments: [
          {
            avatar_asset_path: "data/assets/threads/demo/comments/demo-comment-3-avatar.jpg",
            avatar_url:
              "https://instagram.fhan14-3.fna.fbcdn.net/v/t51.82787-19/720019503_shared.jpg?_nc_sid=10d13b",
            comment_id: "demo-comment-3",
            created_at: "",
            display_name: "hamy__kk",
            language: "vi",
            like_count: 1300,
            media: [],
            reply_count: 1,
            source_order: 2,
            text: "comment khac",
            username: "hamy__kk",
          },
          {
            avatar_asset_path: "data/assets/threads/demo/comments/demo-comment-1-avatar.jpg",
            avatar_url:
              "https://instagram.fhan14-3.fna.fbcdn.net/v/t51.82787-19/720019503_shared.jpg?_nc_sid=10d13b",
            comment_id: "demo-comment-1",
            created_at: "",
            display_name: "_.nh4.diwz",
            language: "vi",
            like_count: 1300,
            media: [],
            reply_count: 1,
            source_order: 1,
            text: "Co khi nugu cha dua n bt 11",
            username: "_.nh4.diwz",
          },
        ],
        url: "https://www.threads.com/@author/post/demo-post",
        username: "author",
        view_count: 1000,
      },
    ],
    request_meta: {
      created_at: "2026-06-24T00:00:00Z",
      date_range: {
        end_date: "",
        preset: "",
        start_date: "",
      },
      exclude_commerce_content: false,
      exclude_posts_with_links: false,
      exclude_usernames: [],
      global_excluded_keywords: [],
      include_usernames: [],
      languages: ["vi"],
      max_posts_per_topic: 1,
      max_text_length: 2000,
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
      notes: "smoke output repair",
      ranking_mode: "weighted",
      ranking_weights: {
        comments: 20,
        likes: 5,
        recency: 3,
        reposts: 12,
        shares: 5,
        topic_match: 5,
        views: 50,
      },
      recency_half_life_hours: 168,
      request_id: "smoke-output-repair",
      require_comments: false,
      require_metrics: false,
      require_repost_or_share: false,
      runtime_overrides: {},
      sort_by: "score",
      source: "threads",
      text_contains_all: [],
      text_contains_any: [],
      text_excludes_any: [],
      top_comments_per_post: 2,
      topic: {
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
      },
      ui_state: {},
    },
    source: "threads",
    topic_id: "topic-demo",
    topic_title: "viral feed",
  },
];

const localizedUiOutput = structuredClone(output);
const localizedUiComment = localizedUiOutput[0]?.posts[0]?.top_comments[0];
if (!localizedUiComment) {
  throw new Error("Expected localized UI repair fixture comment.");
}
localizedUiComment.like_count = 38;
localizedUiComment.reply_count = 1;
localizedUiComment.text =
  "Sắc của hoa là sức của bà quét Hoa xinh gửi gió bay vô hướng. Cô quét lao công,quét đủ đường. Cayyyyy 38 1 Hiển thị phản hồi";
const localizedUiRepair = repairOutputMedia(localizedUiOutput);
const repairedLocalizedUiText =
  localizedUiRepair.output?.[0]?.posts[0]?.top_comments[0]?.text;
const expectedLocalizedUiText =
  "Sắc của hoa là sức của bà quét Hoa xinh gửi gió bay vô hướng. Cô quét lao công,quét đủ đường. Cayyyyy";
if (repairedLocalizedUiText !== expectedLocalizedUiText) {
  throw new Error(
    `Expected saved output comment UI tail to be repaired.\nExpected: "${expectedLocalizedUiText}"\nActual: "${String(repairedLocalizedUiText)}"`,
  );
}

const nestedReply = {
  ...(rawPost.comments?.[2] ?? {}),
  comment_id: "demo-comment-nested-reply",
  like_count: 9000,
  is_reply: true,
  text: "Reply nhiều like nhưng không phải comment cấp đầu",
  username: "nested_reply",
};

writeFileSync(
  rawCachePath,
  `${JSON.stringify(
    {
      "https://www.threads.com/@author/post/demo-post": {
        ...rawPost,
        // The direct permalink is authoritative even when a share alias has
        // more cached comments for the same canonical post id.
        comments: [rawPost.comments[1], rawPost.comments[2], nestedReply],
        crawled_at: "2026-06-23T00:00:00Z",
      },
      "https://www.threads.com/share/demo-share": {
        ...rawPost,
        source_url: "https://www.threads.com/share/demo-share",
        comments: [
          rawPost.comments[0],
          rawPost.comments[2],
          {
            ...rawPost.comments[2],
            comment_id: "share-only-comment",
            like_count: 5000,
            text: "Share-only comment from the matching source URL",
            username: "share_only",
          },
        ],
        crawled_at: "2026-06-24T00:00:00Z",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

try {
  const repaired = readAndRepairOutputFile(outputPath, { rawCachePath });
  if (!repaired.output) {
    throw new Error("Expected repaired output to be readable.");
  }

  const repairedComments = repaired.output[0]?.posts[0]?.top_comments ?? [];
  if (repairedComments.length !== 2) {
    throw new Error(`Expected 2 repaired comments, got ${String(repairedComments.length)}.`);
  }

  if (repairedComments.some((comment) => comment.comment_id === "demo-comment-1")) {
    throw new Error("Expected contaminated duplicate demo-comment-1 to be removed.");
  }

  if (repairedComments.some((comment) => comment.comment_id === "demo-comment-nested-reply")) {
    throw new Error("Expected nested replies to be excluded even when they have more likes.");
  }

  const repairedComment = repairedComments.find((comment) => comment.comment_id === "demo-comment-2");
  if (!repairedComment) {
    throw new Error("Expected clean deduped comment demo-comment-2 to exist.");
  }

  if (
    repairedComment.avatar_url !==
    "https://instagram.fhan14-1.fna.fbcdn.net/v/t51.82787-19/727497450_unique.jpg?_nc_sid=10d13b"
  ) {
    throw new Error(`Expected clean avatar URL, got ${String(repairedComment.avatar_url)}.`);
  }

  if (repairedComment.like_count !== 11 || repairedComment.reply_count !== 0) {
    throw new Error(
      `Expected repaired counts 11/0, got ${String(repairedComment.like_count)}/${String(repairedComment.reply_count)}.`,
    );
  }

  const shareOutput = structuredClone(output);
  const sharePost = shareOutput[0]?.posts[0];
  if (!sharePost) {
    throw new Error("Expected share output fixture post.");
  }
  sharePost.source_url = "https://www.threads.com/share/demo-share";
  sharePost.top_comments = [];
  shareOutput[0].crawl_audit = {};
  writeFileSync(shareOutputPath, `${JSON.stringify(shareOutput, null, 2)}\n`, "utf8");
  const repairedShare = readAndRepairOutputFile(shareOutputPath, {
    persist: false,
    rawCachePath,
  });
  const shareComments = repairedShare.output?.[0]?.posts[0]?.top_comments ?? [];
  if (!shareComments.some((comment) => comment.comment_id === "share-only-comment")) {
    throw new Error("Expected share source URL to select the matching share-cache entry.");
  }

  const persisted = JSON.parse(readFileSync(outputPath, "utf8")) as TopicData[];
  const repairedAudit = persisted[0]?.crawl_audit as Record<string, unknown> | undefined;
  if (Number(repairedAudit?.output_comment_repair_version ?? 0) !== 7) {
    throw new Error("Expected repaired output to persist repair marker.");
  }

  console.log("smoke:output-comment-repair ok");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
