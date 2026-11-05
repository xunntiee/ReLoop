import {
  extractActivityMetricRows,
  resolvePostMetrics,
} from "../../apps/server/src/modules/crawl/collectors/threads-parsing";

const activityText = [
  "Hoat dong doi voi bai viet",
  "fuongtan2909 28/04/2026",
  "Minh la phan con lai cua the gioi. Ve tren paint bang chuot",
  "Luot xem",
  "1.155.447",
  "Luot thich",
  "80,2K",
  "Luot dang lai",
  "6.034",
  "Trich dan",
  "72",
].join("\n");

const activityMetrics = extractActivityMetricRows(activityText);

if (activityMetrics.view_count !== 1_155_447) {
  throw new Error(`Expected activity views 1155447, got ${activityMetrics.view_count}.`);
}
if (activityMetrics.like_count !== 80_200) {
  throw new Error(`Expected activity likes 80200, got ${activityMetrics.like_count}.`);
}
if (activityMetrics.repost_count !== 6_034) {
  throw new Error(`Expected activity reposts 6034, got ${activityMetrics.repost_count}.`);
}
if (activityMetrics.quote_count !== 72) {
  throw new Error(`Expected activity quotes 72, got ${activityMetrics.quote_count}.`);
}

const resolved = resolvePostMetrics(
  {
    like_count: 80_200,
    quote_count: 0,
    reply_count: 1_100,
    repost_count: 6_034,
    share_count: 1_500,
    source: "labeled_dom",
    view_count: 80_200,
  },
  activityMetrics,
  { extractionDepth: "full" },
);

if (resolved.metrics.view_count !== 1_155_447) {
  throw new Error(`Expected resolved views from activity modal, got ${resolved.metrics.view_count}.`);
}
if (resolved.metrics.like_count !== 80_200) {
  throw new Error(`Expected resolved likes to stay 80200, got ${resolved.metrics.like_count}.`);
}
if (resolved.fieldSources.view_count !== "activity_modal") {
  throw new Error(`Expected view source activity_modal, got ${resolved.fieldSources.view_count}.`);
}

const contentWithLikeWord = [
  "Hoạt động đối với bài viết",
  "soo_linn",
  "⁉️like idol like fan⁉️",
  "Lượt xem",
  "51.953",
  "Lượt thích",
  "1.441",
  "Lượt đăng lại",
  "34",
  "Trích dẫn",
  "1",
].join("\n");
const contentWithLikeWordMetrics = extractActivityMetricRows(contentWithLikeWord);
if (
  contentWithLikeWordMetrics.view_count !== 51_953 ||
  contentWithLikeWordMetrics.like_count !== 1_441
) {
  throw new Error(
    `Expected content word 'like' not to hijack activity labels, got views=${contentWithLikeWordMetrics.view_count} likes=${contentWithLikeWordMetrics.like_count}.`,
  );
}

console.log("smoke:activity-metrics ok");
