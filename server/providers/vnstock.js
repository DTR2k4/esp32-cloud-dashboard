"use strict";

// Dùng gói "vn-stock-sdk" (npm, MIT) thay vì tự gọi thẳng 1 endpoint VNDirect.
// SDK này tự xoay vòng nhiều nguồn (TCBS/DNSE/SSI) và tự retry — bền hơn hẳn
// so với việc tự tay bám vào 1 API không chính thức duy nhất. Không cần key.
// https://github.com/dotranminhchu/vn-stock-sdk
//
// LƯU Ý quan trọng: SDK này khi lỗi upstream sẽ trả về mảng RỖNG thay vì ném
// exception — nên các hàm dưới đây tự kiểm tra rỗng và throw hộ, để cơ chế
// fallback ở server/index.js hoạt động đúng như với các provider khác.

const { VnStockClient, Interval } = require("vn-stock-sdk");

const client = new VnStockClient({ timeout: 8000, retries: 2 });

async function fetchLatestPrices(symbols) {
  const board = await client.trading().priceBoard(symbols);
  if (!board || !board.length) {
    throw new Error("vn-stock-sdk: bảng giá rỗng — có thể mọi nguồn (TCBS/DNSE/SSI) đang lỗi hoặc ngoài giờ giao dịch.");
  }
  const bySymbol = new Map(board.map(function (b) { return [b.symbol, b]; }));
  return symbols.map(function (sym) {
    const b = bySymbol.get(sym);
    if (!b) throw new Error("Không có dữ liệu bảng giá cho " + sym);
    // Trước/ngoài giờ giao dịch matchPrice có thể = 0 (chưa có lệnh khớp) — khi
    // đó hiển thị giá tham chiếu để không lòi ra "0đ" trên UI.
    const price = b.matchPrice || b.referencePrice;
    return {
      symbol: sym,
      price: price,
      prevClose: b.referencePrice,
      ceiling: b.ceilingPrice,
      floor: b.floorPrice,
      high: b.highPrice || price,
      low: b.lowPrice || price,
      change: b.priceChange,
      changePercent: b.priceChangePercent,
      updatedAt: Date.now()
    };
  });
}

async function fetchHistory(symbol, days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const fmt = function (d) { return d.toISOString().slice(0, 10); };
  const candles = await client.quote(symbol).history({
    start: fmt(from),
    end: fmt(to),
    interval: Interval.D1
  });
  if (!candles || !candles.length) {
    throw new Error("vn-stock-sdk: không có dữ liệu lịch sử cho " + symbol);
  }
  return candles
    .slice()
    .sort(function (a, b) { return new Date(a.date) - new Date(b.date); })
    .map(function (c) { return { date: c.date, close: c.close }; });
}

module.exports = { fetchLatestPrices, fetchHistory };
