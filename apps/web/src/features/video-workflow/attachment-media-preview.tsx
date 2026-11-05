import { Button } from "@/components/ui/button";
import { assetSources } from "@/lib/formatters";
import { ImagePlus, LoaderCircle, Maximize2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type AttachmentMediaAsset = {
  asset_path?: string;
  order?: number;
  remote_url?: string;
  type: "image" | "video";
};

const AttachmentVisual = ({
  asset,
  alt,
  className,
  muted = false,
}: {
  alt: string;
  asset: AttachmentMediaAsset;
  className: string;
  muted?: boolean;
}) => {
  const sources = useMemo(
    () => assetSources(asset.asset_path, asset.remote_url),
    [asset.asset_path, asset.remote_url],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const sourcesKey = sources.join("|");

  useEffect(() => setSourceIndex(0), [sourcesKey]);

  const src = sources[sourceIndex] ?? "";
  if (!src) {
    return <div className={`${className} bg-muted`} />;
  }

  const tryNextSource = () =>
    setSourceIndex((current) => Math.min(current + 1, sources.length));

  return asset.type === "video" ? (
    <video
      className={className}
      controls={!muted}
      muted={muted}
      onError={tryNextSource}
      playsInline
      preload="metadata"
      src={src}
    />
  ) : (
    <img
      alt={alt}
      className={className}
      loading="lazy"
      onError={tryNextSource}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
};

export const AttachmentMediaPreview = ({
  className = "flex items-center gap-3",
  media,
}: {
  className?: string;
  media?: AttachmentMediaAsset[] | null;
}) => {
  const assets = (media ?? []).filter(
    (asset) => assetSources(asset.asset_path, asset.remote_url).length > 0,
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeAsset = activeIndex === null ? null : assets[activeIndex] ?? null;

  if (assets.length === 0) return null;

  const firstAsset = assets[0];
  const attachmentLabel =
    firstAsset.type === "video" ? "Video đính kèm" : "Ảnh đính kèm";

  return (
    <>
      <div className={className} onClick={(event) => event.stopPropagation()}>
        <button
          aria-label={`Phóng to ${attachmentLabel.toLowerCase()}`}
          className="group relative size-12 shrink-0 overflow-hidden rounded-md border border-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-slate-800"
          onClick={() => setActiveIndex(0)}
          title="Bấm để phóng to"
          type="button"
        >
          <AttachmentVisual
            alt={attachmentLabel}
            asset={firstAsset}
            className="size-full object-cover"
            muted
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="size-4 text-white" />
          </span>
          {assets.length > 1 ? (
            <span className="absolute bottom-0 right-0 bg-black/70 px-1 font-semibold text-[8px] text-white">
              +{assets.length - 1}
            </span>
          ) : null}
        </button>
        <button
          className="text-left text-[11px] font-medium text-slate-500 outline-none hover:text-emerald-600 focus-visible:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300 dark:focus-visible:text-emerald-300"
          onClick={() => setActiveIndex(0)}
          type="button"
        >
          {attachmentLabel}
          {assets.length > 1 ? ` · ${assets.length} tệp` : ""}
        </button>
      </div>

      {activeAsset && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4"
              onClick={() => setActiveIndex(null)}
            >
              <div
                className="relative flex max-h-[92vh] w-full max-w-5xl flex-col gap-3 rounded-2xl bg-background p-3 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  aria-label="Đóng xem ảnh"
                  className="absolute right-4 top-4 z-10 size-8"
                  onClick={() => setActiveIndex(null)}
                  size="icon"
                  type="button"
                  variant="secondary"
                >
                  <X className="size-4" />
                </Button>
                <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
                  <AttachmentVisual
                    alt={attachmentLabel}
                    asset={activeAsset}
                    className="max-h-[76vh] w-full object-contain"
                  />
                </div>
                {assets.length > 1 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {assets.map((asset, index) => (
                      <button
                        aria-label={`Xem tệp đính kèm ${index + 1}`}
                        className={`size-14 shrink-0 overflow-hidden rounded-md border-2 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                          index === activeIndex
                            ? "border-emerald-500"
                            : "border-transparent opacity-65 hover:opacity-100"
                        }`}
                        key={`${asset.order ?? index}-${asset.asset_path || asset.remote_url}`}
                        onClick={() => setActiveIndex(index)}
                        type="button"
                      >
                        <AttachmentVisual
                          alt={`Tệp đính kèm ${index + 1}`}
                          asset={asset}
                          className="size-full object-cover"
                          muted
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export const CommentMediaActions = ({
  media,
  onRemove,
  onUpload,
  uploading = false,
}: {
  media?: AttachmentMediaAsset[] | null;
  onRemove: () => void;
  onUpload: (file: File) => void;
  uploading?: boolean;
}) => {
  const hasMedia = (media ?? []).some(
    (asset) => assetSources(asset.asset_path, asset.remote_url).length > 0,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <button
        className="flex cursor-pointer items-center gap-1 rounded-md border border-emerald-400/60 bg-emerald-500/10 px-2 py-1 font-semibold text-[10px] text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-300"
        onClick={(event) => {
          event.stopPropagation();
          fileInputRef.current?.click();
        }}
        title={hasMedia ? "Đổi ảnh comment" : "Thêm ảnh cho comment"}
        type="button"
      >
        {uploading ? (
          <LoaderCircle className="size-3 animate-spin" />
        ) : (
          <ImagePlus className="size-3" />
        )}
        <span>{hasMedia ? "Đổi ảnh" : "Thêm ảnh"}</span>
      </button>
      <input
        accept="image/*,video/*"
        className="hidden"
        disabled={uploading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) {
            return;
          }
          onUpload(file);
          event.currentTarget.value = "";
        }}
        onClick={(event) => event.stopPropagation()}
        ref={fileInputRef}
        type="file"
      />
      {hasMedia ? (
        <button
          className="flex items-center gap-1 rounded-md border border-rose-400/60 bg-rose-500/10 px-2 py-1 font-semibold text-[10px] text-rose-700 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300"
          disabled={uploading}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          title="Bỏ ảnh khỏi comment"
          type="button"
        >
          <X className="size-3" />
          <span>Bỏ ảnh</span>
        </button>
      ) : null}
    </div>
  );
};
