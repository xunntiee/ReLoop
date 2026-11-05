import { sourceOrderedCommentAssetIndexes } from "../../apps/server/src/modules/crawl/collectors/threads-comment-scan";
import { parseCommentBlocks } from "../../apps/server/src/modules/crawl/collectors/threads-parsing";

const sourceOrderedAssetIndexes = sourceOrderedCommentAssetIndexes(32, 6);
if (sourceOrderedAssetIndexes.join(",") !== "0,1,2,3,4,5") {
  throw new Error(
    `Expected comment media to follow Threads top-comment order, got ${sourceOrderedAssetIndexes.join(",")}.`,
  );
}

const cappedSourceOrderedAssetIndexes = sourceOrderedCommentAssetIndexes(32, 25);
if (cappedSourceOrderedAssetIndexes.length !== 20) {
  throw new Error("Expected comment asset downloads to remain capped at 20 items.");
}

const comments = parseCommentBlocks(
  [
    {
      avatarUrl: "https://example.com/top.jpg",
      href: "https://www.threads.com/@top/post/abc",
      isReply: false,
      likeCount: 1200,
      media: [],
      metricTexts: ["1.2K likes", "1 reply"],
      replyCount: 1,
      text: "topuser 13/06/2026 Comment cap dau",
      username: "topuser",
    },
    {
      avatarUrl: "https://example.com/reply.jpg",
      href: "https://www.threads.com/@reply/post/def",
      isReply: true,
      likeCount: 11,
      media: [],
      metricTexts: ["11 likes"],
      replyCount: 0,
      text: "replyuser 13/06/2026 Comment tra loi",
      username: "replyuser",
    },
    {
      avatarUrl: "https://example.com/author-root.jpg",
      href: "https://www.threads.com/@author/post/root-comment",
      isReply: false,
      likeCount: 1600,
      media: [],
      metricTexts: ["1.6K likes", "3 replies"],
      replyCount: 3,
      text: "author 12/08/2025 Tac gia Comment cap dau cua tac gia van nen lay",
      username: "author",
    },
    {
      avatarUrl: "https://example.com/author-reply.jpg",
      href: "https://www.threads.com/@author/post/reply-comment",
      isReply: true,
      likeCount: 240,
      media: [],
      metricTexts: ["240 likes"],
      replyCount: 0,
      text: "author 12/08/2025 Tac gia Reply cua tac gia vao comment nguoi khac phai bi loai",
      username: "author",
    },
    {
      avatarUrl: "https://example.com/author-badge.jpg",
      href: "https://www.threads.com/@yumakemefun/post/badge-comment",
      isReply: false,
      likeCount: 7000,
      media: [],
      metricTexts: ["7000 likes", "5 replies"],
      replyCount: 5,
      text: "yumakemefun 12/08/2025 \u00b7 T\u00e1c gi\u1ea3 Qua noi 6 sep trung ngay con em ruot moi hay :)))",
      username: "yumakemefun",
    },
  ],
  "post-1",
  "author",
  "Noi dung bai viet goc",
);

if (comments.length !== 5) {
  throw new Error(`Expected top-level and nested comments, received ${String(comments.length)}.`);
}

if (!comments.some((comment) => comment.username === "topuser")) {
  throw new Error("Expected remaining comment username=topuser.");
}

const authorComment = comments.find((comment) => comment.username === "author");
if (!authorComment) {
  throw new Error("Expected top-level author comment to be kept.");
}

if (!authorComment.text.includes("Comment cap dau cua tac gia")) {
  throw new Error(`Expected author root comment text to be preserved, got "${authorComment.text}".`);
}

if (!comments.some((comment) => comment.text.includes("Reply cua tac gia"))) {
  throw new Error("Expected nested author reply to be kept.");
}

const authorBadgeComment = comments.find((comment) => comment.username === "yumakemefun");
if (!authorBadgeComment) {
  throw new Error("Expected author badge comment to be kept.");
}

if (authorBadgeComment.text.includes("T\u00e1c gi\u1ea3")) {
  throw new Error(`Expected author badge to be stripped, got "${authorBadgeComment.text}".`);
}

const topLevelComments = parseCommentBlocks(
  [
    {
      avatarUrl: "https://example.com/root-top.jpg",
      href: "https://www.threads.com/@root-top/post/top",
      isReply: false,
      likeCount: 100,
      metricTexts: ["100 likes"],
      replyCount: 1,
      text: "root-top 13/06/2026 Comment goc co 500 luot thich",
      username: "root-top",
    },
    {
      avatarUrl: "https://example.com/nested-popular.jpg",
      href: "https://www.threads.com/@nested-popular/post/reply",
      isReply: true,
      likeCount: 5000,
      metricTexts: ["5000 likes"],
      replyCount: 0,
      text: "nested-popular 13/06/2026 Reply co nhieu luot thich hon",
      username: "nested-popular",
    },
    {
      avatarUrl: "https://example.com/root-second.jpg",
      href: "https://www.threads.com/@root-second/post/second",
      isReply: false,
      likeCount: 300,
      metricTexts: ["300 likes"],
      replyCount: 0,
      text: "root-second 13/06/2026 Comment goc thu hai",
      username: "root-second",
    },
    {
      avatarUrl: "https://example.com/media-root.jpg",
      href: "https://www.threads.com/@media-root/post/media",
      isReply: false,
      likeCount: 6100,
      metricTexts: ["6100 likes", "170 replies"],
      replyCount: 170,
      media: [
        {
          asset_path: "",
          height: 720,
          order: 1,
          remote_url: "https://example.com/comment-media.jpg",
          type: "image",
          width: 405,
        },
      ],
      text: "media-root 13/06/2026 🤡 hihi",
      username: "media-root",
    },
  ],
  "post-1",
  "author",
  "Noi dung bai viet goc",
  { includeNestedReplies: false, preserveSourceOrder: true },
);

if (topLevelComments.length !== 3 || topLevelComments.some((comment) => comment.username === "nested-popular")) {
  throw new Error("Expected explicit top-level parsing to exclude nested replies from the output.");
}

if (topLevelComments[0]?.username !== "root-top") {
  throw new Error("Expected top-level parser to preserve Threads source order.");
}

if (!topLevelComments.some((comment) => comment.username === "media-root" && comment.text.includes("hihi"))) {
  throw new Error("Expected a short comment with attached media to remain crawlable.");
}

console.log("smoke:comment-replies-filter ok");
