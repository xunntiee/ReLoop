import type { ToolConfig } from "@tool-base/config/schema";
import { detectCommentEmotion } from "./comment-emotion.js";
import type { VideoVoiceSettings } from "./types.js";
import {
  getBuiltInVivibeVoices,
  VIVIBE_NAM_AM_TRENDY_VOICE_ID,
  VIVIBE_NU_KE_CHUYEN_VOICE_ID,
  VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
  VIVIBE_LAN_HUONG_VOICE_ID,
  VIVIBE_MAI_ANH_TAI_VOICE_ID,
  PREFERRED_VIVIBE_ADAM_VOICE_ID,
  VIVIBE_THAO_VY_VOICE_ID,
} from "./vivibe-voice-presets.js";
import type { VivibeVoiceItem } from "./vivibe-tts.js";

const VIVIBE_EMOTION_SWITCH_MIN_SCORE = 140;
const VIVIBE_EMOTION_SWITCH_MIN_DELTA = 90;
const PREFERRED_VIVIBE_RANDOM_VOICE_IDS = [
  VIVIBE_NU_KE_CHUYEN_VOICE_ID,
  VIVIBE_NAM_AM_TRENDY_VOICE_ID,
  VIVIBE_THAO_VY_VOICE_ID,
  VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
  PREFERRED_VIVIBE_ADAM_VOICE_ID,
] as const;
const PREFERRED_VIVIBE_FEMALE_COMMENT_IDS = [
  VIVIBE_NU_KE_CHUYEN_VOICE_ID,
  VIVIBE_THAO_VY_VOICE_ID,
  VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
] as const;
const PREFERRED_VIVIBE_MALE_COMMENT_IDS = [
  VIVIBE_NAM_AM_TRENDY_VOICE_ID,
  PREFERRED_VIVIBE_ADAM_VOICE_ID,
] as const;

export function resolveSceneVoiceProfile({
  commentText,
  commentSequenceIndex,
  config,
  kind,
  previousCommentGender,
  previousCommentVoiceName,
  previousSceneKind,
  requestedVoice,
  commentVoiceMode = "fixed",
  sceneId,
  vivibeVoices = [],
}: {
  commentText?: string;
  commentSequenceIndex?: number;
  config: ToolConfig["video"];
  kind: "comment" | "post";
  previousCommentGender?: VideoVoiceSettings["ssmlGender"] | null;
  previousCommentVoiceName?: string | null;
  previousSceneKind?: "comment" | "post" | null;
  requestedVoice: VideoVoiceSettings | null;
  commentVoiceMode?: "emotion" | "fixed";
  sceneId?: string;
  vivibeVoices?: VivibeVoiceItem[];
}): VideoVoiceSettings {
  const baseVoice = requestedVoice ?? defaultVoiceFromConfig(config);

  if (commentVoiceMode === "fixed") {
    return baseVoice;
  }

  if (kind === "post" && baseVoice.provider === "vivibe") {
    return resolveVivibePostVoice(baseVoice, sceneId, vivibeVoices);
  }

  if (kind === "post") {
    return baseVoice;
  }

  return resolveEmotionVoice(
    baseVoice,
    commentText,
    commentSequenceIndex,
    sceneId,
    vivibeVoices,
    previousCommentGender,
    previousCommentVoiceName,
    previousSceneKind
  );
}

function resolveEmotionVoice(
  baseVoice: VideoVoiceSettings,
  commentText?: string,
  commentSequenceIndex?: number,
  sceneId?: string,
  vivibeVoices: VivibeVoiceItem[] = [],
  previousCommentGender?: VideoVoiceSettings["ssmlGender"] | null,
  previousCommentVoiceName?: string | null,
  previousSceneKind?: "comment" | "post" | null
): VideoVoiceSettings {
  const emotion = detectCommentEmotion(commentText ?? "");

  if (baseVoice.provider === "fpt_ai") {
    return resolveFptEmotionVoice(baseVoice, emotion, previousCommentGender);
  }

  if (baseVoice.provider === "vivibe") {
    return resolveVivibeEmotionVoice(
      baseVoice,
      emotion,
      commentSequenceIndex,
      sceneId,
      vivibeVoices,
      previousCommentGender,
      previousCommentVoiceName,
      previousSceneKind
    );
  }

  if (baseVoice.provider === "ausynclab") {
    return baseVoice;
  }

  return resolveGoogleEmotionVoice(baseVoice, emotion, previousCommentGender);
}

function resolveVivibePostVoice(
  baseVoice: VideoVoiceSettings,
  sceneId: string | undefined,
  vivibeVoices: VivibeVoiceItem[]
): VideoVoiceSettings {
  const voices = collectVivibePreferredVoices(vivibeVoices);
  const userVoiceId = String(baseVoice.voiceName ?? "").trim();
  const matchedVoice = voices.find((voice) => voice.id === userVoiceId);

  if (matchedVoice) {
    return {
      ...baseVoice,
      provider: "vivibe",
      ssmlGender: matchedVoice.gender,
      voiceName: matchedVoice.id,
    };
  }

  if (userVoiceId) {
    return {
      ...baseVoice,
      provider: "vivibe",
      ssmlGender: baseVoice.ssmlGender || inferVivibeVoiceGenderByIdOrName(userVoiceId, ""),
      voiceName: userVoiceId,
    };
  }

  const fallbackVoice =
    voices.find((voice) => voice.id === PREFERRED_VIVIBE_ADAM_VOICE_ID) ??
    voices[0];

  if (!fallbackVoice) {
    return baseVoice;
  }

  return {
    ...baseVoice,
    provider: "vivibe",
    ssmlGender: fallbackVoice.gender,
    voiceName: fallbackVoice.id,
  };
}

function resolveVivibeEmotionVoice(
  baseVoice: VideoVoiceSettings,
  emotion: ReturnType<typeof detectCommentEmotion>,
  commentSequenceIndex: number | undefined,
  sceneId: string | undefined,
  vivibeVoices: VivibeVoiceItem[],
  previousCommentGender?: VideoVoiceSettings["ssmlGender"] | null,
  previousCommentVoiceName?: string | null,
  previousSceneKind?: "comment" | "post" | null
): VideoVoiceSettings {
  const voices = collectVivibePreferredVoices(vivibeVoices);
  const candidateVoices = voices;

  const baseVoiceId = String(baseVoice.voiceName ?? "").trim();
  const baseVoiceEntry =
    candidateVoices.find((voice) => voice.id === baseVoiceId) ??
    (baseVoiceId
      ? {
          gender:
            baseVoice.ssmlGender === "MALE" || baseVoice.ssmlGender === "FEMALE"
              ? baseVoice.ssmlGender
              : inferVivibeVoiceGenderByIdOrName(baseVoiceId, ""),
          id: baseVoiceId,
          name: baseVoiceId,
        }
      : candidateVoices.find((voice) => voice.id === PREFERRED_VIVIBE_ADAM_VOICE_ID) ??
        candidateVoices[0]);
  if (!baseVoiceEntry) {
    return baseVoice;
  }

  const preferredVoice = pickVivibeVoiceForEmotion({
    baseVoice: baseVoiceEntry,
    baseVoiceId: baseVoiceEntry.id,
    baseVoiceGender:
      baseVoice.ssmlGender === "MALE" || baseVoice.ssmlGender === "FEMALE"
        ? baseVoice.ssmlGender
        : baseVoiceEntry.gender,
    commentSequenceIndex,
    emotion,
    previousCommentGender,
    previousCommentVoiceName,
    previousSceneKind,
    sceneId,
    voices: candidateVoices,
  });
  if (!preferredVoice || preferredVoice.id === baseVoiceEntry.id) {
    return {
      ...baseVoice,
      provider: "vivibe",
      ssmlGender: baseVoiceEntry.gender,
      voiceName: baseVoiceEntry.id,
    };
  }

  return {
    ...baseVoice,
    provider: "vivibe",
    ssmlGender: inferVivibeVoiceGenderByIdOrName(preferredVoice.id, preferredVoice.name),
    voiceName: preferredVoice.id,
  };
}

function pickVivibeVoiceForEmotion({
  baseVoice,
  baseVoiceId,
  baseVoiceGender,
  commentSequenceIndex,
  emotion,
  previousCommentGender,
  previousCommentVoiceName,
  previousSceneKind,
  sceneId,
  voices,
}: {
  baseVoice: {
    gender: VideoVoiceSettings["ssmlGender"];
    id: string;
    name: string;
  };
  baseVoiceId: string;
  baseVoiceGender: VideoVoiceSettings["ssmlGender"];
  commentSequenceIndex?: number;
  emotion: ReturnType<typeof detectCommentEmotion>;
  previousCommentGender?: VideoVoiceSettings["ssmlGender"] | null;
  previousCommentVoiceName?: string | null;
  previousSceneKind?: "comment" | "post" | null;
  sceneId?: string;
  voices: Array<{
    gender: VideoVoiceSettings["ssmlGender"];
    id: string;
    name: string;
  }>;
}): { gender: VideoVoiceSettings["ssmlGender"]; id: string; name: string } | null {
  const sorted = [...voices].sort((left, right) => {
    const scoreDiff =
      scoreVivibeEmotionVoice(right, emotion) -
      scoreVivibeEmotionVoice(left, emotion);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.name.localeCompare(right.name);
  });

  const genderPools = buildVivibeCommentGenderPools({
    emotion,
    voices: sorted,
  });

  const preferredVoiceIds = preferredVivibeVoiceIdsForEmotion(emotion);
  const targetGender = resolveVivibeCommentTargetGender({
    baseVoiceGender,
    commentSequenceIndex,
    previousCommentGender,
    previousSceneKind,
  });
  const prioritizedVoiceIds = dedupeVoiceIds([
    ...prioritizeVivibeVoiceIdsForTransition(
      preferredVoiceIds,
      targetGender,
      previousCommentVoiceName,
      previousSceneKind
    ),
    ...sorted.map((voice) => voice.id),
  ]);
  const preferredVoices = prioritizedVoiceIds
    .map((voiceId) => sorted.find((voice) => voice.id === voiceId))
    .filter(
      (
        voice
      ): voice is {
        gender: VideoVoiceSettings["ssmlGender"];
        id: string;
        name: string;
      } => Boolean(voice)
    );
  const alternatingPreferredVoices = filterTargetGenderCandidates(preferredVoices, targetGender);

  const directPool =
    targetGender === "FEMALE"
      ? genderPools.female
      : targetGender === "MALE"
        ? genderPools.male
        : [];
  const directCandidate = pickRotatingVivibeVoice({
    avoidVoiceIds: [baseVoiceId],
    pool: directPool,
    previousCommentVoiceName,
    rotationSeed: `${sceneId ?? ""}|${emotion}|${baseVoiceId}|${commentSequenceIndex ?? -1}|direct`,
  });
  if (directCandidate) {
    return directCandidate;
  }

  if (alternatingPreferredVoices.length > 0) {
    const rotationSeed = `${sceneId ?? ""}|${emotion}|${baseVoiceId}`;
    const offset = positiveHash(rotationSeed) % alternatingPreferredVoices.length;

    for (let index = 0; index < alternatingPreferredVoices.length; index += 1) {
      const candidate =
        alternatingPreferredVoices[(offset + index) % alternatingPreferredVoices.length];
      if (candidate && candidate.id !== baseVoiceId) {
        return candidate;
      }
    }
  }

  if (preferredVoices.length > 0) {
    const rotationSeed = `${sceneId ?? ""}|${emotion}|${baseVoiceId}`;
    const offset = positiveHash(rotationSeed) % preferredVoices.length;

    for (let index = 0; index < preferredVoices.length; index += 1) {
      const candidate = preferredVoices[(offset + index) % preferredVoices.length];
      if (candidate && candidate.id !== baseVoiceId) {
        return candidate;
      }
    }
  }

  const baseScore = scoreVivibeEmotionVoice(baseVoice, emotion);
  const alternatingSorted = filterTargetGenderCandidates(sorted, targetGender);
  const preferredAlternate = alternatingSorted.find((voice) => {
    if (voice.id === baseVoiceId) {
      return false;
    }

    const candidateScore = scoreVivibeEmotionVoice(voice, emotion);
    return (
      candidateScore >= VIVIBE_EMOTION_SWITCH_MIN_SCORE &&
      candidateScore - baseScore >= VIVIBE_EMOTION_SWITCH_MIN_DELTA
    );
  });
  if (preferredAlternate) {
    return preferredAlternate;
  }

  return baseVoice;
}

function buildVivibeCommentGenderPools({
  emotion,
  voices,
}: {
  emotion: ReturnType<typeof detectCommentEmotion>;
  voices: Array<{
    gender: VideoVoiceSettings["ssmlGender"];
    id: string;
    name: string;
  }>;
}): {
  female: Array<{
    gender: VideoVoiceSettings["ssmlGender"];
    id: string;
    name: string;
  }>;
  male: Array<{
    gender: VideoVoiceSettings["ssmlGender"];
    id: string;
    name: string;
  }>;
} {
  const femalePriority = new Map<string, number>(
    PREFERRED_VIVIBE_FEMALE_COMMENT_IDS.map((id, index) => [id, index])
  );
  const malePriority = new Map<string, number>(
    PREFERRED_VIVIBE_MALE_COMMENT_IDS.map((id, index) => [id, index])
  );

  const female = [...voices]
    .filter((voice) => voice.gender === "FEMALE")
    .sort(
      (left, right) =>
        scoreVivibeCommentVoiceForGender(right, emotion, "FEMALE") -
          scoreVivibeCommentVoiceForGender(left, emotion, "FEMALE") ||
        (femalePriority.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (femalePriority.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name)
    );
  const male = [...voices]
    .filter((voice) => voice.gender === "MALE")
    .sort(
      (left, right) =>
        scoreVivibeCommentVoiceForGender(right, emotion, "MALE") -
          scoreVivibeCommentVoiceForGender(left, emotion, "MALE") ||
        (malePriority.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (malePriority.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name)
    );

  const preferredFemale = female.filter(
    (voice) =>
      voice.id !== VIVIBE_LAN_HUONG_VOICE_ID &&
      scoreVivibeCommentVoiceForGender(voice, emotion, "FEMALE") > 0
  );
  const pinnedFemale = [
    female.find((voice) => voice.id === VIVIBE_THAO_VY_VOICE_ID),
    ...preferredFemale.filter((voice) => voice.id !== VIVIBE_THAO_VY_VOICE_ID),
  ].filter(Boolean) as Array<{
    gender: VideoVoiceSettings["ssmlGender"];
    id: string;
    name: string;
  }>;
  const normalizedFemale = dedupeVivibeVoicePool([...pinnedFemale, ...female]).slice(0, 3);

  const preferredMale = male.filter(
    (voice) =>
      voice.id !== VIVIBE_MAI_ANH_TAI_VOICE_ID &&
      scoreVivibeCommentVoiceForGender(voice, emotion, "MALE") > -20
  );
  const pinnedMale = [
    ...preferredMale.filter((voice) => voice.id !== PREFERRED_VIVIBE_ADAM_VOICE_ID),
    male.find((voice) => voice.id === PREFERRED_VIVIBE_ADAM_VOICE_ID),
  ].filter(Boolean) as Array<{
    gender: VideoVoiceSettings["ssmlGender"];
    id: string;
    name: string;
  }>;
  const normalizedMale = dedupeVivibeVoicePool(pinnedMale).slice(0, 2);

  return {
    female: normalizedFemale,
    male:
      normalizedMale.length > 0
        ? normalizedMale
        : voices.filter(
            (voice) =>
              voice.gender === "MALE" &&
              voice.id === PREFERRED_VIVIBE_ADAM_VOICE_ID
          ),
  };
}

function scoreVivibeCommentVoiceForGender(
  voice: { id: string; name: string },
  emotion: ReturnType<typeof detectCommentEmotion>,
  targetGender: "FEMALE" | "MALE"
): number {
  const haystack = `${voice.name} ${voice.id}`.toLowerCase();
  if (isExcludedVivibeCommentVoice(voice.name, voice.id)) {
    return -10_000;
  }
  let score = scoreVivibeEmotionVoice(voice, emotion);

  if (targetGender === "FEMALE") {
    if (voice.id === VIVIBE_NU_KE_CHUYEN_VOICE_ID) score += 240;
    if (voice.id === VIVIBE_THAO_VY_VOICE_ID) score += 220;
    if (voice.id === VIVIBE_NU_TAM_CHUYEN_VOICE_ID) score += 200;
    if (voice.id === VIVIBE_LAN_HUONG_VOICE_ID) score -= 420;
    if (/(bright|young|chatty|cute|soft|sweet|clear|story|gentle|warm|playful|fresh|teen|ke chuyen|tam chuyen|tre sang|wavenet|ro rang|conversational|natural)/.test(haystack)) {
      score += 130;
    }
    if (/(formal|old|robot|news|serious|harsh|shrill|thin|metallic|nasal|broadcast|anchor|lan huong)/.test(haystack)) {
      score -= 220;
    }
  } else {
    if (voice.id === VIVIBE_NAM_AM_TRENDY_VOICE_ID) score += 240;
    if (voice.id === PREFERRED_VIVIBE_ADAM_VOICE_ID) score += 180;
    if (voice.id === VIVIBE_MAI_ANH_TAI_VOICE_ID) score -= 520;
    if (/(warm|natural|podcast|story|clear|friendly|smooth|young|trendy|casual|playful|ke chuyen|tam chuyen|am|conversational|gen z|genz)/.test(haystack)) {
      score += 150;
    }
    if (/(deep|baritone|news|formal|serious|robot|old|anchor|broadcast|mai anh tai)/.test(haystack)) {
      score -= 260;
    }
  }

  return score;
}

function collectVivibePreferredVoices(vivibeVoices: VivibeVoiceItem[]): Array<{
  gender: VideoVoiceSettings["ssmlGender"];
  id: string;
  name: string;
}> {
  const merged = dedupeVivibeVoicePool([...getBuiltInVivibeVoices(), ...vivibeVoices]);
  return merged
    .filter((voice) => String(voice.id ?? "").trim())
    .filter((voice) => !isExcludedVivibeCommentVoice(String(voice.name ?? ""), String(voice.id ?? "")))
    .map((voice) => ({
      gender: inferVivibeVoiceGenderByIdOrName(
        String(voice.id ?? "").trim(),
        String(voice.name ?? "").trim()
      ),
      id: String(voice.id ?? "").trim(),
      name: String(voice.name ?? "").trim(),
    }));
}

function dedupeVivibeVoicePool<T extends { id?: string; name?: string }>(voices: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const voice of voices) {
    const id = String(voice.id ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(voice);
  }
  return deduped;
}

function isExcludedVivibeCommentVoice(name: string, id: string): boolean {
  const haystack = `${name} ${id}`.toLowerCase();
  return (
    isBlockedVivibeCommentVoice(name, id) ||
    haystack.includes("lan huong") ||
    haystack.includes("mai anh tai")
  );
}

function pickRotatingVivibeVoice<T extends { id: string }>(
  options: {
    avoidVoiceIds?: string[];
    pool: T[];
    previousCommentVoiceName?: string | null;
    rotationSeed: string;
  }
): T | null {
  const avoid = new Set(
    (options.avoidVoiceIds ?? []).map((voiceId) => String(voiceId ?? "").trim()).filter(Boolean)
  );
  const filtered = options.pool.filter(
    (voice) =>
      !avoid.has(String(voice.id ?? "").trim()) &&
      String(voice.id ?? "").trim() !== String(options.previousCommentVoiceName ?? "").trim()
  );
  const usable = filtered.length > 0 ? filtered : options.pool.filter((voice) => !avoid.has(String(voice.id ?? "").trim()));
  if (usable.length === 0) {
    return null;
  }
  return usable[positiveHash(options.rotationSeed) % usable.length] ?? usable[0] ?? null;
}

function isBlockedVivibeCommentVoice(name: string, id: string): boolean {
  const haystack = `${name} ${id}`.toLowerCase();
  return /\bduc\s*trung\b|\bđức\s*trung\b/.test(haystack);
}

function filterTargetGenderCandidates<T extends { gender: VideoVoiceSettings["ssmlGender"] }>(
  voices: T[],
  targetGender?: VideoVoiceSettings["ssmlGender"] | null
): T[] {
  if (!targetGender) {
    return voices;
  }
  const filtered = voices.filter((voice) => voice.gender === targetGender);
  return filtered.length > 0 ? filtered : voices;
}

function resolveAlternatingTargetGenderFromPrevious(
  previousCommentGender?: VideoVoiceSettings["ssmlGender"] | null
): VideoVoiceSettings["ssmlGender"] | null {
  if (previousCommentGender === "MALE") {
    return "FEMALE";
  }
  if (previousCommentGender === "FEMALE") {
    return "MALE";
  }
  return null;
}

function resolveVivibeCommentTargetGender({
  baseVoiceGender,
  commentSequenceIndex,
  previousCommentGender,
  previousSceneKind,
}: {
  baseVoiceGender: VideoVoiceSettings["ssmlGender"];
  commentSequenceIndex?: number;
  previousCommentGender?: VideoVoiceSettings["ssmlGender"] | null;
  previousSceneKind?: "comment" | "post" | null;
}): VideoVoiceSettings["ssmlGender"] | null {
  const startingGender: VideoVoiceSettings["ssmlGender"] =
    baseVoiceGender === "FEMALE" || baseVoiceGender === "MALE"
      ? baseVoiceGender
      : "FEMALE";

  if (Number.isInteger(commentSequenceIndex) && (commentSequenceIndex ?? -1) >= 0) {
    return (commentSequenceIndex ?? 0) % 2 === 0
      ? startingGender
      : startingGender === "MALE"
        ? "FEMALE"
        : "MALE";
  }

  if (previousSceneKind === "post") {
    return startingGender;
  }

  return resolveAlternatingTargetGenderFromPrevious(previousCommentGender);
}

function prioritizeVivibeVoiceIdsForTransition(
  voiceIds: string[],
  targetGender?: VideoVoiceSettings["ssmlGender"] | null,
  previousCommentVoiceName?: string | null,
  previousSceneKind?: "comment" | "post" | null
): string[] {
  if (previousSceneKind === "post" && targetGender === "FEMALE") {
    return [
      VIVIBE_THAO_VY_VOICE_ID,
      ...voiceIds.filter(
        (voiceId) =>
          voiceId !== VIVIBE_THAO_VY_VOICE_ID &&
          voiceId !== VIVIBE_LAN_HUONG_VOICE_ID &&
          voiceId !== VIVIBE_MAI_ANH_TAI_VOICE_ID
      ),
    ];
  }

  if (targetGender === "FEMALE") {
    return [
      VIVIBE_THAO_VY_VOICE_ID,
      ...voiceIds.filter(
        (voiceId) =>
          voiceId !== VIVIBE_LAN_HUONG_VOICE_ID && voiceId !== VIVIBE_THAO_VY_VOICE_ID
      ),
    ];
  }

  if (targetGender === "MALE") {
    return [
      VIVIBE_NAM_AM_TRENDY_VOICE_ID,
      PREFERRED_VIVIBE_ADAM_VOICE_ID,
      ...voiceIds.filter(
        (voiceId) =>
          voiceId !== VIVIBE_NAM_AM_TRENDY_VOICE_ID &&
          voiceId !== PREFERRED_VIVIBE_ADAM_VOICE_ID &&
          voiceId !== VIVIBE_MAI_ANH_TAI_VOICE_ID
      ),
    ];
  }

  return voiceIds;
}

function preferredVivibeVoiceIdsForEmotion(
  emotion: ReturnType<typeof detectCommentEmotion>
): string[] {
  switch (emotion) {
    case "supportive":
      return [
        VIVIBE_NU_KE_CHUYEN_VOICE_ID,
        VIVIBE_THAO_VY_VOICE_ID,
        VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
        VIVIBE_NAM_AM_TRENDY_VOICE_ID,
        PREFERRED_VIVIBE_ADAM_VOICE_ID,
      ];
    case "funny":
      return [
        VIVIBE_NU_KE_CHUYEN_VOICE_ID,
        VIVIBE_THAO_VY_VOICE_ID,
        VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
        VIVIBE_NAM_AM_TRENDY_VOICE_ID,
        PREFERRED_VIVIBE_ADAM_VOICE_ID,
      ];
    case "angry":
      return [
        VIVIBE_NAM_AM_TRENDY_VOICE_ID,
        PREFERRED_VIVIBE_ADAM_VOICE_ID,
        VIVIBE_NU_KE_CHUYEN_VOICE_ID,
        VIVIBE_THAO_VY_VOICE_ID,
        VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
      ];
    case "curious":
      return [
        VIVIBE_NU_KE_CHUYEN_VOICE_ID,
        VIVIBE_THAO_VY_VOICE_ID,
        VIVIBE_NAM_AM_TRENDY_VOICE_ID,
        VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
        PREFERRED_VIVIBE_ADAM_VOICE_ID,
      ];
    case "neutral":
    default:
      return [
        VIVIBE_NU_KE_CHUYEN_VOICE_ID,
        VIVIBE_THAO_VY_VOICE_ID,
        VIVIBE_NAM_AM_TRENDY_VOICE_ID,
        VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
        PREFERRED_VIVIBE_ADAM_VOICE_ID,
      ];
  }
}

function positiveHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function scoreVivibeEmotionVoice(
  voice: { id: string; name: string },
  emotion: ReturnType<typeof detectCommentEmotion>
): number {
  const haystack = `${voice.name} ${voice.id}`.toLowerCase();
  let score = 0;

  if (voice.id === PREFERRED_VIVIBE_ADAM_VOICE_ID) score += 90;
  if (voice.id === VIVIBE_THAO_VY_VOICE_ID) score += 70;
  if (voice.id === VIVIBE_LAN_HUONG_VOICE_ID) score -= 20;
  if (voice.id === VIVIBE_MAI_ANH_TAI_VOICE_ID) score -= 30;
  if (/\badam\b/.test(haystack)) score += 45;
  if (/\bthao vy\b/.test(haystack)) score += 40;
  if (/\blan huong\b/.test(haystack)) score -= 20;
  if (/\bmai anh tai\b/.test(haystack)) score -= 28;

  if (/(male|nam|man|deep|warm|baritone|podcast|news|studio|tram|am)/.test(haystack)) {
    score += 24;
  }
  if (/(female|nu|girl|soft|sweet|bright|cute|young|clear)/.test(haystack)) {
    score += 16;
  }
  if (/(story|narrat|ke chuyen|tam chuyen|chatty|playful|natural|gentle|warm)/.test(haystack)) {
    score += 24;
  }
  if (/(formal|serious|robot|old|news anchor)/.test(haystack)) {
    score -= 24;
  }

  switch (emotion) {
    case "supportive":
      if (/(female|nu|soft|sweet|warm|gentle|story|clear|chatty|thao vy)/.test(haystack)) {
        score += 160;
      }
      if (/(angry|deep|charon|news|strong|robot)/.test(haystack)) {
        score -= 45;
      }
      break;
    case "funny":
      if (/(female|nu|bright|cute|young|fun|chatty|playful|thao vy)/.test(haystack)) {
        score += 170;
      }
      if (/(deep|news|old|robot|serious)/.test(haystack)) {
        score -= 55;
      }
      break;
    case "angry":
      if (/(adam|warm|clear|podcast|natural|thao vy)/.test(haystack)) {
        score += 145;
      }
      if (/(deep|news|robot|baritone|serious|tram)/.test(haystack)) {
        score -= 90;
      }
      break;
    case "curious":
      if (/(clear|natural|podcast|adam|warm|story|gentle|bright|chatty|thao vy)/.test(haystack)) {
        score += 135;
      }
      if (/(deep|news|robot|serious|baritone|tram)/.test(haystack)) {
        score -= 60;
      }
      break;
    case "neutral":
    default:
      if (/(adam|natural|clear|podcast|studio|warm|story|chatty|thao vy)/.test(haystack)) {
        score += 55;
      }
      if (/(deep|news|robot|serious|baritone|tram)/.test(haystack)) {
        score -= 45;
      }
      break;
  }

  return score;
}

function dedupeVoiceIds(voiceIds: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const voiceId of voiceIds) {
    const normalized = String(voiceId ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function inferVivibeVoiceGender(
  name: string
): VideoVoiceSettings["ssmlGender"] {
  return inferVivibeVoiceGenderByIdOrName("", name);
}

function inferVivibeVoiceGenderByIdOrName(
  id: string,
  name: string
): VideoVoiceSettings["ssmlGender"] {
  const normalizedId = String(id ?? "").trim();
  if (
    normalizedId === VIVIBE_NU_KE_CHUYEN_VOICE_ID ||
    normalizedId === VIVIBE_THAO_VY_VOICE_ID ||
    normalizedId === VIVIBE_NU_TAM_CHUYEN_VOICE_ID
  ) {
    return "FEMALE";
  }
  if (
    normalizedId === VIVIBE_NAM_AM_TRENDY_VOICE_ID ||
    normalizedId === PREFERRED_VIVIBE_ADAM_VOICE_ID
  ) {
    return "MALE";
  }

  const haystack = String(name ?? "").toLowerCase();
  if (/(female|nu|girl|chi|co|lan huong|thao vy)/.test(haystack)) {
    return "FEMALE";
  }
  if (/(male|nam|adam|man|anh|chu|baritone|deep|mai anh tai)/.test(haystack)) {
    return "MALE";
  }
  return "NEUTRAL";
}

function resolveFptEmotionVoice(
  baseVoice: VideoVoiceSettings,
  emotion: ReturnType<typeof detectCommentEmotion>,
  previousCommentGender?: VideoVoiceSettings["ssmlGender"] | null
): VideoVoiceSettings {
  const withEmotion = (
    overrides: Pick<VideoVoiceSettings, "ssmlGender" | "voiceName">
  ): VideoVoiceSettings => ({
    ...baseVoice,
    ...overrides,
    languageCode: "vi-VN",
    pitch: 0,
    provider: "fpt_ai",
      speakingRate: baseVoice.speakingRate,
  });

  const alternatingGender = resolveAlternatingTargetGenderFromPrevious(previousCommentGender);

  if (alternatingGender === "MALE") {
    return withEmotion({
      ssmlGender: "MALE",
      voiceName: emotion === "funny" ? "minhquang" : "leminh",
    });
  }

  if (alternatingGender === "FEMALE") {
    return withEmotion({
      ssmlGender: "FEMALE",
      voiceName:
        emotion === "funny" || emotion === "angry" ? "thuminh" : "banmai",
    });
  }

  switch (emotion) {
    case "supportive":
      return withEmotion({
        ssmlGender: "FEMALE",
        voiceName: "banmai",
      });
    case "funny":
      return withEmotion({
        ssmlGender: "FEMALE",
        voiceName: "thuminh",
      });
    case "angry":
      return withEmotion({
        ssmlGender: "FEMALE",
        voiceName: "thuminh",
      });
    case "curious":
      return withEmotion({
        ssmlGender: "FEMALE",
        voiceName: "banmai",
      });
    default:
      return withEmotion({
        ssmlGender:
          baseVoice.ssmlGender === "MALE" || baseVoice.ssmlGender === "FEMALE"
            ? baseVoice.ssmlGender
            : "FEMALE",
        voiceName: baseVoice.voiceName?.trim() || "banmai",
      });
  }
}

function resolveGoogleEmotionVoice(
  baseVoice: VideoVoiceSettings,
  emotion: ReturnType<typeof detectCommentEmotion>,
  previousCommentGender?: VideoVoiceSettings["ssmlGender"] | null
): VideoVoiceSettings {
  const withEmotion = (
    overrides: Partial<
      Pick<VideoVoiceSettings, "pitch" | "ssmlGender" | "voiceName">
    >
  ): VideoVoiceSettings => ({
    ...baseVoice,
    ...overrides,
    provider: "google_cloud",
      speakingRate: baseVoice.speakingRate,
  });

  const alternatingGender = resolveAlternatingTargetGenderFromPrevious(previousCommentGender);

  if (alternatingGender === "MALE") {
    switch (emotion) {
      case "funny":
        return withEmotion({
          pitch: 0.25,
          ssmlGender: "MALE",
          voiceName: "vi-VN-Chirp3-HD-Achird",
        });
      case "angry":
        return withEmotion({
          pitch: -0.1,
          ssmlGender: "MALE",
          voiceName: "vi-VN-Chirp3-HD-Achird",
        });
      case "curious":
        return withEmotion({
          pitch: -0.05,
          ssmlGender: "MALE",
          voiceName: "vi-VN-Chirp3-HD-Achird",
        });
      case "supportive":
      default:
        return withEmotion({
          pitch: -0.2,
          ssmlGender: "MALE",
          voiceName: "vi-VN-Chirp3-HD-Achird",
        });
    }
  }

  switch (emotion) {
    case "supportive":
      return withEmotion({
        pitch: 0,
        ssmlGender: "FEMALE",
        voiceName: "vi-VN-Chirp3-HD-Leda",
      });
    case "funny":
      return withEmotion({
        pitch: 0.4,
        ssmlGender: "FEMALE",
        voiceName: "vi-VN-Chirp3-HD-Aoede",
      });
    case "angry":
      return withEmotion({
        pitch: 0.15,
        ssmlGender: "FEMALE",
        voiceName: "vi-VN-Chirp3-HD-Aoede",
      });
    case "curious":
      return withEmotion({
        pitch: 0.05,
        ssmlGender: "FEMALE",
        voiceName: "vi-VN-Chirp3-HD-Leda",
      });
    default:
      return withEmotion({
        pitch: 0,
        ssmlGender: "FEMALE",
        voiceName: "vi-VN-Wavenet-C",
      });
  }
}

function defaultVoiceFromConfig(config: ToolConfig["video"]): VideoVoiceSettings {
  const hasGoogle = config.googleCloudApiKey.trim().length > 0;
  const hasFpt = config.fptAiApiKey.trim().length > 0;
  const hasAusynclab = Boolean(config.ausynclabApiKey?.trim().length);
  const hasVivibe = Boolean(config.vivibeApiKey?.trim().length);

  if (hasAusynclab && !hasGoogle && !hasFpt) {
    return {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "ausynclab",
      speakingRate: 1.0,
      ssmlGender: "MALE",
      voiceName: "1927315",
    };
  }

  if (!hasGoogle && hasFpt) {
    return {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "fpt_ai",
      speakingRate: 1,
      ssmlGender: "FEMALE",
      voiceName: config.fptAiVoiceName || "banmai",
    };
  }

  if (!hasGoogle && !hasFpt && !hasAusynclab && hasVivibe) {
    throw new Error(
      "ViVibe da duoc cau hinh nhung can chon mot voice cu the trong phan Tao video."
    );
  }

  return {
    languageCode: config.googleCloudLanguageCode,
    pitch: config.googleCloudPitch,
    provider: "google_cloud",
    speakingRate: config.googleCloudSpeakingRate,
    ssmlGender: config.googleCloudSsmlGender,
    voiceName: config.googleCloudVoiceName,
  };
}
