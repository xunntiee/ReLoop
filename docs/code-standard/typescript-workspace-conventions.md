# Quy ước workspace và TypeScript

## Quản lý workspace

- Repo dùng Bun workspace với hai nhóm:
  - `apps/*`
  - `packages/*`
- Dependency nội bộ được khai báo bằng `workspace:*`.
- Script ở root được điều phối bằng Turbo thay vì gọi từng package thủ công.

## TypeScript

- `tsconfig.json` gốc bật `strict: true`.
- Dùng `moduleResolution: "bundler"` và target `ES2023`.
- Các guard quan trọng đã bật:
  - `noUncheckedIndexedAccess`
  - `noImplicitOverride`
  - `noFallthroughCasesInSwitch`
  - `forceConsistentCasingInFileNames`

## Module và build

- Toàn workspace dùng `type: "module"`.
- Server build bằng `tsdown` ra ESM.
- Web build bằng Vite sau khi chạy `check-types`.

## Chất lượng mã nguồn

- `biome.jsonc` kế thừa rule từ `ultracite/biome/core`.
- Root script:
  - `bun run check-types`
  - `bun run check`
  - `bun run fix`

## Quy ước ngầm đang được dùng

- Package chia sẻ chỉ chứa phần thực sự dùng chung; hiện tại đó là schema và loader cấu hình.
- File nguồn nhỏ, trách nhiệm hẹp, chưa có abstraction sớm.
- Tên module phản ánh trực tiếp vai trò thực tế như `home-page`, `settings-page`, `query-client`, `schema`, `server`.
