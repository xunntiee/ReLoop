import { LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import type { CrawlOutputFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  formatBytes,
  formatDateTime,
  formatOutputDisplayLabel,
} from "@/lib/formatters";
import { cn } from "@/lib/utils";

export const OutputFilesPanel = ({
  deletingFilenames,
  selectedFilenames,
  onClearSelection,
  onDeleteFile,
  onDeleteSelected,
  onSelectAll,
  outputFiles,
  outputFilesQuery,
  prefetchOutputFile,
  selectedOutputFile,
  selectOutputFile,
  toggleFileSelection,
}: {
  deletingFilenames: Set<string>;
  selectedFilenames: Set<string>;
  onClearSelection: () => void;
  onDeleteFile: (filename: string) => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  outputFiles: CrawlOutputFile[];
  outputFilesQuery: any;
  prefetchOutputFile: (filename: string) => void;
  selectedOutputFile: string | null;
  selectOutputFile: (filename: string | null) => void;
  toggleFileSelection: (filename: string) => void;
}) => (
  <div className="grid gap-2">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">File đầu ra</span>
      <div className="flex items-center gap-1">
        {outputFiles.length > 0 ? (
          <Button
            disabled={deletingFilenames.size > 0}
            onClick={selectedFilenames.size === outputFiles.length ? onClearSelection : onSelectAll}
            size="xs"
            type="button"
            variant="ghost"
          >
            {selectedFilenames.size === outputFiles.length ? "Bỏ chọn" : "Chọn"}
          </Button>
        ) : null}
        {selectedFilenames.size > 0 ? (
          <Button
            disabled={deletingFilenames.size > 0}
            onClick={onDeleteSelected}
            size="icon-xs"
            title={`Xóa ${selectedFilenames.size} file đã chọn`}
            type="button"
            variant="ghost"
          >
            {deletingFilenames.size > 0 ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3 text-destructive" />
            )}
          </Button>
        ) : null}
        <Button
          className="size-7"
          onClick={() => void outputFilesQuery.refetch().then(() => undefined)}
          size="icon"
          type="button"
          variant="ghost"
        >
          {outputFilesQuery.isFetching ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
    {selectedFilenames.size > 0 ? (
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
        <span>{selectedFilenames.size} file đã chọn</span>
        <button
          className="font-medium text-foreground hover:underline"
          disabled={deletingFilenames.size > 0}
          onClick={onClearSelection}
          type="button"
        >
          Bỏ chọn
        </button>
      </div>
    ) : null}
    {outputFiles.length > 0 ? (
      <div className="flex max-h-[400px] flex-col gap-1 overflow-y-auto pr-1">
        {outputFiles.map((file) => {
          const isDeleting = deletingFilenames.has(file.filename);
          const isSelected = selectedOutputFile === file.filename;
          const isChecked = selectedFilenames.has(file.filename);
          const isCheckpointOnly =
            file.partial === true &&
            file.posts === 0 &&
            Number(file.pendingResumeCount ?? 0) > 0;
          const hasTemporaryPreview =
            file.partial === true && Number(file.previewPostCount ?? 0) > 0;
          const summaryLine = isCheckpointOnly
            ? `Mốc tiếp tục · ${file.pendingResumeCount ?? 0} bài chờ xử lý tiếp`
            : hasTemporaryPreview
              ? `Preview tạm ${file.posts} bài · ${file.pendingResumeCount ?? 0} bài có thể xử lý tiếp`
              : `${file.posts} bài · ${file.comments} bình luận · ${formatBytes(file.sizeBytes)}`;

          return (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border px-2 py-1.5 transition-colors hover:bg-muted",
                isSelected && "bg-muted ring-1 ring-primary/30",
                isChecked && "border-primary/60",
              )}
              key={file.filename}
            >
              <input
                aria-label={`Chọn ${formatOutputDisplayLabel(file)}`}
                checked={isChecked}
                className="mt-1 size-4 shrink-0 accent-primary"
                disabled={isDeleting}
                onChange={() => toggleFileSelection(file.filename)}
                type="checkbox"
              />
              <button
                className="grid min-w-0 flex-1 gap-0.5 text-left text-xs"
                onClick={() => selectOutputFile(file.filename)}
                onFocus={() => prefetchOutputFile(file.filename)}
                onMouseEnter={() => prefetchOutputFile(file.filename)}
                onPointerDown={() => prefetchOutputFile(file.filename)}
                title={file.filename}
                type="button"
              >
                <span className="truncate font-medium">
                  {formatOutputDisplayLabel(file)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {summaryLine}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatDateTime(file.modifiedAt)}
                </span>
              </button>

              <Button
                className="mt-0.5 shrink-0"
                disabled={isDeleting}
                onClick={() => onDeleteFile(file.filename)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                {isDeleting ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3 text-destructive" />
                )}
              </Button>
            </div>
          );
        })}
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">Chưa có file dữ liệu nào.</p>
    )}
  </div>
);
