import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ToolConfig } from "@tool-base/config/schema";
import { Hono } from "hono";
import { z } from "zod";
import {
  assetJsonPath,
  extensionForAsset,
  normalizeRemoteAssetUrl,
  safePathSegment,
} from "./collectors/threads-media.js";
import { CrawlRunService } from "./service.js";
import { withOutputFileLock, writeJsonFileAtomic } from "./storage/output-file.js";
import { ThreadsSessionService } from "./session.js";
import type { TopicData } from "./types.js";

export interface CrawlRoutesOptions {
  config: ToolConfig;
  configPath: string;
  service?: CrawlRunService;
  sessionService?: ThreadsSessionService;
}

interface OutputFileSummary {
  comments: number;
  filename: string;
  label: string;
  modifiedAt: string;
  outputPath: string;
  partial: boolean;
  pendingResumeCount: number;
  posts: number;
  previewPostCount: number;
  requestMeta?: Record<string, unknown>;
  resumeSeedCount: number;
  sizeBytes: number;
  topics: number;
}

const pendingAvatarHydrationByFile = new Map<string, AbortController>();
const outputSummaryCache = new Map<
  string,
  {
    modifiedAtMs: number;
    sizeBytes: number;
    summary: OutputFileSummary;
  }
>();
const OUTPUT_LIST_CACHE_TTL_MS = 1_000;
const outputListCache = new Map<
  string,
  {
    expiresAt: number;
    outputs: OutputFileSummary[];
  }
>();

const crawlApiLimits = {
  arrayItems: 100,
  cacheTtlMinutes: 10_080,
  commentScrollRounds: 20,
  delayMs: 5_000,
  homeScrollRounds: 40,
  longText: 20_000,
  maxCandidateLinks: 150,
  maxCollectedPostsPerTopic: 150,
  maxConcurrency: 3,
  maxMediaPerComment: 6,
  maxMediaPerPost: 8,
  maxPostsPerTopic: 100,
  maxSearchQueriesPerTopic: 12,
  notes: 10_000,
  pathLength: 1_000,
  postScrollRounds: 8,
  requestId: 160,
  searchScrollRounds: 12,
  shortText: 1_000,
  timeoutMs: 60_000,
  topCommentsPerPost: 50,
  topicCount: 10,
  topicTitle: 200,
};

const crawlRunOverridesSchema = z
  .object({
    authStatePath: z.string().max(crawlApiLimits.pathLength).optional(),
    assetDir: z.string().max(crawlApiLimits.pathLength).optional(),
    baseUrl: z.string().url().max(2_048).optional(),
    browserChannel: z.string().max(80).optional(),
    cacheTtlMinutes: z.number().int().min(0).max(crawlApiLimits.cacheTtlMinutes).optional(),
    crawlAssets: z.boolean().optional(),
    deepViralCompare: z.boolean().optional(),
    delayMs: z.number().int().min(0).max(crawlApiLimits.delayMs).optional(),
    downloadAvatars: z.boolean().optional(),
    downloadAssets: z.boolean().optional(),
    executablePath: z.string().max(crawlApiLimits.pathLength).optional(),
    headed: z.boolean().optional(),
    headless: z.boolean().optional(),
    homeScrollRounds: z.number().int().min(0).max(crawlApiLimits.homeScrollRounds).optional(),
    includeCommentAssets: z.boolean().optional(),
    includeHomeFeed: z.boolean().optional(),
    maxCandidateLinks: z.number().int().min(1).max(crawlApiLimits.maxCandidateLinks).optional(),
    maxCollectedPostsPerTopic: z.number().int().min(0).max(crawlApiLimits.maxCollectedPostsPerTopic).optional(),
    maxDetailRequests: z.number().int().min(0).max(crawlApiLimits.maxCollectedPostsPerTopic).optional(),
    maxCommentScanPosts: z.number().int().min(0).max(crawlApiLimits.maxPostsPerTopic).optional(),
    maxAssetDownloadPosts: z.number().int().min(0).max(crawlApiLimits.maxPostsPerTopic).optional(),
    maxConcurrency: z.number().int().min(1).max(crawlApiLimits.maxConcurrency).optional(),
    maxMediaPerComment: z.number().int().min(0).max(crawlApiLimits.maxMediaPerComment).optional(),
    maxMediaPerPost: z.number().int().min(0).max(crawlApiLimits.maxMediaPerPost).optional(),
    maxSearchQueriesPerTopic: z.number().int().min(0).max(crawlApiLimits.maxSearchQueriesPerTopic).optional(),
    commentScrollRounds: z.number().int().min(0).max(crawlApiLimits.commentScrollRounds).optional(),
    outputDir: z.string().max(crawlApiLimits.pathLength).optional(),
    postScrollRounds: z.number().int().min(0).max(crawlApiLimits.postScrollRounds).optional(),
    rawCachePath: z.string().max(crawlApiLimits.pathLength).optional(),
    searchScrollRounds: z.number().int().min(0).max(crawlApiLimits.searchScrollRounds).optional(),
    timeoutMs: z.number().int().min(1_000).max(crawlApiLimits.timeoutMs).optional(),
    validatePostUrls: z.boolean().optional(),
  })
  .optional();

const shortStringSchema = z.string().max(crawlApiLimits.shortText);
const stringArraySchema = z.array(shortStringSchema).max(crawlApiLimits.arrayItems).default([]);
const languageArraySchema = z.array(z.string().min(1).max(16)).max(10).default(["vi"]);
const topicLexiconSchema = z.object({
  canonical: stringArraySchema,
  abbreviations: stringArraySchema,
  teencode: stringArraySchema,
  no_diacritics: stringArraySchema,
}).default({
  canonical: [],
  abbreviations: [],
  teencode: [],
  no_diacritics: [],
});

const rankingWeightsSchema = z.object({
  comments: z.number().min(0).max(10_000).default(16),
  likes: z.number().min(0).max(10_000).default(14),
  recency: z.number().min(0).max(10_000).default(8),
  reposts: z.number().min(0).max(10_000).default(24),
  shares: z.number().min(0).max(10_000).default(22),
  topic_match: z.number().min(0).max(10_000).default(8),
  views: z.number().min(0).max(10_000).default(8),
}).default({
  comments: 16,
  likes: 14,
  recency: 8,
  reposts: 24,
  shares: 22,
  topic_match: 8,
  views: 8,
});

const crawlRequestSchema = z.object({
  created_at: z.string().max(64).default(""),
  filters: z.object({
    date_range: z
      .object({
        end_date: z.string().max(32).default(""),
        preset: z.string().max(40).default(""),
        start_date: z.string().max(32).default(""),
        timezone: z.string().max(80).default(""),
      })
      .default({ end_date: "", preset: "", start_date: "", timezone: "" }),
    exclude_usernames: stringArraySchema,
    include_usernames: stringArraySchema,
    languages: languageArraySchema,
    max_posts_per_topic: z.number().int().min(1).max(crawlApiLimits.maxPostsPerTopic).default(5),
    max_text_length: z.number().int().min(0).max(crawlApiLimits.longText).default(2000),
    min_comment_likes: z.number().int().min(0).max(1_000_000_000).default(0),
    min_comments: z.number().int().min(0).max(1_000_000_000).default(0),
    min_loaded_top_comments: z.number().int().min(0).max(crawlApiLimits.topCommentsPerPost).default(0),
    min_post_likes: z.number().int().min(0).max(1_000_000_000).default(0),
    min_post_views: z.number().int().min(0).max(1_000_000_000).default(0),
    min_post_replies: z.number().int().min(0).max(1_000_000_000).default(0),
    min_post_reposts: z.number().int().min(0).max(1_000_000_000).default(0),
    min_post_score: z.number().min(0).max(1_000_000_000).default(0),
    min_post_shares: z.number().int().min(0).max(1_000_000_000).default(0),
    min_text_length: z.number().int().min(0).max(crawlApiLimits.longText).default(10),
    min_topic_match_score: z.number().min(0).max(1_000_000).default(0),
    recency_half_life_hours: z.number().min(1).max(8_760).default(168),
    ranking_mode: z.enum(["sort_by", "weighted"]).default("weighted"),
    ranking_weights: rankingWeightsSchema,
    require_comments: z.boolean().default(false),
    require_metrics: z.boolean().default(false),
    require_repost_or_share: z.boolean().default(false),
    exclude_posts_with_links: z.boolean().default(true),
    exclude_commerce_content: z.boolean().default(true),
    sort_by: z.string().max(80).default("score"),
    source: z.string().max(80).default("threads"),
    text_contains_all: stringArraySchema,
    text_contains_any: stringArraySchema,
    text_excludes_any: stringArraySchema,
    global_excluded_keywords: stringArraySchema,
    top_comments_per_post: z.number().int().min(0).max(crawlApiLimits.topCommentsPerPost).default(5),
    topics: z
      .array(
        z.object({
          category: z.string().max(80).default("general"),
          excluded_keywords: stringArraySchema,
          keywords: stringArraySchema,
          lexicon: topicLexiconSchema,
          query_variants: stringArraySchema,
          required_keywords: stringArraySchema,
          required_keywords_mode: z.enum(["all", "any"]).default("all"),
          search_queries: stringArraySchema,
          seed_post_urls: stringArraySchema,
          trend_search_urls: stringArraySchema,
          topic_intent: z.string().max(crawlApiLimits.shortText).default(""),
          topic_title: z.string().min(1).max(crawlApiLimits.topicTitle),
        })
      )
      .min(1)
      .max(crawlApiLimits.topicCount),
  }),
  notes: z.string().max(crawlApiLimits.notes).default(""),
  request_id: z.string().min(1).max(crawlApiLimits.requestId),
  runtime_overrides: crawlRunOverridesSchema,
  ui_state: z.record(z.string(), z.unknown()).optional(),
});

const startCrawlRunSchema = z.object({
  configPath: z.string().max(crawlApiLimits.pathLength).optional(),
  overrides: crawlRunOverridesSchema,
  request: crawlRequestSchema.optional(),
  topics: z.array(z.string().max(crawlApiLimits.topicTitle)).max(crawlApiLimits.topicCount).optional(),
});

const crawlMediaAssetSchema = z.object({
  asset_path: z.string(),
  height: z.number(),
  order: z.number(),
  remote_url: z.string(),
  type: z.enum(["image", "video"]),
  width: z.number(),
});

const spoilerRevealRegionSchema = z.object({
  bbox: z.object({
    height: z.number().nonnegative(),
    width: z.number().nonnegative(),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
  }),
  image_height: z.number().positive(),
  image_width: z.number().positive(),
  text: z.string(),
});

const updateOutputCommentSchema = z.object({
  avatar_asset_path: z.string().optional(),
  avatar_url: z.string().optional(),
  comment_id: z.string().min(1),
  created_at: z.string().optional(),
  display_name: z.string().optional(),
  like_count: z.number().optional(),
  reply_count: z.number().optional(),
  repost_count: z.number().optional(),
  share_count: z.number().optional(),
  source_order: z.number().optional(),
  selected_for_video: z.boolean().optional(),
  text: z.string().optional(),
  tts_text: z.string().optional(),
  video_duration_seconds: z.number().finite().min(0.5).max(120).nullable().optional(),
  video_like_count: z.number().int().min(0).nullable().optional(),
  video_reply_count: z.number().int().min(0).nullable().optional(),
  video_share_count: z.number().int().min(0).nullable().optional(),
  media: z.array(crawlMediaAssetSchema).optional(),
  username: z.string().optional(),
  is_spoiler: z.boolean().optional(),
  spoiler_initial_text: z.string().optional(),
  spoiler_reveal_text: z.string().optional(),
  spoiler_media: z.boolean().optional(),
  spoiler_style: z.enum(["blur", "hide"]).optional(),
  spoiler_reveal_regions: z.array(spoilerRevealRegionSchema).optional(),
  spoiler_reveal_media_only: z.boolean().optional(),
});

const updateOutputPostSchema = z.object({
  text: z.string().optional(),
  tts_text: z.string().optional(),
  video_duration_seconds: z.number().finite().min(0.5).max(120).nullable().optional(),
  top_comments: z.array(updateOutputCommentSchema).default([]),
  is_spoiler: z.boolean().optional(),
  spoiler_initial_text: z.string().optional(),
  spoiler_reveal_text: z.string().optional(),
  spoiler_media: z.boolean().optional(),
  spoiler_style: z.enum(["blur", "hide"]).optional(),
  spoiler_reveal_regions: z.array(spoilerRevealRegionSchema).optional(),
  spoiler_reveal_media_only: z.boolean().optional(),
});

export const createCrawlRoutes = (options: CrawlRoutesOptions): Hono => {
  const routes = new Hono();
  const service = options.service ?? new CrawlRunService(options);
  const sessionService =
    options.sessionService ?? new ThreadsSessionService(options);
  const configBaseDir = dirname(options.configPath);
  const assetRoot = resolve(configBaseDir, options.config.crawl.assetDir);
  const outputRoot = resolve(configBaseDir, options.config.crawl.outputDir);

  routes.get("/config", (c) =>
    c.json({
      crawl: options.config.crawl,
    })
  );

  routes.get("/session", (c) =>
    c.json({
      session: sessionService.getStatus(),
    })
  );

  routes.get("/browser/health", async (c) => {
    const mode = c.req.query("mode") === "login" ? "login" : "crawl";
    try {
      return c.json({
        browser: await sessionService.getBrowserHealth(mode),
      });
    } catch (error) {
      return c.json(
        {
          browser: null,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  routes.post("/session/test", async (c) => {
    try {
      return c.json({
        session: await sessionService.test(),
      });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
          session: sessionService.getStatus(),
        },
        500
      );
    }
  });

  routes.post("/session/login", async (c) => {
    try {
      return c.json({
        session: await sessionService.login(),
      });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
          session: sessionService.getStatus(),
        },
        500
      );
    }
  });

  routes.post("/session/logout", (c) =>
    c.json({
      session: sessionService.logout(),
    })
  );

  routes.get("/runs", (c) =>
    c.json({
      runs: service.listRuns(),
    })
  );

  routes.post("/runs", async (c) => {
    const parsed = startCrawlRunSchema.safeParse(await readJsonBody(c.req));
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid crawl run payload.",
          issues: parsed.error.issues,
        },
        400
      );
    }

    const sessionStatus = sessionService.getStatus();
    if (sessionStatus.status !== "ready") {
      return c.json(
        {
          error: buildSessionRequiredMessage(sessionStatus),
          session: sessionStatus,
        },
        409
      );
    }

    try {
      const run = service.startRun(parsed.data);
      return c.json({ run }, 202);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        400
      );
    }
  });

  routes.get("/runs/:id", (c) => {
    const run = service.getRun(c.req.param("id"));
    if (!run) {
      return c.json({ error: "Crawl run not found." }, 404);
    }

    return c.json({ run });
  });

  routes.post("/runs/:id/cancel", (c) => {
    const run = service.cancelRun(c.req.param("id"));
    if (!run) {
      return c.json({ error: "Crawl run not found." }, 404);
    }

    return c.json({ run });
  });

  routes.post("/runs/:id/resume", (c) => {
    try {
      const run = service.resumeRunFromPartial(c.req.param("id"));
      return c.json({ run }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(message)) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 400);
    }
  });

  routes.get("/runs/:id/output", async (c) => {
    const run = service.getRun(c.req.param("id"));
    if (!run) {
      return c.json({ error: "Crawl run not found." }, 404);
    }

    const output = await service.readOutput(run.id);
    if (!output) {
      return c.json({ error: "Crawl output is not available yet." }, 404);
    }

    const hydratedOutput = output as TopicData[];
    if (run.outputPath) {
      scheduleOutputAvatarHydration(
        run.outputPath,
        configBaseDir,
        options.config,
      );
    }

    return c.json({
      output: hydratedOutput,
      outputPath: run.outputPath,
      requestMeta: extractRequestMeta(hydratedOutput),
      run,
    });
  });

  routes.get("/outputs", async (c) =>
    c.json({
      outputs: await listOutputFiles(
        outputRoot,
        c.req.query("includeRequestMeta") === "true",
      ),
      outputRoot,
    })
  );

  routes.get("/outputs/:filename", async (c) => {
    const filePath = resolveOutputPath(c.req.param("filename"), outputRoot);
    if (!filePath || !existsSync(filePath)) {
      return c.json({ error: "Crawl output file not found." }, 404);
    }

    const output = readOutputFile(filePath);
    if (!Array.isArray(output)) {
      return c.json({ error: "Crawl output file is invalid." }, 500);
    }

    scheduleOutputAvatarHydration(
      filePath,
      configBaseDir,
      options.config,
    );

    return c.json({
      file: summarizeOutputFileFromOutput(
        filePath,
        outputRoot,
        output,
      ),
      output,
      outputPath: filePath,
      requestMeta: extractRequestMeta(output),
    });
  });

  routes.patch("/outputs/:filename/posts/:postId", async (c) => {
    const filePath = resolveOutputPath(c.req.param("filename"), outputRoot);
    if (!filePath || !existsSync(filePath)) {
      return c.json({ error: "Crawl output file not found." }, 404);
    }

    const parsed = updateOutputPostSchema.safeParse(await readJsonBody(c.req));
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid post update payload.",
          issues: parsed.error.issues,
        },
        400
      );
    }

    try {
      const result = await withOutputFileLock(filePath, () => {
        const output = readOutputFile(filePath);
        const updatedPost = updateOutputPost(
          output,
          c.req.param("postId"),
          parsed.data
        );

        if (!updatedPost) {
          return null;
        }

        writeOutputFile(filePath, output);
        invalidateOutputListCache();
        return {
          file: summarizeOutputFile(filePath, outputRoot),
          output,
          outputPath: filePath,
          post: updatedPost,
          requestMeta: extractRequestMeta(output),
        };
      });

      if (!result) {
        return c.json({ error: "Post not found in crawl output." }, 404);
      }

      return c.json(result);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  });

  routes.delete("/outputs/:filename", async (c) => {
    const filePath = resolveOutputPath(c.req.param("filename"), outputRoot);
    if (!filePath || !existsSync(filePath)) {
      return c.json({ error: "Crawl output file not found." }, 404);
    }

    try {
      pendingAvatarHydrationByFile.get(filePath)?.abort();
      await withOutputFileLock(filePath, () => {
        unlinkSync(filePath);
        outputSummaryCache.delete(filePath);
        invalidateOutputListCache();
        service.deleteRunByOutputPath(filePath);
      });
      return c.json({
        filename: basename(filePath),
        ok: true,
      });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  });

  routes.get("/assets", (c) => {
    const requestedPath = c.req.query("path") ?? "";
    const filePath = resolveAssetPath(requestedPath, configBaseDir, assetRoot);
    if (!filePath || !existsSync(filePath)) {
      return c.json({ error: "Asset not found." }, 404);
    }

    return c.body(readFileSync(filePath), 200, {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": contentTypeForPath(filePath),
    });
  });

  routes.get("/assets/remote", async (c) => {
    const requestedUrl = String(c.req.query("url") ?? "").trim();
    let remoteUrl: URL;
    try {
      remoteUrl = new URL(requestedUrl);
    } catch {
      return c.json({ error: "Invalid remote asset URL." }, 400);
    }

    if (!["http:", "https:"].includes(remoteUrl.protocol)) {
      return c.json({ error: "Unsupported remote asset protocol." }, 400);
    }

    try {
      const response = await fetchRemoteAsset(remoteUrl);
      if (!response) {
        return c.json(
          { error: "Remote asset fetch failed." },
          502
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType =
        response.headers.get("content-type") || contentTypeForPath(remoteUrl.pathname);
      return c.body(bytes, 200, {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": contentType,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? `Remote asset fetch failed: ${error.message}`
              : "Remote asset fetch failed.",
        },
        502
      );
    }
  });

  return routes;
};

async function fetchRemoteAsset(remoteUrl: URL): Promise<Response | null> {
  const attempts: Array<Record<string, string>> = [
    {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
    },
    {
      Accept: "image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
      Referer: `${remoteUrl.origin}/`,
    },
    {},
  ];

  for (const headers of attempts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(remoteUrl, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      if (response.ok) {
        return response;
      }
    } catch {
      // Try the next attempt profile.
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

async function listOutputFiles(
  outputRoot: string,
  includeRequestMeta = false,
): Promise<OutputFileSummary[]> {
  if (!existsSync(outputRoot)) return [];

  const cacheKey = `${outputRoot}:${includeRequestMeta ? "full" : "compact"}`;
  const now = Date.now();
  const cached = outputListCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.outputs;
  }

  const summaries = await Promise.all(
    readdirSync(outputRoot)
      .filter((filename) => filename.toLowerCase().endsWith(".json"))
      .map((filename) =>
        safeSummarizeOutputFileAsync(resolve(outputRoot, filename), outputRoot)
      )
  );
  const outputs = summaries
    .filter((summary): summary is OutputFileSummary => Boolean(summary))
    .map((summary) => {
      if (includeRequestMeta) return summary;
      const { requestMeta: _requestMeta, ...compactSummary } = summary;
      return compactSummary;
    })
    .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));

  outputListCache.set(cacheKey, {
    expiresAt: now + OUTPUT_LIST_CACHE_TTL_MS,
    outputs,
  });
  return outputs;
}

function invalidateOutputListCache(): void {
  outputListCache.clear();
}

function safeSummarizeOutputFile(
  filePath: string,
  outputRoot: string
): OutputFileSummary | null {
  try {
    return summarizeOutputFile(filePath, outputRoot);
  } catch {
    return null;
  }
}

async function safeSummarizeOutputFileAsync(
  filePath: string,
  outputRoot: string,
): Promise<OutputFileSummary | null> {
  try {
    return await summarizeOutputFileAsync(filePath, outputRoot);
  } catch {
    return null;
  }
}

async function summarizeOutputFileAsync(
  filePath: string,
  outputRoot: string,
): Promise<OutputFileSummary> {
  const stats = statSync(filePath);
  const cached = outputSummaryCache.get(filePath);
  if (
    cached &&
    cached.modifiedAtMs === stats.mtimeMs &&
    cached.sizeBytes === stats.size
  ) {
    return cached.summary;
  }

  const output = JSON.parse(await readFileAsync(filePath, "utf8")) as unknown;
  return summarizeOutputFileFromOutput(filePath, outputRoot, output, stats);
}

function summarizeOutputFile(
  filePath: string,
  outputRoot: string
): OutputFileSummary {
  const stats = statSync(filePath);
  const cached = outputSummaryCache.get(filePath);
  if (
    cached &&
    cached.modifiedAtMs === stats.mtimeMs &&
    cached.sizeBytes === stats.size
  ) {
    return cached.summary;
  }

  const output = readOutputFile(filePath);
  return summarizeOutputFileFromOutput(filePath, outputRoot, output, stats);
}

function summarizeOutputFileFromOutput(
  filePath: string,
  outputRoot: string,
  output: unknown,
  stats = statSync(filePath)
): OutputFileSummary {
  const summary = summarizeOutput(output);
  const requestMeta = extractRequestMeta(output);
  const result = {
    ...summary,
    filename: basename(filePath),
    label: buildOutputLabel(basename(filePath), requestMeta, summary),
    modifiedAt: stats.mtime.toISOString(),
    outputPath: resolve(outputRoot, basename(filePath)),
    requestMeta,
    sizeBytes: stats.size,
  };
  outputSummaryCache.set(filePath, {
    modifiedAtMs: stats.mtimeMs,
    sizeBytes: stats.size,
    summary: result,
  });
  return result;
}

function summarizeOutput(output: unknown): {
  comments: number;
  partial: boolean;
  pendingResumeCount: number;
  posts: number;
  previewPostCount: number;
  resumeSeedCount: number;
  topics: number;
} {
  if (!Array.isArray(output)) {
    return {
      comments: 0,
      partial: false,
      pendingResumeCount: 0,
      posts: 0,
      previewPostCount: 0,
      resumeSeedCount: 0,
      topics: 0,
    };
  }
  let posts = 0;
  let comments = 0;
  for (const topic of output) {
    if (!isRecord(topic) || !Array.isArray(topic.posts)) continue;
    posts += topic.posts.length;
    for (const post of topic.posts) {
      if (!isRecord(post) || !Array.isArray(post.top_comments)) continue;
      comments += post.top_comments.length;
    }
  }
  const checkpoint = extractCheckpointSummary(output);
  return {
    comments,
    partial: checkpoint.partial,
    pendingResumeCount: checkpoint.pendingResumeCount,
    posts,
    previewPostCount: checkpoint.previewPostCount,
    resumeSeedCount: checkpoint.resumeSeedCount,
    topics: output.length,
  };
}

function extractCheckpointSummary(output: unknown): {
  partial: boolean;
  pendingResumeCount: number;
  previewPostCount: number;
  resumeSeedCount: number;
} {
  if (!Array.isArray(output)) {
    return {
      partial: false,
      pendingResumeCount: 0,
      previewPostCount: 0,
      resumeSeedCount: 0,
    };
  }

  for (let index = output.length - 1; index >= 0; index -= 1) {
    const topic = output[index];
    if (!isRecord(topic)) continue;
    const audit = isRecord(topic.crawl_audit) ? topic.crawl_audit : undefined;
    if (!audit) continue;
    const pendingResumeCount = stringList(audit.pending_post_urls).length;
    const resumeSeedCount = stringList(audit.resume_seed_urls).length;
    const previewPostCount = stringList(audit.preview_only_post_urls).length;
    const partial =
      audit.partial_output === true ||
      pendingResumeCount > 0 ||
      resumeSeedCount > 0 ||
      previewPostCount > 0;
    if (!partial) continue;
    return {
      partial,
      pendingResumeCount,
      previewPostCount,
      resumeSeedCount,
    };
  }

  return {
    partial: false,
    pendingResumeCount: 0,
    previewPostCount: 0,
    resumeSeedCount: 0,
  };
}

function readOutputFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function writeOutputFile(filePath: string, output: unknown): void {
  writeJsonFileAtomic(filePath, output);
}

function updateOutputPost(
  output: unknown,
  postId: string,
  patch: z.infer<typeof updateOutputPostSchema>
): Record<string, unknown> | null {
  if (!Array.isArray(output)) {
    return null;
  }

  for (const topic of output) {
    if (!isRecord(topic) || !Array.isArray(topic.posts)) {
      continue;
    }

    for (const post of topic.posts) {
      if (!isRecord(post) || String(post.post_id ?? "") !== postId) {
        continue;
      }

      if (typeof patch.text === "string") {
        post.text = patch.text;
      }
      if (typeof patch.tts_text === "string") {
        post.tts_text = patch.tts_text;
      }
      if (typeof patch.video_duration_seconds === "number") {
        post.video_duration_seconds = patch.video_duration_seconds;
      } else if (patch.video_duration_seconds === null) {
        delete post.video_duration_seconds;
      }
      if (typeof patch.is_spoiler === "boolean") {
        post.is_spoiler = patch.is_spoiler;
      }
      if (typeof patch.spoiler_initial_text === "string") {
        post.spoiler_initial_text = patch.spoiler_initial_text;
      }
      if (typeof patch.spoiler_reveal_text === "string") {
        post.spoiler_reveal_text = patch.spoiler_reveal_text;
      }
      if (typeof patch.spoiler_media === "boolean") {
        post.spoiler_media = patch.spoiler_media;
      }
      if (patch.spoiler_style === "blur" || patch.spoiler_style === "hide") {
        post.spoiler_style = patch.spoiler_style;
      }
      if (Array.isArray(patch.spoiler_reveal_regions)) {
        post.spoiler_reveal_regions = patch.spoiler_reveal_regions;
      }
      if (typeof patch.spoiler_reveal_media_only === "boolean") {
        post.spoiler_reveal_media_only = patch.spoiler_reveal_media_only;
      }

      const commentsById = new Map(
        patch.top_comments.map((comment) => [comment.comment_id, comment])
      );
      const existingCommentIds = new Set<string>();

      if (Array.isArray(post.top_comments)) {
        const currentTopComments = post.top_comments as unknown[];
        const existingCommentsById = new Map(
          currentTopComments
            .filter(isRecord)
            .map((comment) => [String(comment.comment_id ?? ""), comment] as const)
        );

        const nextTopComments = patch.top_comments.map((commentPatch) => {
          const existingComment = existingCommentsById.get(commentPatch.comment_id);
          existingCommentIds.add(commentPatch.comment_id);

          if (existingComment) {
            return {
              ...existingComment,
              ...(typeof commentPatch.avatar_asset_path === "string"
                ? { avatar_asset_path: commentPatch.avatar_asset_path }
                : {}),
              ...(typeof commentPatch.avatar_url === "string"
                ? { avatar_url: commentPatch.avatar_url }
                : {}),
              ...(typeof commentPatch.text === "string"
                ? { text: commentPatch.text }
                : {}),
              ...(typeof commentPatch.tts_text === "string"
                ? { tts_text: commentPatch.tts_text }
                : {}),
              ...(typeof commentPatch.video_duration_seconds === "number"
                ? { video_duration_seconds: commentPatch.video_duration_seconds }
                : commentPatch.video_duration_seconds === null
                  ? { video_duration_seconds: undefined }
                  : {}),
              ...(typeof commentPatch.selected_for_video === "boolean"
                ? { selected_for_video: commentPatch.selected_for_video }
                : {}),
              ...(Array.isArray(commentPatch.media)
                ? { media: commentPatch.media }
                : {}),
              ...(typeof commentPatch.is_spoiler === "boolean"
                ? { is_spoiler: commentPatch.is_spoiler }
                : {}),
              ...(typeof commentPatch.spoiler_initial_text === "string"
                ? { spoiler_initial_text: commentPatch.spoiler_initial_text }
                : {}),
              ...(typeof commentPatch.spoiler_reveal_text === "string"
                ? { spoiler_reveal_text: commentPatch.spoiler_reveal_text }
                : {}),
              ...(typeof commentPatch.spoiler_media === "boolean"
                ? { spoiler_media: commentPatch.spoiler_media }
                : {}),
              ...(commentPatch.spoiler_style === "blur" || commentPatch.spoiler_style === "hide"
                ? { spoiler_style: commentPatch.spoiler_style }
                : {}),
              ...(Array.isArray(commentPatch.spoiler_reveal_regions)
                ? { spoiler_reveal_regions: commentPatch.spoiler_reveal_regions }
                : {}),
              ...(typeof commentPatch.spoiler_reveal_media_only === "boolean"
                ? { spoiler_reveal_media_only: commentPatch.spoiler_reveal_media_only }
                : {}),
              ...(commentPatch.video_like_count === null
                ? { video_like_count: undefined }
                : typeof commentPatch.video_like_count === "number"
                  ? { video_like_count: commentPatch.video_like_count }
                  : {}),
              ...(commentPatch.video_reply_count === null
                ? { video_reply_count: undefined }
                : typeof commentPatch.video_reply_count === "number"
                  ? { video_reply_count: commentPatch.video_reply_count }
                  : {}),
              ...(commentPatch.video_share_count === null
                ? { video_share_count: undefined }
                : typeof commentPatch.video_share_count === "number"
                  ? { video_share_count: commentPatch.video_share_count }
                  : {}),
            };
          }

          return {
            avatar_asset_path: commentPatch.avatar_asset_path ?? "",
            avatar_url: commentPatch.avatar_url ?? "",
            comment_id: commentPatch.comment_id,
            created_at: commentPatch.created_at ?? "",
            display_name: commentPatch.display_name ?? "",
            like_count: commentPatch.like_count ?? 0,
            media: commentPatch.media ?? [],
            repost_count: commentPatch.repost_count ?? 0,
            reply_count: commentPatch.reply_count ?? 0,
            selected_for_video: commentPatch.selected_for_video ?? true,
            share_count: commentPatch.share_count ?? 0,
            source_order: commentPatch.source_order ?? Number.MAX_SAFE_INTEGER,
            text: commentPatch.text ?? "",
            tts_text: commentPatch.tts_text ?? "",
            ...(typeof commentPatch.video_duration_seconds === "number"
              ? { video_duration_seconds: commentPatch.video_duration_seconds }
              : {}),
            username: commentPatch.username ?? "",
            ...(typeof commentPatch.video_like_count === "number"
              ? { video_like_count: commentPatch.video_like_count }
              : {}),
            ...(typeof commentPatch.video_reply_count === "number"
              ? { video_reply_count: commentPatch.video_reply_count }
              : {}),
            ...(typeof commentPatch.video_share_count === "number"
              ? { video_share_count: commentPatch.video_share_count }
              : {}),
            is_spoiler: commentPatch.is_spoiler ?? false,
            spoiler_initial_text: commentPatch.spoiler_initial_text ?? "",
            spoiler_reveal_text: commentPatch.spoiler_reveal_text ?? "",
            spoiler_media: commentPatch.spoiler_media ?? false,
            spoiler_style: commentPatch.spoiler_style ?? "blur",
            spoiler_reveal_regions: commentPatch.spoiler_reveal_regions ?? [],
            spoiler_reveal_media_only: commentPatch.spoiler_reveal_media_only ?? false,
          };
        });

        const untouchedComments = currentTopComments.filter((comment) => {
          if (!isRecord(comment)) {
            return true;
          }
          return !existingCommentIds.has(String(comment.comment_id ?? ""));
        });

        post.top_comments = [...nextTopComments, ...untouchedComments];
      }

      return post;
    }
  }

  return null;
}

function extractRequestMeta(output: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(output)) return undefined;
  for (const topic of output) {
    if (!isRecord(topic) || !isRecord(topic.request_meta)) continue;
    return topic.request_meta;
  }
  return undefined;
}

function buildOutputLabel(
  filename: string,
  requestMeta: Record<string, unknown> | undefined,
  summary: {
    comments: number;
    partial: boolean;
    pendingResumeCount: number;
    posts: number;
    previewPostCount: number;
    resumeSeedCount: number;
    topics: number;
  }
): string {
  const topic = isRecord(requestMeta?.topic) ? requestMeta.topic : undefined;
  const topicTitle = String(topic?.topic_title ?? "").trim();
  const maxPosts = summary.posts;
  if (summary.partial && maxPosts === 0 && summary.pendingResumeCount > 0) {
    return `${topicTitle || filename.replace(/\.json$/i, "")} | Mốc tạm`;
  }
  if (summary.partial && summary.previewPostCount > 0) {
    return `${topicTitle || filename.replace(/\.json$/i, "")} | Preview tạm`;
  }
  const presetLabel = "";
  const topComments = -1;
  const timeLabel = "";
  const parts = [topicTitle || filename.replace(/\.json$/i, ""), presetLabel, maxPosts > 0 ? `${maxPosts} bài` : "", topComments >= 0 ? `${topComments} comment` : "", timeLabel].filter(Boolean);
  return parts.join(" | ");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function shortDatePresetLabel(
  preset: string,
  dateRange: Record<string, unknown> | undefined
): string {
  const normalized = preset.toLowerCase();
  if (normalized === "today") return "hôm nay";
  if (normalized === "last_7_days") return "7 ngày";
  if (normalized === "last_30_days") return "30 ngày";
  if (normalized === "custom") {
    const start = String(dateRange?.start_date ?? "").trim();
    const end = String(dateRange?.end_date ?? "").trim();
    if (start && end) return `${start} đến ${end}`;
    if (start) return `từ ${start}`;
    if (end) return `đến ${end}`;
  }
  return "";
}

function resolveOutputPath(filename: string, outputRoot: string): string {
  const decoded = decodeURIComponent(filename).trim();
  if (!decoded || decoded.includes("\0") || decoded.includes("/") || decoded.includes("\\")) return "";
  if (!decoded.toLowerCase().endsWith(".json")) return "";
  const absolutePath = resolve(outputRoot, decoded);
  const relativeToRoot = relative(outputRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) return "";
  return absolutePath;
}

function resolveToolRelativePath(value: string, configBaseDir: string): string {
  const selectedPath = String(value || "").trim();
  if (!selectedPath) return "";
  if (isAbsolute(selectedPath)) {
    return selectedPath;
  }
  return resolve(configBaseDir, selectedPath);
}

function resolveAssetPath(
  requestedPath: string,
  configBaseDir: string,
  assetRoot: string
): string {
  const decoded = decodeURIComponent(requestedPath).trim();
  if (!decoded || decoded.includes("\0")) return "";
  const normalized = decoded.replace(/\\/g, "/");
  const absolutePath = isAbsolute(normalized)
    ? normalized
    : normalized.startsWith("data/assets/")
      ? resolve(configBaseDir, normalized)
      : resolve(assetRoot, normalized);
  const relativeToRoot = relative(assetRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) return "";
  return absolutePath;
}

function contentTypeForPath(path: string): string {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".gif")) return "image/gif";
  if (lowered.endsWith(".mp4")) return "video/mp4";
  if (lowered.endsWith(".webm")) return "video/webm";
  return "image/jpeg";
}

function hasImageSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 32) return false;
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes[0] === 0x89 && ascii(1, 3) === "PNG") ||
    ascii(0, 3) === "GIF" ||
    (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") ||
    (ascii(4, 4) === "ftyp" &&
      ["avif", "avis", "heic", "heix"].includes(ascii(8, 4)))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: {
  json: () => Promise<unknown>;
}): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function buildSessionRequiredMessage(session: {
  accessState?: "unknown" | "ready" | "login_prompt" | "onboarding";
  status: "missing" | "needs_login" | "network_error" | "ready";
}): string {
  if (session.status === "ready") {
    return "";
  }
  if (session.status === "network_error") {
    return "Threads is unreachable from this machine right now. Check internet, VPN, firewall, or proxy, then use Session > Test again before starting a crawl.";
  }
  if (session.accessState === "onboarding") {
    return "Threads session is still in onboarding. Open Session > Đăng nhập Threads and finish setup before starting a crawl.";
  }
  if (session.status === "needs_login" || session.accessState === "login_prompt") {
    return "Threads session is not ready. Open Session > Đăng nhập Threads and log in before starting a crawl.";
  }
  return "Threads login is required before starting a crawl.";
}

async function hydrateMissingAvatarAssets(
  output: TopicData[],
  configBaseDir: string,
  config: ToolConfig,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted || !Array.isArray(output) || output.length === 0) {
    return false;
  }

  const assetRoot = resolveToolRelativePath(config.crawl.assetDir, configBaseDir);
  const assetPrefix = String(config.crawl.assetDir || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!assetRoot || !assetPrefix) {
    return false;
  }

  const hydrationTasks: Array<() => Promise<boolean>> = [];
  for (const topic of output) {
    if (!isRecord(topic) || !Array.isArray(topic.posts)) continue;
    for (const post of topic.posts) {
      if (!isRecord(post)) continue;

      const postId = safePathSegment(
        String(post.post_id ?? "").trim() || String(post.username ?? "").trim() || "post",
      );
      hydrationTasks.push(() =>
        hydrateAvatarRecord(post, {
          assetPrefix,
          assetRoot,
          configBaseDir,
          fileLabel: "author-avatar",
          postId,
          signal,
          subdir: "",
        }),
      );

      const comments = Array.isArray(post.top_comments) ? post.top_comments : [];
      for (const comment of comments) {
        if (!isRecord(comment)) continue;
        const commentId = safePathSegment(
          String(comment.comment_id ?? "").trim() || String(comment.username ?? "").trim() || "comment",
        );
        hydrationTasks.push(() =>
          hydrateAvatarRecord(comment, {
            assetPrefix,
            assetRoot,
            configBaseDir,
            fileLabel: `${commentId}-avatar`,
            postId,
          signal,
            subdir: "comments",
          }),
        );
      }
    }
  }

  return runAvatarHydrationTasks(hydrationTasks, 4, signal);
}

async function runAvatarHydrationTasks(
  tasks: Array<() => Promise<boolean>>,
  concurrency: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted || tasks.length === 0) return false;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(tasks.length, Math.max(1, concurrency)) },
    async () => {
      let changed = false;
      while (cursor < tasks.length && !signal.aborted) {
        const task = tasks[cursor];
        cursor += 1;
        if (!task) continue;
        changed = (await task()) || changed;
      }
      return changed;
    },
  );
  return (await Promise.all(workers)).some(Boolean);
}

function scheduleOutputAvatarHydration(
  filePath: string,
  configBaseDir: string,
  config: ToolConfig,
): void {
  if (!filePath || pendingAvatarHydrationByFile.has(filePath)) {
    return;
  }

  const controller = new AbortController();
  pendingAvatarHydrationByFile.set(filePath, controller);
  setTimeout(() => {
    void (async () => {
      try {
        if (controller.signal.aborted) return;
        await withOutputFileLock(filePath, async () => {
          if (controller.signal.aborted || !existsSync(filePath)) {
            return;
          }
          const output = readOutputFile(filePath);
          if (!Array.isArray(output)) {
            return;
          }
          const changed = await hydrateMissingAvatarAssets(
            output as TopicData[],
            configBaseDir,
            config,
            controller.signal,
          );
          if (changed && !controller.signal.aborted && existsSync(filePath)) {
            writeOutputFile(filePath, output);
          }
        });
      } catch {
        // Best-effort background hydration only.
      } finally {
        if (pendingAvatarHydrationByFile.get(filePath) === controller) {
          pendingAvatarHydrationByFile.delete(filePath);
        }
      }
    })();
  }, 250);
}

async function hydrateAvatarRecord(
  record: Record<string, unknown>,
  options: {
    assetPrefix: string;
    assetRoot: string;
    configBaseDir: string;
    fileLabel: string;
    postId: string;
    signal: AbortSignal;
    subdir: string;
  },
): Promise<boolean> {
  if (options.signal.aborted) return false;
  const existingAssetPath = String(record.avatar_asset_path ?? "").trim();
  if (existingAssetPath) {
    const resolvedAssetPath = resolveAssetPath(
      existingAssetPath,
      options.configBaseDir,
      options.assetRoot,
    );
    try {
      if (
        resolvedAssetPath &&
        statSync(resolvedAssetPath).isFile() &&
        hasImageSignature(readFileSync(resolvedAssetPath))
      ) {
        return false;
      }
    } catch {
      // Re-download a missing or unreadable local avatar below.
    }
    delete record.avatar_asset_path;
  }

  const remoteUrl = normalizeRemoteAssetUrl(String(record.avatar_url ?? "").trim());
  if (!/^https?:\/\//i.test(remoteUrl)) {
    return Boolean(existingAssetPath);
  }

  const bytesResult = await fetchRemoteAvatarBytes(remoteUrl, options.signal);
  if (!bytesResult) {
    return Boolean(existingAssetPath);
  }

  const hash = createHash("sha1").update(remoteUrl).digest("hex").slice(0, 10);
  const filename = safePathSegment(`${options.fileLabel}-${hash}`);
  const extension = extensionForAsset(remoteUrl, bytesResult.contentType);
  const segments = [options.postId, options.subdir, `${filename}${extension}`].filter(Boolean);
  const outputPath = join(options.assetRoot, ...segments);

  mkdirSync(dirname(outputPath), { recursive: true });
  if (!existsSync(outputPath)) {
    writeFileSync(outputPath, Buffer.from(bytesResult.bytes));
  }

  record.avatar_asset_path = assetJsonPath(options.assetPrefix, segments);
  record.avatar_url = remoteUrl;
  return true;
}

async function fetchRemoteAvatarBytes(
  remoteUrl: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const attempts: Array<Record<string, string>> = [
    {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
    },
    {
      Accept: "image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
      Referer: new URL(remoteUrl).origin + "/",
    },
    {},
  ];

  for (const headers of attempts) {
    if (signal.aborted) return null;
    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    signal.addEventListener("abort", abortRequest, { once: true });
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(remoteUrl, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!hasImageSignature(bytes)) {
        continue;
      }
      return {
        bytes,
        contentType: response.headers.get("content-type") || "",
      };
    } catch {
      // Try next request profile.
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortRequest);
    }
  }

  return null;
}
