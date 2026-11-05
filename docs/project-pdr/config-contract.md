# Hợp đồng cấu hình

## Mục đích

Tool Base dùng file JSON để cung cấp runtime config đơn giản cho server và web mà không cần cơ sở dữ liệu hoặc hệ cấu hình phức tạp hơn.

## Shape hiện tại

```json
{
  "features": {
    "sampleApi": true
  },
  "server": {
    "name": "tool-base",
    "port": 34577
  },
  "web": {
    "title": "Tool Base"
  }
}
```

## Quy tắc nạp config

1. Nếu có `SERVER_CONFIG_PATH`, dùng file đó.
2. Nếu không, dùng `config.json` ở gốc `tool-base` khi file tồn tại.
3. Nếu chưa có `config.json`, fallback sang `config.example.json`.

## Dữ liệu public cho frontend

Frontend không đọc file trực tiếp. Nó lấy dữ liệu từ `GET /api/config`, trong đó server chỉ trả:

- `features`
- `server.name`
- `server.port`
- `web`
- metadata `configPath` và `exists`

## Hệ quả triển khai

- Mọi thay đổi schema phải cập nhật `toolConfigSchema` trước.
- Nếu thêm field chỉ dành cho server nội bộ, cần cân nhắc có đưa vào `toPublicToolConfig` hay không.
- `config.example.json` đang đóng vai trò tài liệu tham chiếu mặc định, không chỉ là file seed.
