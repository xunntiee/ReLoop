import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CrawlOutputFile } from "@/lib/api";
import { formatDateTime, formatOutputDisplayLabel } from "@/lib/formatters";

export const DeleteOutputDialog = ({
  files,
  errorMessage,
  isDeleting,
  onClose,
  onConfirm,
}: {
  files: CrawlOutputFile[];
  errorMessage: string;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) => {
  useEffect(() => {
    if (files.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeleting) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [files.length, isDeleting, onClose]);

  if (files.length === 0 || typeof document === "undefined") {
    return null;
  }

  const isBulkDelete = files.length > 1;
  const totalPosts = files.reduce((total, file) => total + file.posts, 0);
  const totalComments = files.reduce((total, file) => total + file.comments, 0);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      onClick={() => {
        if (!isDeleting) onClose();
      }}
    >
      <div
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="border-b px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-semibold">
                {isBulkDelete ? `Xóa ${files.length} file đầu ra?` : "Xóa file đầu ra này?"}
              </h2>
              <p className="text-xs leading-5 text-muted-foreground">
                File JSON sẽ bị xóa khỏi danh sách và không xem lại được trong tool.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border bg-muted/20 p-3">
            {files.slice(0, 12).map((file) => (
              <div className="min-w-0 border-b pb-2 last:border-b-0 last:pb-0" key={file.filename}>
                <p className="truncate text-sm font-medium" title={file.filename}>
                  {formatOutputDisplayLabel(file)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {file.posts} bài · {file.comments} bình luận · {formatDateTime(file.modifiedAt)}
                </p>
              </div>
            ))}
            {files.length > 12 ? (
              <p className="text-xs text-muted-foreground">
                Còn {files.length - 12} file khác.
              </p>
            ) : null}
          </div>

          {isBulkDelete ? (
            <p className="text-xs text-muted-foreground">
              Tổng cộng {totalPosts} bài · {totalComments} bình luận.
            </p>
          ) : null}

          {errorMessage ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              disabled={isDeleting}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Hủy
            </Button>
            <Button
              disabled={isDeleting}
              onClick={onConfirm}
              type="button"
              variant="destructive"
            >
              {isDeleting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              {isDeleting ? "Đang xóa..." : isBulkDelete ? "Xóa các file" : "Xóa file"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
