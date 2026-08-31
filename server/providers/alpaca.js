"use strict";

// Alpaca Markets — Market Data API, free "Basic" plan (tài khoản paper, không
// cần nạp tiền, mở được từ hầu hết các nước — chỉ cần Mỹ/thường trú nhân Mỹ
// khi muốn giao dịch thật, còn lấy dữ liệu thì không).
// Tài liệu: https://docs.alpaca.markets/docs/real-time-stock-pricing-data
//
// Feed IEX là feed real-time duy nhất có ở free tier (feed SIP "đầy đủ mọi
// sàn" chỉ có ở plan trả phí) — IEX là 1 sàn thật ở Mỹ, đủ để có giá gần sát
// giá thị trường cho các mã vốn hoá lớn (AAPL, MSFT, ...) dùng trong app này.

const BASE = "https://data.alpaca.markets/v2";

function authHeaders(keyId, secretKey) {
  return {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secretKey
  };
}

async function fetchSnapshots(symbols, keyId, secretKey) {
  const url = BASE + "/stocks/snapshots?symbols=" + symbols.map(encodeURIComponent).join(",") + "&feed=iex";
  const res = await fetch(url, { headers: authHeaders(keyId, secretKey), signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error("Alpaca trả về HTTP " + res.status + " (kiểm tra ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY trong .env)");
  }
  const data = await res.json();
  return symbols.map(function (symbol) {
    const snap = data[symbol];
    if (!snap || !snap.dailyBar || !snap.prevDailyBar) {
      throw new Error("Alpaca không có snapshot cho " + symbol);
    }
    const price = snap.latestTrade ? snap.latestTrade.p : snap.dailyBar.c;
    const prevClose = snap.prevDailyBar.c;
    return {
      price: price,
      open: snap.dailyBar.o,
      high: snap.dailyBar.h,
      low: snap.dailyBar.l,
      prevClose: prevClose,
      change: price - prevClose,
      changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
      updatedAt: snap.latestTrade ? Date.parse(snap.latestTrade.t) : Date.now()
    };
  });
}

module.exports = { fetchSnapshots };
