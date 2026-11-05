# Luồng chạy runtime

## Khởi động server

1. `apps/server/src/index.ts` gọi `loadToolConfig()`.
2. `packages/config/src/server.ts` chọn file cấu hình theo thứ tự:
   - `SERVER_CONFIG_PATH`
   - `config.json` ở gốc `tool-base`
   - `config.example.json`
3. Nội dung JSON được parse bằng `toolConfigSchema`.
4. Server Hono lắng nghe trên `config.server.port`.

## Luồng request API

### `GET /api/health`

- Trả về object đơn giản để kiểm tra server đang sống.

### `GET /api/config`

- Trả về:
  - `config`: chỉ dữ liệu public từ `toPublicToolConfig`
  - `configPath`: đường dẫn file đã nạp
  - `exists`: cờ cho biết file tại đường dẫn đó có tồn tại

### `GET /api/sample`

- Trả về mô tả scaffold và danh sách item mẫu.
- Khi `features.sampleApi` là `false`, `items` rỗng.

## Luồng frontend

1. `apps/web/src/main.tsx` khởi tạo React root.
2. `QueryClientProvider` bọc toàn app để dùng TanStack Query.
3. `RouterProvider` dùng router có `basepath: "/app"`.
4. Route `/` hiển thị `HomePage`, route `/settings` hiển thị `SettingsPage`.

## Kết nối frontend và backend

### Trong môi trường dev

- Vite chạy ở cổng `34568`.
- Request `/api/*` được proxy sang `http://localhost:34577`.

### Sau khi build web

- Server mount `apps/web/dist` tại `/app`.
- `serveStatic` rewrite `/app/*` về asset hoặc `index.html` để SPA routing hoạt động.

## Điều kiện phân phối web

- Nếu `apps/web/dist` chưa tồn tại, server vẫn chạy API nhưng không phục vụ UI.
- Điều này cho phép phát triển hoặc build server riêng mà không phụ thuộc frontend artifact.
