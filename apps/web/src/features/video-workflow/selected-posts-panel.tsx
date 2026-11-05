import { Link } from "@tanstack/react-router";
import {
  Clock3,
  ExternalLink,
  LoaderCircle,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import {
  type ChangeEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CrawlComment,
  CrawlPost,
  MemeLibraryEntry,
  MemeTransitionConfig,
  UploadedAudioPayload,
  UploadedVideoPayload,
  VideoDraftDocument,
  VideoPromotionConfig,
  VideoThumbnailIntro,
  VideoVoiceSettings,
  VivibeVoice,
  DialogueLine,
  VideoDialogueConfig,
} from "@/lib/api";
import { assetSources } from "@/lib/formatters";
import {
  getVideoAbbreviations,
  ocrVideoDialogue,
  suggestVideoDialogueText,
  updateVideoAbbreviations,
  uploadPromotionVideo,
} from "@/lib/api";
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
  safeSessionStorageGetItem,
  safeSessionStorageSetItem,
} from "@/lib/safe-storage";
import {
  buildVoiceDraftSignature,
  isVoiceDraftSignatureReusable,
  readPersistedDraftResults,
  type VideoPostWorkflowOptions,
  VideoDraftActions,
} from "./video-draft-actions";
import type { SelectedMemeEntry } from "./video-post-list-card-v2";
import { normalizeVoiceSpeed, VOICE_SPEED_OPTIONS } from "./voice-speed";

const DEFAULT_POST_VIDEO_DURATION_MS = 5000;

export interface LocalVideoState {
  file: UploadedVideoPayload;
  previewUrl: string;
  rawFile: File | null;
}

type VoiceProviderId = "ausynclab" | "fpt_ai" | "google_cloud" | "vivibe";

interface VoicePreset {
  description: string;
  label: string;
  provider: VoiceProviderId;
  previewUrl?: string;
  settings: VideoVoiceSettings;
  value: string;
}

const PREFERRED_VIVIBE_ADAM_VOICE_ID = "5r2MVjMfzwsSDzTpaLjbY9";

const VOICE_PRESETS: VoicePreset[] = [
  {
    description: "Giọng đọc AI tự nhiên từ AuSyncLab.",
    label: "AuSyncLab",
    provider: "ausynclab",
    settings: {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "ausynclab",
      speakingRate: 1,
      ssmlGender: "NEUTRAL",
      voiceName: "default",
    },
    value: "ausynclab_default",
  },
  {
    description: "Giọng nữ kể chuyện tự nhiên, mềm và rõ. Hợp video tâm sự.",
    label: "Nữ kể chuyện",
    provider: "google_cloud",
    settings: {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "google_cloud",
      speakingRate: 0.93,
      ssmlGender: "FEMALE",
      voiceName: "vi-VN-Chirp3-HD-Leda",
    },
    value: "google_female_story",
  },
  {
    description: "Giọng nữ sáng, trẻ và rõ. Hợp video ngắn, nội dung đời sống.",
    label: "Nữ trẻ sáng",
    provider: "google_cloud",
    settings: {
      languageCode: "vi-VN",
      pitch: 0.4,
      provider: "google_cloud",
      speakingRate: 0.98,
      ssmlGender: "FEMALE",
      voiceName: "vi-VN-Chirp3-HD-Aoede",
    },
    value: "google_female_young_bright",
  },
  {
    description:
      "Giọng nữ Wavenet rõ, ổn định. Dùng khi muốn chất giọng quen tai.",
    label: "Nữ Wavenet rõ",
    provider: "google_cloud",
    settings: {
      languageCode: "vi-VN",
      pitch: -0.2,
      provider: "google_cloud",
      speakingRate: 0.96,
      ssmlGender: "FEMALE",
      voiceName: "vi-VN-Wavenet-C",
    },
    value: "google_female_wavenet_clear",
  },
  {
    description: "Giọng nam ấm, cân bằng. Hợp kể chuyện và đọc bình luận.",
    label: "Nam ấm kể chuyện",
    provider: "google_cloud",
    settings: {
      languageCode: "vi-VN",
      pitch: -0.4,
      provider: "google_cloud",
      speakingRate: 0.94,
      ssmlGender: "MALE",
      voiceName: "vi-VN-Chirp3-HD-Achird",
    },
    value: "google_male_warm_story",
  },
  {
    description:
      "Giọng nữ nhẹ, tự nhiên và gãy gọn. Hợp đọc comment kiểu tám chuyện.",
    label: "Nữ tám chuyện",
    provider: "google_cloud",
    settings: {
      languageCode: "vi-VN",
      pitch: 0.15,
      provider: "google_cloud",
      speakingRate: 1,
      ssmlGender: "FEMALE",
      voiceName: "vi-VN-Chirp3-HD-Aoede",
    },
    value: "google_female_chatty_comment",
  },
  {
    description:
      "FPT giọng nữ Ban Mai, dễ nghe và phổ biến cho video kể chuyện.",
    label: "Ban Mai",
    provider: "fpt_ai",
    settings: {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "fpt_ai",
      speakingRate: 1,
      ssmlGender: "FEMALE",
      voiceName: "banmai",
    },
    value: "fpt_banmai",
  },
  {
    description: "FPT giọng nữ Thu Minh, sáng và rõ, hợp nội dung ngắn.",
    label: "Thu Minh",
    provider: "fpt_ai",
    settings: {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "fpt_ai",
      speakingRate: 1,
      ssmlGender: "FEMALE",
      voiceName: "thuminh",
    },
    value: "fpt_thuminh",
  },
  {
    description: "FPT giọng nam Lê Minh, cân bằng và tự nhiên.",
    label: "Lê Minh",
    provider: "fpt_ai",
    settings: {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "fpt_ai",
      speakingRate: 1,
      ssmlGender: "MALE",
      voiceName: "leminh",
    },
    value: "fpt_leminh",
  },
  {
    description:
      "FPT giọng nam Minh Quang, chắc và sáng hơn cho nội dung giải thích.",
    label: "Minh Quang",
    provider: "fpt_ai",
    settings: {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "fpt_ai",
      speakingRate: 1,
      ssmlGender: "MALE",
      voiceName: "minhquang",
    },
    value: "fpt_minhquang",
  },
  {
    description: "AuSyncLab giọng nam Adam MAX, tự nhiên và hiện đại.",
    label: "Adam MAX",
    provider: "ausynclab",
    settings: {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "ausynclab",
      speakingRate: 1.0,
      ssmlGender: "MALE",
      voiceName: "1927315",
    },
    value: "ausynclab_adam_max",
  },
  {
    description: "AuSyncLab giọng nam Adam, trầm ấm, rõ ràng.",
    label: "Adam",
    provider: "ausynclab",
    settings: {
      languageCode: "vi-VN",
      pitch: 0,
      provider: "ausynclab",
      speakingRate: 1.0,
      ssmlGender: "MALE",
      voiceName: "1927317",
    },
    value: "ausynclab_adam",
  },
];

const DEFAULT_MEME_TRANSITION_MS = 1200;
const MIN_MEME_TRANSITION_MS = 1000;
const MAX_MEME_TRANSITION_MS = 2700;

const PROVIDER_OPTIONS: Array<{ label: string; value: VoiceProviderId }> = [
  { label: "ViVibe", value: "vivibe" },
  { label: "Google Cloud", value: "google_cloud" },
  { label: "FPT AI", value: "fpt_ai" },
  { label: "AuSyncLab", value: "ausynclab" },
];

const VIDEO_WORKFLOW_PANEL_STATE_PREFIX = "videoWorkflow.panelState.";

const MEME_EMOTION_LABELS: Record<string, string> = {
  angry: "Tức giận",
  confused: "Bối rối",
  cringe: "Cringe",
  cute: "Dễ thương",
  dramatic: "Kịch tính",
  funny: "Hài hước",
  sad: "Buồn",
  shock: "Sốc",
};

interface StoredSelectedPostsPanelState {
  activePreviewPostId: string | null;
  assignedVideoPathByPostId: Record<string, string>;
  draftSignaturesByPostId: Record<string, string | undefined>;
  draftsByPostId: Record<string, VideoDraftDocument | undefined>;
  postSettingsByPostId?: Record<string, PostWorkflowSettings>;
}

interface PostWorkflowSettings {
  cardTheme: "light" | "dark";
  commentVoiceMode: "emotion" | "fixed";
  dialogue: VideoDialogueConfig | null;
  promotionFitMode: "contain" | "cover";
  promotionPosition: "midroll" | "none" | "outro";
  promotionVideoPath: string;
  promotionVolumePercent: number;
  selectedMemeEmotion: string;
  selectedMemeAudioPath?: string;
  selectedMemeImagePath?: string;
  selectedMusicPath: string;
  selectedMusicVolumePercent: number;
  selectedProvider: VoiceProviderId;
  selectedSpeed: number;
  selectedVoicePreset: string;
  videoMode: "single_post_recap" | "dialogue" | "thread_pages";
  playPostVideoAfterCaption: boolean;
}

export const SelectedPostsPanel = ({
  availableMusic,
  availablePromotionVideos,
  availableVideos,
  ausynclabConfigured,
  fptConfigured,
  googleConfigured,
  vivibeConfigured,
  vivibeVoices,
  hideGlobalMemePicker,
  llmTextConfigured,
  isRefreshingMusic,
  isRefreshingPromotions,
  isRefreshingVideos,
  memeBySceneId,
  memeLibraryItems = [],
  onPreviewSelectionChange,
  onRefreshMusic,
  onRefreshPromotions,
  onRefreshVideos,
  outputPath,
  selectedPosts,
  storageKey,
  thumbnailIntro,
  voiceConfigured,
}: {
  availableMusic: UploadedAudioPayload[];
  availablePromotionVideos: UploadedVideoPayload[];
  availableVideos: UploadedVideoPayload[];
  ausynclabConfigured: boolean;
  fptConfigured: boolean;
  googleConfigured: boolean;
  vivibeConfigured?: boolean;
  vivibeVoices?: VivibeVoice[];
  hideGlobalMemePicker?: boolean;
  llmTextConfigured?: boolean;
  isRefreshingMusic?: boolean;
  isRefreshingPromotions?: boolean;
  isRefreshingVideos?: boolean;
  memeBySceneId?: Record<string, SelectedMemeEntry | null>;
  memeLibraryItems?: MemeLibraryEntry[];
  onPreviewSelectionChange?: (value: {
    draft?: VideoDraftDocument | null;
    post?: CrawlPost;
    playPostVideoAfterCaption?: boolean;
    uploadedVideo: LocalVideoState | null;
  }) => void;
  onRefreshMusic?: () => void;
  onRefreshPromotions?: () => void;
  onRefreshVideos?: () => void;
  outputPath: string;
  selectedPosts: CrawlPost[];
  storageKey?: string;
  thumbnailIntro: VideoThumbnailIntro | null;
  voiceConfigured: boolean;
}) => {
  const emitPreviewSelectionChange = useEffectEvent(
    (value: {
      draft?: VideoDraftDocument | null;
      post?: CrawlPost;
      playPostVideoAfterCaption?: boolean;
      uploadedVideo: LocalVideoState | null;
    }) => {
      onPreviewSelectionChange?.(value);
    }
  );

  const [draftsByPostId, setDraftsByPostId] = useState<
    Record<string, VideoDraftDocument | undefined>
  >({});
  const [draftSignaturesByPostId, setDraftSignaturesByPostId] = useState<
    Record<string, string | undefined>
  >({});
  const [assignedVideosByPostId, setAssignedVideosByPostId] = useState<
    Record<string, UploadedVideoPayload | null | undefined>
  >({});
  const [activePreviewPostId, setActivePreviewPostId] = useState<string | null>(
    null
  );
  const [isVoicePreviewPlaying, setIsVoicePreviewPlaying] = useState(false);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastPreviewPayloadRef = useRef<string>("");
  const availableProviders = useMemo(
    () =>
      PROVIDER_OPTIONS.filter((provider) =>
        provider.value === "vivibe"
          ? vivibeConfigured
          : provider.value === "ausynclab"
            ? ausynclabConfigured
            : provider.value === "fpt_ai"
              ? fptConfigured
              : googleConfigured
      ),
    [vivibeConfigured, ausynclabConfigured, fptConfigured, googleConfigured]
  );
  const defaultProvider = useMemo<VoiceProviderId>(() => {
    if (vivibeConfigured) {
      return "vivibe";
    }
    if (ausynclabConfigured) {
      return "ausynclab";
    }
    if (fptConfigured) {
      return "fpt_ai";
    }
    if (googleConfigured) {
      return "google_cloud";
    }
    return "google_cloud";
  }, [vivibeConfigured, ausynclabConfigured, fptConfigured, googleConfigured]);
  const [selectedProvider, setSelectedProvider] = useState<VoiceProviderId>(
    () => {
      const saved = safeLocalStorageGetItem(
        "selectedVoiceProvider"
      ) as VoiceProviderId | null;
      return saved === "vivibe" ||
        saved === "ausynclab" ||
        saved === "fpt_ai" ||
        saved === "google_cloud"
        ? saved
        : "google_cloud";
    }
  );
  const allVoicePresets = useMemo(
    () => [...VOICE_PRESETS, ...buildVivibeVoicePresets(vivibeVoices ?? [])],
    [vivibeVoices]
  );
  const providerPresets = useMemo(
    () =>
      allVoicePresets.filter((preset) => preset.provider === selectedProvider),
    [allVoicePresets, selectedProvider]
  );
  const [selectedVoicePreset, setSelectedVoicePreset] = useState<string>(
    () =>
      safeLocalStorageGetItem("selectedVoicePreset") ?? "google_female_story"
  );
  const [selectedSpeed, setSelectedSpeed] = useState<number>(() => {
    const saved = safeLocalStorageGetItem("selectedSpeed");
    return normalizeVoiceSpeed(saved);
  });
  const [commentVoiceMode, setCommentVoiceMode] = useState<"emotion" | "fixed">(
    () => {
      const saved = safeLocalStorageGetItem("commentVoiceMode");
      return saved === "emotion" ? "emotion" : "fixed";
    }
  );
  const [editingAbbrevs, setEditingAbbrevs] = useState<
    { id: string; key: string; value: string }[]
  >(() => {
    try {
      const saved = safeLocalStorageGetItem("customAbbreviations");
      const parsed: Record<string, string> = saved ? JSON.parse(saved) : {};
      const list = Object.entries(parsed).map(([key, value], index) => ({
        id: `${index}-${Date.now()}`,
        key,
        value,
      }));
      return list.length > 0
        ? list
        : [{ id: `0-${Date.now()}`, key: "", value: "" }];
    } catch {
      return [{ id: `0-${Date.now()}`, key: "", value: "" }];
    }
  });
  const editingAbbrevsRef = useRef(editingAbbrevs);
  useEffect(() => {
    editingAbbrevsRef.current = editingAbbrevs;
  }, [editingAbbrevs]);
  const [cardTheme, setCardTheme] = useState<"light" | "dark">(() => {
    const saved = safeLocalStorageGetItem("cardTheme");
    return saved === "dark" ? "dark" : "light";
  });
  const handleCardThemeChange = (theme: "light" | "dark") => {
    setCardTheme(theme);
    safeLocalStorageSetItem("cardTheme", theme);
    updateActivePostSettings({ cardTheme: theme });
    window.dispatchEvent(new CustomEvent("cardThemeChange", { detail: theme }));
  };
  const [selectedMusicPath, setSelectedMusicPath] = useState<string>(
    () => safeLocalStorageGetItem("selectedBackgroundMusicPath") ?? ""
  );
  const [selectedMusicVolumePercent, setSelectedMusicVolumePercent] =
    useState<number>(() =>
      clampBackgroundMusicPercent(
        safeLocalStorageGetItem("selectedBackgroundMusicVolume")
      )
    );
  const [selectedMusicVolumeInput, setSelectedMusicVolumeInput] =
    useState<string>(() =>
      String(
        clampBackgroundMusicPercent(
          safeLocalStorageGetItem("selectedBackgroundMusicVolume")
        )
      )
    );
  const [promotionPosition, setPromotionPosition] = useState<
    "midroll" | "none" | "outro"
  >(() => {
    const saved = safeLocalStorageGetItem("promotion.position");
    if (saved === "midroll" || saved === "outro") {
      return saved;
    }
    if (safeLocalStorageGetItem("promotion.midroll.enabled") === "true") {
      return "midroll";
    }
    if (safeLocalStorageGetItem("promotion.outro.enabled") === "true") {
      return "outro";
    }
    return "none";
  });
  const [promotionVideoPath, setPromotionVideoPath] = useState(() => {
    const saved = safeLocalStorageGetItem("promotion.videoPath");
    if (saved) {
      return saved;
    }
    return (
      safeLocalStorageGetItem("promotion.midroll.path") ??
      safeLocalStorageGetItem("promotion.outro.path") ??
      ""
    );
  });
  const [promotionFitMode, setPromotionFitMode] = useState<"contain" | "cover">(
    () =>
      safeLocalStorageGetItem("promotion.fitMode") === "contain"
        ? "contain"
        : "cover"
  );
  const [promotionVolumePercent, setPromotionVolumePercent] = useState(() =>
    clampPromotionVolumePercent(safeLocalStorageGetItem("promotion.volume"))
  );
  const [isUploadingPromotion, setIsUploadingPromotion] = useState(false);
  const [promotionError, setPromotionError] = useState("");
  const promotionInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedMemeEmotion, setSelectedMemeEmotion] = useState<string>(
    () => safeLocalStorageGetItem("selectedMemeEmotion") ?? ""
  );
  const [selectedMemeImagePath, setSelectedMemeImagePath] = useState("");
  const [selectedMemeAudioPath, setSelectedMemeAudioPath] = useState("");
  const hydratedStorageKeyRef = useRef<string>("");
  const abbreviationsLoadedRef = useRef(false);
  const lastSavedAbbreviationsRef = useRef<string>("");
  const abbreviationsRef = useRef<Record<string, string>>({});

  const handleMemeEmotionChange = (value: string) => {
    const next = value === "__none__" ? "" : value;
    const selected = next
      ? memeLibraryItems.find((item) => item.emotion === next)
      : undefined;
    const nextImage = pickRandomMemeAsset(
      selected?.images,
      selected?.image
    );
    const nextAudio = pickRandomMemeAsset(
      selected?.audios,
      selected?.audio
    );
    const nextImagePath = getMemeAssetPath(nextImage);
    const nextAudioPath = getMemeAssetPath(nextAudio);
    setSelectedMemeEmotion(next);
    setSelectedMemeImagePath(nextImagePath);
    setSelectedMemeAudioPath(nextAudioPath);
    if (next) {
      safeLocalStorageSetItem("selectedMemeEmotion", next);
    } else {
      safeLocalStorageRemoveItem("selectedMemeEmotion");
    }
    updateActivePostSettings({
      selectedMemeAudioPath: nextAudioPath,
      selectedMemeEmotion: next,
      selectedMemeImagePath: nextImagePath,
    });
  };

  const abbreviations = useMemo(() => {
    const dict: Record<string, string> = {};
    for (const row of editingAbbrevs) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (k && v) {
        dict[k] = v;
      }
    }
    return dict;
  }, [editingAbbrevs]);

  useEffect(() => {
    abbreviationsRef.current = abbreviations;
  }, [abbreviations]);

  useEffect(() => {
    let cancelled = false;

    const loadAbbreviations = async (options?: { force?: boolean }) => {
      try {
        const response = await getVideoAbbreviations();
        if (cancelled) {
          return;
        }

        const loaded = normalizeAbbreviationRecord(response.abbreviations);
        const loadedJson = JSON.stringify(loaded);

        const isDirty = () => {
          const uiRows = editingAbbrevsRef.current;
          const serverKeys = Object.keys(loaded);
          const uiFilledRows = uiRows.filter(
            (r) => r.key.trim() || r.value.trim()
          );

          if (uiFilledRows.length !== serverKeys.length) {
            return true;
          }

          for (const row of uiFilledRows) {
            const k = row.key.trim().toLowerCase();
            const v = row.value.trim();
            if (loaded[k] !== v) {
              return true;
            }
          }

          if (
            uiRows.some(
              (r) =>
                !(r.key.trim() || r.value.trim()) &&
                uiRows.length > 1 &&
                serverKeys.length > 0
            )
          ) {
            return true;
          }

          return false;
        };

        const hasLocalUnsavedChanges =
          abbreviationsLoadedRef.current && isDirty();
        if (hasLocalUnsavedChanges && !options?.force) {
          return;
        }

        lastSavedAbbreviationsRef.current = loadedJson;
        setEditingAbbrevs(toEditableAbbreviationRows(loaded));
        safeLocalStorageSetItem("customAbbreviations", loadedJson);
      } catch (error) {
        console.error("Failed to load video abbreviations:", error);
      } finally {
        if (!cancelled) {
          abbreviationsLoadedRef.current = true;
        }
      }
    };

    void loadAbbreviations();

    const handleWindowFocus = () => {
      void loadAbbreviations();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadAbbreviations();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const normalized = normalizeAbbreviationRecord(abbreviations);
    const nextJson = JSON.stringify(normalized);
    safeLocalStorageSetItem("customAbbreviations", nextJson);

    if (
      !abbreviationsLoadedRef.current ||
      nextJson === lastSavedAbbreviationsRef.current
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void updateVideoAbbreviations(normalized)
        .then((response) => {
          const saved = normalizeAbbreviationRecord(response.abbreviations);
          lastSavedAbbreviationsRef.current = JSON.stringify(saved);
        })
        .catch((error) => {
          console.error("Failed to save video abbreviations:", error);
        });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [abbreviations]);

  useEffect(() => {
    setSelectedMusicVolumeInput(String(selectedMusicVolumePercent));
  }, [selectedMusicVolumePercent]);

  useEffect(() => {
    const storedVolume = safeLocalStorageGetItem("promotion.volume");
    if (storedVolume !== null && storedVolume.trim() !== "") {
      return;
    }
    setPromotionVolumePercent(100);
    safeLocalStorageSetItem("promotion.volume", "100");
  }, []);

  const selectedVoice =
    providerPresets.find((preset) => preset.value === selectedVoicePreset) ??
    providerPresets[0] ??
    VOICE_PRESETS.find((preset) => preset.provider === defaultProvider) ??
    VOICE_PRESETS[0]!;

  useEffect(() => {
    return () => {
      voicePreviewAudioRef.current?.pause();
      voicePreviewAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    voicePreviewAudioRef.current?.pause();
    voicePreviewAudioRef.current = null;
    setIsVoicePreviewPlaying(false);
  }, [selectedProvider, selectedVoicePreset]);

  useEffect(() => {
    if (voicePreviewAudioRef.current) {
      voicePreviewAudioRef.current.playbackRate = selectedSpeed;
    }
  }, [selectedSpeed]);

  const handleVoicePreview = () => {
    const previewUrl = selectedVoice.previewUrl?.trim();
    if (!previewUrl) {
      return;
    }

    const currentAudio = voicePreviewAudioRef.current;
    if (currentAudio?.src === previewUrl && !currentAudio.paused) {
      currentAudio.pause();
      setIsVoicePreviewPlaying(false);
      return;
    }

    currentAudio?.pause();
    const audio =
      currentAudio?.src === previewUrl
        ? currentAudio
        : new Audio(previewUrl);
    audio.playbackRate = selectedSpeed;
    audio.onended = () => setIsVoicePreviewPlaying(false);
    audio.onerror = () => setIsVoicePreviewPlaying(false);
    voicePreviewAudioRef.current = audio;
    void audio.play().then(
      () => setIsVoicePreviewPlaying(true),
      () => setIsVoicePreviewPlaying(false)
    );
  };

  const selectedBackgroundMusic = useMemo(
    () =>
      availableMusic.find((track) => track.serverPath === selectedMusicPath) ??
      null,
    [availableMusic, selectedMusicPath]
  );
  const selectedPromotionVideo = useMemo(
    () =>
      availablePromotionVideos.find(
        (video) => video.serverPath === promotionVideoPath
      ) ?? null,
    [availablePromotionVideos, promotionVideoPath]
  );
  const promotionConfig = useMemo<VideoPromotionConfig | null>(() => {
    if (promotionPosition === "none" || !selectedPromotionVideo) {
      return null;
    }
    const slot = {
      enabled: true,
      fitMode: promotionFitMode,
      video: selectedPromotionVideo,
      volume: promotionVolumePercent / 100,
    };
    const midroll = promotionPosition === "midroll" ? slot : null;
    const outro = promotionPosition === "outro" ? slot : null;
    return {
      midroll,
      minMidrollContentSeconds: 0,
      outro,
    };
  }, [
    promotionFitMode,
    promotionPosition,
    promotionVolumePercent,
    selectedPromotionVideo,
  ]);
  const effectiveSpeakingRate = useMemo(() => selectedSpeed, [selectedSpeed]);
  const selectedMemeTransition = useMemo<MemeTransitionConfig | null>(() => {
    if (!selectedMemeEmotion) {
      return null;
    }

    const selected = memeLibraryItems.find(
      (item) => item.emotion === selectedMemeEmotion
    );
    if (
      !selected ||
      !(
        selected.image ||
        selected.audio ||
        selected.images?.length ||
        selected.audios?.length
      )
    ) {
      return null;
    }

    const selectedImage = findMemeAssetByPath(
      selected.images,
      selected.image,
      selectedMemeImagePath
    );
    const selectedAudio = findMemeAssetByPath(
      selected.audios,
      selected.audio,
      selectedMemeAudioPath
    );

    return {
      audio: selectedAudio,
      audios: selected.audios ?? (selected.audio ? [selected.audio] : []),
      durationMs: getMemeTransitionDurationMs(
        selectedImage?.durationSeconds ?? null,
        selectedAudio?.durationSeconds ?? null,
        effectiveSpeakingRate
      ),
      emotion: selected.emotion,
      label: selected.label,
      image: selectedImage,
      images: selected.images ?? (selected.image ? [selected.image] : []),
    };
  }, [
    effectiveSpeakingRate,
    memeLibraryItems,
    selectedMemeAudioPath,
    selectedMemeEmotion,
    selectedMemeImagePath,
  ]);
  const effectiveMemeTransition = hideGlobalMemePicker
    ? null
    : selectedMemeTransition;

  // Older saved settings only contain the emotion. Pick one asset once when
  // the library becomes available, then keep that choice stable.
  useEffect(() => {
    const selected = selectedMemeEmotion
      ? memeLibraryItems.find((item) => item.emotion === selectedMemeEmotion)
      : undefined;
    const nextImage = findMemeAssetByPath(
      selected?.images,
      selected?.image,
      selectedMemeImagePath
    ) ?? pickRandomMemeAsset(selected?.images, selected?.image);
    const nextAudio = findMemeAssetByPath(
      selected?.audios,
      selected?.audio,
      selectedMemeAudioPath
    ) ?? pickRandomMemeAsset(selected?.audios, selected?.audio);
    const nextImagePath = getMemeAssetPath(nextImage);
    const nextAudioPath = getMemeAssetPath(nextAudio);

    if (
      nextImagePath === selectedMemeImagePath &&
      nextAudioPath === selectedMemeAudioPath
    ) {
      return;
    }

    if (
      defaultPostSettingsRef.current?.selectedMemeEmotion ===
        selectedMemeEmotion &&
      !defaultPostSettingsRef.current.selectedMemeImagePath &&
      !defaultPostSettingsRef.current.selectedMemeAudioPath
    ) {
      defaultPostSettingsRef.current = {
        ...defaultPostSettingsRef.current,
        selectedMemeAudioPath: nextAudioPath,
        selectedMemeImagePath: nextImagePath,
      };
    }

    setSelectedMemeImagePath(nextImagePath);
    setSelectedMemeAudioPath(nextAudioPath);
    updateActivePostSettings({
      selectedMemeAudioPath: nextAudioPath,
      selectedMemeImagePath: nextImagePath,
    });
  }, [
    activePreviewPostId,
    memeLibraryItems,
    selectedMemeAudioPath,
    selectedMemeEmotion,
    selectedMemeImagePath,
  ]);

  const voiceSettings = useMemo<VideoVoiceSettings>(
    () => ({
      ...selectedVoice.settings,
      speakingRate: effectiveSpeakingRate,
    }),
    [effectiveSpeakingRate, selectedVoice.settings]
  );

  const [videoMode, setVideoMode] = useState<
    "single_post_recap" | "dialogue" | "thread_pages"
  >("single_post_recap");
  const [playPostVideoAfterCaption, setPlayPostVideoAfterCaption] =
    useState(false);
  const [sourceVideoDurationsMs, setSourceVideoDurationsMs] = useState<
    Record<string, number>
  >({});
  const sourceVideoPreloadItems = useMemo(() => {
    const sources = selectedPosts.flatMap((post) =>
      [post, ...post.top_comments].flatMap((source) =>
        source.media
          .filter((media) => media.type === "video")
          .flatMap((media) => {
            const src = assetSources(media.asset_path, media.remote_url)[0];
            return src
              ? [{ key: getCrawledVideoMediaKey(media), src }]
              : [];
          })
      )
    );
    return Array.from(
      new Map(sources.map((source) => [source.key, source])).values()
    );
  }, [selectedPosts]);
  const [dialogue, setDialogue] = useState<VideoDialogueConfig | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [dialogueAiBusy, setDialogueAiBusy] = useState(false);
  const [dialogueAiMessage, setDialogueAiMessage] = useState("");
  const [dialogueAiFailed, setDialogueAiFailed] = useState(false);
  const [dialogueSaveMessage, setDialogueSaveMessage] = useState("");
  const dialogueAutoSavePendingRef = useRef(false);
  const [postSettingsByPostId, setPostSettingsByPostId] = useState<
    Record<string, PostWorkflowSettings>
  >({});
  const hydratedPostSettingsRef = useRef(false);
  const appliedPostSettingsIdRef = useRef<string | null>(null);
  const defaultPostSettingsRef = useRef<PostWorkflowSettings | null>(null);
  const restoringPostSettingsRef = useRef(false);
  const autoOcrImagePathRef = useRef("");
  const activeWorkflowPost =
    selectedPosts.find((post) => post.post_id === activePreviewPostId) ??
    selectedPosts[0];
  const hasStaticImage = Boolean(
    activeWorkflowPost?.media?.some(
      (item) => item.type === "image" && item.asset_path
    )
  );
  const hasCaptionVideo = Boolean(
    activeWorkflowPost &&
      [activeWorkflowPost, ...activeWorkflowPost.top_comments].some((item) =>
        item.media?.some(
          (media) =>
            media.type === "video" &&
            (Boolean(media.asset_path) || Boolean(media.remote_url))
        )
      )
  );
  const dialogueImagePath =
    activeWorkflowPost?.media?.find((item) => item.type === "image")
      ?.asset_path ?? "";
  const handleReadDialogueImage = async () => {
    if (!dialogueImagePath) return;
    setOcrBusy(true);
    setOcrError("");
    setDialogueAiMessage("");
    setDialogueAiFailed(false);
    try {
      const result = await ocrVideoDialogue(dialogueImagePath);
      const lines = normalizeDialogueLines(result.lines);
      if (!result.isDialogue || !hasRecognizedDialogue(lines)) {
        autoOcrImagePathRef.current = "";
        setDialogue(null);
        setVideoMode("single_post_recap");
        updateActivePostSettings({
          dialogue: null,
          videoMode: "single_post_recap",
        });
        setOcrError(
          "Ảnh này không nhận diện được hội thoại A/B; đã chuyển sang Một giọng kể chuyện."
        );
        return;
      }
      setDialogue({
        confirmed: false,
        imagePath: dialogueImagePath,
        lines,
        pauseMs: 180,
        speakers: { A: voiceSettings, B: { ...voiceSettings, ssmlGender: voiceSettings.ssmlGender === 'MALE' ? 'FEMALE' : 'MALE' } },
      });
      setVideoMode('dialogue');
    } catch (cause) {
      setOcrError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOcrBusy(false);
    }
  };


  const markDialogueDirty = () => {
    dialogueAutoSavePendingRef.current = true;
  };

  const handleAddDialogueLine = () => {
    markDialogueDirty();
    setDialogue((current) => {
      if (!current) return current;
      const speaker = getSingleDialogueSpeaker(current.lines) ?? 'A';
      const nextOrder = current.lines.length + 1;
      return {
        ...current,
        confirmed: false,
        lines: [
          ...current.lines,
          {
            bbox: { height: 0, width: 0, x: 0, y: 0 },
            confidence: 100,
            id: `dialogue-manual-${Date.now()}-${nextOrder}`,
            order: nextOrder,
            speaker,
            text: '',
          },
        ],
      };
    });
  };

  const handleRemoveDialogueLine = (lineId: string) => {
    markDialogueDirty();
    setDialogue((current) => {
      if (!current) return current;
      return {
        ...current,
        confirmed: false,
        lines: normalizeDialogueLineOrder(
          current.lines.filter((line) => line.id !== lineId),
        ),
      };
    });
  };

  const handleSuggestDialogueText = async () => {
    if (!dialogue?.lines.length) return;
    setDialogueAiBusy(true);
    setDialogueAiMessage("");
    setDialogueAiFailed(false);
    try {
      const result = await suggestVideoDialogueText({
        abbreviations,
        contextText: activeWorkflowPost?.text ?? "",
        lines: dialogue.lines.map(({ id, speaker, text }) => ({ id, speaker, text })),
      });
      const suggestions = new Map(result.lines.map((line) => [line.id, line.text]));
      dialogueAutoSavePendingRef.current = true;
      setDialogue((current) => current ? {
        ...current,
        confirmed: false,
        lines: current.lines.map((line) => ({
          ...line,
          text: suggestions.get(line.id) ?? line.text,
        })),
      } : current);
      setDialogueAiMessage("AI đã gợi ý xong; nội dung sẽ tự động lưu sau khi xử lý.");
    } catch (cause) {
      setDialogueAiFailed(true);
      setDialogueAiMessage(
        cause instanceof Error ? cause.message : "Không tạo được gợi ý AI.",
      );
    } finally {
      setDialogueAiBusy(false);
    }
  };

  useEffect(() => {
    if (!dialogueImagePath) {
      autoOcrImagePathRef.current = "";
      dialogueAutoSavePendingRef.current = false;
      setDialogue(null);
      return;
    }
    if (videoMode !== "dialogue" || ocrBusy || autoOcrImagePathRef.current === dialogueImagePath) {
      return;
    }
    autoOcrImagePathRef.current = dialogueImagePath;
    dialogueAutoSavePendingRef.current = false;
    try {
      const stored = window.localStorage.getItem(`tool-base:video-dialogue:${dialogueImagePath}`);
      if (stored) {
        const savedDialogue = JSON.parse(stored) as VideoDialogueConfig;
        const savedLines = Array.isArray(savedDialogue.lines)
          ? normalizeDialogueLines(savedDialogue.lines)
          : [];
        if (
          savedDialogue.imagePath === dialogueImagePath &&
          hasRecognizedDialogue(savedLines)
        ) {
          setDialogue({
            ...savedDialogue,
            confirmed: true,
            lines: savedLines,
          });
          setDialogueSaveMessage("Đã tải hội thoại đã lưu cho ảnh này.");
          return;
        }
      }
    } catch {
      // Ignore invalid local cache and run OCR again.
    }
    void handleReadDialogueImage();
  }, [dialogueImagePath, ocrBusy, videoMode]);

  useEffect(() => {
    if (!dialogue?.confirmed) setDialogueSaveMessage("");
  }, [dialogue?.confirmed]);

  useEffect(() => {
    if (!dialogue || dialogue.imagePath !== dialogueImagePath || !dialogueAutoSavePendingRef.current) return;
    const timeout = window.setTimeout(() => {
      const isValid = dialogue.lines.length > 0 && dialogue.lines.every((line) => line.text.trim() && line.speaker !== "unknown");
      if (!isValid) {
        setDialogueSaveMessage("Hãy hoàn thiện nội dung và chọn người nói A/B; thay đổi chưa được tự lưu.");
        return;
      }
      try {
        const savedDialogue = { ...dialogue, confirmed: true, imagePath: dialogueImagePath };
        window.localStorage.setItem(`tool-base:video-dialogue:${dialogueImagePath}`, JSON.stringify(savedDialogue));
        dialogueAutoSavePendingRef.current = false;
        setDialogue((current) => current?.imagePath === dialogue.imagePath ? { ...current, confirmed: true } : current);
        setDialogueSaveMessage("Đã tự động lưu hội thoại.");
      } catch (cause) {
        setDialogueSaveMessage(cause instanceof Error ? cause.message : "Không thể tự lưu hội thoại trên máy này.");
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [dialogue, dialogueImagePath]);

  // Keep both dialogue voices aligned with the global speed selector. The
  // dialogue object is created when OCR completes, so without this sync a
  // later change (for example 1.0x -> 1.4x) only affected caption/comments.
  useEffect(() => {
    setDialogue((current) => {
      if (!current) return current;
      return {
        ...current,
        speakers: {
          A: { ...current.speakers.A, speakingRate: effectiveSpeakingRate },
          B: { ...current.speakers.B, speakingRate: effectiveSpeakingRate },
        },
      };
    });
  }, [effectiveSpeakingRate]);

  const singleDialogueSpeaker = useMemo(
    () => getSingleDialogueSpeaker(dialogue?.lines ?? []),
    [dialogue?.lines],
  );

  const getCurrentPostSettings = (): PostWorkflowSettings => ({
    cardTheme,
    commentVoiceMode,
    dialogue,
    promotionFitMode,
    promotionPosition,
    promotionVideoPath,
    promotionVolumePercent,
    selectedMemeAudioPath,
    selectedMemeEmotion,
    selectedMemeImagePath,
    selectedMusicPath,
    selectedMusicVolumePercent,
    selectedProvider,
    selectedSpeed,
    selectedVoicePreset,
    videoMode,
    playPostVideoAfterCaption,
  });

  // New posts inherit the controls that were present when this panel opened,
  // never whichever post happened to be selected immediately before them.
  useEffect(() => {
    if (
      defaultPostSettingsRef.current ||
      availableProviders.length === 0 ||
      !availableProviders.some((provider) => provider.value === selectedProvider) ||
      providerPresets.length === 0 ||
      !providerPresets.some((preset) => preset.value === selectedVoicePreset)
    ) {
      return;
    }

    // Wait until the provider and voice effects have normalized persisted
    // values. Otherwise the first render can capture an unavailable provider
    // (for example Google) as the default while the UI has already switched
    // to ViVibe.
    defaultPostSettingsRef.current = getCurrentPostSettings();
  }, [
    availableProviders,
    providerPresets,
    selectedProvider,
    selectedVoicePreset,
  ]);

  const applyPostSettings = (settings: PostWorkflowSettings) => {
    restoringPostSettingsRef.current = true;
    setSelectedProvider(settings.selectedProvider);
    setSelectedVoicePreset(settings.selectedVoicePreset);
    setSelectedSpeed(settings.selectedSpeed);
    setCommentVoiceMode(settings.commentVoiceMode);
    setCardTheme(settings.cardTheme);
    setSelectedMusicPath(settings.selectedMusicPath);
    setSelectedMusicVolumePercent(settings.selectedMusicVolumePercent);
    setSelectedMusicVolumeInput(String(settings.selectedMusicVolumePercent));
    setPromotionPosition(settings.promotionPosition);
    setPromotionVideoPath(settings.promotionVideoPath);
    setPromotionFitMode(settings.promotionFitMode);
    setPromotionVolumePercent(settings.promotionVolumePercent);
    setSelectedMemeAudioPath(settings.selectedMemeAudioPath ?? "");
    setSelectedMemeEmotion(settings.selectedMemeEmotion);
    setSelectedMemeImagePath(settings.selectedMemeImagePath ?? "");
    setVideoMode(settings.videoMode);
    setPlayPostVideoAfterCaption(Boolean(settings.playPostVideoAfterCaption));
    setDialogue(settings.dialogue);
  };

  const updateActivePostSettings = (
    patch: Partial<PostWorkflowSettings>
  ) => {
    if (!activePreviewPostId) {
      return;
    }
    setPostSettingsByPostId((current) => ({
      ...current,
      [activePreviewPostId]: {
        ...(current[activePreviewPostId] ?? getCurrentPostSettings()),
        ...patch,
      },
    }));
  };

  const handleActivePreviewPostChange = (postId: string) => {
    if (postId === activePreviewPostId) {
      return;
    }

    if (activePreviewPostId) {
      setPostSettingsByPostId((current) => ({
        ...current,
        [activePreviewPostId]: getCurrentPostSettings(),
      }));
    }

    const nextSettings = postSettingsByPostId[postId];
    if (nextSettings) {
      appliedPostSettingsIdRef.current = postId;
      applyPostSettings(nextSettings);
    } else {
      const inheritedSettings = {
        ...(defaultPostSettingsRef.current ?? getCurrentPostSettings()),
        dialogue: null,
        videoMode: "single_post_recap" as const,
        playPostVideoAfterCaption: false,
      };
      appliedPostSettingsIdRef.current = postId;
      setPostSettingsByPostId((current) => ({
        ...current,
        [postId]: inheritedSettings,
      }));
      // A new post must not inherit the previous post's OCR/dialogue state.
      restoringPostSettingsRef.current = true;
      applyPostSettings(inheritedSettings);
    }
    setActivePreviewPostId(postId);
  };

  const defaultPostSettings =
    defaultPostSettingsRef.current ?? getCurrentPostSettings();
  const workflowOptionsByPostId = useMemo<
    Record<string, VideoPostWorkflowOptions>
  >(
    () =>
      Object.fromEntries(
        selectedPosts.map((post) => {
          const settings =
            postSettingsByPostId[post.post_id] ?? defaultPostSettings;
          const effectiveProvider = availableProviders.some(
            (provider) => provider.value === settings.selectedProvider
          )
            ? settings.selectedProvider
            : defaultProvider;
          const effectiveProviderPresets = allVoicePresets.filter(
            (item) => item.provider === effectiveProvider
          );
          const preset =
            allVoicePresets.find(
              (item) =>
                item.value === settings.selectedVoicePreset &&
                item.provider === effectiveProvider
            ) ??
            (effectiveProvider === "vivibe"
              ? findPreferredVivibePreset(
                  effectiveProviderPresets,
                  settings.selectedVoicePreset
                )
              : effectiveProviderPresets[0]) ??
            selectedVoice;
          const voiceSettings: VideoVoiceSettings = {
            ...preset.settings,
            speakingRate: settings.selectedSpeed,
          };
          const music =
            availableMusic.find(
              (track) => track.serverPath === settings.selectedMusicPath
            ) ?? null;
          const promotionVideo =
            availablePromotionVideos.find(
              (video) => video.serverPath === settings.promotionVideoPath
            ) ?? null;
          const promotionSlot =
            settings.promotionPosition !== "none" && promotionVideo
              ? {
                  enabled: true,
                  fitMode: settings.promotionFitMode,
                  video: promotionVideo,
                  volume: settings.promotionVolumePercent / 100,
                }
              : null;
          const selectedMeme = memeLibraryItems.find(
            (item) => item.emotion === settings.selectedMemeEmotion
          );
          const selectedMemeImage = findMemeAssetByPath(
            selectedMeme?.images,
            selectedMeme?.image,
            settings.selectedMemeImagePath
          );
          const selectedMemeAudio = findMemeAssetByPath(
            selectedMeme?.audios,
            selectedMeme?.audio,
            settings.selectedMemeAudioPath
          );
          const hasSelectedMeme = Boolean(
            !hideGlobalMemePicker &&
              selectedMeme &&
              (selectedMemeImage || selectedMemeAudio)
          );
          const memeTransition = hasSelectedMeme
            ? {
                audio: selectedMemeAudio,
                audios:
                  selectedMeme?.audios ??
                  (selectedMeme?.audio ? [selectedMeme.audio] : []),
                durationMs: getMemeTransitionDurationMs(
                  selectedMemeImage?.durationSeconds ?? null,
                  selectedMemeAudio?.durationSeconds ?? null,
                  settings.selectedSpeed
                ),
                emotion: selectedMeme?.emotion ?? settings.selectedMemeEmotion,
                label: selectedMeme?.label,
                image: selectedMemeImage,
                images:
                  selectedMeme?.images ??
                  (selectedMeme?.image ? [selectedMeme.image] : []),
              }
            : null;

          return [
            post.post_id,
            {
              backgroundMusic: music,
              backgroundMusicVolume: settings.selectedMusicVolumePercent / 100,
              cardTheme: settings.cardTheme,
              commentVoiceMode: settings.commentVoiceMode,
              dialogue:
                settings.videoMode === "dialogue" ? settings.dialogue : null,
              playPostVideoAfterCaption: settings.playPostVideoAfterCaption,
              memeBySceneId,
              memeTransition,
              promotion:
                promotionSlot === null
                  ? null
                  : {
                      midroll:
                        settings.promotionPosition === "midroll"
                          ? promotionSlot
                          : null,
                      minMidrollContentSeconds: 0,
                      outro:
                        settings.promotionPosition === "outro"
                          ? promotionSlot
                          : null,
                    },
              videoMode: settings.videoMode,
              voiceSettings,
            } satisfies VideoPostWorkflowOptions,
          ];
        })
      ),
    [
      allVoicePresets,
      availableMusic,
      availablePromotionVideos,
      availableProviders,
      defaultPostSettings,
      defaultProvider,
      hideGlobalMemePicker,
      memeBySceneId,
      memeLibraryItems,
      postSettingsByPostId,
      activePreviewPostId,
      selectedPosts,
      selectedVoice,
    ]
  );

  const currentSignaturesByPostId = useMemo(
    () =>
      Object.fromEntries(
        selectedPosts.map((post) => [
          post.post_id,
          buildVoiceDraftSignature({
            abbreviations,
            commentVoiceMode:
              workflowOptionsByPostId[post.post_id]?.commentVoiceMode,
            dialogue: workflowOptionsByPostId[post.post_id]?.dialogue,
            memeBySceneId: workflowOptionsByPostId[post.post_id]?.memeBySceneId,
            memeTransition:
              workflowOptionsByPostId[post.post_id]?.memeTransition,
            post,
            videoMode: workflowOptionsByPostId[post.post_id]?.videoMode,
            voiceSettings: workflowOptionsByPostId[post.post_id]?.voiceSettings,
          }),
        ])
      ),
    [
      abbreviations,
      selectedPosts,
      workflowOptionsByPostId,
    ]
  );

  const estimatedDurationMsByPostId = useMemo(
    () =>
      Object.fromEntries(
        selectedPosts.map((post) => {
          const options = workflowOptionsByPostId[post.post_id];
          const draft = draftsByPostId[post.post_id];
          const hasCurrentVoiceDraft = Boolean(
            draft?.video_plan.voice_ready &&
              isVoiceDraftSignatureReusable({
                currentSignature: currentSignaturesByPostId[post.post_id],
                draftSignature: draftSignaturesByPostId[post.post_id],
              })
          );
          const durationMs = hasCurrentVoiceDraft
            ? getVoiceDraftDurationMs({
                draft,
                promotion: options?.promotion ?? null,
                thumbnailIntro,
              })
            : estimateVideoDurationMs({
                globalMemeTransition: options?.memeTransition ?? null,
                memeBySceneId,
                playPostVideoAfterCaption:
                  options?.playPostVideoAfterCaption ?? false,
                post,
                promotion: options?.promotion ?? null,
                sourceVideoDurationsMs,
                speakingRate:
                  options?.voiceSettings?.speakingRate ?? effectiveSpeakingRate,
                thumbnailIntro,
              });
          return [
            post.post_id,
            durationMs,
          ];
        })
      ),
    [
      currentSignaturesByPostId,
      draftSignaturesByPostId,
      draftsByPostId,
      effectiveSpeakingRate,
      memeBySceneId,
      selectedPosts,
      sourceVideoDurationsMs,
      thumbnailIntro,
      workflowOptionsByPostId,
    ]
  );
  const estimatedTotalDurationMs = Object.values(
    estimatedDurationMsByPostId
  ).reduce((total, durationMs) => total + durationMs, 0);
  const estimatedActiveDurationMs =
    estimatedDurationMsByPostId[
      activePreviewPostId ?? selectedPosts[0]?.post_id ?? ""
    ] ?? 0;

  useEffect(() => {
    const hydrationKey = `${storageKey}|${availableVideos
      .map((video) => video.serverPath ?? video.name)
      .join("|")}`;
    if (!storageKey || hydratedStorageKeyRef.current === hydrationKey) {
      return;
    }

    const storedState = readStoredSelectedPostsPanelState(storageKey);
    const persistedDraftResults = readPersistedDraftResults(storageKey);
    hydratedStorageKeyRef.current = hydrationKey;
    appliedPostSettingsIdRef.current = null;
    if (!storedState) {
      setPostSettingsByPostId({});
      hydratedPostSettingsRef.current = true;
      setDraftsByPostId(
        Object.fromEntries(
          Object.entries(persistedDraftResults).map(([postId, value]) => [
            postId,
            value.draft,
          ])
        )
      );
      setDraftSignaturesByPostId(
        Object.fromEntries(
          Object.entries(persistedDraftResults).map(([postId, value]) => [
            postId,
            value.signature,
          ])
        )
      );
      setAssignedVideosByPostId({});
      setActivePreviewPostId(null);
      return;
    }

    setDraftsByPostId({
      ...(storedState.draftsByPostId ?? {}),
      ...Object.fromEntries(
        Object.entries(persistedDraftResults).map(([postId, value]) => [
          postId,
          value.draft,
        ])
      ),
    });
    setDraftSignaturesByPostId({
      ...(storedState.draftSignaturesByPostId ?? {}),
      ...Object.fromEntries(
        Object.entries(persistedDraftResults).map(([postId, value]) => [
          postId,
          value.signature,
        ])
      ),
    });
    setPostSettingsByPostId(storedState.postSettingsByPostId ?? {});
    hydratedPostSettingsRef.current = true;
    setActivePreviewPostId(storedState.activePreviewPostId ?? null);
    setAssignedVideosByPostId(
      Object.fromEntries(
        Object.entries(storedState.assignedVideoPathByPostId ?? {}).map(
          ([postId, serverPath]) => [
            postId,
            availableVideos.find((video) => video.serverPath === serverPath) ??
              null,
          ]
        )
      )
    );
  }, [availableVideos, storageKey]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      writeStoredSelectedPostsPanelState(storageKey, {
        activePreviewPostId,
        assignedVideoPathByPostId: Object.fromEntries(
          Object.entries(assignedVideosByPostId)
            .map(([postId, value]) => [postId, value?.serverPath ?? ""])
            .filter(([, serverPath]) => Boolean(serverPath))
        ),
        draftSignaturesByPostId,
        draftsByPostId,
        postSettingsByPostId,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    activePreviewPostId,
    assignedVideosByPostId,
    draftSignaturesByPostId,
    draftsByPostId,
    postSettingsByPostId,
    storageKey,
  ]);

  useEffect(() => {
    if (availableProviders.length === 0) {
      return;
    }

    const providerAllowed =
      selectedProvider === "vivibe"
        ? Boolean(vivibeConfigured)
        : selectedProvider === "ausynclab"
          ? ausynclabConfigured
          : selectedProvider === "fpt_ai"
            ? fptConfigured
            : googleConfigured;
    if (providerAllowed) {
      return;
    }

    setSelectedProvider(defaultProvider);
    safeLocalStorageSetItem("selectedVoiceProvider", defaultProvider);

    const nextPreset =
      allVoicePresets.find((preset) => preset.provider === defaultProvider)
        ?.value ?? selectedVoicePreset;
    setSelectedVoicePreset(nextPreset);
    safeLocalStorageSetItem("selectedVoicePreset", nextPreset);
  }, [
    allVoicePresets,
    ausynclabConfigured,
    defaultProvider,
    fptConfigured,
    googleConfigured,
    llmTextConfigured,
    availableProviders.length,
    selectedProvider,
    selectedVoicePreset,
    vivibeConfigured,
    vivibeVoices,
  ]);

  useEffect(() => {
    if (providerPresets.length === 0) {
      return;
    }

    const hasSelectedPreset = providerPresets.some(
      (preset) => preset.value === selectedVoicePreset
    );
    if (hasSelectedPreset) {
      return;
    }

    const preferredPreset =
      selectedProvider === "vivibe"
        ? findPreferredVivibePreset(providerPresets, selectedVoicePreset)
        : providerPresets[0];
    if (!preferredPreset) {
      return;
    }

    setSelectedVoicePreset(preferredPreset.value);
    safeLocalStorageSetItem("selectedVoicePreset", preferredPreset.value);
  }, [providerPresets, selectedProvider, selectedVoicePreset]);

  useEffect(() => {
    if (selectedPosts.length === 0) {
      setActivePreviewPostId(null);
      const emptyPayload = JSON.stringify({
        draftId: "",
        postId: "",
        videoPath: "",
      });
      if (lastPreviewPayloadRef.current === emptyPayload) {
        return;
      }
      lastPreviewPayloadRef.current = emptyPayload;
      emitPreviewSelectionChange({
        draft: null,
        post: undefined,
        uploadedVideo: null,
      });
      return;
    }

    setActivePreviewPostId((current) =>
      current && selectedPosts.some((post) => post.post_id === current)
        ? current
        : (selectedPosts[0]?.post_id ?? null)
    );
  }, [emitPreviewSelectionChange, selectedPosts]);

  useEffect(() => {
    if (!hydratedPostSettingsRef.current || !activePreviewPostId) {
      return;
    }
    const settings = postSettingsByPostId[activePreviewPostId];
    if (!settings) {
      if (appliedPostSettingsIdRef.current === activePreviewPostId) {
        return;
      }
      const inheritedSettings = {
        ...(defaultPostSettingsRef.current ?? getCurrentPostSettings()),
        dialogue: null,
        videoMode: "single_post_recap" as const,
        playPostVideoAfterCaption: false,
      };
      appliedPostSettingsIdRef.current = activePreviewPostId;
      setPostSettingsByPostId((current) => ({
        ...current,
        [activePreviewPostId]: inheritedSettings,
      }));
      restoringPostSettingsRef.current = true;
      applyPostSettings(inheritedSettings);
      return;
    }
    if (appliedPostSettingsIdRef.current === activePreviewPostId) {
      return;
    }
    appliedPostSettingsIdRef.current = activePreviewPostId;
    applyPostSettings(settings);
  }, [activePreviewPostId, postSettingsByPostId]);

  useEffect(() => {
    if (
      !hydratedPostSettingsRef.current ||
      !activePreviewPostId ||
      restoringPostSettingsRef.current
    ) {
      restoringPostSettingsRef.current = false;
      return;
    }
    updateActivePostSettings({
      dialogue,
      playPostVideoAfterCaption,
      videoMode,
    });
  }, [activePreviewPostId, dialogue, playPostVideoAfterCaption, videoMode]);

  useEffect(() => {
    if (availableVideos.length === 0 || selectedPosts.length === 0) {
      return;
    }

    const latestVideo = availableVideos[0];
    if (!latestVideo) {
      return;
    }

    setAssignedVideosByPostId((current) => {
      const next = { ...current };
      let changed = false;
      for (const post of selectedPosts) {
        if (!next[post.post_id]) {
          next[post.post_id] = latestVideo;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [availableVideos, selectedPosts]);

  useEffect(() => {
    if (availableMusic.length === 0) {
      if (!selectedMusicPath) {
        return;
      }
      setSelectedMusicPath("");
      safeLocalStorageRemoveItem("selectedBackgroundMusicPath");
      return;
    }

    if (!selectedMusicPath) {
      return;
    }
    if (
      availableMusic.some((track) => track.serverPath === selectedMusicPath)
    ) {
      return;
    }

    setSelectedMusicPath("");
    safeLocalStorageRemoveItem("selectedBackgroundMusicPath");
  }, [availableMusic, selectedMusicPath]);

  useEffect(() => {
    const activePost =
      selectedPosts.find((post) => post.post_id === activePreviewPostId) ??
      selectedPosts[0];
    if (!activePost) {
      return;
    }

    const assignedVideo = assignedVideosByPostId[activePost.post_id] ?? null;
    const draft = draftsByPostId[activePost.post_id];
    const currentSignature = currentSignaturesByPostId[activePost.post_id];
    const matchedDraft =
      draft &&
      isVoiceDraftSignatureReusable({
        currentSignature,
        draftSignature: draftSignaturesByPostId[activePost.post_id],
      })
        ? applyDraftPreviewOverrides(draft, {
            backgroundMusic: selectedBackgroundMusic,
            backgroundMusicVolume: selectedMusicVolumePercent / 100,
            cardTheme,
            memeTransition: effectiveMemeTransition,
            promotion: promotionConfig,
          })
        : null;
    const nextPayloadKey = JSON.stringify({
      cardTheme,
      currentSignature: currentSignature ?? "",
      draftId: matchedDraft?.draft_id ?? "",
      memeEmotion: effectiveMemeTransition?.emotion ?? "",
      musicPath: selectedBackgroundMusic?.serverPath ?? "",
      musicVolume: selectedMusicVolumePercent,
      promotion: promotionConfig,
      postText: activePost.text,
      postTtsText: activePost.tts_text ?? "",
      playPostVideoAfterCaption,
      memeBySceneId: memeBySceneId ?? null,
      postSignature: JSON.stringify(
        activePost.top_comments.map((comment) => ({
          avatar_asset_path: comment.avatar_asset_path ?? "",
          avatar_url: comment.avatar_url ?? "",
          comment_id: comment.comment_id,
          media: (comment.media ?? []).map((item) => ({
            asset_path: item.asset_path ?? "",
            height: item.height ?? 0,
            order: item.order ?? 0,
            remote_url: item.remote_url ?? "",
            type: item.type,
            width: item.width ?? 0,
          })),
          selected_for_video: comment.selected_for_video !== false,
          text: comment.text,
          tts_text: comment.tts_text ?? "",
          video_duration_seconds: comment.video_duration_seconds ?? null,
        }))
      ),
      postDurationSeconds: activePost.video_duration_seconds ?? null,
      postId: activePost.post_id,
      videoPath: assignedVideo?.serverPath ?? "",
    });
    if (lastPreviewPayloadRef.current === nextPayloadKey) {
      return;
    }
    lastPreviewPayloadRef.current = nextPayloadKey;

    emitPreviewSelectionChange({
      draft: matchedDraft,
      post: activePost,
      playPostVideoAfterCaption,
      uploadedVideo: assignedVideo
        ? {
            file: assignedVideo,
            previewUrl: assignedVideo.mediaUrl || "",
            rawFile: null,
          }
        : null,
    });
  }, [
    activePreviewPostId,
    assignedVideosByPostId,
    cardTheme,
    currentSignaturesByPostId,
    draftSignaturesByPostId,
    draftsByPostId,
    emitPreviewSelectionChange,
    effectiveMemeTransition,
    memeBySceneId,
    selectedBackgroundMusic,
    selectedMusicVolumePercent,
    promotionConfig,
    playPostVideoAfterCaption,
    selectedPosts,
  ]);

  const handleAbbrevRowChange = (
    idx: number,
    field: "key" | "value",
    val: string
  ) => {
    setEditingAbbrevs((current) =>
      current.map((row, index) =>
        index === idx ? { ...row, [field]: val } : row
      )
    );
  };

  const handleAddAbbrevRow = () => {
    setEditingAbbrevs((current) => [
      { id: `${Date.now()}`, key: "", value: "" },
      ...current,
    ]);
  };

  const handleRemoveAbbrevRow = (id: string) => {
    setEditingAbbrevs((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length > 0
        ? next
        : [{ id: `${Date.now()}`, key: "", value: "" }];
    });
  };

  const handleProviderChange = (value: string) => {
    const nextProvider =
      value === "vivibe" || value === "ausynclab" || value === "fpt_ai"
        ? value
        : "google_cloud";
    setSelectedProvider(nextProvider);
    safeLocalStorageSetItem("selectedVoiceProvider", nextProvider);
    const nextPresetSource =
      nextProvider === "vivibe"
        ? findPreferredVivibePreset(
            allVoicePresets.filter(
              (preset) => preset.provider === nextProvider
            ),
            selectedVoicePreset
          )
        : allVoicePresets.find((preset) => preset.provider === nextProvider);
    const nextPreset = nextPresetSource?.value ?? selectedVoicePreset;
    setSelectedVoicePreset(nextPreset);
    safeLocalStorageSetItem("selectedVoicePreset", nextPreset);
    updateActivePostSettings({
      selectedProvider: nextProvider,
      selectedVoicePreset: nextPreset,
    });
  };

  const handleVoicePresetChange = (value: string) => {
    setSelectedVoicePreset(value);
    safeLocalStorageSetItem("selectedVoicePreset", value);
    updateActivePostSettings({ selectedVoicePreset: value });
  };

  const handleSpeedChange = (value: string) => {
    const nextSpeed = normalizeVoiceSpeed(value);
    setSelectedSpeed(nextSpeed);
    safeLocalStorageSetItem("selectedSpeed", String(nextSpeed));
    updateActivePostSettings({ selectedSpeed: nextSpeed });
  };

  const handleCommentVoiceModeChange = (value: string) => {
    const nextMode = value === "emotion" ? "emotion" : "fixed";
    setCommentVoiceMode(nextMode);
    safeLocalStorageSetItem("commentVoiceMode", nextMode);
    updateActivePostSettings({ commentVoiceMode: nextMode });
  };

  const handleBackgroundMusicChange = (serverPath: string) => {
    if (serverPath === "__none__") {
      setSelectedMusicPath("");
      safeLocalStorageRemoveItem("selectedBackgroundMusicPath");
      updateActivePostSettings({ selectedMusicPath: "" });
      return;
    }
    setSelectedMusicPath(serverPath);
    safeLocalStorageSetItem("selectedBackgroundMusicPath", serverPath);
    updateActivePostSettings({ selectedMusicPath: serverPath });
  };

  const handleBackgroundMusicVolumeChange = (value: string) => {
    setSelectedMusicVolumeInput(value);
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      const nextValue = clampBackgroundMusicPercent(parsed);
      setSelectedMusicVolumePercent(nextValue);
      safeLocalStorageSetItem(
        "selectedBackgroundMusicVolume",
        String(nextValue)
      );
      updateActivePostSettings({ selectedMusicVolumePercent: nextValue });
    }
  };

  const commitBackgroundMusicVolume = () => {
    const nextValue = clampBackgroundMusicPercent(selectedMusicVolumeInput);
    setSelectedMusicVolumePercent(nextValue);
    setSelectedMusicVolumeInput(String(nextValue));
    safeLocalStorageSetItem("selectedBackgroundMusicVolume", String(nextValue));
    updateActivePostSettings({ selectedMusicVolumePercent: nextValue });
  };

  const handleLibraryVideoChange = (postId: string, serverPath: string) => {
    const selected = availableVideos.find(
      (video) => video.serverPath === serverPath
    );
    if (!selected) {
      return;
    }

    setAssignedVideosByPostId((current) => ({
      ...current,
      [postId]: selected,
    }));
  };

  const handlePromotionVideoChange = (serverPath: string) => {
    const normalizedPath = serverPath === "__none__" ? "" : serverPath;
    setPromotionVideoPath(normalizedPath);
    if (normalizedPath) {
      safeLocalStorageSetItem("promotion.videoPath", normalizedPath);
    } else {
      safeLocalStorageRemoveItem("promotion.videoPath");
    }
    updateActivePostSettings({ promotionVideoPath: normalizedPath });
  };

  const handlePromotionPositionChange = (value: string) => {
    const position =
      value === "midroll" ? "midroll" : value === "outro" ? "outro" : "none";
    setPromotionPosition(position);
    safeLocalStorageSetItem("promotion.position", position);
    safeLocalStorageSetItem(
      "promotion.midroll.enabled",
      String(position === "midroll")
    );
    safeLocalStorageSetItem(
      "promotion.outro.enabled",
      String(position === "outro")
    );
    if (promotionVideoPath) {
      safeLocalStorageSetItem(
        position === "outro"
          ? "promotion.outro.path"
          : "promotion.midroll.path",
        promotionVideoPath
      );
    }
    updateActivePostSettings({ promotionPosition: position });
  };

  const handlePromotionUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) {
      return;
    }
    try {
      setPromotionError("");
      setIsUploadingPromotion(true);
      for (const file of files) {
        await uploadPromotionVideo(file, file.name.replace(/\.[^./\\]+$/, ""));
      }
      onRefreshPromotions?.();
    } catch (cause) {
      setPromotionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsUploadingPromotion(false);
    }
  };

  const handleDraftCreated = (
    postId: string,
    draft: VideoDraftDocument,
    signature: string
  ) => {
    setDraftsByPostId((current) => ({
      ...current,
      [postId]: draft,
    }));
    setDraftSignaturesByPostId((current) => ({
      ...current,
      [postId]: signature,
    }));
  };

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden px-3 py-2">
        {sourceVideoPreloadItems.map((source) => (
          <video
            aria-hidden="true"
            className="pointer-events-none absolute h-px w-px opacity-0"
            key={source.key}
            muted
            onDurationChange={(event) => {
              const durationMs = Math.round(event.currentTarget.duration * 1000);
              if (!Number.isFinite(durationMs) || durationMs < 500) return;
              setSourceVideoDurationsMs((current) =>
                current[source.key] === durationMs
                  ? current
                  : { ...current, [source.key]: durationMs }
              );
            }}
            playsInline
            preload="metadata"
            src={source.src}
          />
        ))}
        {/* Phần cấu hình dùng toàn bộ chiều cao còn lại và tự cuộn khi cửa sổ thấp. */}
        <div className="custom-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1">
          {/* Voice configuration */}
          <div className="rounded-lg border bg-muted/10 p-2">
            {(() => {
              const activePost = selectedPosts.find(
                (post) => post.post_id === activePreviewPostId
              );
              return activePost ? (
                <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[10px] text-muted-foreground">
                  Đang chỉnh riêng cho <span className="font-semibold text-foreground">@{activePost.username}</span>
                </div>
              ) : null;
            })()}
            <div className="mb-2 grid gap-1 rounded-md border border-dashed p-1.5">
              <span className="text-[10px] font-semibold">Chế độ đọc</span>
              <Select
                value={videoMode}
                onValueChange={(value) => {
                  const nextMode = value as
                    | "single_post_recap"
                    | "dialogue"
                    | "thread_pages";
                  if (nextMode === "dialogue") {
                    void handleReadDialogueImage();
                    return;
                  }
                  setVideoMode(nextMode);
                  updateActivePostSettings({ videoMode: nextMode });
                }}
              >
                <SelectTrigger className="h-7 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="thread_pages">Đọc Threads theo trang</SelectItem>
                  <SelectItem value="single_post_recap">Một giọng kể chuyện</SelectItem>
                  {hasStaticImage ? (
                    <SelectItem value="dialogue">Hội thoại trong ảnh</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              {hasCaptionVideo ? (
                <label className="mt-1 flex cursor-pointer items-start gap-1.5 rounded-md border border-sky-200/70 bg-sky-50/60 px-2 py-1.5 text-[10px] dark:border-sky-500/20 dark:bg-sky-950/20">
                  <input
                    checked={playPostVideoAfterCaption}
                    className="mt-0.5 accent-sky-600"
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setPlayPostVideoAfterCaption(checked);
                      updateActivePostSettings({
                        playPostVideoAfterCaption: checked,
                      });
                    }}
                    type="checkbox"
                  />
                  <span>
                    <span className="block font-semibold text-sky-800 dark:text-sky-200">
                      Phát video gốc sau khi đọc caption
                    </span>
                    <span className="block text-muted-foreground">
                      Áp dụng cho video trong bài viết và comment, phát xong mới chuyển cảnh. Nếu nhập thời lượng, đó là tổng phần đọc caption và phần video.
                    </span>
                  </span>
                </label>
              ) : null}
              {ocrBusy && videoMode !== "dialogue" ? (
                <span className="text-[10px] text-muted-foreground">
                  Đang kiểm tra ảnh có hội thoại...
                </span>
              ) : null}
              {ocrError && videoMode !== "dialogue" ? (
                <span className="text-[10px] text-amber-600">{ocrError}</span>
              ) : null}
              {hasStaticImage && videoMode === "dialogue" ? (
                <div className="grid gap-1">
                  <div className="grid grid-cols-2 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={ocrBusy}
                      onClick={handleReadDialogueImage}
                    >
                      {ocrBusy ? (
                        <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                      ) : null}
                      Đọc chữ trong ảnh
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={dialogueAiBusy || !dialogue?.lines.length}
                      onClick={handleSuggestDialogueText}
                      title={
                        llmTextConfigured
                          ? "Correct OCR text with AI"
                          : "AI text key is not configured"
                      }
                    >
                      {dialogueAiBusy ? (
                        <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1 h-3 w-3" />
                      )}
                      AI gợi ý
                    </Button>
                  </div>
                  {dialogue ? (
                    <span className="text-[10px] text-muted-foreground">
                      {dialogue.lines.length} dòng hội thoại
                      {singleDialogueSpeaker
                        ? ' · nhận ra 1 người nói (' + singleDialogueSpeaker + ')'
                        : '.'}
                    </span>
                  ) : null}
                  {ocrError ? (
                    <span className="text-[10px] text-destructive">
                      OCR lỗi: {ocrError}
                    </span>
                  ) : null}
                  {dialogueAiMessage ? (
                    <span
                      className={
                        dialogueAiFailed
                          ? "text-[10px] text-destructive"
                          : "text-[10px] text-emerald-600"
                      }
                    >
                      {dialogueAiMessage}
                    </span>
                  ) : null}
                  {dialogue && dialogue.lines.length === 0 ? (
                    <span className="text-[10px] text-amber-600">
                      Chưa nhận diện được chữ trong ảnh; hãy bấm Đọc chữ trong ảnh hoặc thêm dòng thủ công.
                    </span>
                  ) : null}
                  {dialogue && dialogue.lines.some((line) => line.confidence < 70) ? (
                    <span className="text-[10px] text-amber-600">
                      Có dòng nhận diện độ tin cậy thấp; hãy sửa lại trước khi lưu.
                    </span>
                  ) : null}
                  {dialogueSaveMessage ? (
                    <span className="text-[10px]">
                      {dialogueSaveMessage}
                    </span>
                  ) : null}
                  {dialogue ? (
                    <div className={singleDialogueSpeaker ? 'grid grid-cols-1 gap-1' : 'grid grid-cols-2 gap-1'}>
                      {(singleDialogueSpeaker ? [singleDialogueSpeaker] : (["A", "B"] as const)).map((speaker) => (
                        <Select
                          key={speaker}
                          value={dialogue.speakers[speaker].voiceName}
                          onValueChange={(value) => {
                            markDialogueDirty();
                            const preset = allVoicePresets.find(
                              (item) => item.settings.voiceName === value
                            );
                            if (!preset) return;
                            setDialogue((current) =>
                              current
                                ? {
                                    ...current,
                                    confirmed: false,
                                    speakers: {
                                      ...current.speakers,
                                      [speaker]: {
                                        ...preset.settings,
                                        speakingRate: effectiveSpeakingRate,
                                      },
                                    },
                                  }
                                : current
                            );
                          }}
                        >
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue placeholder={"Voice " + speaker} />
                          </SelectTrigger>
                          <SelectContent>
                            {allVoicePresets.map((preset) => (
                              <SelectItem
                                key={preset.value}
                                value={preset.settings.voiceName}
                              >
                                {speaker + ": " + preset.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ))}
                    </div>
                  ) : null}
                  {dialogue?.lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_auto_auto] gap-1"
                    >
                      <Input
                        value={line.text}
                        onChange={(event) => {
                          markDialogueDirty();
                          setDialogue((current) =>
                            current
                              ? {
                                  ...current,
                                  confirmed: false,
                                  lines: current.lines.map((item) =>
                                    item.id === line.id
                                      ? { ...item, text: event.target.value }
                                      : item
                                  ),
                                }
                              : current
                          );
                        }}
                        className="h-7 text-[11px]"
                      />
                      <Select
                        value={line.speaker}
                        onValueChange={(value) => {
                          markDialogueDirty();
                          setDialogue((current) =>
                            current
                              ? {
                                  ...current,
                                  confirmed: false,
                                  lines: current.lines.map((item) =>
                                    item.id === line.id
                                      ? {
                                          ...item,
                                          speaker: value as DialogueLine["speaker"],
                                        }
                                      : item
                                  ),
                                }
                              : current
                          );
                        }}
                      >
                        <SelectTrigger className="h-7 w-20 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A">A</SelectItem>
                          <SelectItem value="B">B</SelectItem>
                          <SelectItem value="unknown">?</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        aria-label={'Xóa dòng ' + line.order}
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveDialogueLine(line.id)}
                        size="icon"
                        title="Xóa dòng"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    className="h-7 w-full border-dashed text-[11px]"
                    onClick={handleAddDialogueLine}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Thêm dòng
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-[minmax(5.5rem,0.85fr)_minmax(0,1.5fr)_minmax(5.5rem,0.85fr)] gap-x-2 gap-y-1.5">              {/* Hàng 1: Nhà cung cấp | Chọn giọng | Tốc độ */}
              <div className="grid min-w-0 gap-0.5">
                <span className="truncate font-medium text-[10px] text-muted-foreground">
                  Nhà cung cấp
                </span>
                <Select
                  onValueChange={handleProviderChange}
                  value={selectedProvider}
                >
                  <SelectTrigger className="h-6 w-full min-w-0 text-[11px] [&>span]:truncate">
                    <SelectValue placeholder="Nhà cung cấp" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProviders.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-w-0 gap-0.5">
                <span className="truncate font-medium text-[10px] text-muted-foreground">
                  Chọn giọng
                </span>
                <div className="flex min-w-0 gap-1">
                  <div className="min-w-0 flex-1">
                    <Select
                      onValueChange={handleVoicePresetChange}
                      value={selectedVoice.value}
                    >
                      <SelectTrigger className="h-6 w-full min-w-0 text-[11px] [&>span]:truncate">
                        <SelectValue placeholder="Chọn giọng" />
                      </SelectTrigger>
                      <SelectContent>
                        {providerPresets.map((preset) => (
                          <SelectItem key={preset.value} value={preset.value}>
                            {preset.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedProvider === "vivibe" ? (
                    <Button
                      aria-label={
                        isVoicePreviewPlaying ? "Dừng nghe thử giọng" : "Nghe thử giọng"
                      }
                      className="h-6 w-6 shrink-0 p-0"
                      disabled={!selectedVoice.previewUrl}
                      onClick={handleVoicePreview}
                      title={
                        selectedVoice.previewUrl
                          ? "Nghe thử miễn phí từ audio preview của ViVibe"
                          : "Voice này chưa có audio preview miễn phí từ ViVibe"
                      }
                      type="button"
                      variant="outline"
                    >
                      {isVoicePreviewPlaying ? (
                        <Pause className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid min-w-0 gap-0.5">
                <span className="font-medium text-[10px] text-muted-foreground">
                  Tốc độ
                </span>
                <Select
                  onValueChange={handleSpeedChange}
                  value={String(selectedSpeed)}
                >
                  <SelectTrigger className="h-6 w-full min-w-0 text-[11px] [&>span]:truncate">
                    <SelectValue placeholder="Tốc độ" />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_SPEED_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={String(option.value)}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Hàng 2: Giọng comment | Khung bài */}
              <div className="col-span-2 grid min-w-0 gap-0.5">
                <span className="truncate font-medium text-[10px] text-muted-foreground">
                  Giọng comment
                </span>
                <Select
                  onValueChange={handleCommentVoiceModeChange}
                  value={commentVoiceMode}
                >
                  <SelectTrigger className="h-6 w-full min-w-0 text-[11px] [&>span]:truncate">
                    <SelectValue placeholder="Kiểu giọng comment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Giữ một giọng</SelectItem>
                    <SelectItem value="emotion">Đổi theo cảm xúc</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-w-0 gap-0.5">
                <span className="font-medium text-[10px] text-muted-foreground">
                  Khung bài
                </span>
                <div className="flex h-6 gap-0.5 rounded-md border bg-muted/30 p-0.5">
                  <button
                    className={`flex-1 rounded font-medium text-[11px] transition-colors ${
                      cardTheme === "light"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => handleCardThemeChange("light")}
                    type="button"
                  >
                    Sáng
                  </button>
                  <button
                    className={`flex-1 rounded font-medium text-[11px] transition-colors ${
                      cardTheme === "dark"
                        ? "bg-slate-800 text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => handleCardThemeChange("dark")}
                    type="button"
                  >
                    Tối
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border bg-muted/10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <Music className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="font-semibold text-[11px] text-foreground">Nhạc nền</p>
                  <p className="truncate text-[9px] text-muted-foreground">
                    {selectedBackgroundMusic ? "Đã chọn nhạc nền" : "Chưa chọn nhạc nền"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[9px]">
                <Link
                  className="inline-flex items-center gap-0.5 rounded-md border bg-background px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Thư viện nhạc"
                  to="/music-library"
                >
                  Nhạc <ExternalLink className="size-2.5" />
                </Link>
                {!hideGlobalMemePicker ? (
                  <Link
                    className="inline-flex items-center gap-0.5 rounded-md border bg-background px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Thư viện meme"
                    to="/meme-library"
                  >
                    Meme <ExternalLink className="size-2.5" />
                  </Link>
                ) : null}
              </div>
            </div>

            <div className={`grid gap-2 ${hideGlobalMemePicker ? "grid-cols-1" : "grid-cols-2"}`}>
              <label className="grid min-w-0 gap-1">
                <span className="text-[9px] font-medium text-muted-foreground">Bản nhạc</span>
                <Select
                  onValueChange={handleBackgroundMusicChange}
                  value={selectedMusicPath || undefined}
                >
                  <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-[11px] [&>span]:truncate">
                    <SelectValue placeholder="Chọn nhạc">
                      {selectedBackgroundMusic
                        ? compactVideoName(
                            selectedBackgroundMusic.name,
                            hideGlobalMemePicker ? 26 : 12
                          )
                        : "Chọn nhạc"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Không dùng nhạc</SelectItem>
                    {availableMusic.map((track) => (
                      <SelectItem
                        key={track.serverPath || track.name}
                        title={track.name}
                        value={track.serverPath || track.name}
                      >
                        {compactVideoName(track.name, 28)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              {hideGlobalMemePicker ? null : (
                <label className="grid min-w-0 gap-1">
                  <span className="text-[9px] font-medium text-muted-foreground">Meme chuyển cảnh</span>
                  <Select
                    onValueChange={handleMemeEmotionChange}
                    value={selectedMemeEmotion || undefined}
                  >
                    <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-[11px] [&>span]:truncate">
                      <SelectValue placeholder="Chọn cảm xúc" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Không dùng meme</SelectItem>
                      {memeLibraryItems
                        .filter(
                          (item) => item.image?.mediaUrl || item.audio?.mediaUrl
                        )
                        .map((item) => (
                          <SelectItem key={item.emotion} value={item.emotion}>
                            {item.label ??
                              MEME_EMOTION_LABELS[item.emotion] ??
                              item.emotion}
                            {item.image?.mediaUrl && item.audio?.mediaUrl
                              ? " ✓"
                              : item.image?.mediaUrl
                                ? " 🖼"
                                : " 🎵"}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
                </label>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t pt-1.5 text-[9px]">
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-medium text-muted-foreground">Âm lượng</span>
                <Volume2 className="size-3 text-muted-foreground" />
                <Input
                  className="h-6 w-12 bg-background px-1 text-center text-[10px]"
                  disabled={!selectedBackgroundMusic}
                  inputMode="numeric"
                  max={100}
                  min={0}
                  onBlur={commitBackgroundMusicVolume}
                  onChange={(event) =>
                    handleBackgroundMusicVolumeChange(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitBackgroundMusicVolume();
                      event.currentTarget.blur();
                    }
                  }}
                  type="number"
                  value={selectedMusicVolumeInput}
                />
                <span className="font-medium text-muted-foreground">%</span>
                <button
                  className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={onRefreshMusic}
                  title="Làm mới thư viện nhạc"
                  type="button"
                >
                  <RefreshCw
                    className={`h-2.5 w-2.5 ${isRefreshingMusic ? "animate-spin" : ""}`}
                  />
                </button>
              </div>

            </div>
          </div>

          <details className="min-w-0 rounded-lg border bg-muted/10 text-xs">
            <summary className="flex min-w-0 cursor-pointer select-none list-none items-center justify-between gap-2 px-2 py-1.5">
              <span className="min-w-0 truncate font-semibold text-[11px] text-slate-700 dark:text-slate-200">
                Video quảng bá / quảng cáo
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {promotionPosition === "none" || !selectedPromotionVideo
                  ? "Chưa chèn"
                  : promotionPosition === "midroll"
                    ? "Giữa video"
                    : "Cuối video"}{" "}
                ▾
              </span>
            </summary>
            <div className="min-w-0 space-y-2 border-t px-2 pt-2 pb-2">
              <input
                accept="video/*"
                className="hidden"
                multiple
                onChange={(event) => void handlePromotionUpload(event)}
                ref={promotionInputRef}
                type="file"
              />

              <div className="grid min-w-0 grid-cols-2 gap-2">
                <div className="grid min-w-0 gap-0.5">
                  <span className="font-medium text-[10px] text-muted-foreground">
                    Vị trí chèn
                  </span>
                  <Select
                    onValueChange={handlePromotionPositionChange}
                    value={promotionPosition}
                  >
                    <SelectTrigger className="h-6 min-w-0 text-[11px] [&>span]:truncate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Không chèn</SelectItem>
                      <SelectItem value="midroll">Giữa video</SelectItem>
                      <SelectItem value="outro">Cuối video</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid min-w-0 gap-0.5">
                  <span className="font-medium text-[10px] text-muted-foreground">
                    Video sử dụng
                  </span>
                  <Select
                    onValueChange={handlePromotionVideoChange}
                    value={promotionVideoPath || "__none__"}
                  >
                    <SelectTrigger
                      className="h-6 w-full min-w-0 overflow-hidden text-[11px]"
                      title={selectedPromotionVideo?.name}
                    >
                      <SelectValue
                        className="sr-only"
                        placeholder="Chọn video"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none min-w-0 flex-1 truncate text-left"
                      >
                        {selectedPromotionVideo
                          ? compactVideoName(selectedPromotionVideo.name, 14)
                          : "Chọn video"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Chưa chọn video</SelectItem>
                      {availablePromotionVideos.map((video) => (
                        <SelectItem
                          key={video.serverPath || video.name}
                          value={video.serverPath || video.name}
                        >
                          {compactVideoName(video.name, 32)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[9.5px] text-muted-foreground leading-tight">
                “Giữa video” được chèn tại điểm chuyển nội dung gần giữa
                timeline nhất.
              </p>

              <div className="grid min-w-0 grid-cols-2 gap-2">
                <div className="grid min-w-0 gap-0.5">
                  <span className="font-medium text-[10px] text-muted-foreground">
                    Cách hiển thị
                  </span>
                  <Select
                    onValueChange={(value) => {
                      const mode = value === "contain" ? "contain" : "cover";
                      setPromotionFitMode(mode);
                      safeLocalStorageSetItem("promotion.fitMode", mode);
                      updateActivePostSettings({ promotionFitMode: mode });
                    }}
                    value={promotionFitMode}
                  >
                    <SelectTrigger className="h-6 min-w-0 text-[11px] [&>span]:truncate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cover">Cắt đầy khung</SelectItem>
                      <SelectItem value="contain">Hiển thị toàn bộ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-0.5">
                  <span className="font-medium text-[10px] text-muted-foreground">
                    Âm lượng
                  </span>
                  <Input
                    className="h-6 px-2 text-[11px]"
                    max={100}
                    min={0}
                    onChange={(event) => {
                      const value = clampPromotionVolumePercent(
                        event.currentTarget.value
                      );
                      setPromotionVolumePercent(value);
                      safeLocalStorageSetItem(
                        "promotion.volume",
                        String(value)
                      );
                      updateActivePostSettings({
                        promotionVolumePercent: value,
                      });
                    }}
                    type="number"
                    value={promotionVolumePercent}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  className="h-7 flex-1 text-[10px]"
                  disabled={isUploadingPromotion}
                  onClick={() => promotionInputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isUploadingPromotion ? (
                    <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-3 w-3" />
                  )}
                  Thêm video quảng bá
                </Button>
                <Button
                  className="size-7"
                  onClick={onRefreshPromotions}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${isRefreshingPromotions ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
              {promotionError ? (
                <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[9.5px] text-destructive">
                  {promotionError}
                </p>
              ) : null}
            </div>
          </details>

          <details className="rounded-lg border bg-muted/10 text-xs">
            <summary className="flex cursor-pointer select-none list-none items-center justify-between px-2 py-1.5">
              <span className="font-semibold text-[11px] text-slate-700 dark:text-slate-200">
                Từ điển viết tắt
              </span>
              <span className="text-[10px] text-muted-foreground">
                {
                  editingAbbrevs.filter((r) => r.key.trim() && r.value.trim())
                    .length
                }{" "}
                từ ▾
              </span>
            </summary>
            <div className="border-t px-2 pt-1.5 pb-2">
              <input
                accept=".csv,text/csv"
                className="hidden"
                onChange={() => undefined}
                ref={undefined}
                type="file"
              />
              <div className="mb-1.5 flex hidden gap-1">
                <Button
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => undefined}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {null}
                  Import CSV
                </Button>
                <Button
                  className="h-7 flex-1 border-dashed text-[11px]"
                  onClick={handleAddAbbrevRow}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  + Thêm từ mới
                </Button>
              </div>
              <p className="mb-1 hidden text-[10px] text-muted-foreground">
                Import file CSV từ Google Sheets hoặc Excel. Header nên dùng
                <span className="font-mono"> key,value </span>
                hoặc
                <span className="font-mono"> viết tắt,đọc thành</span>.
              </p>
              <p className="mb-1 hidden text-[10px] text-muted-foreground">
                Ví dụ: <span className="font-mono">ae,anh em</span> hoặc
                <span className="font-mono"> nma,nhưng mà</span>.
              </p>
              {false ? (
                <p className="mb-1.5 hidden text-[10px] text-muted-foreground">
                  {""}
                </p>
              ) : null}
              <Button
                className="mb-1.5 h-7 w-full border-dashed text-[11px]"
                onClick={handleAddAbbrevRow}
                size="sm"
                type="button"
                variant="outline"
              >
                + Thêm từ viết tắt mới
              </Button>
              <div className="custom-scrollbar max-h-[156px] space-y-1 overflow-y-auto pr-0.5">
                <div className="grid grid-cols-[1fr_1fr_1.5rem] gap-1 px-0.5 font-medium text-[9px] text-muted-foreground uppercase tracking-wider">
                  <span>Viết tắt</span>
                  <span>Đọc thành</span>
                  <span />
                </div>
                {editingAbbrevs.map((row, idx) => (
                  <div
                    className="grid grid-cols-[1fr_1fr_1.5rem] items-center gap-1"
                    key={row.id}
                  >
                    <input
                      className="h-6 min-w-0 rounded border bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                      onChange={(e) =>
                        handleAbbrevRowChange(idx, "key", e.target.value)
                      }
                      placeholder="vd: ae"
                      type="text"
                      value={row.key}
                    />
                    <input
                      className="h-6 min-w-0 rounded border bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                      onChange={(e) =>
                        handleAbbrevRowChange(idx, "value", e.target.value)
                      }
                      placeholder="vd: anh em"
                      type="text"
                      value={row.value}
                    />
                    <Button
                      className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveAbbrevRow(row.id)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                className="mt-1.5 hidden h-7 w-full border-dashed text-[11px]"
                onClick={handleAddAbbrevRow}
                size="sm"
                type="button"
                variant="outline"
              >
                + Thêm từ viết tắt mới
              </Button>
            </div>
          </details>
        </div>
        {/* end config */}

        {/* Danh sách bài viết + video nền */}
        <div className="mt-auto flex shrink-0 flex-col gap-2 pt-2">
          <div className="flex h-[140px] shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/10">
            {/* Header */}
            <div className="grid grid-cols-2 gap-2 border-b px-2 py-1.5">
              <span className="font-semibold text-[11px] text-slate-700 dark:text-slate-200">
                Bài viết đã chọn
                <span className="ml-1.5 rounded-full bg-background px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
                  {selectedPosts.length}
                </span>
              </span>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[11px] text-slate-700 dark:text-slate-200">
                  Video nền
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="flex size-5 items-center justify-center rounded border bg-background text-muted-foreground transition-colors hover:bg-muted"
                    onClick={onRefreshVideos}
                    title="Làm mới thư viện"
                    type="button"
                  >
                    <RefreshCw
                      className={`h-2.5 w-2.5 ${isRefreshingVideos ? "animate-spin" : ""}`}
                    />
                  </button>
                  <Link
                    className="flex h-5 items-center gap-0.5 rounded border bg-background px-1.5 font-medium text-[10px] text-slate-700 transition-colors hover:bg-muted dark:text-slate-200"
                    to="/video-library"
                  >
                    Quản lý
                    <ExternalLink className="h-2.5 w-2.5 text-slate-400 dark:text-slate-500" />
                  </Link>
                </div>
              </div>
            </div>

            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
              {selectedPosts.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                  Chưa có bài viết nào được chọn.
                </div>
              ) : (
                selectedPosts.map((post) => {
                  const isActive = activePreviewPostId === post.post_id;
                  const currentSignature =
                    currentSignaturesByPostId[post.post_id];
                  const voiceReady =
                    Boolean(
                      draftsByPostId[post.post_id]?.video_plan.voice_ready
                    ) &&
                    isVoiceDraftSignatureReusable({
                      currentSignature,
                      draftSignature: draftSignaturesByPostId[post.post_id],
                    });
                  const assignedVideo = assignedVideosByPostId[post.post_id];

                  return (
                    <div
                      className={`relative grid cursor-pointer grid-cols-2 gap-2 border-b px-2 py-1 transition-colors duration-150 last:border-b-0 ${
                        isActive
                          ? "bg-muted/60 dark:bg-muted/50"
                          : "hover:bg-muted/40"
                      }`}
                      key={post.post_id}
                      onClick={() => handleActivePreviewPostChange(post.post_id)}
                    >
                      {isActive && (
                        <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-foreground/55" />
                      )}
                      <button
                        className="flex min-w-0 items-center gap-1.5 text-left"
                        onClick={() =>
                          handleActivePreviewPostChange(post.post_id)
                        }
                        type="button"
                      >
                        <span
                          className={`truncate text-[11px] ${
                            isActive
                              ? "font-bold text-foreground"
                              : "font-semibold"
                          }`}
                        >
                          @{post.username}
                        </span>
                        {voiceReady && (
                          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold text-[9px] text-emerald-700">
                            ✓
                          </span>
                        )}
                      </button>

                      <div
                        onClick={(event) => {
                          event.stopPropagation();
                          handleActivePreviewPostChange(post.post_id);
                        }}
                      >
                        <Select
                          onValueChange={(value) =>
                            handleLibraryVideoChange(post.post_id, value)
                          }
                          value={assignedVideo?.serverPath ?? undefined}
                        >
                          <SelectTrigger className="h-6 w-full text-[11px]">
                            <SelectValue placeholder="Chọn video..." />
                          </SelectTrigger>
                          <SelectContent>
                            {availableVideos.map((video) => (
                              <SelectItem
                                key={video.serverPath || video.name}
                                value={video.serverPath || video.name}
                              >
                                {compactVideoName(video.name)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {selectedPosts.length > 0 && (
            <div
              className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground"
              title="Ước tính theo text TTS, tốc độ đọc, thời gian thumbnail, meme và ảnh trong bình luận. Thời lượng voice thực tế có thể chênh nhẹ."
            >
              <Clock3 className="size-3 shrink-0" />
              <span>
                Ước tính video: ~{formatEstimatedDuration(estimatedActiveDurationMs)}
              </span>
              {selectedPosts.length > 1 && (
                <span className="text-muted-foreground/75">
                  · Tổng {selectedPosts.length} video: ~
                  {formatEstimatedDuration(estimatedTotalDurationMs)}
                </span>
              )}
            </div>
          )}

          <div className="shrink-0 pb-1">
                        <VideoDraftActions
              dialogue={videoMode === "dialogue" ? dialogue : null}
              abbreviations={abbreviations}
              assignedVideosByPostId={assignedVideosByPostId}
              backgroundMusic={selectedBackgroundMusic}
              backgroundMusicVolume={selectedMusicVolumePercent / 100}
              cardTheme={cardTheme}
              commentVoiceMode={commentVoiceMode}
              draftSignaturesByPostId={draftSignaturesByPostId}
              draftsByPostId={draftsByPostId}
              memeBySceneId={memeBySceneId}
              memeTransition={effectiveMemeTransition}
              thumbnailIntro={thumbnailIntro}
              onDraftCreated={handleDraftCreated}
              outputPath={outputPath}
              promotion={promotionConfig}
              selectedPosts={selectedPosts}
              storageKey={storageKey}
              voiceConfigured={voiceConfigured}
              voiceSettings={voiceSettings}
              workflowOptionsByPostId={workflowOptionsByPostId}
            />
          </div>


        </div>
      </CardContent>
    </Card>
  );
};

function normalizeDialogueLines(lines: DialogueLine[]): DialogueLine[] {
  const nonEmptyLines = lines.filter((line) => line.text.trim());
  const knownSpeakers = nonEmptyLines.filter(
    (line) => line.speaker === 'A' || line.speaker === 'B',
  );
  const singleSpeaker = knownSpeakers.length >= 2
    ? getSingleDialogueSpeaker(nonEmptyLines)
    : null;
  return normalizeDialogueLineOrder(
    nonEmptyLines.map((line) =>
      singleSpeaker && line.speaker === 'unknown'
        ? { ...line, speaker: singleSpeaker }
        : line,
    ),
  );
}

function normalizeDialogueLineOrder(lines: DialogueLine[]): DialogueLine[] {
  return lines.map((line, index) => ({
    ...line,
    order: index + 1,
  }));
}

function getSingleDialogueSpeaker(lines: DialogueLine[]): 'A' | 'B' | null {
  const knownSpeakers = lines
    .map((line) => line.speaker)
    .filter((speaker): speaker is 'A' | 'B' => speaker === 'A' || speaker === 'B');
  const firstSpeaker = knownSpeakers[0];
  if (!firstSpeaker || !knownSpeakers.every((speaker) => speaker === firstSpeaker)) {
    return null;
  }
  return firstSpeaker;
}

function hasRecognizedDialogue(lines: DialogueLine[]): boolean {
  const spokenLines = lines.filter(
    (line) =>
      line.text.trim().length > 0 &&
      (line.speaker === "A" || line.speaker === "B"),
  );
  return (
    spokenLines.length >= 2 &&
    new Set(spokenLines.map((line) => line.speaker)).size === 2
  );
}

function compactVideoName(name: string, maxLength = 34): string {
  const trimmed = String(name ?? "").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const extensionIndex = trimmed.lastIndexOf(".");
  const extension =
    extensionIndex > 0 && extensionIndex < trimmed.length - 1
      ? trimmed.slice(extensionIndex)
      : "";
  const baseName = extension ? trimmed.slice(0, extensionIndex) : trimmed;
  const available = Math.max(8, maxLength - extension.length - 3);
  const headLength = Math.ceil(available * 0.6);
  const tailLength = Math.max(4, available - headLength);

  return `${baseName.slice(0, headLength)}...${baseName.slice(
    Math.max(headLength, baseName.length - tailLength)
  )}${extension}`;
}

function readStoredSelectedPostsPanelState(
  storageKey: string
): StoredSelectedPostsPanelState | null {
  try {
    const persistedKey = `${VIDEO_WORKFLOW_PANEL_STATE_PREFIX}${storageKey}`;
    const raw =
      safeLocalStorageGetItem(persistedKey) ??
      safeSessionStorageGetItem(persistedKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as StoredSelectedPostsPanelState;
  } catch {
    return null;
  }
}

function writeStoredSelectedPostsPanelState(
  storageKey: string,
  state: StoredSelectedPostsPanelState
): void {
  try {
    const persistedKey = `${VIDEO_WORKFLOW_PANEL_STATE_PREFIX}${storageKey}`;
    const serialized = JSON.stringify(state);
    safeSessionStorageSetItem(persistedKey, serialized);
    safeLocalStorageSetItem(persistedKey, serialized);
  } catch {
    return;
  }
}

type MemeAssetReference = {
  mediaUrl?: string;
  name: string;
  serverPath?: string;
};

function getMemeAssetPath(asset: MemeAssetReference | null | undefined): string {
  return asset?.serverPath ?? asset?.mediaUrl ?? asset?.name ?? "";
}

function pickRandomMemeAsset<T extends MemeAssetReference>(
  assets: T[] | undefined,
  legacyAsset: T | null | undefined
): T | null {
  const pool = pickMemeAssetPool(assets, legacyAsset);
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function findMemeAssetByPath<T extends MemeAssetReference>(
  assets: T[] | undefined,
  legacyAsset: T | null | undefined,
  assetPath: string | undefined
): T | null {
  if (!assetPath) {
    return null;
  }
  const pool = pickMemeAssetPool(assets, legacyAsset);
  return (
    pool.find(
      (asset) =>
        asset.serverPath === assetPath ||
        asset.mediaUrl === assetPath ||
        asset.name === assetPath
    ) ?? null
  );
}

function pickMemeAssetPool<T extends MemeAssetReference>(
  assets: T[] | undefined,
  legacyAsset: T | null | undefined
): T[] {
  const pool = [...(assets ?? [])];
  if (
    legacyAsset &&
    !pool.some((asset) => getMemeAssetPath(asset) === getMemeAssetPath(legacyAsset))
  ) {
    pool.push(legacyAsset);
  }
  return pool;
}

function getMemeTransitionDurationMs(
  imageDurationSeconds: number | null | undefined,
  audioDurationSeconds: number | null | undefined,
  playbackSpeed: number
): number {
  const imageDurationMs =
    typeof imageDurationSeconds === "number" && imageDurationSeconds > 0
      ? Math.round(imageDurationSeconds * 1000)
      : 0;
  if (imageDurationMs > 0) {
    const audioDurationMs =
      typeof audioDurationSeconds === "number" && audioDurationSeconds > 0
        ? Math.round(audioDurationSeconds * 1000)
        : 0;
    return Math.max(MIN_MEME_TRANSITION_MS, imageDurationMs + audioDurationMs);
  }

  const normalizedSpeed = Number.isFinite(playbackSpeed)
    ? Math.min(2, Math.max(0.5, playbackSpeed))
    : 1;
  const baseDurationMs = audioDurationSeconds
    ? Math.round(audioDurationSeconds * 1000)
    : DEFAULT_MEME_TRANSITION_MS;
  return Math.min(
    MAX_MEME_TRANSITION_MS,
    Math.max(
      MIN_MEME_TRANSITION_MS,
      Math.round(baseDurationMs / normalizedSpeed)
    )
  );
}

function estimateVideoDurationMs({
  globalMemeTransition,
  memeBySceneId,
  playPostVideoAfterCaption,
  post,
  promotion,
  sourceVideoDurationsMs = {},
  speakingRate,
  thumbnailIntro,
}: {
  globalMemeTransition: MemeTransitionConfig | null;
  memeBySceneId?: Record<string, SelectedMemeEntry | null>;
  playPostVideoAfterCaption?: boolean;
  post: CrawlPost;
  promotion: VideoPromotionConfig | null;
  sourceVideoDurationsMs?: Record<string, number>;
  speakingRate: number;
  thumbnailIntro: VideoThumbnailIntro | null;
}): number {
  const selectedComments = post.top_comments.filter(
    (comment) => comment.selected_for_video !== false
  );
  const sceneMemeDuration = (sceneId: string) => {
    const meme = memeBySceneId?.[sceneId];
    return estimateMemeDurationMs(meme?.durationMs, meme);
  };
  const postText = post.tts_text?.trim() || post.text;
  const postHoldMs = post.is_spoiler
    ? post.spoiler_media || post.media.length > 0
      ? 1300
      : 900
    : 450;
  const automaticPostDurationMs =
    Math.max(estimateNarrationDurationMs(postText, speakingRate), 2800) +
    postHoldMs +
    sceneMemeDuration(post.post_id);
  const customPostDurationMs =
    typeof post.video_duration_seconds === "number" &&
    Number.isFinite(post.video_duration_seconds) &&
    post.video_duration_seconds > 0
      ? Math.min(120_000, Math.max(500, Math.round(post.video_duration_seconds * 1000)))
      : 0;
  const postHasSourceVideo = post.media.some(
    (media) =>
      media.type === "video" &&
      (Boolean(media.asset_path) || Boolean(media.remote_url))
  );
  let durationMs = Math.max(automaticPostDurationMs, customPostDurationMs);
  if (playPostVideoAfterCaption && postHasSourceVideo) {
    const captionDurationMs =
      estimateNarrationDurationMs(postText, speakingRate) +
      sceneMemeDuration(post.post_id);
    const postVideoDurationMs =
      customPostDurationMs > 0
        ? Math.max(500, customPostDurationMs - captionDurationMs)
        : resolveCrawledVideoDurationMs(post, sourceVideoDurationsMs) ??
          DEFAULT_POST_VIDEO_DURATION_MS;
    durationMs = captionDurationMs + postVideoDurationMs;
  }

  for (const comment of selectedComments) {
    const commentText = comment.tts_text?.trim() || comment.text;
    const commentLength = commentText.trim().length;
    const mediaHoldMs =
      comment.media.length > 0
        ? commentLength <= 28
          ? 1200
          : commentLength <= 60
            ? 700
            : 0
        : 0;
    const minimumNarrationMs =
      commentLength <= 28
        ? 1500
        : commentLength <= 60
          ? 1300
          : commentLength <= 100
            ? 1100
            : 0;
    const spoilerHoldMs = comment.is_spoiler
      ? comment.spoiler_media || comment.media.length > 0
        ? 1300
        : 700
      : 0;

    const automaticCommentDurationMs =
      Math.max(
        estimateNarrationDurationMs(commentText, speakingRate),
        minimumNarrationMs
      ) +
      550 +
      mediaHoldMs +
      spoilerHoldMs +
      sceneMemeDuration(comment.comment_id);
    const customCommentDurationMs =
      typeof comment.video_duration_seconds === "number" &&
      Number.isFinite(comment.video_duration_seconds) &&
      comment.video_duration_seconds > 0
        ? Math.min(120_000, Math.max(500, Math.round(comment.video_duration_seconds * 1000)))
        : 0;

    const commentHasSourceVideo = comment.media.some(
      (media) =>
        media.type === "video" &&
        (Boolean(media.asset_path) || Boolean(media.remote_url))
    );
    if (playPostVideoAfterCaption && commentHasSourceVideo) {
      const captionDurationMs =
        estimateNarrationDurationMs(commentText, speakingRate) +
        sceneMemeDuration(comment.comment_id);
      const videoDurationMs =
        customCommentDurationMs > 0
          ? Math.max(500, customCommentDurationMs - captionDurationMs)
          : resolveCrawledVideoDurationMs(comment, sourceVideoDurationsMs) ??
            DEFAULT_POST_VIDEO_DURATION_MS;
      durationMs += captionDurationMs + videoDurationMs;
    } else {
      durationMs += Math.max(
        automaticCommentDurationMs,
        customCommentDurationMs
      );
    }
  }

  if (globalMemeTransition && selectedComments.length > 0) {
    durationMs += estimateMemeDurationMs(
      globalMemeTransition.durationMs,
      globalMemeTransition
    );
  }

  if (thumbnailIntro?.enabled) {
    durationMs += Math.max(0, thumbnailIntro.durationMs);
  }

  return Math.max(
    0,
    Math.round(
      durationMs +
        estimatePromotionDurationMs(
          promotion,
          durationMs,
          selectedComments.length + 1
        )
    )
  );
}

function resolveCrawledVideoDurationMs(
  source: Pick<CrawlPost | CrawlComment, "media">,
  sourceVideoDurationsMs: Record<string, number> = {}
): number | undefined {
  const video = source.media.find((media) => media.type === "video");
  if (!video) return undefined;
  const declaredDurationSeconds = video.duration_seconds;
  const measuredDurationMs = sourceVideoDurationsMs[
    getCrawledVideoMediaKey(video)
  ];
  if (Number.isFinite(measuredDurationMs) && measuredDurationMs > 0) {
    return measuredDurationMs;
  }
  const durationSeconds = declaredDurationSeconds;
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return undefined;
  }
  return Math.min(120_000, Math.max(500, Math.round(durationSeconds * 1000)));
}

function getCrawledVideoMediaKey(media: {
  asset_path: string;
  order: number;
  remote_url: string;
  type: string;
}): string {
  return `${media.type}-${media.order}-${media.asset_path || media.remote_url}`;
}

function getVoiceDraftDurationMs({
  draft,
  promotion,
  thumbnailIntro,
}: {
  draft: VideoDraftDocument | undefined;
  promotion: VideoPromotionConfig | null;
  thumbnailIntro: VideoThumbnailIntro | null;
}): number {
  if (!draft) {
    return 0;
  }

  const draftContentDurationMs = draft.scenes.reduce(
    (latestEndMs, scene) => Math.max(latestEndMs, scene.timeline?.end_ms ?? 0),
    0
  );
  if (draftContentDurationMs <= 0) {
    return Math.max(
      0,
      Math.round((draft.video_plan.duration_target_seconds ?? 0) * 1000)
    );
  }

  const draftThumbnailDurationMs = draft.thumbnail_intro?.enabled
    ? Math.max(0, draft.thumbnail_intro.durationMs)
    : 0;
  const currentThumbnailDurationMs = thumbnailIntro?.enabled
    ? Math.max(0, thumbnailIntro.durationMs)
    : 0;
  const contentDurationMs = Math.max(
    0,
    draftContentDurationMs - draftThumbnailDurationMs + currentThumbnailDurationMs
  );

  return Math.max(
    0,
    Math.round(
      contentDurationMs +
        estimatePromotionDurationMs(
          promotion,
          contentDurationMs,
          draft.scenes.length
        )
    )
  );
}

function estimatePromotionDurationMs(
  promotion: VideoPromotionConfig | null,
  contentDurationMs: number,
  sceneCount: number
): number {
  if (!promotion) {
    return 0;
  }

  const slotDurationMs = (
    slot: VideoPromotionConfig["midroll"] | VideoPromotionConfig["outro"]
  ) =>
    slot?.enabled
      ? Math.max(0, Number(slot.video?.durationSeconds ?? 0) * 1000)
      : 0;
  const midrollDurationMs =
    contentDurationMs > 0 && sceneCount >= 2
      ? slotDurationMs(promotion.midroll)
      : 0;
  return midrollDurationMs + slotDurationMs(promotion.outro);
}

function estimateNarrationDurationMs(text: string, speakingRate: number): number {
  const normalizedSpeed = Number.isFinite(speakingRate)
    ? Math.min(2, Math.max(0.5, speakingRate))
    : 1;
  const textLength = String(text ?? "").trim().length;
  if (textLength === 0) {
    return 0;
  }

  // Calibrated from completed Vietnamese videos across the supported voices.
  // The old 14-character fallback is only for missing audio on the server and
  // makes the pre-voice estimate substantially longer than real TTS output.
  return Math.round((textLength / (23 * normalizedSpeed)) * 1000);
}

function estimateMemeDurationMs(
  durationMs: number | undefined,
  meme?: SelectedMemeEntry | MemeTransitionConfig | null
): number {
  if (meme?.visualMode === "sound_only") {
    const soundDurationMs = Number(meme.audio?.durationSeconds ?? 0) * 1000;
    if (soundDurationMs > 0) {
      return Math.max(MIN_MEME_TRANSITION_MS, Math.round(soundDurationMs));
    }
  }
  const videoDurationMs = Number(meme?.image?.durationSeconds ?? 0) * 1000;
  const videoAsset = meme?.image;
  if (
    videoDurationMs > 0 &&
    (videoAsset?.type?.startsWith("video/") ||
      /\.(?:mp4|m4v|webm|mov|avi|mkv)(?:$|[?#])/i.test(
        videoAsset?.name ?? videoAsset?.serverPath ?? ""
      ))
  ) {
    const soundDurationMs = Number(meme?.audio?.durationSeconds ?? 0) * 1000;
    return Math.max(
      MIN_MEME_TRANSITION_MS,
      Math.round(videoDurationMs + Math.max(0, soundDurationMs))
    );
  }

  if (!Number.isFinite(durationMs)) {
    return 0;
  }
  return Math.min(2700, Math.max(1000, Math.round(durationMs ?? 1200)));
}

function formatEstimatedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clampBackgroundMusicPercent(
  value: number | string | null | undefined
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return 24;
  }
  return Math.min(100, Math.max(0, parsed));
}

function buildVivibeVoicePresets(voices: VivibeVoice[]): VoicePreset[] {
  const presets: VoicePreset[] = dedupeVivibeVoices(voices)
    .filter(
      (voice) =>
        String(voice.id ?? "").trim() &&
        voice.isActive !== false &&
        isVietnameseVivibeVoice(voice)
    )
    .sort((left, right) => scoreVivibeVoice(right) - scoreVivibeVoice(left))
    .map((voice) => ({
      description: describeVivibeVoice(voice),
      label: formatVivibeVoiceLabel(voice),
      provider: "vivibe" as const,
      previewUrl: voice.previewUrl,
      settings: {
        languageCode: "vi-VN",
        pitch: 0,
        provider: "vivibe" as const,
        speakingRate: 1,
        ssmlGender: "NEUTRAL" as const,
        voiceName: String(voice.id).trim(),
      },
      value: `vivibe_${String(voice.id).trim()}`,
    }));
  if (
    !presets.some(
      (preset) => preset.settings.voiceName === PREFERRED_VIVIBE_ADAM_VOICE_ID
    )
  ) {
    presets.unshift({
      description:
        "Giọng ViVibe Adam được ghim sẵn để dùng ngay khi tài khoản chưa trả danh sách voice.",
      label: "Adam",
      provider: "vivibe",
      settings: {
        languageCode: "vi-VN",
        pitch: 0,
        provider: "vivibe" as const,
        speakingRate: 1,
        ssmlGender: "MALE" as const,
        voiceName: PREFERRED_VIVIBE_ADAM_VOICE_ID,
      },
      value: `vivibe_${PREFERRED_VIVIBE_ADAM_VOICE_ID}`,
    });
  }
  return presets;
}

function isVietnameseVivibeVoice(voice: VivibeVoice): boolean {
  const nameAndId = `${voice.name ?? ""} ${voice.id ?? ""} ${(voice.tags ?? []).join(" ")}`;
  const normalized = nameAndId
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const hasNonVietnameseVoiceMarker =
    /(^|[^a-z])(jp|id)[-_]/.test(String(voice.id ?? "").toLowerCase()) ||
    /(^|[^a-z])(english|japanese|indonesian|steve|celia|jonathan|nanako|miho|midori|koji|sakura|yumi|sushrut|jessica|stephen|mark|alex|amy|ash|energetic|neutral|calm|strong|dryvoice|bram|cute girl)([^a-z]|$)/.test(
      normalized
    );
  if (hasNonVietnameseVoiceMarker) {
    return false;
  }

  const language = [voice.languageCode, voice.locale, voice.language]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!language) {
    const hasVietnameseNameMarker =
      /[ăâđêôơưĂÂĐÊÔƠƯ]/.test(nameAndId) ||
      /(^|[^a-z])(adam|anh|minh|quang|mai|lan|thao|vy|viet|nam|nu|tieng viet)([^a-z]|$)/.test(
        normalized
      );
    return hasVietnameseNameMarker;
  }
  return /(^|[^a-z])(vi|vi-vn|vietnamese|tieng viet)([^a-z]|$)/i.test(language);
}

function findPreferredVivibePreset(
  presets: VoicePreset[],
  preferredValue?: string
): VoicePreset | undefined {
  if (presets.length === 0) {
    return;
  }

  if (preferredValue) {
    const existing = presets.find((preset) => preset.value === preferredValue);
    if (existing) {
      return existing;
    }
  }

  const saved = safeLocalStorageGetItem("selectedVoicePreset");
  if (saved) {
    const savedPreset = presets.find((preset) => preset.value === saved);
    if (savedPreset) {
      return savedPreset;
    }
  }

  return presets[0];
}

function scoreVivibeVoice(voice: VivibeVoice): number {
  const voiceId = String(voice.id ?? "").trim();
  const voiceName = String(voice.name ?? "").toLowerCase();
  const tags = Array.isArray(voice.tags) ? voice.tags.join(" ") : "";
  const haystack = `${voice.name} ${voice.id} ${tags}`.toLowerCase();
  let score = Number.isFinite(Number(voice.score)) ? Number(voice.score) : 0;

  if (voiceId === PREFERRED_VIVIBE_ADAM_VOICE_ID) {
    score += 100;
  }
  if (/^\s*adam\s*$/.test(voiceName)) {
    score += 80;
  }
  if (voice.isVerified) {
    score += 500;
  }
  if (voice.favorited) {
    score += 250;
  }
  if (
    /(story|ke chuyen|narrat|warm|natural|podcast|review|vlog|tiktok)/.test(
      haystack
    )
  ) {
    score += 50;
  }
  if (/(clear|r[oõ] r[aà]ng|smooth|real)/.test(haystack)) {
    score += 30;
  }
  if (/(old|robot|test|demo)/.test(haystack)) {
    score -= 40;
  }

  return score;
}

function formatVivibeVoiceLabel(voice: VivibeVoice): string {
  if (String(voice.id ?? "").trim() === PREFERRED_VIVIBE_ADAM_VOICE_ID) {
    const name = voice.name || "Adam";
    return Number(voice.score ?? 0) > 0 ? `🔥 ${name}` : name;
  }
  const name = voice.name || String(voice.id ?? "").trim();
  return Number(voice.score ?? 0) >= 3000 ? `🔥 ${name}` : name;
}

function describeVivibeVoice(voice: VivibeVoice): string {
  if (String(voice.id ?? "").trim() === PREFERRED_VIVIBE_ADAM_VOICE_ID) {
    return "Giọng ViVibe phổ biến trong thư viện cộng đồng.";
  }
  const tags = (voice.tags ?? []).filter(Boolean).join(", ");
  const score = Number(voice.score ?? 0);
  const details = [
    voice.isVerified ? "đã xác minh" : "",
    score > 0 ? `${score.toLocaleString("vi-VN")} điểm phổ biến` : "",
    tags ? tags : "",
  ].filter(Boolean);
  return details.length > 0
    ? `${details.join(" · ")}.`
    : `Giọng ViVibe ${voice.name || voice.id}.`;
}

function dedupeVivibeVoices(voices: VivibeVoice[]): VivibeVoice[] {
  const seen = new Set<string>();
  const deduped: VivibeVoice[] = [];

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

function normalizeAbbreviationRecord(
  abbreviations: Record<string, string>
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(abbreviations ?? {})) {
    const key = String(rawKey ?? "")
      .trim()
      .toLowerCase();
    const value = String(rawValue ?? "").trim();
    if (!(key && value)) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function toEditableAbbreviationRows(
  abbreviations: Record<string, string>
): Array<{ id: string; key: string; value: string }> {
  const rows = Object.entries(normalizeAbbreviationRecord(abbreviations)).map(
    ([key, value], index) => ({
      id: `${index}-${Date.now()}`,
      key,
      value,
    })
  );
  return rows.length > 0
    ? rows
    : [{ id: `0-${Date.now()}`, key: "", value: "" }];
}

function applyDraftPreviewOverrides(
  draft: VideoDraftDocument,
  {
    backgroundMusic,
    backgroundMusicVolume,
    cardTheme,
    memeTransition,
    promotion,
  }: {
    backgroundMusic?: UploadedAudioPayload | null;
    backgroundMusicVolume: number;
    cardTheme: "light" | "dark";
    memeTransition?: MemeTransitionConfig | null;
    promotion?: VideoPromotionConfig | null;
  }
): VideoDraftDocument {
  const effectiveMemeTransition =
    draft.meme_transition &&
    memeTransition &&
    draft.meme_transition.emotion === memeTransition.emotion
      ? draft.meme_transition
      : (memeTransition ?? draft.meme_transition ?? null);

  return {
    ...draft,
    background_music: backgroundMusic ?? null,
    background_music_volume: backgroundMusicVolume,
    cardTheme,
    meme_transition: effectiveMemeTransition,
    promotion: promotion ?? null,
  };
}

function clampPromotionVolumePercent(
  value: number | string | null | undefined
): number {
  if (value === null || value === undefined || String(value).trim() === "") {
    return 100;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 100;
  }
  return Math.min(100, Math.max(0, Math.round(parsed)));
}
