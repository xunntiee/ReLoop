type OcrTextLine = {
  text: string;
};

const SOCIAL_FOOTER_RE = /^(?:(?:\d+\s*(?:gio|phut|ngay|tuan|thang|nam)|vua xong|just now)\s*)?(?:(?:thich|like|tra loi|reply|chia se|share|repost|binh luan|comment)\s*)+$/u;
const SOCIAL_FOLLOW_RE = /^(?:[a-z ._-]{2,80}\s+)?(?:theo doi|following|follow)$/u;

export function selectOcrTextForTts<T extends OcrTextLine>(lines: T[]): T[] {
  const headerEndIndex = lines.findIndex(
    (line, index) => index <= 2 && SOCIAL_FOLLOW_RE.test(normalizeForMatch(line.text)),
  );

  return lines.filter(
    (line, index) => index > headerEndIndex && !isSocialFooter(line.text),
  );
}

function isSocialFooter(value: string): boolean {
  const normalized = normalizeForMatch(value).replace(/[|./]/gu, " ");
  return SOCIAL_FOOTER_RE.test(normalized) || /^\d+(?:[.,]\d+)?[km]?$/u.test(normalized);
}

function normalizeForMatch(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gu, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/gu, " ")
    .trim();
}
