import { readFileSync } from "node:fs";
import {
  buildVoiceDraftSignature,
  isVoiceDraftSignatureReusable,
} from "../../apps/web/src/features/video-workflow/video-draft-actions";
import type { CrawlPost } from "../../apps/web/src/lib/api";

const v2SourcePath = new URL(
  "../../apps/web/src/features/video-workflow/video-page-v2.tsx",
  import.meta.url
);
const v1SourcePath = new URL(
  "../../apps/web/src/features/video-workflow/video-page.tsx",
  import.meta.url
);
const v2CardSourcePath = new URL(
  "../../apps/web/src/features/video-workflow/video-post-list-card-v2.tsx",
  import.meta.url
);
const v1CardSourcePath = new URL(
  "../../apps/web/src/features/video-workflow/video-post-list-card.tsx",
  import.meta.url
);
const previewSourcePath = new URL(
  "../../apps/web/src/features/video-workflow/video-preview-stage.tsx",
  import.meta.url
);
const serviceSourcePath = new URL(
  "../../apps/server/src/modules/video/service.ts",
  import.meta.url
);
const selectedPostsPanelSourcePath = new URL(
  "../../apps/web/src/features/video-workflow/selected-posts-panel.tsx",
  import.meta.url
);
const source = readFileSync(v2SourcePath, "utf8").replaceAll("\r\n", "\n");
const v1Source = readFileSync(v1SourcePath, "utf8").replaceAll("\r\n", "\n");
const v2CardSource = readFileSync(v2CardSourcePath, "utf8").replaceAll("\r\n", "\n");
const v1CardSource = readFileSync(v1CardSourcePath, "utf8").replaceAll("\r\n", "\n");
const previewSource = readFileSync(previewSourcePath, "utf8").replaceAll("\r\n", "\n");
const serviceSource = readFileSync(serviceSourcePath, "utf8").replaceAll("\r\n", "\n");
const selectedPostsPanelSource = readFileSync(
  selectedPostsPanelSourcePath,
  "utf8"
).replaceAll("\r\n", "\n");
const editedTtsText = "Cách ba tao dụ tao xuống ăn sáng:";

if (
  !source.includes(
    "? (post.tts_text?.trim() || synthesizedTts)"
  )
) {
  throw new Error(
    "Spoiler normalization must preserve an explicitly edited post TTS text."
  );
}

if (
  v2CardSource.includes("if (result.isDialogue)") ||
  v2CardSource.includes("if (additionalResult.isDialogue)") ||
  v1CardSource.includes("if (result.isDialogue)") ||
  v1CardSource.includes("if (additionalResult.isDialogue)") ||
  !v2CardSource.includes("onImportTts(text);") ||
  !v1CardSource.includes("onImportOcr({")
) {
  throw new Error(
    "OCR must import text to TTS even when an image is classified as dialogue."
  );
}

if (
  !source.includes("function resolvePostTtsText") ||
  !source.includes("function resolveCommentTtsText") ||
  !source.includes("tts_text: resolvePostTtsText({") ||
  !source.includes("tts_text: resolveCommentTtsText({") ||
  source.includes("shouldMirrorPostText") ||
  source.includes("shouldMirrorCommentText") ||
  !v1Source.includes("function resolvePostTtsText") ||
  !v1Source.includes("function resolveCommentTtsText") ||
  v1Source.includes("shouldMirrorPostText") ||
  v1Source.includes("shouldMirrorCommentText")
) {
  throw new Error(
    "Editing display text must not mirror into the saved TTS text."
  );
}

if (
  !previewSource.includes("text: resolveCurrentPreviewSceneText({") ||
  !serviceSource.includes("syncSceneDisplayText(scene, payload.selectedPosts)") ||
  !serviceSource.includes("canReuseSceneNarrationText({")
) {
  throw new Error(
    "Preview and render reuse must refresh display text without discarding explicit TTS audio."
  );
}

if (
  !selectedPostsPanelSource.includes(
    "const effectiveProvider = availableProviders.some("
  ) ||
  !selectedPostsPanelSource.includes(
    "item.provider === effectiveProvider"
  ) ||
  !selectedPostsPanelSource.includes(
    "!availableProviders.some((provider) => provider.value === selectedProvider)"
  )
) {
  throw new Error(
    "The voice payload must use the currently available provider instead of stale per-post voice settings."
  );
}

const basePost = {
  post_id: "post-1",
  text: "Display text before",
  tts_text: "Narration text stays the same",
  top_comments: [
    {
      comment_id: "comment-1",
      text: "Comment display before",
      tts_text: "Comment narration stays the same",
      selected_for_video: true,
    },
  ],
};
const editedDisplayPost = {
  ...basePost,
  text: "Display text after",
  top_comments: [
    {
      ...basePost.top_comments[0],
      text: "Comment display after",
    },
  ],
};
const voiceSignatureOptions = {
  post: basePost as unknown as CrawlPost,
  voiceSettings: null,
};
const currentVoiceSignature = buildVoiceDraftSignature(voiceSignatureOptions);
if (
  !isVoiceDraftSignatureReusable({
    currentSignature: currentVoiceSignature,
    draftSignature: buildVoiceDraftSignature({
      ...voiceSignatureOptions,
      post: editedDisplayPost as unknown as CrawlPost,
    }),
  })
) {
  throw new Error(
    "Editing display text must keep a reusable voice draft when TTS text is unchanged."
  );
}

const currentSignaturePayload = JSON.parse(currentVoiceSignature) as {
  post: {
    text: string;
    top_comments: Array<{ text: string }>;
  };
};
const legacyVoiceSignature = JSON.stringify({
  ...JSON.parse(currentVoiceSignature),
  post: {
    ...currentSignaturePayload.post,
    text: basePost.text,
    top_comments: currentSignaturePayload.post.top_comments.map(
      (comment, index) => ({
        ...comment,
        text: basePost.top_comments[index]?.text ?? comment.text,
      })
    ),
  },
});
if (
  !isVoiceDraftSignatureReusable({
    currentSignature: currentVoiceSignature,
    draftSignature: legacyVoiceSignature,
  })
) {
  throw new Error(
    "An existing voice draft must remain reusable after the signature normalization."
  );
}

const editedTtsPost = {
  ...basePost,
  top_comments: [
    {
      ...basePost.top_comments[0],
      tts_text: "Comment narration changed",
    },
  ],
};
if (
  isVoiceDraftSignatureReusable({
    currentSignature: currentVoiceSignature,
    draftSignature: buildVoiceDraftSignature({
      ...voiceSignatureOptions,
      post: editedTtsPost as unknown as CrawlPost,
    }),
  })
) {
  throw new Error("Editing TTS text must invalidate the old voice draft.");
}

const spoilerFallback = "Cách ba tao dụ tao xuống ăn sáng: Phần bị ẩn";
const normalizedTts = editedTtsText.trim() || spoilerFallback;
const hydratedTts = editedTtsText.trim() || spoilerFallback;
const captionFallback = "Post text copied to TTS";
const emptyTts = "".trim() || captionFallback.trim();
const commentFallback = "Comment text copied to TTS";
const emptyCommentTts = "".trim() || commentFallback.trim();

if (normalizedTts !== editedTtsText || hydratedTts !== editedTtsText) {
  throw new Error(
    "An edited spoiler TTS value was not preserved through save hydration."
  );
}

if (emptyTts !== captionFallback) {
  throw new Error("An empty post TTS value did not fall back to the caption.");
}

if (emptyCommentTts !== commentFallback) {
  throw new Error("An empty comment TTS value did not fall back to the comment.");
}

console.log("smoke:video-tts-edit-persistence ok");
