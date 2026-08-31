# Marketscope — dashboard thị trường chứng khoán theo thời gian thực

Dashboard theo dõi **thị trường Mỹ** (real-time qua WebSocket của Alpaca
Markets, feed IEX) và **thị trường Việt Nam** (qua `vn-stock-sdk`, đa nguồn
TCBS/DNSE/SSI), tách thành 2 khu vực riêng trên cùng một trang. Có backend
nhỏ (Node/Express) để giấu API key, né lỗi CORS, và giữ 1 kết nối WebSocket
duy nhất tới Alpaca thay vì để mỗi trình duyệt tự mở kết nối riêng.

> Lưu ý phạm vi: "thị trường Mỹ" là giới hạn chung của mọi API miễn phí, không
> phải lựa chọn thiếu — dữ liệu real-time **miễn phí thật sự** hiện chỉ tồn
> tại cho cổ phiếu Mỹ (mỗi sàn giao dịch nước khác bán license dữ liệu riêng,
> rất đắt). Nếu sau này muốn thêm sàn khác, khả thi nhất là dữ liệu trễ
> 15–20 phút chứ không phải real-time miễn phí.

Khi API thật không khả dụng (chưa có key, hết quyền, sập, hoặc bị mạng chặn),
server tự động rơi về **dữ liệu mô phỏng** và gắn nhãn rõ ràng trên UI (chấm
tròn + nhãn cạnh tên mỗi khu vực) — dashboard không bao giờ hiển thị màn hình
trắng hay lỗi vỡ giao diện.

## Chạy thử (không cần Docker)

```bash
npm install
cp .env.example .env
# Mở .env, đăng ký tài khoản "paper" miễn phí tại https://alpaca.markets
# (mở được ở hầu hết các nước, không cần nạp tiền/thẻ), lấy 2 giá trị API Key
# ID + Secret Key ở trang Dashboard > "API Keys", dán vào .env
npm start
# Mở http://localhost:3000
```

Không có key cũng chạy được — phần Mỹ sẽ chỉ hiển thị ở chế độ mô phỏng cho
tới khi bạn thêm key vào `.env` và khởi động lại server. Phần Việt Nam không
cần key (vn-stock-sdk dùng API công khai), nhưng vẫn có thể fallback nếu tất
cả nguồn TCBS/DNSE/SSI cùng lỗi hoặc bị mạng chặn.

Muốn phát triển mà không tốn quota API thật / không cần mạng: chạy chế độ
mock (luôn trả dữ liệu giả cho cả 2 khu vực, không gọi API ngoài nào):

```bash
npm run dev:mock
```

## Chạy bằng Docker (tuỳ chọn)

Không bắt buộc — `npm start` ở trên là đủ. Docker chỉ hữu ích nếu bạn muốn một
môi trường tách biệt, không phụ thuộc máy có cài Node hay không, hoặc định
tự host dashboard này trên VPS/máy ảo sau này.

```bash
cp .env.example .env   # điền key như hướng dẫn ở trên
docker compose up --build
# Mở http://localhost:3000
```

Dừng bằng `docker compose down`. Sửa code xong muốn chạy lại bản mới thì thêm
`--build` như lệnh trên (Docker cache lại bước `npm ci` nên rebuild sau lần
đầu khá nhanh, trừ khi bạn đổi `package.json`).

## Vì sao cần backend?

Gọi thẳng API thị trường từ JavaScript chạy trong trình duyệt gặp 2 vấn đề:
lộ API key công khai trong mã nguồn, và nhiều API chặn CORS nên trình duyệt
không gọi trực tiếp được. Server nhỏ trong `server/` đứng giữa để giữ key ở
phía server và trả dữ liệu JSON cùng-origin cho frontend. Với phần Mỹ, server
còn giữ **1 kết nối WebSocket duy nhất** tới Alpaca rồi phân phối lại cho mọi
trình duyệt đang mở trang — vừa thật sự real-time (đẩy tick ngay khi có giao
dịch, không cần đợi poll), vừa không tốn quota theo số người xem (free tier
Alpaca chỉ cho **1 kết nối WebSocket đồng thời**).

## Nguồn dữ liệu

| Khu vực | Nguồn | Cơ chế | Ghi chú |
|---|---|---|---|
| Mỹ | [Alpaca Markets](https://alpaca.markets/data) WebSocket (`wss://stream.data.alpaca.markets/v2/iex`) | Push real-time | Cần API Key ID + Secret Key miễn phí (tài khoản "paper", mở được ở hầu hết các nước). Feed IEX (1 sàn thật ở Mỹ) là feed real-time duy nhất ở free tier — feed SIP "đầy đủ mọi sàn" chỉ có ở plan trả phí. Không có nến lịch sử intraday ở free tier, nên biểu đồ là **"phiên trực tiếp"** — tự vẽ dần từ các tick thật kể từ khi mở trang. Ngoài giờ giao dịch Mỹ, WebSocket có thể im lặng (không có trade) — server tự chuyển sang poll REST (`/v2/stocks/snapshots`) mỗi 60s để dữ liệu không "đứng hình". |
| Việt Nam | [`vn-stock-sdk`](https://github.com/dotranminhchu/vn-stock-sdk) (npm) — đa nguồn TCBS/DNSE/SSI | Poll REST mỗi 15s | Không cần key. Gói này tự xoay vòng nhiều nguồn công khai (không chính thức) và tự retry, bền hơn so với việc tự bám 1 endpoint duy nhất — nhưng vẫn không có SLA chính thức nên có thể lỗi/đổi schema. Bảng giá dùng `trading().priceBoard()` (trần/sàn/giá khớp/tham chiếu — đúng kiểu bảng giá chứng khoán VN); biểu đồ lịch sử dùng `quote().history()`. |

**Trước đây dùng Finnhub cho phần Mỹ** — free tier của Finnhub bị lỗi `403
Forbidden` rất phổ biến và dai dẳng trên diện rộng (xem
[finnhub-api#493](https://github.com/finnhubio/Finnhub-API/issues/493),
[#534](https://github.com/finnhubio/Finnhub-API/issues/534)), không phải do
cấu hình sai riêng của dự án này, nên đã đổi sang Alpaca.

Nếu Alpaca hoặc `vn-stock-sdk` sau này cũng ngừng hoạt động, thay hàm trong
`server/providers/alpaca.js` / `alpaca-ws.js` (hoặc `vnstock.js`) bằng một
nguồn khác — phần còn lại của server/frontend không cần đổi vì đã tách lớp
qua `providers/`. Vài lựa chọn khác từng cân nhắc: Twelve Data (free + WS,
nhưng hạn mức thấp hơn), SSI FastConnect API chính thức cho VN (cần đăng ký
trực tiếp tại quầy giao dịch SSI).

## Cấu trúc dự án

```
Dockerfile, docker-compose.yml  # Container hoá tuỳ chọn — xem "Chạy bằng Docker" ở trên
server/
  index.js               # Express + WebSocket server: route /api/..., /ws/international, cache, fallback
  providers/
    alpaca.js             # Gọi REST Alpaca /v2/stocks/snapshots (seed dữ liệu ban đầu + fallback khi WS im lặng)
    alpaca-ws.js           # Kết nối WebSocket real-time tới Alpaca, tự reconnect
    vnstock.js             # Gọi vn-stock-sdk (TCBS/DNSE/SSI) cho khu vực Việt Nam
    simulate.js            # Sinh dữ liệu mô phỏng dự phòng (seed theo mã + thời gian)
public/
  index.html              # Khung trang + <template> cho một khu vực thị trường
  styles.css              # Toàn bộ giao diện, hỗ trợ sáng/tối
  app.js                  # MarketPanel: watchlist, biểu đồ, bảng tăng/giảm, WebSocket/polling
```

Mỗi khu vực thị trường (Mỹ / Việt Nam) là một instance của cùng class
`MarketPanel` trong `app.js`, chỉ khác nguồn dữ liệu (WebSocket hay REST
polling), định dạng giá, và các trường thống kê hiển thị — nên muốn thêm một
thị trường thứ 3 chỉ cần thêm route backend + một `new MarketPanel({...})`
mới trên frontend.

## API nội bộ

- `GET /api/international/quotes` — đọc snapshot giá 8 mã Mỹ hiện có trong bộ nhớ server (không gọi upstream, luôn nhanh). Tên route giữ nguyên từ lúc chưa đổi nhãn UI, không ảnh hưởng gì tới việc dùng.
- `WS /ws/international` — kênh đẩy real-time cùng dữ liệu trên, cập nhật ngay khi Alpaca có tick mới (gộp tối đa 1 lần/400ms để tránh spam).
- `GET /api/vietnam/quotes` — giá 8 mã VN (VNM, VIC, VHM, HPG, FPT, MWG, VCB, MSN), poll mỗi 15s.
- `GET /api/vietnam/history?symbol=VNM&days=90` — chuỗi giá đóng cửa theo ngày.

Mỗi response luôn có field `source` (`live` | `fallback` | `mock`) và
`reason` (khi fallback) để frontend hiển thị đúng trạng thái.

## Giới hạn cần biết

- Đây là **demo/dự án luyện tập**, không phải sản phẩm giao dịch thực tế — không phải lời khuyên đầu tư.
- `vn-stock-sdk` dùng API công khai không chính thức của các công ty chứng khoán; môi trường phát triển của bạn có thể chặn các domain này (một số mạng công ty/CI chặn theo whitelist) — khi đó server sẽ tự rơi về dữ liệu mô phỏng và trả lý do cụ thể trong field `reason`.
- Alpaca free tier: REST ~200 request/phút, WebSocket giới hạn **1 kết nối đồng thời** và tối đa 30 kênh subscribe — dư sức cho 8 mã của app này. Vì server chỉ giữ 1 kết nối WS chung cho mọi người xem, số lượng tab/người dùng không làm tăng số kết nối tới Alpaca.
- Feed IEX chỉ phản ánh giao dịch trên sàn IEX (một trong nhiều sàn khớp lệnh cổ phiếu Mỹ) — giá thường rất sát giá thị trường chung cho các mã vốn hoá lớn, nhưng có thể lệch chút so với giá "chính thức" tổng hợp từ mọi sàn (feed SIP, chỉ có ở plan trả phí).
- Đã tự test bằng Playwright + `MOCK_UPSTREAM=1` (không cần mạng) cho toàn bộ luồng UI, WebSocket, và cơ chế fallback. Việc gọi API thật (Alpaca, TCBS/DNSE/SSI) **chưa được xác nhận từ mạng thật** do môi trường phát triển ban đầu bị chặn mạng ra ngoài — khi bạn chạy ở máy/host có mạng bình thường, nên kiểm tra lại badge nguồn dữ liệu (🟢 trực tiếp) để chắc chắn.
