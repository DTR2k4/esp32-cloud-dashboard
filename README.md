# Marketscope — GUI demo

Một trang dashboard thị trường chứng khoán để luyện tập dựng GUI. Toàn bộ mã cổ
phiếu, tên công ty và dữ liệu giá đều là **hư cấu**, được mô phỏng ngay trong
trình duyệt bằng JavaScript (random walk) — không gọi tới bất kỳ API bên ngoài
nào.

## Chạy thử

Không cần cài đặt gì cả — chỉ cần mở trực tiếp file `index.html` bằng trình
duyệt, hoặc phục vụ tĩnh bằng bất kỳ web server nào, ví dụ:

```bash
python3 -m http.server 8000
# rồi mở http://localhost:8000
```

Cũng có thể deploy thẳng lên GitHub Pages / Netlify / Vercel vì đây chỉ là
một file HTML tĩnh (HTML + CSS + JS thuần, không cần build).

## Tính năng

- Danh sách theo dõi (watchlist) 10 mã cổ phiếu mô phỏng, có tìm kiếm, mini
  biểu đồ sparkline và giá cập nhật theo thời gian thực (mỗi 1.5s).
- 3 thẻ chỉ số thị trường tổng hợp (toàn thị trường / công nghệ / năng lượng
  & vật liệu).
- Biểu đồ giá chi tiết cho mã đang chọn, đổi khung thời gian 1D/1T/1TH/3TH/1N,
  có crosshair + tooltip khi rê chuột, và bảng dữ liệu dạng text đi kèm.
- Bảng "Tăng mạnh nhất" / "Giảm mạnh nhất" trong ngày.
- Chuyển đổi giao diện sáng / tối (ghi nhớ lựa chọn qua `localStorage`).
- Responsive: sidebar chuyển xuống dưới trên màn hình hẹp.

## Cấu trúc

Toàn bộ giao diện nằm gọn trong `index.html` (không phụ thuộc framework hay
build tool), chỉ tải font từ Google Fonts (IBM Plex Sans / IBM Plex Mono).

## Bước tiếp theo (nếu muốn nối vào dữ liệu ESP32 thật)

File này hiện tự sinh dữ liệu giả trong hàm `genWalk()` / `tick()` ở cuối
`index.html`. Để thay bằng dữ liệu thật từ ESP32 qua cloud (MQTT/HTTP/
Firebase...), chỉ cần thay các hàm đó bằng lời gọi tới backend/broker tương
ứng và giữ nguyên phần render UI.
