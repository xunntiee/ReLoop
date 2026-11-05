const TOKEN_BOUNDARY = "[^\\p{L}\\p{N}_]";

const SENSITIVE_REPLACEMENTS: Record<string, string> = {
  "cặc": "khó chịu",
  "cặc lồn": "rất tệ",
  "địt": "bực",
  "địt mẹ": "rất bực",
  "khốn nạn": "không hay",
  "lồn": "tệ",
  "óc chó": "",
  "sấp mặt lồn": "rất nặng",
  "thằng mặt lồn": "người đó",
};

export function normalizeNarrationText(
  input: string,
  customAbbreviations?: Record<string, string>
): string {
  let value = String(input ?? "").normalize("NFC");
  value = value.replace(/https?:\/\/\S+/gi, " ");
  value = value.replace(/www\.\S+/gi, " ");
  value = value.replace(/\b\S+@\S+\.\S+\b/gi, " ");
  value = value.replace(/[\u200B-\u200D\uFEFF]/g, "");
  value = value.replace(/[\u2010-\u2015]/g, "-");
  value = value.replace(/[“”„‟]/g, '"');
  value = value.replace(/[‘’‚‛]/g, "'");
  value = value.replace(/&/g, " và ");
  value = value.replace(/\p{Extended_Pictographic}/gu, " ");
  value = value.replace(/[^\S\r\n]+/g, " ");
  value = value.replace(/[@#]([\p{L}\p{N}_-]+)/gu, (_match, handle: string) =>
    handle.replace(/[_-]+/g, " ")
  );
  value = removeTtsEmoticons(value);
  value = value.replace(/[\)\]]{2,}/g, " ");
  value = value.replace(/([!?.,]){2,}/g, "$1");
  value = value.replace(/([a-zA-Zà-ỹÀ-Ỹ])\1{3,}/gu, "$1$1");

  value = normalizeNumericShorthand(value);

  if (customAbbreviations && Object.keys(customAbbreviations).length > 0) {
    value = applyAbbreviationMap(value, customAbbreviations);
  }

  value = applySensitiveReplacementMap(value, SENSITIVE_REPLACEMENTS);
  value = cleanupPunctuation(value);

  return value.replace(/\s+/g, " ").trim().slice(0, 5000);
}

export function removeTtsEmoticons(input: string): string {
  // Emoticons carry no narration. Replacing them with a comma made providers
  // pronounce `=)` / `:))` as "phẩy" in otherwise normal comments.
  return String(input ?? "")
    .replace(/[:=]-?[\)\]dD]+/g, " ")
    .replace(/[:=]-?[\(\[]+/g, " ");
}

export function replaceSpelledTtsCommas(input: string): string {
  return String(input ?? "")
    .replace(
      /(^|[^\p{L}\p{N}])(?:dấu\s+)?phẩy(?=$|[^\p{L}\p{N}])/giu,
      "$1,"
    )
    .replace(/\s*,\s*/gu, ", ")
    .trim();
}

function normalizeNumericShorthand(value: string): string {
  let next = value;

  next = next.replace(
    /\b(\d{1,2})\s*h\s*(\d{1,2})?\b/giu,
    (_match, hour: string, minute?: string) =>
      minute ? `${hour} giờ ${minute}` : `${hour} giờ`
  );
  next = next.replace(/(\d+(?:[,.]\d+)?)\s*%/giu, "$1 phần trăm");
  next = next.replace(/(\d+)\s*r(?=$|[^\p{L}\p{N}_])/giu, "$1 rưỡi");
  next = next.replace(/(\d+)\s*tr\s*5(?=$|[^\p{L}\p{N}_])/giu, "$1 triệu rưỡi");
  next = next.replace(/(\d+)\s*tr(?=$|[^\p{L}\p{N}_])/giu, "$1 triệu");
  next = next.replace(/(\d+)\s*củ(?=$|[^\p{L}\p{N}_])/giu, "$1 triệu");
  next = next.replace(/(\d+)\s*k(?=$|[^\p{L}\p{N}_])/giu, "$1 nghìn");

  return next;
}

function applyAbbreviationMap(
  value: string,
  replacements: Record<string, string>
): string {
  const patterns = Object.entries(replacements)
    .map(([token, replacement]) => {
      const normalizedToken = token.trim();
      const normalizedReplacement = replacement.trim();
      if (!normalizedToken || !normalizedReplacement) {
        return null;
      }
      return [
        new RegExp(
          `(^|${TOKEN_BOUNDARY})${escapeRegExp(normalizedToken)}(?=$|${TOKEN_BOUNDARY})`,
          "giu"
        ),
        normalizedReplacement,
      ] as const;
    })
    .filter(Boolean);

  let next = value;
  for (const entry of patterns) {
    if (!entry) {
      continue;
    }
    const [pattern, replacement] = entry;
    next = next.replace(pattern, (_match, prefix: string) => {
      const separator = prefix && /\s/u.test(prefix) ? prefix : `${prefix} `;
      return `${separator}${replacement}`;
    });
  }

  return next;
}

function applySensitiveReplacementMap(
  value: string,
  replacements: Record<string, string>
): string {
  const sortedEntries = Object.entries(replacements).sort(
    ([left], [right]) => right.length - left.length
  );

  let next = value;
  for (const [rawToken, replacement] of sortedEntries) {
    const token = rawToken.trim();
    if (!token || !replacement.trim()) {
      continue;
    }
    const pattern = new RegExp(
      `(^|${TOKEN_BOUNDARY})${escapeRegExp(token)}(?=$|${TOKEN_BOUNDARY})`,
      "giu"
    );
    next = next.replace(pattern, (_match, prefix: string) => {
      const separator = prefix && /\s/u.test(prefix) ? prefix : `${prefix} `;
      return `${separator}${replacement}`;
    });
  }

  return next;
}

function cleanupPunctuation(value: string): string {
  let next = value;
  next = next.replace(/\s+([,.!?;:])/g, "$1");
  next = next.replace(/([,.!?;:])([^\s,.!?;:])/g, "$1 $2");
  next = next.replace(/,\s*([.!?])/g, "$1");
  next = next.replace(/[,:;]\s*$/g, "");
  next = next.replace(/\(\s+/g, "(");
  next = next.replace(/\s+\)/g, ")");
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
