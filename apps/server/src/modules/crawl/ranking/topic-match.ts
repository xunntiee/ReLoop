import type { RawPost, TopicFilter, TopicMatch } from "../types.js";
import { containsKeyword } from "../utils/text.js";

export function evaluateTopicMatch(post: RawPost, topic: TopicFilter): TopicMatch {
  const text = String(post.text ?? "");
  const matchedQuery = String(post.matched_query ?? "").trim();
  const matchedKeywords = matchedValues(text, topic.keywords);
  const matchedRequired = matchedValues(text, topic.required_keywords);
  const missingRequired = topic.required_keywords.filter(
    (keyword) => !matchedRequired.some((matched) => matched.toLowerCase() === keyword.toLowerCase())
  );
  const matchedExcluded = matchedValues(text, topic.excluded_keywords);
  const matchedLexicon = matchedValues(text, flattenLexicon(topic));

  const titleIntentScore = Math.max(
    phraseCoverage(text, topic.topic_title),
    phraseCoverage(text, topic.topic_intent || topic.topic_title),
  );
  const queryScore = listCoverage(text, [
    ...topic.search_queries,
    ...topic.query_variants,
    matchedQuery,
  ]);
  const keywordScore = listCoverage(text, topic.keywords);
  const canonicalLexiconScore = listCoverage(text, [
    ...topic.lexicon.canonical,
    ...topic.lexicon.no_diacritics,
  ]);
  const slangLexiconScore = listCoverage(text, [
    ...topic.lexicon.abbreviations,
    ...topic.lexicon.teencode,
  ]);
  const requiredScore =
    topic.required_keywords.length === 0
      ? 0
      : topic.required_keywords_mode === "all"
        ? matchedRequired.length / topic.required_keywords.length
        : matchedRequired.length > 0
          ? 1
          : 0;
  const penalty = matchedExcluded.length > 0 ? 0.4 : 0;
  const score = clamp(
    titleIntentScore * 0.4 +
      queryScore * 0.2 +
      keywordScore * 0.16 +
      canonicalLexiconScore * 0.12 +
      slangLexiconScore * 0.06 +
      requiredScore * 0.1 -
      penalty,
    0,
    1,
  );

  return {
    score: round(score, 3),
    matched_excluded_keywords: matchedExcluded,
    matched_keywords: matchedKeywords,
    matched_lexicon: matchedLexicon,
    matched_query: matchedQuery,
    matched_required_keywords: matchedRequired,
    missing_required_keywords: missingRequired,
    required_keywords_mode: topic.required_keywords_mode,
  };
}

function flattenLexicon(topic: TopicFilter): string[] {
  return [
    ...topic.lexicon.canonical,
    ...topic.lexicon.abbreviations,
    ...topic.lexicon.teencode,
    ...topic.lexicon.no_diacritics,
  ];
}

function matchedValues(text: string, values: string[]): string[] {
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    if (!containsKeyword(text, value)) continue;
    seen.add(key);
    matches.push(value);
  }
  return matches;
}

function phraseCoverage(text: string, phrase: string): number {
  const value = phrase.trim();
  if (!value) return 0;
  if (containsKeyword(text, value)) return 1;

  const tokens = value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) return 0;

  const matchedCount = tokens.filter((token) => containsKeyword(text, token)).length;
  return matchedCount / tokens.length;
}

function listCoverage(text: string, values: string[]): number {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length === 0) return 0;
  const matchedCount = matchedValues(text, cleaned).length;
  return matchedCount / cleaned.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
