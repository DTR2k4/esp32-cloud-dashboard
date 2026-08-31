# Marketscope — dashboard thị trường chứng khoán theo thời gian thực

Dashboard theo dõi **thị trường Quốc tế** (real-time qua WebSocket của
Finnhub) và **thị trường Việt Nam** (qua `vn-stock-sdk`, đa nguồn
TCBS/DNSE/SSI), tách thành 2 khu vực riêng trên cùng một trang. Có backend
nhỏ (Node/Express) để giấu API key, né lỗi CORS, và giữ 1 kết nối WebSocket
duy nhất tới Finnhub thay vì để mỗi trình duyệt tự mở kết nối riêng.

Khi API thật không khả dụng (chưa có key, hết quyền, sập, hoặc bị mạng chặn),
server tự động rơi về **dữ liệu mô phỏng** và gắn nhãn rõ ràng trên UI (chấm
tròn + nhãn cạnh tên mỗi khu vực) — dashboard không bao giờ hiển thị màn hình
trắng hay lỗi vỡ giao diện.

## Chạy thử

```bash
npm install
cp .env.example .env
# Mở .env, dán API key Finnhub miễn phí vào FINNHUB_API_KEY
# (đăng ký free tại https://finnhub.io/register, mất khoảng 1 phút)
npm start
# Mở http://localhost:3000
```

Không có key cũng chạy được — phần Quốc tế sẽ chỉ hiển thị ở chế độ mô phỏng
cho tới khi bạn thêm key vào `.env` và khởi động lại server. Phần Việt Nam
không cần key (vn-stock-sdk dùng API công khai), nhưng vẫn có thể fallback
nếu tất cả nguồn TCBS/DNSE/SSI cùng lỗi hoặc bị mạng chặn.

Muốn phát triển mà không tốn quota API thật / không cần mạng: chạy chế độ
mock (luôn trả dữ liệu giả cho cả 2 khu vực, không gọi API ngoài nào):

```bash
npm run dev:mock
```

## Vì sao cần backend?

Gọi thẳng API thị trường từ JavaScript chạy trong trình duyệt gặp 2 vấn đề:
lộ API key công khai trong mã nguồn, và nhiều API chặn CORS nên trình duyệt
không gọi trực tiếp được. Server nhỏ trong `server/` đứng giữa để giữ key ở
phía server và trả dữ liệu JSON cùng-origin cho frontend. Với phần Quốc tế,
server còn giữ **1 kết nối WebSocket duy nhất** tới Finnhub rồi phân phối lại
cho mọi trình duyệt đang mở trang — vừa thật sự real-time (đẩy tick ngay khi
có giao dịch, không cần đợi poll), vừa không tốn quota theo số người xem.

## Nguồn dữ liệu

| Khu vực | Nguồn | Cơ chế | Ghi chú |
|---|---|---|---|
| Quốc tế | [Finnhub](https://finnhub.io) WebSocket (`wss://ws.finnhub.io`) | Push real-time | Cần API key miễn phí. Free tier không có nến lịch sử intraday, nên biểu đồ quốc tế là **"phiên trực tiếp"** — tự vẽ dần từ các tick thật kể từ khi mở trang, không có khung 1 tuần/1 tháng. Ngoài giờ giao dịch Mỹ, WebSocket có thể im lặng (không có trade) — server tự chuyển sang poll REST nhẹ mỗi 60s để dữ liệu không "đứng hình". |
| Việt Nam | [`vn-stock-sdk`](https://github.com/dotranminhchu/vn-stock-sdk) (npm) — đa nguồn TCBS/DNSE/SSI | Poll REST mỗi 15s | Không cần key. Gói này tự xoay vòng nhiều nguồn công khai (không chính thức) và tự retry, bền hơn so với việc tự bám 1 endpoint duy nhất — nhưng vẫn không có SLA chính thức nên có thể lỗi/đổi schema. Bảng giá dùng `trading().priceBoard()` (trần/sàn/giá khớp/tham chiếu — đúng kiểu bảng giá chứng khoán VN); biểu đồ lịch sử dùng `quote().history()`. |

Nếu `vn-stock-sdk` ngừng hoạt động, thay hàm trong
`server/providers/vnstock.js` bằng một nguồn khác (SSI FastConnect API chính
thức — cần đăng ký trực tiếp tại quầy giao dịch SSI, hoặc một API trả phí có
SLA rõ ràng) — phần còn lại của server/frontend không cần đổi vì đã tách lớp
qua `providers/`.

## Cấu trúc dự án

```
server/
  index.js               # Express + WebSocket server: route /api/..., /ws/international, cache, fallback
  providers/
    finnhub.js            # Gọi REST Finnhub /quote (seed dữ liệu ban đầu + fallback khi WS im lặng)
    finnhub-ws.js          # Kết nối WebSocket real-time tới Finnhub, tự reconnect
    vnstock.js             # Gọi vn-stock-sdk (TCBS/DNSE/SSI) cho khu vực Việt Nam
    simulate.js            # Sinh dữ liệu mô phỏng dự phòng (seed theo mã + thời gian)
public/
  index.html              # Khung trang + <template> cho một khu vực thị trường
  styles.css              # Toàn bộ giao diện, hỗ trợ sáng/tối
  app.js                  # MarketPanel: watchlist, biểu đồ, bảng tăng/giảm, WebSocket/polling
```

Mỗi khu vực thị trường (Quốc tế / Việt Nam) là một instance của cùng class
`MarketPanel` trong `app.js`, chỉ khác nguồn dữ liệu (WebSocket hay REST
polling), định dạng giá, và các trường thống kê hiển thị — nên muốn thêm một
thị trường thứ 3 chỉ cần thêm route backend + một `new MarketPanel({...})`
mới trên frontend.

## API nội bộ

- `GET /api/international/quotes` — đọc snapshot giá 8 mã Mỹ hiện có trong bộ nhớ server (không gọi upstream, luôn nhanh).
- `WS /ws/international` — kênh đẩy real-time cùng dữ liệu trên, cập nhật ngay khi Finnhub có tick mới (gộp tối đa 1 lần/400ms để tránh spam).
- `GET /api/vietnam/quotes` — giá 8 mã VN (VNM, VIC, VHM, HPG, FPT, MWG, VCB, MSN), poll mỗi 15s.
- `GET /api/vietnam/history?symbol=VNM&days=90` — chuỗi giá đóng cửa theo ngày.

Mỗi response luôn có field `source` (`live` | `fallback` | `mock`) và
`reason` (khi fallback) để frontend hiển thị đúng trạng thái.

## Giới hạn cần biết

- Đây là **demo/dự án luyện tập**, không phải sản phẩm giao dịch thực tế — không phải lời khuyên đầu tư.
- `vn-stock-sdk` dùng API công khai không chính thức của các công ty chứng khoán; môi trường phát triển của bạn có thể chặn các domain này (một số mạng công ty/CI chặn theo whitelist) — khi đó server sẽ tự rơi về dữ liệu mô phỏng và trả lý do cụ thể trong field `reason`.
- Finnhub free tier giới hạn request REST ~60/phút; WebSocket không tính vào hạn mức này. Vì server chỉ giữ 1 kết nối WS chung cho mọi người xem, số lượng tab/người dùng không làm tăng số kết nối tới Finnhub.
- Đã tự test bằng Playwright + `MOCK_UPSTREAM=1` (không cần mạng) cho toàn bộ luồng UI, WebSocket, và cơ chế fallback. Việc gọi API thật (Finnhub, TCBS/DNSE/SSI) **chưa được xác nhận từ mạng thật** do môi trường phát triển ban đầu bị chặn mạng ra ngoài — khi bạn chạy ở máy/host có mạng bình thường, nên kiểm tra lại badge nguồn dữ liệu (🟢 trực tiếp) để chắc chắn.
