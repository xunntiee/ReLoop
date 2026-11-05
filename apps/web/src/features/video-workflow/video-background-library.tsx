import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  deleteUploadedPromotionVideo,
  deleteUploadedVideoBackground,
  uploadPromotionVideo,
  uploadVideoBackground,
  type UploadedVideoPayload,
} from "@/lib/api";
import { formatBytes } from "@/lib/formatters";
import {
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

interface PendingUploadItem {
  file: File;
  id: string;
  title: string;
}

export const VideoBackgroundLibrary = ({
  isRefreshing,
  onRefresh,
  onUploaded,
  purpose = "background",
  videos,
}: {
  isRefreshing?: boolean;
  onRefresh: () => void;
  onUploaded: (videos: UploadedVideoPayload[]) => void;
  purpose?: "background" | "promotion";
  videos: UploadedVideoPayload[];
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingPath, setDeletingPath] = useState("");
  const [error, setError] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUploadItem[]>([]);
  const [previewVideo, setPreviewVideo] = useState<UploadedVideoPayload | null>(null);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handlePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) {
      return;
    }

    setPendingUploads((current) => [
      ...current,
      ...files.map((file) => ({
        file,
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        title: stripVideoExtension(file.name),
      })),
    ]);
  };

  const updatePendingTitle = (id: string, title: string) => {
    setPendingUploads((current) =>
      current.map((item) => (item.id === id ? { ...item, title } : item))
    );
  };

  const removePending = (id: string) => {
    setPendingUploads((current) => current.filter((item) => item.id !== id));
  };

  const uploadPending = async () => {
    if (pendingUploads.length === 0) {
      return;
    }

    try {
      setError("");
      setIsUploading(true);
      const uploaded: UploadedVideoPayload[] = [];
      for (const item of pendingUploads) {
        const title = item.title.trim() || stripVideoExtension(item.file.name);
        const result =
          purpose === "promotion"
            ? await uploadPromotionVideo(item.file, title)
            : await uploadVideoBackground(item.file, title);
        uploaded.push(result.video);
      }
      setPendingUploads([]);
      onUploaded(uploaded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (video: UploadedVideoPayload) => {
    const serverPath = String(video.serverPath ?? "").trim();
    if (!serverPath) {
      return;
    }

    try {
      setError("");
      setDeletingPath(serverPath);
      if (purpose === "promotion") {
        await deleteUploadedPromotionVideo(serverPath);
      } else {
        await deleteUploadedVideoBackground(serverPath);
      }
      if (previewVideo?.serverPath === serverPath) {
        setPreviewVideo(null);
      }
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingPath("");
    }
  };

  return (
    <>
      <Card className="w-full">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-base">
            {purpose === "promotion"
              ? "Thư viện video quảng bá / quảng cáo"
              : "Thư viện video nền"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <input
              accept="video/*"
              className="hidden"
              multiple
              onChange={handlePicked}
              ref={inputRef}
              type="file"
            />
            <Button
              className="h-8 px-3 text-xs"
              onClick={openPicker}
              size="sm"
              type="button"
              variant="outline"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Chọn video
            </Button>
            <Button
              className="size-8"
              onClick={onRefresh}
              size="icon"
              type="button"
              variant="outline"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {purpose === "promotion"
              ? "Tải video quảng bá một lần để dùng lại ở giữa hoặc cuối các video xuất."
              : "Tải nhiều video nền một lần. Mỗi video có thể đặt tên riêng và dùng lại ở phần Làm video tự động."}
          </p>

          {pendingUploads.length > 0 ? (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-sm">Chuẩn bị tải lên</p>
                <Button
                  className="h-8 px-3 text-xs"
                  disabled={isUploading}
                  onClick={() => void uploadPending()}
                  size="sm"
                  type="button"
                >
                  {isUploading ? (
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Tải {pendingUploads.length} video
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {pendingUploads.map((item) => (
                  <div className="rounded-md border bg-background p-3" key={item.id}>
                    <p className="mb-2 truncate text-xs text-muted-foreground">
                      {item.file.name}
                    </p>
                    <Input
                      className="h-9 text-sm"
                      onChange={(event) =>
                        updatePendingTitle(item.id, event.currentTarget.value)
                      }
                      placeholder="Tên video"
                      value={item.title}
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(item.file.size)}
                      </span>
                      <Button
                        className="h-7 px-2 text-xs"
                        onClick={() => removePending(item.id)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Bỏ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {videos.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
              {purpose === "promotion"
                ? "Chưa có video quảng bá nào trong thư viện."
                : "Chưa có video nền nào trong thư viện."}
            </div>
          ) : (
            <div className="max-h-[75vh] overflow-y-auto pr-1 border rounded-lg divide-y bg-background custom-scrollbar">
              {videos.map((video) => {
                const isDeleting = deletingPath === video.serverPath;
                return (
                  <div
                    className="flex items-center gap-4 p-2 bg-card/50 hover:bg-muted/30 transition-colors"
                    key={video.serverPath || video.name}
                  >
                    <button
                      className="group relative block w-28 shrink-0 aspect-video overflow-hidden rounded-md border bg-muted"
                      onClick={() => setPreviewVideo(video)}
                      type="button"
                    >
                      <VideoThumbnail video={video} />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                        <span className="rounded-full bg-black/65 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
                          <Play className="h-4 w-4 fill-current" />
                        </span>
                      </div>
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-foreground" title={video.name}>
                        {video.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatBytes(video.sizeBytes)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        className="h-8 px-2.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={isDeleting}
                        onClick={() => void handleDelete(video)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {isDeleting ? (
                          <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                        )}
                        Xóa
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {previewVideo?.mediaUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewVideo(null)}
        >
          <div
            className="w-full max-w-4xl overflow-hidden rounded-xl bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{previewVideo.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(previewVideo.sizeBytes)}
                </p>
              </div>
              <Button
                className="size-8"
                onClick={() => setPreviewVideo(null)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="bg-black">
              <video
                autoPlay
                className="max-h-[75vh] w-full"
                controls
                playsInline
                src={previewVideo.mediaUrl}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

const VideoThumbnail = ({ video }: { video: UploadedVideoPayload }) => {
  const [thumbnailUrl, setThumbnailUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    const mediaUrl = String(video.mediaUrl ?? "").trim();
    if (!mediaUrl) {
      setThumbnailUrl("");
      return;
    }

    const videoElement = document.createElement("video");
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.preload = "metadata";
    videoElement.src = mediaUrl;

    const capture = () => {
      const width = videoElement.videoWidth;
      const height = videoElement.videoHeight;
      if (!width || !height) {
        setThumbnailUrl("");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        setThumbnailUrl("");
        return;
      }
      context.drawImage(videoElement, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      if (!cancelled) {
        setThumbnailUrl(dataUrl);
      }
    };

    const onLoadedData = () => {
      try {
        videoElement.currentTime = Math.min(0.1, videoElement.duration || 0.1);
      } catch {
        capture();
      }
    };

    const onSeeked = () => capture();
    const onError = () => setThumbnailUrl("");

    videoElement.addEventListener("loadeddata", onLoadedData);
    videoElement.addEventListener("seeked", onSeeked);
    videoElement.addEventListener("error", onError);

    return () => {
      cancelled = true;
      videoElement.pause();
      videoElement.removeAttribute("src");
      videoElement.load();
      videoElement.removeEventListener("loadeddata", onLoadedData);
      videoElement.removeEventListener("seeked", onSeeked);
      videoElement.removeEventListener("error", onError);
    };
  }, [video.mediaUrl]);

  return thumbnailUrl ? (
    <img
      alt={video.name}
      className="aspect-video w-full bg-muted object-cover"
      src={thumbnailUrl}
    />
  ) : (
    <div className="flex aspect-video w-full items-center justify-center bg-muted/50 text-muted-foreground">
      <ImageIcon className="h-8 w-8" />
    </div>
  );
};

function stripVideoExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}
