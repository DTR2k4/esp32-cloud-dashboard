"use strict";

// WebSocket real-time của Alpaca (feed IEX, free tier).
// Tài liệu: https://docs.alpaca.markets/docs/streaming-market-data
//
// Khác Finnhub ở chỗ cần bắt tay xác thực bằng message (không phải query
// param trên URL) và phải đợi server xác nhận "authenticated" rồi mới được
// gửi lệnh subscribe — nên có thêm 1 bước chờ so với finnhub-ws.js.

const WebSocket = require("ws");

const WS_URL = "wss://stream.data.alpaca.markets/v2/iex";

function createAlpacaStream(opts) {
  const keyId = opts.keyId;
  const secretKey = opts.secretKey;
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
    ws = new WebSocket(WS_URL);

    ws.on("open", function () {
      ws.send(JSON.stringify({ action: "auth", key: keyId, secret: secretKey }));
    });

    ws.on("message", function (raw) {
      let msgs;
      try { msgs = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!Array.isArray(msgs)) return;

      msgs.forEach(function (msg) {
        if (msg.T === "success" && msg.msg === "authenticated") {
          reconnectDelay = 2000;
          onStatus("open");
          ws.send(JSON.stringify({ action: "subscribe", trades: symbols }));
        } else if (msg.T === "error") {
          // Sai key/secret, hoặc hết quota — msg.msg mô tả lý do cụ thể.
          onStatus("error:" + msg.msg);
        } else if (msg.T === "t") {
          // Trade tick: { T:"t", S: symbol, p: price, t: ISO timestamp, s: size, ... }
          onTrade(msg.S, msg.p, Date.parse(msg.t));
        }
      });
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

module.exports = { createAlpacaStream };
