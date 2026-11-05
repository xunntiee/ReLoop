import type { VivibeVoiceItem } from "./vivibe-tts.js";

export const PREFERRED_VIVIBE_ADAM_VOICE_ID = "5r2MVjMfzwsSDzTpaLjbY9";
export const VIVIBE_NU_KE_CHUYEN_VOICE_ID = "cACFxDTEUiNBcCSpmJbgwj";
export const VIVIBE_NAM_AM_TRENDY_VOICE_ID = "26ys7wicEUR9exGcq8GoTb";
export const VIVIBE_LAN_HUONG_VOICE_ID = "nqak8C85bsAG5mihyunRkj";
export const VIVIBE_THAO_VY_VOICE_ID = "5sP6NjV9vZ2DM4gpZrfVjy";
export const VIVIBE_MAI_ANH_TAI_VOICE_ID = "7Tb4dvGZyJMPjnnfxVBgik";
export const VIVIBE_NU_TAM_CHUYEN_VOICE_ID = "u4ZCcxDX4FJScdJ97iN8pr";

const BUILT_IN_VIVIBE_VOICES: VivibeVoiceItem[] = [
  {
    id: PREFERRED_VIVIBE_ADAM_VOICE_ID,
    isActive: true,
    name: "Adam",
  },
  {
    id: VIVIBE_NU_KE_CHUYEN_VOICE_ID,
    isActive: true,
    name: "Nữ kể chuyện ",
  },
  {
    id: VIVIBE_NAM_AM_TRENDY_VOICE_ID,
    isActive: true,
    name: "Nam ấm kể chuyện",
  },
  {
    id: VIVIBE_LAN_HUONG_VOICE_ID,
    isActive: true,
    name: "Lan Huong",
  },
  {
    id: VIVIBE_THAO_VY_VOICE_ID,
    isActive: true,
    name: "Thao Vy",
  },
  {
    id: VIVIBE_MAI_ANH_TAI_VOICE_ID,
    isActive: true,
    name: "Mai Anh Tai",
  },
  {
    id: VIVIBE_NU_TAM_CHUYEN_VOICE_ID,
    isActive: true,
    name: "Nữ tám chuyện",
  },
];

export function getBuiltInVivibeVoices(): VivibeVoiceItem[] {
  return BUILT_IN_VIVIBE_VOICES.map((voice) => ({ ...voice }));
}

export function mergeVivibeVoices(
  voices: VivibeVoiceItem[]
): VivibeVoiceItem[] {
  // Provider data comes first so community metadata (score, tags, verification)
  // is preserved for ranking and display. Built-ins remain a safe fallback for
  // older accounts that do not expose the voice through the list endpoint.
  const merged = [...(voices ?? []), ...getBuiltInVivibeVoices()];
  const seen = new Set<string>();
  const deduped: VivibeVoiceItem[] = [];

  for (const voice of merged) {
    const id = String(voice.id ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push({
      ...voice,
      id,
      isActive: voice.isActive !== false,
      name: String(voice.name ?? "").trim() || id,
      tags: Array.isArray(voice.tags)
        ? voice.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : undefined,
    });
  }

  return deduped;
}
