import {
  resolveFinishedRunStatus,
  type CrawlRunStatus,
} from "../../apps/server/src/modules/crawl/service";
import type { CrawlProgressSnapshot } from "../../apps/server/src/modules/crawl/types";

function progress(
  committedPosts: number,
  targetPosts: number,
  committedComments = 0,
  targetComments = 0,
): CrawlProgressSnapshot {
  return {
    comment_completed: committedComments,
    comment_target: targetComments,
    committed_comments: committedComments,
    committed_posts: committedPosts,
    detail_completed: committedPosts,
    detail_target: targetPosts,
    stage: "completed",
    summary_posts: committedPosts,
    target_output_posts: targetPosts,
    updated_at: "2026-07-02T00:00:00Z",
  };
}

function expectStatus(
  actual: CrawlRunStatus,
  expected: CrawlRunStatus,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}.`);
  }
}

expectStatus(
  resolveFinishedRunStatus(progress(8, 15, 79, 150), { hasPosts: true }),
  "completed",
  "saved posts finish as completed even below advisory target",
);

expectStatus(
  resolveFinishedRunStatus(progress(15, 15, 150, 150), {
    hasPosts: true,
    postCommentCounts: Array.from({ length: 15 }, () => 10),
  }),
  "completed",
  "post and comment target reached",
);

expectStatus(
  resolveFinishedRunStatus(progress(15, 15, 79, 150), { hasPosts: true }),
  "completed",
  "saved posts finish as completed even when comments are below advisory target",
);

expectStatus(
  resolveFinishedRunStatus(progress(1, 1, 11, 35), { hasPosts: true }),
  "completed",
  "seed-only single pasted post with fewer comments than requested still completes",
);

expectStatus(
  resolveFinishedRunStatus(progress(1, 1, 35, 35), {
    hasPosts: true,
    postCommentCounts: [35],
  }),
  "completed",
  "seed-only single pasted post with requested comments",
);

expectStatus(
  resolveFinishedRunStatus(progress(0, 15), { hasPosts: false }),
  "no_results",
  "no posts",
);

console.log("smoke:crawl-run-status ok");
