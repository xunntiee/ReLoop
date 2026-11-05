import {
  extractPostText,
  extractInitialPostText,
  extractFormattedPostTextFromArticle,
  parseCommentBlocks,
  restorePostIntroFromActivityTexts,
  cleanPostText,
  cleanStructuredPostText,
  sanitizeCachedCommentText,
} from "../../apps/server/src/modules/crawl/collectors/threads-parsing";

const postHeaderText = extractPostText(
  "Trường Giang\n23 giờ\nmc hỏi ông cgi mà ông liếc dữ vậy=)",
  "Trường Giang",
  "its.una_08",
);
if (postHeaderText !== "mc hỏi ông cgi mà ông liếc dữ vậy=)") {
  throw new Error(`Expected Threads display-name/time header to be removed, got "${postHeaderText}".`);
}

const combinedPostHeaderText = extractPostText(
  "its.una_08 > Trường Giang 23 giờ\nmc hỏi ông cgi mà ông liếc dữ vậy=)",
  "Trường Giang",
  "its.una_08",
);
if (combinedPostHeaderText !== "mc hỏi ông cgi mà ông liếc dữ vậy=)") {
  throw new Error(`Expected combined Threads header to be removed, got "${combinedPostHeaderText}".`);
}

const compactConversationShellText = extractPostText(
  "Cuộc trò chuyện đầu tiênTheo dõitungduong2211x1 ngàyXem thêmTuy rất ghét Trường Giang, nhưng phải công nhận là việc TG rút khỏi show 2n1d khiến t thấy rất thất vọng...\nNhẽ ra TG nên rút khỏi showbiz mới phải.",
  "tungduong2211x",
  "tungduong2211x",
);
const expectedCompactConversationShellText = [
  "Tuy rất ghét Trường Giang, nhưng phải công nhận là việc TG rút khỏi show 2n1d khiến t thấy rất thất vọng...",
  "Nhẽ ra TG nên rút khỏi showbiz mới phải.",
].join("\n");
if (compactConversationShellText !== expectedCompactConversationShellText) {
  throw new Error(
    `Expected concatenated conversation UI to be removed from post text. Actual: "${compactConversationShellText}"`,
  );
}

const formattedCompactConversationShellText = extractFormattedPostTextFromArticle(
  "@tungduong2211x\n1 ngày\nCuộc trò chuyện đầu tiênTheo dõitungduong2211x1 ngàyXem thêmTuy rất ghét Trường Giang, nhưng phải công nhận là việc TG rút khỏi show 2n1d khiến t thấy rất thất vọng...\nNhẽ ra TG nên rút khỏi showbiz mới phải.\nHàng đầu",
  "tungduong2211x",
  expectedCompactConversationShellText,
);
if (formattedCompactConversationShellText !== expectedCompactConversationShellText) {
  throw new Error(
    `Expected article text formatter to remove concatenated conversation UI. Actual: "${formattedCompactConversationShellText}"`,
  );
}

const fallbackPostHeaderText = extractInitialPostText(
  "Threads",
  "its.una_08",
  "its.una_08",
  [
    "its.una_08",
    "Trường Giang",
    "23 giờ",
    "mc hỏi ông cgi mà ông liếc dữ vậy=)",
  ].join("\n"),
);
if (fallbackPostHeaderText !== "mc hỏi ông cgi mà ông liếc dữ vậy=)") {
  throw new Error(`Expected body fallback header to be removed, got "${fallbackPostHeaderText}".`);
}

const compactTrendShellText = extractPostText(
  "Nêu bậtThịnh hành: Phòng trọTheo dõingoitrongtoileggaothettenem19 giờXem thêmGhét từ công chúa phòng trọ hay tiểu thư nhà nghèo kinh khủng tởm. Cách sử dụng từ ngữ để miệt thị người khác bây giờ ngày càng thể hiện bản chất tệ hại của xã hội kiếm nhóm yếu thế ra để đấu cười cợt.",
  "",
  "ngoitrongtoileggaothettenem",
);
const expectedCompactTrendShellText =
  "Ghét từ công chúa phòng trọ hay tiểu thư nhà nghèo kinh khủng tởm. Cách sử dụng từ ngữ để miệt thị người khác bây giờ ngày càng thể hiện bản chất tệ hại của xã hội kiếm nhóm yếu thế ra để đấu cười cợt.";
if (compactTrendShellText !== expectedCompactTrendShellText) {
  throw new Error(
    `Expected concatenated trend UI to be removed from post text. Actual: "${compactTrendShellText}"`,
  );
}

const compactPostMetricTail = cleanPostText(
  "B\u1ed1 c\u00e3i nhau v\u1edbi \u00f4ng b\u00ed th\u01b0 x\u00f3m v\u00ec ko c\u00f3 xu\u1ea5t qu\u00e0 trung thu cho LTh\u00edch11KTr\u1ea3 l\u1eddi90\u0110\u0103ng l\u1ea1i338Chia s\u1ebb78",
);
if (
  compactPostMetricTail !==
  "B\u1ed1 c\u00e3i nhau v\u1edbi \u00f4ng b\u00ed th\u01b0 x\u00f3m v\u00ec ko c\u00f3 xu\u1ea5t qu\u00e0 trung thu cho L"
) {
  throw new Error(
    `Expected compact post action metrics to be removed, got "${compactPostMetricTail}".`,
  );
}

const splitCompactPostMetricTail = cleanStructuredPostText(
  "B\u1ed1 c\u00e3i nhau v\u1edbi \u00f4ng b\u00ed th\u01b0 x\u00f3m v\u00ec ko c\u00f3 xu\u1ea5t qu\u00e0 trung thu cho LTh\u00edch11KTr\u1ea3 l\u1eddi90\u0110\u0103ng\nl\u1ea1i338Chia s\u1ebb78",
);
if (
  splitCompactPostMetricTail !==
  "B\u1ed1 c\u00e3i nhau v\u1edbi \u00f4ng b\u00ed th\u01b0 x\u00f3m v\u00ec ko c\u00f3 xu\u1ea5t qu\u00e0 trung thu cho L"
) {
  throw new Error(
    `Expected split compact post action metrics to be removed, got "${splitCompactPostMetricTail}".`,
  );
}

const formattedComment = [
  "mingxiao_9x",
  "18/06/2026",
  "Lười yêu và cái giá phải trả là",
  "- Tự do làm điều mình thích.",
  "- Không phải đau khổ hay luỵ 1 ai cả.",
  "- Luôn trong trạng thái lạc quan, vui vẻ.",
  "- Không bị chi phối bởi cảm xúc của đối phương",
  "NHƯNG:",
  "+ Nhiều lúc cô đơn không có người chia sẻ.",
  "+ Không có kỉ niệm khi ở độ tuổi ‘đẹp’ để yêu.",
  "+ Cô độc những dịp lễ...",
  "1,5K",
  "7",
  "28",
  "20",
].join("\n");

const comments = parseCommentBlocks(
  [
    {
      avatarUrl: "https://example.com/mingxiao.jpg",
      href: "https://www.threads.com/@mingxiao_9x/post/demo",
      isReply: false,
      likeCount: 1500,
      media: [],
      metricTexts: ["1.5K likes", "7 replies"],
      replyCount: 7,
      text: formattedComment,
      username: "mingxiao_9x",
    },
  ],
  "post-1",
  "author",
  "Bài viết gốc không liên quan",
);

const expectedCommentText = [
  "Lười yêu và cái giá phải trả là",
  "- Tự do làm điều mình thích.",
  "- Không phải đau khổ hay luỵ 1 ai cả.",
  "- Luôn trong trạng thái lạc quan, vui vẻ.",
  "- Không bị chi phối bởi cảm xúc của đối phương",
  "NHƯNG:",
  "+ Nhiều lúc cô đơn không có người chia sẻ.",
  "+ Không có kỉ niệm khi ở độ tuổi ‘đẹp’ để yêu.",
  "+ Cô độc những dịp lễ...",
].join("\n");

if (comments.length !== 1) {
  throw new Error(`Expected 1 formatted comment, received ${comments.length}.`);
}

if (comments[0]?.text !== expectedCommentText) {
  throw new Error(
    `Expected formatted comment text with line breaks.\nExpected:\n${expectedCommentText}\nActual:\n${String(comments[0]?.text)}`,
  );
}

const articleText = [
  "mingxiao_9x",
  "18/06/2026",
  "Lười yêu và cái giá phải trả là",
  "- Tự do làm điều mình thích.",
  "- Không phải đau khổ hay luỵ 1 ai cả.",
  "1,5K",
  "7",
].join("\n");

const fallbackText = "Lười yêu và cái giá phải trả là - Tự do làm điều mình thích. - Không phải đau khổ hay luỵ 1 ai cả.";
const formattedPostText = extractFormattedPostTextFromArticle(
  articleText,
  "mingxiao_9x",
  fallbackText,
);
const expectedPostText = [
  "Lười yêu và cái giá phải trả là",
  "- Tự do làm điều mình thích.",
  "- Không phải đau khổ hay luỵ 1 ai cả.",
].join("\n");

if (formattedPostText !== expectedPostText) {
  throw new Error(
    `Expected formatted post text with line breaks.\nExpected:\n${expectedPostText}\nActual:\n${formattedPostText}`,
  );
}

const articleTextWithHiddenListIntro = [
  "_tarotwbloss",
  "11/02/2026",
  "Top nhung thu lam genZ so hai:",
  "1. Khong co wifi",
  "2. Co bau",
  "3. Di lam - Phong van xin viec",
  "4. Nghe dt",
  "5. Cuoi",
  "24,4K",
  "182",
].join("\n");

const fallbackHiddenListText = [
  "1. Khong co wifi",
  "2. Co bau",
  "3. Di lam - Phong van xin viec",
  "4. Nghe dt",
  "5. Cuoi",
].join(" ");

const formattedHiddenListPostText = extractFormattedPostTextFromArticle(
  articleTextWithHiddenListIntro,
  "_tarotwbloss",
  fallbackHiddenListText,
);
const expectedHiddenListPostText = [
  "Top nhung thu lam genZ so hai:",
  "1. Khong co wifi",
  "2. Co bau",
  "3. Di lam - Phong van xin viec",
  "4. Nghe dt",
  "5. Cuoi",
].join("\n");

if (formattedHiddenListPostText !== expectedHiddenListPostText) {
  throw new Error(
    `Expected hidden list intro to be preserved.\nExpected:\n${expectedHiddenListPostText}\nActual:\n${formattedHiddenListPostText}`,
  );
}

const restoredHiddenListFromActivity = restorePostIntroFromActivityTexts(
  expectedHiddenListPostText.split("\n").slice(1).join("\n"),
  [
    "Sap xep",
    "Top nhung thu lam genZ so hai: 1. Khong co wifi 2. Co bau 3. Di lam - Phong van xin viec 4. Nghe dt 5. Cuoi",
  ],
);
if (restoredHiddenListFromActivity !== expectedHiddenListPostText) {
  throw new Error(
    `Expected hidden list intro to be restored from activity text.\nExpected:\n${expectedHiddenListPostText}\nActual:\n${restoredHiddenListFromActivity}`,
  );
}

const loggedOutBodyText = [
  "Dang nhap",
  "Thread",
  "1,3K luot xem",
  "hanhoang447",
  "17/03/2026",
  "Topic :",
  "Ban da tung thich 1 nguoi den muc nao",
  "13",
  "19",
  "hanhoang447",
  "31/05/2026",
  "Tac gia",
  "Comment cua tac gia khong phai text bai chinh",
  "Thread lien quan",
  "Hay dang nhap de xem them thread tra loi nhe.",
].join("\n");
const loggedOutInitialText = extractInitialPostText(
  "Topic :",
  "hanhoang447",
  "hanhoang447",
  loggedOutBodyText,
);
const loggedOutFormattedText = extractFormattedPostTextFromArticle(
  loggedOutBodyText,
  "hanhoang447",
  loggedOutInitialText,
);
const expectedLoggedOutPostText = [
  "Topic :",
  "Ban da tung thich 1 nguoi den muc nao",
].join("\n");
if (loggedOutInitialText !== expectedLoggedOutPostText) {
  throw new Error(
    `Expected logged-out permalink fallback to keep only the root post text.\nExpected:\n${expectedLoggedOutPostText}\nActual:\n${loggedOutInitialText}`,
  );
}
if (loggedOutFormattedText !== expectedLoggedOutPostText) {
  throw new Error(
    `Expected logged-out post page to fall back from short meta text.\nExpected:\n${expectedLoggedOutPostText}\nActual:\n${loggedOutFormattedText}`,
  );
}

const permalinkShellText = [
  "@_to.min",
  "15:42:13 28/08/2026",
  "84.7 điểm viral",
  "43,5K lượt thích",
  "787 bình luận",
  "Trang chủ",
  "Thread mới",
  "Tìm kiếm",
  "Tin nhắn",
  "Hoạt động",
  "Trang cá nhân",
  "Thông tin chi tiết",
  "Bảng feed khác",
  "Thread",
  "1,0 triệu lượt xem",
  "5 ngày",
  "Ok nha",
  "43,5K",
  "787",
  "3,7K",
  "2,2K",
  "Hàng đầu",
  "Xem hoạt động",
  "Chính sách quyền riêng tư",
  "Chính sách cookie",
].join("\n");
const permalinkShellInitialText = extractInitialPostText(
  permalinkShellText,
  "_to.min",
  "_to.min",
  permalinkShellText,
);
if (permalinkShellInitialText !== "Ok nha") {
  throw new Error(
    `Expected permalink shell text to be ignored. Expected "Ok nha", actual "${permalinkShellInitialText}".`,
  );
}

const loginShellDescription =
  "Tham gia Threads de chia se y tuong. Dang nhap bang Instagram.";
const rootPostText = "Deo me co bao nhieu cai phot =))))))";
const recoveredRootText = extractInitialPostText(
  loginShellDescription,
  "dngochaa",
  "dngochaa",
  ["dngochaa", rootPostText, "41600", "1100"].join("\n"),
);
if (recoveredRootText !== rootPostText) {
  throw new Error(
    `Expected Threads login shell to fall back to the permalink post text. Actual: "${recoveredRootText}"`,
  );
}

const postLinkRootFiltered = parseCommentBlocks(
  [
    {
      href: "https://www.threads.com/@dngochaa/post/DdRWuSjEkGN",
      likeCount: 41600,
      replyCount: 1100,
      text: ["dngochaa", rootPostText, "41600", "1100"].join("\n"),
      username: "dngochaa",
    },
    {
      href: "https://www.threads.com/@dngochaa/post/another-post",
      likeCount: 20,
      replyCount: 3,
      text: ["dngochaa", "Binh luan khac cua tac gia"].join("\n"),
      username: "dngochaa",
    },
  ],
  "DdRWuSjEkGN",
  "dngochaa",
  "Caption khac",
);
if (
  postLinkRootFiltered.length !== 1 ||
  postLinkRootFiltered[0]?.text !== "Binh luan khac cua tac gia"
) {
  throw new Error(
    `Expected only the real author comment to remain after filtering the root post. Actual: ${JSON.stringify(postLinkRootFiltered)}`,
  );
}

const flattenedComment =
  "Lười yêu và cái giá phải trả là - Tự do làm điều mình thích. - Không phải đau khổ hay luỵ 1 ai cả. - Luôn trong trạng thái lạc quan, vui vẻ. - Không bị chi phối bởi cảm xúc của đối phương NHƯNG: + Nhiều lúc cô đơn không có người chia sẻ. + Không có kỉ niệm khi ở độ tuổi ‘đẹp’ để yêu. + Cô độc những dịp lễ...";
const repairedFlattenedComment = sanitizeCachedCommentText(flattenedComment, 1500, 0);
if (repairedFlattenedComment !== expectedCommentText) {
  throw new Error(
    `Expected flattened bullet comment to be repaired.\nExpected:\n${expectedCommentText}\nActual:\n${repairedFlattenedComment}`,
  );
}

const flattenedAgeRangeComment =
  "18-22t bỏ học triền miên, yêu đương , Game , đá bóng, nhậu nhẹt, cần cỏ. 22-24t : đi làm bỏ làm đi đánh độ Game kiếm tiền 25-28t : lao đầu vào làm từ lương 5tr đến ra làm chủ rồi thất bại 28-31t : lấy vợ, tập chung làm việc. Lương 50tr";
const expectedAgeRangeComment = [
  "18-22t bỏ học triền miên, yêu đương , Game , đá bóng, nhậu nhẹt, cần cỏ.",
  "22-24t : đi làm bỏ làm đi đánh độ Game kiếm tiền",
  "25-28t : lao đầu vào làm từ lương 5tr đến ra làm chủ rồi thất bại",
  "28-31t : lấy vợ, tập chung làm việc. Lương 50tr",
].join("\n");
const repairedAgeRangeComment = sanitizeCachedCommentText(flattenedAgeRangeComment, 417, 8);
if (repairedAgeRangeComment !== expectedAgeRangeComment) {
  throw new Error(
    `Expected flattened age-range comment to be repaired.\nExpected:\n${expectedAgeRangeComment}\nActual:\n${repairedAgeRangeComment}`,
  );
}

const commentWithReplyActionTail =
  "Nội dung bình luận cần giữ lại. 183 1 1 2 Hiển thị trả lời";
const repairedReplyActionTail = sanitizeCachedCommentText(
  commentWithReplyActionTail,
  183,
  1,
);
if (repairedReplyActionTail !== "Nội dung bình luận cần giữ lại.") {
  throw new Error(
    `Expected reply action tail to be removed. Actual: "${repairedReplyActionTail}"`,
  );
}

console.log("smoke:comment-formatting ok");
