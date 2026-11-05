# Mục tiêu scaffold

## Mục tiêu hiện tại

Theo `README.md` và cấu trúc mã nguồn, repo này được tạo để làm nền khung tối giản cho một tool mới, có thể:

- chạy độc lập trong thư mục `tool-base`
- giữ ranh giới rõ giữa server, web và package chia sẻ
- bám theo stack chính của repo lớn hơn
- cho phép sao chép hoặc nâng cấp sau này mà không sửa ứng dụng hiện tại

## Use case được hỗ trợ

- Bắt đầu một tool mới với API Hono đã chạy được.
- Có sẵn web shell với routing, query và một vài primitive UI.
- Có cơ chế cấu hình JSON đủ để điều khiển port, tên service và feature flag mẫu.

## Điều cố ý chưa làm

- Không có logic sản phẩm thật.
- Không có abstraction dùng chung quá sớm.
- Không có tích hợp ngoài, auth, database hay background worker.
- Không có yêu cầu nghiệp vụ được encode ngoài các ví dụ minh họa.

## Ràng buộc đang thấy trong code

- Web chạy dưới `/app`, không phải root path.
- Server và web dùng cổng cố định mặc định để thuận tiện cho local dev.
- Mô hình hiện tại ưu tiên đơn giản và dễ thay thế hơn là đầy đủ tính năng.

## Ghi chú về tài liệu này

Phần `Project PDR` hiện mô tả scaffold kỹ thuật hơn là product requirement theo nghĩa kinh doanh, vì repository chưa chứa dấu hiệu đủ tin cậy để suy ra mục tiêu sản phẩm cụ thể.
