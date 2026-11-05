import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { CrawlMediaAsset } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { assetSources } from "@/lib/formatters";

export const MediaGrid = ({
  compact = false,
  media,
}: {
  compact?: boolean;
  media: CrawlMediaAsset[];
}) => {
  const items = media.filter((item) => assetSources(item.asset_path, item.remote_url).length > 0);
  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "grid gap-2",
        compact ? "max-w-md grid-cols-2" : "grid-cols-1 sm:grid-cols-2"
      )}
    >
      {items.slice(0, compact ? 2 : 4).map((item) => (
        <MediaPreview
          compact={compact}
          item={item}
          key={`${item.order}-${item.asset_path || item.remote_url}`}
        />
      ))}
    </div>
  );
};

export const MediaPreview = ({
  compact,
  item,
}: {
  compact: boolean;
  item: CrawlMediaAsset;
}) => {
  const sources = useMemo(
    () => assetSources(item.asset_path, item.remote_url),
    [item.asset_path, item.remote_url]
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [sources.join("|")]);
  const src = sources[sourceIndex] ?? "";

  if (!src) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/50 text-muted-foreground",
          compact ? "h-40" : "h-64"
        )}
      >
        <span className="text-xs">Không tải được file</span>
      </div>
    );
  }

  const isLocal = sourceIndex === 0 && Boolean(item.asset_path);

  return (
    <div className="relative overflow-hidden rounded-lg border bg-muted group">
      <div className="absolute right-2 top-2 z-10 opacity-70 transition-opacity group-hover:opacity-100">
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {isLocal ? "Local" : "Remote"}
        </Badge>
      </div>
      {item.type === "video" ? (
        <video
          className="h-full max-h-80 w-full object-cover"
          controls
          onError={() => setSourceIndex((current) => current + 1)}
          preload="metadata"
          src={src}
        />
      ) : (
        <img
          alt=""
          className={cn("w-full object-cover", compact ? "max-h-40" : "max-h-96")}
          loading="lazy"
          onError={() => setSourceIndex((current) => current + 1)}
          referrerPolicy="no-referrer"
          src={src}
        />
      )}
    </div>
  );
};
