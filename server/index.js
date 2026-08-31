"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const finnhub = require("./providers/finnhub");
const vndirect = require("./providers/vndirect");
const { simulateQuote, simulateHistory } = require("./providers/simulate");

const app = express();
app.use(cors());

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "";
const MOCK_UPSTREAM = process.env.MOCK_UPSTREAM === "1";

// Danh sách mã cố định cho bản demo này. `base` chỉ dùng làm mỏ neo cho dữ
// liệu mô phỏng dự phòng khi API thật không khả dụng.
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

// Cache bộ nhớ đơn giản dùng chung cho mọi client — vừa giảm tải API thật
// (tránh vỡ giới hạn free-tier khi nhiều tab cùng mở), vừa giúp các lần
// poll gần nhau trả về nhất quán.
const cache = new Map();
async function cached(key, ttlMs, compute) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await compute();
  cache.set(key, { at: Date.now(), value });
  return value;
}

app.get("/api/international/quotes", async (req, res) => {
  try {
    const result = await cached("intl-quotes", 12000, async () => {
      if (MOCK_UPSTREAM) {
        return {
          source: "mock",
          items: INTL_SYMBOLS.map((t) => Object.assign({ symbol: t.symbol, name: t.name }, simulateQuote(t.symbol, t.base)))
        };
      }
      if (!FINNHUB_API_KEY) {
        return {
          source: "fallback",
          reason: "Thiếu FINNHUB_API_KEY trên server — xem file .env.example.",
          items: INTL_SYMBOLS.map((t) => Object.assign({ symbol: t.symbol, name: t.name }, simulateQuote(t.symbol, t.base)))
        };
      }
      try {
        const quotes = await finnhub.fetchQuotes(INTL_SYMBOLS.map((t) => t.symbol), FINNHUB_API_KEY);
        return {
          source: "live",
          items: INTL_SYMBOLS.map((t, i) => Object.assign({ symbol: t.symbol, name: t.name }, quotes[i]))
        };
      } catch (err) {
        return {
          source: "fallback",
          reason: err.message,
          items: INTL_SYMBOLS.map((t) => Object.assign({ symbol: t.symbol, name: t.name }, simulateQuote(t.symbol, t.base)))
        };
      }
    });
    res.json(Object.assign({ market: "international", updatedAt: Date.now() }, result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
        const quotes = await vndirect.fetchLatestPrices(VN_SYMBOLS.map((t) => t.symbol));
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
        const points = await vndirect.fetchHistory(symbol, days);
        if (!points.length) throw new Error("VNDirect không trả về dữ liệu lịch sử");
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Marketscope server: http://localhost:" + PORT);
  if (!FINNHUB_API_KEY && !MOCK_UPSTREAM) {
    console.log("⚠️  Chưa cấu hình FINNHUB_API_KEY — phần Quốc tế sẽ chạy ở chế độ dữ liệu mô phỏng.");
  }
});
