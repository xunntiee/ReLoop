import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';
import type { ToolConfig } from '@tool-base/config/schema';
import type { DialogueLine, DialogueSpeaker } from './types.js';

export interface OcrDialogueResult {
  version: number;
  cached: boolean;
  height: number;
  imageHash: string;
  isDialogue: boolean;
  lines: DialogueLine[];
  width: number;
}

// OCR runs against a normalized 1600px image, while callers render the
// original asset. Keep cached boxes in original-image coordinates.
const OCR_CACHE_VERSION = 22;

export interface OcrDialogueOptions {
  baseDir: string;
  config: ToolConfig;
  imagePath: string;
}

export async function ocrDialogueImage(
  options: OcrDialogueOptions,
): Promise<OcrDialogueResult> {
  const imagePath = await resolveAllowedImagePath(options);
  const source = await readFile(imagePath);
  const imageHash = createHash('sha256').update(source).digest('hex');
  const cacheDir = resolve(options.baseDir, 'data/processed/video_ocr');
  const cachePath = resolve(cacheDir, imageHash + '.json');
  const metadata = await sharp(source).metadata();
  const dimensions = {
    height: Number(metadata.height ?? 0),
    width: Number(metadata.width ?? 0),
  };
  const ocrSource = await sharp(source)
    .resize({ width: 1600, height: 1600, fit: 'inside' })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
  const contrastSource = await sharp(source)
    .resize({ width: 1600, height: 1600, fit: 'inside' })
    .grayscale()
    .normalize()
    .linear(1.25, -24)
    .sharpen()
    .png()
    .toBuffer();
  const thresholdSource = await sharp(source)
    .resize({ width: 1600, height: 1600, fit: 'inside' })
    .grayscale()
    .normalize()
    .threshold(170)
    .png()
    .toBuffer();

  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as OcrDialogueResult;
      if (cached.version === OCR_CACHE_VERSION && Array.isArray(cached.lines)) {
        return { ...cached, cached: true, imageHash };
      }
    } catch {
      // Ignore a corrupt cache and rebuild it.
    }
  }

  await mkdir(cacheDir, { recursive: true });
  const worker = await createWorker('vie+eng', 1, {
    cachePath: resolve(options.baseDir, 'data/processed/video_ocr/models'),
  });
  try {
    const ocrMetadata = await sharp(ocrSource).metadata();
    const ocrWidth = Number(ocrMetadata.width ?? dimensions.width);
    const ocrHeight = Number(ocrMetadata.height ?? dimensions.height);
    const candidates: DialogueLine[][] = [];

    for (const pass of [
      { mode: PSM.SPARSE_TEXT, source: ocrSource },
      { mode: PSM.SINGLE_BLOCK, source: contrastSource },
      { mode: PSM.SPARSE_TEXT, source: thresholdSource },
    ]) {
      await worker.setParameters({ tessedit_pageseg_mode: pass.mode });
      const result = await worker.recognize(pass.source, {}, { blocks: true, text: true });
      const page = result.data as unknown as {
        words?: unknown;
        lines?: unknown;
        blocks?: unknown;
      };
      let words = Array.isArray(page.words)
        ? page.words as Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }>
        : [];
      if (words.length === 0 && Array.isArray(page.blocks)) {
        words = extractWordsFromBlocks(page.blocks);
      }
      const recognized = words.length > 0
        ? words
        : (Array.isArray(page.lines) ? page.lines : []) as Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }>;
      candidates.push(groupOcrWords(recognized, ocrWidth, ocrHeight));
    }
    const lines = scaleDialogueLinesToOriginal(
      selectBestOcrDialogueCandidate(candidates),
      { width: ocrWidth, height: ocrHeight },
      dimensions,
    );
    const response: OcrDialogueResult = {
      version: OCR_CACHE_VERSION,
      cached: false,
      height: dimensions.height,
      imageHash,
      isDialogue: hasRecognizedDialogue(lines),
      lines,
      width: dimensions.width,
    };
    await writeFile(cachePath, JSON.stringify(response, null, 2) + '\n', 'utf8');
    return response;
  } finally {
    await worker.terminate();
  }
}

export function hasRecognizedDialogue(lines: DialogueLine[]): boolean {
  const spokenLines = lines.filter(
    (line) =>
      line.text.trim().length > 0 &&
      (line.speaker === "A" || line.speaker === "B")
  );
  return (
    spokenLines.length >= 2 &&
    new Set(spokenLines.map((line) => line.speaker)).size === 2
  );
}

export function selectBestOcrDialogueCandidate(
  candidates: DialogueLine[][],
): DialogueLine[] {
  return candidates.reduce<DialogueLine[]>((best, candidate) => {
    if (candidate.length === 0) return best;
    if (best.length === 0) return candidate;
    return scoreOcrDialogueCandidate(candidate) > scoreOcrDialogueCandidate(best)
      ? candidate
      : best;
  }, []);
}

type OcrWord = {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
};

function extractWordsFromBlocks(blocks: unknown[]): OcrWord[] {
  const output: OcrWord[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (Array.isArray(item.words)) {
      for (const word of item.words) {
        if (word && typeof word === 'object') output.push(word as OcrWord);
      }
      return;
    }
    if (Array.isArray(item.lines)) {
      for (const line of item.lines) {
        if (line && typeof line === 'object') visit(line);
      }
      return;
    }
    if (Array.isArray(item.paragraphs)) {
      for (const paragraph of item.paragraphs) visit(paragraph);
      return;
    }
    if (typeof item.text === 'string' && item.bbox && typeof item.bbox === 'object') {
      output.push(item as OcrWord);
    }
  };
  for (const block of blocks) visit(block);
  return output;
}

async function resolveAllowedImagePath(options: OcrDialogueOptions): Promise<string> {
  const requested = String(options.imagePath ?? '').trim();
  if (!requested) throw new Error('Thiếu đường dẫn ảnh để OCR.');
  const candidate = resolve(options.baseDir, requested);
  const roots = [
    resolve(options.baseDir, options.config.crawl.assetDir),
    resolve(options.baseDir, options.config.video.uploadsDir),
  ];
  const existingRoots = await Promise.all(
    roots.filter((root) => existsSync(root)).map((root) => realpath(root)),
  );
  const actual = await realpath(candidate).catch(() => '');
  const allowed = existingRoots.some(
    (root) => actual === root || actual.startsWith(root + '\\') || actual.startsWith(root + '/'),
  );
  if (!allowed || !actual || !existsSync(actual)) {
    throw new Error('Ảnh OCR không nằm trong thư mục media hợp lệ.');
  }
  if (!isAbsolute(actual)) throw new Error('Đường dẫn ảnh OCR không hợp lệ.');
  return actual;
}

export function groupOcrWords(
  words: Array<{
    text?: string;
    confidence?: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>,
  imageWidth: number,
  imageHeight: number,
): DialogueLine[] {
  const usable = words
    .map((word) => {
      const text = normalizeDialogueText(String(word.text ?? ''));
      const bbox = word.bbox;
      const confidence = Math.max(0, Math.min(100, Number(word.confidence ?? 0)));
      if (
        !text
        || !bbox
        || isUiText(text)
        || isSocialUiText(text)
        || isUiRegion(text, bbox.y0, imageHeight)
        || isLikelyMetricToken(text)
        || isLikelySocialHeaderToken(text)
        || isLikelyOcrArtifact(text, confidence, bbox, imageHeight)
      ) return null;
      return {
        text,
        confidence,
        x: Math.max(0, bbox.x0),
        y: Math.max(0, bbox.y0),
        right: Math.max(bbox.x0, Number(bbox.x1 ?? bbox.x0)),
        bottom: Math.max(bbox.y0, Number(bbox.y1 ?? bbox.y0)),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const groups: typeof usable[] = [];
  for (const word of usable) {
    const previous = groups[groups.length - 1];
    const wordCenterY = (word.y + word.bottom) / 2;
    const previousCenterY = previous
      ? previous.reduce((sum, item) => sum + (item.y + item.bottom) / 2, 0) / previous.length
      : Number.NaN;
    const previousHeight = previous
      ? Math.min(...previous.map((item) => item.bottom - item.y))
      : Number.NaN;
    const threshold = Math.max(
      16,
      Math.min(word.bottom - word.y, previousHeight || word.bottom - word.y) * 0.65,
    );
    if (!previous || Math.abs(wordCenterY - previousCenterY) > threshold) groups.push([word]);
    else previous.push(word);
  }

  const width = imageWidth || Math.max(1, ...usable.map((item) => item.right));
  const lines = groups
    .map((group, index) => {
      const x = Math.min(...group.map((item) => item.x));
      const y = Math.min(...group.map((item) => item.y));
      const right = Math.max(...group.map((item) => item.right));
      const bottom = Math.max(...group.map((item) => item.bottom));
      const confidence = Math.round(group.reduce((sum, item) => sum + item.confidence, 0) / group.length);
      return {
        bbox: { height: bottom - y, width: right - x, x, y },
        confidence,
        id: 'dialogue-' + (index + 1),
        order: index + 1,
        speaker: classifySpeaker((x + right) / 2, width),
        text: [...group]
          .sort((left, right) => left.x - right.x)
          .map((item) => item.text)
          .join(' '),
      };
    })
    .filter((line) =>
      line.text.length > 1
      && (!imageHeight || line.bbox.height <= imageHeight * 0.3)
      && !isUiText(line.text)
      && !isOcrActionText(line.text)
      && !isSocialUiText(line.text)
      && !isLikelyOcrNoise(line.text, line.confidence)
    );

  return mergeWrappedDialogueLines(lines, width).map((line, index) => ({
    ...line,
    id: 'dialogue-' + (index + 1),
    order: index + 1,
  }));
}

function normalizeDialogueText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^\d\s+(?=[A-ZÀ-Ỹ])/u, '')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

function mergeWrappedDialogueLines(lines: DialogueLine[], imageWidth: number): DialogueLine[] {
  const merged: DialogueLine[] = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    if (!previous || !isWrappedContinuation(previous, line, imageWidth)) {
      merged.push({ ...line, bbox: { ...line.bbox } });
      continue;
    }

    const previousRight = previous.bbox.x + previous.bbox.width;
    const previousBottom = previous.bbox.y + previous.bbox.height;
    const lineRight = line.bbox.x + line.bbox.width;
    const lineBottom = line.bbox.y + line.bbox.height;
    const totalLength = Math.max(1, previous.text.length + line.text.length);
    previous.confidence = Math.round(
      (previous.confidence * previous.text.length + line.confidence * line.text.length) / totalLength,
    );
    previous.text = normalizeDialogueText(previous.text + ' ' + line.text);
    previous.bbox = {
      x: Math.min(previous.bbox.x, line.bbox.x),
      y: Math.min(previous.bbox.y, line.bbox.y),
      width: Math.max(previousRight, lineRight) - Math.min(previous.bbox.x, line.bbox.x),
      height: Math.max(previousBottom, lineBottom) - Math.min(previous.bbox.y, line.bbox.y),
    };
  }
  return merged;
}

function isWrappedContinuation(previous: DialogueLine, current: DialogueLine, imageWidth: number): boolean {
  const previousBottom = previous.bbox.y + previous.bbox.height;
  const verticalGap = current.bbox.y - previousBottom;
  const lineHeight = Math.min(previous.bbox.height, current.bbox.height);
  const maximumGap = Math.max(16, lineHeight * 0.7);
  if (verticalGap < -2 || verticalGap > maximumGap) return false;

  const xDifference = Math.abs(current.bbox.x - previous.bbox.x);
  const aligned = xDifference <= Math.max(24, imageWidth * 0.05);
  const shortContinuation = current.text.length <= 12;
  return aligned || (shortContinuation && previous.speaker === current.speaker);
}

function isLikelyMetricToken(text: string): boolean {
  const compact = text.replace(/[^\p{L}\p{N}]/gu, '');
  const digits = compact.replace(/[^\p{N}]/gu, '');
  const letters = compact.replace(/[^\p{L}]/gu, '');
  return digits.length >= 2 && (
    letters.length <= 1
    || /[.,]/u.test(text)
    || /^[A-Z\d]+$/u.test(compact)
  );
}

function scoreOcrDialogueCandidate(lines: DialogueLine[]): number {
  return lines.reduce(
    (total, line) =>
      total + line.text.replace(/\s+/gu, '').length * 4 + line.confidence / 25,
    0,
  );
}

function scaleDialogueLinesToOriginal(
  lines: DialogueLine[],
  source: { width: number; height: number },
  target: { width: number; height: number },
): DialogueLine[] {
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    target.width <= 0 ||
    target.height <= 0 ||
    (source.width === target.width && source.height === target.height)
  ) {
    return lines;
  }

  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  return lines.map((line) => ({
    ...line,
    bbox: {
      height: line.bbox.height * scaleY,
      width: line.bbox.width * scaleX,
      x: line.bbox.x * scaleX,
      y: line.bbox.y * scaleY,
    },
  }));
}

function isLikelySocialHeaderToken(text: string): boolean {
  return /^[a-z][a-z0-9._-]{7,}$/i.test(text);
}

function isLikelyOcrArtifact(
  text: string,
  confidence: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  imageHeight: number,
): boolean {
  const compact = text.replace(/[^\p{L}\p{N}]/gu, '');
  const height = Math.max(0, bbox.y1 - bbox.y0);
  if (compact.length <= 3 && confidence < 50 && /^[a-z\d]+$/i.test(compact)) return true;
  if (text === 'ï') return true;
  return compact.length <= 2 && /^[A-Z][a-z]?$/.test(text) && height > imageHeight * 0.08;
}

function isLikelyOcrNoise(text: string, confidence: number): boolean {
  const parts = text.split(/\s+/u).filter(Boolean);
  const compact = text.replace(/[^\p{L}\p{N}]/gu, '');
  const digits = compact.replace(/[^\p{N}]/gu, '').length;
  const letters = compact.replace(/[^\p{L}]/gu, '').length;
  const symbols = text.replace(/[\p{L}\p{N}\s]/gu, '').length;
  const longWords = parts.filter((part) => part.replace(/[^\p{L}]/gu, '').length >= 4).length;
  if (confidence < 70) return true;
  if (parts.length === 1 && text.length <= 3 && /^[^\p{Ll}]+$/u.test(text)) return true;
  if (digits >= 2 && digits > letters) return true;
  if (confidence < 75 && symbols > Math.max(2, letters * 0.35)) return true;
  return confidence < 70 && parts.length >= 4 && longWords <= 1;
}

function isSocialUiText(text: string): boolean {
  const normalized = text.trim();
  const parts = normalized.split(/\s+/u);
  if (
    /^(?:[\p{L}\p{N}._-]+\s+){1,4}\d+(?:\s+[\p{L}\p{N}._-]{1,3})?$/iu.test(normalized)
    && (parts[0]?.includes('.') || parts.some((part) => part.length >= 8))
  ) return true;
  const hasUsername = parts.some((part) => part.includes('.') || part.length >= 8);
  const hasTime = parts.some((part) => /^\d{1,2}(?:[a-z]+)?$/iu.test(part));
  return hasUsername && hasTime && parts.length <= 7;
}

function classifySpeaker(centerX: number, width: number): DialogueSpeaker {
  if (!Number.isFinite(centerX) || !width) return 'unknown';
  return centerX < width / 2 ? 'A' : 'B';
}

function isOcrActionText(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase("vi-VN");
  return /^(xem|tr\u1ea3\s+l\u1eddi|b\u00e1o\s+c\u00e1o|d\u1ecbch|\u1ea9n|t\u1eaft\s+th\u00f4ng\s+b\u00e1o(?:\s+trong\s+\d+\s+gi\u1edd)?)$/u.test(normalized);
}

function isUiText(text: string): boolean {
  return /^(\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|[♥♡❤•·…]+|like|reply|share|following)$/i.test(text.trim());
}

function isUiRegion(text: string, y: number, imageHeight: number): boolean {
  if (!imageHeight) return false;
  const normalized = text.trim().toLowerCase();
  return y > imageHeight * 0.84
    || /\d{1,2}:\d{2}/.test(normalized)
    || /pa\s*pa\s*bank|all em|tin nhan|hôm nay|hom nay/i.test(normalized);
}

function readImageDimensions(source: Buffer): { height: number; width: number } {
  if (source.length >= 24 && source.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { height: source.readUInt32BE(20), width: source.readUInt32BE(16) };
  }
  if (source.length > 10 && source[0] === 0xff && source[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < source.length) {
      if (source[offset] !== 0xff) { offset += 1; continue; }
      const marker = Number(source[offset + 1] ?? -1);
      const length = source.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: source.readUInt16BE(offset + 5), width: source.readUInt16BE(offset + 7) };
      }
      offset += Math.max(2, length + 2);
    }
  }
  return { height: 0, width: 0 };
}
