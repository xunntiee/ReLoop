import {
  CheckCircle2,
  LoaderCircle,
  PauseCircle,
  StopCircle,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CrawlRun } from "@/lib/api";

export const StatusBadge = ({ run }: { run: CrawlRun }) => {
  if (run.status === "queued") {
    return (
      <Badge variant="secondary">
        <LoaderCircle />
        Đang chờ
      </Badge>
    );
  }

  if (run.status === "completed" || run.status === "partial_results") {
    return (
      <Badge>
        <CheckCircle2 />
        Hoàn thành
      </Badge>
    );
  }

  if (run.status === "no_results") {
    return (
      <Badge variant="secondary">
        <CheckCircle2 />
        Không có kết quả
      </Badge>
    );
  }

  if (run.status === "stopped_partial") {
    return (
      <Badge variant="outline">
        <PauseCircle />
        Đã dừng sớm
      </Badge>
    );
  }

  if (run.status === "failed") {
    return (
      <Badge variant="destructive">
        <XCircle />
        Lỗi
      </Badge>
    );
  }

  if (run.status === "cancelled") {
    return (
      <Badge variant="outline">
        <StopCircle />
        Đã hủy
      </Badge>
    );
  }

  if (run.status === "stopping") {
    return (
      <Badge variant="secondary">
        <LoaderCircle className="animate-spin" />
        Đang dừng
      </Badge>
    );
  }

  return (
    <Badge variant="secondary">
      <LoaderCircle className="animate-spin" />
      Đang chạy
    </Badge>
  );
};
