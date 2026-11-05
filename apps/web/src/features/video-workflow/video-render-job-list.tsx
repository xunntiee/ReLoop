import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  LoaderCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getVideoRenderJobs, type VideoRenderJob } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatVideoRenderErrorMessage } from "./render-error-message";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<{
    getFileHandle: (
      name: string,
      options?: { create?: boolean }
    ) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }>;
};

export const VideoRenderJobList = ({
  jobs,
  isLoading,
}: {
  isLoading?: boolean;
  jobs: VideoRenderJob[];
}) => {
  const completedJobs = jobs.filter(
    (job) => job.status === "completed" && Boolean(job.render?.url)
  );
  const toAbsoluteDownloadUrl = (value: string) => {
    const url = new URL(value, window.location.origin);
    url.searchParams.set("download", "1");
    return url.toString();
  };
  const getDownloadFilename = (job: VideoRenderJob) =>
    job.render?.filename ?? `${job.username}-${job.draft_id}.mp4`;

  const fetchVideoBlob = async (job: VideoRenderJob): Promise<Blob> => {
    const url = job.render?.url;
    if (!url) {
      throw new Error("Không tìm thấy đường dẫn tải video.");
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(toAbsoluteDownloadUrl(url), {
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(`Không tải được file ${getDownloadFilename(job)}.`);
        }
        return await response.blob();
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Không tải được file ${getDownloadFilename(job)}.`);
  };


  const triggerDirectDownload = (job: VideoRenderJob) => {
    const url = job.render?.url;
    if (!url) {
      throw new Error("Không tìm thấy đường dẫn tải video.");
    }

    const link = document.createElement("a");
    link.href = toAbsoluteDownloadUrl(url);
    link.download = getDownloadFilename(job);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleSingleDownload = async (job: VideoRenderJob) => {
    try {
      triggerDirectDownload(job);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể tải video này.";
      window.alert(message);
    }
  };

  const handleDownloadAll = async () => {
    if (completedJobs.length === 0) {
      return;
    }

    const directoryWindow = window as DirectoryPickerWindow;

    if (directoryWindow.showDirectoryPicker) {
      try {
        const directoryHandle = await directoryWindow.showDirectoryPicker({
          mode: "readwrite",
        });

        try {
          for (const job of completedJobs) {
            const blob = await fetchVideoBlob(job);

            const fileHandle = await directoryHandle.getFileHandle(
              getDownloadFilename(job),
              { create: true }
            );
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
          }
          return;
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Không thể lưu tất cả video vào thư mục đã chọn.";
          window.alert(message);
          return;
        }
      } catch (error) {
        const name =
          typeof error === "object" && error && "name" in error
            ? String((error as { name?: unknown }).name ?? "")
            : "";
        if (name === "AbortError") {
          return;
        }
      }
    }

    for (const job of completedJobs) {
      try {
        triggerDirectDownload(job);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Không thể tải một trong các video.";
        window.alert(message);
        return;
      }
    }
  };

  return (
    <Card className="flex h-full min-h-0 w-full overflow-hidden py-0 shadow-md">
      <CardHeader className="border-b bg-muted/15 px-2.5 py-1.5 [--card-spacing:0.25rem]">
        <div className="flex items-center justify-between w-full">
          <CardTitle className="text-[0.68rem] font-bold text-muted-foreground uppercase tracking-wider">
            Danh sách render
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {completedJobs.length > 0 ? (
              <button
                className="inline-flex h-6 items-center gap-1 rounded-md border border-black/10 bg-black px-2 text-[0.6rem] font-semibold text-white shadow-sm transition-colors hover:bg-black/85"
                onClick={handleDownloadAll}
                title={`Tải tất cả ${completedJobs.length} video đã render xong`}
                type="button"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Tải tất cả</span>
              </button>
            ) : null}
            {jobs.length > 0 ? (
              <span className="rounded-full bg-background border px-1 py-0 text-[0.55rem] font-bold text-muted-foreground">
                {jobs.length}
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-2 py-1.5">
        {isLoading && jobs.length === 0 ? (
          <div className="rounded-md border border-dashed px-2 py-3 text-center text-[10px] text-muted-foreground">
            Đang tải...
          </div>
        ) : jobs.length === 0 ? (
          <div className="rounded-md border border-dashed px-2 py-3 text-center text-[10px] text-muted-foreground">
            Chưa có file render
          </div>
        ) : (
          <div className="h-full overflow-y-auto pr-1 custom-scrollbar">
            <div className="space-y-1 pb-1">
              {jobs.map((job) => (
                <div
                  className={cn(
                    "group relative flex flex-col gap-0.5 rounded border py-1 px-1.5 transition-all duration-200",
                    jobRowBgAndBorderClass(job.status)
                  )}
                  key={job.draft_id}
                >
                  <div className="flex items-center justify-between gap-1.5 w-full">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <div className="shrink-0">{renderStatusIcon(job.status)}</div>
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-[9.5px] font-bold text-foreground leading-normal"
                          title={job.render?.filename ?? `${job.username}-${job.draft_id}.mp4`}
                        >
                          {compactFilename(
                            job.render?.filename ?? `${job.username}-${job.draft_id}.mp4`
                          )}
                        </p>
                        <div className="flex items-center gap-1 text-[8px] text-muted-foreground leading-none">
                          <span>
                            {new Date(job.created_at).toLocaleTimeString("vi-VN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {job.post_count > 0 && (
                            <>
                              <span>•</span>
                              <span>{job.post_count} bài</span>
                            </>
                          )}
                          {job.render?.durationSeconds && (
                            <>
                              <span>•</span>
                              <span>{Math.round(job.render.durationSeconds)}s</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {job.status === "completed" && job.render?.url && (
                      <button
                        className="shrink-0 flex items-center justify-center size-6 rounded-md border border-black/10 bg-black text-white hover:bg-black/85 transition-all duration-150 shadow-sm"
                        title="Tải xuống / Xem video"
                        onClick={() => void handleSingleDownload(job)}
                        type="button"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {job.status === "failed" && job.error && (
                    <p className="text-[7.5px] text-rose-500 font-medium border-t border-rose-500/10 pt-0.5 leading-normal">
                      Lỗi: {formatVideoRenderErrorMessage(job.error)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const VideoRenderJobsPanel = () => {
  const renderJobsQuery = useQuery({
    queryFn: getVideoRenderJobs,
    queryKey: ["video-render-jobs"],
    // Keep the render list live without forcing the whole video page to rerender.
    refetchInterval: 2000,
  });

  return (
    <VideoRenderJobList
      isLoading={renderJobsQuery.isLoading}
      jobs={renderJobsQuery.data?.jobs ?? []}
    />
  );
};

function compactFilename(value: string, maxLength = 26): string {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const extensionIndex = trimmed.lastIndexOf(".");
  const extension =
    extensionIndex > 0 && extensionIndex < trimmed.length - 1
      ? trimmed.slice(extensionIndex)
      : "";
  const baseName = extension ? trimmed.slice(0, extensionIndex) : trimmed;
  const available = Math.max(10, maxLength - extension.length - 3);
  const headLength = Math.ceil(available * 0.65);
  const tailLength = Math.max(4, available - headLength);

  return `${baseName.slice(0, headLength)}...${baseName.slice(
    Math.max(headLength, baseName.length - tailLength)
  )}${extension}`;
}

function renderStatusIcon(status: VideoRenderJob["status"]) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />;
    case "failed":
      return <AlertCircle className="h-3 w-3 text-red-600 shrink-0" />;
    case "running":
      return <LoaderCircle className="h-3 w-3 animate-spin text-sky-600 shrink-0" />;
    default:
      return <Clock3 className="h-3 w-3 text-amber-600 shrink-0" />;
  }
}

function jobRowBgAndBorderClass(status: VideoRenderJob["status"]): string {
  const base = "shadow-[0_1px_2px_rgba(0,0,0,0.02)]";
  switch (status) {
    case "completed":
      return `${base} border-green-500/20 bg-green-500/[0.03] hover:bg-green-500/[0.06]`;
    case "failed":
      return `${base} border-red-500/20 bg-red-500/[0.03] hover:bg-red-500/[0.06]`;
    case "running":
      return `${base} border-sky-500/20 bg-sky-500/[0.03] hover:bg-sky-500/[0.06] animate-pulse`;
    default:
      return `${base} border-amber-500/20 bg-amber-500/[0.03] hover:bg-amber-500/[0.06]`;
  }
}
