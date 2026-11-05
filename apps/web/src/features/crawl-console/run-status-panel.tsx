import { LoaderCircle, PlayCircle, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CrawlProgressSnapshot,
  CrawlProgressStage,
  CrawlRun,
} from "@/lib/api";
import {
  canResumeRun,
  formatDateTime,
  formatRunDuration,
} from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

type SavedOutputStats = {
  commentCount: number;
  postCount: number;
};

type QueueSummary = {
  aheadCount: number;
  queuedCount: number;
  runningCount: number;
};

const STAGE_ORDER: CrawlProgressStage[] = [
  "preparing",
  "discovering",
  "extracting_posts",
  "extracting_comments",
  "saving",
  "completed",
];

const DIRECT_POST_STAGE_META: Record<
  CrawlProgressStage,
  {
    label: string;
    description: string;
  }
> = {
  preparing: {
    label: "Chuẩn bị",
    description: "Đang mở trình duyệt và kiểm tra phiên đăng nhập.",
  },
  discovering: {
    label: "Mở link bài viết",
    description: "Đang mở đúng link bài viết đã dán.",
  },
  extracting_posts: {
    label: "Đọc bài viết",
    description: "Đang lấy nội dung, tác giả và media của bài viết.",
  },
  extracting_comments: {
    label: "Lấy bình luận",
    description: "Đang lấy các bình luận nổi bật của bài viết.",
  },
  saving: {
    label: "Lưu kết quả",
    description: "Đang lưu bài viết để bạn xem và làm video.",
  },
  completed: {
    label: "Hoàn tất",
    description: "Đã lấy xong bài viết từ link đã dán.",
  },
};

const STAGE_META: Record<
  CrawlProgressStage,
  {
    label: string;
    description: string;
  }
> = {
  preparing: {
    label: "Chuẩn bị",
    description: "Đang mở trình duyệt và kiểm tra phiên đăng nhập.",
  },
  discovering: {
    label: "Tìm bài",
    description: "Đang tìm bài từ các nguồn đã chọn.",
  },
  extracting_posts: {
    label: "So sánh bài",
    description: "Đang so sánh nội dung và tương tác để chọn các bài tốt nhất.",
  },
  extracting_comments: {
    label: "Hoàn thiện bài tốt nhất",
    description: "Đang lấy bình luận, hình ảnh và kiểm tra lần cuối.",
  },
  saving: {
    label: "Lưu kết quả",
    description: "Ghi dữ liệu hiện có ra file để xem hoặc tiếp tục về sau.",
  },
  completed: {
    label: "Hoàn tất",
    description: "Phiên crawl đã kết thúc và không còn bước nào đang chạy.",
  },
};

export const RunStatusPanel = ({
  activeRun,
  canCancelActiveRun,
  cancelMutation,
  now,
  resumeMutation,
  runs,
  savedOutputStats,
}: {
  activeRun: CrawlRun | undefined;
  canCancelActiveRun: boolean;
  cancelMutation: any;
  now: number;
  resumeMutation: any;
  runs: CrawlRun[];
  savedOutputStats?: SavedOutputStats | null;
}) => {
  if (!activeRun) {
    return (
      <div className="grid gap-2">
        <span className="text-sm font-medium">Tiến trình hiện tại</span>
        <p className="text-xs text-muted-foreground">
          Chưa có tiến trình nào. Khi bắt đầu crawl, màn hình này sẽ cho biết hệ
          thống đang ở bước nào.
        </p>
      </div>
    );
  }

  const displayStage = resolveDisplayStage(activeRun);
  const activeStageIndex = Math.max(0, STAGE_ORDER.indexOf(displayStage));
  const displayStageLabel = resolveStageMeta(activeRun, displayStage).label;
  const isFailed = activeRun.status === "failed";
  const isTerminal = [
    "cancelled",
    "completed",
    "failed",
    "no_results",
    "partial_results",
    "stopped_partial",
  ].includes(activeRun.status);
  const canResumeActiveRun = canResumeRun(activeRun);
  const summaryLabel =
    activeRun.summaryLabel ||
    activeRun.topics[0] ||
    activeRun.requestId ||
    activeRun.id;
  const queueSummary = resolveQueueSummary(activeRun, runs);
  const headline = resolveRunHeadline(
    activeRun,
    canResumeActiveRun,
    queueSummary,
    savedOutputStats,
  );
  const metrics = buildMetrics(activeRun, queueSummary, savedOutputStats);
  const stopOutcome = resolveStopOutcome(
    activeRun,
    canResumeActiveRun,
    savedOutputStats,
  );

  const stageCounter = resolveStageCounter(
    activeRun.progress,
    activeRun,
    savedOutputStats,
  );
  const progressPercent = resolveProgressPercent(
    activeRun.progress,
    displayStage,
    activeStageIndex,
  );

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Tiến trình crawl</span>
        <StatusBadge run={activeRun} />
      </div>

      <div className="grid gap-3.5 rounded-xl border bg-muted/20 p-3 shadow-sm">
        <div className="grid gap-1">
          <p className="truncate text-lg font-semibold tracking-tight text-foreground">
            {summaryLabel}
          </p>
        </div>

        <div className="grid gap-2.5 rounded-lg border bg-background/80 p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">
              {isFailed
                ? "Chưa đủ kết quả"
                : `Bước ${activeStageIndex + 1}/${STAGE_ORDER.length}: ${displayStageLabel}`}
            </p>
            {stageCounter ? (
              <span className="text-[11px] font-medium text-muted-foreground">
                {stageCounter}
              </span>
            ) : null}
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/15">
            <div
              className={cn(
                "h-full rounded-full bg-slate-900 transition-all duration-500 dark:bg-slate-100",
                isFailed && "bg-destructive dark:bg-destructive",
                ["queued", "running", "stopping"].includes(activeRun.status) &&
                  "animate-pulse",
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {humanizeProgressMessage(
              resolveCurrentStageDescription(activeRun, displayStage, queueSummary) ||
                headline,
            )}
          </p>
        </div>

        <div className="rounded-lg border bg-background/80 p-3 shadow-2xs">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {isTerminal ? "Kết quả đã giữ" : "Nếu dừng lúc này"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">
            {stopOutcome}
          </p>
        </div>

        {metrics.length > 0 ? (
          <div className="grid gap-1.5 rounded-lg border bg-background/80 p-3 text-xs leading-relaxed text-muted-foreground shadow-2xs">
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
              Kết quả hiện tại
            </p>
            {metrics.map((metricLine, idx) => (
              <p key={idx}>{metricLine}</p>
            ))}
          </div>
        ) : null}

        <p
          className="px-1 text-[10px] text-muted-foreground/70"
          title={`Mã phiên: ${activeRun.id}`}
        >
          Bắt đầu {formatDateTime(activeRun.startedAt)}
          {" · "}
          {formatRunDuration(activeRun, now)}
          {activeRun.finishedAt
            ? ` · Kết thúc ${formatDateTime(activeRun.finishedAt)}`
            : ""}
        </p>

        <div className="grid gap-2 border-t border-muted/30 pt-2.5">
          {canCancelActiveRun ? (
            <Button
              className="mt-1 border border-red-200 bg-red-50 font-semibold text-red-600 shadow-none hover:bg-red-100 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/40"
              disabled={cancelMutation.isPending || resumeMutation.isPending}
              onClick={() => cancelMutation.mutate(activeRun.id)}
              size="sm"
              type="button"
            >
              {cancelMutation.isPending ? (
                <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <StopCircle className="mr-1.5 size-3.5" />
              )}
              {resolveStopButtonLabel(activeRun)}
            </Button>
          ) : null}

          {canResumeActiveRun ? (
            <Button
              className="font-medium shadow-xs transition-transform active:scale-[0.98]"
              disabled={resumeMutation.isPending || cancelMutation.isPending}
              onClick={() => resumeMutation.mutate(activeRun.id)}
              size="sm"
              type="button"
            >
              {resumeMutation.isPending ? (
                <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <PlayCircle className="mr-1.5 size-3.5" />
              )}
              Tiếp tục từ kết quả tạm
            </Button>
          ) : null}
        </div>

        {activeRun.status === "stopped_partial" && !canResumeActiveRun ? (
          <div className="rounded-lg border border-border bg-background/80 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {activeRun.resumedToRunId
              ? "Phiên này đã được dừng để tạo một phiên tiếp tục mới."
              : "Phiên đã dừng trước khi kịp lưu đủ kết quả tạm để tiếp tục."}
          </div>
        ) : null}

        {activeRun.resumedFromRunId ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">
            Phiên này được tiếp tục từ run {activeRun.resumedFromRunId}.
          </div>
        ) : null}

        {activeRun.error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
            <p className="font-semibold">Lỗi</p>
            <p className="whitespace-pre-wrap">{activeRun.error}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

function isDirectPostRun(run: CrawlRun): boolean {
  return run.mode === "direct_posts";
}

function resolveStageMeta(
  run: CrawlRun,
  stage: CrawlProgressStage,
): { label: string; description: string } {
  return isDirectPostRun(run) ? DIRECT_POST_STAGE_META[stage] : STAGE_META[stage];
}

function resolveDisplayStage(run: CrawlRun): CrawlProgressStage {
  if (run.status === "stopped_partial") {
    if (run.progress?.stage && run.progress.stage !== "completed") {
      return run.progress.stage;
    }
    return "saving";
  }

  if (
    run.status === "completed" ||
    run.status === "partial_results" ||
    run.status === "no_results" ||
    run.status === "cancelled" ||
    run.status === "failed"
  ) {
    return "completed";
  }

  if (run.progress?.stage) {
    return run.progress.stage;
  }

  if (run.status === "queued") {
    return "preparing";
  }

  return "discovering";
}

function resolveRunHeadline(
  run: CrawlRun,
  canResumeActiveRun: boolean,
  queueSummary: QueueSummary,
  savedOutputStats?: SavedOutputStats | null,
): string {
  const committedPosts = resolveCommittedPostCount(
    run.progress,
    run.status,
    savedOutputStats,
  );

  if (run.status === "queued") {
    return queueSummary.aheadCount > 0
      ? `Đang chờ sau ${queueSummary.aheadCount} phiên khác.`
      : "Đang chờ đến lượt xử lý.";
  }

  if (run.status === "stopped_partial") {
    if (committedPosts > 0) {
      return "Đã dừng sớm và giữ lại các bài đã chốt.";
    }
    return canResumeActiveRun
      ? "Đã dừng sớm và bạn có thể tiếp tục từ điểm dang dở."
      : "Đã dừng sớm trước khi chốt được bài nào.";
  }

  if (run.status === "completed" || run.status === "partial_results") {
    return committedPosts > 0
      ? `Đã hoàn tất ${committedPosts} bài.`
      : "Phiên crawl đã hoàn tất.";
  }

  if (run.status === "no_results") {
    return "Đã quét xong nhưng không tìm thấy bài viết phù hợp.";
  }

  if (run.status === "failed") {
    return run.error || "Phiên crawl đã dừng do gặp lỗi.";
  }

  return run.progress?.message || resolveStageMeta(run, resolveDisplayStage(run)).description;
}

function resolveCurrentStageDescription(
  run: CrawlRun,
  stage: CrawlProgressStage,
  queueSummary: QueueSummary,
): string {
  if (run.status === "failed") {
    return "Phiên đã dừng vì chưa tìm đủ số bài đạt tiêu chuẩn.";
  }
  if (run.status === "queued") {
    return queueSummary.aheadCount > 0
      ? `Phiên này đang xếp sau ${queueSummary.aheadCount} phiên khác và sẽ tự chạy khi đến lượt. Crawl không chạy song song.`
      : "Phiên này đang chờ đến lượt và sẽ tự chạy. Crawl không chạy song song.";
  }
  if (
    ["queued", "running", "stopping"].includes(run.status) &&
    ["saving", "completed"].includes(stage) &&
    hasReachedProgressTarget(run.progress, { preferReadyCounts: true })
  ) {
    return "Đã đủ số bài cần lấy. Hệ thống chỉ còn lưu kết quả.";
  }
  if (run.status === "stopped_partial") {
    const committedPosts = resolveCommittedPostCount(run.progress, run.status);
    const pendingPosts = Number(run.progress?.pending_posts ?? 0);
    if (committedPosts > 0) {
      return "Kết quả đã chốt đã được lưu. Bạn có thể xem ngay hoặc tiếp tục để lấy thêm.";
    }
    if (pendingPosts > 0) {
      return "Hệ thống đã lưu danh sách bài dang dở để có thể xử lý tiếp.";
    }
  }
  if (run.status === "partial_results") {
    return isDirectPostRun(run)
      ? "Đã lấy và lưu được bài viết từ link đã dán."
      : "Phiên crawl đã kết thúc và lưu các bài đạt chuẩn.";
  }
  if (isDirectPostRun(run)) {
    if (stage === "discovering") {
      return "Đang mở đúng link bài viết đã dán.";
    }
    if (stage === "extracting_posts") {
      return "Đang lấy nội dung, tác giả, ảnh và video của bài viết.";
    }
    if (stage === "extracting_comments") {
      const target = Math.max(0, Number(run.progress?.comment_target ?? 0));
      const scanned = Math.max(0, Number(run.progress?.comments_scanned ?? 0));
      return target > 0
        ? `Đang lấy bình luận nổi bật: đã thấy ${Math.min(scanned, target)}/${target}.`
        : "Đang lấy các bình luận nổi bật của bài viết.";
    }
    if (stage === "saving") {
      return "Đã lấy xong bài viết, đang lưu kết quả để xem và làm video.";
    }
  }
  return run.progress?.message || resolveStageMeta(run, stage).description;
}



function resolveStageCounter(
  progress: CrawlProgressSnapshot | undefined,
  run: CrawlRun,
  savedOutputStats?: SavedOutputStats | null,
): string {
  if (!progress) {
    return "";
  }

  const stage = resolveDisplayStage(run);

  if (isDirectPostRun(run)) {
    const targetPosts = Math.max(1, resolveTargetPostCount(progress));
    const completedPosts = Math.max(
      0,
      Number(progress.detail_completed ?? progress.ready_output_posts ?? 0),
    );
    if (stage === "discovering" || stage === "extracting_posts") {
      return `${Math.min(completedPosts, targetPosts)}/${targetPosts} link đã xử lý`;
    }
    if (stage === "extracting_comments") {
      const targetComments = Math.max(0, Number(progress.comment_target ?? 0));
      const scannedComments = Math.max(0, Number(progress.comments_scanned ?? 0));
      return targetComments > 0
        ? `${Math.min(scannedComments, targetComments)}/${targetComments} bình luận đã thấy`
        : "Đang lấy bình luận";
    }
    if (stage === "saving") {
      return `${Math.min(resolveStoppablePostCount(run, savedOutputStats), targetPosts)}/${targetPosts} bài đã lấy`;
    }
    return "";
  }

  if (stage === "discovering") {
    const candidateCount = Number(progress.candidate_count ?? 0);
    if (candidateCount > 0) {
      return `${candidateCount} bài đã thấy`;
    }
  }

  if (stage === "extracting_posts" && (progress.summary_target || progress.detail_target)) {
    const target = Number(progress.summary_target ?? progress.detail_target ?? 0);
    const completed = Number(progress.summary_completed ?? progress.detail_completed ?? 0);
    return `${completed}/${target} bài đã so sánh`;
  }

  if (stage === "extracting_comments" && progress.finalist_target) {
    return `${progress.finalist_completed ?? 0}/${progress.finalist_target} ứng viên cuối đang kiểm tra`;
  }

  if (stage === "extracting_comments" && progress.comment_target) {
    return `${progress.comments_selected ?? resolveStoppableCommentCount(run, savedOutputStats)}/${progress.comment_target} bình luận giữ lại`;
  }

  if (stage === "saving") {
    const committedPosts = resolveStoppablePostCount(run, savedOutputStats);
    const targetPosts = resolveTargetPostCount(progress);
    const pendingPosts = Number(progress.pending_posts ?? 0);
    if (committedPosts > 0 && targetPosts > 0) {
      return `${committedPosts}/${targetPosts} bài đã chốt`;
    }
    if (pendingPosts > 0) {
      return `${pendingPosts} bài có thể tiếp tục`;
    }
  }

  return "";
}

function resolveProgressPercent(
  progress: CrawlProgressSnapshot | undefined,
  stage: CrawlProgressStage,
  stageIndex: number,
): number {
  if (stage === "completed") return 100;
  let fraction = 0.25;
  if (stage === "extracting_posts") {
    fraction = safeRatio(
      Number(progress?.summary_completed ?? progress?.detail_completed ?? 0),
      Number(progress?.summary_target ?? progress?.detail_target ?? 0),
    );
  } else if (stage === "extracting_comments") {
    fraction = safeRatio(
      Number(progress?.finalist_completed ?? 0),
      Number(progress?.finalist_target ?? 0),
    );
  } else if (stage === "saving") {
    fraction = 0.65;
  }
  return Math.max(
    3,
    Math.min(99, Math.round(((stageIndex + fraction) / (STAGE_ORDER.length - 1)) * 100)),
  );
}

function safeRatio(completed: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0.25;
  return Math.max(0, Math.min(1, completed / target));
}

function humanizeProgressMessage(message: string): string {
  return message
    .replace(
      /Đang mở shortlist để so sánh text và metric viral/gi,
      "Đang kiểm tra nội dung và mức tương tác của các bài tiềm năng",
    )
    .replace(
      /Đang so sánh metric viral của/gi,
      "Đang kiểm tra mức tương tác của bài",
    )
    .replace(
      /Dang lay comment va media cua finalist/gi,
      "Đang lấy bình luận và hình ảnh của bài nổi bật",
    )
    .replace(
      /Dang lay comment cho (\d+) ung vien dan dau/gi,
      "Đang lấy bình luận cho $1 bài nổi bật nhất",
    )
    .replace(
      /Dang chot ket qua tu finalist da co san/gi,
      "Đang chọn kết quả từ các bài đã kiểm tra kỹ",
    )
    .replace(
      /Da du target(?:, dung enrich sau)? va chot ket qua(?: cuoi)?/gi,
      "Đã đủ số bài cần lấy, đang lưu kết quả",
    )
    .replace(
      /Da du target va dang chot ket qua cuoi/gi,
      "Đã đủ số bài cần lấy, đang lưu kết quả",
    )
    .replace(
      /Da duyet het finalist co the xu ly/gi,
      "Đã kiểm tra xong các bài nổi bật",
    )
    .replace(/\bshortlist\b/gi, "danh sách bài tiềm năng")
    .replace(/\bfinalists?\b/gi, "bài nổi bật")
    .replace(/\bmetric(?: viral)?\b/gi, "mức tương tác")
    .replace(/\benrich(?: sâu)?\b/gi, "kiểm tra kỹ")
    .replace(/\btarget\b/gi, "mục tiêu")
    .replace(/\bpreview\b/gi, "xem trước")
    .replace(/\bmedia\b/gi, "hình ảnh")
    .replace(/\bcomment\b/gi, "bình luận");
}

function buildMetrics(
  run: CrawlRun,
  queueSummary: QueueSummary,
  savedOutputStats?: SavedOutputStats | null,
): string[] {
  const progress = run.progress;
  const rows: string[] = [];
  if (!progress) return rows;

  const candidateCount = Number(
    progress.candidate_count ?? progress.discovered_posts ?? 0,
  );
  const targetPosts = resolveTargetPostCount(progress);
  const readyPosts = resolveStoppablePostCount(run, savedOutputStats);
  const readyComments = resolveStoppableCommentCount(run, savedOutputStats);
  const commentTarget = Number(progress.comment_target ?? 0);
  const summaryCompleted = Number(
    progress.summary_completed ?? progress.detail_completed ?? 0,
  );
  const summaryTarget = Number(
    progress.summary_target ?? progress.detail_target ?? 0,
  );
  const finalistCompleted = Number(progress.finalist_completed ?? 0);
  const finalistTarget = Number(progress.finalist_target ?? 0);
  const pendingPosts = Number(progress.pending_posts ?? 0);

  if (run.status === "queued") {
    rows.push(
      queueSummary.aheadCount > 0
        ? `Đang xếp sau ${queueSummary.aheadCount} phiên khác.`
        : "Đang chờ đến lượt xử lý.",
    );
  } else if (
    ["running", "stopping"].includes(run.status) &&
    queueSummary.queuedCount > 0
  ) {
    rows.push(`Có ${queueSummary.queuedCount} phiên đang chờ sau phiên này.`);
  }

  if (isDirectPostRun(run)) {
    const processedPosts = Math.max(
      readyPosts,
      Number(progress.detail_completed ?? progress.ready_output_posts ?? 0),
    );
    rows.push(
      `Link bài viết: ${Math.min(processedPosts, Math.max(1, targetPosts))}/${Math.max(1, targetPosts)} đã xử lý.`,
    );
    if (commentTarget > 0) {
      const scannedComments = Math.max(0, Number(progress.comments_scanned ?? 0));
      rows.push(
        `Bình luận: đã thấy ${Math.min(scannedComments, commentTarget)}/${commentTarget}.`,
      );
    }
    rows.push(
      `Sẵn sàng sử dụng: ${readyPosts}/${Math.max(1, targetPosts)} bài${commentTarget > 0 ? ` · ${readyComments}/${commentTarget} bình luận` : ""}.`,
    );
    return rows;
  }

  if (candidateCount > 0) rows.push(`Đã tìm: ${candidateCount} bài.`);

  if (finalistTarget > 0) {
    rows.push(`Đã kiểm tra: ${finalistCompleted}/${finalistTarget} ứng viên cuối.`);
  } else if (summaryTarget > 0) {
    rows.push(`Đang so sánh: ${summaryCompleted}/${summaryTarget} bài tiềm năng.`);
  }

  if (targetPosts > 0) {
    const commentResult =
      commentTarget > 0 ? ` · ${readyComments}/${commentTarget} bình luận` : "";
    rows.push(`Sẵn sàng sử dụng: ${readyPosts}/${targetPosts} bài${commentResult}.`);
  }

  if (
    pendingPosts > 0 &&
    canResumeRun(run) &&
    !["running", "stopping"].includes(run.status)
  ) {
    rows.push(`Có thể tiếp tục xử lý thêm ${pendingPosts} bài.`);
  }

  if (rows.length === 0 && run.topics.length > 0) {
    rows.push(`Chủ đề: ${run.topics.join(", ")}`);
  }

  return rows;
}

function resolveStopOutcome(
  run: CrawlRun,
  canResumeActiveRun: boolean,
  savedOutputStats?: SavedOutputStats | null,
): string {
  const committedPosts = resolveStoppablePostCount(run, savedOutputStats);
  const committedComments = resolveStoppableCommentCount(run, savedOutputStats);
  const pendingPosts = Number(run.progress?.pending_posts ?? 0);
  const isActiveRun = ["queued", "running", "stopping"].includes(run.status);
  const displayStage = resolveDisplayStage(run);
  const targetPosts = resolveTargetPostCount(run.progress);
  const targetReached = hasReachedProgressTarget(run.progress, {
    preferReadyCounts: isActiveRun,
  });
  const selectedPosts = Math.max(
    0,
    Number(run.progress?.selected_posts ?? run.progress?.detail_target ?? 0),
  );
  const detailCompleted = Math.max(
    0,
    Number(run.progress?.detail_completed ?? 0),
  );
  const finalSelectionPending =
    !isDirectPostRun(run) &&
    isActiveRun &&
    ["extracting_posts", "extracting_comments"].includes(displayStage) &&
    targetPosts > 0 &&
    selectedPosts > targetPosts &&
    detailCompleted < selectedPosts;

  if (
    targetReached &&
    targetPosts > 0 &&
    (!isActiveRun || ["saving", "completed"].includes(displayStage))
  ) {
    return isActiveRun
      ? `Đã đủ ${committedPosts}/${targetPosts} bài và ${committedComments} bình luận. Hệ thống chỉ còn đang lưu file.`
      : `Đã đủ ${committedPosts}/${targetPosts} bài và ${committedComments} bình luận.`;
  }

  if (finalSelectionPending && committedPosts > 0) {
    return `Đang giữ tạm ${committedPosts} bài có thể dùng. Nếu dừng lúc này, đây chưa phải kết quả cuối vì hệ thống mới kiểm tra ${detailCompleted}/${selectedPosts} bài tiềm năng.`;
  }

  if (committedPosts > 0) {
    return isActiveRun
      ? `Sẽ hiển thị ${committedPosts} bài đã chốt và ${committedComments} bình luận đã lấy được.`
      : `Đã giữ ${committedPosts} bài đạt chuẩn và ${committedComments} bình luận đã lấy được.`;
  }

  if (pendingPosts > 0 || canResumeActiveRun) {
    return isActiveRun
      ? "Chưa có bài nào sẵn sàng để xem. Hệ thống sẽ lưu tiến độ để bạn có thể tiếp tục sau."
      : "Chưa có bài nào sẵn sàng để xem. Hệ thống đã lưu tiến độ để bạn có thể tiếp tục sau.";
  }

  return isActiveRun
    ? "Sẽ dừng trước khi giữ được dữ liệu hữu ích."
    : "Đã dừng trước khi giữ được dữ liệu hữu ích.";
}

function resolveStopButtonLabel(run: CrawlRun): string {
  const committedPosts = resolveStoppablePostCount(run);
  const pendingPosts = Number(run.progress?.pending_posts ?? 0);
  const selectedPosts = Math.max(
    0,
    Number(run.progress?.selected_posts ?? run.progress?.detail_target ?? 0),
  );
  const detailCompleted = Math.max(
    0,
    Number(run.progress?.detail_completed ?? 0),
  );
  const targetPosts = resolveTargetPostCount(run.progress);
  const finalSelectionPending =
    !isDirectPostRun(run) &&
    ["queued", "running", "stopping"].includes(run.status) &&
    ["extracting_posts", "extracting_comments"].includes(resolveDisplayStage(run)) &&
    targetPosts > 0 &&
    selectedPosts > targetPosts &&
    detailCompleted < selectedPosts;
  if (finalSelectionPending && committedPosts > 0) {
    return "Dừng và giữ kết quả tạm";
  }
  if (committedPosts > 0) {
    return "Dừng và giữ bài đã chốt";
  }
  if (pendingPosts > 0) {
    return "Dừng và lưu để tiếp tục";
  }
  return "Dừng crawl";
}

function resolveQueueSummary(run: CrawlRun, runs: CrawlRun[]): QueueSummary {
  const orderedRuns = runs
    .filter((candidate) =>
      ["queued", "running", "stopping"].includes(candidate.status),
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.queuedAt);
      const rightTime = Date.parse(right.queuedAt);
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.id.localeCompare(right.id);
    });
  const aheadCount = Math.max(
    0,
    orderedRuns.findIndex((candidate) => candidate.id === run.id),
  );

  return {
    aheadCount,
    queuedCount: orderedRuns.filter((candidate) => candidate.status === "queued")
      .length,
    runningCount: orderedRuns.filter((candidate) =>
      ["running", "stopping"].includes(candidate.status),
    ).length,
  };
}

function resolveCommittedPostCount(
  progress: CrawlProgressSnapshot | undefined,
  status: CrawlRun["status"],
  savedOutputStats?: SavedOutputStats | null,
): number {
  if (
    savedOutputStats &&
    ["completed", "partial_results", "stopped_partial", "no_results", "cancelled", "failed"].includes(
      status,
    )
  ) {
    const savedPosts = Math.max(0, Number(savedOutputStats.postCount ?? 0));
    const targetPosts = resolveTargetPostCount(progress);
    return targetPosts > 0 ? Math.min(savedPosts, targetPosts) : savedPosts;
  }

  const committedPosts = Math.max(
    0,
    Number(progress?.committed_posts ?? progress?.summary_posts ?? 0),
  );
  const targetPosts = resolveTargetPostCount(progress);

  if (status === "running" || status === "stopping" || status === "queued") {
    const runningCommitted = Math.max(
      0,
      Number(progress?.committed_posts ?? 0),
    );
    return targetPosts > 0
      ? Math.min(runningCommitted, targetPosts)
      : runningCommitted;
  }

  return targetPosts > 0 ? Math.min(committedPosts, targetPosts) : committedPosts;
}

function resolveCommittedCommentCount(
  progress: CrawlProgressSnapshot | undefined,
  savedOutputStats?: SavedOutputStats | null,
): number {
  if (savedOutputStats) {
    const savedComments = Math.max(0, Number(savedOutputStats.commentCount ?? 0));
    const targetComments = Math.max(0, Number(progress?.comment_target ?? 0));
    return targetComments > 0
      ? Math.min(savedComments, targetComments)
      : savedComments;
  }

  const committedComments = Math.max(
    0,
    Number(progress?.committed_comments ?? progress?.comment_completed ?? 0),
  );
  const targetComments = Math.max(0, Number(progress?.comment_target ?? 0));
  return targetComments > 0
    ? Math.min(committedComments, targetComments)
    : committedComments;
}

function resolveStoppablePostCount(
  run: CrawlRun,
  savedOutputStats?: SavedOutputStats | null,
): number {
  if (["queued", "running", "stopping"].includes(run.status)) {
    const readyPosts = Math.max(
      0,
      Number(run.progress?.ready_output_posts ?? 0),
    );
    const targetPosts = resolveTargetPostCount(run.progress);
    return targetPosts > 0 ? Math.min(readyPosts, targetPosts) : readyPosts;
  }

  return resolveCommittedPostCount(run.progress, run.status, savedOutputStats);
}

function resolveStoppableCommentCount(
  run: CrawlRun,
  savedOutputStats?: SavedOutputStats | null,
): number {
  if (["queued", "running", "stopping"].includes(run.status)) {
    const readyComments = Math.max(
      0,
      Number(run.progress?.ready_output_comments ?? 0),
    );
    const targetComments = Math.max(0, Number(run.progress?.comment_target ?? 0));
    return targetComments > 0
      ? Math.min(readyComments, targetComments)
      : readyComments;
  }

  return resolveCommittedCommentCount(run.progress, savedOutputStats);
}

function resolveTargetPostCount(
  progress: CrawlProgressSnapshot | undefined,
): number {
  return Math.max(0, Number(progress?.target_output_posts ?? 0));
}

function hasReachedProgressTarget(
  progress: CrawlProgressSnapshot | undefined,
  options: {
    preferReadyCounts?: boolean;
  } = {},
): boolean {
  const targetPosts = Math.max(0, Number(progress?.target_output_posts ?? 0));
  if (targetPosts <= 0) {
    return false;
  }

  const committedPosts = Math.max(
    0,
    Number(
      options.preferReadyCounts
        ? progress?.ready_output_posts
        : progress?.committed_posts ?? progress?.summary_posts ?? 0,
    ),
  );
  if (committedPosts < targetPosts) {
    return false;
  }

  const targetComments = Math.max(0, Number(progress?.comment_target ?? 0));
  if (targetComments <= 0) {
    return true;
  }

  const committedComments = Math.max(
    0,
    Number(
      options.preferReadyCounts
        ? progress?.ready_output_comments
        : progress?.committed_comments ?? progress?.comment_completed ?? 0,
    ),
  );
  return committedComments >= targetComments;
}
