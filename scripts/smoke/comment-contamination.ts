import { parseCommentBlocks } from "../../apps/server/src/modules/crawl/collectors/threads-parsing";

const comments = parseCommentBlocks(
  [
    {
      avatarUrl: "https://example.com/reply.jpg",
      href: "https://www.threads.com/@replyuser/post/demo",
      isReply: false,
      likeCount: 0,
      media: [],
      metricTexts: ["1.3K likes", "1 reply", "11 likes"],
      replyCount: 0,
      text: "replyuser 13/06/2026 Có khi nguu chả đứa n bt 11",
      username: "replyuser",
    },
  ],
  "post-1",
  "author",
  "Noi dung bai viet goc",
);

if (comments.length !== 1) {
  throw new Error(`Expected 1 comment, received ${String(comments.length)}.`);
}

if (comments[0]?.like_count !== 11) {
  throw new Error(`Expected contaminated comment like_count=11, got ${String(comments[0]?.like_count)}.`);
}

if (comments[0]?.text !== "Có khi nguu chả đứa n bt") {
  throw new Error(`Expected cleaned text without trailing metric, got "${String(comments[0]?.text)}".`);
}

const localizedReplyUiComments = parseCommentBlocks(
  [
    {
      avatarUrl: "https://example.com/thichem12.jpg",
      isReply: false,
      likeCount: 38,
      media: [],
      metricTexts: ["38 lượt thích", "1 trả lời"],
      replyCount: 1,
      text:
        "thichem12 Sắc của hoa là sức của bà quét Hoa xinh gửi gió bay vô hướng. Cô quét lao công,quét đủ đường. Cayyyyy 38 1 Hiển thị phản hồi",
      username: "thichem12",
    },
  ],
  "post-2",
  "author",
  "Nội dung bài viết gốc",
);

if (localizedReplyUiComments.length !== 1) {
  throw new Error(
    `Expected 1 localized reply UI comment, received ${String(localizedReplyUiComments.length)}.`,
  );
}

const expectedLocalizedText =
  "Sắc của hoa là sức của bà quét Hoa xinh gửi gió bay vô hướng. Cô quét lao công,quét đủ đường. Cayyyyy";
if (localizedReplyUiComments[0]?.text !== expectedLocalizedText) {
  throw new Error(
    `Expected Vietnamese reply UI tail to be removed.\nExpected: "${expectedLocalizedText}"\nActual: "${String(localizedReplyUiComments[0]?.text)}"`,
  );
}

console.log("smoke:comment-contamination ok");
