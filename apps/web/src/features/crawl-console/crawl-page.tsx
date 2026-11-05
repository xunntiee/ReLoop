import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSearch, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppReadinessPanel, useAppReadiness } from "@/features/app-shell/app-readiness";
import { PostCard } from "@/features/output-preview/post-card";
import {
  cancelCrawlRun,
  deleteCrawlOutputFile,
  getCrawlOutput,
  getCrawlOutputFile,
  getCrawlOutputs,
  getCrawlRuns,
  resumeCrawlRun,
  startCrawlRun,
  type CrawlOutputResponse,
  type CrawlRun,
  type CrawlOutputFile,
  type CrawlRunsResponse,
  type ThreadsSession,
} from "@/lib/api";
import {
  canCancelRun,
  formatOutputDisplayLabel,
  isActiveRun,
} from "@/lib/formatters";
import { CrawlForm } from "./crawl-form";
import { DeleteOutputDialog } from "./delete-output-dialog";
import { defaultForm, type CrawlFormState } from "./form-state";
import { OutputFilesPanel } from "./output-files-panel";
import { buildStartPayload, invalidSeedTargets, restoreFormFromRequestMeta } from "./payload";
import { RecentRuns } from "./recent-runs";
import { RequestMetaPanel } from "./request-meta-panel";
import { RunStatusPanel } from "./run-status-panel";

const OUTPUT_PREVIEW_STALE_TIME_MS = 5 * 60_000;

const outputFileQueryKey = (
  filename: string | null,
  modifiedAt?: string,
) => ["crawl-output-file", filename, modifiedAt ?? ""] as const;

export const CrawlPage = () => {
  const [form, setForm] = useState<CrawlFormState>(defaultForm);
  const [now, setNow] = useState(() => Date.now());
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedOutputFile, setSelectedOutputFile] = useState<string | null>(null);
  const [pendingDeleteFilenames, setPendingDeleteFilenames] = useState<string[]>([]);
  const [selectedDeleteFilenames, setSelectedDeleteFilenames] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const prevActiveRunStatusRef = useRef<string | undefined>(undefined);
  const startLockRef = useRef(false);
  const completedOutputSyncRef = useRef<{
    attempts: number;
    filename: string;
    runId: string;
    timer: number | null;
  } | null>(null);

  const queryClient = useQueryClient();
  const readiness = useAppReadiness();

  const runsQuery = useQuery({
    queryFn: getCrawlRuns,
    queryKey: ["crawl-runs"],
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.status === "running" || run.status === "stopping") ? 2500 : false,
  });

  const outputFilesQuery = useQuery({
    // The list only needs summaries. Request metadata is fetched lazily when
    // a file is selected, so opening Crawl does not download every form
    // snapshot stored in the output directory.
    queryFn: () => getCrawlOutputs({ includeRequestMeta: false }),
    queryKey: ["crawl-outputs", "summary"],
    refetchInterval: () =>
      runsQuery.data?.runs.some((run) => run.status === "running" || run.status === "stopping") ? 5000 : false,
  });

  const startMutation = useMutation({
    mutationFn: startCrawlRun,
    onMutate: () => {
      startLockRef.current = true;
    },
    onSuccess: ({ run }) => {
      setSelectedOutputFile(null);
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ["crawl-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["crawl-outputs"] });
    },
    onError: () => {
      startLockRef.current = false;
    },
    onSettled: () => {
      startLockRef.current = false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (runId: string) => cancelCrawlRun(runId),
    onMutate: async (runId) => {
      await queryClient.cancelQueries({ queryKey: ["crawl-runs"] });
      const previousRuns = queryClient.getQueryData<CrawlRunsResponse>(["crawl-runs"]);
      const nextRuns = (previousRuns?.runs ?? []).map((run) =>
        run.id === runId
          ? {
              ...run,
              cancelRequestedAt: new Date().toISOString(),
              status: (run.status === "queued" ? "cancelled" : "stopping") as CrawlRun["status"],
            }
          : run,
      );

      queryClient.setQueryData<CrawlRunsResponse>(["crawl-runs"], { runs: nextRuns });

      return { previousRuns };
    },
    onError: (_error, _runId, context) => {
      if (context?.previousRuns) {
        queryClient.setQueryData(["crawl-runs"], context.previousRuns);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["crawl-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["crawl-outputs"] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (runId: string) => resumeCrawlRun(runId),
    onSuccess: ({ run }, resumedFromRunId) => {
      const resumedFromRun = runs.find(
        (candidate) => candidate.id === resumedFromRunId,
      );
      setSelectedOutputFile(
        resumedFromRun?.outputPath
          ? filenameFromOutputPath(resumedFromRun.outputPath)
          : null,
      );
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ["crawl-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["crawl-outputs"] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["crawl-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["crawl-outputs"] });
    },
  });

  const deleteOutputFileMutation = useMutation({
    mutationFn: (filenames: string[]) =>
      Promise.all(filenames.map((filename) => deleteCrawlOutputFile(filename))),
    onSuccess: (_result, filenames) => {
      setDeleteError("");
      if (selectedOutputFile && filenames.includes(selectedOutputFile)) {
        setSelectedOutputFile(null);
      }
      setPendingDeleteFilenames([]);
      setSelectedDeleteFilenames((current) =>
        current.filter((filename) => !filenames.includes(filename))
      );
      for (const filename of filenames) {
        queryClient.removeQueries({ queryKey: ["crawl-output-file", filename] });
      }
      void queryClient.invalidateQueries({ queryKey: ["crawl-outputs"] });
      void queryClient.invalidateQueries({ queryKey: ["crawl-runs"] });
    },
    onError: (error) => {
      setDeleteError(error instanceof Error ? error.message : "Không thể xóa file đầu ra.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["crawl-outputs"] });
      void queryClient.invalidateQueries({ queryKey: ["crawl-runs"] });
    },
  });

  const runs = runsQuery.data?.runs ?? [];
  const activeRun =
    runs.find((run) => run.id === selectedRunId) ??
    runs.find((run) => isActiveRun(run));
  const isRunning = runs.some((run) =>
    ["queued", "running", "stopping"].includes(run.status),
  );
  const queuedAheadCount = runs.filter((run) =>
    ["queued", "running", "stopping"].includes(run.status),
  ).length;
  const canCancelActiveRun = activeRun ? canCancelRun(activeRun) : false;

  const outputFiles = outputFilesQuery.data?.outputs ?? [];
  const availableOutputFilenames = useMemo(
    () => new Set(outputFiles.map((file) => file.filename)),
    [outputFiles]
  );
  const selectedDeleteFilenameSet = useMemo(
    () => new Set(selectedDeleteFilenames),
    [selectedDeleteFilenames]
  );
  const deletingFilenameSet = useMemo(
    () => new Set(deleteOutputFileMutation.variables ?? []),
    [deleteOutputFileMutation.variables]
  );
  const selectedOutputSummary =
    outputFiles.find((file) => file.filename === selectedOutputFile) ?? null;
  const pendingDeleteFiles = useMemo<CrawlOutputFile[]>(
    () =>
      pendingDeleteFilenames
        .map((filename) => outputFiles.find((file) => file.filename === filename))
        .filter((file): file is CrawlOutputFile => Boolean(file)),
    [outputFiles, pendingDeleteFilenames]
  );
  const session = readiness.session;
  const isSessionReady = session?.status === "ready";

  const outputQuery = useQuery({
    enabled:
      !selectedOutputFile &&
      Boolean(activeRun?.outputPath) &&
      (activeRun?.status === "completed" ||
        activeRun?.status === "partial_results" ||
        activeRun?.status === "stopped_partial" ||
        activeRun?.status === "no_results"),
    queryFn: () => getCrawlOutput(activeRun?.id ?? ""),
    queryKey: ["crawl-output", activeRun?.id],
  });

  const fileOutputQuery = useQuery({
    enabled: Boolean(selectedOutputFile),
    gcTime: 30 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: () => getCrawlOutputFile(selectedOutputFile ?? ""),
    queryKey: outputFileQueryKey(
      selectedOutputFile,
      selectedOutputSummary?.modifiedAt,
    ),
    staleTime: OUTPUT_PREVIEW_STALE_TIME_MS,
  });

  const previewQuery = selectedOutputFile ? fileOutputQuery : outputQuery;
  const previewData = previewQuery.data;
  const topics = previewData?.output ?? [];
  const posts = topics.flatMap((topic) => topic.posts);
  const savedOutputStats = previewData
    ? {
        commentCount: posts.reduce(
          (total, post) =>
            total + (Array.isArray(post.top_comments) ? post.top_comments.length : 0),
          0,
        ),
        postCount: posts.length,
      }
    : null;
  const checkpointPreview = resolveCheckpointPreview(previewData, activeRun);
  const previewErrorMessage = previewQuery.isError
    ? previewQuery.error instanceof Error
      ? previewQuery.error.message
      : "Không tải được dữ liệu xem trước."
    : "";
  const previewRequestMeta =
    previewData?.requestMeta ??
    topics.find((topic) => topic.request_meta)?.request_meta;

  const formBlockedReason = resolveFormStartBlockReason(form);
  const startBlockedReason =
    resolveSessionStartBlockReason(session) || formBlockedReason;
  const canStart = isSessionReady && !startMutation.isPending && !startLockRef.current && !formBlockedReason;

  useEffect(() => {
    if (!runs.some((run) => isActiveRun(run))) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runs]);

  useEffect(() => {
    if (!selectedRunId) {
      if (runs[0]?.id) {
        setSelectedRunId(runs[0].id);
      }
      return;
    }
    if (runs.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(runs[0]?.id ?? "");
  }, [runs, selectedRunId]);

  useEffect(() => {
    const prevStatus = prevActiveRunStatusRef.current;
    prevActiveRunStatusRef.current = activeRun?.status;
    if (
      prevStatus === "running" &&
      (activeRun?.status === "completed" ||
        activeRun?.status === "partial_results" ||
        activeRun?.status === "stopped_partial" ||
        activeRun?.status === "no_results")
    ) {
      setSelectedOutputFile(null);
      void queryClient.invalidateQueries({ queryKey: ["crawl-outputs"] });
    }
  }, [activeRun?.status, queryClient]);

  useEffect(() => {
    const completedRun =
      activeRun &&
      (activeRun.status === "completed" ||
        activeRun.status === "partial_results" ||
        activeRun.status === "stopped_partial" ||
        activeRun.status === "no_results")
        ? activeRun
        : null;
    const filename = completedRun?.outputPath
      ? filenameFromOutputPath(completedRun.outputPath)
      : null;

    if (!completedRun || !filename) {
      if (completedOutputSyncRef.current?.timer) {
        window.clearTimeout(completedOutputSyncRef.current.timer);
      }
      completedOutputSyncRef.current = null;
      return;
    }

    const currentSync = completedOutputSyncRef.current;
    if (
      currentSync &&
      currentSync.runId === completedRun.id &&
      currentSync.filename === filename
    ) {
      return;
    }

    let cancelled = false;
    const scheduleRefetch = (attempt: number) => {
      const timer = window.setTimeout(async () => {
        const filesResult = await outputFilesQuery.refetch();
        if (cancelled) return;
        const outputFile = filesResult.data?.outputs.find(
          (file) => file.filename === filename,
        );
        if (outputFile) {
          setSelectedOutputFile((current) => current ?? filename);
          try {
            const freshOutput = await getCrawlOutputFile(filename);
            if (cancelled) return;
            queryClient.setQueryData(
              outputFileQueryKey(filename, outputFile.modifiedAt),
              freshOutput,
            );
            if (countMissingPreviewAvatars(freshOutput) === 0) {
              completedOutputSyncRef.current = null;
              return;
            }
          } catch {
            // The file may still be locked for its final atomic write. Retry below.
          }
        }
        if (attempt >= 25) {
          completedOutputSyncRef.current = null;
          return;
        }
        scheduleRefetch(attempt + 1);
      }, attempt === 0 ? 250 : 1200);

      completedOutputSyncRef.current = {
        attempts: attempt + 1,
        filename,
        runId: completedRun.id,
        timer,
      };
    };

    scheduleRefetch(0);

    return () => {
      cancelled = true;
      if (completedOutputSyncRef.current?.timer) {
        window.clearTimeout(completedOutputSyncRef.current.timer);
      }
      completedOutputSyncRef.current = null;
    };
  }, [
    activeRun?.id,
    activeRun?.outputPath,
    activeRun?.status,
    outputFilesQuery.refetch,
    queryClient,
  ]);

  useEffect(() => {
    setSelectedDeleteFilenames((current) => {
      const next = current.filter((filename) => availableOutputFilenames.has(filename));
      return next.length === current.length ? current : next;
    });
    setPendingDeleteFilenames((current) => {
      const next = current.filter((filename) => availableOutputFilenames.has(filename));
      return next.length === current.length ? current : next;
    });
  }, [availableOutputFilenames]);

  const updateForm = <TKey extends keyof CrawlFormState>(
    key: TKey,
    value: CrawlFormState[TKey]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleStart = () => {
    if (!isSessionReady || startLockRef.current || startMutation.isPending || formBlockedReason) {
      return;
    }
    startLockRef.current = true;
    startMutation.mutate(buildStartPayload(form));
  };

  const handleSelectRun = (runId: string) => {
    setSelectedOutputFile(null);
    setSelectedRunId(runId);
  };

  const handleSelectOutputFile = (filename: string | null) => {
    setSelectedOutputFile(filename);
    const selectedFile = outputFiles.find((file) => file.filename === filename);
    if (selectedFile?.requestMeta) {
      setForm(restoreFormFromRequestMeta(selectedFile.requestMeta));
      return;
    }
    if (!filename) {
      return;
    }

    const file = outputFiles.find((candidate) => candidate.filename === filename);
    void queryClient
      .fetchQuery({
        gcTime: 30 * 60_000,
        queryFn: () => getCrawlOutputFile(filename),
        queryKey: outputFileQueryKey(filename, file?.modifiedAt),
        staleTime: OUTPUT_PREVIEW_STALE_TIME_MS,
      })
      .then((response) => {
        if (response.requestMeta) {
          setForm(restoreFormFromRequestMeta(response.requestMeta));
        }
      })
      .catch(() => undefined);
  };

  const handlePrefetchOutputFile = (filename: string) => {
    const file = outputFiles.find((candidate) => candidate.filename === filename);
    void queryClient.prefetchQuery({
      gcTime: 30 * 60_000,
      queryFn: () => getCrawlOutputFile(filename),
      queryKey: outputFileQueryKey(filename, file?.modifiedAt),
      staleTime: OUTPUT_PREVIEW_STALE_TIME_MS,
    });
  };

  const handleDeleteOutputFile = (filename: string) => {
    setDeleteError("");
    setPendingDeleteFilenames([filename]);
  };

  const handleToggleDeleteSelection = (filename: string) => {
    setSelectedDeleteFilenames((current) =>
      current.includes(filename)
        ? current.filter((item) => item !== filename)
        : [...current, filename]
    );
  };

  const handleSelectAllDeleteFiles = () => {
    setSelectedDeleteFilenames(outputFiles.map((file) => file.filename));
  };

  const handleDeleteSelectedFiles = () => {
    if (selectedDeleteFilenames.length === 0) return;
    setDeleteError("");
    setPendingDeleteFilenames(selectedDeleteFilenames);
  };

  const previewLabel = selectedOutputFile
    ? selectedOutputSummary
      ? formatOutputDisplayLabel(selectedOutputSummary)
      : selectedOutputFile
    : activeRun?.status === "completed" ||
        activeRun?.status === "partial_results" ||
        activeRun?.status === "stopped_partial" ||
        activeRun?.status === "no_results"
      ? checkpointPreview?.isCheckpointOnly
        ? null
        : `Kết quả crawl: ${activeRun.requestId || activeRun.id}`
      : null;

  return (
    <>
      <DeleteOutputDialog
        files={pendingDeleteFiles}
        errorMessage={deleteError}
        isDeleting={deleteOutputFileMutation.isPending}
        onClose={() => {
          setDeleteError("");
          setPendingDeleteFilenames([]);
        }}
        onConfirm={() => {
          if (pendingDeleteFiles.length === 0) return;
          deleteOutputFileMutation.mutate(pendingDeleteFiles.map((file) => file.filename));
        }}
      />

      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
          <h1 className="text-sm font-semibold">Crawl dữ liệu</h1>
          <span className="text-xs text-muted-foreground">
            {posts.length > 0 ? `${posts.length} bài viết` : ""}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="w-[340px] shrink-0 overflow-y-auto border-r p-4">
            <div className="grid gap-4">
              <AppReadinessPanel scope="crawl" state={readiness} />
              <CrawlForm
                canStart={canStart}
                errorMessage={startMutation.isError ? startMutation.error.message : ""}
                form={form}
                isPending={startMutation.isPending}
                isRunning={isRunning}
                onSubmit={handleStart}
                queuedAheadCount={queuedAheadCount}
                startBlockedReason={startBlockedReason}
                updateForm={updateForm}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {previewLabel ? (
              <div className="flex h-9 shrink-0 items-center justify-between border-b px-4">
                <span className="truncate text-xs font-medium text-foreground">
                  {previewLabel}
                </span>
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto p-4">
              {previewQuery.isFetching && !previewData ? (
                <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
                  <LoaderCircle className="size-6 animate-spin" />
                  <span className="text-sm">Đang tải dữ liệu...</span>
                </div>
              ) : previewQuery.isError ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
                  <FileSearch className="size-10 opacity-30" />
                  <div className="max-w-md text-center">
                    <p className="text-sm font-medium text-foreground">
                      Chưa mở được dữ liệu xem trước
                    </p>
                    <p className="mt-1 text-xs">{previewErrorMessage}</p>
                  </div>
                </div>
              ) : posts.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
                  <FileSearch className="size-10 opacity-30" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Chưa có dữ liệu xem trước</p>
                    <p className="mt-1 text-xs">
                      {checkpointPreview?.isCheckpointOnly
                        ? "Phiên này mới lưu checkpoint để tiếp tục, chưa có preview hoàn chỉnh."
                        : "Bắt đầu crawl hoặc chọn một file đầu ra ở bên phải."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  {previewQuery.isFetching ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      <span>Đang tải file xem trước mới...</span>
                    </div>
                  ) : null}
                  {previewRequestMeta ? (
                    <RequestMetaPanel requestMeta={previewRequestMeta} />
                  ) : null}
                  {checkpointPreview?.showTemporaryPreviewNote ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
                      <p className="font-medium">Đây là preview tạm từ lần dừng sớm</p>
                      <p className="mt-1 text-xs">
                        {checkpointPreview.previewOnlyCount > 0
                          ? `${checkpointPreview.previewOnlyCount} bài bên dưới mới ở mức xem trước. Bình luận và chi tiết sẽ được lấy thêm khi bạn bấm Tiếp tục từ đây.`
                          : `${checkpointPreview.pendingCount} bài vẫn còn chờ xử lý tiếp nếu bạn muốn nối run này.`}
                      </p>
                    </div>
                  ) : null}
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
                    {posts.map((post) => (
                      <PostCard key={post.post_id} post={post} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex w-[320px] shrink-0 flex-col gap-5 overflow-y-auto border-l p-4">
            <RunStatusPanel
              activeRun={activeRun}
              canCancelActiveRun={canCancelActiveRun}
              cancelMutation={cancelMutation}
              now={now}
              resumeMutation={resumeMutation}
              runs={runs}
              savedOutputStats={savedOutputStats}
            />
            <div className="border-t pt-4">
              <RecentRuns
                onSelectRun={handleSelectRun}
                runs={runs}
                selectedRunId={selectedRunId}
              />
            </div>
            <div className="border-t pt-4">
              <OutputFilesPanel
                deletingFilenames={
                  deleteOutputFileMutation.isPending
                    ? deletingFilenameSet
                    : new Set<string>()
                }
                selectedFilenames={selectedDeleteFilenameSet}
                onClearSelection={() => setSelectedDeleteFilenames([])}
                onDeleteFile={handleDeleteOutputFile}
                onDeleteSelected={handleDeleteSelectedFiles}
                onSelectAll={handleSelectAllDeleteFiles}
                outputFiles={outputFiles}
                outputFilesQuery={outputFilesQuery}
                prefetchOutputFile={handlePrefetchOutputFile}
                selectedOutputFile={selectedOutputFile}
                selectOutputFile={handleSelectOutputFile}
                toggleFileSelection={handleToggleDeleteSelection}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

type CheckpointPreviewState = {
  discoveredCount: number;
  isCheckpointOnly: boolean;
  pendingCount: number;
  previewOnlyCount: number;
  processedCount: number;
  resumeUrls: string[];
  selectedCount: number;
  showTemporaryPreviewNote: boolean;
};

function resolveSessionStartBlockReason(session: ThreadsSession | null): string {
  if (!session) {
    return "Đang kiểm tra phiên Threads. Hãy đợi vài giây rồi thử lại.";
  }
  if (session.status === "ready") {
    return "";
  }
  if (session.status === "network_error") {
    return "Máy này hiện không truy cập được Threads. Kiểm tra internet, VPN, firewall hoặc proxy, sau đó bấm Kiểm tra lại session trước khi crawl.";
  }
  if (session.status === "needs_login") {
    if (session.accessState === "onboarding") {
      return "Phiên Threads đang ở bước onboarding. Hãy đăng nhập lại trong phần Cần hoàn tất hoặc vào Cài đặt để hoàn tất trước khi crawl.";
    }
    return "Bạn cần đăng nhập lại Threads trước khi crawl. Hãy dùng nút Đăng nhập Threads ở panel Cần hoàn tất hoặc trong trang Cài đặt.";
  }
  return "Bạn cần đăng nhập Threads trước khi crawl. Hãy dùng nút Đăng nhập Threads ở panel Cần hoàn tất hoặc trong trang Cài đặt.";
}

function resolveFormStartBlockReason(form: CrawlFormState): string {
  if (form.sourceMode !== "discover" && form.seedPostUrls.trim().length === 0) {
    return "Bạn đã chọn mode dán link / mã nhúng bài viết, nhưng chưa nhập dữ liệu nào.";
  }
  const invalidTargets = invalidSeedTargets(form.seedPostUrls);
  if (form.sourceMode !== "discover" && invalidTargets.length > 0) {
    return `Link Threads không hợp lệ hoặc không được hỗ trợ: ${invalidTargets[0]}`;
  }
  if (form.sourceMode === "seed_only") return "";
  if (form.datePreset === "after_date" && !form.startDate) return "Hãy chọn ngày bắt đầu cho bộ lọc Sau ngày.";
  if (form.datePreset === "before_date" && !form.endDate) return "Hãy chọn ngày kết thúc cho bộ lọc Trước ngày.";
  if (form.datePreset === "date_range") {
    if (!form.startDate || !form.endDate) return "Khoảng ngày cần đủ cả ngày bắt đầu và ngày kết thúc.";
    if (form.startDate > form.endDate) return "Ngày bắt đầu không được sau ngày kết thúc.";
  }
  return "";
}

function resolveCheckpointPreview(
  previewData: CrawlOutputResponse | undefined,
  activeRun: CrawlRun | undefined,
): CheckpointPreviewState | null {
  const topics = previewData?.output ?? [];
  const partialTopic = [...topics]
    .reverse()
    .find((topic) => isRecord(topic.crawl_audit));
  const audit = isRecord(partialTopic?.crawl_audit)
    ? partialTopic.crawl_audit
    : undefined;
  const resumeUrls = safeStringList(audit?.resume_seed_urls);
  const pendingUrls = safeStringList(audit?.pending_post_urls);
  const processedUrls = safeStringList(audit?.processed_post_urls);
  const previewOnlyUrls = safeStringList(audit?.preview_only_post_urls);
  const isPartial =
    audit?.partial_output === true ||
    resumeUrls.length > 0 ||
    pendingUrls.length > 0 ||
    previewOnlyUrls.length > 0 ||
    activeRun?.status === "stopped_partial";

  if (!isPartial) {
    return null;
  }

  const posts = topics.flatMap((topic) => topic.posts);
  return {
    discoveredCount: Math.max(
      numberValue(
        isRecord(audit?.collector_stats) ? audit.collector_stats.discovered_urls : 0,
      ),
      numberValue(activeRun?.progress?.discovered_posts),
    ),
    isCheckpointOnly: posts.length === 0,
    pendingCount: Math.max(
      pendingUrls.length,
      numberValue(activeRun?.progress?.pending_posts),
    ),
    previewOnlyCount: previewOnlyUrls.length,
    processedCount: Math.max(
      processedUrls.length,
      numberValue(activeRun?.progress?.selected_posts),
    ),
    resumeUrls,
    selectedCount: Math.max(
      resumeUrls.length,
      numberValue(activeRun?.progress?.selected_posts),
      posts.length,
    ),
    showTemporaryPreviewNote:
      posts.length > 0 && (previewOnlyUrls.length > 0 || pendingUrls.length > 0),
  };
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeStringList(value: unknown): string[] {
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

function countMissingPreviewAvatars(data: CrawlOutputResponse): number {
  let missing = 0;
  for (const topic of data.output ?? []) {
    for (const post of topic.posts ?? []) {
      if (post.avatar_url && !post.avatar_asset_path) missing += 1;
      for (const comment of post.top_comments ?? []) {
        if (comment.avatar_url && !comment.avatar_asset_path) missing += 1;
      }
    }
  }
  return missing;
}

function filenameFromOutputPath(outputPath: string): string | null {
  const normalized = String(outputPath ?? "").trim().replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
