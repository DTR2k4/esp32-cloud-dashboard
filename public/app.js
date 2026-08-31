(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  /* ---------------- shared formatting helpers ---------------- */
  function fmtUSD(n) { return n == null || isNaN(n) ? "—" : "$" + Number(n).toFixed(2); }
  function fmtVND(n) { return n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("vi-VN") + "₫"; }
  function fmtPct(p) { return p == null || isNaN(p) ? "—" : (p >= 0 ? "+" : "") + p.toFixed(2) + "%"; }
  function arrowSvg(up) {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      (up ? '<path d="M12 4l7 10H5z"/>' : '<path d="M12 20L5 10h14z"/>') + "</svg>";
  }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  function fmtClock(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function fmtTimeShort(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  /* ---------------- generic sparkline / line-chart path builder ---------------- */
  function sparkPath(values, w, h) {
    if (values.length < 2) return "";
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var range = (max - min) || 1;
    var step = w / (values.length - 1);
    return values.map(function (v, i) {
      var x = i * step;
      var y = h - ((v - min) / range) * (h - 4) - 2;
      return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
  }

  /* ---------------- MarketPanel: one self-contained market section ---------------- */
  function MarketPanel(opts) {
    this.key = opts.key;
    this.rootId = opts.rootId;
    this.title = opts.title;
    this.icon = opts.icon;
    this.quotesUrl = opts.quotesUrl;
    this.pollMs = opts.pollMs;
    this.priceFmt = opts.priceFmt;
    this.hasHistory = !!opts.historyUrl;
    this.historyUrl = opts.historyUrl; // function(symbol, days) -> url
    this.rangeOptions = opts.rangeOptions || null; // [{key,label,days}]
    this.liveLabel = opts.liveLabel;
    this.wsUrl = opts.wsUrl || null;
    this.statsFields = opts.statsFields || function (item, priceFmt) {
      return [
        ["Mở cửa", priceFmt(item.open)],
        ["Cao nhất", priceFmt(item.high)],
        ["Thấp nhất", priceFmt(item.low)],
        ["Tham chiếu", priceFmt(item.prevClose)]
      ];
    };

    this.root = document.getElementById(this.rootId);
    this.items = [];
    this.selected = null;
    this.filter = "";
    this.range = this.rangeOptions ? this.rangeOptions[0] : null;
    this.sessionHistory = new Map(); // symbol -> [{t,price}]  (used when !hasHistory)
    this.historyCache = new Map();   // "SYM:days" -> {at, points} (used when hasHistory)

    this._buildSkeleton();
    this._wireStatic();
    var self = this;

    if (this.wsUrl) {
      this.refresh(); // sơn dữ liệu ngay trong lúc chờ WebSocket bắt tay
      this._connectWs();
    } else {
      this.refresh();
      if (!this.hasHistory) {
        // Vẽ biểu đồ phiên trực tiếp cần ít nhất 2 điểm — poll thêm một lần
        // sớm để không bắt người dùng chờ hết cả pollMs mới thấy đường biểu đồ.
        setTimeout(function () { self.refresh(); }, 3000);
      }
      setInterval(function () { self.refresh(); }, this.pollMs);
    }
    window.addEventListener("resize", debounce(function () { self._drawChart(); }, 120));
  }

  MarketPanel.prototype._buildSkeleton = function () {
    var tpl = document.getElementById("market-panel-template");
    var node = tpl.content.cloneNode(true);
    this.root.appendChild(node);
    var self = this;
    function el(name) { return self.root.querySelector('[data-el="' + name + '"]'); }
    this.root.querySelector(".m-icon").textContent = this.icon;
    this.root.querySelector(".m-title").textContent = this.title;
    this.els = {
      sourceBadge: el("sourceBadge"),
      lastUpdated: el("lastUpdated"),
      searchInput: el("searchInput"),
      wlList: el("wlList"),
      stockName: el("stockName"),
      stockSub: el("stockSub"),
      stockPrice: el("stockPrice"),
      stockChg: el("stockChg"),
      rangeChips: el("rangeChips"),
      statsRow: el("statsRow"),
      chartSvg: el("chartSvg"),
      chartWrap: this.root.querySelector(".chart-wrap"),
      chartTooltip: el("chartTooltip"),
      rawTableBody: el("rawTableBody"),
      gainersBody: el("gainersBody"),
      losersBody: el("losersBody")
    };
  };

  MarketPanel.prototype._wireStatic = function () {
    var self = this;
    this.els.searchInput.addEventListener("input", function (e) {
      self.filter = e.target.value.trim();
      self._renderWatchlist();
    });

    if (this.rangeOptions) {
      this.els.rangeChips.innerHTML = this.rangeOptions.map(function (r) {
        return '<button class="chip" data-range="' + r.key + '">' + r.label + "</button>";
      }).join("");
      Array.prototype.forEach.call(this.els.rangeChips.children, function (btn) {
        btn.addEventListener("click", function () {
          self.range = self.rangeOptions.filter(function (r) { return r.key === btn.dataset.range; })[0];
          self._updateRangeChips();
          self._loadHistoryAndDraw(true);
        });
      });
      this._updateRangeChips();
    } else {
      this.els.rangeChips.innerHTML = '<span class="chip static">' + (this.liveLabel || "Phiên trực tiếp") + "</span>";
    }
  };

  MarketPanel.prototype._updateRangeChips = function () {
    if (!this.rangeOptions) return;
    var self = this;
    Array.prototype.forEach.call(this.els.rangeChips.children, function (btn) {
      btn.classList.toggle("active", btn.dataset.range === self.range.key);
    });
  };

  /* ---------------- data fetch (REST) ---------------- */
  MarketPanel.prototype.refresh = function () {
    var self = this;
    fetch(this.quotesUrl).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) throw new Error(data.error);
      self._applyQuotesData(data);
    }).catch(function (err) {
      self._renderBadge({ source: "error", reason: err.message });
    });
  };

  /* ---------------- data push (WebSocket) ---------------- */
  MarketPanel.prototype._connectWs = function () {
    var self = this;
    var url = this.wsUrl;
    var socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      // Trình duyệt/mạng không cho mở WebSocket — không có REST poll dự phòng
      // cho khu vực này nên chỉ báo lỗi, dữ liệu ban đầu từ refresh() vẫn đứng yên.
      self._renderBadge({ source: "error", reason: "Không mở được WebSocket: " + e.message });
      return;
    }
    socket.addEventListener("message", function (evt) {
      var data;
      try { data = JSON.parse(evt.data); } catch (e) { return; }
      if (data.error) return;
      self._applyQuotesData(data);
    });
    socket.addEventListener("close", function () {
      self._renderBadge({ source: "fallback", reason: "Mất kết nối WebSocket, đang thử kết nối lại…" });
      setTimeout(function () { self._connectWs(); }, 3000);
    });
    socket.addEventListener("error", function () {
      socket.close();
    });
  };

  /* ---------------- áp dụng dữ liệu quote mới (dùng chung cho REST & WS) ---------------- */
  MarketPanel.prototype._applyQuotesData = function (data) {
    var self = this;
    self.items = data.items || [];
    self.source = data.source;
    self.reason = data.reason;
    self.updatedAt = data.updatedAt;

    if (!self.selected && self.items.length) self.selected = self.items[0].symbol;

    if (!self.hasHistory) {
      var now = Date.now();
      self.items.forEach(function (item) {
        var arr = self.sessionHistory.get(item.symbol) || [];
        arr.push({ t: now, price: item.price });
        if (arr.length > 200) arr.shift();
        self.sessionHistory.set(item.symbol, arr);
      });
    }

    self._renderBadge();
    self._renderWatchlist();
    self._renderDetailHead();
    self._renderMovers();

    if (self.hasHistory) {
      self._loadHistoryAndDraw(false);
    } else {
      self._drawChart();
    }
  };

  MarketPanel.prototype._loadHistoryAndDraw = function (force) {
    var self = this;
    if (!this.selected || !this.range) return;
    var cacheKey = this.selected + ":" + this.range.days;
    var hit = this.historyCache.get(cacheKey);
    var ttl = 5 * 60 * 1000;
    if (!force && hit && Date.now() - hit.at < ttl) {
      this._drawChart(hit.points, hit.source);
      return;
    }
    fetch(this.historyUrl(this.selected, this.range.days)).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) throw new Error(data.error);
      self.historyCache.set(cacheKey, { at: Date.now(), points: data.points, source: data.source });
      self._drawChart(data.points, data.source);
    }).catch(function () {
      self._drawChart([]);
    });
  };

  /* ---------------- rendering: badge ---------------- */
  MarketPanel.prototype._renderBadge = function (override) {
    var source = (override && override.source) || this.source;
    var reason = (override && override.reason) || this.reason;
    var cls = "source-badge " + (source === "live" ? "live" : source === "mock" ? "mock" : "fallback");
    var label =
      source === "live" ? "● Dữ liệu trực tiếp" :
      source === "mock" ? "● Chế độ mock (dev)" :
      source === "error" ? "● Không kết nối được server" :
      "● Dữ liệu mô phỏng (dự phòng)";
    this.els.sourceBadge.className = cls;
    this.els.sourceBadge.innerHTML = '<span class="sb-dot"></span>' + label;
    this.els.sourceBadge.title = reason || "";
    this.els.lastUpdated.textContent = this.updatedAt ? "cập nhật " + fmtTimeShort(this.updatedAt) : "";
  };

  /* ---------------- rendering: watchlist ---------------- */
  MarketPanel.prototype._renderWatchlist = function () {
    var self = this;
    var list = this.items.filter(function (t) {
      if (!self.filter) return true;
      var q = self.filter.toLowerCase();
      return t.symbol.toLowerCase().indexOf(q) > -1 || (t.name || "").toLowerCase().indexOf(q) > -1;
    });
    if (!list.length) {
      this.els.wlList.innerHTML = '<div class="no-results">Không tìm thấy mã phù hợp.</div>';
      return;
    }
    this.els.wlList.innerHTML = list.map(function (t) {
      var up = t.changePercent >= 0;
      var hist = self.sessionHistory.get(t.symbol);
      var sparkValues = hist ? hist.map(function (p) { return p.price; }).slice(-20) : [t.price, t.price];
      return '<button type="button" class="wl-item" role="option" aria-pressed="' + (t.symbol === self.selected) + '" data-symbol="' + t.symbol + '">' +
        '<span class="wl-id"><span class="wl-symbol">' + t.symbol + '</span><span class="wl-name">' + (t.name || "") + '</span></span>' +
        '<span class="wl-price"><span class="wl-p num">' + self.priceFmt(t.price) + '</span>' +
        '<span class="wl-chg num ' + (up ? "up-color" : "down-color") + '">' + arrowSvg(up) + fmtPct(t.changePercent) + '</span></span>' +
        '</button>';
    }).join("");
    Array.prototype.forEach.call(this.els.wlList.children, function (btn) {
      btn.addEventListener("click", function () {
        self.selected = btn.dataset.symbol;
        self._renderWatchlist();
        self._renderDetailHead();
        if (self.hasHistory) self._loadHistoryAndDraw(false); else self._drawChart();
      });
    });
  };

  /* ---------------- rendering: detail head + stats ---------------- */
  MarketPanel.prototype._getSelectedItem = function () {
    var self = this;
    return this.items.filter(function (t) { return t.symbol === self.selected; })[0];
  };

  MarketPanel.prototype._renderDetailHead = function () {
    var item = this._getSelectedItem();
    if (!item) return;
    this.els.stockName.textContent = (item.name || item.symbol) + " · " + item.symbol;
    this.els.stockSub.textContent = this.title;
    var prevPrice = this._lastRenderedPrice;
    this.els.stockPrice.textContent = this.priceFmt(item.price);
    var up = item.changePercent >= 0;
    this.els.stockChg.innerHTML = '<span class="chg-badge-inline ' + (up ? "up-color" : "down-color") + '">' +
      arrowSvg(up) + fmtPct(item.changePercent) + " hôm nay</span>";
    if (prevPrice != null && prevPrice !== item.price) {
      this.els.stockPrice.classList.remove("flash-up", "flash-down");
      void this.els.stockPrice.offsetWidth;
      this.els.stockPrice.classList.add(item.price > prevPrice ? "flash-up" : "flash-down");
    }
    this._lastRenderedPrice = item.price;

    this.els.statsRow.innerHTML = this.statsFields(item, this.priceFmt).map(function (pair) {
      return "<span>" + pair[0] + ' <b class="num">' + pair[1] + "</b></span>";
    }).join("");
  };

  /* ---------------- rendering: movers ---------------- */
  MarketPanel.prototype._renderMovers = function () {
    var self = this;
    var sorted = this.items.slice().sort(function (a, b) { return b.changePercent - a.changePercent; });
    var gainers = sorted.slice(0, 5);
    var losers = sorted.slice(-5).reverse();
    function rowHtml(item) {
      var up = item.changePercent >= 0;
      return "<tr><td><span class=\"sym-cell\"><span class=\"n\">" + item.symbol + "</span><span class=\"s\">" + (item.name || "") + "</span></span></td>" +
        '<td class="num">' + self.priceFmt(item.price) + "</td>" +
        '<td class="num ' + (up ? "up-color" : "down-color") + '">' + fmtPct(item.changePercent) + "</td></tr>";
    }
    this.els.gainersBody.innerHTML = gainers.map(rowHtml).join("");
    this.els.losersBody.innerHTML = losers.map(rowHtml).join("");
  };

  /* ---------------- rendering: chart ---------------- */
  MarketPanel.prototype._drawChart = function (externalPoints, pointsSource) {
    var self = this;
    var svg = this.els.chartSvg;
    var wrap = this.els.chartWrap;
    var tooltip = this.els.chartTooltip;
    var w = wrap.clientWidth || 600, h = 260;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = "";
    tooltip.style.opacity = 0;

    var values, labelFn;
    if (this.hasHistory) {
      var points = externalPoints || [];
      values = points.map(function (p) { return p.close; });
      labelFn = function (i) { return points[i] ? points[i].date : ""; };
    } else {
      var hist = this.sessionHistory.get(this.selected) || [];
      values = hist.map(function (p) { return p.price; });
      labelFn = function (i) { return hist[i] ? fmtTimeShort(hist[i].t) : ""; };
    }

    this._renderRawTable(values, labelFn);

    if (values.length < 2) {
      var msg = document.createElementNS(NS, "text");
      msg.setAttribute("x", w / 2); msg.setAttribute("y", h / 2);
      msg.setAttribute("class", "chart-empty");
      msg.textContent = this.hasHistory ? "Không có dữ liệu lịch sử để vẽ biểu đồ." : "Đang thu thập dữ liệu trực tiếp…";
      svg.appendChild(msg);
      return;
    }

    var pad = { top: 14, right: 8, bottom: 22, left: 8 };
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = (max - min) || max * 0.02 || 1;
    min -= span * 0.08; max += span * 0.08; span = max - min;
    var innerW = w - pad.left - pad.right, innerH = h - pad.top - pad.bottom;
    function X(i) { return pad.left + (i / (values.length - 1)) * innerW; }
    function Y(v) { return pad.top + innerH - ((v - min) / span) * innerH; }

    var up = values[values.length - 1] >= values[0];
    var color = up ? "var(--up)" : "var(--down)";

    var steps = 4;
    for (var g = 0; g <= steps; g++) {
      var gv = min + (span * g / steps);
      var gy = Y(gv);
      var line = document.createElementNS(NS, "line");
      line.setAttribute("x1", pad.left); line.setAttribute("x2", w - pad.right);
      line.setAttribute("y1", gy); line.setAttribute("y2", gy);
      line.setAttribute("class", "grid-line");
      svg.appendChild(line);
      var lbl = document.createElementNS(NS, "text");
      lbl.setAttribute("x", w - pad.right); lbl.setAttribute("y", gy - 4);
      lbl.setAttribute("text-anchor", "end"); lbl.setAttribute("class", "axis-label");
      lbl.textContent = this.priceFmt(gv);
      svg.appendChild(lbl);
    }

    var labelEvery = Math.max(1, Math.round(values.length / 5));
    for (var i = 0; i < values.length; i += labelEvery) {
      var xl = document.createElementNS(NS, "text");
      xl.setAttribute("x", X(i)); xl.setAttribute("y", h - 6);
      xl.setAttribute("text-anchor", i === 0 ? "start" : "middle");
      xl.setAttribute("class", "axis-label");
      xl.textContent = labelFn(i);
      svg.appendChild(xl);
    }

    var d = values.map(function (v, i) { return (i === 0 ? "M" : "L") + X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join(" ");
    var areaD = d + " L" + X(values.length - 1).toFixed(1) + "," + (h - pad.bottom) + " L" + X(0).toFixed(1) + "," + (h - pad.bottom) + " Z";

    var area = document.createElementNS(NS, "path");
    area.setAttribute("d", areaD); area.setAttribute("class", "area-path"); area.setAttribute("fill", color);
    svg.appendChild(area);

    var linePath = document.createElementNS(NS, "path");
    linePath.setAttribute("d", d); linePath.setAttribute("class", "price-path"); linePath.setAttribute("stroke", color);
    svg.appendChild(linePath);

    var lastX = X(values.length - 1), lastY = Y(values[values.length - 1]);
    var ring = document.createElementNS(NS, "circle");
    ring.setAttribute("cx", lastX); ring.setAttribute("cy", lastY); ring.setAttribute("r", 4);
    ring.setAttribute("class", "end-dot-ring"); ring.setAttribute("fill", color);
    svg.appendChild(ring);
    var dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", lastX); dot.setAttribute("cy", lastY); dot.setAttribute("r", 4);
    dot.setAttribute("fill", color); dot.setAttribute("stroke", "var(--surface)"); dot.setAttribute("stroke-width", "2");
    svg.appendChild(dot);

    var chLine = document.createElementNS(NS, "line");
    chLine.setAttribute("class", "crosshair-line");
    chLine.setAttribute("y1", pad.top); chLine.setAttribute("y2", h - pad.bottom);
    svg.appendChild(chLine);
    var chDot = document.createElementNS(NS, "circle");
    chDot.setAttribute("class", "crosshair-dot"); chDot.setAttribute("r", 5);
    chDot.setAttribute("fill", color); chDot.setAttribute("stroke", "var(--surface)"); chDot.setAttribute("stroke-width", "2");
    svg.appendChild(chDot);

    var hitRect = document.createElementNS(NS, "rect");
    hitRect.setAttribute("x", pad.left); hitRect.setAttribute("y", pad.top);
    hitRect.setAttribute("width", innerW); hitRect.setAttribute("height", innerH);
    hitRect.setAttribute("fill", "transparent");
    svg.appendChild(hitRect);

    function onMove(evt) {
      var rect = svg.getBoundingClientRect();
      var mx = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
      mx *= w / rect.width;
      var idx = Math.round(((mx - pad.left) / innerW) * (values.length - 1));
      idx = Math.max(0, Math.min(values.length - 1, idx));
      var vx = X(idx), vy = Y(values[idx]);
      chLine.setAttribute("x1", vx); chLine.setAttribute("x2", vx); chLine.style.opacity = 1;
      chDot.setAttribute("cx", vx); chDot.setAttribute("cy", vy); chDot.style.opacity = 1;
      var tRect = wrap.getBoundingClientRect();
      tooltip.style.left = ((vx / w) * tRect.width) + "px";
      tooltip.style.top = ((vy / h) * tRect.height) + "px";
      tooltip.textContent = labelFn(idx) + "  ·  " + self.priceFmt(values[idx]);
      tooltip.style.opacity = 1;
    }
    function onLeave() { chLine.style.opacity = 0; chDot.style.opacity = 0; tooltip.style.opacity = 0; }
    hitRect.addEventListener("mousemove", onMove);
    hitRect.addEventListener("mouseleave", onLeave);
    hitRect.addEventListener("touchmove", onMove, { passive: true });
    hitRect.addEventListener("touchend", onLeave);
  };

  MarketPanel.prototype._renderRawTable = function (values, labelFn) {
    var self = this;
    this.els.rawTableBody.innerHTML = "";
    if (!values.length) return;
    var step = Math.max(1, Math.floor(values.length / 24));
    values.forEach(function (v, i) {
      if (i % step !== 0 && i !== values.length - 1) return;
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + labelFn(i) + '</td><td class="num">' + self.priceFmt(v) + "</td>";
      self.els.rawTableBody.appendChild(tr);
    });
  };

  /* ---------------- theme ---------------- */
  var themeButtons = document.querySelectorAll(".theme-toggle button");
  function applyTheme(mode) {
    if (mode) {
      document.documentElement.setAttribute("data-theme", mode);
      try { localStorage.setItem("marketscope-theme", mode); } catch (e) {}
    }
    themeButtons.forEach(function (b) { b.classList.toggle("active", b.dataset.themeChoice === mode); });
  }
  themeButtons.forEach(function (b) {
    b.addEventListener("click", function () { applyTheme(b.dataset.themeChoice); });
  });
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("marketscope-theme"); } catch (e) {}
    if (saved) applyTheme(saved);
  })();

  /* ---------------- clock ---------------- */
  var clockEl = document.getElementById("clock");
  function tickClock() { clockEl.textContent = fmtClock(new Date()); }
  tickClock();
  setInterval(tickClock, 1000);

  /* ---------------- bootstrap the two market panels ---------------- */
  var wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";

  new MarketPanel({
    key: "intl",
    rootId: "intl-section",
    title: "Thị trường Mỹ",
    icon: "🇺🇸",
    quotesUrl: "/api/international/quotes",
    wsUrl: wsProtocol + "//" + location.host + "/ws/international",
    priceFmt: fmtUSD,
    liveLabel: "Phiên trực tiếp (WebSocket)"
  });

  new MarketPanel({
    key: "vn",
    rootId: "vn-section",
    title: "Thị trường Việt Nam",
    icon: "🇻🇳",
    quotesUrl: "/api/vietnam/quotes",
    pollMs: 15000,
    priceFmt: fmtVND,
    historyUrl: function (symbol, days) { return "/api/vietnam/history?symbol=" + symbol + "&days=" + days; },
    rangeOptions: [
      { key: "1M", label: "1TH", days: 30 },
      { key: "3M", label: "3TH", days: 90 },
      { key: "6M", label: "6TH", days: 180 }
    ],
    statsFields: function (item, priceFmt) {
      return [
        ["Trần", priceFmt(item.ceiling)],
        ["Sàn", priceFmt(item.floor)],
        ["Cao nhất", priceFmt(item.high)],
        ["Thấp nhất", priceFmt(item.low)],
        ["Tham chiếu", priceFmt(item.prevClose)]
      ];
    }
  });
})();
