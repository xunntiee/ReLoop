import { Download, Upload, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CrawlPost,
  UploadedImagePayload,
  VideoThumbnailFont,
  VideoThumbnailIntro,
  VideoThumbnailLayerId,
  VideoThumbnailLayerLayout,
} from "@/lib/api";
import { uploadCommentAsset } from "@/lib/api";

export const DEFAULT_THUMBNAIL_INTRO: VideoThumbnailIntro = {
  background: null,
  backgroundFit: "cover",
  backgroundPositionX: 50,
  backgroundPositionY: 50,
  backgroundZoom: 1,
  brandImageSizePercent: 92,
  watermarkSizePercent: 19,
  channelName: "",
  channelBold: false,
  channelFont: "geist",
  channelItalic: false,
  channelFontSize: 36,
  durationMs: 1000,
  enabled: true,
  image: null,
  mode: "advanced",
  title: "",
  titleBold: true,
  titleColor: "#741b1b",
  titleFont: "poppins",
  titleFontSize: 42,
  titleItalic: false,
  watermark: null,
  watermarkPosition: "top-right",
  layout: {
    brand: { height: 24, locked: false, visible: true, width: 92, x: 50, y: 70 },
    channel: { height: 8, locked: false, visible: true, width: 72, x: 50, y: 25 },
    layerOrder: ["title", "channel", "brand", "watermark"],
    title: { height: 28, locked: false, visible: true, width: 84, x: 50, y: 34 },
    watermark: { height: 19, locked: false, visible: true, width: 19, x: 88, y: 10 },
  },
};

export function resolveThumbnailIntroForPost(
  thumbnailIntro: VideoThumbnailIntro | null | undefined,
  post?: CrawlPost
): VideoThumbnailIntro | null {
  if (!thumbnailIntro) {
    return null;
  }

  if (!post) {
    return thumbnailIntro;
  }

  const postOverride = thumbnailIntro.postOverridesByPostId?.[post.post_id];
  const {
    titleOverridesByPostId: _postTitleOverrides,
    ...postConfig
  } = postOverride ?? {};

  return {
    ...thumbnailIntro,
    ...postConfig,
    title:
      postOverride?.title ??
      thumbnailIntro.titleOverridesByPostId?.[post.post_id] ??
      post.text.slice(0, 160),
  };
}

const DEFAULT_THUMBNAIL_LAYER_LAYOUT: Record<
  VideoThumbnailLayerId,
  VideoThumbnailLayerLayout
> = {
  brand: { height: 24, locked: false, visible: true, width: 92, x: 50, y: 70 },
  channel: { height: 8, locked: false, visible: true, width: 72, x: 50, y: 25 },
  title: { height: 28, locked: false, visible: true, width: 84, x: 50, y: 34 },
  watermark: { height: 19, locked: false, visible: true, width: 19, x: 88, y: 10 },
};

const MIN_THUMBNAIL_LAYER_SIZE: Record<
  VideoThumbnailLayerId,
  { height: number; width: number }
> = {
  brand: { height: 10, width: 20 },
  channel: { height: 6, width: 24 },
  title: { height: 16, width: 36 },
  watermark: { height: 8, width: 8 },
};

const THUMBNAIL_FONT_OPTIONS: Array<{
  value: VideoThumbnailFont;
  label: string;
}> = [
  { value: "beVietnam", label: "Be Vietnam Pro · tiếng Việt" },
  { value: "geist", label: "Geist · hiện đại" },
  { value: "notoSans", label: "Noto Sans · dễ đọc" },
  { value: "roboto", label: "Roboto · rõ nét" },
  { value: "montserrat", label: "Montserrat · nổi bật" },
  { value: "poppins", label: "Poppins · hiện đại" },
  { value: "oswald", label: "Oswald · cao, mạnh" },
  { value: "trebuchet", label: "Trebuchet" },
  { value: "verdana", label: "Verdana" },
  { value: "georgia", label: "Georgia" },
  { value: "mono", label: "Mono" },
];

const THUMBNAIL_CHANNEL_NAME_STORAGE_KEY =
  "toolbase.video.thumbnail.channel-name";
const THUMBNAIL_DOWNLOAD_WIDTH = 1080;
const THUMBNAIL_DOWNLOAD_HEIGHT = 1432;
const THUMBNAIL_DURATION_OPTIONS = [100, 250, 500, 1000] as const;
const DEFAULT_THUMBNAIL_DURATION_MS = 1000;
const THUMBNAIL_ROOT_TAG_PATTERN = /^<div\b/i;

const normalizeThumbnailDurationMs = (durationMs: unknown): number => {
  const value = Number(durationMs);
  return THUMBNAIL_DURATION_OPTIONS.includes(value as (typeof THUMBNAIL_DURATION_OPTIONS)[number])
    ? value
    : DEFAULT_THUMBNAIL_DURATION_MS;
};

const normalizeThumbnailFontSize = (
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numericValue)));
};

export const getSavedThumbnailChannelName = (): string => {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return (
      window.localStorage.getItem(THUMBNAIL_CHANNEL_NAME_STORAGE_KEY)?.trim() ??
      ""
    );
  } catch {
    return "";
  }
};

const saveThumbnailChannelName = (value: string) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const normalized = value.trim();
    if (normalized) {
      window.localStorage.setItem(
        THUMBNAIL_CHANNEL_NAME_STORAGE_KEY,
        normalized
      );
    } else {
      window.localStorage.removeItem(THUMBNAIL_CHANNEL_NAME_STORAGE_KEY);
    }
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

const safeThumbnailFilename = (value: string) => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "thumbnail";
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được ảnh."));
    reader.readAsDataURL(blob);
  });

const inlineComputedStyles = (
  source: HTMLElement,
  target: HTMLElement
): void => {
  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const targetElements = [target, ...target.querySelectorAll<HTMLElement>("*")];
  for (const [index, sourceElement] of sourceElements.entries()) {
    const targetElement = targetElements[index];
    if (!targetElement) {
      continue;
    }
    const computed = window.getComputedStyle(sourceElement);
    const styles = Array.from(computed)
      .map(
        (property) =>
          `${property}:${computed.getPropertyValue(property)};`
      )
      .join("");
    targetElement.setAttribute("style", styles);
  }
};

const downloadThumbnailPreviewDom = async (
  source: HTMLDivElement | null,
  filename: string
): Promise<void> => {
  if (!source) {
    throw new Error("Chưa có preview thumbnail để tải.");
  }

  const bounds = source.getBoundingClientRect();
  if (!(bounds.width > 0 && bounds.height > 0)) {
    throw new Error("Preview thumbnail chưa sẵn sàng.");
  }

  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  const clone = source.cloneNode(true) as HTMLDivElement;
  inlineComputedStyles(source, clone);
  for (const element of clone.querySelectorAll<HTMLElement>(
    "[data-thumbnail-export-ignore]"
  )) {
    element.remove();
  }

  Object.assign(clone.style, {
    border: "0",
    borderRadius: "0",
    boxShadow: "none",
    height: `${height}px`,
    maxHeight: "none",
    maxWidth: "none",
    width: `${width}px`,
  });

  await Promise.all(
    Array.from(clone.querySelectorAll<HTMLImageElement>("img")).map(
      async (image) => {
        const imageUrl = image.currentSrc || image.src;
        if (!imageUrl || imageUrl.startsWith("data:")) {
          return;
        }
        try {
          const response = await fetch(imageUrl);
          if (response.ok) {
            image.src = await blobToDataUrl(await response.blob());
          }
        } catch {
          // Keep an external URL if the browser blocks fetching it.
        }
      }
    )
  );

  const cloneMarkup = clone.outerHTML.replace(
    THUMBNAIL_ROOT_TAG_PATTERN,
    '<div xmlns="http://www.w3.org/1999/xhtml"'
  );
  const scaleX = THUMBNAIL_DOWNLOAD_WIDTH / width;
  const scaleY = THUMBNAIL_DOWNLOAD_HEIGHT / height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_DOWNLOAD_WIDTH}" height="${THUMBNAIL_DOWNLOAD_HEIGHT}" viewBox="0 0 ${THUMBNAIL_DOWNLOAD_WIDTH} ${THUMBNAIL_DOWNLOAD_HEIGHT}"><g transform="scale(${scaleX} ${scaleY})"><foreignObject width="${width}" height="${height}">${cloneMarkup}</foreignObject></g></svg>`;
  const svgUrl = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  );

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = svgUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Không tạo được ảnh thumbnail."));
    });

    const canvas = document.createElement("canvas");
    canvas.width = THUMBNAIL_DOWNLOAD_WIDTH;
    canvas.height = THUMBNAIL_DOWNLOAD_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Trình duyệt không hỗ trợ xuất ảnh thumbnail.");
    }
    context.drawImage(
      image,
      0,
      0,
      THUMBNAIL_DOWNLOAD_WIDTH,
      THUMBNAIL_DOWNLOAD_HEIGHT
    );

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!pngBlob) {
      throw new Error("Không tạo được file PNG thumbnail.");
    }
    const downloadUrl = URL.createObjectURL(pngBlob);
    const link = document.createElement("a");
    link.download = filename;
    link.href = downloadUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
};

const resolveThumbnailAssetUrl = (
  asset?: UploadedImagePayload | null
): string =>
  asset?.serverPath ? `/media/${asset.serverPath}` : (asset?.mediaUrl ?? "");

const loadThumbnailImage = (
  assetUrl: string,
  assetName: string
): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Không đọc được ảnh ${assetName}.`));
    image.src = assetUrl;
  });

const loadThumbnailAsset = async (
  asset?: UploadedImagePayload | null
): Promise<HTMLImageElement | null> => {
  const assetUrl = resolveThumbnailAssetUrl(asset);
  if (!assetUrl) {
    return null;
  }
  const assetName = asset?.name ?? "thumbnail";
  if (
    assetUrl.startsWith("/") ||
    assetUrl.startsWith("blob:") ||
    assetUrl.startsWith("data:")
  ) {
    return loadThumbnailImage(assetUrl, assetName);
  }

  let response: Response;
  try {
    response = await fetch(assetUrl);
  } catch {
    throw new Error(
      `Không kết nối được đến ảnh ${assetName}. Hãy kiểm tra Tool Base vẫn đang chạy rồi thử lại.`
    );
  }
  if (!response.ok) {
    throw new Error(`Không tải được ảnh ${assetName}.`);
  }
  return loadThumbnailImage(
    await blobToDataUrl(await response.blob()),
    assetName
  );
};

const drawCoverThumbnailAsset = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  positionX = 50,
  positionY = 50,
  zoom = 1
) => {
  const baseScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const baseWidth = image.naturalWidth * baseScale;
  const baseHeight = image.naturalHeight * baseScale;
  const drawWidth = baseWidth * zoom;
  const drawHeight = baseHeight * zoom;
  // Match the DOM preview: object-position is applied before the image element
  // is scaled around the centre by transform: scale(...).
  const objectX = (width - baseWidth) * (positionX / 100);
  const objectY = (height - baseHeight) * (positionY / 100);
  context.drawImage(
    image,
    x + width / 2 + (objectX - width / 2) * zoom,
    y + height / 2 + (objectY - height / 2) * zoom,
    drawWidth,
    drawHeight
  );
};

const drawContainThumbnailAsset = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
};

const wrapThumbnailText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
};

const drawThumbnailLayer = (
  context: CanvasRenderingContext2D,
  layer: VideoThumbnailLayerLayout,
  drawContent: (width: number, height: number) => void
) => {
  if (layer.visible === false) {
    return;
  }
  const width = (THUMBNAIL_DOWNLOAD_WIDTH * layer.width) / 100;
  const height = (THUMBNAIL_DOWNLOAD_HEIGHT * layer.height) / 100;
  context.save();
  context.translate(
    (THUMBNAIL_DOWNLOAD_WIDTH * layer.x) / 100,
    (THUMBNAIL_DOWNLOAD_HEIGHT * layer.y) / 100
  );
  context.rotate(((layer.rotation ?? 0) * Math.PI) / 180);
  drawContent(width, height);
  context.restore();
};

const downloadThumbnailCanvas = async (
  config: VideoThumbnailIntro,
  mode: "automatic" | "advanced",
  filename: string,
  fallbackSource?: HTMLDivElement | null
): Promise<void> => {
  const [background, cardImage, brandImage, watermark] = await Promise.all([
    loadThumbnailAsset(config.background),
    loadThumbnailAsset(config.image),
    loadThumbnailAsset(config.brandImage),
    loadThumbnailAsset(config.watermark),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_DOWNLOAD_WIDTH;
  canvas.height = THUMBNAIL_DOWNLOAD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    return downloadThumbnailPreviewDom(fallbackSource ?? null, filename);
  }

  if (background) {
    drawCoverThumbnailAsset(
      context,
      background,
      0,
      0,
      THUMBNAIL_DOWNLOAD_WIDTH,
      THUMBNAIL_DOWNLOAD_HEIGHT,
      config.backgroundPositionX ?? 50,
      config.backgroundPositionY ?? 50,
      config.backgroundZoom ?? 1
    );
  } else {
    const gradient = context.createRadialGradient(0, 0, 0, 560, 720, 1500);
    gradient.addColorStop(0, "#7ec8ff");
    gradient.addColorStop(0.38, "#2c203e");
    gradient.addColorStop(0.7, "#140b16");
    gradient.addColorStop(1, "#070707");
    context.fillStyle = gradient;
    context.fillRect(0, 0, THUMBNAIL_DOWNLOAD_WIDTH, THUMBNAIL_DOWNLOAD_HEIGHT);
  }
  context.fillStyle = "rgba(0, 0, 0, 0.1)";
  context.fillRect(0, 0, THUMBNAIL_DOWNLOAD_WIDTH, THUMBNAIL_DOWNLOAD_HEIGHT);

  for (const layerId of resolveThumbnailLayerOrder(config)) {
    if (layerId === "title") {
      const layer = resolveThumbnailLayerLayout(config, "title");
      drawThumbnailLayer(context, layer, (layerWidth) => {
        const padding = THUMBNAIL_DOWNLOAD_WIDTH * 0.06;
        const contentWidth = Math.max(1, layerWidth - padding * 2);
        const titleSize = Math.min(120, Math.max(28, config.titleFontSize ?? 42)) * 2.16;
        context.font = `${config.titleItalic ? "italic " : ""}${config.titleBold === false ? 500 : 900} ${titleSize}px ${resolveTitleFont(config.titleFont)}`;
        const titleLines = wrapThumbnailText(context, config.title || "Tiêu đề video", contentWidth);
        const titleLineHeight = titleSize * 1.08;
        const subtitleSize = THUMBNAIL_DOWNLOAD_WIDTH * 0.045;
        const subtitleLines = config.subtitle ? wrapThumbnailText(context, config.subtitle, contentWidth) : [];
        const imageHeight = cardImage ? Math.min(THUMBNAIL_DOWNLOAD_WIDTH * 0.45, contentWidth * cardImage.naturalHeight / cardImage.naturalWidth) : 0;
        const imageGap = cardImage ? THUMBNAIL_DOWNLOAD_WIDTH * 0.045 : 0;
        const subtitleGap = subtitleLines.length > 0 ? THUMBNAIL_DOWNLOAD_WIDTH * 0.03 : 0;
        const totalHeight = imageHeight + imageGap + titleLines.length * titleLineHeight + subtitleGap + subtitleLines.length * subtitleSize * 1.2;
        let cursor = -totalHeight / 2;
        if (cardImage && imageHeight > 0) {
          context.save();
          context.beginPath();
          context.roundRect(-contentWidth / 2, cursor, contentWidth, imageHeight, THUMBNAIL_DOWNLOAD_WIDTH * 0.03);
          context.clip();
          drawCoverThumbnailAsset(context, cardImage, -contentWidth / 2, cursor, contentWidth, imageHeight);
          context.restore();
          cursor += imageHeight + imageGap;
        }
        context.fillStyle = config.titleColor ?? "#741b1b";
        context.textAlign = "center";
        context.textBaseline = "top";
        for (const line of titleLines) {
          context.fillText(line, 0, cursor, contentWidth);
          cursor += titleLineHeight;
        }
        if (subtitleLines.length > 0) {
          cursor += subtitleGap;
          context.font = `${subtitleSize}px ${resolveTitleFont(config.titleFont)}`;
          context.fillStyle = mode === "automatic" ? "rgba(6, 78, 59, 0.7)" : "rgba(131, 24, 67, 0.7)";
          for (const line of subtitleLines) {
            context.fillText(line, 0, cursor, contentWidth);
            cursor += subtitleSize * 1.2;
          }
        }
      });
    } else if (layerId === "channel" && config.channelName) {
      const layer = resolveThumbnailLayerLayout(config, "channel");
      const channelName = config.channelName;
      drawThumbnailLayer(context, layer, (layerWidth) => {
        const fontSize = Math.min(72, Math.max(16, config.channelFontSize ?? 36)) * 2.16;
        context.font = `${config.channelItalic ? "italic " : ""}${config.channelBold ? 700 : 500} ${fontSize}px ${resolveTitleFont(config.channelFont ?? "geist")}`;
        context.fillStyle = config.channelColor ?? (mode === "automatic" ? "#14532d" : "#831843");
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(channelName, 0, 0, layerWidth);
      });
    } else if (layerId === "brand" && brandImage) {
      const layer = resolveThumbnailLayerLayout(config, "brand");
      drawThumbnailLayer(context, layer, (layerWidth, layerHeight) => {
        drawContainThumbnailAsset(context, brandImage, -layerWidth / 2, -layerHeight / 2, layerWidth, layerHeight);
      });
    } else if (layerId === "watermark" && watermark) {
      const layer = resolveThumbnailLayerLayout(config, "watermark");
      const size = (THUMBNAIL_DOWNLOAD_WIDTH * Math.min(layer.width, layer.height)) / 100;
      drawThumbnailLayer(context, { ...layer, width: (size * 100) / THUMBNAIL_DOWNLOAD_WIDTH, height: (size * 100) / THUMBNAIL_DOWNLOAD_WIDTH }, () => {
        context.save();
        context.beginPath();
        context.arc(0, 0, size / 2, 0, Math.PI * 2);
        context.clip();
        drawCoverThumbnailAsset(context, watermark, -size / 2, -size / 2, size, size);
        context.restore();
      });
    }
  }

  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!pngBlob) {
      return downloadThumbnailPreviewDom(fallbackSource ?? null, filename);
  }
  const downloadUrl = URL.createObjectURL(pngBlob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = downloadUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
};

export const VideoThumbnailEditor = ({
  mode = "advanced",
  onChange,
  post,
  value,
}: {
  mode?: "automatic" | "advanced";
  onChange: (value: VideoThumbnailIntro | null) => void;
  post?: CrawlPost;
  value: VideoThumbnailIntro | null;
}) => {
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [draftTitleColor, setDraftTitleColor] = useState(
    DEFAULT_THUMBNAIL_INTRO.titleColor ?? "#741b1b"
  );
  const [draftChannelColor, setDraftChannelColor] = useState(
    mode === "automatic" ? "#14532d" : "#831843"
  );
  const brandInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const watermarkInputRef = useRef<HTMLInputElement | null>(null);
  const channelInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const thumbnailCanvasRef = useRef<HTMLDivElement | null>(null);
  const titleColorCommitTimerRef = useRef<number | null>(null);
  const channelColorCommitTimerRef = useRef<number | null>(null);
  const didMigrateTitleSizeRef = useRef(false);
  const configValue = value ?? {
    ...DEFAULT_THUMBNAIL_INTRO,
    channelName: getSavedThumbnailChannelName(),
    title: post?.text ?? "Tiêu đề video",
  };
  const config = {
    ...configValue,
    channelFontSize: normalizeThumbnailFontSize(
      configValue.channelFontSize,
      16,
      72,
      36
    ),
    durationMs: normalizeThumbnailDurationMs(configValue.durationMs),
    titleFontSize: normalizeThumbnailFontSize(
      configValue.titleFontSize,
      28,
      120,
      42
    ),
  };

  useEffect(() => {
    if (
      value &&
      (value.channelFontSize !== config.channelFontSize ||
        value.durationMs !== config.durationMs ||
        value.titleFontSize !== config.titleFontSize)
    ) {
      onChange({
        ...value,
        channelFontSize: config.channelFontSize,
        durationMs: config.durationMs,
        titleFontSize: config.titleFontSize,
      });
    }
  }, [
    config.channelFontSize,
    config.durationMs,
    config.titleFontSize,
    onChange,
    value,
  ]);

  useEffect(() => {
    setDraftTitleColor(
      config.titleColor ?? DEFAULT_THUMBNAIL_INTRO.titleColor ?? "#741b1b"
    );
  }, [config.titleColor]);

  useEffect(() => {
    setDraftChannelColor(
      config.channelColor ?? (mode === "automatic" ? "#14532d" : "#831843")
    );
  }, [config.channelColor, mode]);

  useEffect(() => {
    if (didMigrateTitleSizeRef.current || !value) return;
    didMigrateTitleSizeRef.current = true;
    if (value.titleFontSize === 50) {
      onChange({ ...value, titleFontSize: 42 });
    }
  }, [onChange, value]);

  useEffect(
    () => () => {
      if (titleColorCommitTimerRef.current !== null) {
        window.clearTimeout(titleColorCommitTimerRef.current);
      }
      if (channelColorCommitTimerRef.current !== null) {
        window.clearTimeout(channelColorCommitTimerRef.current);
      }
    },
    []
  );

  let imageUrl = "";
  if (config.image?.mediaUrl) {
    imageUrl = config.image.mediaUrl;
  } else if (config.image?.serverPath) {
    imageUrl = `/media/${config.image.serverPath}`;
  }
  let brandImageUrl = "";
  if (config.brandImage?.mediaUrl) {
    brandImageUrl = config.brandImage.mediaUrl;
  } else if (config.brandImage?.serverPath) {
    brandImageUrl = `/media/${config.brandImage.serverPath}`;
  }
  let watermarkUrl = "";
  if (config.watermark?.mediaUrl) {
    watermarkUrl = config.watermark.mediaUrl;
  } else if (config.watermark?.serverPath) {
    watermarkUrl = "/media/" + config.watermark.serverPath;
  }
  const update = (patch: Partial<VideoThumbnailIntro>) => {
    onChange({ ...config, ...patch });
  };
  const accentBorderClass =
    mode === "automatic"
      ? "border-emerald-500/45"
      : "border-pink-500/45";
  const handleChannelNameChange = (channelName: string) => {
    saveThumbnailChannelName(channelName);
    update({ channelName });
  };
  const applyTitleColor = (color: string, immediately = false) => {
    setDraftTitleColor(color);
    if (titleColorCommitTimerRef.current !== null) {
      window.clearTimeout(titleColorCommitTimerRef.current);
      titleColorCommitTimerRef.current = null;
    }

    if (immediately) {
      if (config.titleColor !== color) {
        update({ titleColor: color });
      }
      return;
    }

    titleColorCommitTimerRef.current = window.setTimeout(() => {
      titleColorCommitTimerRef.current = null;
      if (config.titleColor !== color) {
        update({ titleColor: color });
      }
    }, 120);
  };

  const applyChannelColor = (color: string, immediately = false) => {
    setDraftChannelColor(color);
    if (channelColorCommitTimerRef.current !== null) {
      window.clearTimeout(channelColorCommitTimerRef.current);
      channelColorCommitTimerRef.current = null;
    }

    if (immediately) {
      if (config.channelColor !== color) {
        update({ channelColor: color });
      }
      return;
    }

    channelColorCommitTimerRef.current = window.setTimeout(() => {
      channelColorCommitTimerRef.current = null;
      if (config.channelColor !== color) {
        update({ channelColor: color });
      }
    }, 120);
  };

  const handleUpload = async (
    file: File,
    target: "background" | "brand" | "watermark"
  ) => {
    try {
      setUploading(true);
      const result = await uploadCommentAsset(
        file,
        `thumbnail-${file.name}`,
        target === "brand"
      );
      const uploaded = result.asset as UploadedImagePayload;
      update(
        target === "background"
          ? { background: uploaded, backgroundFit: "cover", backgroundZoom: 1 }
          : target === "brand"
            ? { brandImage: uploaded }
            : { watermark: uploaded }
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const filename = `thumbnail-${safeThumbnailFilename(
        post?.text ?? config.title
      )}.png`;
      await downloadThumbnailCanvas(
        config,
        mode,
        filename,
        thumbnailCanvasRef.current
      );
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Không tải được thumbnail."
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className={[
        "mx-auto flex h-full w-full max-w-[22rem] flex-col gap-2 overflow-y-auto rounded-2xl border bg-background/90 p-3 shadow-xl",
        accentBorderClass,
      ].join(" ")}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b pb-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm">Chỉnh thumbnail đầu video</p>
        </div>
        <button
          aria-label={config.enabled ? "Tắt thumbnail đầu video" : "Bật thumbnail đầu video"}
          aria-pressed={config.enabled}
          className={[
            "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50",
            config.enabled
              ? mode === "automatic"
                ? "bg-emerald-500"
                : "bg-pink-500"
              : "bg-muted-foreground/35",
          ].join(" ")}
          onClick={() => update({ enabled: !config.enabled })}
          type="button"
        >
          <span
            className={[
              "size-5 rounded-full bg-white shadow-sm transition-transform",
              config.enabled ? "translate-x-5" : "translate-x-0",
            ].join(" ")}
          />
        </button>
      </div>

      <InteractiveThumbnailCanvas
        brandImageUrl={brandImageUrl}
        canvasRef={thumbnailCanvasRef}
        config={config}
        imageUrl={imageUrl}
        mode={mode}
        onChange={onChange}
        watermarkUrl={watermarkUrl}
      />

      <Button
        className="w-full"
        disabled={downloading}
        onClick={handleDownload}
        type="button"
        variant="outline"
      >
        <Download className="mr-1.5 size-4" />
        {downloading ? "Đang tải thumbnail..." : "Tải ảnh thumbnail về"}
      </Button>
      {downloadError ? (
        <p className="text-[11px] text-destructive">{downloadError}</p>
      ) : null}

      <div className="grid gap-2 rounded-md border border-dashed px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-xs">Ảnh background thumbnail</p>
          </div>
          <Button
            className="h-9 shrink-0"
            disabled={uploading}
            onClick={() => backgroundInputRef.current?.click()}
            type="button"
            variant="outline"
          >
            <Upload className="mr-1 size-4" />
            Import ảnh
          </Button>
        </div>
        <input
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) {
              await handleUpload(file, "background");
            }
            event.target.value = "";
          }}
          ref={backgroundInputRef}
          type="file"
        />
        <UploadedImagePreview
          asset={config.background}
          label="Background thumbnail"
          onRemove={() => update({ background: null })}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-2">
        <label className="grid min-w-0 gap-1" htmlFor="thumbnail-channel">
          <span className="font-medium text-muted-foreground text-xs">
            Tên kênh / fanpage
          </span>
          <Input
            className="h-9"
            id="thumbnail-channel"
            maxLength={80}
            onChange={(event) => handleChannelNameChange(event.target.value)}
            placeholder="Ví dụ: Ghiền đọc comment"
            ref={channelInputRef}
            value={config.channelName ?? ""}
          />
        </label>
        <label className="grid gap-1" htmlFor="thumbnail-channel-font-size">
          <span className="font-medium text-muted-foreground text-xs">
            Size tên
          </span>
          <Input
            className="h-9"
            id="thumbnail-channel-font-size"
            max={72}
            min={16}
            onChange={(event) =>
              update({
                channelFontSize: normalizeThumbnailFontSize(
                  event.target.value,
                  16,
                  72,
                  36
                ),
              })
            }
            type="number"
            value={config.channelFontSize ?? 36}
          />
        </label>
      </div>

      <label
        className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2 py-1.5"
        htmlFor="thumbnail-channel-color"
      >
        <span className="font-medium text-muted-foreground text-xs">
          Màu tên kênh
        </span>
        <input
          className="h-8 w-14 cursor-pointer rounded border bg-transparent p-0.5"
          id="thumbnail-channel-color"
          onBlur={() => applyChannelColor(draftChannelColor, true)}
          onChange={(event) => applyChannelColor(event.target.value)}
          type="color"
          value={draftChannelColor}
        />
      </label>

      <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-end gap-2">
        <label className="grid min-w-0 gap-1" htmlFor="thumbnail-channel-font">
          <span className="font-medium text-muted-foreground text-xs">
            Font tên kênh
          </span>
          <select
            className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
            id="thumbnail-channel-font"
            onChange={(event) =>
              update({ channelFont: event.target.value as VideoThumbnailFont })
            }
            value={normalizeTitleFont(config.channelFont ?? "geist")}
          >
            {THUMBNAIL_FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-1">
          <button
            aria-label="Tên kênh đậm"
            aria-pressed={config.channelBold === true}
            className={[
              "h-9 rounded-md border font-bold text-sm",
              config.channelBold === true
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground",
            ].join(" ")}
            onClick={() => update({ channelBold: config.channelBold !== true })}
            type="button"
          >
            B
          </button>
          <button
            aria-label="Tên kênh nghiêng"
            aria-pressed={config.channelItalic === true}
            className={[
              "h-9 rounded-md border font-serif text-sm italic",
              config.channelItalic === true
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground",
            ].join(" ")}
            onClick={() => update({ channelItalic: config.channelItalic !== true })}
            type="button"
          >
            I
          </button>
        </div>
      </div>

      <label className="grid gap-1" htmlFor="thumbnail-title">
        <span className="font-medium text-muted-foreground text-xs">
          Tiêu đề
        </span>
        <textarea
          className="min-h-20 resize-y rounded-md border bg-background px-2 py-1.5 text-sm"
          id="thumbnail-title"
          maxLength={160}
          onChange={(event) => update({ title: event.target.value })}
          ref={titleInputRef}
          value={config.title}
        />
      </label>

      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-2">
        <label className="grid min-w-0 gap-1" htmlFor="thumbnail-font">
          <span className="font-medium text-muted-foreground text-xs">
            Font tiêu đề
          </span>
          <select
            className="h-9 min-w-0 max-w-full rounded-md border bg-background px-2 text-sm"
            id="thumbnail-font"
            onChange={(event) =>
              update({
                titleFont: event.target
                  .value as VideoThumbnailIntro["titleFont"],
              })
            }
            value={normalizeTitleFont(config.titleFont)}
          >
            {THUMBNAIL_FONT_OPTIONS.map((font) => (
              <option key={`title-${font.value}`} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1" htmlFor="thumbnail-font-size">
          <span className="font-medium text-muted-foreground text-xs">
            Size
          </span>
          <Input
            className="h-9 min-w-0"
            id="thumbnail-font-size"
            max={120}
            min={28}
            onChange={(event) =>
              update({
                titleFontSize: normalizeThumbnailFontSize(
                  event.target.value,
                  28,
                  120,
                  42
                ),
              })
            }
            type="number"
            value={config.titleFontSize ?? 42}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          aria-label="Tiêu đề đậm"
          aria-pressed={config.titleBold !== false}
          className={[
            "h-9 rounded-md border font-bold text-sm",
            config.titleBold !== false
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground",
          ].join(" ")}
          onClick={() => update({ titleBold: config.titleBold === false })}
          type="button"
        >
          B
        </button>
        <button
          aria-label="Tiêu đề nghiêng"
          aria-pressed={config.titleItalic === true}
          className={[
            "h-9 rounded-md border font-serif text-sm italic",
            config.titleItalic === true
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground",
          ].join(" ")}
          onClick={() => update({ titleItalic: config.titleItalic !== true })}
          type="button"
        >
          I
        </button>
      </div>

      <label
        className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2 py-1.5"
        htmlFor="thumbnail-title-color"
      >
        <span className="font-medium text-muted-foreground text-xs">
          Màu tiêu đề
        </span>
        <input
          className="h-8 w-14 cursor-pointer rounded border bg-transparent p-0.5"
          id="thumbnail-title-color"
          onBlur={() => applyTitleColor(draftTitleColor, true)}
          onChange={(event) => applyTitleColor(event.target.value)}
          type="color"
          value={draftTitleColor}
        />
      </label>

      <div className="grid grid-cols-1 gap-2">
        <label className="grid min-w-0 gap-1" htmlFor="thumbnail-duration">
          <span className="font-medium text-muted-foreground text-xs">
            Thời lượng
          </span>
          <select
            className="h-9 w-full min-w-0 max-w-full rounded-md border bg-background px-2 text-sm"
            id="thumbnail-duration"
            onChange={(event) =>
              update({ durationMs: Number(event.target.value) })
            }
            value={config.durationMs}
          >
            {THUMBNAIL_DURATION_OPTIONS.map((durationMs) => (
              <option key={durationMs} value={durationMs}>
                {durationMs / 1000} giây
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-1.5">
        <UploadedImagePreview
          asset={config.image}
          label="Ảnh card trong thumbnail"
          onRemove={() => update({ image: null })}
        />
      </div>

      <div className="grid gap-2 rounded-md border border-dashed px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-xs">
              Ảnh meme / thương hiệu dưới title
            </p>
            <p className="text-[11px] text-muted-foreground">
              Tự tách nền trắng/caro khi tải ảnh lên
            </p>
          </div>
          <Button
            className="h-9 shrink-0"
            disabled={uploading}
            onClick={() => brandInputRef.current?.click()}
            type="button"
            variant="outline"
          >
            <Upload className="mr-1 size-4" />
            Chọn ảnh
          </Button>
        </div>
        <input
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) {
              await handleUpload(file, "brand");
            }
            event.target.value = "";
          }}
          ref={brandInputRef}
          type="file"
        />
        <UploadedImagePreview
          asset={config.brandImage}
          label="Ảnh thương hiệu dưới tiêu đề"
          onRemove={() => update({ brandImage: null })}
        />
      </div>
      <div className="grid gap-2 rounded-md border border-dashed px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-xs">Watermark trên thumbnail</p>
          </div>
          <Button
            className="h-9 shrink-0"
            disabled={uploading}
            onClick={() => watermarkInputRef.current?.click()}
            type="button"
            variant="outline"
          >
            <Upload className="mr-1 size-4" />
            Chọn ảnh
          </Button>
        </div>
        <input
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) {
              await handleUpload(file, "watermark");
            }
            event.target.value = "";
          }}
          ref={watermarkInputRef}
          type="file"
        />
        <label className="hidden" htmlFor="thumbnail-watermark-position">
          <span className="font-medium text-muted-foreground text-xs">
            Vị trí watermark
          </span>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            id="thumbnail-watermark-position"
            onChange={(event) =>
              update({
                watermarkPosition:
                  event.target.value as VideoThumbnailIntro["watermarkPosition"],
              })
            }
          value={config.watermarkPosition ?? "top-right"}
        >
          <option value="top-left">Trên trái</option>
          <option value="top-right">Trên phải</option>
          <option value="bottom-left">Dưới trái</option>
          <option value="bottom-right">Dưới phải</option>
          <option value="center">Chính giữa</option>
        </select>
       </label>
        <label className="hidden" htmlFor="thumbnail-watermark-size">
          <span className="font-medium text-muted-foreground text-xs">Kích thước watermark</span>
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2">
          </div>
        </label>
        <UploadedImagePreview
          asset={config.watermark}
          label="Watermark thumbnail"
          onRemove={() => update({ watermark: null })}
        />
      </div>
    </div>
  );
};

const UploadedImagePreview = ({
  asset,
  label,
  onRemove,
}: {
  asset?: UploadedImagePayload | null;
  label: string;
  onRemove: () => void;
}) => {
  let imageUrl = asset?.mediaUrl ?? "";
  if (!imageUrl && asset?.serverPath) {
    imageUrl = `/media/${asset.serverPath}`;
  }

  if (!(asset && imageUrl)) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/20 p-1.5">
      <img
        alt=""
        className="size-10 shrink-0 rounded object-cover"
        height={40}
        src={imageUrl}
        width={40}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[11px]">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {asset.name}
        </p>
      </div>
      <Button
        aria-label={label}
        className="size-7 shrink-0 p-0"
        onClick={onRemove}
        type="button"
        variant="ghost"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
};

const resolveThumbnailLayerLayout = (
  config: VideoThumbnailIntro,
  id: VideoThumbnailLayerId
): VideoThumbnailLayerLayout => {
  const minimum = MIN_THUMBNAIL_LAYER_SIZE[id];
  const layer = {
    ...DEFAULT_THUMBNAIL_LAYER_LAYOUT[id],
    ...config.layout?.[id],
  };
  return {
    ...layer,
    height: Math.min(95, Math.max(minimum.height, layer.height)),
    width: Math.min(95, Math.max(minimum.width, layer.width)),
  };
};

const resolveThumbnailLayerOrder = (config: VideoThumbnailIntro): VideoThumbnailLayerId[] => {
  const order = config.layout?.layerOrder ?? ["title", "channel", "brand", "watermark"];
  return [
    ...order,
    ...(["title", "channel", "brand", "watermark"] as VideoThumbnailLayerId[]).filter(
      (id) => !order.includes(id)
    ),
  ];
};


const InteractiveThumbnailCanvas = ({
  brandImageUrl,
  canvasRef,
  config,
  imageUrl,
  mode,
  onChange,
  watermarkUrl,
}: {
  brandImageUrl: string;
  canvasRef: RefObject<HTMLDivElement | null>;
  config: VideoThumbnailIntro;
  imageUrl: string;
  mode: "automatic" | "advanced";
  onChange: (value: VideoThumbnailIntro | null) => void;
  watermarkUrl: string;
}) => {
  const interactionRef = useRef<{
    id: VideoThumbnailLayerId | "background";
    mode: "move" | "resize";
    pointerX: number;
    pointerY: number;
    initial: VideoThumbnailLayerLayout;
    backgroundX: number;
    backgroundY: number;
    previewConfig: VideoThumbnailIntro | null;
  } | null>(null);
  const [interactionPreviewConfig, setInteractionPreviewConfig] =
    useState<VideoThumbnailIntro | null>(null);
  const [editingTextLayer, setEditingTextLayer] = useState<"title" | "channel" | null>(null);
  const [editingText, setEditingText] = useState("");
  const pendingPreviewConfigRef = useRef<VideoThumbnailIntro | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<VideoThumbnailLayerId | "background">("title");
  const lastTextTapRef = useRef<{
    id: "title" | "channel";
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const backgroundUrl = config.background?.mediaUrl
    ? config.background.mediaUrl
    : config.background?.serverPath
      ? `/media/${config.background.serverPath}`
      : "";
  const renderConfig = interactionPreviewConfig ?? config;
  const layerOrder = resolveThumbnailLayerOrder(renderConfig);
  const schedulePreviewConfig = (next: VideoThumbnailIntro) => {
    pendingPreviewConfigRef.current = next;
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null;
      const pending = pendingPreviewConfigRef.current;
      pendingPreviewConfigRef.current = null;
      if (pending) {
        setInteractionPreviewConfig(pending);
      }
    });
  };

  const previewLayerUpdate = (
    id: VideoThumbnailLayerId,
    patch: Partial<VideoThumbnailLayerLayout>
  ) => {
    const next = {
      ...config,
      layout: {
        ...config.layout,
        [id]: { ...resolveThumbnailLayerLayout(config, id), ...patch },
      },
    };
    if (interactionRef.current) {
      interactionRef.current.previewConfig = next;
    }
    schedulePreviewConfig(next);
  };

  // Pointer capture retargets native dblclick, so detect two completed taps here.
  const finishInteraction = (event?: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    const next = interaction?.previewConfig;
    let textLayerToEdit: "title" | "channel" | null = null;
    const textLayer: "title" | "channel" | null =
      interaction?.mode === "move" &&
      (interaction.id === "title" || interaction.id === "channel")
        ? interaction.id
        : null;
    const isTextTap = Boolean(
      event &&
      interaction &&
      textLayer &&
      Math.hypot(event.clientX - interaction.pointerX, event.clientY - interaction.pointerY) < 8
    );
    if (isTextTap && event && interaction && textLayer) {
      const now = performance.now();
      const previous = lastTextTapRef.current;
      const isDoubleTap = Boolean(
        previous &&
        previous.id === textLayer &&
          now - previous.time < 600 &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 14
      );
      if (isDoubleTap) {
        textLayerToEdit = textLayer;
        lastTextTapRef.current = null;
      } else {
        lastTextTapRef.current = {
          id: textLayer,
          time: now,
          x: event.clientX,
          y: event.clientY,
        };
      }
    } else if (
      interaction?.mode === "move" &&
      (interaction.id === "title" || interaction.id === "channel")
    ) {
      lastTextTapRef.current = null;
    }
    interactionRef.current = null;
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    pendingPreviewConfigRef.current = null;
    setInteractionPreviewConfig(null);
    if (next) {
      onChange(next);
    }
    if (textLayerToEdit) {
      beginInlineTextEdit(textLayerToEdit);
    }
  };

  const previewBackgroundUpdate = (x: number, y: number) => {
    const next = {
      ...config,
      backgroundPositionX: Math.min(100, Math.max(0, x)),
      backgroundPositionY: Math.min(100, Math.max(0, y)),
    };
    if (interactionRef.current) {
      interactionRef.current.previewConfig = next;
    }
    schedulePreviewConfig(next);
  };

  const beginInlineTextEdit = (id: "title" | "channel") => {
    setSelectedLayer(id);
    setEditingTextLayer(id);
    setEditingText(id === "title" ? config.title : config.channelName ?? "");
  };

  const cancelInlineTextEdit = () => {
    setEditingTextLayer(null);
    setEditingText("");
  };

  const commitInlineTextEdit = () => {
    if (!editingTextLayer) {
      return;
    }
    if (editingTextLayer === "channel") {
      saveThumbnailChannelName(editingText);
      onChange({ ...config, channelName: editingText });
    } else {
      onChange({ ...config, title: editingText });
    }
    cancelInlineTextEdit();
  };

  const handleInlineTextKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineTextEdit();
      return;
    }
    if (
      event.key === "Enter" &&
      (editingTextLayer === "channel" || event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      commitInlineTextEdit();
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      if (selectedLayer === "title") {
        beginInlineTextEdit("title");
      } else if (selectedLayer === "channel") {
        beginInlineTextEdit("channel");
      }
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedLayer === "brand" && config.brandImage) {
        event.preventDefault();
        onChange({ ...config, brandImage: null });
        setSelectedLayer("title");
      } else if (selectedLayer === "watermark" && config.watermark) {
        event.preventDefault();
        onChange({ ...config, watermark: null });
        setSelectedLayer("title");
      } else if (selectedLayer === "background" && config.background) {
        event.preventDefault();
        onChange({ ...config, background: null });
        setSelectedLayer("title");
      }
      return;
    }
  };

  const beginInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
    id: VideoThumbnailLayerId | "background",
    interactionMode: "move" | "resize"
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const initial = id === "background"
      ? { height: 100, width: 100, x: 50, y: 50 }
      : resolveThumbnailLayerLayout(config, id);
    setSelectedLayer(id);
    interactionRef.current = {
      backgroundX: config.backgroundPositionX ?? 50,
      backgroundY: config.backgroundPositionY ?? 50,
      id,
      initial,
      mode: interactionMode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      previewConfig: null,
    };
    canvasRef.current?.focus({ preventScroll: true });
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    const canvas = canvasRef.current;
    if (!interaction || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const dx = ((event.clientX - interaction.pointerX) / bounds.width) * 100;
    const dy = ((event.clientY - interaction.pointerY) / bounds.height) * 100;
    if (interaction.id === "background") {
      previewBackgroundUpdate(interaction.backgroundX - dx, interaction.backgroundY - dy);
      return;
    }
    if (interaction.mode === "resize") {
      if (interaction.id === "watermark") {
        const minimum = MIN_THUMBNAIL_LAYER_SIZE.watermark;
        const delta = Math.max(dx, dy);
        const size = Math.min(
          95,
          Math.max(
            minimum.width,
            Math.min(interaction.initial.width, interaction.initial.height) + delta
          )
        );
        previewLayerUpdate(interaction.id, { height: size, width: size });
      } else {
        const minimum = MIN_THUMBNAIL_LAYER_SIZE[interaction.id];
        previewLayerUpdate(interaction.id, {
          height: Math.min(95, Math.max(minimum.height, interaction.initial.height + dy)),
          width: Math.min(95, Math.max(minimum.width, interaction.initial.width + dx)),
        });
      }
      return;
    }
    previewLayerUpdate(interaction.id, {
      x: Math.min(100 - interaction.initial.width / 2, Math.max(interaction.initial.width / 2, interaction.initial.x + dx)),
      y: Math.min(100 - interaction.initial.height / 2, Math.max(interaction.initial.height / 2, interaction.initial.y + dy)),
    });
  };

  const layerStyle = (id: VideoThumbnailLayerId) => {
    const layer = resolveThumbnailLayerLayout(renderConfig, id);
    const size = id === "watermark" ? Math.min(layer.width, layer.height) : null;
    return {
      height: `${size === null ? layer.height : (size * THUMBNAIL_DOWNLOAD_WIDTH) / THUMBNAIL_DOWNLOAD_HEIGHT}%`,
      left: `${layer.x}%`,
      opacity: layer.visible === false ? 0 : 1,
      pointerEvents: layer.visible === false ? "none" : "auto",
      top: `${layer.y}%`,
      transform: `translate(-50%, -50%) rotate(${layer.rotation ?? 0}deg)`,
      width: `${size ?? layer.width}%`,
      zIndex: 10 + layerOrder.indexOf(id),
    } as const;
  };

  const selection = (id: VideoThumbnailLayerId) => selectedLayer === id ? (
    <div data-thumbnail-export-ignore="true" className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-dashed border-sky-400" />
  ) : null;
  const resizeHandle = (id: VideoThumbnailLayerId) => selectedLayer === id ? (
    <div
      data-thumbnail-export-ignore="true"
      className="absolute right-0 bottom-0 z-50 flex size-9 cursor-nwse-resize items-end justify-end rounded-full p-0.5"
      onPointerDown={(event) => beginInteraction(event, id, "resize")}
    >
      <span className="size-6 rounded-full border-2 border-white bg-sky-500 shadow-md" />
    </div>
  ) : null;
  return (
    <div className="grid gap-2">
      <div
        className="relative mx-auto w-full max-w-[22rem] touch-none overflow-hidden rounded-2xl border bg-slate-900 shadow-xl"
        onKeyDown={handleKeyDown}
        onPointerCancel={() => finishInteraction()}
        onPointerMove={handlePointerMove}
        onPointerUp={finishInteraction}
        ref={canvasRef}
        style={{
          aspectRatio: `${THUMBNAIL_DOWNLOAD_WIDTH} / ${THUMBNAIL_DOWNLOAD_HEIGHT}`,
          containerType: "inline-size",
        }}
        tabIndex={0}
      >
        {backgroundUrl ? (
          <img
            alt=""
            className="absolute inset-0 h-full w-full select-none"
            draggable={false}
            onPointerDown={(event) => beginInteraction(event, "background", "move")}
            src={backgroundUrl}
            style={{
              objectFit: "cover",
              objectPosition: `${renderConfig.backgroundPositionX ?? 50}% ${renderConfig.backgroundPositionY ?? 50}%`,
              transform: `scale(${renderConfig.backgroundZoom ?? 1})`,
            }}
          />
        ) : <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_#7ec8ff_0%,_#2c203e_38%,_#140b16_65%,_#070707_100%)]" />}
        <div className="absolute inset-0 bg-black/10" />
        <div
          className="absolute flex cursor-move select-none items-center justify-center"
          onPointerDown={(event) => beginInteraction(event, "title", "move")}
          style={layerStyle("title")}
        >
          <div className={[
            "relative flex h-full w-full min-h-0 min-w-0 cursor-move flex-col items-center justify-center overflow-hidden text-center",
            mode === "automatic" ? "text-emerald-800" : "text-pink-800",
          ].join(" ")} style={{ padding: "6cqw" }}>
            {imageUrl ? <img alt="" className="mx-auto w-full object-cover" draggable={false} src={imageUrl} style={{ borderRadius: "3cqw", marginBottom: "4.5cqw", maxHeight: "45cqw" }} /> : null}
            {editingTextLayer === "title" ? (
              <textarea
                autoFocus
                className="h-full w-full min-h-0 min-w-0 resize-none rounded-md border border-sky-400 bg-white/90 text-center outline-none"
                onBlur={commitInlineTextEdit}
                onChange={(event) => setEditingText(event.target.value)}
                onKeyDown={handleInlineTextKeyDown}
                onPointerDown={(event) => event.stopPropagation()}
                style={{
                  color: config.titleColor ?? "#741b1b",
                  fontFamily: resolveTitleFont(config.titleFont),
                  fontSize: `${Math.min(120, Math.max(28, config.titleFontSize ?? 42)) / 5}cqw`,
                  fontStyle: config.titleItalic ? "italic" : "normal",
                  fontWeight: config.titleBold === false ? 500 : 900,
                  padding: "2cqw",
                }}
                value={editingText}
              />
            ) : (
              <div
                className="min-h-0 min-w-0 max-w-full overflow-hidden whitespace-pre-wrap break-words leading-tight"
                style={{ color: config.titleColor ?? "#741b1b", fontFamily: resolveTitleFont(config.titleFont), fontSize: `${Math.min(120, Math.max(28, config.titleFontSize ?? 42)) / 5}cqw`, fontStyle: config.titleItalic ? "italic" : "normal", fontWeight: config.titleBold === false ? 500 : 900 }}
              >
                {config.title || "Tiêu đề video"}
              </div>
            )}
            {config.subtitle ? <div className="text-xs" style={{ fontSize: "4.5cqw", marginTop: "3cqw" }}>{config.subtitle}</div> : null}
            {selection("title")}
            {editingTextLayer === "title" ? null : resizeHandle("title")}
          </div>
        </div>

        {config.channelName ? <div className="absolute flex cursor-move select-none items-center justify-center" onPointerDown={(event) => beginInteraction(event, "channel", "move")} style={layerStyle("channel")}>
          {editingTextLayer === "channel" ? (
            <input
              autoFocus
              className="h-full w-full rounded-md border border-sky-400 bg-white/90 text-center outline-none"
              onBlur={commitInlineTextEdit}
              onChange={(event) => setEditingText(event.target.value)}
              onKeyDown={handleInlineTextKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                color: config.channelColor ?? (mode === "automatic" ? "#14532d" : "#831843"),
                fontFamily: resolveTitleFont(config.channelFont ?? "geist"),
                fontSize: `${Math.min(72, Math.max(16, config.channelFontSize ?? 36)) / 5}cqw`,
                fontStyle: config.channelItalic ? "italic" : "normal",
                fontWeight: config.channelBold ? 700 : 500,
              }}
              value={editingText}
            />
          ) : (
            <div
              className="max-w-full truncate text-center"
              style={{ color: config.channelColor ?? (mode === "automatic" ? "#14532d" : "#831843"), fontFamily: resolveTitleFont(config.channelFont ?? "geist"), fontSize: `${Math.min(72, Math.max(16, config.channelFontSize ?? 36)) / 5}cqw`, fontStyle: config.channelItalic ? "italic" : "normal", fontWeight: config.channelBold ? 700 : 500 }}
            >
              {config.channelName}
            </div>
          )}
          {selection("channel")}
          {editingTextLayer === "channel" ? null : resizeHandle("channel")}
        </div> : null}

        {brandImageUrl ? <div className="absolute flex items-center justify-center" onPointerDown={(event) => beginInteraction(event, "brand", "move")} style={layerStyle("brand")}>
          <img alt="" className="h-full w-full object-contain" draggable={false} src={brandImageUrl} />
          {selection("brand")}
          {resizeHandle("brand")}
        </div> : null}
        {watermarkUrl ? <div className="absolute aspect-square select-none overflow-hidden rounded-full" onPointerDown={(event) => beginInteraction(event, "watermark", "move")} style={{ ...layerStyle("watermark"), clipPath: "circle(50% at 50% 50%)" }}>
          <img alt="" className="h-full w-full select-none object-cover" draggable={false} src={watermarkUrl} />
          {selection("watermark")}
          {resizeHandle("watermark")}
        </div> : null}
      </div>

      {/*
        <div className="flex flex-wrap gap-1">
          {(["background", ...layerOrder] as Array<VideoThumbnailLayerId | "background">).map((id) => <button className={["rounded border px-2 py-1 text-[11px]", selectedLayer === id ? "border-sky-400 bg-sky-500/15" : "border-border"].join(" ")} key={id} onClick={() => setSelectedLayer(id)} type="button">{layerNames[id]}</button>)}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button className="h-7 px-2 text-[11px]" onClick={() => setShowSafeZone((current) => !current)} type="button" variant="outline">{showSafeZone ? "Ẩn vùng an toàn" : "Hiện vùng an toàn"}</Button>
          {selectedLayer === "background" ? <>
            <Button className="h-7 px-2 text-[11px]" onClick={() => updateBackground(50, 50)} type="button" variant="outline">Căn nền giữa</Button>
            <Button className="h-7 px-2 text-[11px]" onClick={() => onChange({ ...config, backgroundFit: "cover", backgroundPositionX: 50, backgroundPositionY: 50, backgroundZoom: 1 })} type="button" variant="outline">Reset nền</Button>
          </> : null}
          {selectedLayer && selectedLayer !== "background" ? <>
            <Button className="h-7 px-2 text-[11px]" onClick={() => updateLayer(selectedLayer, { x: 50 })} type="button" variant="outline">Căn giữa ngang</Button>
            <Button className="h-7 px-2 text-[11px]" onClick={() => updateLayer(selectedLayer, { y: 50 })} type="button" variant="outline">Căn giữa dọc</Button>
            <Button className="h-7 px-2 text-[11px]" onClick={() => updateLayer(selectedLayer, { locked: !selectedLayout?.locked })} type="button" variant="outline">{selectedLayout?.locked ? "Mở khóa" : "Khóa"}</Button>
            <Button className="h-7 px-2 text-[11px]" onClick={() => updateLayer(selectedLayer, { visible: selectedLayout?.visible === false })} type="button" variant="outline">{selectedLayout?.visible === false ? "Hiện" : "Ẩn"}</Button>
            <Button className="h-7 px-2 text-[11px]" onClick={() => setLayerOrder(selectedLayer, "front")} type="button" variant="outline">Lên trước</Button>
            <Button className="h-7 px-2 text-[11px]" onClick={() => setLayerOrder(selectedLayer, "back")} type="button" variant="outline">Ra sau</Button>
            <Button className="h-7 px-2 text-[11px]" onClick={() => onChange({ ...config, layout: { ...config.layout, [selectedLayer]: { ...DEFAULT_THUMBNAIL_LAYER_LAYOUT[selectedLayer] } } })} type="button" variant="outline">Reset</Button>
          </> : null}
        </div>
      */}
    </div>
  );
};

function resolveTitleFont(font: VideoThumbnailIntro["titleFont"]): string {
  switch (font) {
    case "beVietnam":
      return "Be Vietnam Pro, Geist, Arial, sans-serif";
    case "georgia":
      return "Georgia, serif";
    case "geist":
      return "Geist, Arial, sans-serif";
    case "mono":
      return "Courier New, monospace";
    case "montserrat":
      return "Montserrat, Segoe UI, Arial, sans-serif";
    case "notoSans":
      return "Noto Sans, Geist, Arial, sans-serif";
    case "oswald":
      return "Oswald, Arial Narrow, Arial, sans-serif";
    case "poppins":
      return "Poppins, Segoe UI, Arial, sans-serif";
    case "roboto":
      return "Roboto, Segoe UI, Arial, sans-serif";
    case "trebuchet":
      return "Trebuchet MS, sans-serif";
    case "verdana":
      return "Verdana, sans-serif";
    default:
      return "Poppins, Segoe UI, Arial, sans-serif";
  }
}

function normalizeTitleFont(
  font: VideoThumbnailIntro["titleFont"]
): VideoThumbnailIntro["titleFont"] {
  switch (font) {
    case "beVietnam":
    case "georgia":
    case "geist":
    case "mono":
    case "montserrat":
    case "notoSans":
    case "oswald":
    case "poppins":
    case "roboto":
    case "trebuchet":
    case "verdana":
      return font;
    default:
      return "poppins";
  }
}
