# Entry point và luồng điều hướng

## Entry point cấp workspace

- `package.json`: script gốc cho `dev`, `build`, `check-types`, `check`, `fix`.
- `turbo.json`: định nghĩa orchestration giữa các package và truyền `SERVER_CONFIG_PATH` vào môi trường build/dev.

## Entry point backend

- `apps/server/src/index.ts`: điểm vào duy nhất của server runtime.
- `apps/server/src/app.ts`: nơi khai báo route và logic mount frontend build.
- `apps/server/tsdown.config.ts`: cấu hình build ESM vào `dist/`.

## Entry point frontend

- `apps/web/src/main.tsx`: bootstrap React.
- `apps/web/src/router.tsx`: khởi tạo router với `routeTree.gen.ts`.
- `apps/web/src/routes/__root.tsx`: root route chứa layout chung.
- `apps/web/src/routes/index.tsx`: route màn hình tổng quan.
- `apps/web/src/routes/settings.tsx`: route màn hình cấu hình.

## Module kết nối dữ liệu

- `apps/web/src/lib/api.ts`: client fetch typed cho `/api/config` và `/api/sample`.
- `apps/web/src/query-client.ts`: cấu hình mặc định cho query toàn app.

## Module chia sẻ cấu hình

- `packages/config/src/schema.ts`: schema và type cấu hình.
- `packages/config/src/server.ts`: resolve path và nạp file JSON phía server.

## Điểm mở rộng tự nhiên

- Thêm route API mới trong `apps/server/src/app.ts` hoặc tách thành module riêng khi số route tăng.
- Thêm màn hình mới bằng route file mới dưới `apps/web/src/routes/` và feature tương ứng trong `src/features/`.
- Mở rộng schema config trong `packages/config/src/schema.ts` trước, rồi mới dùng tiếp ở server và web.
