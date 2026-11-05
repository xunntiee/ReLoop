import type { ToolConfig } from "@tool-base/config/schema";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadPostCache } from "./collectors/threads-cache.js";
import {
  cacheKey,
  expandSeedTargetUrls,
  normalizeThreadsUrl,
} from "./collectors/threads-url.js";
import { loadCrawlRequest } from "./config/load-config.js";
import {
  buildTopicDataFromRawPosts,
  CrawlPipeline,
} from "./pipeline/crawl-pipeline.js";
import { CrawlJsonWriter } from "./storage/json-writer.js";
import { withOutputFileLock, writeJsonFileAtomic } from "./storage/output-file.js";
import { readAndRepairOutputFile } from "./storage/output-repair.js";
import type {
  CollectorStats,
  CrawlProgressSnapshot,
  CrawlRequest,
  PartialTopicSnapshot,
  PostCollector,
  PostData,
  RankingWeights,
  RawPost,
  TopicData,
} from "./types.js";
import {
  inclusiveDateSpanDays,
  resolveRequestedDateRange,
  splitDateRangeWindows,
} from "./utils/date-range.js";
import { slugifyAscii } from "./utils/text.js";

export type CrawlRunStatus =
  | "queued"
  | "running"
  | "stopping"
  | "stopped_partial"
  | "partial_results"
  | "completed"
  | "no_results"
  | "failed"
  | "cancelled";

export interface CrawlRunOverrides {
  authStatePath?: string;
  assetDir?: string;
  baseUrl?: string;
  browserChannel?: string;
  cacheTtlMinutes?: number;
  crawlAssets?: boolean;
  delayMs?: number;
  deepViralCompare?: boolean;
  downloadAvatars?: boolean;
  downloadAssets?: boolean;
  executablePath?: string;
  headed?: boolean;
  headless?: boolean;
  homeScrollRounds?: number;
  includeCommentAssets?: boolean;
  includeHomeFeed?: boolean;
  maxCandidateLinks?: number;
  maxCollectedPostsPerTopic?: number;
  maxDetailRequests?: number;
  maxCommentScanPosts?: number;
  maxAssetDownloadPosts?: number;
  maxConcurrency?: number;
  maxMediaPerComment?: number;
  maxMediaPerPost?: number;
  maxSearchQueriesPerTopic?: number;
  outputDir?: string;
  commentScrollRounds?: number;
  postScrollRounds?: number;
  rawCachePath?: string;
  searchScrollRounds?: number;
  timeoutMs?: number;
  validatePostUrls?: boolean;
}

export interface StartCrawlRunInput {
  configPath?: string;
  overrides?: CrawlRunOverrides;
  request?: CrawlRequest;
  topics?: string[];
}

export interface CrawlRun {
  cancelRequestedAt?: string;
  configPath: string;
  error?: string;
  finishedAt?: string;
  id: string;
  mode?: "direct_posts" | "seed_profiles" | "discover" | "hybrid" | "resume";
  outputPath?: string;
  queuedAt: string;
  requestId?: string;
  summaryLabel?: string;
  runningStartedAt?: string;
  resumedFromRunId?: string;
  resumedToRunId?: string;
  startedAt: string;
  stats?: CollectorStats;
  progress?: CrawlProgressSnapshot;
  status: CrawlRunStatus;
  topics: string[];
}

export interface CrawlRunServiceOptions {
  config: ToolConfig;
  configPath: string;
}

interface CrawlQueueItem {
  controller: AbortController;
  input: StartCrawlRunInput;
  run: CrawlRun;
}

export class CrawlRunService {
  private readonly configBaseDir: string;
  private activeItem: CrawlQueueItem | null = null;
  private drainPromise: Promise<void> | null = null;
  private isDraining = false;
  private readonly queue: CrawlQueueItem[] = [];
  private runCounter = 0;
  private readonly runs = new Map<string, CrawlRun>();
  private readonly runFingerprints = new Map<string, string>();
  private shuttingDown = false;

  constructor(private readonly options: CrawlRunServiceOptions) {
    this.configBaseDir = dirname(options.configPath);
  }

  listRuns(): CrawlRun[] {
    return [...this.runs.values()].sort(
      (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );
  }

  getRun(id: string): CrawlRun | undefined {
    return this.runs.get(id);
  }

  async readOutput(id: string): Promise<unknown> {
    const run = this.runs.get(id);
    if (!run?.outputPath || !existsSync(run.outputPath)) {
      return null;
    }

    return withOutputFileLock(run.outputPath, () =>
      readAndRepairOutputFile(run.outputPath as string, {
        rawCachePath: this.resolveRawCachePath(),
      }).output
    );
  }

  startRun(input: StartCrawlRunInput = {}): CrawlRun {
    if (this.shuttingDown) {
      throw new Error("Tool đang dừng. Không thể bắt đầu phiên crawl mới.");
    }
    if (!this.options.config.crawl.enabled) {
      throw new Error("Crawl feature is disabled in config.");
    }
    if (input.request) {
      validateCrawlRequestOptions(input.request, this.options.config.crawl.baseUrl);
    }

    const fingerprint = buildRunFingerprint(input);
    const existingRun = this.findDuplicateRun(fingerprint);
    if (existingRun) {
      return existingRun;
    }

    const configPath = this.resolveConfigPath(input.configPath);
    const queuedAt = nowIso();
    const requestedTopComments = Math.max(
      0,
      Number(input.request?.filters.top_comments_per_post ?? 0) || 0,
    );
    const resumeSeedState = resolveResumeSeedState(
      input.request,
      requestedTopComments,
    );
    const requestedPostTarget = Math.max(
      0,
      Number(
        resumeSeedState.totalTargetPosts ??
          input.request?.filters.max_posts_per_topic ??
          0,
      ) || 0,
    );
    const run: CrawlRun = {
      configPath,
      id: this.nextRunId(),
      mode: resolveRunMode(input.request, this.options.config.crawl.baseUrl),
      progress: {
        baseline_comment_target:
          resumeSeedState.totalCommentTarget || undefined,
        baseline_committed_comments:
          resumeSeedState.baselineComments || undefined,
        baseline_committed_posts: resumeSeedState.baselinePosts || undefined,
        baseline_target_output_posts: requestedPostTarget || undefined,
        comment_completed: resumeSeedState.baselineComments,
        comment_target: requestedPostTarget * requestedTopComments,
        committed_comments: resumeSeedState.baselineComments,
        committed_posts: resumeSeedState.baselinePosts,
        detail_completed: resumeSeedState.baselinePosts,
        detail_target: requestedPostTarget,
        message: "Đang chờ đến lượt xử lý",
        stage: "preparing",
        summary_posts: resumeSeedState.baselinePosts,
        target_output_posts: requestedPostTarget,
        updated_at: queuedAt,
      },
      queuedAt,
      startedAt: queuedAt,
      status: "queued",
      summaryLabel: input.request ? buildRunSummaryLabel(input.request) : "",
      topics: input.topics ?? [],
    };

    this.runs.set(run.id, run);
    this.runFingerprints.set(run.id, fingerprint);
    this.queue.push({
      controller: new AbortController(),
      input,
      run,
    });
    if (!this.drainPromise) {
      this.drainPromise = this.drainQueue().finally(() => {
        this.drainPromise = null;
      });
    }
    return run;
  }

  async shutdown(timeoutMs = 15_000): Promise<void> {
    if (this.shuttingDown) {
      await this.waitForDrain(timeoutMs);
      return;
    }

    this.shuttingDown = true;
    for (const item of [...this.queue]) {
      this.cancelRun(item.run.id);
    }
    if (this.activeItem) {
      this.cancelRun(this.activeItem.run.id);
    }
    await this.waitForDrain(timeoutMs);
  }

  cancelRun(id: string): CrawlRun | undefined {
    const queuedIndex = this.queue.findIndex((item) => item.run.id === id);
    if (queuedIndex >= 0) {
      const item = this.queue.splice(queuedIndex, 1)[0];
      if (!item) return undefined;
      item.controller.abort();
      item.run.cancelRequestedAt = nowIso();
      item.run.finishedAt = item.run.cancelRequestedAt;
      item.run.status = "cancelled";
      this.updateRunProgress(item.run, {
        message: "Đã hủy phiên đang chờ",
        stage: "completed",
      });
      return item.run;
    }

    if (this.activeItem?.run.id === id) {
      const run = this.activeItem.run;
      if (run.status === "running") {
        run.cancelRequestedAt = nowIso();
        run.status = "stopping";
        this.updateRunProgress(run, {
          message: "Đang dừng sớm và giữ kết quả hiện tại",
        });
        this.activeItem.controller.abort();
      }
      return run;
    }

    return this.runs.get(id);
  }

  resumeRunFromPartial(id: string): CrawlRun {
    const run = this.runs.get(id);
    if (!run) {
      throw new Error("Crawl run not found.");
    }
    if (run.status !== "stopped_partial") {
      throw new Error("Chỉ có thể tiếp tục từ phiên đã dừng sớm.");
    }
    if (run.resumedToRunId) {
      throw new Error("Phiên này đã tạo phiên tiếp tục rồi.");
    }
    if (!run.outputPath || !existsSync(run.outputPath)) {
      throw new Error("Không tìm thấy file kết quả tạm để tiếp tục.");
    }

    const output = JSON.parse(readFileSync(run.outputPath, "utf8")) as unknown;
    const request = buildResumeRequestFromOutput(output, run);
    const resumedRun = this.startRun({
      request,
      topics: request.filters.topics.map((topic) => topic.topic_title),
    });
    resumedRun.resumedFromRunId = run.id;
    run.resumedToRunId = resumedRun.id;
    return resumedRun;
  }

  private async drainQueue(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        if (item.run.status === "cancelled" || item.controller.signal.aborted) {
          continue;
        }

        this.activeItem = item;
        item.run.runningStartedAt = nowIso();
        item.run.status = "running";
        this.updateRunProgress(item.run, {
          message: "Đang khởi động trình duyệt và chuẩn bị crawl",
          stage: "preparing",
        });
        await this.executeRun(item.run, item.input, item.controller.signal);
        this.activeItem = null;
      }
    } finally {
      this.activeItem = null;
      this.isDraining = false;
    }
  }

  private async waitForDrain(timeoutMs: number): Promise<void> {
    const drainPromise = this.drainPromise;
    if (!drainPromise) {
      return;
    }

    await Promise.race([
      drainPromise,
      new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, Math.max(250, timeoutMs));
      }),
    ]);
  }

  private async executeRun(
    run: CrawlRun,
    input: StartCrawlRunInput,
    signal: AbortSignal,
  ): Promise<void> {
    let resolvedRequest: CrawlRequest | undefined;
    let collector: PostCollector | null = null;
    let effectiveOverrides: CrawlRunOverrides = input.overrides ?? {};
    try {
      throwIfCancelled(signal);
      const request = input.request
        ? {
            ...input.request,
            created_at: input.request.created_at || nowIso(),
          }
        : run.configPath
          ? loadCrawlRequest(run.configPath)
          : buildFallbackCrawlRequest();
      resolvedRequest = request;
      normalizeRequestDefaults(request, this.options.config);
      filterTopics(request, input.topics ?? []);
      effectiveOverrides = resolveRequestRuntimeOverrides(
        request.runtime_overrides,
        input.overrides,
      );
      request.runtime_overrides = { ...effectiveOverrides };
      run.requestId = request.request_id;
      run.mode = resolveRunMode(request, this.options.config.crawl.baseUrl);
      run.summaryLabel = buildRunSummaryLabel(request);
      run.topics = request.filters.topics.map((topic) => topic.topic_title);
      this.updateRunProgress(run, {
        effective_ranking: {
          mode: request.filters.ranking_mode,
          recency_half_life_hours: request.filters.recency_half_life_hours,
          sort_by: request.filters.sort_by,
          weights: { ...request.filters.ranking_weights },
        },
        effective_runtime: { ...effectiveOverrides },
        target_output_posts: request.filters.max_posts_per_topic,
      });

      throwIfCancelled(signal);
      collector = await this.createCollector(
        effectiveOverrides,
        signal,
        request,
        run,
      );
      const outputDir = this.resolveToolPath(
        effectiveOverrides.outputDir ?? this.options.config.crawl.outputDir,
      );
      const pipeline = new CrawlPipeline(
        collector,
        new CrawlJsonWriter(outputDir),
      );

      throwIfCancelled(signal);
      run.outputPath = await pipeline.run(request);
      this.mergeResumedOutput(run);
      run.stats = collector.stats;
      throwIfCancelled(signal);
      const outputSummary = inspectOutputSummary(run.outputPath);
      applyOutputSummaryToProgress(run, request, outputSummary);
      run.status = resolveFinishedRunStatus(run.progress, outputSummary);
      this.updateRunProgress(run, {
        message:
          run.status === "completed"
            ? "Đã lưu xong file kết quả"
            : "Đã lưu file, nhưng không có bài phù hợp",
        stage: "completed",
      });
    } catch (error) {
      if (signal.aborted || isCancelledError(error)) {
        if (resolvedRequest && collector) {
          this.persistBestEffortPartialOutput(
            run,
            effectiveOverrides,
            resolvedRequest,
            collector,
          );
        }
        const outputSummary = inspectOutputSummary(run.outputPath);
        if (resolvedRequest) {
          applyOutputSummaryToProgress(run, resolvedRequest, outputSummary);
        }
        const reachedRunTarget =
          outputSummary.postCount > 0 && hasReachedRunTarget(run.progress);
        const stoppedWithProgress =
          outputSummary.hasPosts ||
          outputSummary.pendingResumeCount > 0 ||
          outputSummary.previewPostCount > 0 ||
          hasMeaningfulProgress(run);
        run.status = reachedRunTarget
          ? "completed"
          : stoppedWithProgress
            ? "stopped_partial"
            : "cancelled";
        this.updateRunProgress(run, {
          message: reachedRunTarget
            ? "Đã đủ số bài cần lấy, đang lưu kết quả"
            : stoppedWithProgress
              ? "Đã dừng sớm và giữ tiến độ hiện tại"
              : "Đã dừng trước khi lấy dữ liệu",
          stage: "completed",
        });
      } else {
        run.error = error instanceof Error ? error.message : String(error);
        run.status = "failed";
      }
    } finally {
      run.finishedAt = nowIso();
    }
  }

  private async createCollector(
    overrides: CrawlRunOverrides,
    signal: AbortSignal,
    request: CrawlRequest,
    run: CrawlRun,
  ): Promise<PostCollector> {
    const { ThreadsWebCollector } = await import("./collectors/threads-web.js");
    const crawlConfig = this.options.config.crawl;
    const authStatePath = this.resolveToolPath(
      overrides.authStatePath ?? crawlConfig.authStatePath,
    );
    const dateRange = resolveCollectorDateRange(
      request.filters.date_range.preset,
      request.filters.date_range.start_date,
      request.filters.date_range.end_date,
      request.created_at,
      request.filters.date_range.timezone,
    );
    const strictBlankViralMode = request.filters.topics.some((topic) =>
      isStrictBlankViralTopic(topic),
    );
    const hasDateFilter = Boolean(dateRange.startDate || dateRange.endDate);
    const dateSpanDays = inclusiveDateSpanDays(
      dateRange.startDate,
      dateRange.endDate,
    );
    const dateWindows = splitDateRangeWindows(
      dateRange.startDate,
      dateRange.endDate,
      60,
      8,
    );
    const wideDateRange = hasDateFilter && dateSpanDays >= 21;
    const longDateRange = hasDateFilter && dateSpanDays >= 60;
    const deepDateRange = hasDateFilter && dateSpanDays >= 120;
    const requestedPostCount = Math.max(1, request.filters.max_posts_per_topic);
    const explicitCollectedPostLimit = Number.isFinite(
      overrides.maxCollectedPostsPerTopic,
    )
      ? Math.max(
          requestedPostCount,
          Math.trunc(overrides.maxCollectedPostsPerTopic ?? requestedPostCount),
        )
      : undefined;
    const explicitSearchQueryLimit = Number.isFinite(
      overrides.maxSearchQueriesPerTopic,
    )
      ? Math.max(0, Math.trunc(overrides.maxSearchQueriesPerTopic ?? 0))
      : undefined;
    const configuredMaxSearchQueries =
      explicitSearchQueryLimit ?? crawlConfig.maxSearchQueriesPerTopic;
    const prefersFeedOnlyDiscovery = shouldUseHomeFeedOnly(request);
    const implicitFeedOnlyBlankViralMode =
      strictBlankViralMode &&
      !hasDateFilter &&
      explicitSearchQueryLimit === undefined;
    const strictBlankHybridMode =
      strictBlankViralMode &&
      explicitSearchQueryLimit === undefined &&
      !implicitFeedOnlyBlankViralMode;
    const feedOnlyMode =
      prefersFeedOnlyDiscovery || implicitFeedOnlyBlankViralMode;
    const mixedBlankViralDiscovery =
      strictBlankViralMode &&
      !feedOnlyMode &&
      explicitSearchQueryLimit !== undefined &&
      explicitSearchQueryLimit > 0;
    const multiWindowBlankViralDiscovery =
      strictBlankViralMode && hasDateFilter && dateSpanDays > 3;
    const includeHomeFeed =
      overrides.includeHomeFeed ??
      (strictBlankHybridMode || feedOnlyMode || crawlConfig.includeHomeFeed);
    const tightBlankViralDiscovery =
      !multiWindowBlankViralDiscovery &&
      (strictBlankHybridMode || (strictBlankViralMode && feedOnlyMode));
    const compactBlankHybridMode =
      strictBlankHybridMode && !multiWindowBlankViralDiscovery;
    const defaultCandidateLinkLimit = tightBlankViralDiscovery
      ? Math.min(
          36,
          Math.max(requestedPostCount * 4, requestedPostCount + 10, 18),
        )
      : multiWindowBlankViralDiscovery
        ? Math.min(
            60,
            Math.max(requestedPostCount * 6, requestedPostCount + 25, 36),
          )
      : Math.min(
          hasDateFilter && feedOnlyMode ? 120 : 72,
          feedOnlyMode
            ? Math.max(
                requestedPostCount * (hasDateFilter ? 6 : 3),
                requestedPostCount + (hasDateFilter ? 40 : 18),
                requestedPostCount <= 3 ? 18 : 36,
              )
            : Math.max(
                requestedPostCount * 10,
                requestedPostCount <= 3 ? 18 : 32,
              ),
        );
    const candidateLinkLimitBase = tightBlankViralDiscovery
      ? Math.max(
          overrides.maxCandidateLinks ?? crawlConfig.maxCandidateLinks,
          defaultCandidateLinkLimit,
        )
      : multiWindowBlankViralDiscovery
        ? Math.max(
            overrides.maxCandidateLinks ?? crawlConfig.maxCandidateLinks,
            defaultCandidateLinkLimit,
          )
      : compactBlankHybridMode
        ? Math.max(
            overrides.maxCandidateLinks ?? crawlConfig.maxCandidateLinks,
            Math.min(
              42,
              Math.max(requestedPostCount * 6, requestedPostCount + 12, 24),
            ),
          )
      : Math.max(
          overrides.maxCandidateLinks ?? crawlConfig.maxCandidateLinks,
          defaultCandidateLinkLimit,
          strictBlankViralMode ? requestedPostCount * 20 : 0,
          strictBlankViralMode ? 120 : 0,
          wideDateRange ? requestedPostCount * 14 : 0,
          longDateRange ? 84 : 0,
          deepDateRange ? 140 : 0,
        );
    const candidateLinkLimit = Math.max(requestedPostCount, candidateLinkLimitBase);
    const defaultCollectedPostLimit = tightBlankViralDiscovery
      ? Math.min(
          candidateLinkLimit,
          Math.max(requestedPostCount * 2, requestedPostCount + 4, 10),
        )
      : multiWindowBlankViralDiscovery
        ? Math.min(
            candidateLinkLimit,
            Math.max(
              Math.ceil(requestedPostCount * 2.2),
              requestedPostCount + 12,
              18,
            ),
          )
      : Math.min(
          candidateLinkLimit,
          feedOnlyMode
            ? Math.max(
                Math.ceil(requestedPostCount * (hasDateFilter ? 2.2 : 1.6)),
                requestedPostCount + (hasDateFilter ? 18 : 10),
                requestedPostCount <= 3 ? 8 : 20,
              )
            : Math.max(
                requestedPostCount * 3,
                requestedPostCount + 4,
                requestedPostCount <= 3 ? 8 : 12,
              ),
        );
    const collectedPostLimitBase = tightBlankViralDiscovery
      ? explicitCollectedPostLimit ??
        Math.max(
          crawlConfig.maxCollectedPostsPerTopic,
          defaultCollectedPostLimit,
        )
      : multiWindowBlankViralDiscovery
        ? explicitCollectedPostLimit ??
          Math.max(
            crawlConfig.maxCollectedPostsPerTopic,
            defaultCollectedPostLimit,
          )
      : compactBlankHybridMode
        ? explicitCollectedPostLimit ??
          Math.max(
            crawlConfig.maxCollectedPostsPerTopic,
            Math.min(
              candidateLinkLimit,
              Math.max(requestedPostCount * 3, requestedPostCount + 6, 12),
            ),
          )
      : explicitCollectedPostLimit ??
        Math.max(
          crawlConfig.maxCollectedPostsPerTopic,
          defaultCollectedPostLimit,
          strictBlankViralMode ? requestedPostCount * 8 : 0,
          strictBlankViralMode ? 40 : 0,
          wideDateRange ? requestedPostCount * 4 : 0,
          longDateRange ? requestedPostCount + 18 : 0,
          deepDateRange ? requestedPostCount + 30 : 0,
        );
    const collectedPostLimit = Math.max(
      requestedPostCount,
      Math.min(candidateLinkLimit, collectedPostLimitBase),
    );
    const resolvedSearchQueryLimitBase = feedOnlyMode
      ? 0
      : multiWindowBlankViralDiscovery
        ? explicitSearchQueryLimit ??
          Math.min(
            5,
            Math.max(
              configuredMaxSearchQueries,
              dateWindows.length > 0 ? dateWindows.length + 2 : 3,
              Math.ceil(requestedPostCount / 2) + 1,
            ),
          )
      : compactBlankHybridMode
        ? Math.max(
            2,
            Math.min(2, explicitSearchQueryLimit ?? configuredMaxSearchQueries),
          )
      : (explicitSearchQueryLimit ??
        Math.min(
          10,
          Math.max(
            configuredMaxSearchQueries,
            strictBlankViralMode ? 8 : 0,
            dateWindows.length > 0 ? dateWindows.length + 1 : 0,
            wideDateRange ? 4 : 0,
            longDateRange ? 6 : 0,
            deepDateRange ? 8 : 0,
          ),
        ));
    const resolvedSearchQueryLimit = resolvedSearchQueryLimitBase;
    const searchScrollRounds =
      feedOnlyMode || resolvedSearchQueryLimit <= 0
        ? 0
        : Math.max(
            overrides.searchScrollRounds ?? crawlConfig.searchScrollRounds,
            multiWindowBlankViralDiscovery
              ? 3
              : compactBlankHybridMode
                ? 2
                : strictBlankViralMode
                  ? 6
                  : 0,
            Math.min(
              deepDateRange ? 14 : longDateRange ? 10 : wideDateRange ? 8 : 5,
              Math.max(
                requestedPostCount <= 3 ? 2 : 3,
                Math.ceil(requestedPostCount / 4) + 2,
                wideDateRange ? Math.ceil(dateSpanDays / 30) + 3 : 0,
              ),
            ),
          );
    const homeScrollRounds = includeHomeFeed
      ? mixedBlankViralDiscovery
        ? Math.max(
            2,
            Math.min(
              6,
              Math.trunc(overrides.homeScrollRounds ?? crawlConfig.homeScrollRounds),
            ),
          )
        : Math.max(
            overrides.homeScrollRounds ?? crawlConfig.homeScrollRounds,
            tightBlankViralDiscovery
              ? 10
              : multiWindowBlankViralDiscovery
                ? 8
              : compactBlankHybridMode
                ? 4
                : strictBlankViralMode
                  ? 18
                  : 0,
            feedOnlyMode
              ? Math.min(
                  hasDateFilter ? 28 : tightBlankViralDiscovery ? 10 : 18,
                  Math.max(
                    hasDateFilter ? 12 : tightBlankViralDiscovery ? 6 : 8,
                    Math.ceil(requestedPostCount * 0.55) +
                      (hasDateFilter ? 10 : tightBlankViralDiscovery ? 3 : 6),
                  ),
                )
              : tightBlankViralDiscovery
                ? Math.min(
                    10,
                    Math.max(6, Math.ceil(requestedPostCount * 0.6) + 2),
                  )
              : Math.min(6, Math.max(2, Math.ceil(requestedPostCount / 3) + 1)),
          )
      : 0;

    return new ThreadsWebCollector({
      allowedLanguages: request.filters.languages,
      authStatePath,
      assetDir: this.resolveToolPath(
        overrides.assetDir ?? crawlConfig.assetDir,
      ),
      assetPathPrefix: normalizeAssetPath(
        overrides.assetDir ?? crawlConfig.assetDir,
      ),
      baseUrl: overrides.baseUrl ?? crawlConfig.baseUrl,
      browserChannel: overrides.browserChannel ?? crawlConfig.browserChannel,
      cachePath: this.resolveToolPath(
        overrides.rawCachePath ?? crawlConfig.rawCachePath,
      ),
      cacheTtlMinutes: overrides.cacheTtlMinutes ?? crawlConfig.cacheTtlMinutes,
      crawlAssets: overrides.crawlAssets ?? crawlConfig.crawlAssets,
      delayMs: overrides.delayMs ?? crawlConfig.delayMs,
      downloadAvatars: overrides.downloadAvatars ?? crawlConfig.downloadAvatars,
      downloadAssets: overrides.downloadAssets ?? crawlConfig.downloadAssets,
      executablePath: resolveOptionalPath(
        this.configBaseDir,
        overrides.executablePath ?? crawlConfig.executablePath,
      ),
      headless:
        overrides.headed === true
          ? false
          : (overrides.headless ?? crawlConfig.headless),
      homeScrollRounds,
      includeCommentAssets:
        overrides.includeCommentAssets ?? crawlConfig.includeCommentAssets,
      includeHomeFeed,
      maxCandidateLinks: candidateLinkLimit,
      maxCollectedPostsPerTopic: collectedPostLimit,
      maxDetailRequests: overrides.maxDetailRequests ?? 0,
      maxCommentScanPosts: overrides.maxCommentScanPosts ?? 0,
      maxAssetDownloadPosts: overrides.maxAssetDownloadPosts ?? 0,
      maxConcurrency: overrides.maxConcurrency ?? crawlConfig.maxConcurrency,
      maxMediaPerComment:
        overrides.maxMediaPerComment ?? crawlConfig.maxMediaPerComment,
      maxMediaPerPost: overrides.maxMediaPerPost ?? crawlConfig.maxMediaPerPost,
      maxSearchQueriesPerTopic: resolvedSearchQueryLimit,
      commentScrollRounds:
        overrides.commentScrollRounds ??
        (feedOnlyMode || tightBlankViralDiscovery
          ? Math.max(
              tightBlankViralDiscovery ? 2 : 4,
              crawlConfig.commentScrollRounds,
            )
          : Math.max(
              request.filters.top_comments_per_post >= 5 ? 3 : 2,
              crawlConfig.commentScrollRounds,
            )),
      postScrollRounds:
        overrides.postScrollRounds ?? crawlConfig.postScrollRounds,
      searchScrollRounds,
      selectionRequest: request,
      sortBy: request.filters.sort_by,
      summaryFirst: true,
      targetOutputPosts: request.filters.max_posts_per_topic,
      topCommentsPerPost: request.filters.top_comments_per_post,
      timeoutMs: overrides.timeoutMs ?? crawlConfig.timeoutMs,
      validatePostUrls:
        overrides.validatePostUrls ?? crawlConfig.validatePostUrls,
      dateEnd: dateRange.endDate,
      dateTimezone: dateRange.timezone,
      dateQueryWindows: dateWindows,
      dateStart: dateRange.startDate,
      onProgress: (progress) => this.updateRunProgress(run, progress),
      signal,
    });
  }

  private persistBestEffortPartialOutput(
    run: CrawlRun,
    overrides: CrawlRunOverrides,
    request: CrawlRequest,
    collector: PostCollector,
  ): void {
    const reachedRunTarget = hasReachedRunTarget(run.progress);
    const rawCache = loadPostCache(
      this.resolveToolPath(
        overrides.rawCachePath ?? this.options.config.crawl.rawCachePath,
      ),
    );
    const topics = request.filters.topics
      .map((topicFilter) => {
        const partialSnapshot = collector.getPartialSnapshot?.(topicFilter) ?? {
          posts: collector.getPartialPosts?.(topicFilter) ?? [],
        };
        const checkpointRawPosts = resolveCheckpointOutputRawPosts(
          partialSnapshot,
          rawCache,
        );
        const hasSnapshotState =
          checkpointRawPosts.length > 0 ||
          (partialSnapshot.resumeSeedUrls?.length ?? 0) > 0 ||
          (partialSnapshot.pendingPostUrls?.length ?? 0) > 0 ||
          (partialSnapshot.previewOnlyPostUrls?.length ?? 0) > 0 ||
          (partialSnapshot.processedPostUrls?.length ?? 0) > 0;
        if (!hasSnapshotState) {
          return null;
        }

        return buildTopicDataFromRawPosts({
          collectorStats: collector.stats,
          partialSnapshot: reachedRunTarget ? null : partialSnapshot,
          rawPosts: checkpointRawPosts,
          request,
          topicFilter,
        });
      })
      .filter((topic): topic is TopicData => Boolean(topic));

    if (topics.length === 0) {
      return;
    }

    if (!run.outputPath) {
      const outputDir = this.resolveToolPath(
        overrides.outputDir ?? this.options.config.crawl.outputDir,
      );
      const writer = new CrawlJsonWriter(outputDir);
      run.outputPath = writer.writeTopics(topics, `${request.request_id}.json`);
    } else {
      writeJsonFileAtomic(run.outputPath, topics);
    }

    this.mergeResumedOutput(run);
  }

  private mergeResumedOutput(run: CrawlRun): void {
    if (
      !run.resumedFromRunId ||
      !run.outputPath ||
      !existsSync(run.outputPath)
    ) {
      return;
    }

    const previousRun = this.runs.get(run.resumedFromRunId);
    if (!previousRun?.outputPath || !existsSync(previousRun.outputPath)) {
      return;
    }

    const previousOutput = readTopicOutput(previousRun.outputPath);
    const currentOutput = readTopicOutput(run.outputPath);
    if (!previousOutput || !currentOutput) {
      return;
    }

    const mergedOutput = mergeTopicOutputs(previousOutput, currentOutput);
    writeJsonFileAtomic(run.outputPath, mergedOutput);
  }

  private updateRunProgress(
    run: CrawlRun,
    patch: Partial<CrawlProgressSnapshot>,
  ): void {
    const previous = run.progress;
    const now = nowIso();
    const normalizedPatch = applyResumeProgressBaseline(previous, patch);
    const nextStage = patch.stage ?? previous?.stage ?? "preparing";
    const stageChanged = previous?.stage !== nextStage;
    const stageDurations = { ...(previous?.stage_durations_ms ?? {}) };
    if (stageChanged && previous?.stage && previous.stage_started_at) {
      const startedAt = new Date(previous.stage_started_at).getTime();
      const endedAt = new Date(now).getTime();
      if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt) {
        stageDurations[previous.stage] =
          Number(stageDurations[previous.stage] ?? 0) + (endedAt - startedAt);
      }
    }
    run.progress = {
      ...previous,
      ...normalizedPatch,
      stage: nextStage,
      stage_durations_ms: stageDurations,
      stage_started_at: stageChanged
        ? now
        : (normalizedPatch.stage_started_at ??
          previous?.stage_started_at ??
          now),
      updated_at: now,
    };
  }

  private resolveConfigPath(value: string | undefined): string {
    const selectedPath =
      value?.trim() || this.options.config.crawl.defaultConfigPath.trim();
    return selectedPath ? this.resolveToolPath(selectedPath) : "";
  }

  private resolveRawCachePath(): string {
    const selectedPath = this.options.config.crawl.rawCachePath.trim();
    return selectedPath ? this.resolveToolPath(selectedPath) : "";
  }

  private resolveToolPath(value: string): string {
    if (isAbsolute(value)) {
      return value;
    }

    return resolve(this.configBaseDir, value);
  }

  private nextRunId(): string {
    this.runCounter += 1;
    return `crawl-${localTimestampForId()}-${String(this.runCounter).padStart(3, "0")}`;
  }

  deleteRunByOutputPath(outputPath: string): void {
    for (const [id, run] of this.runs.entries()) {
      if (run.outputPath === outputPath) {
        this.runs.delete(id);
        this.runFingerprints.delete(id);
      }
    }
  }

  private findDuplicateRun(fingerprint: string): CrawlRun | undefined {
    const duplicateStatuses: CrawlRunStatus[] = [
      "queued",
      "running",
      "stopping",
    ];
    for (const run of this.runs.values()) {
      if (!duplicateStatuses.includes(run.status)) continue;
      if (this.runFingerprints.get(run.id) !== fingerprint) continue;
      return run;
    }
    return undefined;
  }
}

class CrawlCancelledError extends Error {
  constructor() {
    super("Crawl run was cancelled.");
    this.name = "CrawlCancelledError";
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new CrawlCancelledError();
  }
}

function isCancelledError(error: unknown): boolean {
  return (
    error instanceof CrawlCancelledError ||
    (error instanceof Error && error.name === "CrawlCancelledError")
  );
}

export function normalizeRequestDefaults(
  request: CrawlRequest,
  config: ToolConfig,
): void {
  request.filters.languages = request.filters.languages
    .map((item) => item.trim())
    .filter(Boolean);
  if (request.filters.languages.length === 0) {
    request.filters.languages = ["vi"];
  }
  request.filters.ranking_mode =
    request.filters.ranking_mode === "sort_by" ? "sort_by" : "weighted";
  request.filters.ranking_weights = normalizeRankingWeights(
    request.filters.ranking_weights,
  );
  request.filters.global_excluded_keywords = dedupeKeywords(
    thisSafeStringList(request.filters.global_excluded_keywords),
  );
  request.filters.text_excludes_any = dedupeKeywords(
    thisSafeStringList(request.filters.text_excludes_any),
  );
  request.filters.topics = request.filters.topics.map((topic) => ({
    ...topic,
    topic_intent: topic.topic_intent?.trim() || topic.topic_title,
    query_variants: dedupeKeywords(thisSafeStringList(topic.query_variants)),
    required_keywords_mode:
      topic.required_keywords_mode === "any" ? "any" : "all",
    lexicon: {
      canonical: dedupeKeywords(thisSafeStringList(topic.lexicon?.canonical)),
      abbreviations: dedupeKeywords(
        thisSafeStringList(topic.lexicon?.abbreviations),
      ),
      teencode: dedupeKeywords(thisSafeStringList(topic.lexicon?.teencode)),
      no_diacritics: dedupeKeywords(
        thisSafeStringList(topic.lexicon?.no_diacritics),
      ),
    },
    search_queries: dedupeKeywords(thisSafeStringList(topic.search_queries)),
    keywords: dedupeKeywords(thisSafeStringList(topic.keywords)),
    required_keywords: dedupeKeywords(
      thisSafeStringList(topic.required_keywords),
    ),
    excluded_keywords: dedupeKeywords(thisSafeStringList(topic.excluded_keywords)),
    seed_post_urls: dedupeKeywords(
      expandSeedTargetUrls(
        thisSafeStringList(topic.seed_post_urls),
        config.crawl.baseUrl,
      ).map(
        (url) => normalizeThreadsUrl(url, config.crawl.baseUrl).url,
      ),
    ),
    trend_search_urls: dedupeKeywords(thisSafeStringList(topic.trend_search_urls)),
  }));
  applyImplicitViralFeedDefaults(request);
}

export function resolveRequestRuntimeOverrides(
  runtimeOverrides: Record<string, unknown> | undefined,
  baseOverrides: CrawlRunOverrides | undefined,
): CrawlRunOverrides {
  const resolved: CrawlRunOverrides = { ...(baseOverrides ?? {}) };
  if (
    !runtimeOverrides ||
    typeof runtimeOverrides !== "object" ||
    Array.isArray(runtimeOverrides)
  ) {
    return resolved;
  }

  const runtime = runtimeOverrides as Record<string, unknown>;
  const stringKeys: Array<
    | "authStatePath"
    | "assetDir"
    | "baseUrl"
    | "browserChannel"
    | "executablePath"
    | "outputDir"
    | "rawCachePath"
  > = [
    "authStatePath",
    "assetDir",
    "baseUrl",
    "browserChannel",
    "executablePath",
    "outputDir",
    "rawCachePath",
  ];
  const booleanKeys: Array<
    | "crawlAssets"
    | "downloadAvatars"
    | "downloadAssets"
    | "deepViralCompare"
    | "headed"
    | "headless"
    | "includeCommentAssets"
    | "includeHomeFeed"
    | "validatePostUrls"
  > = [
    "crawlAssets",
    "downloadAvatars",
    "downloadAssets",
    "deepViralCompare",
    "headed",
    "headless",
    "includeCommentAssets",
    "includeHomeFeed",
    "validatePostUrls",
  ];
  const numberKeys: Array<
    | "cacheTtlMinutes"
    | "commentScrollRounds"
    | "delayMs"
    | "homeScrollRounds"
    | "maxCandidateLinks"
    | "maxCollectedPostsPerTopic"
    | "maxDetailRequests"
    | "maxCommentScanPosts"
    | "maxAssetDownloadPosts"
    | "maxConcurrency"
    | "maxMediaPerComment"
    | "maxMediaPerPost"
    | "maxSearchQueriesPerTopic"
    | "postScrollRounds"
    | "searchScrollRounds"
    | "timeoutMs"
  > = [
    "cacheTtlMinutes",
    "commentScrollRounds",
    "delayMs",
    "homeScrollRounds",
    "maxCandidateLinks",
    "maxCollectedPostsPerTopic",
    "maxDetailRequests",
    "maxCommentScanPosts",
    "maxAssetDownloadPosts",
    "maxConcurrency",
    "maxMediaPerComment",
    "maxMediaPerPost",
    "maxSearchQueriesPerTopic",
    "postScrollRounds",
    "searchScrollRounds",
    "timeoutMs",
  ];

  for (const key of stringKeys) {
    if (runtime[key] === undefined) continue;
    resolved[key] = String(runtime[key] ?? "");
  }
  for (const key of booleanKeys) {
    if (runtime[key] === undefined) continue;
    resolved[key] = Boolean(runtime[key]);
  }
  for (const key of numberKeys) {
    if (runtime[key] === undefined) continue;
    const parsed = Number(runtime[key]);
    if (Number.isFinite(parsed)) {
      resolved[key] = parsed;
    }
  }
  return resolved;
}

export function applyImplicitViralFeedDefaults(request: CrawlRequest): void {
  if (!request.filters.topics.some((topic) => isStrictBlankViralTopic(topic))) {
    request.filters.min_post_views = Math.max(
      0,
      Number(request.filters.min_post_views) || 0,
    );
    return;
  }
  if (request.ui_state?.advancedEnabled === true) {
    request.filters.min_post_views = Math.max(0, Number(request.filters.min_post_views) || 0);
    return;
  }

  request.filters.min_post_views = Math.max(
    2_500,
    Number(request.filters.min_post_views) || 0,
  );
  request.filters.min_post_score = Math.max(
    55,
    Number(request.filters.min_post_score) || 0,
  );
  request.filters.min_comments = Math.max(
    5,
    Number(request.filters.min_comments) || 0,
  );
  request.filters.min_loaded_top_comments = Math.max(
    2,
    Number(request.filters.min_loaded_top_comments) || 0,
  );
  request.filters.require_metrics = true;
  request.filters.exclude_commerce_content = true;
  request.filters.exclude_posts_with_links = true;
  const hasDateFilter = Boolean(
    String(request.filters.date_range?.preset ?? "").trim() ||
      String(request.filters.date_range?.start_date ?? "").trim() ||
      String(request.filters.date_range?.end_date ?? "").trim(),
  );
  const { startDate, endDate } = resolveRequestedDateRange({
    endValue: request.filters.date_range?.end_date,
    presetValue: request.filters.date_range?.preset,
    referenceTime: request.created_at,
    startValue: request.filters.date_range?.start_date,
    timezone: request.filters.date_range?.timezone,
  });
  const dateSpanDays = inclusiveDateSpanDays(startDate, endDate);

  const useMultiWindowViralDefaults = !hasDateFilter || dateSpanDays > 3;
  if (useMultiWindowViralDefaults) {
    request.filters.ranking_weights = {
      comments: 16,
      likes: 14,
      recency: 8,
      reposts: 22,
      shares: 20,
      topic_match: 0,
      views: 12,
    };
    request.filters.recency_half_life_hours = Math.max(
      720,
      Number(request.filters.recency_half_life_hours) || 0,
    );
  } else {
    request.filters.ranking_weights = {
      comments: 18,
      likes: 16,
      recency: 20,
      reposts: 18,
      shares: 18,
      topic_match: 0,
      views: 10,
    };
    request.filters.recency_half_life_hours = Math.max(
      48,
      Number(request.filters.recency_half_life_hours) || 0,
    );
  }
  request.filters.sort_by = "score";
}

function resolveCollectorDateRange(
  presetValue: string,
  startValue: string,
  endValue: string,
  referenceTime: string,
  timezone?: string,
): { startDate: string; endDate: string; timezone: string } {
  const { startDate, endDate, timezone: resolvedTimezone } = resolveRequestedDateRange({
    endValue,
    presetValue,
    referenceTime,
    startValue,
    timezone,
  });
  return { startDate, endDate, timezone: resolvedTimezone };
}

function filterTopics(request: CrawlRequest, topics: string[]): void {
  const needles = topics
    .map((topic) => topic.trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) {
    return;
  }

  request.filters.topics = request.filters.topics.filter((topic) => {
    const title = topic.topic_title.toLowerCase();
    const category = topic.category.toLowerCase();
    return needles.some(
      (needle) => title.includes(needle) || category.includes(needle),
    );
  });

  if (request.filters.topics.length === 0) {
    throw new Error(`No crawl topics matched: ${topics.join(", ")}`);
  }

  const suffix = request.filters.topics
    .map((topic) => slugifyAscii(topic.topic_title, "topic"))
    .join("-");
  request.request_id = `${request.request_id}-${suffix}`;
}

function resolveOptionalPath(baseDir: string, value: string): string {
  if (!value.trim()) {
    return "";
  }

  return isAbsolute(value) ? value : resolve(baseDir, value);
}

function normalizeAssetPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function inspectOutputHasPosts(outputPath: string | undefined): boolean {
  return inspectOutputSummary(outputPath).hasPosts;
}

function buildRunFingerprint(input: StartCrawlRunInput): string {
  return stableSerialize({
    configPath: input.configPath ?? "",
    overrides: input.overrides ?? {},
    request: input.request
      ? {
          ...input.request,
          created_at: "",
          notes: "",
          request_id: "",
          ui_state: undefined,
        }
      : null,
    topics: input.topics ?? [],
  });
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableSerialize(entryValue)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveResumeSeedState(
  request: CrawlRequest | undefined,
  topCommentsPerPost: number,
): {
  baselineComments: number;
  baselinePosts: number;
  totalCommentTarget: number;
  totalTargetPosts: number;
} {
  const uiState =
    request?.ui_state && typeof request.ui_state === "object"
      ? request.ui_state
      : undefined;
  const baselinePosts = Math.max(
    0,
    Number(uiState?.resume_baseline_posts ?? 0) || 0,
  );
  const baselineComments = Math.max(
    0,
    Number(uiState?.resume_baseline_comments ?? 0) || 0,
  );
  const totalTargetPosts = Math.max(
    baselinePosts,
    Number(
      uiState?.resume_total_target_posts ??
        request?.filters.max_posts_per_topic ??
        0,
    ) || 0,
  );

  return {
    baselineComments,
    baselinePosts,
    totalCommentTarget: totalTargetPosts * Math.max(0, topCommentsPerPost),
    totalTargetPosts,
  };
}

function applyResumeProgressBaseline(
  previous: CrawlProgressSnapshot | undefined,
  patch: Partial<CrawlProgressSnapshot>,
): Partial<CrawlProgressSnapshot> {
  const baselinePosts = Math.max(
    0,
    Number(previous?.baseline_committed_posts ?? 0) || 0,
  );
  const baselineComments = Math.max(
    0,
    Number(previous?.baseline_committed_comments ?? 0) || 0,
  );
  const totalTargetPosts = Math.max(
    0,
    Number(
      previous?.baseline_target_output_posts ??
        previous?.target_output_posts ??
        0,
    ) || 0,
  );
  const totalCommentTarget = Math.max(
    0,
    Number(
      previous?.baseline_comment_target ?? previous?.comment_target ?? 0,
    ) || 0,
  );
  const nextPatch: Partial<CrawlProgressSnapshot> = { ...patch };

  if (baselinePosts > 0) {
    if (patch.committed_posts !== undefined) {
      nextPatch.committed_posts =
        baselinePosts + Math.max(0, Number(patch.committed_posts) || 0);
    }
    if (patch.summary_posts !== undefined) {
      nextPatch.summary_posts =
        baselinePosts + Math.max(0, Number(patch.summary_posts) || 0);
    }
  }

  if (baselineComments > 0) {
    if (patch.comment_completed !== undefined) {
      nextPatch.comment_completed =
        baselineComments + Math.max(0, Number(patch.comment_completed) || 0);
    }
    if (patch.committed_comments !== undefined) {
      nextPatch.committed_comments =
        baselineComments + Math.max(0, Number(patch.committed_comments) || 0);
    }
  }

  if (totalTargetPosts > 0) {
    nextPatch.target_output_posts = totalTargetPosts;
  }
  if (totalCommentTarget > 0) {
    nextPatch.comment_target = totalCommentTarget;
  }

  return nextPatch;
}

function readTopicOutput(outputPath: string): TopicData[] | null {
  try {
    const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as TopicData[]) : null;
  } catch {
    return null;
  }
}

function summarizeTopicOutput(output: unknown): {
  commentCount: number;
  postCount: number;
} {
  if (!Array.isArray(output)) {
    return { commentCount: 0, postCount: 0 };
  }

  let postCount = 0;
  let commentCount = 0;
  for (const topic of output) {
    if (!topic || typeof topic !== "object" || Array.isArray(topic)) {
      continue;
    }
    const posts = Array.isArray((topic as { posts?: unknown[] }).posts)
      ? ((topic as { posts?: unknown[] }).posts as unknown[])
      : [];
    postCount += posts.length;
    for (const post of posts) {
      if (!post || typeof post !== "object" || Array.isArray(post)) {
        continue;
      }
      commentCount += Array.isArray(
        (post as { top_comments?: unknown[] }).top_comments,
      )
        ? ((post as { top_comments?: unknown[] }).top_comments as unknown[])
            .length
        : 0;
    }
  }

  return { commentCount, postCount };
}

function collectOutputPostUrls(output: unknown): string[] {
  if (!Array.isArray(output)) {
    return [];
  }

  return dedupeKeywords(
    output.flatMap((topic) => {
      if (!topic || typeof topic !== "object" || Array.isArray(topic)) {
        return [];
      }
      const posts = (topic as { posts?: unknown[] }).posts;
      if (!Array.isArray(posts)) {
        return [];
      }
      return posts
        .map((post) =>
          post && typeof post === "object" && !Array.isArray(post)
            ? String((post as { url?: unknown }).url ?? "").trim()
            : "",
        )
        .filter(Boolean);
    }),
  );
}

function normalizeResumeUrlKey(url: string): string {
  return url.trim().toLowerCase();
}

export function resolveCheckpointOutputRawPosts(
  snapshot: PartialTopicSnapshot,
  rawCache: Record<string, RawPost>,
): RawPost[] {
  const cacheBackfill = dedupeKeywords([
    ...(snapshot.completedPostUrls ?? []),
    ...(snapshot.previewOnlyPostUrls ?? []),
  ])
    .map((url) => {
      const key = cacheKey(String(url ?? ""));
      const rawPost = key ? rawCache[key] : undefined;
      return rawPost ? structuredClone(rawPost) : null;
    })
    .filter((post): post is RawPost => Boolean(post));

  return uniqueCheckpointRawPosts([
    ...(Array.isArray(snapshot.posts) ? snapshot.posts : []),
    ...cacheBackfill,
  ]);
}

function uniqueCheckpointRawPosts(posts: RawPost[]): RawPost[] {
  const output: RawPost[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    const key = cacheKey(
      String(post.url ?? post.source_url ?? post.post_id ?? "").trim(),
    );
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(post);
  }
  return output;
}

export function mergeTopicOutputs(
  previous: TopicData[],
  current: TopicData[],
): TopicData[] {
  const currentByTitle = new Map(
    current.map(
      (topic) => [topic.topic_title.trim().toLowerCase(), topic] as const,
    ),
  );
  const merged: TopicData[] = [];
  const seenKeys = new Set<string>();

  for (const previousTopic of previous) {
    const key = previousTopic.topic_title.trim().toLowerCase();
    const currentTopic = currentByTitle.get(key);
    if (!currentTopic) {
      merged.push(previousTopic);
      seenKeys.add(key);
      continue;
    }

    const limit = resolveMergedTopicPostLimit(previousTopic, currentTopic);
    const mergedPosts = mergeTopicPosts(
      previousTopic.posts,
      currentTopic.posts,
      limit,
    );
    const requestMeta = normalizeMergedRequestMeta(
      currentTopic.request_meta ?? previousTopic.request_meta,
      limit,
    );
    merged.push({
      ...previousTopic,
      ...currentTopic,
      crawl_audit: mergeTopicAudit(
        previousTopic.crawl_audit,
        currentTopic.crawl_audit,
        mergedPosts,
      ),
      keywords:
        currentTopic.keywords.length > 0
          ? currentTopic.keywords
          : previousTopic.keywords,
      posts: sanitizeMergedPosts(mergedPosts, requestMeta),
      request_meta: requestMeta,
    });
    seenKeys.add(key);
  }

  for (const currentTopic of current) {
    const key = currentTopic.topic_title.trim().toLowerCase();
    if (seenKeys.has(key)) {
      continue;
    }
    merged.push(currentTopic);
  }

  return merged;
}

function resolveMergedTopicPostLimit(
  previousTopic: TopicData,
  currentTopic: TopicData,
): number {
  const previousTarget = Math.max(
    0,
    Number(previousTopic.request_meta?.max_posts_per_topic ?? 0) || 0,
  );
  const currentTarget = Math.max(
    0,
    Number(currentTopic.request_meta?.max_posts_per_topic ?? 0) || 0,
  );
  const resumeTotalTarget = Math.max(
    0,
    Number(
      currentTopic.request_meta?.ui_state?.resume_total_target_posts ??
        previousTopic.request_meta?.ui_state?.resume_total_target_posts ??
        0,
    ) || 0,
  );
  const mergedObservedCount =
    previousTopic.posts.length + currentTopic.posts.length;
  return Math.max(
    previousTarget,
    currentTarget,
    resumeTotalTarget,
    mergedObservedCount,
  );
}

function normalizeMergedRequestMeta(
  requestMeta: TopicData["request_meta"],
  postLimit: number,
): TopicData["request_meta"] {
  if (!requestMeta) {
    return requestMeta;
  }

  return {
    ...requestMeta,
    max_posts_per_topic: postLimit,
  };
}

function mergeTopicAudit(
  previousAudit: Record<string, unknown> | undefined,
  currentAudit: Record<string, unknown> | undefined,
  mergedPosts: PostData[],
): Record<string, unknown> | undefined {
  if (!previousAudit && !currentAudit) {
    return undefined;
  }

  const mergedAudit: Record<string, unknown> = {
    ...(previousAudit ?? {}),
    ...(currentAudit ?? {}),
  };
  const currentIsPartial = Boolean(currentAudit?.partial_output);

  mergedAudit.completed_post_urls = dedupeKeywords(
    mergedPosts.map((post) => String(post.url ?? "").trim()).filter(Boolean),
  );
  if (currentIsPartial) {
    mergedAudit.pending_post_urls = thisSafeStringList(
      currentAudit?.pending_post_urls,
    );
    mergedAudit.preview_only_post_urls = thisSafeStringList(
      currentAudit?.preview_only_post_urls,
    );
    mergedAudit.resume_seed_urls = thisSafeStringList(
      currentAudit?.resume_seed_urls,
    );
    mergedAudit.processed_post_urls = thisSafeStringList(
      currentAudit?.processed_post_urls,
    );
    mergedAudit.partial_output = true;
  } else {
    delete mergedAudit.partial_output;
    delete mergedAudit.pending_post_urls;
    delete mergedAudit.preview_only_post_urls;
    delete mergedAudit.resume_seed_urls;
    delete mergedAudit.processed_post_urls;
  }

  return mergedAudit;
}

function mergeTopicPosts(
  previousPosts: PostData[],
  currentPosts: PostData[],
  limit: number,
): PostData[] {
  const mergedByKey = new Map<string, PostData>();
  const orderedKeys: string[] = [];

  for (const post of previousPosts) {
    const key = resolveMergedPostKey(post);
    if (!key || mergedByKey.has(key)) {
      continue;
    }
    mergedByKey.set(key, post);
    orderedKeys.push(key);
  }

  for (const post of currentPosts) {
    const key = resolveMergedPostKey(post);
    if (!key) {
      continue;
    }
    if (!mergedByKey.has(key)) {
      orderedKeys.push(key);
      mergedByKey.set(key, post);
      continue;
    }
    mergedByKey.set(key, preferRicherPost(mergedByKey.get(key)!, post));
  }

  const mergedPosts = orderedKeys
    .map((key) => mergedByKey.get(key))
    .filter((post): post is PostData => Boolean(post));
  return limit > 0 ? mergedPosts.slice(0, limit) : mergedPosts;
}

function sanitizeMergedPosts(
  posts: PostData[],
  requestMeta: TopicData["request_meta"],
): PostData[] {
  const topCommentsPerPost = Math.max(
    0,
    Number(requestMeta?.top_comments_per_post ?? 0) || 0,
  );
  const minPostViews = Math.max(
    0,
    Number(requestMeta?.min_post_views ?? 0) || 0,
  );
  const minPostLikes = Math.max(
    0,
    Number(requestMeta?.min_post_likes ?? 0) || 0,
  );
  const minPostReplies = Math.max(
    0,
    Number(requestMeta?.min_post_replies ?? 0) || 0,
  );
  const minPostReposts = Math.max(
    0,
    Number(requestMeta?.min_post_reposts ?? 0) || 0,
  );
  const minPostShares = Math.max(
    0,
    Number(requestMeta?.min_post_shares ?? 0) || 0,
  );
  const requireMetrics = Boolean(requestMeta?.require_metrics);

  return posts
    .map((post) => ({
      ...post,
      top_comments:
        topCommentsPerPost > 0
          ? post.top_comments.slice(0, topCommentsPerPost)
          : post.top_comments,
    }))
    .filter((post) => {
      const metricsTotal =
        Number(post.like_count ?? 0) +
        Number(post.reply_count ?? 0) +
        Number(post.repost_count ?? 0) +
        Number(post.quote_count ?? 0) +
        Number(post.share_count ?? 0);
      if (requireMetrics && metricsTotal <= 0) return false;
      if (Number(post.view_count ?? 0) < minPostViews) return false;
      if (Number(post.like_count ?? 0) < minPostLikes) return false;
      if (Number(post.reply_count ?? 0) < minPostReplies) return false;
      if (Number(post.repost_count ?? 0) < minPostReposts) return false;
      if (Number(post.share_count ?? 0) < minPostShares) return false;
      return true;
    });
}

function resolveMergedPostKey(post: Pick<PostData, "post_id" | "url">): string {
  const byId = String(post.post_id ?? "").trim();
  if (byId) {
    return byId.toLowerCase();
  }
  return normalizeResumeUrlKey(String(post.url ?? ""));
}

function preferRicherPost(previous: PostData, current: PostData): PostData {
  const previousComments = Array.isArray(previous.top_comments)
    ? previous.top_comments.length
    : 0;
  const currentComments = Array.isArray(current.top_comments)
    ? current.top_comments.length
    : 0;
  if (currentComments !== previousComments) {
    return currentComments > previousComments ? current : previous;
  }

  const previousMedia = Array.isArray(previous.media)
    ? previous.media.length
    : 0;
  const currentMedia = Array.isArray(current.media) ? current.media.length : 0;
  if (currentMedia !== previousMedia) {
    return currentMedia > previousMedia ? current : previous;
  }

  return String(current.text ?? "").length >= String(previous.text ?? "").length
    ? current
    : previous;
}

function inspectOutputSummary(outputPath: string | undefined): {
  hasPosts: boolean;
  postCount: number;
  commentCount: number;
  postCommentCounts: number[];
  pendingResumeCount: number;
  previewPostCount: number;
} {
  if (!outputPath || !existsSync(outputPath)) {
    return {
      hasPosts: false,
      postCount: 0,
      commentCount: 0,
      postCommentCounts: [],
      pendingResumeCount: 0,
      previewPostCount: 0,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as Array<{
      posts?: Array<{ top_comments?: unknown[] }>;
      crawl_audit?: unknown;
    }>;
    if (!Array.isArray(parsed)) {
      return {
        hasPosts: false,
        postCount: 0,
        commentCount: 0,
        postCommentCounts: [],
        pendingResumeCount: 0,
        previewPostCount: 0,
      };
    }

    let postCount = 0;
    let commentCount = 0;
    const postCommentCounts: number[] = [];
    for (const topic of parsed) {
      const posts = Array.isArray(topic?.posts) ? topic.posts : [];
      postCount += posts.length;
      for (const post of posts) {
        const perPostCommentCount = Array.isArray(post?.top_comments)
          ? post.top_comments.length
          : 0;
        commentCount += perPostCommentCount;
        postCommentCounts.push(perPostCommentCount);
      }
    }

    const checkpointSummary = inspectOutputCheckpointSummary(parsed);

    return {
      hasPosts: postCount > 0,
      postCount,
      commentCount,
      postCommentCounts,
      pendingResumeCount: checkpointSummary.pendingResumeCount,
      previewPostCount: checkpointSummary.previewPostCount,
    };
  } catch {
    return {
      hasPosts: false,
      postCount: 0,
      commentCount: 0,
      postCommentCounts: [],
      pendingResumeCount: 0,
      previewPostCount: 0,
    };
  }
}

function inspectOutputCheckpointSummary(
  output: Array<{ crawl_audit?: unknown }>,
): {
  pendingResumeCount: number;
  previewPostCount: number;
} {
  for (let index = output.length - 1; index >= 0; index -= 1) {
    const topic = output[index];
    if (!topic || typeof topic !== "object" || Array.isArray(topic)) {
      continue;
    }
    const audit =
      topic.crawl_audit &&
      typeof topic.crawl_audit === "object" &&
      !Array.isArray(topic.crawl_audit)
        ? topic.crawl_audit
        : undefined;
    if (!audit) {
      continue;
    }

    const pendingResumeCount = thisSafeStringList(
      (audit as Record<string, unknown>).pending_post_urls,
    ).length;
    const previewPostCount = thisSafeStringList(
      (audit as Record<string, unknown>).preview_only_post_urls,
    ).length;
    if (
      (audit as Record<string, unknown>).partial_output === true ||
      pendingResumeCount > 0 ||
      previewPostCount > 0
    ) {
      return {
        pendingResumeCount,
        previewPostCount,
      };
    }
  }

  return {
    pendingResumeCount: 0,
    previewPostCount: 0,
  };
}

export function applyOutputSummaryToProgress(
  run: CrawlRun,
  request: CrawlRequest,
  summary: {
    hasPosts: boolean;
    postCount: number;
    commentCount: number;
    postCommentCounts?: number[];
    pendingResumeCount: number;
    previewPostCount: number;
  },
): void {
  const topComments = Math.max(
    0,
    Number(request.filters.top_comments_per_post) || 0,
  );
  const resumeSeedState = resolveResumeSeedState(request, topComments);
  const targetPosts = Math.max(
    0,
    Number(
      resumeSeedState.totalTargetPosts || request.filters.max_posts_per_topic,
    ) || 0,
  );
  const targetComments = Math.max(
    0,
    Number(resumeSeedState.totalCommentTarget || targetPosts * topComments) ||
      0,
  );
  const postCount = Math.max(0, Number(summary.postCount ?? 0) || 0);
  const commentCount = Math.max(0, Number(summary.commentCount ?? 0) || 0);
  const previousReachedTarget = summary.hasPosts && hasReachedRunTarget(run.progress);
  const previousPostCount = Math.max(
    0,
    Number(run.progress?.committed_posts ?? run.progress?.summary_posts ?? 0) ||
      0,
  );
  const previousCommentCount = Math.max(
    0,
    Number(
      run.progress?.committed_comments ?? run.progress?.comment_completed ?? 0,
    ) || 0,
  );
  const committedPosts = previousReachedTarget
    ? Math.max(postCount, previousPostCount)
    : postCount;
  const committedComments = previousReachedTarget
    ? Math.max(commentCount, previousCommentCount)
    : commentCount;
  const pendingResumeCount = Math.max(
    0,
    Number(summary.pendingResumeCount ?? 0) || 0,
  );
  const reachedTarget =
    committedPosts >= targetPosts &&
    (targetComments <= 0 || committedComments >= targetComments);

  run.progress = {
    ...run.progress,
    comment_completed: committedComments,
    comment_target: targetComments,
    committed_comments: committedComments,
    committed_posts: committedPosts,
    current_post: "",
    current_query: "",
    current_url: "",
    detail_completed: committedPosts,
    detail_target: targetPosts || committedPosts,
    message:
      summary.hasPosts || committedPosts > 0
        ? "Đã giữ lại kết quả tạm"
        : pendingResumeCount > 0 || Number(summary.previewPostCount ?? 0) > 0
          ? "Đã lưu mốc tiếp tục nhưng chưa có bài hoàn chỉnh"
          : "Đã lưu mốc tiếp tục nhưng chưa có bài hoàn chỉnh",
    pending_posts: reachedTarget ? 0 : pendingResumeCount,
    preview_only_posts: Math.max(0, Number(summary.previewPostCount ?? 0) || 0),
    queued_candidates: 0,
    ready_output_comments: committedComments,
    ready_output_posts: committedPosts,
    resume_ready: reachedTarget
      ? false
      : pendingResumeCount > 0 || Number(summary.previewPostCount ?? 0) > 0
        ? true
        : false,
    selected_posts:
      committedPosts + Math.max(0, Number(summary.previewPostCount ?? 0) || 0),
    stage: "completed",
    stage_started_at: run.progress?.stage_started_at ?? nowIso(),
    summary_posts: committedPosts,
    target_output_posts: targetPosts || committedPosts,
    updated_at: nowIso(),
  };
}

function hasMeaningfulProgress(run: CrawlRun): boolean {
  const progress = run.progress;
  if (!progress) return false;
  return (
    Number(progress.candidate_count ?? 0) > 0 ||
    Number(progress.queued_candidates ?? 0) > 0 ||
    Number(progress.pending_posts ?? 0) > 0 ||
    Number(progress.preview_only_posts ?? 0) > 0 ||
    Number(progress.ready_output_posts ?? 0) > 0 ||
    Number(progress.selected_posts ?? 0) > 0 ||
    Number(progress.summary_posts ?? 0) > 0 ||
    Number(progress.detail_completed ?? 0) > 0 ||
    Number(progress.comment_completed ?? 0) > 0
  );
}

export function hasReachedRunTarget(
  progress: CrawlProgressSnapshot | undefined,
): boolean {
  const targetPosts = Math.max(
    0,
    Number(progress?.target_output_posts ?? 0) || 0,
  );
  if (targetPosts <= 0) {
    return false;
  }

  const committedPosts = Math.max(
    0,
    Number(progress?.committed_posts ?? progress?.summary_posts ?? 0) || 0,
  );
  if (committedPosts < targetPosts) {
    return false;
  }

  const targetComments = Math.max(
    0,
    Number(progress?.comment_target ?? 0) || 0,
  );
  if (targetComments <= 0) {
    return true;
  }

  const committedComments = Math.max(
    0,
    Number(progress?.committed_comments ?? progress?.comment_completed ?? 0) ||
      0,
  );
  return committedComments >= targetComments;
}

export function resolveFinishedRunStatus(
  progress: CrawlProgressSnapshot | undefined,
  summary: { hasPosts: boolean; postCommentCounts?: number[] },
): CrawlRunStatus {
  void progress;
  void summary.postCommentCounts;
  if (!summary.hasPosts) return "no_results";
  return "completed";
}

export function buildResumeRequestFromOutput(
  output: unknown,
  run: CrawlRun,
): CrawlRequest {
  if (!Array.isArray(output) || output.length === 0) {
    throw new Error("File kết quả tạm không hợp lệ.");
  }

  const firstTopic = output.find(
    (topic) => topic && typeof topic === "object" && !Array.isArray(topic),
  ) as Record<string, unknown> | undefined;
  const crawlAudit = firstTopic?.crawl_audit as
    | Record<string, unknown>
    | undefined;
  const requestMeta = firstTopic?.request_meta as
    | Record<string, unknown>
    | undefined;
  const requestTopic = requestMeta?.topic as
    | Record<string, unknown>
    | undefined;
  const requestDateRange = requestMeta?.date_range as
    | Record<string, unknown>
    | undefined;
  const requestLexicon = requestTopic?.lexicon as
    | Record<string, unknown>
    | undefined;
  const resumeRequiresViralSignalFloor = requestTopic
    ? isStrictBlankViralTopic({
        keywords: thisSafeStringList(requestTopic.keywords),
        query_variants: thisSafeStringList(requestTopic.query_variants),
        required_keywords: thisSafeStringList(requestTopic.required_keywords),
        search_queries: thisSafeStringList(requestTopic.search_queries),
        seed_post_urls: thisSafeStringList(requestTopic.seed_post_urls),
        topic_intent: String(requestTopic.topic_intent ?? ""),
        topic_title: String(requestTopic.topic_title ?? ""),
      })
    : false;
  const outputSummary = summarizeTopicOutput(output);
  const completedUrls = collectOutputPostUrls(output);
  const completedUrlSet = new Set(
    completedUrls.map((url) => normalizeResumeUrlKey(url)),
  );
  const auditCompletedUrls = thisSafeStringList(
    crawlAudit?.completed_post_urls,
  );
  const pendingUrls = thisSafeStringList(crawlAudit?.pending_post_urls);
  const previewOnlyUrls = thisSafeStringList(
    crawlAudit?.preview_only_post_urls,
  );
  const auditResumeUrls = thisSafeStringList(crawlAudit?.resume_seed_urls);
  const effectiveCompletedUrls = dedupeKeywords(
    auditCompletedUrls.length > 0 ? auditCompletedUrls : completedUrls,
  );
  const remainingResumeUrls = dedupeKeywords(
    auditResumeUrls.filter(
      (url) => !completedUrlSet.has(normalizeResumeUrlKey(url)),
    ),
  );
  const pendingIncompleteUrls = dedupeKeywords(
    pendingUrls.filter(
      (url) => !completedUrlSet.has(normalizeResumeUrlKey(url)),
    ),
  );
  const originalTargetPosts = Math.max(
    1,
    Number(
      requestMeta?.max_posts_per_topic ??
        run.progress?.target_output_posts ??
        completedUrls.length,
    ) || completedUrls.length,
  );
  const completedPostCountForResume = Math.max(
    effectiveCompletedUrls.length,
    previewOnlyUrls.length > 0 || pendingUrls.length > 0
      ? 0
      : outputSummary.postCount,
  );
  const remainingTargetPosts = Math.max(
    0,
    originalTargetPosts - completedPostCountForResume,
  );
  let seedUrls = dedupeKeywords(
    previewOnlyUrls.length > 0
      ? previewOnlyUrls
      : remainingTargetPosts > 0 && pendingIncompleteUrls.length > 0
        ? pendingIncompleteUrls
        : remainingResumeUrls.length > 0
          ? remainingResumeUrls
          : effectiveCompletedUrls,
  );
  const resumeRuntimeSource = isRecord(requestMeta?.runtime_overrides)
    ? (requestMeta.runtime_overrides as Record<string, unknown>)
    : {};
  const originalIncludeHomeFeed = Boolean(resumeRuntimeSource.includeHomeFeed);
  const originalMaxSearchQueries = Math.max(
    0,
    Number(resumeRuntimeSource.maxSearchQueriesPerTopic ?? 0) || 0,
  );
  const canContinueDiscovery =
    remainingTargetPosts > 0 &&
    previewOnlyUrls.length === 0 &&
    seedUrls.length < remainingTargetPosts;

  if (seedUrls.length === 0 && !canContinueDiscovery) {
    throw new Error("Không có bài tạm nào để tiếp tục.");
  }

  if (remainingTargetPosts <= 0 && previewOnlyUrls.length === 0) {
    throw new Error(
      "Phiên crawl này đã đủ target, không còn bài nào cần tiếp tục.",
    );
  }

  const topicTitle =
    String(
      requestTopic?.topic_title ??
        run.summaryLabel ??
        run.topics[0] ??
        "Resume crawl",
    ).trim() || "Resume crawl";
  const topComments = Math.max(
    0,
    Number(requestMeta?.top_comments_per_post ?? 5) || 5,
  );
  const resumeTargetPosts = Math.max(
    1,
    remainingTargetPosts || seedUrls.length,
  );
  const languages =
    thisSafeStringList(requestMeta?.languages).length > 0
      ? thisSafeStringList(requestMeta?.languages)
      : ["vi"];

  return {
    created_at: nowIso(),
    filters: {
      date_range: {
        end_date: String(requestDateRange?.end_date ?? ""),
        preset: String(requestDateRange?.preset ?? ""),
        start_date: String(requestDateRange?.start_date ?? ""),
      },
      exclude_commerce_content: Boolean(requestMeta?.exclude_commerce_content),
      exclude_posts_with_links: Boolean(requestMeta?.exclude_posts_with_links),
      exclude_usernames: thisSafeStringList(requestMeta?.exclude_usernames),
      global_excluded_keywords: thisSafeStringList(
        requestMeta?.global_excluded_keywords,
      ),
      include_usernames: thisSafeStringList(requestMeta?.include_usernames),
      languages,
      max_posts_per_topic: resumeTargetPosts,
      max_text_length: Math.max(
        0,
        Number(requestMeta?.max_text_length ?? 2000) || 2000,
      ),
      min_comment_likes: Math.max(
        0,
        Number(requestMeta?.min_comment_likes ?? 0) || 0,
      ),
      min_comments: Math.max(0, Number(requestMeta?.min_comments ?? 0) || 0),
      min_loaded_top_comments: Math.max(
        0,
        Number(requestMeta?.min_loaded_top_comments ?? 0) || 0,
      ),
      min_post_likes: Math.max(
        0,
        Number(requestMeta?.min_post_likes ?? 0) || 0,
      ),
      min_post_views: Math.max(
        0,
        Number(requestMeta?.min_post_views ?? 0) || 0,
      ),
      min_post_replies: Math.max(
        0,
        Number(requestMeta?.min_post_replies ?? 0) || 0,
      ),
      min_post_reposts: Math.max(
        0,
        Number(requestMeta?.min_post_reposts ?? 0) || 0,
      ),
      min_post_score: Math.max(
        0,
        Number(requestMeta?.min_post_score ?? 0) || 0,
      ),
      min_post_shares: Math.max(
        0,
        Number(requestMeta?.min_post_shares ?? 0) || 0,
      ),
      min_text_length: Math.max(
        0,
        Number(requestMeta?.min_text_length ?? 0) || 0,
      ),
      min_topic_match_score: Math.max(
        0,
        Number(requestMeta?.min_topic_match_score ?? 0) || 0,
      ),
      ranking_mode: "weighted",
      ranking_weights: normalizeRankingWeights(requestMeta?.ranking_weights),
      recency_half_life_hours: Math.max(
        1,
        Number(requestMeta?.recency_half_life_hours ?? 168) || 168,
      ),
      require_comments: Boolean(requestMeta?.require_comments),
      require_metrics: Boolean(requestMeta?.require_metrics),
      require_repost_or_share: Boolean(requestMeta?.require_repost_or_share),
      sort_by: String(requestMeta?.sort_by ?? "score"),
      source: String(requestMeta?.source ?? "threads"),
      text_contains_all: thisSafeStringList(requestMeta?.text_contains_all),
      text_contains_any: thisSafeStringList(requestMeta?.text_contains_any),
      text_excludes_any: thisSafeStringList(requestMeta?.text_excludes_any),
      top_comments_per_post: topComments,
      topics: [
        {
          category: String(requestTopic?.category ?? "general"),
          excluded_keywords: [],
          keywords: thisSafeStringList(requestTopic?.keywords),
          lexicon: {
            abbreviations: thisSafeStringList(requestLexicon?.abbreviations),
            canonical: thisSafeStringList(requestLexicon?.canonical),
            no_diacritics: thisSafeStringList(requestLexicon?.no_diacritics),
            teencode: thisSafeStringList(requestLexicon?.teencode),
          },
          query_variants: thisSafeStringList(requestTopic?.query_variants),
          required_keywords: thisSafeStringList(
            requestTopic?.required_keywords,
          ),
          required_keywords_mode:
            requestTopic?.required_keywords_mode === "all" ? "all" : "any",
          search_queries: thisSafeStringList(requestTopic?.search_queries),
          seed_post_urls: seedUrls,
          trend_search_urls: thisSafeStringList(requestTopic?.trend_search_urls),
          topic_intent: topicTitle,
          topic_title: topicTitle,
        },
      ],
    },
    notes: `Resume from ${run.id}`,
    request_id: `${slugifyAscii(topicTitle, "threads")}-resume-${localTimestampForId()}`,
    runtime_overrides: {
      ...resumeRuntimeSource,
      includeHomeFeed: canContinueDiscovery
        ? originalIncludeHomeFeed || originalMaxSearchQueries <= 0
        : false,
      maxCandidateLinks: canContinueDiscovery
        ? Math.max(
            seedUrls.length,
            Math.max(
              0,
              Number(resumeRuntimeSource.maxCandidateLinks ?? 0) || 0,
            ),
            resumeTargetPosts * 6,
            resumeTargetPosts + 18,
          )
        : Math.max(resumeTargetPosts, seedUrls.length),
      maxCollectedPostsPerTopic: canContinueDiscovery
        ? Math.max(
            resumeTargetPosts,
            Math.max(
              0,
              Number(resumeRuntimeSource.maxCollectedPostsPerTopic ?? 0) || 0,
            ),
            resumeTargetPosts * 3,
          )
        : Math.max(resumeTargetPosts, seedUrls.length),
      maxSearchQueriesPerTopic: canContinueDiscovery
        ? Math.max(2, originalMaxSearchQueries)
        : 0,
    },
    ui_state: {
      resume_baseline_comments: outputSummary.commentCount,
      resume_baseline_posts: completedPostCountForResume,
      resume_completed_urls: effectiveCompletedUrls,
      resume_requires_viral_signal_floor: resumeRequiresViralSignalFloor,
      resume_total_target_posts: originalTargetPosts,
      resumed_from_run_id: run.id,
      sourceMode: canContinueDiscovery ? "resume_mixed" : "seed_only",
    },
  };
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function localTimestampForId(): string {
  const date = new Date();
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];
  return parts.map((part) => String(part).padStart(2, "0")).join("");
}

function buildFallbackCrawlRequest(): CrawlRequest {
  return {
    created_at: nowIso(),
    filters: {
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
      max_posts_per_topic: 5,
      max_text_length: 2000,
      min_comment_likes: 0,
      min_comments: 0,
      min_loaded_top_comments: 0,
      min_post_likes: 0,
      min_post_views: 0,
      min_post_replies: 0,
      min_post_reposts: 0,
      min_post_score: 0,
      min_post_shares: 0,
      min_text_length: 0,
      min_topic_match_score: 0,
      ranking_mode: "weighted",
      ranking_weights: normalizeRankingWeights({}),
      recency_half_life_hours: 168,
      require_comments: false,
      require_metrics: false,
      require_repost_or_share: false,
      sort_by: "score",
      source: "threads",
      text_contains_all: [],
      text_contains_any: [],
      text_excludes_any: [],
      top_comments_per_post: 5,
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
          required_keywords_mode: "any",
          search_queries: [],
          seed_post_urls: [],
          trend_search_urls: [],
          topic_intent: "Viral feed",
          topic_title: "Viral feed",
        },
      ],
    },
    notes: "Generated fallback crawl request.",
    request_id: `threads-viral-feed-p5-c5-${localTimestampForId()}`,
  };
}

function buildRunSummaryLabel(request: CrawlRequest): string {
  const topic = request.filters.topics[0];
  if (!topic) return "Viral feed";

  const topicTitle = String(topic.topic_title ?? "").trim();
  const normalizedTopic = topicTitle || "Viral feed";
  const queries = dedupeKeywords(
    thisSafeStringList(topic.search_queries).length > 0
      ? thisSafeStringList(topic.search_queries)
      : thisSafeStringList(topic.required_keywords),
  );
  if (queries.length === 0) {
    return normalizedTopic;
  }

  const visibleQueries = queries.slice(0, 3);
  const suffix =
    queries.length > visibleQueries.length
      ? ` +${queries.length - visibleQueries.length}`
      : "";
  return `${normalizedTopic} · ${visibleQueries.join(", ")}${suffix}`;
}

function resolveRunMode(
  request: CrawlRequest | undefined,
  baseUrl: string,
): NonNullable<CrawlRun["mode"]> {
  if (!request) return "discover";
  const uiMode = String(request.ui_state?.sourceMode ?? "");
  if (uiMode === "resume_mixed") return "resume";
  const topics = request.filters.topics;
  const seedUrls = topics.flatMap((topic) =>
    expandSeedTargetUrls(
      thisSafeStringList(topic.seed_post_urls),
      baseUrl,
    ),
  );
  const hasDiscovery = topics.some(
    (topic) =>
      thisSafeStringList(topic.search_queries).length > 0 ||
      thisSafeStringList(topic.query_variants).length > 0 ||
      thisSafeStringList(topic.trend_search_urls).length > 0,
  );
  if (
    seedUrls.length > 0 &&
    !hasDiscovery &&
    seedUrls.every((url) => normalizeThreadsUrl(url, baseUrl).kind === "post")
  ) {
    return "direct_posts";
  }
  if (seedUrls.length > 0 && hasDiscovery) return "hybrid";
  if (seedUrls.length > 0) return "seed_profiles";
  return "discover";
}
function shouldUseHomeFeedOnly(request: CrawlRequest): boolean {
  return request.filters.topics.some((topic) => {
    const hasSearchQueries =
      thisSafeStringList(topic.search_queries).length > 0;
    const hasQueryVariants =
      thisSafeStringList(topic.query_variants).length > 0;
    const hasSeedUrls = thisSafeStringList(topic.seed_post_urls).length > 0;
    const topicTitle = String(topic.topic_title ?? "").trim();
    const topicIntent = String(topic.topic_intent ?? "").trim();
    const hasExplicitTopic =
      !isFeedOnlyPlaceholderTopic(topicTitle) ||
      !isFeedOnlyPlaceholderTopic(topicIntent);

    return (
      !hasSearchQueries &&
      !hasQueryVariants &&
      !hasSeedUrls &&
      !hasExplicitTopic
    );
  });
}

function isStrictBlankViralTopic(topic: {
  keywords?: string[];
  query_variants?: string[];
  required_keywords?: string[];
  search_queries?: string[];
  seed_post_urls?: string[];
  topic_intent?: string;
  topic_title?: string;
}): boolean {
  const hasSignals =
    thisSafeStringList(topic.search_queries).length > 0 ||
    thisSafeStringList(topic.query_variants).length > 0 ||
    thisSafeStringList(topic.required_keywords).length > 0 ||
    thisSafeStringList(topic.keywords).length > 0 ||
    thisSafeStringList(topic.seed_post_urls).length > 0;
  if (hasSignals) return false;
  return (
    isFeedOnlyPlaceholderTopic(String(topic.topic_title ?? "")) &&
    isFeedOnlyPlaceholderTopic(String(topic.topic_intent ?? ""))
  );
}

function isFeedOnlyPlaceholderTopic(value: string): boolean {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return (
    normalized === "" ||
    normalized === "viral" ||
    normalized === "viral feed" ||
    normalized === "trending" ||
    normalized === "hot" ||
    normalized === "top" ||
    normalized === "top threads" ||
    normalized === "xu huong"
  );
}

function dedupeKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function validateCrawlRequestOptions(request: CrawlRequest, baseUrl: string): void {
  const range = request.filters.date_range;
  const preset = String(range.preset || "").trim().toLowerCase();
  if ((preset === "date_range" || preset === "custom") && (!range.start_date || !range.end_date)) {
    throw new Error("Date range requires both a start date and an end date.");
  }
  if (preset === "after_date" && !range.start_date) throw new Error("The after-date filter requires a start date.");
  if (preset === "before_date" && !range.end_date) throw new Error("The before-date filter requires an end date.");
  for (const topic of request.filters.topics) {
    for (const value of expandSeedTargetUrls(topic.seed_post_urls, baseUrl)) {
      const target = normalizeThreadsUrl(value, baseUrl);
      if (target.kind !== "post" && target.kind !== "profile") {
        throw new Error(`Unsupported Threads target URL: ${value}. Use a Threads post, share, or profile URL.`);
      }
    }
    for (const value of topic.trend_search_urls ?? []) {
      if (normalizeThreadsUrl(value, baseUrl).kind !== "search") {
        throw new Error(`Invalid Threads trend URL: ${value}. Use a Threads search URL containing the trend.`);
      }
    }
  }
}

function thisSafeStringList(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeRankingWeights(value: unknown): RankingWeights {
  const source = isRecord(value) ? value : {};
  return {
    comments: numberOrFallback(source.comments, 16),
    likes: numberOrFallback(source.likes, 14),
    recency: numberOrFallback(source.recency, 8),
    reposts: numberOrFallback(source.reposts, 24),
    shares: numberOrFallback(source.shares, 22),
    topic_match: numberOrFallback(source.topic_match, 8),
    views: numberOrFallback(source.views, 8),
  };
}

function numberOrFallback(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
