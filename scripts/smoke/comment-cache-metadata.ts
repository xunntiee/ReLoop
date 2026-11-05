import {
  cacheHasCurrentExtraction,
  cacheHasRequestedCommentCount,
  THREADS_EXTRACTION_VERSION,
} from "../../apps/server/src/modules/crawl/collectors/threads-cache";
import type { RawPost } from "../../apps/server/src/modules/crawl/types";

const post = (comments: RawPost["comments"]): RawPost =>
  ({
    comments,
    metrics_snapshot: { extraction_version: THREADS_EXTRACTION_VERSION },
  }) as RawPost;

const rootComment = {
  is_reply: false,
  source_order: 2,
  text: "comment cấp cao nhất",
};
const nestedComment = {
  is_reply: true,
  source_order: 1,
  text: "reply lồng",
};

if (!cacheHasCurrentExtraction(post([rootComment, nestedComment]))) {
  throw new Error("Expected a cache with comment selection metadata to be usable.");
}

if (cacheHasCurrentExtraction(post([{ text: "legacy comment" }]))) {
  throw new Error("Expected a cache without reply/order metadata to be invalidated.");
}

if (!cacheHasRequestedCommentCount(post([nestedComment, rootComment]), 1)) {
  throw new Error("Expected the top-level comment to satisfy a request for one comment.");
}

if (cacheHasRequestedCommentCount(post([nestedComment, rootComment]), 2)) {
  throw new Error("Expected nested replies not to count toward the top-comment quota.");
}

console.log("smoke:comment-cache-metadata ok");
