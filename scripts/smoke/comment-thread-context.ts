import { parseCommentBlocks } from "../../apps/server/src/modules/crawl/collectors/threads-parsing";

const comments = parseCommentBlocks(
  [
    {
      avatarUrl: "https://example.com/root.jpg",
      commentSectionTop: 420,
      href: "https://www.threads.com/@_no.134ft_/post/root",
      isRootPost: true,
      isReply: false,
      likeCount: 15_000,
      media: [],
      metricTexts: ["15K likes", "322 replies"],
      replyCount: 322,
      text: "_no.134ft_ 1d co dia yeu la all in.",
      top: 120,
      username: "_no.134ft_",
    },
    {
      avatarUrl: "https://example.com/focused.jpg",
      commentSectionTop: 420,
      href: "https://www.threads.com/@haminhh.1999/post/reply",
      isReply: false,
      likeCount: 981,
      media: [],
      metricTexts: ["981 likes", "134 replies"],
      replyCount: 134,
      text: "haminhh.1999 18h yeu la phai yeu het long",
      top: 260,
      username: "haminhh.1999",
    },
    {
      avatarUrl: "https://example.com/comment.jpg",
      commentSectionTop: 420,
      href: "https://www.threads.com/@eh.nthdao_/post/comment",
      isReply: false,
      likeCount: 3,
      media: [],
      metricTexts: ["3 likes", "1 reply"],
      replyCount: 1,
      text: "eh.nthdao_ 5h dung a, con g thi t phai di ngu voi trai tim vo tan",
      top: 620,
      username: "eh.nthdao_",
    },
  ],
  "reply",
  "haminhh.1999",
  "yeu la phai yeu het long",
);

if (comments.length !== 1) {
  throw new Error(`Expected only 1 real comment below comment section, received ${String(comments.length)}.`);
}

if (comments[0]?.username !== "eh.nthdao_") {
  throw new Error(`Expected remaining comment username=eh.nthdao_, got ${String(comments[0]?.username)}.`);
}

console.log("smoke:comment-thread-context ok");
