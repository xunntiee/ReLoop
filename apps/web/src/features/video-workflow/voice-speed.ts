export const VOICE_SPEED_OPTIONS = [
  { label: "0.5x", value: 0.5 },
  { label: "0.75x", value: 0.75 },
  { label: "1.0x", value: 1 },
  { label: "1.15x", value: 1.15 },
  { label: "1.25x", value: 1.25 },
  { label: "1.3x", value: 1.3 },
  { label: "1.4x", value: 1.4 },
  { label: "1.5x", value: 1.5 },
  { label: "2.0x", value: 2 },
] as const;

export function normalizeVoiceSpeed(value: unknown): number {
  const parsed = Number(value);
  return VOICE_SPEED_OPTIONS.some((option) => option.value === parsed)
    ? parsed
    : 1;
}
