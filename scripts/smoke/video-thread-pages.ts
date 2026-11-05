import { applyThreadPageLayout } from "../../apps/server/src/modules/video/service";
import type { VideoDraftScene } from "../../apps/server/src/modules/video/types";

const scene = (
  sceneId: string,
  text: string,
  options: Partial<VideoDraftScene> = {}
): VideoDraftScene =>
  ({
    kind: "comment",
    narration: {
      audio_url: "",
      chunks: [],
      merged_audio_path: "",
      merged_audio_url: "",
      message: "",
      provider: "vivibe",
      request_id: "",
      status: "idle",
      total_duration_ms: 0,
      voice_profile: null,
    },
    order: 1,
    post_id: "post-1",
    scene_id: sceneId,
    template: "threads_card",
    text,
    ...options,
  }) as VideoDraftScene;

const shortComments = applyThreadPageLayout(
  [
    scene("caption", "Caption", { kind: "post" }),
    scene("comment-1", "Comment ngắn số một."),
    scene("comment-2", "Comment ngắn số hai."),
    scene("comment-3", "Comment ngắn số ba."),
  ],
  true
);
const expectedMembers = ["comment-1", "comment-2", "comment-3"];
for (const item of shortComments.slice(1)) {
  if (JSON.stringify(item.thread_page?.member_scene_ids) !== JSON.stringify(expectedMembers)) {
    throw new Error("Short consecutive comments must share one thread page.");
  }
}

const standaloneComments = applyThreadPageLayout(
  [
    scene("comment-long", "x".repeat(221)),
    scene("comment-media", "Comment có ảnh.", { has_media: true }),
  ],
  true
);
if (standaloneComments.some((item) => item.thread_page)) {
  throw new Error("Long or media comments must keep their own page.");
}

console.log("smoke:video-thread-pages ok");
