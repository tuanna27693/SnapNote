# SnapNote

Phần mềm chụp màn hình cho Windows, chú thích ngay trên vùng chọn (như Snipping Tool) với hình chữ nhật, elip, mũi tên, bút, chữ và callout.

## Dùng
- `Ctrl+Shift+A` (đổi được trong Cài đặt) để chụp, kéo chọn vùng, thanh chỉnh sửa hiện ngay bên dưới.
- `Ctrl+C` sao chép ảnh, `Ctrl+S` lưu, nút **Chỉnh sửa** mở trình chỉnh sửa đầy đủ.
- Cài đặt: khởi chạy cùng Windows, tự động kiểm tra cập nhật.

## Phát triển
```bash
npm install
npm start        # build giao diện và chạy
npm run dist     # tạo file cài đặt trong release/
npm run release  # build và đưa lên GitHub Releases (cần GH_TOKEN)
```
