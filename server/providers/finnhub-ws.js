"use strict";

// Kết nối WebSocket real-time của Finnhub (free tier có sẵn, không cần plan trả phí):
// wss://ws.finnhub.io — server đẩy tick giao dịch (trade) ngay khi có khớp lệnh,
// thay vì mình phải poll REST /quote định kỳ. Tài liệu: https://finnhub.io/docs/api/websocket-trades
//
// Module này chỉ lo phần "lấy dữ liệu" — không biết gì về HTTP/Express. Gọi
// onTrade(symbol, price, timestampMs) mỗi khi có tick mới; gọi onStatus(status)
// khi trạng thái kết nối đổi ("connecting" | "open" | "closed").

const WebSocket = require("ws");

function createFinnhubStream(opts) {
  const apiKey = opts.apiKey;
  const symbols = opts.symbols;
  const onTrade = opts.onTrade || function () {};
  const onStatus = opts.onStatus || function () {};

  let ws = null;
  let closedByUser = false;
  let reconnectDelay = 2000;
  const MAX_RECONNECT_DELAY = 30000;

  function connect() {
    if (closedByUser) return;
    onStatus("connecting");
    ws = new WebSocket("wss://ws.finnhub.io?token=" + apiKey);

    ws.on("open", function () {
      reconnectDelay = 2000;
      onStatus("open");
      symbols.forEach(function (s) {
        ws.send(JSON.stringify({ type: "subscribe", symbol: s }));
      });
    });

    ws.on("message", function (raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (msg.type === "trade" && Array.isArray(msg.data)) {
        msg.data.forEach(function (t) {
          // t = { s: symbol, p: price, t: timestamp(ms), v: volume }
          onTrade(t.s, t.p, t.t);
        });
      }
      // msg.type === "ping" hoặc lỗi ("type":"error") — bỏ qua, không cần xử lý riêng.
    });

    ws.on("close", scheduleReconnect);
    ws.on("error", function () {
      // "close" sẽ tự bắn sau "error" — không schedule 2 lần ở đây.
    });
  }

  function scheduleReconnect() {
    onStatus("closed");
    if (closedByUser) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, MAX_RECONNECT_DELAY);
  }

  connect();

  return {
    close: function () {
      closedByUser = true;
      if (ws) ws.close();
    }
  };
}

module.exports = { createFinnhubStream };
