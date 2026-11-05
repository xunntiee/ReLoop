# Config Assets

Thư mục này chứa các file cấu hình tài nguyên tĩnh cho video workflow.

## Avatar mặc định cho comment

**File:** `default-comment-avatar.jpg` (hoặc `.png`, `.webp`)

Đây là ảnh avatar được tự động thêm vào mỗi bài viết làm comment mặc định ở cuối video.

### Cách thay đổi avatar:

**Cách 1 – Trực tiếp trên máy (khuyến nghị):**
1. Thay file `default-comment-avatar.jpg` tại thư mục này bằng ảnh mới
2. Đặt tên file là `default-comment-avatar.jpg` (hoặc `.png`, `.webp`)
3. Restart server (hoặc chờ tự động reload)
4. Avatar mới sẽ được áp dụng ngay cho tất cả bài viết

**Cách 2 – Qua giao diện web:**
1. Mở một bài viết bất kỳ → Chi tiết → Tìm phần "Comment mặc định"
2. Nhấn nút **Avatar** để upload ảnh mới
3. Avatar sẽ được lưu và áp dụng cho tất cả bài viết

> **Lưu ý:** File trong thư mục `data/config/` được ưu tiên hơn file upload qua giao diện web.
> Thư mục này được theo dõi bởi git, nên khi push lên GitHub thì team khác cũng có avatar.
