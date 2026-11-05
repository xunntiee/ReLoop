export function formatStructuredPreviewText(value: string): string {
  const normalized = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\s+(?=\d+\.\s+\p{L})/gu, "\n")
    .replace(
      /([.!?])\s+(?=(?:Chẳng hạn|Ví dụ|Tuy nhiên|Mặt khác|Do đó|Vì vậy)[,:]?\s)/gu,
      "$1\n\n",
    );
  if (!normalized.trim()) return "";

  const repaired = restoreInlineStructure(normalized);
  const lines = repaired
    .split("\n")
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trimEnd());

  const compacted: string[] = [];
  for (const line of lines) {
    if (!line.trim() && compacted[compacted.length - 1] === "") continue;
    compacted.push(line.trim() ? line : "");
  }

  return compacted.join("\n").trim();
}

function restoreInlineStructure(value: string): string {
  let text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (!text) return "";

  const bulletMarkers = Array.from(text.matchAll(/(?:^|\s)[-+]\s+\S/gm));
  const numberedMarkers = Array.from(text.matchAll(/(?:^|\s)\d{1,2}[.)]\s+\S/gm));
  const ageRangeMarkers = Array.from(text.matchAll(/(?:^|\s)\d{1,2}\s*-\s*\d{1,2}\s*t\s*:/gim));
  const hasSectionHeading = /\s[^\s:]{3,}:\s*(?:[-+]|\d{1,2}[.)])/u.test(text);
  const hasParagraphStarter =
    /[.!?…]\s+(?=(?:Chẳng hạn|Chang han|Ví dụ|Vi du|Ví dụ như|Vi du nhu|Nhưng|Nhung|Tuy nhiên|Tuy nhien|Còn|Con|Riêng|Rieng|Đổi lại|Doi lai|Mặt khác|Mat khac)\b)/iu.test(
      text,
    );

  if (
    bulletMarkers.length + numberedMarkers.length + ageRangeMarkers.length < 2 &&
    !hasSectionHeading &&
    !hasParagraphStarter
  ) {
    return text;
  }

  if (hasParagraphStarter) {
    text = text.replace(
      /([.!?…])\s+(?=(?:Chẳng hạn|Chang han|Ví dụ|Vi du|Ví dụ như|Vi du nhu|Nhưng|Nhung|Tuy nhiên|Tuy nhien|Còn|Con|Riêng|Rieng|Đổi lại|Doi lai|Mặt khác|Mat khac)\b)/giu,
      "$1\n\n",
    );
  }

  if (hasSectionHeading) {
    text = text.replace(
      /\s+([^\s:]{3,}:)\s*(?=(?:[-+]|\d{1,2}[.)]))/gu,
      "\n$1\n",
    );
  }

  if (numberedMarkers.length >= 2) {
    text = text.replace(/\s+(?=\d{1,2}[.)]\s+\S)/g, "\n");
  }

  if (ageRangeMarkers.length >= 2) {
    text = text.replace(/\s+(?=\d{1,2}\s*-\s*\d{1,2}\s*t\s*:)/gi, "\n");
  }

  if (bulletMarkers.length >= 2) {
    text = text.replace(/\s+(?=[-+]\s+\S)/g, "\n");
  }

  return text.replace(/\n{3,}/g, "\n\n");
}
