# Bố cục workspace

## Thư mục gốc

```txt
tool-base/
├── apps/
│   ├── server/
│   └── web/
├── packages/
│   └── config/
├── config.example.json
├── package.json
├── tsconfig.json
└── turbo.json
```

## `apps/server`

- Chứa shell API Hono.
- `src/` hiện chỉ có:
  - `index.ts`: boot server
  - `app.ts`: route và static mounting
- Phù hợp cho tool nhỏ bắt đầu từ ít file, sau đó mới tách module khi cần.

## `apps/web`

- Chứa ứng dụng Vite + React.
- Cấu trúc hiện tại tách theo vai trò:
  - `src/routes/`: file-route TanStack Router
  - `src/features/`: component theo màn hình
  - `src/components/ui/`: primitive UI cục bộ
  - `src/lib/`: helper dùng chung như API client và class merge
- `routeTree.gen.ts` là file sinh tự động từ plugin router, không phải nơi chỉnh tay.

## `packages/config`

- Là package dùng chung duy nhất ở thời điểm hiện tại.
- Được thiết kế để tái sử dụng type/schema giữa app server và app web mà không kéo thêm logic ngoài nhu cầu cấu hình.

## File cấu hình gốc

- `config.example.json`: giá trị mẫu mặc định cho tool.
- `tsconfig.json`: base TypeScript option dùng cho toàn workspace.
- `biome.jsonc`: kế thừa rule từ `ultracite`.
- `bunfig.toml`: dùng isolated linker cho Bun.

## Dấu hiệu repo còn ở giai đoạn scaffold

- Chưa có thư mục test.
- Chưa có package domain riêng.
- Chưa có asset, migration, hay integration ngoài HTTP nội bộ.
