import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { CrawlRequestMeta } from "@/lib/api";

export const RequestMetaPanel = ({
  requestMeta,
}: {
  requestMeta: CrawlRequestMeta;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const topic = requestMeta.topic;
  const searchQueries = topic.search_queries ?? [];
  const requiredKeywords = topic.required_keywords ?? [];
  const seedPostUrls = topic.seed_post_urls ?? [];
  const trendSearchUrls = topic.trend_search_urls ?? [];
  const excludes = requestMeta.text_excludes_any ?? [];
  const dateLabel = formatDateRange(requestMeta);
  const rankingLabel =
    requestMeta.ranking_mode === "weighted"
      ? formatSortBy(requestMeta.sort_by)
      : formatSortBy(requestMeta.sort_by);
  const runtimeLabel = formatRuntimeProfile(requestMeta.runtime_overrides);
  const recencyLabel = formatRecencyProfile(requestMeta);
  const sourceMode = resolveSourceModeLabel(searchQueries, seedPostUrls, trendSearchUrls);

  return (
    <section className="grid gap-3 rounded-lg border bg-muted/20 p-4 transition-all">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Thông tin cấu hình crawl</h2>
          <p className="text-[11px] text-muted-foreground">
            Form cấu hình bên trái đã được nạp lại theo tệp dữ liệu này.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1 rounded-md bg-background border px-2.5 py-1 text-[11px] font-medium hover:bg-muted transition-colors cursor-pointer"
            type="button"
          >
            {isOpen ? (
              <>
                Ẩn bớt <ChevronUp className="size-3" />
              </>
            ) : (
              <>
                Xem chi tiết <ChevronDown className="size-3" />
              </>
            )}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-1 space-y-3">
          {/* Metadata list */}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-xs border-t pt-3">
            <MetaItem label="Cách lấy bài viết" value={sourceMode} />
            
            {topic.topic_title && topic.topic_title !== "Viral feed" && (
              <MetaItem label="Chủ đề" value={topic.topic_title} />
            )}
            
            {sourceMode !== "Dán link / mã nhúng bài viết" && (
              <MetaItem 
                label="Số lượng bài viết" 
                value={`Tối đa ${requestMeta.max_posts_per_topic || 0} bài`} 
              />
            )}
            
            {requestMeta.top_comments_per_post > 0 && (
              <MetaItem 
                label="Bình luận mỗi bài" 
                value={`Tối đa ${requestMeta.top_comments_per_post} bình luận`} 
              />
            )}
            
            {dateLabel !== "Không lọc ngày" && (
              <MetaItem label="Lọc ngày đăng" value={dateLabel} />
            )}
            
            {sourceMode !== "Dán link / mã nhúng bài viết" && (
              <MetaItem label="Sắp xếp/Xếp hạng" value={rankingLabel} />
            )}

            {runtimeLabel && (
              <MetaItem label="Giới hạn xử lý" value={runtimeLabel} />
            )}

            {recencyLabel && sourceMode !== "Dán link / mã nhúng bài viết" && (
              <MetaItem label="Ưu tiên bài mới" value={recencyLabel} />
            )}
          </div>

          {/* List items (e.g. keywords, links, etc.) */}
          {(searchQueries.length > 0 || requiredKeywords.length > 0 || excludes.length > 0 || seedPostUrls.length > 0 || trendSearchUrls.length > 0) && (
            <div className="space-y-3 pt-3 border-t">
              {searchQueries.length > 0 && (
                <div>
                  <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Từ khóa hỗ trợ tìm kiếm:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {searchQueries.map((q) => (
                      <span key={q} className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium border text-muted-foreground">
                        {q}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {requiredKeywords.length > 0 && (
                <div>
                  <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Cụm từ bắt buộc ({topic.required_keywords_mode === "all" ? "phải có tất cả" : "chỉ cần chứa 1 cụm"}):
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {requiredKeywords.map((kw) => (
                      <span key={kw} className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {excludes.length > 0 && (
                <div>
                  <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Loại trừ bài viết chứa:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {excludes.map((ex) => (
                      <span key={ex} className="rounded bg-destructive/10 px-2 py-0.5 text-[11px] font-medium border border-destructive/20 text-destructive">
                        {ex}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {seedPostUrls.length > 0 && (
                <div>
                  <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Link / mã nhúng bài viết đã dán ({seedPostUrls.length} mục):
                  </span>
                  <div className="max-h-36 overflow-y-auto pr-1 space-y-1">
                    {seedPostUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate rounded bg-muted/40 px-2 py-1 text-[11px] text-blue-600 border hover:bg-muted hover:underline dark:text-blue-400"
                        title={url}
                      >
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {trendSearchUrls.length > 0 && (
                <div>
                  <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Link trend search Threads ({trendSearchUrls.length} link):
                  </span>
                  <div className="max-h-36 overflow-y-auto pr-1 space-y-1">
                    {trendSearchUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate rounded bg-sky-500/10 px-2 py-1 text-[11px] text-sky-700 border border-sky-500/20 hover:bg-sky-500/15 hover:underline dark:text-sky-300"
                        title={url}
                      >
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const MetaItem = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-2 py-1 text-xs border-b border-muted/30 last:border-0 sm:border-0">
    <span className="text-muted-foreground font-medium">{label}</span>
    <span className="font-semibold text-foreground">{value}</span>
  </div>
);

function formatDateRange(requestMeta: CrawlRequestMeta): string {
  const preset = String(requestMeta.date_range.preset ?? "").trim();
  if (preset === "today") return "Hôm nay";
  if (preset === "last_7_days") return "7 ngày qua";
  if (preset === "last_30_days") return "30 ngày qua";

  const start = String(requestMeta.date_range.start_date ?? "").trim();
  const end = String(requestMeta.date_range.end_date ?? "").trim();
  if (start && end) return `${start} đến ${end}`;
  if (start) return `Sau ngày ${start}`;
  if (end) return `Trước ngày ${end}`;
  return "Không lọc ngày";
}

function formatSortBy(value: string): string {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "views") return "Lượt xem";
  if (key === "comments" || key === "reply_count") return "Bình luận";
  if (key === "likes") return "Lượt thích";
  if (key === "reposts") return "Đăng lại";
  if (key === "shares") return "Chia sẻ";
  if (key === "newest") return "Mới nhất";
  if (key === "engagement") return "Tương tác";
  if (key === "score") return "Điểm viral";
  return value || "Điểm viral";
}

function resolveSourceModeLabel(_searchQueries: string[], seedPostUrls: string[], trendSearchUrls: string[]): string {
  const hasSeedUrls = seedPostUrls.length > 0;
  const hasTrendUrls = trendSearchUrls.length > 0;
  if (hasSeedUrls) return "Dán link / mã nhúng bài viết";
  if (hasTrendUrls) return "Trend search Threads";
  return "Tìm tự động";
}

function formatRuntimeProfile(runtime: Record<string, unknown> | undefined): string {
  if (!runtime) return "";
  const maxLinks = Number(runtime.maxCandidateLinks ?? 0);
  const maxSummaries = Number(runtime.maxCollectedPostsPerTopic ?? 0);
  const maxDetails = Number(runtime.maxDetailRequests ?? 0);
  const maxFinalists = Number(runtime.maxCommentScanPosts ?? 0);
  const concurrency = Number(runtime.maxConcurrency ?? 0);
  return [
    maxLinks > 0 ? `${maxLinks} liên kết` : "",
    maxSummaries > 0 ? `lọc nhanh ${maxSummaries} bài` : "",
    maxDetails > 0 ? `kiểm tra ${maxDetails} bài` : "",
    maxFinalists > 0 ? `lấy bình luận ${maxFinalists} bài` : "",
    concurrency > 0 ? `${concurrency} bài cùng lúc` : "",
  ].filter(Boolean).join(" · ");
}

function formatRecencyProfile(requestMeta: CrawlRequestMeta): string {
  const recency = Number(requestMeta.ranking_weights?.recency ?? 0);
  const halfLifeHours = Number(requestMeta.recency_half_life_hours ?? 0);
  if (recency <= 0 && halfLifeHours <= 0) return "";
  const halfLife = halfLifeHours >= 24
    ? `${Math.round(halfLifeHours / 24)} ngày`
    : `${Math.round(halfLifeHours)} giờ`;
  if (recency > 0 && halfLifeHours > 0) {
    return `mức ${recency}; ảnh hưởng giảm sau khoảng ${halfLife}`;
  }
  if (recency > 0) return `mức ${recency}`;
  return `ảnh hưởng giảm sau khoảng ${halfLife}`;
}
