"use strict";

// Finnhub — API chính thức, có key miễn phí (finnhub.io/register).
// Tài liệu: https://finnhub.io/docs/api/quote
// Free tier trả về giá quote gần-real-time (không có nến lịch sử intraday
// ở free tier từ 2023 trở đi), nên phần "biểu đồ" quốc tế trong app này
// dùng dữ liệu tự tích luỹ theo phiên (xem public/app.js) thay vì gọi thêm
// endpoint lịch sử.

const BASE = "https://finnhub.io/api/v1";

async function fetchQuote(symbol, apiKey) {
  const url = BASE + "/quote?symbol=" + encodeURIComponent(symbol) + "&token=" + apiKey;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error("Finnhub trả về HTTP " + res.status + " cho " + symbol);
  }
  const q = await res.json();
  if (q && q.c === 0 && q.h === 0 && q.l === 0 && q.pc === 0) {
    // Finnhub trả toàn 0 khi mã không hợp lệ hoặc key hết quyền truy cập mã đó.
    throw new Error("Finnhub không có dữ liệu cho " + symbol);
  }
  return {
    price: q.c,
    open: q.o,
    high: q.h,
    low: q.l,
    prevClose: q.pc,
    change: q.d,
    changePercent: q.dp,
    updatedAt: q.t ? q.t * 1000 : Date.now()
  };
}

async function fetchQuotes(symbols, apiKey) {
  return Promise.all(symbols.map(function (s) { return fetchQuote(s, apiKey); }));
}

module.exports = { fetchQuote, fetchQuotes };
