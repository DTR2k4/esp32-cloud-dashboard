"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

const alpaca = require("./providers/alpaca");
const { createAlpacaStream } = require("./providers/alpaca-ws");
const vnstock = require("./providers/vnstock");
const { simulateQuote, simulateHistory } = require("./providers/simulate");

const app = express();
app.use(cors());

const ALPACA_KEY_ID = process.env.ALPACA_API_KEY_ID || "";
const ALPACA_SECRET_KEY = process.env.ALPACA_API_SECRET_KEY || "";
const ALPACA_CONFIGURED = !!(ALPACA_KEY_ID && ALPACA_SECRET_KEY);
const MOCK_UPSTREAM = process.env.MOCK_UPSTREAM === "1";

const INTL_SYMBOLS = [
  { symbol: "AAPL", name: "Apple Inc.", base: 227 },
  { symbol: "MSFT", name: "Microsoft Corp.", base: 415 },
  { symbol: "GOOGL", name: "Alphabet Inc.", base: 168 },
  { symbol: "AMZN", name: "Amazon.com Inc.", base: 186 },
  { symbol: "NVDA", name: "NVIDIA Corp.", base: 118 },
  { symbol: "TSLA", name: "Tesla Inc.", base: 248 },
  { symbol: "META", name: "Meta Platforms Inc.", base: 563 },
  { symbol: "NFLX", name: "Netflix Inc.", base: 686 }
];

const VN_SYMBOLS = [
  { symbol: "VNM", name: "Vinamilk", base: 65000 },
  { symbol: "VIC", name: "Vingroup", base: 45000 },
  { symbol: "VHM", name: "Vinhomes", base: 40000 },
  { symbol: "HPG", name: "Hoà Phát", base: 27000 },
  { symbol: "FPT", name: "FPT Corp", base: 135000 },
  { symbol: "MWG", name: "Thế Giới Di Động", base: 62000 },
  { symbol: "VCB", name: "Vietcombank", base: 92000 },
  { symbol: "MSN", name: "Masan Group", base: 70000 }
];

/* =========================================================================
 * MỸ (nhãn cũ "Quốc tế") — Alpaca Markets WebSocket (real-time, feed IEX)
 * với REST làm nền/dự phòng.
 *
 * (Trước dùng Finnhub — free tier của Finnhub bị lỗi 403 rất phổ biến và dai
 * dẳng trên diện rộng, không phải do cấu hình sai riêng của dự án này, nên
 * đổi sang Alpaca. Xem ghi chú trong README.)
 *
 * "Quốc tế" chỉ mang tính lịch sử trong tên biến/route — thực tế API miễn phí
 * nào cũng chỉ có real-time cho cổ phiếu Mỹ (IEX/NYSE/NASDAQ), không có sàn
 * nào khác miễn phí thật sự, nên UI hiển thị là "Thị trường Mỹ" cho đúng.
 *
 * Kiến trúc: server giữ 1 kết nối WS duy nhất tới Alpaca (không phải mỗi
 * client trình duyệt tự mở 1 kết nối riêng — vừa tiết kiệm quota (free tier
 * chỉ cho 1 kết nối đồng thời), vừa để server có chỗ chèn logic fallback).
 * Mỗi tick trade cập nhật `intlState` trong bộ nhớ; state này được:
 *   - đọc trực tiếp bởi GET /api/international/quotes (không gọi upstream)
 *   - đẩy (broadcast, có throttle) tới mọi client đang mở ws://.../ws/international
 * ========================================================================= */

const intlState = new Map(); // symbol -> { name, price, open, high, low, prevClose, change, changePercent, updatedAt }
let intlMode = MOCK_UPSTREAM ? "mock" : ALPACA_CONFIGURED ? "connecting" : "fallback";
let intlReason = (!MOCK_UPSTREAM && !ALPACA_CONFIGURED) ? "Thiếu ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY trên server — xem file .env.example." : undefined;

function seedIntlFallback() {
  INTL_SYMBOLS.forEach(function (t) {
    intlState.set(t.symbol, Object.assign({ symbol: t.symbol, name: t.name }, simulateQuote(t.symbol, t.base)));
  });
}
seedIntlFallback();

async function seedIntlFromRest() {
  try {
    const quotes = await alpaca.fetchSnapshots(INTL_SYMBOLS.map(function (t) { return t.symbol; }), ALPACA_KEY_ID, ALPACA_SECRET_KEY);
    INTL_SYMBOLS.forEach(function (t, i) {
      intlState.set(t.symbol, Object.assign({ symbol: t.symbol, name: t.name }, quotes[i]));
    });
    intlReason = undefined;
    return true;
  } catch (err) {
    intlReason = err.message;
    return false;
  }
}

function buildIntlSnapshot() {
  return {
    market: "international",
    source: intlMode === "connecting" ? "fallback" : intlMode,
    reason: intlReason,
    updatedAt: Date.now(),
    items: INTL_SYMBOLS.map(function (t) { return intlState.get(t.symbol); })
  };
}

let intlBroadcastTimer = null;
function scheduleIntlBroadcast() {
  if (intlBroadcastTimer) return; // throttle: gộp nhiều tick liên tiếp thành 1 lần gửi
  intlBroadcastTimer = setTimeout(function () {
    intlBroadcastTimer = null;
    const payload = JSON.stringify(buildIntlSnapshot());
    intlWsClients.forEach(function (client) {
      if (client.readyState === 1) client.send(payload);
    });
  }, 400);
}

if (MOCK_UPSTREAM) {
  // Không đụng mạng ngoài — chỉ đổi số mô phỏng định kỳ để "sống động".
  setInterval(function () { seedIntlFallback(); scheduleIntlBroadcast(); }, 5000);
} else if (ALPACA_CONFIGURED) {
  seedIntlFromRest().then(function () {
    createAlpacaStream({
      keyId: ALPACA_KEY_ID,
      secretKey: ALPACA_SECRET_KEY,
      symbols: INTL_SYMBOLS.map(function (t) { return t.symbol; }),
      onStatus: function (status) {
        if (status === "open") { intlMode = "live"; console.log("✅ Alpaca WebSocket: đã kết nối, nhận trade real-time (feed IEX)."); }
        else if (status === "connecting") intlMode = "connecting";
        else if (status === "closed") {
          intlMode = "fallback";
          intlReason = "Mất kết nối WebSocket tới Alpaca, đang thử kết nối lại…";
          console.log("⚠️  Alpaca WebSocket đóng — sẽ tự kết nối lại.");
        } else if (status.indexOf("error:") === 0) {
          intlMode = "fallback";
          intlReason = "Alpaca WebSocket lỗi xác thực: " + status.slice(6) + " (kiểm tra lại ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY)";
          console.log("⚠️  " + intlReason);
        }
      },
      onTrade: function (symbol, price, ts) {
        const cur = intlState.get(symbol);
        if (!cur) return;
        const prevClose = cur.prevClose;
        cur.price = price;
        cur.high = Math.max(cur.high, price);
        cur.low = Math.min(cur.low, price);
        cur.change = prevClose ? price - prevClose : 0;
        cur.changePercent = prevClose ? (cur.change / prevClose) * 100 : 0;
        cur.updatedAt = ts || Date.now();
        scheduleIntlBroadcast();
      }
    });
  });
  // WS đôi khi im lặng ngoài giờ giao dịch Mỹ (không có trade trên IEX) — REST
  // polling nhẹ mỗi 60s để prevClose/open không bị "đứng hình" qua nhiều ngày
  // liền và để badge có gì đó mới ngay cả lúc thị trường đóng cửa.
  setInterval(function () {
    if (intlMode !== "live") seedIntlFromRest().then(scheduleIntlBroadcast);
  }, 60000);
} else {
  // Thiếu key: refresh dữ liệu mô phỏng định kỳ như trên.
  setInterval(function () { seedIntlFallback(); scheduleIntlBroadcast(); }, 5000);
}

/* =========================================================================
 * VIỆT NAM — vn-stock-sdk (đa nguồn TCBS/DNSE/SSI, tự retry), vẫn REST polling
 * vì SDK không có kênh push. Giữ nguyên cơ chế cache + fallback như trước.
 * ========================================================================= */

const cache = new Map();
async function cached(key, ttlMs, compute) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await compute();
  cache.set(key, { at: Date.now(), value: value });
  return value;
}

app.get("/api/international/quotes", function (req, res) {
  res.json(buildIntlSnapshot());
});

app.get("/api/vietnam/quotes", async (req, res) => {
  try {
    const result = await cached("vn-quotes", 15000, async () => {
      if (MOCK_UPSTREAM) {
        return {
          source: "mock",
          items: VN_SYMBOLS.map((t) => Object.assign({ symbol: t.symbol, name: t.name }, simulateQuote(t.symbol, t.base)))
        };
      }
      try {
        const quotes = await vnstock.fetchLatestPrices(VN_SYMBOLS.map((t) => t.symbol));
        const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
        return {
          source: "live",
          items: VN_SYMBOLS.map((t) => Object.assign({ symbol: t.symbol, name: t.name }, bySymbol.get(t.symbol)))
        };
      } catch (err) {
        return {
          source: "fallback",
          reason: err.message,
          items: VN_SYMBOLS.map((t) => Object.assign({ symbol: t.symbol, name: t.name }, simulateQuote(t.symbol, t.base)))
        };
      }
    });
    res.json(Object.assign({ market: "vietnam", updatedAt: Date.now() }, result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/vietnam/history", async (req, res) => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  const meta = VN_SYMBOLS.find((t) => t.symbol === symbol);
  if (!meta) return res.status(404).json({ error: "Mã không hợp lệ: " + symbol });
  const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 90));

  try {
    const result = await cached("vn-hist-" + symbol + "-" + days, 5 * 60 * 1000, async () => {
      if (MOCK_UPSTREAM) {
        return { source: "mock", points: simulateHistory(symbol, meta.base, days) };
      }
      try {
        const points = await vnstock.fetchHistory(symbol, days);
        return { source: "live", points: points };
      } catch (err) {
        return { source: "fallback", reason: err.message, points: simulateHistory(symbol, meta.base, days) };
      }
    });
    res.json(Object.assign({ symbol: symbol }, result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);

/* WebSocket cho khu vực Mỹ: mỗi client trình duyệt subscribe ở đây thay vì tự
 * bắn request Alpaca riêng — server đứng giữa giữ 1 kết nối upstream. */
const intlWsClients = new Set();
const wss = new WebSocketServer({ server: server, path: "/ws/international" });
wss.on("connection", function (ws) {
  intlWsClients.add(ws);
  ws.send(JSON.stringify(buildIntlSnapshot())); // gửi ngay snapshot hiện có, không phải chờ tick tiếp theo
  ws.on("close", function () { intlWsClients.delete(ws); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Marketscope server: http://localhost:" + PORT);
  if (!ALPACA_CONFIGURED && !MOCK_UPSTREAM) {
    console.log("⚠️  Chưa cấu hình ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY — phần thị trường Mỹ sẽ chạy ở chế độ dữ liệu mô phỏng.");
  }
});
