import type { CrawlRun } from "@/lib/api";
import { formatRelativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

function resolveSimpleStatus(run: CrawlRun): {
  className: string;
  label: string;
} {
  if (run.status === "completed" || run.status === "partial_results") {
    return { label: "Hoàn tất", className: "text-emerald-600 dark:text-emerald-400" };
  }
  if (run.status === "no_results") {
    return { label: "Không có kết quả", className: "text-amber-600 dark:text-amber-400" };
  }
  if (run.status === "failed") {
    return { label: "Có vấn đề", className: "text-destructive" };
  }
  if (run.status === "stopped_partial") {
    return { label: "Đã dừng sớm", className: "text-amber-600 dark:text-amber-400" };
  }
  if (run.status === "cancelled") {
    return { label: "Đã hủy", className: "text-muted-foreground" };
  }
  if (run.status === "queued") {
    return { label: "Đang đợi", className: "text-muted-foreground" };
  }
  if (run.status === "stopping") {
    return { label: "Đang dừng...", className: "text-amber-600 dark:text-amber-400" };
  }
  if (run.status === "running") {
    return { label: "Đang xử lý...", className: "text-primary" };
  }
  return { label: "Không rõ", className: "text-muted-foreground" };
}

export const RecentRuns = ({
  runs,
  onSelectRun,
  selectedRunId,
}: {
  runs: CrawlRun[];
  onSelectRun: (runId: string) => void;
  selectedRunId: string;
}) => {
  if (runs.length === 0) return null;
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Tiến trình gần đây</span>
      <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto pr-1">
        {runs.map((run) => {
          const status = resolveSimpleStatus(run);
          return (
            <button
              className={cn(
                "flex shrink-0 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted",
                run.id === selectedRunId && "bg-muted ring-1 ring-primary/30",
              )}
              key={run.id}
              onClick={() => onSelectRun(run.id)}
              type="button"
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="truncate font-medium">
                  {run.summaryLabel || run.topics[0] || "Không có tên"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatRelativeTime(run.startedAt)}
                </span>
              </div>
              <span className={`shrink-0 text-[11px] font-medium ${status.className}`}>
                {status.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
