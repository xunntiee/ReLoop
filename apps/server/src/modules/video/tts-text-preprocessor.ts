import type { ToolConfig } from "@tool-base/config/schema";
import {
  normalizeNarrationText,
  removeTtsEmoticons,
  replaceSpelledTtsCommas,
} from "./text-normalizer.js";

export interface PreparedNarrationText {
  appliedMode: "off" | "rules_only" | "llm_assist";
  requestedMode: "off" | "rules_only" | "llm_assist";
  finalText: string;
  sourceText: string;
  usedLlm: boolean;
  warnings: string[];
}

export interface NarrationTextContext {
  commentSnippets?: string[];
  postText?: string;
  titleHint?: string;
  username?: string;
}

export interface DialogueTextSuggestionLine {
  id: string;
  speaker: "A" | "B" | "unknown";
  text: string;
}

const SOCIAL_SHORTHAND_RE =
  /\b(ae|b|bcuoi|bt|bth|bthg|bthuong|bthường|cafe|cf|cgi|chs|cj|cjz|ck|clg|cmt|cx|dc|đc|e|hem|hk|hok|hong|hum|ib|ibox|inb|j|jz|k|ko|khum|kp|lmj|m|mik|mk|mn|mng|mqh|mun|mún|nch|ncl|ng|ngta|nma|nt|ntn|ny|nyc|r|rep|rl|rui|rùi|t|thui|tn|tnao|trl|v|vk|vl|vs|z|zay)\b/iu;

const VIETNAMESE_ACCENT_RE =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/gu;

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bhên\s+k\b/giu, "hên không"],
  [/\bkp\b/giu, "không phải"],
  [/\br\s+chừng\s+nào\b/giu, "rồi chừng nào"],
  [/\bđi\s+([^.!?]*?)\s+v\b/giu, "đi $1 vậy"],
  [/\bcjz\b/giu, "cái gì vậy"],
  [/\bcgi\b/giu, "cái gì"],
  [/\bcj\b/giu, "cái gì"],
  [/\bclg\b/giu, "cái gì"],
  [/\bchs\b/giu, "chơi"],
  [/\blmj\b/giu, "làm gì"],
  [/\bntn\b/giu, "như thế nào"],
  [/\bjz\b/giu, "gì vậy"],
  [/\bgi\s+z\b/giu, "gì vậy"],
  [/\bm[uú]n\b/giu, "muốn"],
  [/\bthui\b/giu, "thôi"],
  [/\brui\b/giu, "rồi"],
  [/\brùi\b/giu, "rồi"],
  [/\bhum\b/giu, "hôm"],
  [/\btnao\b/giu, "thế nào"],
  [/\bngta\b/giu, "người ta"],
];

const TOKEN_REPLACEMENTS: Record<string, string> = {
  ae: "anh em",
  b: "bạn",
  bcuoi: "buồn cười",
  bt: "bình thường",
  bth: "bình thường",
  bthg: "bình thường",
  bthuong: "bình thường",
  bthường: "bình thường",
  cafe: "cà phê",
  cf: "cà phê",
  cty: "công ty",
  cgi: "cái gì",
  chs: "chơi",
  cj: "cái gì",
  cjz: "cái gì vậy",
  ck: "chồng",
  clg: "cái gì",
  cmt: "bình luận",
  cx: "cũng",
  dc: "được",
  đc: "được",
  e: "em",
  hem: "không",
  hk: "không",
  hok: "không",
  hong: "không",
  hum: "hôm",
  ib: "nhắn tin",
  ibox: "nhắn tin",
  inb: "nhắn tin",
  j: "gì",
  jz: "gì vậy",
  k: "không",
  ko: "không",
  khum: "không",
  kp: "không phải",
  lmj: "làm gì",
  m: "mày",
  mik: "mình",
  mk: "mình",
  mn: "mọi người",
  mng: "mọi người",
  mqh: "mối quan hệ",
  mun: "muốn",
  mún: "muốn",
  ncl: "nói chung là",
  nv: "nhân viên",
  ng: "người",
  ngta: "người ta",
  nma: "nhưng mà",
  nt: "nhắn tin",
  ntn: "như thế nào",
  ny: "người yêu",
  nyc: "người yêu cũ",
  r: "rồi",
  rep: "trả lời",
  rl: "rồi",
  rui: "rồi",
  rùi: "rồi",
  t: "tao",
  thui: "thôi",
  tn: "tin nhắn",
  tnao: "thế nào",
  trl: "trả lời",
  v: "vậy",
  vk: "vợ",
  vl: "vãi",
  vs: "với",
  z: "vậy",
  zay: "vậy",
};

export async function prepareNarrationText({
  abbreviations,
  config,
  context,
  kind,
  language,
  mode,
  text,
}: {
  abbreviations?: Record<string, string>;
  config: ToolConfig["video"];
  context?: NarrationTextContext;
  kind: "post" | "comment";
  language?: string;
  mode?: "off" | "rules_only" | "llm_assist";
  text: string;
}): Promise<PreparedNarrationText> {
  const sourceText = normalizeSourceText(removeTtsEmoticons(text));
  const requestedMode = mode ?? "rules_only";

  if (requestedMode === "off") {
    return {
      appliedMode: "off",
      requestedMode,
      finalText: sourceText,
      sourceText,
      usedLlm: false,
      warnings: [],
    };
  }

  const rulesText = normalizeNarrationText(sourceText, abbreviations);
  const spokenRulesText = normalizeVietnameseSocialTextForTts(rulesText);
  if (requestedMode === "rules_only") {
    return {
      appliedMode: "rules_only",
      requestedMode,
      finalText: spokenRulesText,
      sourceText,
      usedLlm: false,
      warnings: [],
    };
  }

  if (!config.openAiApiKey.trim()) {
    return {
      appliedMode: "rules_only",
      requestedMode,
      finalText: spokenRulesText,
      sourceText,
      usedLlm: false,
      warnings: ["LLM API key is missing, fallback to rules_only."],
    };
  }

  try {
    const llmText = await rewriteNarrationTextWithOpenAi({
      apiKey: config.openAiApiKey,
      baseUrl: config.openAiBaseUrl,
      context,
      kind,
      language,
      model: config.openAiModel,
      sourceText,
      text: spokenRulesText,
    });
    const finalized = finalizeVietnameseTtsText({
      llmText,
      sourceText,
      fallbackText: spokenRulesText,
    });

    return {
      appliedMode: "llm_assist",
      requestedMode,
      finalText: finalized.finalText,
      sourceText,
      usedLlm: true,
      warnings: [
        ...(llmText ? [] : ["LLM returned empty text, fallback to rules_only."]),
        ...finalized.warnings,
      ],
    };
  } catch (error) {
    return {
      appliedMode: "rules_only",
      requestedMode,
      finalText: spokenRulesText,
      sourceText,
      usedLlm: false,
      warnings: [
        formatLlmPreprocessWarning(error),
      ],
    };
  }
}

async function rewriteNarrationTextWithOpenAi({
  apiKey,
  baseUrl,
  context,
  kind,
  language,
  model,
  sourceText,
  text,
}: {
  apiKey: string;
  baseUrl: string;
  context?: NarrationTextContext;
  kind: "post" | "comment";
  language?: string;
  model: string;
  sourceText: string;
  text: string;
}): Promise<string> {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You normalize Vietnamese social-media text for Vietnamese text-to-speech. Your job is conservative speech adaptation, not creative rewriting. Expand obvious Vietnamese abbreviations, teencode, shorthand, and chat-style spellings into natural spoken Vietnamese with Vietnamese diacritics, but stay extremely close to the crawl text. Always preserve Vietnamese accents/diacritics; never return unaccented Vietnamese such as 'khong', 'toi', or 'binh thuong'. Keep the original meaning, tone, and wording order whenever possible. Do not add new facts. Do not summarize. Do not explain. Do not beautify the prose. Do not translate whole foreign-language segments unless they are Vietnamese shorthand. Read surrounding context only to resolve slang, pronouns, sarcasm, and implied references. Return JSON only.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "expand_vietnamese_abbreviations_for_tts",
              rules: [
                "Read the main text together with the surrounding context before deciding how to expand any shorthand.",
                "Use the parent post context and nearby comments only to resolve the intended meaning of Vietnamese slang, sarcasm, vague pronouns, and implied references.",
                "Expand remaining Vietnamese abbreviations, teencode, shorthand spellings, and chat-style contractions into natural spoken Vietnamese for TTS.",
                "Prefer phrase-level interpretation over letter-by-letter reading when the shorthand is clearly a collapsed Vietnamese phrase.",
                "If a token is obvious shorthand, do not keep it unchanged just because the sentence is understandable.",
                "Always return Vietnamese with full diacritics when the text is Vietnamese.",
                "Keep punctuation as punctuation symbols. Preserve the source commas, periods, question marks, and exclamation marks that create natural pauses; add a punctuation mark only at an obvious clause boundary when it helps TTS pause naturally.",
                "Never spell a punctuation mark as text: return ',' instead of 'phẩy', '.' instead of 'chấm', and so on.",
                "Examples: 'hen k' -> 'hên không', 'r chung nao' -> 'rồi chừng nào', 'di ... v' -> 'đi ... vậy', 'j' -> 'gì', 'dc' -> 'được', 'ko/k/hk/hok/khum' -> 'không'.",
                "More examples: 'Bthg/bthg/bth/bt/bthuong' -> 'bình thường', 'cafe/cf' -> 'cà phê', 'nma' -> 'nhưng mà', 'chs' -> 'chơi', 'cj/cgi/clg' -> 'cái gì', 'ntn' -> 'như thế nào', 'jz/gi z' -> 'gì vậy', 'z' -> 'vậy', 'thui' -> 'thôi', 'mún/mun' -> 'muốn', 'ib/inb/ibox' -> 'nhắn tin'.",
                "Do not leave obvious shorthand tokens such as 'bthg', 'bth', 'bt', 'dc', 'đc', 'ko', 'nma', 'mn', 'mng', or 'vs' unchanged when they are Vietnamese chat abbreviations.",
                "Pronouns must be expanded using context when possible. Examples: 't, m, b, mk, mik' should become full spoken forms such as 'tôi/tao/tớ', 'mày/mẹ/mình', 'bạn/bồ', 'mình'. If truly ambiguous, choose the most natural spoken Vietnamese in context, not the shorthand token.",
                "For ambiguous shorthand such as 'cj', resolve it from context. If the nearby words clearly indicate a colloquial question phrase, expand to 'cai gi'. If context clearly points to a kinship term or pronoun, choose that instead.",
                "Keep the sentence structure, wording order, and amount of detail as close to the input as possible after expansion.",
                "Do not paraphrase whole clauses when a local token expansion is enough.",
                "Do not intensify or soften emotions beyond what is already present in the crawl text.",
                "Do not replace slang with formal editorial Vietnamese unless TTS would otherwise read it incorrectly.",
                "Do not translate entire English or foreign-language segments into Vietnamese.",
                "Do not paraphrase for style, do not add commentary, and do not summarize away details.",
                "When unsure, prefer the closest spoken form to the original crawl text.",
                "If the text is already natural enough for Vietnamese TTS, return it unchanged.",
                "Remove URLs and low-value hashtags only when they do not affect meaning.",
                "Return exactly one JSON object with a single field finalText.",
              ],
              input: {
                context: {
                  commentSnippets: (context?.commentSnippets ?? [])
                    .map((item) => normalizeSourceText(item))
                    .filter(Boolean)
                    .slice(0, 4),
                  postText: normalizeSourceText(
                    String(context?.postText ?? ""),
                  ).slice(0, 1000),
                  titleHint: normalizeSourceText(
                    String(context?.titleHint ?? ""),
                  ).slice(0, 120),
                  username: normalizeSourceText(
                    String(context?.username ?? ""),
                  ).slice(0, 80),
                },
                kind,
                language: String(language ?? "").trim() || "unknown",
                sourceText,
                normalizedText: text,
              },
            }),
          },
        ],
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(formatLlmHttpError(response.status, body));
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | Array<{ text?: string }> };
    }>;
  };
  const messageContent = payload.choices?.[0]?.message?.content;
  const rawText = Array.isArray(messageContent)
    ? messageContent
        .map((item) => String(item?.text ?? "").trim())
        .filter(Boolean)
        .join("\n")
        .trim()
    : String(messageContent ?? "").trim();

  const parsed = safeParseJson(rawText);
  const finalText = normalizeSourceText(String(parsed?.finalText ?? ""));
  return finalText.slice(0, 5000);
}

export async function suggestDialogueLineTexts({
  abbreviations,
  config,
  contextText,
  lines,
}: {
  abbreviations?: Record<string, string>;
  config: ToolConfig["video"];
  contextText?: string;
  lines: DialogueTextSuggestionLine[];
}): Promise<DialogueTextSuggestionLine[]> {
  if (!config.openAiApiKey.trim()) {
    return lines.map((line) => ({
      ...line,
      text: normalizeVietnameseSocialTextForTts(
        normalizeNarrationText(line.text, abbreviations),
      ),
    }));
  }

  const response = await fetch(
    `${config.openAiBaseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.openAiModel,
        temperature: 0.1,
        max_tokens: 1600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Bạn sửa văn bản OCR của hội thoại tiếng Việt để đọc TTS. Hãy khôi phục dấu tiếng Việt, sửa lỗi OCR và mở rộng từ viết tắt theo ngữ cảnh toàn cuộc trò chuyện. Giữ nguyên ý, giọng điệu thân mật và cách xưng hô; không sáng tác, không kiểm duyệt, không tóm tắt. Bắt buộc giữ nguyên từng id, speaker, số dòng và thứ tự. Không gộp hoặc tách dòng. Chỉ trả JSON.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "restore_vietnamese_dialogue_for_tts",
              rules: [
                "Mỗi dòng đầu ra phải có đúng id và speaker của dòng đầu vào.",
                "Chỉ sửa trường text; không thêm hoặc xóa dòng.",
                "Khôi phục dấu dựa trên câu trước, câu sau và người đang nói.",
                "Mở rộng viết tắt, teencode và cách viết không dấu thành câu tiếng Việt tự nhiên để TTS đọc.",
                "Giữ dấu câu dạng ký tự để TTS ngắt nghỉ tự nhiên; chỉ thêm dấu ở chỗ ngắt mệnh đề rõ ràng và tuyệt đối không đổi ',' thành chữ 'phẩy'.",
                "Giữ tiếng lóng và sắc thái hội thoại nếu TTS vẫn đọc hiểu được.",
                "Nếu một từ thật sự mơ hồ, ưu tiên cách sửa gần văn bản gốc nhất.",
                "Trả đúng dạng {\"lines\":[{\"id\":\"...\",\"speaker\":\"A\",\"text\":\"...\"}]}.",
              ],
              contextText: normalizeSourceText(contextText ?? "").slice(0, 1500),
              abbreviations: Object.fromEntries(
                Object.entries(abbreviations ?? {}).slice(0, 200),
              ),
              lines: lines.map((line) => ({
                id: line.id,
                speaker: line.speaker,
                text: normalizeSourceText(line.text).slice(0, 1000),
              })),
            }),
          },
        ],
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(formatLlmHttpError(response.status, body));
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  const rawText = Array.isArray(content)
    ? content.map((item) => String(item?.text ?? "")).join("\n").trim()
    : String(content ?? "").trim();
  const parsed = safeParseDialogueSuggestion(rawText);
  if (parsed.length !== lines.length || new Set(parsed.map((line) => line.id)).size !== lines.length) {
    throw new Error("AI trả sai số lượng dòng hội thoại. Nội dung cũ được giữ nguyên.");
  }
  const suggestions = new Map(
    parsed.map((line) => [line.id, line]),
  );

  return lines.map((line) => {
    const suggestion = suggestions.get(line.id);
    if (!suggestion || suggestion.speaker !== line.speaker) {
      throw new Error(`AI trả kết quả không khớp dòng ${line.id}.`);
    }
    const text = replaceSpelledTtsCommas(
      normalizeVietnameseSocialTextForTts(
        normalizeNarrationText(suggestion.text, abbreviations),
      ),
    );
    if (!text) throw new Error(`AI trả nội dung rỗng cho dòng ${line.id}.`);
    return { ...line, text };
  });
}

function safeParseDialogueSuggestion(value: string): DialogueTextSuggestionLine[] {
  try {
    const parsed = JSON.parse(value) as { lines?: unknown };
    if (!Array.isArray(parsed.lines)) return [];
    return parsed.lines
      .map((value) => {
        if (!value || typeof value !== "object") return null;
        const line = value as Record<string, unknown>;
        const speaker = String(line.speaker ?? "");
        if (speaker !== "A" && speaker !== "B" && speaker !== "unknown") return null;
        return {
          id: String(line.id ?? "").trim(),
          speaker,
          text: String(line.text ?? "").trim(),
        } satisfies DialogueTextSuggestionLine;
      })
      .filter((line): line is DialogueTextSuggestionLine => Boolean(line?.id));
  } catch {
    return [];
  }
}

function safeParseJson(value: string): { finalText?: string } | null {
  try {
    return JSON.parse(value) as { finalText?: string };
  } catch {
    return null;
  }
}

function normalizeSourceText(value: string): string {
  return String(value ?? "").replace(/[^\S\r\n]+/g, " ").trim().slice(0, 5000);
}

function formatLlmPreprocessWarning(error: unknown): string {
  if (!(error instanceof Error)) {
    return "LLM lỗi không xác định.";
  }

  return error.message || "LLM lỗi không xác định.";
}

function formatLlmHttpError(status: number, body: string): string {
  const normalizedBody = String(body ?? "").toLowerCase();

  if (
    status === 429 ||
    normalizedBody.includes("quota") ||
    normalizedBody.includes("rate limit") ||
    normalizedBody.includes("resource_exhausted")
  ) {
    return "Provider trả 429: hết quota hoặc rate limit. Kiểm tra billing/quota/API key.";
  }

  if (status === 401 || status === 403) {
    return "Provider từ chối API key. Kiểm tra lại key, quyền truy cập model và base URL.";
  }

  if (status >= 500) {
    return `Provider LLM đang lỗi (${status}). Thử lại sau hoặc đổi model/provider.`;
  }

  return `Provider LLM trả lỗi HTTP ${status}. Kiểm tra model, base URL và API key.`;
}

function finalizeVietnameseTtsText({
  llmText,
  sourceText,
  fallbackText,
}: {
  llmText: string;
  sourceText: string;
  fallbackText: string;
}): { finalText: string; warnings: string[] } {
  const warnings: string[] = [];
  const candidate = normalizeSourceText(llmText || fallbackText);
  const normalizedCandidate = replaceSpelledTtsCommas(
    normalizeVietnameseSocialTextForTts(candidate),
  );
  const normalizedFallback = normalizeVietnameseSocialTextForTts(fallbackText);
  if (
    shouldFallbackBecauseVietnameseAccentsWereLost({
      candidateText: normalizedCandidate,
      fallbackText: normalizedFallback,
      sourceText,
    })
  ) {
    warnings.push(
      "LLM rewrite removed too many Vietnamese accents, fallback to conservative rewrite.",
    );
    return {
      finalText: normalizedFallback,
      warnings,
    };
  }

  if (
    shouldFallbackToConservativeRewrite({
      candidateText: normalizedCandidate,
      fallbackText: normalizedFallback,
      sourceText,
    })
  ) {
    warnings.push(
      "LLM rewrite was too different from crawl text, fallback to conservative rewrite.",
    );
    return {
      finalText: normalizedFallback,
      warnings,
    };
  }

  if (!looksLikeVietnameseSocialShorthand(sourceText)) {
    return {
      finalText: normalizedCandidate,
      warnings,
    };
  }

  if (!containsUnexpandedVietnameseShorthand(normalizedCandidate)) {
    return {
      finalText: normalizedCandidate,
      warnings,
    };
  }

  return {
    finalText: normalizeSourceText(
      normalizedFallback.length >= normalizedCandidate.length
        ? normalizedFallback
        : normalizedCandidate,
    ),
    warnings,
  };
}

function normalizeVietnameseSocialTextForTts(value: string): string {
  let next = normalizeSourceText(value);
  next = applyOrderedRegexReplacements(next, PHRASE_REPLACEMENTS);
  next = applyTokenReplacementMap(next, TOKEN_REPLACEMENTS);
  return normalizeSourceText(next);
}

function applyOrderedRegexReplacements(
  value: string,
  replacements: Array<[RegExp, string]>,
): string {
  let next = value;
  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function applyTokenReplacementMap(
  value: string,
  replacements: Record<string, string>,
): string {
  return value.replace(/[\p{L}\p{N}_]+/gu, (segment) => {
    const replacement = replacements[segment.toLowerCase()];
    return replacement ?? segment;
  });
}

function looksLikeVietnameseSocialShorthand(value: string): boolean {
  return SOCIAL_SHORTHAND_RE.test(value);
}

function containsUnexpandedVietnameseShorthand(value: string): boolean {
  return SOCIAL_SHORTHAND_RE.test(value);
}

function shouldFallbackBecauseVietnameseAccentsWereLost({
  candidateText,
  fallbackText,
  sourceText,
}: {
  candidateText: string;
  fallbackText: string;
  sourceText: string;
}): boolean {
  const expectedAccentCount = Math.max(
    countVietnameseAccentChars(sourceText),
    countVietnameseAccentChars(fallbackText),
  );
  if (expectedAccentCount < 3) {
    return false;
  }

  const candidateAccentCount = countVietnameseAccentChars(candidateText);
  if (candidateAccentCount >= Math.ceil(expectedAccentCount * 0.55)) {
    return false;
  }

  const candidateSimilarity = tokenSimilarity(
    comparableTokens(candidateText),
    comparableTokens(fallbackText),
  );
  return candidateSimilarity.recall >= 0.65;
}

function countVietnameseAccentChars(value: string): number {
  return String(value ?? "").match(VIETNAMESE_ACCENT_RE)?.length ?? 0;
}

function shouldFallbackToConservativeRewrite({
  candidateText,
  fallbackText,
  sourceText,
}: {
  candidateText: string;
  fallbackText: string;
  sourceText: string;
}): boolean {
  const candidateTokens = comparableTokens(candidateText);
  const fallbackTokens = comparableTokens(fallbackText);
  if (candidateTokens.length === 0 || fallbackTokens.length === 0) {
    return false;
  }

  const candidateVsFallback = tokenSimilarity(candidateTokens, fallbackTokens);
  const candidateVsSource = tokenSimilarity(
    candidateTokens,
    comparableTokens(sourceText),
  );
  const lengthRatio =
    candidateTokens.length / Math.max(1, fallbackTokens.length);

  if (lengthRatio < 0.65 || lengthRatio > 1.45) {
    return true;
  }
  if (candidateVsFallback.recall < 0.72) {
    return true;
  }
  if (candidateVsFallback.precision < 0.58) {
    return true;
  }
  if (candidateVsSource.recall < 0.45 && candidateVsFallback.precision < 0.7) {
    return true;
  }
  return false;
}

function comparableTokens(value: string): string[] {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function tokenSimilarity(
  leftTokens: string[],
  rightTokens: string[],
): { precision: number; recall: number } {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return { precision: 1, recall: 1 };
  }

  const leftCounts = tokenFrequencyMap(leftTokens);
  const rightCounts = tokenFrequencyMap(rightTokens);
  let shared = 0;

  for (const [token, count] of leftCounts.entries()) {
    shared += Math.min(count, rightCounts.get(token) ?? 0);
  }

  return {
    precision: shared / leftTokens.length,
    recall: shared / rightTokens.length,
  };
}

function tokenFrequencyMap(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
