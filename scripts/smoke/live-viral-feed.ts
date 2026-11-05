import { loadToolConfig } from "../../packages/config/src/server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServerApp } from "../../apps/server/src/app";
import { STRICT_BLANK_VIRAL_MIN_SCORE } from "../../apps/server/src/modules/crawl/selection/post-evaluation";
import { resolveImplicitViralRuntimeBudget } from "../../apps/web/src/features/crawl-console/viral-runtime-budget";

const localPlaywrightPath = resolve(
  process.cwd(),
  ".local-web-runtime",
  "ms-playwright"
);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(localPlaywrightPath)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localPlaywrightPath;
}
const loaded = loadToolConfig();
const app = createServerApp({
  config: loaded.config,
  configExists: loaded.exists,
  configPath: loaded.configPath,
  userSettingsPath: loaded.userSettingsPath,
});

const targetPosts = Math.max(1, Math.trunc(Number(process.argv[2] || 2)));
const viralBudget = resolveImplicitViralRuntimeBudget(targetPosts);
const commentsPerPost = 3;
const requestId = `smoke-live-viral-${Date.now()}`;
const response = await app.request("/api/crawl/runs", {
  body: JSON.stringify({
    overrides: {
      commentScrollRounds: 1,
      delayMs: 150,
      executablePath: String(process.env.CRAWL_BROWSER_EXECUTABLE ?? ""),
      headless: true,
      homeScrollRounds: 10,
      includeHomeFeed: true,
      maxAssetDownloadPosts: targetPosts,
      maxCandidateLinks: viralBudget.maxCandidateLinks,
      maxCollectedPostsPerTopic: viralBudget.maxCollectedPostsPerTopic,
      maxCommentScanPosts: viralBudget.maxCommentScanPosts,
      maxConcurrency: targetPosts >= 5 ? 3 : 2,
      maxDetailRequests: viralBudget.maxDetailRequests,
      maxSearchQueriesPerTopic: 0,
      postScrollRounds: 0,
      searchScrollRounds: 0,
      timeoutMs: 10_000,
    },
    request: buildRequest(requestId, targetPosts, commentsPerPost),
  }),
  headers: { "content-type": "application/json" },
  method: "POST",
});

const created = (await response.json()) as {
  error?: string;
  run?: { id: string };
};
if (!response.ok || !created.run?.id) {
  throw new Error(
    created.error || `Unable to start live viral smoke (${response.status}).`
  );
}

const runId = created.run.id;
let lastLine = "";
const deadlineMinutes = Math.max(20, Math.ceil(targetPosts * 1.2) + 10);
const deadline = Date.now() + deadlineMinutes * 60_000;
while (Date.now() < deadline) {
  const statusResponse = await app.request(`/api/crawl/runs/${runId}`);
  const payload = (await statusResponse.json()) as {
    run?: {
      error?: string;
      outputPath?: string;
      progress?: Record<string, unknown>;
      stats?: Record<string, number>;
      status: string;
    };
  };
  const run = payload.run;
  if (!run) throw new Error("Live viral smoke run disappeared.");
  const progress = run.progress ?? {};
  const line = [
    run.status,
    String(progress.stage ?? ""),
    `discovered=${Number(progress.candidate_count ?? progress.discovered_posts ?? 0)}`,
    `summary=${Number(progress.summary_completed ?? 0)}/${Number(progress.summary_target ?? 0)}`,
    `finalist=${Number(progress.finalist_completed ?? 0)}/${Number(progress.finalist_target ?? 0)}`,
    `ready=${Number(progress.ready_output_posts ?? 0)}/${targetPosts}`,
  ].join(" ");
  if (line !== lastLine) {
    console.log(line);
    lastLine = line;
  }
  if (
    [
      "completed",
      "partial_results",
      "no_results",
      "failed",
      "cancelled",
    ].includes(run.status)
  ) {
    if (run.status === "failed")
      throw new Error(run.error || "Live viral smoke failed.");
    if (run.status === "completed") {
      assertProductionViralOutput(
        String(run.outputPath || ""),
        targetPosts,
        commentsPerPost
      );
    }
    console.log(
      JSON.stringify({
        outputPath: run.outputPath,
        stats: run.stats,
        status: run.status,
      })
    );
    process.exit(run.status === "no_results" ? 2 : 0);
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
}

await app.request(`/api/crawl/runs/${runId}/cancel`, { method: "POST" });
throw new Error(
  `Live viral smoke timed out after ${deadlineMinutes} minutes and was cancelled.`
);

function assertProductionViralOutput(
  outputPath: string,
  target: number,
  topComments: number
): void {
  if (!outputPath || !existsSync(outputPath)) {
    throw new Error(`Live viral output file is missing: ${outputPath}`);
  }
  const topics = JSON.parse(readFileSync(outputPath, "utf8")) as Array<{
    posts?: Array<{
      avatar_asset_path?: string;
      avatar_url?: string;
      discovery_source?: string;
      ranking?: { final_score?: number };
      top_comments?: unknown[];
    }>;
  }>;
  const posts = topics.flatMap((topic) => topic.posts ?? []);
  const maxHomeFeedPosts = Math.max(1, Math.floor(target * 0.4));
  const homeFeedPosts = posts.filter(
    (post) => post.discovery_source === "home_feed"
  ).length;
  if (posts.length !== target) {
    throw new Error(`Expected ${target} final posts, got ${posts.length}.`);
  }
  if (homeFeedPosts > maxHomeFeedPosts) {
    throw new Error(
      `Expected at most ${maxHomeFeedPosts} Home feed posts, got ${homeFeedPosts}.`
    );
  }
  for (const post of posts) {
    const score = Number(post.ranking?.final_score ?? 0);
    if (score < STRICT_BLANK_VIRAL_MIN_SCORE) {
      throw new Error(
        `Expected every final viral score >=${STRICT_BLANK_VIRAL_MIN_SCORE}, got ${score}.`
      );
    }
    if ((post.top_comments ?? []).length < topComments) {
      throw new Error(
        `Expected ${topComments} comments per final post, got ${(post.top_comments ?? []).length}.`
      );
    }
    const avatarPath = String(post.avatar_asset_path || "");
    if (!post.avatar_url || !avatarPath || !existsSync(resolve(process.cwd(), avatarPath))) {
      throw new Error("Expected every final post to include a downloaded avatar.");
    }
  }
}

function buildRequest(requestId: string, target: number, topComments: number) {
  return {
    created_at: new Date().toISOString(),
    filters: {
      date_range: {
        end_date: "",
        preset: "",
        start_date: "",
        timezone: "Asia/Ho_Chi_Minh",
      },
      exclude_commerce_content: false,
      exclude_posts_with_links: false,
      exclude_usernames: [],
      global_excluded_keywords: [],
      include_usernames: [],
      languages: ["vi"],
      max_posts_per_topic: target,
      max_text_length: 2_000,
      min_comment_likes: 0,
      min_comments: 0,
      min_loaded_top_comments: 0,
      min_post_likes: 0,
      min_post_replies: 0,
      min_post_reposts: 0,
      min_post_score: 0,
      min_post_shares: 0,
      min_post_views: 0,
      min_text_length: 10,
      min_topic_match_score: 0,
      ranking_mode: "weighted",
      ranking_weights: {
        comments: 16,
        likes: 14,
        recency: 8,
        reposts: 22,
        shares: 20,
        topic_match: 0,
        views: 12,
      },
      recency_half_life_hours: 720,
      require_comments: false,
      require_metrics: false,
      require_repost_or_share: false,
      sort_by: "score",
      source: "threads",
      text_contains_all: [],
      text_contains_any: [],
      text_excludes_any: [],
      top_comments_per_post: topComments,
      topics: [
        {
          category: "general",
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
          required_keywords_mode: "all",
          search_queries: [],
          seed_post_urls: [],
          trend_search_urls: [],
          topic_intent: "Viral feed",
          topic_title: "Viral feed",
        },
      ],
    },
    notes: "Live two-phase viral smoke.",
    request_id: requestId,
    ui_state: { advancedEnabled: false, deep_viral_compare: true },
  };
}
