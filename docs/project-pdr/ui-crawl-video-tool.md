# UI PDR: Threads Crawl và Video Tool

## Mục tiêu

UI này biến `tool-base` thành một công cụ vận hành hoàn chỉnh cho hai việc:

1. Crawl Threads theo topic/filter và xuất JSON chuẩn cho đồng nghiệp dùng.
2. Dùng dữ liệu crawl để chọn bài, dựng kịch bản, tạo video ngắn và quản lý file xuất ra.

Màn hình đầu tiên phải là tool làm việc thật, không phải landing page. Người dùng chính là operator/content team: cần nhập nhanh điều kiện crawl, xem kết quả, chọn insight/post tốt, rồi chuyển sang tạo video.

## Phạm vi MVP

MVP cần làm đủ hai luồng liền nhau:

- Crawl: cấu hình topic, chạy crawl, theo dõi trạng thái, xem preview output JSON.
- Video: chọn post/comment từ output crawl, tạo outline/script, cấu hình giọng đọc/caption/layout, render video, tải file kết quả.

Chưa cần multi-user/database đầy đủ ở MVP. Có thể lưu trạng thái bằng file JSON/local storage trước, nhưng UI phải được thiết kế sao cho sau này thay bằng database/queue không phải đổi trải nghiệm chính.

## Điều hướng chính

UI nên có sidebar hoặc tab ngang gọn, gồm 4 vùng:

- `Crawl`: cấu hình và chạy crawl.
- `Output`: xem, lọc, duyệt dữ liệu crawl.
- `Video`: tạo video từ post đã chọn.
- `Runs`: lịch sử crawl/render, trạng thái, lỗi, file output.

Header luôn hiển thị:

- Trạng thái API.
- Trạng thái session Threads/cookie.
- Config hiện dùng.
- Nút mở thư mục output hoặc copy path file JSON.

## Luồng 1: Crawl Threads

### Màn hình Crawl

Mục tiêu của màn hình này là chạy được một topic bất kỳ mà không cần sửa JSON thủ công.

Các block chính:

- `Topic setup`
  - Topic title.
  - Category.
  - Search queries, nhập nhiều dòng hoặc tag input.
  - Required keywords.
  - Excluded keywords.
  - Seed post URLs.

- `Date and language`
  - Date preset: hôm nay, 7 ngày, 30 ngày, custom.
  - Start date/end date.
  - Languages: vi, en.

- `Post filters`
  - Số bài cần xuất.
  - Số top comments mỗi bài.
  - Số comment tối thiểu phải load được.
  - Min replies/reposts/shares.
  - Text length min/max.
  - Sort by: comments, likes, reposts, shares, views, newest, engagement.

- `Crawler performance`
  - Headless toggle.
  - Dùng cache toggle.
  - Cache TTL.
  - Search scroll rounds.
  - Post scroll rounds.
  - Comment scroll rounds.
  - Max candidate links.
  - Max collected posts per topic.
  - Timeout.

- `Session`
  - Path cookie/storage state đang dùng.
  - Nút test session.
  - Cảnh báo nếu cookie hết hạn hoặc chưa login.

Primary action:

- `Start crawl`

Secondary actions:

- `Save as config`
- `Load config`
- `Reset to quick crawl`
- `Open output folder`

### Crawl progress

Khi crawl đang chạy, UI cần có panel trạng thái:

- Run id.
- Status: queued, running, completed, failed.
- Started at, elapsed time.
- Topics đang chạy.
- Queries đã chạy.
- Discovered URLs.
- Collected posts.
- Cache hits/misses.
- Invalid URLs.
- Last error nếu có.

Progress không cần giả phần trăm nếu backend chưa có tổng số chắc chắn. Dùng step-based status tốt hơn:

- Preparing session.
- Searching topic.
- Opening candidate posts.
- Sorting top comments.
- Extracting metrics.
- Writing JSON output.
- Completed.

### Output preview trong Crawl

Sau khi run xong, hiển thị nhanh:

- Output path.
- Tổng số topic.
- Tổng số post.
- Tổng số comment.
- Mỗi post hiển thị:
  - username/display name.
  - created_at.
  - text preview.
  - like_count, reply_count, repost_count, quote_count, share_count, view_count.
  - top comments count.
  - nút mở Threads URL.
  - nút chọn sang Video.

Nếu `view_count = 0`, UI phải ghi là `not available` thay vì làm người dùng hiểu nhầm là bài có 0 lượt xem.

## JSON output contract cho Crawl

UI chỉ nên dựa vào shape gọn này:

```json
[
  {
    "topic_id": "topic-top-threads",
    "topic_title": "Top Threads",
    "keywords": [],
    "source": "threads",
    "crawled_at": "2026-06-11T05:28:07Z",
    "posts": [
      {
        "post_id": "DZZ61HUj4qH",
        "url": "https://www.threads.com/@user/post/DZZ61HUj4qH",
        "username": "user",
        "display_name": "Display name",
        "text": "Post text",
        "source_url": "https://www.threads.com/@user/post/DZZ61HUj4qH",
        "language": "vi",
        "view_count": 0,
        "like_count": 3800,
        "reply_count": 103,
        "repost_count": 73,
        "quote_count": 0,
        "share_count": 47,
        "created_at": "2026-06-10T12:14:37Z",
        "crawled_at": "2026-06-11T05:24:44Z",
        "top_comments": [
          {
            "comment_id": "DZZ61HUj4qH-comment-1",
            "username": "comment_user",
            "display_name": "Comment user",
            "text": "Comment text",
            "like_count": 0,
            "reply_count": 0,
            "created_at": "",
            "source_order": 1
          }
        ]
      }
    ]
  }
]
```

Không đưa các field debug vào UI output chính:

- score_breakdown
- matched_keywords
- matched_required_keywords
- matched_excluded_keywords
- metrics_snapshot
- raw_metric_texts
- raw_activity_texts
- url_status
- audit

Nếu cần debug, tạo tab riêng `Run diagnostics`, không trộn vào JSON cho đồng nghiệp dùng.

## Luồng 2: Làm video từ crawl

### Màn hình Output

Đây là cầu nối giữa crawl và video.

Các control cần có:

- Chọn crawl run/output file.
- Search trong post text/comment.
- Filter theo metric:
  - nhiều like.
  - nhiều reply.
  - nhiều share.
  - có đủ 5 top comments.
  - có view_count khả dụng.
- Sort theo comments, likes, shares, newest.
- Select multiple posts.
- Pin post/comment quan trọng.

Mỗi post card nên có:

- Text đầy đủ với expand/collapse.
- Metrics dạng compact.
- Top comments dạng list.
- Checkbox chọn post.
- Checkbox chọn từng comment đưa vào video.
- Nút `Use for video`.

### Màn hình Video Builder

Mục tiêu là từ các post/comment đã chọn tạo được video ngắn.

Layout đề xuất:

- Cột trái: selected crawl content.
- Cột giữa: storyboard/script.
- Cột phải: video settings và preview.

Các section:

- `Selected source`
  - Danh sách post được chọn.
  - Danh sách comment được chọn.
  - Nút remove/reorder.

- `Story format`
  - Video type:
    - Top comments recap.
    - Finance insight summary.
    - Viral post analysis.
    - Question and answer.
    - Listicle.
  - Duration target:
    - 30s.
    - 45s.
    - 60s.
    - 90s.
  - Tone:
    - factual.
    - conversational.
    - dramatic.
    - funny.
    - educational.

- `Script`
  - Hook.
  - Main points.
  - Comment highlights.
  - Closing.
  - CTA optional.
  - Nút regenerate script.
  - Nút edit thủ công.

- `Visual style`
  - Aspect ratio: 9:16, 1:1, 16:9.
  - Template:
    - dark social recap.
    - clean finance.
    - comment wall.
    - news card.
  - Font size.
  - Caption position.
  - Show metrics toggle.
  - Blur username toggle nếu cần ẩn danh.

- `Voice and audio`
  - Voice select.
  - Speed.
  - Background music toggle.
  - Music volume.
  - Voice volume.

- `Render`
  - Nút generate preview.
  - Nút render final.
  - Render status.
  - Output file path.
  - Download/open file.

### Storyboard data contract

UI nên tạo một object trung gian trước khi render video:

```json
{
  "video_id": "video-20260611-001",
  "source_run_id": "crawl-20260611-001",
  "source_output_path": "data/processed/viral_topics/crawl-threads-top-threads.json",
  "title": "5 câu chuyện tiết kiệm tiền đang viral trên Threads",
  "format": "top_comments_recap",
  "aspect_ratio": "9:16",
  "duration_target_seconds": 60,
  "language": "vi",
  "style": {
    "template": "clean_finance",
    "show_metrics": true,
    "caption_position": "bottom",
    "anonymize_usernames": false
  },
  "audio": {
    "voice": "vi_female_01",
    "speed": 1,
    "background_music": true,
    "music_volume": 0.2
  },
  "scenes": [
    {
      "scene_id": "scene-1",
      "type": "hook",
      "duration_seconds": 5,
      "text": "Có những bài Threads về tiết kiệm tiền kéo hàng trăm bình luận.",
      "source_post_id": ""
    },
    {
      "scene_id": "scene-2",
      "type": "post_highlight",
      "duration_seconds": 12,
      "text": "Một người chia sẻ cột mốc tiết kiệm đầu tiên...",
      "source_post_id": "DZZ61HUj4qH",
      "source_comment_ids": ["DZZ61HUj4qH-comment-1"]
    }
  ]
}
```

Render backend sau này có thể nhận storyboard này để tạo video bằng Remotion, FFmpeg hoặc service render riêng.

## API đề xuất

API crawl hiện có thể giữ:

- `GET /api/crawl/config`
- `POST /api/crawl/runs`
- `GET /api/crawl/runs`
- `GET /api/crawl/runs/:id`
- `GET /api/crawl/runs/:id/output`

API nên thêm cho video:

- `POST /api/videos/drafts`
  - Tạo draft từ selected posts/comments.
- `GET /api/videos/drafts/:id`
  - Lấy storyboard/script/settings.
- `PATCH /api/videos/drafts/:id`
  - Sửa script/settings.
- `POST /api/videos/drafts/:id/preview`
  - Tạo preview nhanh.
- `POST /api/videos/drafts/:id/render`
  - Render final.
- `GET /api/videos/renders`
  - Danh sách render jobs.
- `GET /api/videos/renders/:id`
  - Trạng thái render.
- `GET /api/videos/renders/:id/file`
  - Download hoặc stream file video.

## Component frontend đề xuất

Tạo theo pattern hiện tại trong `apps/web/src/features`.

- `features/crawl-page.tsx`
- `features/output-page.tsx`
- `features/video-builder-page.tsx`
- `features/runs-page.tsx`
- `lib/api.ts` mở rộng typed client.
- `components/crawl/crawl-config-form.tsx`
- `components/crawl/crawl-run-status.tsx`
- `components/crawl/session-status.tsx`
- `components/output/post-result-card.tsx`
- `components/output/comment-list.tsx`
- `components/video/source-selection-panel.tsx`
- `components/video/storyboard-editor.tsx`
- `components/video/video-settings-panel.tsx`
- `components/video/render-status-panel.tsx`

Nếu chưa muốn tách route ngay, có thể làm một `HomePage` với tabs trước, sau đó tách route khi UI lớn lên.

## State và lỗi bắt buộc

UI cần xử lý rõ các trạng thái:

- Chưa có config.
- Cookie không tồn tại.
- Cookie hết hạn hoặc chưa login.
- Crawl đang chạy.
- Crawl hoàn thành nhưng không có bài nào.
- Crawl có bài nhưng không đủ top comments.
- View count không khả dụng.
- Threads đổi UI selector.
- Timeout khi mở post.
- Render video đang queue.
- Render video failed.
- Output file bị thiếu hoặc bị xóa.

Không nên chỉ show toast chung chung. Mỗi lỗi cần có message ngắn và action cụ thể:

- `Open config`
- `Test session`
- `Retry crawl`
- `Reduce filters`
- `Open output folder`
- `View diagnostics`

## Thiết kế giao diện

Phong cách nên là tool vận hành, không phải marketing:

- Dense nhưng dễ scan.
- Sidebar/tabs rõ ràng.
- Card chỉ dùng cho post/result/job, không bọc cả page thành nhiều card lồng nhau.
- Metric dùng icon nhỏ và số compact.
- Button command dùng icon khi hợp lý.
- Form control rõ loại dữ liệu: input, textarea, segmented control, toggle, slider/number input.
- Bảng run history nên có status badge, timestamp, output path, action.

Màu nên trung tính, không dùng một palette tím/xanh quá nặng. UI cần ưu tiên đọc text tiếng Việt dài và metric số.

## Acceptance criteria MVP

### Crawl UI

- Người dùng tạo một crawl topic mới từ UI mà không sửa file JSON.
- Người dùng chạy crawl và thấy trạng thái run.
- Người dùng mở được output sau khi crawl xong.
- Output preview hiển thị đúng 5 bài và 5 top comments nếu config yêu cầu như vậy.
- UI không hiển thị field debug trong output chính.
- Nếu `view_count = 0`, UI hiển thị `not available`.

### Video UI

- Người dùng chọn post/comment từ output crawl.
- Người dùng tạo được draft storyboard từ selection.
- Người dùng sửa được script trước khi render.
- Người dùng chọn aspect ratio, template, caption, voice.
- Người dùng start render và xem trạng thái.
- Người dùng mở hoặc download được video output khi render xong.

## Thứ tự triển khai đề xuất

1. Hoàn thiện Crawl tab trên UI hiện tại.
2. Thêm Output tab để browse JSON crawl.
3. Thêm selection state cho post/comment.
4. Tạo Video Builder tab với storyboard draft local/mock trước.
5. Thêm API video draft/render sau khi chốt renderer.
6. Nối render thật và lưu lịch sử video jobs.

## Quyết định kỹ thuật còn mở

- Renderer video dùng Remotion hay FFmpeg thuần.
- Voice/TTS dùng provider nào.
- Có cần ẩn danh username/comment không.
- Có cần lưu runs/video jobs bằng database hay JSON file đủ dùng cho bản đầu.
- Có cần nhiều account Threads/session pool cho nhiều người dùng không.
