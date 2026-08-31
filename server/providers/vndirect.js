"use strict";

// VNDirect "finfo" API — KHÔNG PHẢI API chính thức/công khai tài liệu hoá,
// là endpoint được nhiều dự án mã nguồn mở (vd. vnstock) và bài viết cộng
// đồng dùng lại bằng cách quan sát traffic của trang VNDirect. Vì vậy:
//   - Không cần API key.
//   - Có thể đổi schema hoặc bị chặn bất kỳ lúc nào vì không có SLA/hợp đồng.
//   - Dữ liệu giá thường cập nhật theo phiên/theo ngày, không đảm bảo tick
//     real-time từng giây như một API trả phí chính thức (SSI, DNSE, ...).
// Nếu endpoint này ngừng hoạt động, server sẽ tự rơi về dữ liệu mô phỏng
// (xem server/index.js) thay vì làm sập app — hãy thay hàm bên dưới bằng
// một nguồn dữ liệu VN khác nếu cần độ tin cậy cao hơn.

const BASE = "https://finfo-api.vndirect.com.vn/v4";

function parseRow(row) {
  const price = Number(row.close);
  const prevClose = Number(row.basicPrice != null ? row.basicPrice : row.referencePrice);
  const change = price - prevClose;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  return {
    price: price,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    prevClose: prevClose,
    change: change,
    changePercent: changePercent,
    updatedAt: row.date ? new Date(row.date).getTime() : Date.now()
  };
}

async function fetchLatestPrices(symbols) {
  const codes = symbols.join(",");
  const url = BASE + "/stock_prices?sort=date&q=code:" + encodeURIComponent(codes) + "&size=" + symbols.length;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("VNDirect trả về HTTP " + res.status);
  const json = await res.json();
  const rows = json && json.data ? json.data : [];
  const bySymbol = new Map();
  rows.forEach(function (row) {
    const prev = bySymbol.get(row.code);
    if (!prev || new Date(row.date) > new Date(prev.date)) bySymbol.set(row.code, row);
  });
  return symbols.map(function (sym) {
    const row = bySymbol.get(sym);
    if (!row) throw new Error("Không có dữ liệu VNDirect cho " + sym);
    const parsed = parseRow(row);
    parsed.symbol = sym;
    return parsed;
  });
}

async function fetchHistory(symbol, days) {
  days = days || 90;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const fmt = function (d) { return d.toISOString().slice(0, 10); };
  const url = BASE + "/stock_prices?sort=date&q=code:" + encodeURIComponent(symbol) +
    "~date:gte:" + fmt(from) + "~date:lte:" + fmt(to) + "&size=" + (days + 10);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("VNDirect trả về HTTP " + res.status);
  const json = await res.json();
  const rows = (json && json.data ? json.data : []).slice()
    .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  return rows.map(function (r) { return { date: r.date, close: Number(r.close) }; });
}

module.exports = { fetchLatestPrices, fetchHistory };
