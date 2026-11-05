# Ranh giới thành phần

## Tổng quan

Tool Base được tách thành ba phần rõ ràng:

- `apps/server`: HTTP server dùng Hono, chịu trách nhiệm nạp cấu hình, phục vụ API mẫu và phục vụ frontend build khi `apps/web/dist` tồn tại.
- `apps/web`: giao diện React chạy dưới base path `/app`, dùng TanStack Router cho route và TanStack Query để gọi API nội bộ.
- `packages/config`: gói dùng chung chứa schema Zod và logic nạp cấu hình phía server.

## Ranh giới trách nhiệm

### `packages/config`

- Là nguồn sự thật cho shape của `ToolConfig`.
- Cung cấp `toolConfigSchema` để parse JSON.
- Cung cấp `toPublicToolConfig` để giới hạn dữ liệu lộ ra qua API.
- Cung cấp `loadToolConfig` và các helper resolve path, nhưng không chứa HTTP logic.

### `apps/server`

- Khởi động node server từ `src/index.ts`.
- Gọi `loadToolConfig()` một lần khi boot để lấy port và config runtime.
- Khởi tạo Hono app qua `createServerApp`.
- Định nghĩa các endpoint mẫu:
  - `/`
  - `/api/health`
  - `/api/config`
  - `/api/sample`
- Chỉ mount static web khi build output thực sự tồn tại.

### `apps/web`

- Chạy như SPA tại `/app`.
- Không truy cập file config trực tiếp; mọi dữ liệu runtime đi qua `/api/*`.
- Tách route khỏi feature component:
  - `src/routes/*` định nghĩa route file-based.
  - `src/features/*` chứa phần hiển thị theo màn hình.
  - `src/components/ui/*` chứa primitive cục bộ kiểu shadcn.

## Điểm ghép giữa các thành phần

- `web` phụ thuộc vào `@tool-base/config` để dùng type `PublicToolConfig`.
- `server` phụ thuộc vào `@tool-base/config/server` và `@tool-base/config/schema`.
- `web` gọi `server` qua proxy Vite trong môi trường dev và qua cùng origin khi đã được server phục vụ từ `dist`.

## Điều chưa có

- Chưa có cơ chế persistence ngoài file JSON cấu hình.
- Chưa có authentication, database, queue hay service ngoài.
- Chưa có logic domain cụ thể; toàn bộ route và màn hình hiện tại là ví dụ để thay thế.
