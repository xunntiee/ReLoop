export type CommentEmotion =
  | "supportive"
  | "funny"
  | "angry"
  | "curious"
  | "neutral";

const SUPPORTIVE_KEYWORDS = [
  "thuong",
  "yeu",
  "de thuong",
  "toi nghiep",
  "xot",
  "xot xa",
  "dong cam",
  "co len",
  "hay qua",
  "gioi qua",
  "dang yeu",
  "dung roi",
  "chuan",
  "ong ba",
];

const FUNNY_KEYWORDS = [
  "haha",
  "hihi",
  "hehe",
  "kkk",
  "lol",
  "lmao",
  "cuoi",
  "xiu",
  "hai",
  "buon cuoi",
  "te ghe",
];

const ANGRY_KEYWORDS = [
  "buc",
  "buc minh",
  "cay",
  "ghet",
  "dien",
  "uc",
  "vo ly",
  "xam",
  "soc",
  "toang",
  "wtf",
  "khung khiep",
];

const CURIOUS_KEYWORDS = [
  "tai sao",
  "vi sao",
  "sao vay",
  "sao the",
  "sao lai",
  "o dau",
  "bao nhieu",
  "the nao",
  "that khong",
  "duoc khong",
  "co that khong",
  "ua sao",
];

const EMOTION_PATTERNS = {
  supportive: [
    /\bthuong\b/u,
    /\byeu\b/u,
    /\btoi nghiep\b/u,
    /\bxot\b/u,
    /\bdang yeu\b/u,
    /\bco len\b/u,
    /\bhay qua\b/u,
    /\bgioi qua\b/u,
  ],
  funny: [
    /\bhaha+\b/u,
    /\bhihi+\b/u,
    /\bhehe+\b/u,
    /\bcuoi\b/u,
    /\bxiu\b/u,
    /\bhai\b/u,
    /\bbuon cuoi\b/u,
  ],
  angry: [
    /\bbuc\b/u,
    /\bcay\b/u,
    /\bghet\b/u,
    /\bdien\b/u,
    /\buc che\b/u,
    /\bvo ly\b/u,
    /\bwtf\b/u,
  ],
  curious: [
    /\btai sao\b/u,
    /\bvi sao\b/u,
    /\bsao vay\b/u,
    /\bsao the\b/u,
    /\bsao lai\b/u,
    /\bua sao\b/u,
    /\bo dau\b/u,
    /\bbao nhieu\b/u,
    /\bduoc khong\b/u,
  ],
} as const;

export function detectCommentEmotion(input: string): CommentEmotion {
  const text = String(input ?? "").trim();
  if (!text) {
    return "neutral";
  }

  const normalized = normalizeForEmotionMatch(text);
  const scores = {
    supportive: scoreEmotion(normalized, SUPPORTIVE_KEYWORDS, EMOTION_PATTERNS.supportive),
    funny: scoreEmotion(normalized, FUNNY_KEYWORDS, EMOTION_PATTERNS.funny),
    angry: scoreEmotion(normalized, ANGRY_KEYWORDS, EMOTION_PATTERNS.angry),
    curious: scoreEmotion(normalized, CURIOUS_KEYWORDS, EMOTION_PATTERNS.curious),
  };

  if (/(😡|🤬|😤)/u.test(text)) {
    scores.angry += 4;
  }
  if (/(:v|🤣|😂)/u.test(text)) {
    scores.funny += 4;
  }
  if (/(🥺|❤️|💖|😭|👏|🙏)/u.test(text)) {
    scores.supportive += 4;
  }
  if (/[?？]/u.test(text)) {
    scores.curious += 2;
  }

  const ranked = Object.entries(scores).sort((left, right) => {
    const scoreDiff = right[1] - left[1];
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const emotionPriority = ["angry", "funny", "supportive", "curious"];
    return (
      emotionPriority.indexOf(left[0] as keyof typeof scores) -
      emotionPriority.indexOf(right[0] as keyof typeof scores)
    );
  });

  const [topEmotion, topScore] = ranked[0] ?? ["neutral", 0];
  if (topScore <= 0) {
    return "neutral";
  }

  return topEmotion as CommentEmotion;
}

function scoreEmotion(
  text: string,
  keywords: string[],
  patterns: readonly RegExp[]
): number {
  let score = 0;

  for (const keyword of keywords) {
    if (containsPhrase(text, keyword)) {
      score += keyword.includes(" ") ? 3 : 2;
    }
  }

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      score += 2;
    }
  }

  return score;
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = escapeRegExp(phrase.trim());
  if (!escaped) {
    return false;
  }

  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "u").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForEmotionMatch(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
