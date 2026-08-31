"use strict";

// Nguồn dữ liệu dự phòng: khi API thật lỗi, hết quyền truy cập, hoặc chưa
// cấu hình key, server rơi về đây thay vì trả lỗi trắng cho frontend. Mọi
// endpoint luôn gắn cờ `source` để frontend hiển thị rõ đây là dữ liệu mô
// phỏng, không đánh lừa là dữ liệu thị trường thật.

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Cùng seed trong một khung giờ để giá "mô phỏng" ổn định giữa các lần poll
// gần nhau, thay vì nhảy loạn xạ mỗi request.
function simulateQuote(symbol, base) {
  const hourBucket = new Date().toISOString().slice(0, 13);
  const rnd = seededRandom(hashCode(symbol + hourBucket));
  const drift = (rnd() - 0.5) * base * 0.03;
  // Jitter nhỏ đổi mỗi ~5s để "phiên trực tiếp" ở chế độ dự phòng/mock vẫn
  // có chuyển động thấy được giữa các lần poll, thay vì một đường thẳng.
  const jitterBucket = Math.floor(Date.now() / 5000);
  const jitterRnd = seededRandom(hashCode(symbol + ":" + jitterBucket));
  const jitter = (jitterRnd() - 0.5) * base * 0.002;
  const price = base + drift + jitter;
  const prevClose = base;
  const change = price - prevClose;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  return {
    price: price,
    open: prevClose,
    high: price + Math.abs(drift) * 0.6,
    low: price - Math.abs(drift) * 0.6,
    prevClose: prevClose,
    // Biên độ +/-7% mô phỏng theo quy định trần/sàn của HOSE — chỉ khu vực VN
    // dùng 2 field này (xem statsFields trong public/app.js).
    ceiling: prevClose * 1.07,
    floor: prevClose * 0.93,
    change: change,
    changePercent: changePercent,
    updatedAt: Date.now()
  };
}

function simulateHistory(symbol, base, days) {
  const rnd = seededRandom(hashCode(symbol + ":history"));
  const arr = [];
  let p = base * 0.9;
  const start = new Date();
  start.setDate(start.getDate() - days);
  for (let i = 0; i < days; i++) {
    p = Math.max(p + (rnd() - 0.5) * base * 0.02, base * 0.4);
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    arr.push({ date: d.toISOString().slice(0, 10), close: p });
  }
  return arr;
}

module.exports = { simulateQuote, simulateHistory };
