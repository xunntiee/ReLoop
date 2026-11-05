import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createMemeEmotion,
  deleteMemeAudio,
  deleteMemeEmotion,
  deleteMemeImage,
  updateMemeEmotionLabel,
  uploadMemeAudio,
  uploadMemeImage,
  type MemeLibraryEntry,
  type UploadedAudioPayload,
  type UploadedImagePayload,
} from "@/lib/api";
import { formatBytes } from "@/lib/formatters";
import {
  Check,
  FolderUp,
  Image as ImageIcon,
  LoaderCircle,
  Music,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";

interface EmotionDefinition {
  description: string;
  id: string;
  label: string;
}

const EMOTIONS: EmotionDefinition[] = [
  {
    description: "Dùng cho phần comment gây sốc, bất ngờ, đứng hình.",
    id: "shock",
    label: "Sốc",
  },
  {
    description: "Dùng cho comment hài, troll, meme vui.",
    id: "funny",
    label: "Hài hước",
  },
  {
    description: "Dùng cho comment cay, gắt, hỗn chiến.",
    id: "angry",
    label: "Tức giận",
  },
  {
    description: "Dùng cho comment buồn, thất vọng, tâm trạng.",
    id: "sad",
    label: "Buồn",
  },
  {
    description: "Dùng cho comment ngỡ ngàng, hoang mang, hỏi chấm.",
    id: "confused",
    label: "Bối rối",
  },
  {
    description: "Dùng cho cảnh over, kịch tính, to be continued.",
    id: "dramatic",
    label: "Kịch tính",
  },
  {
    description: "Dùng cho comment dễ thương, nhẹ nhàng, đáng yêu.",
    id: "cute",
    label: "Dễ thương",
  },
  {
    description: "Dùng cho comment cạn lời, cringe, khó nói nên lời.",
    id: "cringe",
    label: "Cringe",
  },
];

const DIRECTORY_INPUT_PROPS = {
  directory: "",
  webkitdirectory: "",
} as unknown as InputHTMLAttributes<HTMLInputElement>;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "avi", "mkv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);

function toEmotionId(label: string): string {
  return (
    label
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 70) || "emotion"
  );
}

export const MemeTransitionLibrary = ({
  isRefreshing,
  items,
  onRefresh,
}: {
  isRefreshing?: boolean;
  items: MemeLibraryEntry[];
  onRefresh: () => void;
}) => {
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const audioInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [selectedEmotionId, setSelectedEmotionId] = useState<string | null>(null);
  const [editingEmotionId, setEditingEmotionId] = useState<string | null>(null);
  const [emotionLabelDraft, setEmotionLabelDraft] = useState("");
  const [isAddEmotionOpen, setIsAddEmotionOpen] = useState(false);
  const [newEmotionLabel, setNewEmotionLabel] = useState("");
  const [previewImage, setPreviewImage] = useState<UploadedImagePayload | null>(null);
  const [previewAudioId, setPreviewAudioId] = useState<string | null>(null);

  const itemMap = useMemo(
    () => Object.fromEntries(items.map((item) => [item.emotion, item])),
    [items]
  );

  const emotionDefinitions = useMemo(() => {
    const metadata = new Map(EMOTIONS.map((emotion) => [emotion.id, emotion]));
    return [...items]
      .sort((left, right) => {
        const leftIndex = EMOTIONS.findIndex(
          (emotion) => emotion.id === left.emotion
        );
        const rightIndex = EMOTIONS.findIndex(
          (emotion) => emotion.id === right.emotion
        );
        if (leftIndex === -1 && rightIndex === -1) {
          return left.emotion.localeCompare(right.emotion);
        }
        if (leftIndex === -1) {
          return 1;
        }
        if (rightIndex === -1) {
          return -1;
        }
        return leftIndex - rightIndex;
      })
      .map((item) => {
        const known = metadata.get(item.emotion);
        return {
          description:
            known?.description ??
            "Biểu cảm tùy chỉnh. Thêm ảnh meme và âm thanh cho mục này.",
          id: item.emotion,
          label: item.label ?? known?.label ?? item.emotion,
        };
      });
  }, [items]);

  const emotionGroups = useMemo(() => {
    const midpoint = Math.ceil(emotionDefinitions.length / 2);
    return [
      emotionDefinitions.slice(0, midpoint),
      emotionDefinitions.slice(midpoint),
    ].filter((group) => group.length > 0);
  }, [emotionDefinitions]);

  const selectedEmotion = useMemo(
    () =>
      emotionDefinitions.find((emotion) => emotion.id === selectedEmotionId) ??
      null,
    [emotionDefinitions, selectedEmotionId]
  );
  const selectedEmotionLabel = selectedEmotion
    ? itemMap[selectedEmotion.id]?.label ?? selectedEmotion.label
    : "";

  const selectedEntry = selectedEmotion ? itemMap[selectedEmotion.id] : undefined;
  const selectedImages = getImageAssets(selectedEntry);
  const selectedAudios = getAudioAssets(selectedEntry);

  useEffect(() => {
    if (!selectedEmotionId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (previewImage) {
          setPreviewImage(null);
          return;
        }
        setSelectedEmotionId(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [previewImage, selectedEmotionId]);

  const openImagePicker = (emotion: string) => imageInputRefs.current[emotion]?.click();
  const openAudioPicker = (emotion: string) => audioInputRefs.current[emotion]?.click();

  const handlePickedImages = async (
    emotion: string,
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.currentTarget.files ?? []).filter(isImageFile);
    event.currentTarget.value = "";
    if (files.length === 0) {
      return;
    }

    try {
      setError("");
      setBusyKey(`${emotion}:image:upload`);
      for (const file of files) {
        await uploadMemeImage(emotion, file);
      }
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey("");
    }
  };

  const handlePickedAudios = async (
    emotion: string,
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.currentTarget.files ?? []).filter(isAudioFile);
    event.currentTarget.value = "";
    if (files.length === 0) {
      return;
    }

    try {
      setError("");
      setBusyKey(`${emotion}:audio:upload`);
      for (const file of files) {
        await uploadMemeAudio(emotion, file);
      }
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey("");
    }
  };

  const handleDeleteImage = async (emotion: string, serverPath?: string) => {
    try {
      setError("");
      setBusyKey(`${emotion}:image:delete:${serverPath ?? "all"}`);
      await deleteMemeImage(emotion, serverPath);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey("");
    }
  };

  const handleDeleteAudio = async (emotion: string, serverPath?: string) => {
    try {
      setError("");
      setBusyKey(`${emotion}:audio:delete:${serverPath ?? "all"}`);
      await deleteMemeAudio(emotion, serverPath);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey("");
    }
  };

  const beginEmotionLabelEdit = (emotionId: string, currentLabel: string) => {
    setEditingEmotionId(emotionId);
    setEmotionLabelDraft(currentLabel);
  };

  const handleSaveEmotionLabel = async (emotionId: string) => {
    const label = emotionLabelDraft.trim();
    if (!label) {
      setError("Tên cảm xúc không được để trống.");
      return;
    }

    try {
      setError("");
      setBusyKey(`${emotionId}:label:update`);
      await updateMemeEmotionLabel(emotionId, label);
      setEditingEmotionId(null);
      setEmotionLabelDraft("");
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey("");
    }
  };

  const handleCreateEmotion = async () => {
    const label = newEmotionLabel.trim();
    if (!label) {
      setError("Vui lòng nhập tên biểu cảm.");
      return;
    }

    const baseEmotion = toEmotionId(label);
    const existingEmotionIds = new Set(emotionDefinitions.map((emotion) => emotion.id));
    let emotion = baseEmotion;
    let suffix = 2;
    while (existingEmotionIds.has(emotion)) {
      emotion = `${baseEmotion}-${suffix}`;
      suffix += 1;
    }

    try {
      setError("");
      setBusyKey("emotion:create");
      const created = await createMemeEmotion(emotion, label);
      setNewEmotionLabel("");
      setIsAddEmotionOpen(false);
      setSelectedEmotionId(created.emotion);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey("");
    }
  };

  const handleDeleteEmotion = async (
    emotionId: string,
    emotionLabel: string
  ) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Xóa biểu cảm “${emotionLabel}” và toàn bộ ảnh/nhạc bên trong?`
      )
    ) {
      return;
    }

    try {
      setError("");
      setBusyKey(emotionId + ":emotion:delete");
      await deleteMemeEmotion(emotionId);
      if (selectedEmotionId === emotionId) {
        setSelectedEmotionId(null);
      }
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey("");
    }
  };

  return (
    <>
      <Card className="w-full shrink-0">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b px-4 py-3">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold">Thư viện meme theo cảm xúc</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Mỗi cảm xúc có thể lưu nhiều meme (ảnh, GIF hoặc video) và nhiều nhạc meme. Bấm vào từng cảm xúc để xem danh sách.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              onClick={() => setIsAddEmotionOpen((current) => !current)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus className="mr-1.5 size-3.5" />
              Thêm biểu cảm
            </Button>
            <Button className="size-7" onClick={onRefresh} size="icon" type="button" variant="outline">
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-4 pb-4">
          {isAddEmotionOpen ? (
            <div className="mb-4 grid gap-2 rounded-xl border border-dashed bg-muted/20 p-3">
              <div>
                <p className="text-sm font-semibold">Thêm biểu cảm mới</p>
                <p className="text-[11px] text-muted-foreground">
                  Tạo mục trống trước, sau đó chọn mục này để thêm ảnh meme và âm thanh.
                </p>
              </div>
              <div className="grid gap-2">
                <Input
                  maxLength={80}
                  onChange={(event) => setNewEmotionLabel(event.currentTarget.value)}
                  placeholder="Tên biểu cảm, ví dụ: Phấn khích"
                  value={newEmotionLabel}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setIsAddEmotionOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  Hủy
                </Button>
                <Button
                  disabled={busyKey === "emotion:create"}
                  onClick={handleCreateEmotion}
                  type="button"
                >
                  {busyKey === "emotion:create" ? (
                    <LoaderCircle className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 size-4" />
                  )}
                  Tạo biểu cảm
                </Button>
              </div>
            </div>
          ) : null}

          {emotionDefinitions.map((emotion) => (
            <span key={`inputs-${emotion.id}`}>
              <input
                {...DIRECTORY_INPUT_PROPS}
                accept="image/*,video/*"
                className="hidden"
                multiple
                onChange={(e) => void handlePickedImages(emotion.id, e)}
                ref={(node) => {
                  imageInputRefs.current[emotion.id] = node;
                }}
                type="file"
              />
              <input
                {...DIRECTORY_INPUT_PROPS}
                accept="audio/*"
                className="hidden"
                multiple
                onChange={(e) => void handlePickedAudios(emotion.id, e)}
                ref={(node) => {
                  audioInputRefs.current[emotion.id] = node;
                }}
                type="file"
              />
            </span>
          ))}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {emotionGroups.map((group, gi) => (
              <div key={gi} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="grid grid-cols-[minmax(7rem,0.72fr)_minmax(0,1.14fr)_minmax(0,1.14fr)] gap-2 border-b bg-muted/40 px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cảm xúc</span>
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    <ImageIcon className="h-3 w-3" />
                    Meme
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                    <Music className="h-3 w-3" />
                    Âm thanh
                  </span>
                </div>

                {group.map((emotion, idx) => {
                  const entry = itemMap[emotion.id];
                  const emotionLabel = entry?.label ?? emotion.label;
                  const images = getImageAssets(entry);
                  const audios = getAudioAssets(entry);
                  const imageBusy = busyKey.startsWith(`${emotion.id}:image:`);
                  const audioBusy = busyKey.startsWith(`${emotion.id}:audio:`);
                  const coverImage = images[0] ?? null;
                  const coverAudio = audios[0] ?? null;

                  return (
                    <div
                      key={emotion.id}
                      className={`grid grid-cols-[minmax(7rem,0.72fr)_minmax(0,1.14fr)_minmax(0,1.14fr)] gap-2 px-3 py-1.5 ${idx < group.length - 1 ? "border-b" : ""}`}
                    >
                      <div className="flex min-w-0 items-start gap-1">
                        {editingEmotionId === emotion.id ? (
                          <div className="flex min-w-0 flex-1 items-center gap-1">
                            <Input
                              autoFocus
                              className="h-7 min-w-0 px-2 text-[11px]"
                              maxLength={80}
                              onChange={(event) =>
                                setEmotionLabelDraft(event.currentTarget.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleSaveEmotionLabel(emotion.id);
                                }
                                if (event.key === "Escape") {
                                  setEditingEmotionId(null);
                                  setEmotionLabelDraft("");
                                }
                              }}
                              value={emotionLabelDraft}
                            />
                            <Button
                              className="size-7 shrink-0 p-0"
                              disabled={busyKey === `${emotion.id}:label:update`}
                              onClick={() => void handleSaveEmotionLabel(emotion.id)}
                              size="icon"
                              title="Lưu tên cảm xúc"
                              type="button"
                              variant="outline"
                            >
                              {busyKey === `${emotion.id}:label:update` ? (
                                <LoaderCircle className="size-3 animate-spin" />
                              ) : (
                                <Check className="size-3" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setSelectedEmotionId(emotion.id)}
                              className="flex min-w-0 flex-1 items-center rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted/50"
                            >
                              <span className="text-[12px] font-semibold leading-4 text-foreground">{emotionLabel}</span>
                            </button>
                            <Button
                              className="size-7 shrink-0 p-0 text-muted-foreground"
                              onClick={() =>
                                beginEmotionLabelEdit(emotion.id, emotionLabel)
                              }
                              size="icon"
                              title="Đổi tên cảm xúc"
                              type="button"
                              variant="ghost"
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              className="size-7 shrink-0 p-0 text-destructive hover:text-destructive"
                              disabled={busyKey === emotion.id + ":emotion:delete"}
                              onClick={() =>
                                handleDeleteEmotion(emotion.id, emotionLabel)
                              }
                              size="icon"
                              title="Xóa biểu cảm và toàn bộ file"
                              type="button"
                              variant="ghost"
                            >
                              {busyKey === emotion.id + ":emotion:delete" ? (
                                <LoaderCircle className="size-3 animate-spin" />
                              ) : (
                                <Trash2 className="size-3" />
                              )}
                            </Button>
                          </>
                        )}
                      </div>

                      <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50/50 px-2 py-1.5 dark:border-emerald-900 dark:bg-emerald-950/20">
                        {coverImage ? (
                          <button
                            className="h-9 w-9 shrink-0 overflow-hidden rounded-md border-2 border-emerald-200 bg-muted dark:border-emerald-800"
                            onClick={() => setPreviewImage(coverImage)}
                            type="button"
                          >
                            {isVideoAsset(coverImage) ? (
                              <video
                                autoPlay
                                className="h-full w-full object-cover"
                                loop
                                muted
                                playsInline
                                preload="metadata"
                                src={coverImage.mediaUrl}
                              />
                            ) : (
                              <img alt="" className="h-full w-full object-cover" src={coverImage.mediaUrl} />
                            )}
                          </button>
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-emerald-300 text-emerald-500 dark:border-emerald-700">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedEmotionId(emotion.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-[10px] font-medium text-foreground">
                            {coverImage ? coverImage.name : "Chưa có meme"}
                          </p>
                          <p className="text-[9px] text-emerald-700 dark:text-emerald-400">
                            {images.length} ảnh
                          </p>
                        </button>
                        <Button
                          className="h-7 w-7 p-0"
                          disabled={imageBusy}
                          onClick={() => openImagePicker(emotion.id)}
                          size="icon"
                            title="Import thư mục meme, GIF hoặc video"
                          type="button"
                          variant="outline"
                        >
                          {imageBusy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <FolderUp className="h-3 w-3" />}
                        </Button>
                      </div>

                      <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-sky-100 bg-sky-50/50 px-2 py-1.5 dark:border-sky-900 dark:bg-sky-950/20">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950">
                          <Music className="h-4 w-4 text-sky-500" />
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedEmotionId(emotion.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-[10px] font-medium text-foreground">
                            {coverAudio ? coverAudio.name : "Chưa có nhạc meme"}
                          </p>
                          <p className="text-[9px] text-sky-700 dark:text-sky-400">
                            {audios.length} nhạc
                          </p>
                        </button>
                        <Button
                          className="h-7 w-7 p-0"
                          disabled={audioBusy}
                          onClick={() => openAudioPicker(emotion.id)}
                          size="icon"
                          title="Import thư mục nhạc meme"
                          type="button"
                          variant="outline"
                        >
                          {audioBusy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <FolderUp className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {error ? (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {selectedEmotion && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
              onClick={() => setSelectedEmotionId(null)}
            >
              <div
                aria-modal="true"
                className="w-full max-w-5xl rounded-2xl border bg-background shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold">
                      Thư viện meme: {selectedEmotionLabel}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Danh sách được chia làm 2 cột: bên trái là meme (ảnh/GIF/video), bên phải là nhạc meme cho cảm xúc {selectedEmotionLabel}.
                    </p>
                  </div>
                  <Button
                    className="h-8 w-8 p-0"
                    onClick={() => setSelectedEmotionId(null)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
                  <section className="min-h-[420px] rounded-xl border bg-muted/10">
                    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Danh sách meme</h3>
                        <p className="text-xs text-muted-foreground">{selectedImages.length} file</p>
                      </div>
                      <Button
                        disabled={busyKey.startsWith(`${selectedEmotion.id}:image:`)}
                        onClick={() => openImagePicker(selectedEmotion.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {busyKey.startsWith(`${selectedEmotion.id}:image:`) ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <FolderUp className="h-4 w-4" />
                        )}
                        Import meme
                      </Button>
                    </div>
                    <div className="max-h-[520px] space-y-2 overflow-y-auto p-3">
                      {selectedImages.length > 0 ? (
                        selectedImages.map((image) => {
                          const deleting = busyKey === `${selectedEmotion.id}:image:delete:${image.serverPath ?? "unknown"}`;
                          return (
                            <div key={image.serverPath || image.name} className="flex items-center gap-3 rounded-xl border bg-background p-2">
                              <button
                                className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted"
                                onClick={() => setPreviewImage(image)}
                                type="button"
                              >
                                {isVideoAsset(image) ? (
                                  <video
                                    autoPlay
                                    className="h-full w-full object-cover"
                                    loop
                                    muted
                                    playsInline
                                    preload="metadata"
                                    src={image.mediaUrl}
                                  />
                                ) : (
                                  <img alt={image.name} className="h-full w-full object-cover" src={image.mediaUrl} />
                                )}
                              </button>
                              <div className="min-w-0 flex-1">
                                <button
                                  className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                                  onClick={() => setPreviewImage(image)}
                                  type="button"
                                >
                                  {image.name}
                                </button>
                                <p className="text-xs text-muted-foreground">{formatBytes(image.sizeBytes)}</p>
                              </div>
                              <Button
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                disabled={deleting}
                                onClick={() => void handleDeleteImage(selectedEmotion.id, image.serverPath)}
                                size="icon"
                                type="button"
                                variant="ghost"
                              >
                                {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                          Chưa có meme trong cảm xúc này.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="min-h-[420px] rounded-xl border bg-muted/10">
                    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold text-sky-700 dark:text-sky-400">Danh sách nhạc meme</h3>
                        <p className="text-xs text-muted-foreground">{selectedAudios.length} file</p>
                      </div>
                      <Button
                        disabled={busyKey.startsWith(`${selectedEmotion.id}:audio:`)}
                        onClick={() => openAudioPicker(selectedEmotion.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {busyKey.startsWith(`${selectedEmotion.id}:audio:`) ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <FolderUp className="h-4 w-4" />
                        )}
                        Import thư mục
                      </Button>
                    </div>
                    <div className="max-h-[520px] space-y-2 overflow-y-auto p-3">
                      {selectedAudios.length > 0 ? (
                        selectedAudios.map((audio) => {
                          const deleting = busyKey === `${selectedEmotion.id}:audio:delete:${audio.serverPath ?? "unknown"}`;
                          return (
                            <div key={audio.serverPath || audio.name} className="rounded-xl border bg-background p-2">
                              <div className="flex items-center gap-3">
                              <button
                                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border bg-sky-50 text-sky-500 dark:bg-sky-950"
                                onClick={() =>
                                  setPreviewAudioId((current) =>
                                    current === (audio.serverPath || audio.name)
                                      ? null
                                      : (audio.serverPath || audio.name)
                                  )
                                }
                                type="button"
                              >
                                <Play className="h-5 w-5" />
                              </button>
                              <div className="min-w-0 flex-1">
                                <button
                                  className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                                  onClick={() =>
                                    setPreviewAudioId((current) =>
                                      current === (audio.serverPath || audio.name)
                                        ? null
                                        : (audio.serverPath || audio.name)
                                    )
                                  }
                                  type="button"
                                >
                                  {audio.name}
                                </button>
                                <p className="text-xs text-muted-foreground">
                                  {formatBytes(audio.sizeBytes)}
                                  {typeof audio.durationSeconds === "number" && audio.durationSeconds > 0
                                    ? ` · ${audio.durationSeconds.toFixed(1)}s`
                                    : ""}
                                </p>
                              </div>
                              <Button
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                disabled={deleting}
                                onClick={() => void handleDeleteAudio(selectedEmotion.id, audio.serverPath)}
                                size="icon"
                                type="button"
                                variant="ghost"
                              >
                                {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                              </div>
                              {previewAudioId === (audio.serverPath || audio.name) ? (
                                <audio
                                  autoPlay
                                  className="mt-2 w-full"
                                  controls
                                  preload="metadata"
                                  src={audio.mediaUrl}
                                />
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                          Chưa có nhạc meme trong cảm xúc này.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {previewImage && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
              onClick={() => setPreviewImage(null)}
            >
              <div
                className="relative max-h-[92vh] max-w-[92vw] overflow-hidden rounded-2xl bg-background p-2 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  className="absolute right-2 top-2 z-10 h-8 w-8 p-0"
                  onClick={() => setPreviewImage(null)}
                  size="icon"
                  type="button"
                  variant="secondary"
                >
                  <X className="h-4 w-4" />
                </Button>
                {isVideoAsset(previewImage) ? (
                  <video
                    autoPlay
                    className="max-h-[88vh] max-w-[88vw] rounded-xl object-contain"
                    controls
                    loop
                    playsInline
                    src={previewImage.mediaUrl}
                  />
                ) : (
                  <img
                    alt={previewImage.name}
                    className="max-h-[88vh] max-w-[88vw] rounded-xl object-contain"
                    src={previewImage.mediaUrl}
                  />
                )}
                <div className="px-2 pb-1 pt-2 text-sm font-medium">{previewImage.name}</div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
};

function getImageAssets(entry?: MemeLibraryEntry): UploadedImagePayload[] {
  return entry?.images?.length
    ? entry.images
    : entry?.image
      ? [entry.image]
      : [];
}

function getAudioAssets(entry?: MemeLibraryEntry): UploadedAudioPayload[] {
  return entry?.audios?.length
    ? entry.audios
    : entry?.audio
      ? [entry.audio]
      : [];
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
    return true;
  }
  const extension = getFileExtension(file.name);
  return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension);
}

function isVideoAsset(
  asset: Pick<UploadedImagePayload, "name" | "serverPath" | "type">
): boolean {
  return (
    asset.type.startsWith("video/") ||
    VIDEO_EXTENSIONS.has(getFileExtension(asset.name)) ||
    VIDEO_EXTENSIONS.has(getFileExtension(asset.serverPath ?? ""))
  );
}

function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) {
    return true;
  }
  return AUDIO_EXTENSIONS.has(getFileExtension(file.name));
}

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase().trim() ?? "";
}
