# Documentation Summary

Tool Base là bộ khung tối giản cho một tool mới trong repository, tách biệt khỏi ứng dụng chính để có thể sao chép hoặc mở rộng độc lập. Kiến trúc hiện tại gồm API Hono, frontend React/Vite và gói cấu hình dùng chung, được điều phối bằng Bun workspace và Turbo.

## Agent Context Guide

Trước khi lập kế hoạch hoặc triển khai, hãy đọc `docs/SUMMARY.md` trước. Chỉ tải các tài liệu chi tiết liên quan trực tiếp đến tác vụ hiện tại và ưu tiên nhóm `Code Standard` khi cần bám theo quy ước triển khai. Nếu tài liệu mâu thuẫn với mã nguồn hoặc ý định người dùng, hãy dùng ngữ cảnh hiện có và xác nhận lại trước khi thực hiện thay đổi lớn.

## Architecture

Thiết kế hệ thống, tương tác thành phần, luồng dữ liệu chạy thực tế, và cách frontend/backend được ghép vào cùng một tool.

| File | Description |
| ---- | ----------- |
| [component-boundaries.md](architecture/component-boundaries.md) | Ranh giới giữa `server`, `web` và `config`, cùng trách nhiệm của từng phần. |
| [runtime-flow.md](architecture/runtime-flow.md) | Luồng khởi động, nạp cấu hình, phục vụ API và phân phối web build. |

## Codebase

Cấu trúc thư mục, entry point, module chính và vị trí các phần mở rộng quan trọng trong repo.

| File | Description |
| ---- | ----------- |
| [entry-points.md](codebase/entry-points.md) | Các entry point chính và cách request đi qua frontend/backend. |
| [workspace-layout.md](codebase/workspace-layout.md) | Tổ chức workspace, thư mục nguồn và vai trò của từng vùng mã. |

## Code Standard

Quy ước stack, kiểu tổ chức TypeScript workspace, pattern frontend và thói quen phát triển hiện có trong repo.

| File | Description |
| ---- | ----------- |
| [frontend-patterns.md](code-standard/frontend-patterns.md) | Pattern UI, routing, query và cách viết component hiện tại của web app. |
| [typescript-workspace-conventions.md](code-standard/typescript-workspace-conventions.md) | Quy ước workspace Bun/Turbo, strict TypeScript và quản lý dependency nội bộ. |

## Project PDR

Mục tiêu của scaffold, giới hạn phạm vi, contract cấu hình và các giả định đã được thể hiện rõ trong mã nguồn.

| File | Description |
| ---- | ----------- |
| [config-contract.md](project-pdr/config-contract.md) | Hợp đồng cấu hình JSON, cơ chế chọn file config và dữ liệu public được lộ ra cho web. |
| [scaffold-goals.md](project-pdr/scaffold-goals.md) | Mục tiêu của bộ khung, use case được hỗ trợ và những gì cố ý chưa có. |
| [ui-crawl-video-tool.md](project-pdr/ui-crawl-video-tool.md) | Product/UI spec cho hai luồng chính: crawl Threads và tạo video từ dữ liệu crawl. |

## Other

Tài liệu bổ sung ngoài bốn nhóm chuẩn của `docs/`.

| File | Description |
| ---- | ----------- |
