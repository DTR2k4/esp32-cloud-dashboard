# Marketscope — dashboard thị trường chứng khoán theo thời gian thực

Dashboard theo dõi **thị trường Quốc tế** (qua Finnhub) và **thị trường Việt
Nam** (qua API công khai không chính thức của VNDirect), tách thành 2 khu vực
riêng trên cùng một trang. Có backend proxy nhỏ (Node/Express) để giấu API
key và né lỗi CORS khi gọi API thật từ trình duyệt.

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
cho tới khi bạn thêm key vào `.env` và khởi động lại server.

Muốn phát triển mà không tốn quota API thật / không cần mạng: chạy chế độ
mock (luôn trả dữ liệu giả cho cả 2 khu vực, không gọi API ngoài nào):

```bash
npm run dev:mock
```

## Vì sao cần backend?

Gọi thẳng API thị trường từ JavaScript chạy trong trình duyệt gặp 2 vấn đề:
lộ API key công khai trong mã nguồn, và nhiều API chặn CORS nên trình duyệt
không gọi trực tiếp được. Server nhỏ trong `server/` đứng giữa để giữ key ở
phía server và trả dữ liệu JSON cùng-origin cho frontend.

## Nguồn dữ liệu

| Khu vực | Nguồn | Ghi chú |
|---|---|---|
| Quốc tế | [Finnhub](https://finnhub.io) `/quote` | API chính thức, cần API key miễn phí. Free tier không có nến lịch sử intraday, nên biểu đồ quốc tế là **"phiên trực tiếp"** — tự vẽ dần từ các lần poll thật kể từ khi mở trang, không có khung 1 tuần/1 tháng. |
| Việt Nam | VNDirect `finfo-api` (`/v4/stock_prices`) | **API công khai không chính thức** — không cần key, nhưng không có tài liệu/SLA chính thức, có thể đổi schema hoặc ngừng hoạt động bất kỳ lúc nào. Có dữ liệu lịch sử theo ngày nên biểu đồ VN hỗ trợ chọn khung 1/3/6 tháng. |

Nếu nguồn VNDirect ngừng hoạt động, thay hàm trong
`server/providers/vndirect.js` bằng một nguồn khác (SSI iBoard, DNSE, hoặc
một API trả phí có SLA rõ ràng) — phần còn lại của server/frontend không cần
đổi vì đã tách lớp qua `providers/`.

## Cấu trúc dự án

```
server/
  index.js              # Express app: định nghĩa route /api/..., cache, fallback
  providers/
    finnhub.js           # Gọi Finnhub thật
    vndirect.js           # Gọi VNDirect thật
    simulate.js           # Sinh dữ liệu mô phỏng dự phòng (seed theo mã + thời gian)
public/
  index.html             # Khung trang + <template> cho một khu vực thị trường
  styles.css             # Toàn bộ giao diện, hỗ trợ sáng/tối
  app.js                 # MarketPanel: watchlist, biểu đồ, bảng tăng/giảm, polling
```

Mỗi khu vực thị trường (Quốc tế / Việt Nam) là một instance của cùng class
`MarketPanel` trong `app.js`, chỉ khác nguồn dữ liệu và định dạng giá — nên
muốn thêm một thị trường thứ 3 chỉ cần thêm route backend + một
`new MarketPanel({...})` mới trên frontend.

## API nội bộ

- `GET /api/international/quotes` — giá 8 mã Mỹ (AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, NFLX).
- `GET /api/vietnam/quotes` — giá 8 mã VN (VNM, VIC, VHM, HPG, FPT, MWG, VCB, MSN).
- `GET /api/vietnam/history?symbol=VNM&days=90` — chuỗi giá đóng cửa theo ngày.

Mỗi response luôn có field `source` (`live` | `fallback` | `mock`) và
`reason` (khi fallback) để frontend hiển thị đúng trạng thái.

## Giới hạn cần biết

- Đây là **demo/dự án luyện tập**, không phải sản phẩm giao dịch thực tế — không phải lời khuyên đầu tư.
- VNDirect là API không chính thức; môi trường phát triển của bạn có thể chặn
  domain này (một số mạng công ty/CI chặn theo whitelist) — khi đó server sẽ
  tự rơi về dữ liệu mô phỏng và log lý do ra console.
- Finnhub free tier giới hạn ~60 request/phút; server đã cache 12s/lần gọi để
  nhiều tab/nhiều người xem cùng lúc không vượt hạn mức.
