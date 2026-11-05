import { buildCommentTopFrontier } from "../../apps/server/src/modules/crawl/collectors/threads-comment-scan";

const frontier = buildCommentTopFrontier(
  [
    { isReply: false, likeCount: 100, replyCount: 1, text: "root top", username: "root-top" },
    { isReply: true, likeCount: 5_000, replyCount: 0, text: "popular nested reply", username: "nested" },
    { isReply: false, likeCount: 500, replyCount: 0, text: "root second", username: "root-second" },
  ],
  2,
  10,
);

if (!frontier) {
  throw new Error("Expected a top-level comment frontier.");
}

if (frontier.loadedCount !== 2 || frontier.targetCount !== 2) {
  throw new Error(
    `Expected 2 top-level candidates, got ${String(frontier.loadedCount)} / ${String(frontier.targetCount)}.`,
  );
}

if (frontier.signature.includes("nested")) {
  throw new Error("A nested reply must not enter the top-comment frontier.");
}

if (!frontier.signature.startsWith("root-top|")) {
  throw new Error("Top-level frontier must preserve Threads' Hàng đầu order.");
}

console.log("smoke:comment-top-frontier ok");
