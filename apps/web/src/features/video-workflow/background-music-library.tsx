import { useRef, useState, type ChangeEvent } from "react";
import {
  LoaderCircle,
  Music,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  deleteUploadedBackgroundMusic,
  type UploadedAudioPayload,
  uploadBackgroundMusic,
} from "@/lib/api";
import { formatBytes } from "@/lib/formatters";

interface PendingUploadItem {
  file: File;
  id: string;
  title: string;
}

export const BackgroundMusicLibrary = ({
  isRefreshing,
  onRefresh,
  onUploaded,
  tracks,
}: {
  isRefreshing?: boolean;
  onRefresh: () => void;
  onUploaded: (tracks: UploadedAudioPayload[]) => void;
  tracks: UploadedAudioPayload[];
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [deletingPath, setDeletingPath] = useState("");
  const [error, setError] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUploadItem[]>([]);

  const openPicker = () => inputRef.current?.click();

  const handlePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;

    setPendingUploads((current) => [
      ...current,
      ...files.map((file) => ({
        file,
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        title: stripAudioExtension(file.name),
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
    if (pendingUploads.length === 0) return;

    try {
      setError("");
      setIsUploading(true);
      const uploaded: UploadedAudioPayload[] = [];
      for (const item of pendingUploads) {
        const result = await uploadBackgroundMusic(
          item.file,
          item.title.trim() || stripAudioExtension(item.file.name)
        );
        uploaded.push(result.audio);
      }
      setPendingUploads([]);
      onUploaded(uploaded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (track: UploadedAudioPayload) => {
    const serverPath = String(track.serverPath ?? "").trim();
    if (!serverPath) return;

    try {
      setError("");
      setDeletingPath(serverPath);
      await deleteUploadedBackgroundMusic(serverPath);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingPath("");
    }
  };

  const audioKeyForTrack = (track: UploadedAudioPayload) => track.serverPath || track.name;

  const handleTrackPlay = (activeKey: string) => {
    for (const [key, audio] of Object.entries(audioRefs.current)) {
      if (!audio || key === activeKey) {
        continue;
      }
      if (!audio.paused) {
        audio.pause();
      }
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="text-base">Thư viện nhạc nền</CardTitle>
        <div className="flex items-center gap-2">
          <input
            accept="audio/*"
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
            Chọn nhạc
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
                Tải {pendingUploads.length} nhạc
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
                    placeholder="Tên bản nhạc"
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

        {tracks.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
            Chưa có nhạc nền nào trong thư viện.
          </div>
        ) : (
          <div className="max-h-[75vh] overflow-y-auto pr-1 border rounded-lg divide-y bg-background custom-scrollbar">
            {tracks.map((track) => {
              const isDeleting = deletingPath === track.serverPath;
              const audioKey = audioKeyForTrack(track);
              return (
                <div
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-2 bg-card/50 hover:bg-muted/30 transition-colors"
                  key={track.serverPath || track.name}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="rounded-lg bg-muted p-2 shrink-0 text-muted-foreground">
                      <Music className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground" title={track.name}>
                        {track.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatBytes(track.sizeBytes)}
                      </p>
                    </div>
                  </div>

                  {track.mediaUrl ? (
                    <div className="w-full sm:w-[260px] shrink-0">
                      <audio
                        className="w-full h-8"
                        controls
                        onPlay={() => handleTrackPlay(audioKey)}
                        preload="none"
                        ref={(node) => {
                          if (node) {
                            audioRefs.current[audioKey] = node;
                            return;
                          }
                          delete audioRefs.current[audioKey];
                        }}
                        src={track.mediaUrl}
                      />
                    </div>
                  ) : null}

                  <div className="flex justify-end shrink-0">
                    <Button
                      className="h-8 px-2.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={isDeleting}
                      onClick={() => void handleDelete(track)}
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
  );
};

function stripAudioExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "background-music";
}
