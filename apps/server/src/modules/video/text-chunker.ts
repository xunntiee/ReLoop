export interface TextChunk {
  order: number;
  text: string;
}

export interface ChunkOptions {
  maxChars?: number;
  targetChars?: number;
}

const DEFAULT_TARGET_CHARS = 180;
const DEFAULT_MAX_CHARS = 280;

export function chunkNarrationText(
  text: string,
  options: ChunkOptions = {}
): TextChunk[] {
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const sentences = splitIntoSentences(text);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongSentence(sentence, maxChars));
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars || (current.length >= targetChars && sentence.length > 0)) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);

  return chunks
    .filter(Boolean)
    .map((chunk, index) => ({
      order: index + 1,
      text: chunk,
    }));
}

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/([.!?])\s+/g, "$1|")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
  const pieces = sentence
    .replace(/([,;:])\s+/g, "$1|")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (piece.length <= maxChars) {
      current = piece;
      continue;
    }
    chunks.push(...splitByWords(piece, maxChars));
    current = "";
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitByWords(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = word;
      continue;
    }
    current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}
