# Pattern frontend hiện tại

## Tổ chức màn hình

- Route và màn hình được tách riêng:
  - Route file chỉ khai báo `createFileRoute(...)`.
  - Logic hiển thị nằm trong `src/features/*`.
- Layout gốc nằm trong `RootLayout` và render `Outlet`.

## Truy cập dữ liệu

- Tất cả request API đi qua helper typed trong `src/lib/api.ts`.
- Mỗi màn hình gọi dữ liệu bằng `useQuery` với `queryKey` tường minh.
- `QueryClient` toàn cục đang dùng:
  - `refetchOnWindowFocus: false`
  - `retry: 1`

## UI primitives

- Primitive UI nằm cục bộ trong `src/components/ui/`, không phụ thuộc package UI chung.
- `class-variance-authority` được dùng cho component có biến thể như `Button` và `Badge`.
- Helper `cn()` kết hợp `clsx` và `tailwind-merge` để ghép class.

## Styling

- Style hiện tại nằm chủ yếu trong `src/index.css`.
- Class name theo hướng semantic cục bộ như `app-shell`, `top-nav`, `ui-card`, `config-grid`.
- Repo đang dùng `@tailwindcss/vite`, nhưng file CSS hiện viết class tùy biến thủ công thay vì utility-first trực tiếp trong JSX.

## Điều cần giữ khi mở rộng

- Tiếp tục dùng alias `@` trỏ đến `apps/web/src`.
- Không gọi `fetch` trực tiếp rải rác trong feature khi đã có API client typed.
- Nếu thêm route mới, giữ mô hình route mỏng và feature component chịu trách nhiệm render.
