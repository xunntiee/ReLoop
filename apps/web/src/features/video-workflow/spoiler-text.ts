export interface SpoilerTextParts {
  initial: string;
  reveal: string;
}

export function splitSpoilerText(text: string): SpoilerTextParts {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return { initial: "", reveal: "" };
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const splitAt = Math.ceil(lines.length / 2);
    return {
      initial: lines.slice(0, splitAt).join("\n"),
      reveal: lines.slice(splitAt).join("\n"),
    };
  }

  const sentences = normalized.match(/[^.!?…]+[.!?…]?/g) ?? [];
  if (sentences.length >= 2) {
    const targetLength = normalized.length / 2;
    let splitAt = 1;
    let currentLength = sentences[0]?.length ?? 0;
    while (
      splitAt < sentences.length - 1 &&
      currentLength + (sentences[splitAt]?.length ?? 0) <= targetLength
    ) {
      currentLength += sentences[splitAt]?.length ?? 0;
      splitAt += 1;
    }
    return {
      initial: sentences.slice(0, splitAt).join("").trim(),
      reveal: sentences.slice(splitAt).join("").trim(),
    };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 4) {
    return { initial: normalized, reveal: "" };
  }

  const splitAt = Math.ceil(words.length / 2);
  return {
    initial: words.slice(0, splitAt).join(" "),
    reveal: words.slice(splitAt).join(" "),
  };
}

export function joinSpoilerText(initial: string, reveal: string): string {
  return [initial.trim(), reveal.trim()].filter(Boolean).join("\n");
}
