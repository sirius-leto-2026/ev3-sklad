// Интерфейс веб-симулятора склада. Логика - в logic.js (копия robot/sklad.py).
(function () {
  "use strict";
  var S = window.Sklad, CFG = window.EV3_CONFIG, META = window.EV3_CONFIG_META;
  var CELL = 96, PAD = 20, SVGNS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };

  var st = {
    wh: new S.Warehouse(S.LAYOUTS[0]),
    robot: { pos: [0, 0], heading: 0 },
    queue: [], busy: false, log: [], focus: [2, 2],
    lastPaths: null, rng: S.rng(2026), expRows: null
  };

  // ---------------- общие функции рисования ----------------
  function el(tag, attrs, parent, text) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function xy(c) { return [PAD + c[0] * CELL, PAD + (S.H - 1 - c[1]) * CELL]; }
  function center(c) { var p = xy(c); return [p[0] + CELL / 2, p[1] + CELL / 2]; }
  function isObst(c) { return st.wh.obstacles.some(function (o) { return o[0] === c[0] && o[1] === c[1]; }); }
  function isSpecial(c) {
    if (c[0] === 0 && c[1] === 0) return true;
    return S.ZONE_NAMES.some(function (z) { return S.ZONES[z][0] === c[0] && S.ZONES[z][1] === c[1]; });
  }
  function zoneAt(c) {
    for (var i = 0; i < S.ZONE_NAMES.length; i++) {
      var z = S.ZONE_NAMES[i];
      if (S.ZONES[z][0] === c[0] && S.ZONES[z][1] === c[1]) return z;
    }
    return null;
  }

  function drawField(svg, opts) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    el("rect", { x: PAD - 6, y: PAD - 6, width: CELL * 5 + 12, height: CELL * 5 + 12, fill: "#fff", stroke: "#1d2330", "stroke-width": 2, rx: 4 }, svg);
    for (var x = 0; x < S.W; x++) for (var y = 0; y < S.H; y++) {
      var c = [x, y], p = xy(c), obst = isObst(c);
      var g = el("g", { class: "cell", "data-x": x, "data-y": y }, svg);
      if (opts && opts.interactive) {
        g.setAttribute("tabindex", (x === st.focus[0] && y === st.focus[1]) ? "0" : "-1");
        g.setAttribute("role", "button");
        g.setAttribute("aria-label", "Клетка " + x + "," + y + (obst ? ", препятствие" : ""));
      }
      el("rect", { x: p[0], y: p[1], width: CELL, height: CELL, fill: obst ? "#5a6272" : "#fff", stroke: "#1d2330", "stroke-width": 3 }, g);
      el("text", { x: p[0] + 5, y: p[1] + CELL - 6, "font-size": 11, fill: obst ? "#e5e8ee" : "#8a93a3" }, g, x + "," + y);
      if (obst) el("text", { x: p[0] + CELL / 2, y: p[1] + CELL / 2 + 6, "font-size": 16, "text-anchor": "middle", fill: "#fff", "font-weight": 700 }, g, "✕");
    }
    var lp = xy(S.LOAD);
    el("rect", { x: lp[0] + 7, y: lp[1] + 7, width: CELL - 14, height: CELL - 14, fill: "#f2a51f", rx: 5 }, svg);
    el("text", { x: lp[0] + CELL / 2, y: lp[1] + 26, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: "#1d2330" }, svg, "Загрузка");
    S.ZONE_NAMES.forEach(function (z) {
      var p = xy(S.ZONES[z]), n = st.wh.fill[z], full = n >= S.CAPACITY, col = full ? "#b8322a" : "#1c6db3";
      el("rect", { x: p[0] + 7, y: p[1] + 7, width: CELL - 14, height: CELL - 14, fill: "none", stroke: col, "stroke-width": 4, rx: 5 }, svg);
      el("text", { x: p[0] + CELL / 2, y: p[1] + 28, "text-anchor": "middle", "font-size": 14, "font-weight": 700, fill: col }, svg, "Зона " + z);
      if (!opts || !opts.wave) for (var k = 0; k < S.CAPACITY; k++) {
        el("rect", { x: p[0] + 22 + k * 28, y: p[1] + CELL - 34, width: 22, height: 16, fill: k < n ? col : "#fff", stroke: col, "stroke-width": 2, rx: 2 }, svg);
      }
      // стеллаж за краем поля
      var f = S.DIRS[S.ZONE_FACING[z]], cc = center(S.ZONES[z]);
      var rx = cc[0] + f[0] * (CELL / 2 + 2), ry = cc[1] - f[1] * (CELL / 2 + 2);
      el("rect", { x: rx - (f[0] ? 0 : 20) - (f[0] < 0 ? 12 : 0), y: ry - (f[1] ? 12 : 20) + (f[1] < 0 ? 12 : 0), width: f[0] ? 12 : 40, height: f[1] ? 12 : 40, fill: "#9aa3b2" }, svg);
    });
  }

  function drawPath(svg, path, color, dashed, offset) {
    if (!path || path.length < 2) return;
    var pts = path.map(function (c) { var p = center(c); return (p[0] + offset) + "," + (p[1] + offset); }).join(" ");
    el("polyline", { points: pts, fill: "none", stroke: color, "stroke-width": dashed ? 4 : 6, "stroke-linecap": "round",
                     "stroke-linejoin": "round", "stroke-dasharray": dashed ? "10 8" : "", opacity: dashed ? 0.85 : 0.9 }, svg);
    var a = center(path[path.length - 1]);
    el("circle", { cx: a[0] + offset, cy: a[1] + offset, r: 6, fill: color }, svg);
  }

  function drawRobot(svg) {
    var c = center(st.robot.pos), d = S.DIRS[st.robot.heading];
    var g = el("g", { "aria-hidden": "true" }, svg);
    el("circle", { cx: c[0], cy: c[1], r: 20, fill: "#1d2f6b", stroke: "#fff", "stroke-width": 3 }, g);
    el("line", { x1: c[0], y1: c[1], x2: c[0] + d[0] * 26, y2: c[1] - d[1] * 26, stroke: "#f2a51f", "stroke-width": 5, "stroke-linecap": "round" }, g);
    if (st.carrying) el("rect", { x: c[0] - 8, y: c[1] - 8, width: 16, height: 16, fill: "#f2a51f", stroke: "#fff", "stroke-width": 2 }, g);
  }

  function render() {
    var svg = $("map");
    drawField(svg, { interactive: true });
    if (st.lastPaths) {
      if (st.lastPaths.fixed && $("compare").checked) drawPath(svg, st.lastPaths.fixed, "#d9822b", true, 5);
      drawPath(svg, st.lastPaths.main, st.lastPaths.mainColor, false, 0);
    }
    drawRobot(svg);
    renderFill(); renderQueue(); renderStats();
  }

  function renderFill() {
    var h = "";
    S.ZONE_NAMES.forEach(function (z) {
      var n = st.wh.fill[z], slots = "";
      for (var k = 0; k < S.CAPACITY; k++) slots += '<span class="slot ' + (k < n ? (n >= S.CAPACITY ? "full" : "on") : "") + '"></span>';
      h += '<div class="zone-bar"><b>Зона ' + z + '</b><div class="slots">' + slots + "</div><span>" + n + "/" + S.CAPACITY + "</span></div>";
    });
    $("fill").innerHTML = h;
  }
  function renderQueue() {
    var q = $("queue");
    if (!st.queue.length) { q.innerHTML = '<span class="empty">Очередь пуста — нажмите номер груза.</span>'; return; }
    q.innerHTML = st.queue.map(function (n, i) { return '<span class="q' + (i === 0 && st.busy ? " cur" : "") + '">груз ' + n + " → " + S.zoneForCargo(n) + "</span>"; }).join("");
  }
  function renderStats() {
    var done = st.log.filter(function (r) { return r.zone !== "—"; });
    var t = done.reduce(function (s, r) { return s + r.time; }, 0);
    var ok = done.filter(function (r) { return r.ok; }).length;
    var redir = st.log.filter(function (r) { return r.redirected; }).length;
    $("stats").innerHTML =
      stat(done.length, "доставлено") + stat(redir, "перенаправлено") +
      stat(done.length ? (t / done.length).toFixed(1) + " с" : "—", "среднее время") +
      stat(done.length ? Math.round(100 * ok / done.length) + " %" : "—", "без ошибок");
  }
  function stat(v, t) { return '<div class="stat"><b>' + v + "</b><span>" + t + "</span></div>"; }

  function setStatus(text, kind) { var s = $("status"); s.textContent = text; s.className = "status" + (kind ? " " + kind : ""); }

  // ---------------- заказы ----------------
  function addCargo(n) { st.queue.push(n); renderQueue(); if (!st.busy) setStatus("В очереди: " + st.queue.length + ". Нажмите «Выполнить очередь»."); }

  function runQueue() {
    if (st.busy || !st.queue.length) return;
    st.busy = true; renderQueue(); nextOrder();
  }

  function nextOrder() {
    if (!st.queue.length) { st.busy = false; renderQueue(); setStatus("Очередь выполнена. Робот ждёт в зоне загрузки."); return; }
    var cargo = st.queue[0], mode = $("mode").value;
    var res = st.wh.chooseZone(cargo), zone = res[0];
    if (zone === null) {
      setStatus(res[1] + ". Нажмите «Отгрузить всё».", "err");
      addLog({ cargo: cargo, zone: "—", mode: mode, cells: 0, cmds: "—", time: 0, stopErr: 0, ok: false, note: "склад полон" });
      st.queue.shift(); st.busy = false; renderQueue(); return;
    }
    var goal = S.ZONES[zone];
    var grid = S.bfs(S.LOAD, goal, st.wh.obstacles, 0);
    var fixed = S.fixedRoute(zone, st.wh.obstacles, false);
    var path = mode === "grid" ? grid : fixed;
    if (!path) { setStatus("Нет пути до зоны " + zone + ": уберите препятствие.", "err"); st.queue.shift(); st.busy = false; renderQueue(); return; }
    st.lastPaths = { main: path, mainColor: mode === "grid" ? "#1c6db3" : "#d9822b", fixed: mode === "grid" ? fixed : null };
    var pc = S.pathToCommands(path, 0);
    var run = S.simulateRun(zone, path, st.rng);
    setStatus(res[1] + ". Путь: " + (path.length - 1) + " клеток, команды: " + S.commandsText(pc.cmds) + ".", zone !== S.zoneForCargo(cargo) ? "warn" : "");
    st.carrying = true;
    animate(path, 1, function () {
      st.wh.store(zone); st.carrying = false;
      addLog({ cargo: cargo, zone: zone, mode: mode, cells: path.length - 1, cmds: S.commandsText(pc.cmds), time: run.time,
               stopErr: run.stopErr, ok: run.ok, redirected: zone !== S.zoneForCargo(cargo),
               note: run.miss ? "промах по клетке" : (run.drop ? "уронил груз" : (run.ok ? "доставлено" : "неточная остановка")) });
      st.queue.shift(); render();
      var back = S.bfs(goal, S.LOAD, st.wh.obstacles, st.robot.heading);
      setTimeout(function () { animate(back, 1, function () { st.robot.heading = 0; render(); setTimeout(nextOrder, delay()); }); }, delay());
    });
  }

  function delay() { return 900 / Number($("speed").value); }
  function animate(path, k, done) {
    if (k >= path.length) { done(); return; }
    var dx = path[k][0] - path[k - 1][0], dy = path[k][1] - path[k - 1][1];
    for (var d = 0; d < 4; d++) if (S.DIRS[d][0] === dx && S.DIRS[d][1] === dy) st.robot.heading = d;
    st.robot.pos = path[k];
    render();
    setTimeout(function () { animate(path, k + 1, done); }, delay());
  }

  function addLog(r) {
    r.n = st.log.length + 1; st.log.push(r);
    var tr = document.createElement("tr");
    tr.innerHTML = "<td>" + r.n + "</td><td>" + r.cargo + "</td><td>" + r.zone + (r.redirected ? " ↪" : "") + "</td><td>" +
      (r.mode === "grid" ? "сетка" : "фикс.") + "</td><td>" + r.cells + "</td><td>" + r.cmds + "</td><td>" + r.time.toFixed(1) +
      "</td><td>" + (r.zone === "—" ? "—" : r.stopErr.toFixed(1)) + '</td><td class="' + (r.ok ? "good" : "bad") + '">' + r.note + "</td>";
    $("log").querySelector("tbody").appendChild(tr);
  }

  function download(name, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------------- эксперимент ----------------
  function runExperiment() {
    var reps = Math.max(1, Math.min(20, Number($("reps").value) || 5));
    var r = S.rng(Number($("seed").value) || 1), knows = $("knows").checked, rows = [];
    [1, 2, 3].forEach(function (layout) {
      S.ZONE_NAMES.forEach(function (zone) {
        var routes = { grid: S.bfs(S.LOAD, S.ZONES[zone], S.LAYOUTS[layout]), fixed: S.fixedRoute(zone, S.LAYOUTS[layout], knows) };
        for (var rep = 1; rep <= reps; rep++) ["grid", "fixed"].forEach(function (m) {
          var res = S.simulateRun(zone, routes[m], r);
          rows.push({ layout: layout, zone: zone, rep: rep, method: m, cells: routes[m].length - 1, turns: res.turns,
                      time: res.time, stopErr: res.stopErr, drop: res.drop, miss: res.miss, ok: res.ok });
        });
      });
    });
    st.expRows = rows; $("btnCsvExp").disabled = false;
    var cases = [], gains = [];
    [1, 2, 3].forEach(function (layout) {
      S.ZONE_NAMES.forEach(function (zone) {
        var g = rows.filter(function (x) { return x.layout === layout && x.zone === zone && x.method === "grid"; });
        var f = rows.filter(function (x) { return x.layout === layout && x.zone === zone && x.method === "fixed"; });
        var tg = avg(g.map(function (x) { return x.time; })), tf = avg(f.map(function (x) { return x.time; }));
        var gain = (tf - tg) / tf * 100; gains.push(gain);
        cases.push({ label: layout + zone, layout: layout, zone: zone, cg: g[0].cells, cf: f[0].cells, tg: tg, tf: tf, gain: gain });
      });
    });
    var G = rows.filter(function (x) { return x.method === "grid"; }), F = rows.filter(function (x) { return x.method === "fixed"; });
    var gain = avg(gains), okG = 100 * G.filter(function (x) { return x.ok; }).length / G.length;
    var errs = G.filter(function (x) { return !x.miss; }).map(function (x) { return x.stopErr; }).sort(function (a, b) { return a - b; });
    var p95 = errs[Math.floor(0.95 * (errs.length - 1))];
    $("verdict").innerHTML = "<b>" + gain.toFixed(1) + " %</b>средний выигрыш сетки по времени. Гипотеза «не менее 30 %» " +
      (gain >= 30 ? '<span class="good">подтверждается</span>' : '<span class="bad">не подтверждается</span>') + " в этой симуляции.";
    $("criteria").innerHTML = "<table><tr><th>Критерий</th><th>Цель</th><th>Получено</th></tr>" +
      crit("Доставок без ошибок", "≥ 90 %", okG.toFixed(0) + " %", okG >= 90) +
      crit("Ошибка остановки (95 % заездов)", "≤ 10 мм", p95.toFixed(1) + " мм", p95 <= 10) +
      crit("Выигрыш по времени", "≥ 30 %", gain.toFixed(1) + " %", gain >= 30) +
      crit("Заездов", "2 × 45", G.length + " + " + F.length, G.length >= 45) + "</table>";
    $("expTable").innerHTML = "<tr><th>Схема</th><th>Зона</th><th>Клеток: сетка / маршрут</th><th>Время сетка, с</th><th>Время маршрут, с</th><th>Выигрыш</th></tr>" +
      cases.map(function (c) { return "<tr><td>" + c.layout + "</td><td>" + c.zone + "</td><td>" + c.cg + " / " + c.cf + "</td><td>" + c.tg.toFixed(1) + "</td><td>" + c.tf.toFixed(1) + '</td><td class="' + (c.gain >= 30 ? "good" : "") + '">' + c.gain.toFixed(1) + " %</td></tr>"; }).join("");
    drawChart(cases);
  }
  function crit(n, t, v, ok) { return "<tr><td>" + n + "</td><td>" + t + '</td><td class="' + (ok ? "good" : "bad") + '">' + v + (ok ? " ✓" : " ✗") + "</td></tr>"; }
  function avg(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }

  function drawChart(cases) {
    var cv = $("chart"), ctx = cv.getContext("2d"), Wc = cv.width, Hc = cv.height;
    ctx.clearRect(0, 0, Wc, Hc);
    var max = Math.max.apply(null, cases.map(function (c) { return c.tf; }).concat(cases.map(function (c) { return c.tg; }))) * 1.1;
    var x0 = 50, y0 = Hc - 40, w = (Wc - x0 - 10) / cases.length;
    ctx.font = "13px Segoe UI"; ctx.fillStyle = "#545c6b"; ctx.strokeStyle = "#d3dce8";
    for (var v = 0; v <= max; v += 10) {
      var y = y0 - v / max * (y0 - 20);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(Wc - 10, y); ctx.stroke(); ctx.fillText(v, 18, y + 4);
    }
    cases.forEach(function (c, i) {
      var x = x0 + i * w + w * 0.15, bw = w * 0.32;
      ctx.fillStyle = "#1c6db3"; var h1 = c.tg / max * (y0 - 20); ctx.fillRect(x, y0 - h1, bw, h1);
      ctx.fillStyle = "#f2a51f"; var h2 = c.tf / max * (y0 - 20); ctx.fillRect(x + bw + 3, y0 - h2, bw, h2);
      ctx.fillStyle = "#1d2330"; ctx.fillText(c.label, x + bw - 6, y0 + 18);
    });
    ctx.fillStyle = "#1c6db3"; ctx.fillRect(x0, 6, 14, 10); ctx.fillStyle = "#1d2330"; ctx.fillText("сетка + BFS", x0 + 20, 16);
    ctx.fillStyle = "#f2a51f"; ctx.fillRect(x0 + 130, 6, 14, 10); ctx.fillStyle = "#1d2330"; ctx.fillText("фиксированные маршруты", x0 + 150, 16);
    ctx.fillText("схема + зона", Wc / 2 - 30, Hc - 4);
  }

  // ---------------- волна BFS ----------------
  function showWave() {
    var zone = $("waveZone").value, goal = S.ZONES[zone], svg = $("wave");
    var dist = S.distances(goal, st.wh.obstacles);
    var path = S.bfs(S.LOAD, goal, st.wh.obstacles, 0);
    drawField(svg, { wave: true });
    var maxd = 0; for (var k in dist) maxd = Math.max(maxd, dist[k]);
    var step = 0;
    (function tick() {
      for (var key in dist) if (dist[key] === step) {
        var c = key.split(",").map(Number), p = xy(c);
        el("rect", { x: p[0] + 3, y: p[1] + 3, width: CELL - 6, height: CELL - 6, fill: "#1c6db3", opacity: 0.08 + 0.5 * (1 - step / (maxd + 1)) }, svg);
        el("text", { x: p[0] + CELL / 2, y: p[1] + CELL / 2 + 10, "text-anchor": "middle", "font-size": 28, "font-weight": 700, fill: "#1d2f6b" }, svg, step);
      }
      step++;
      if (step <= maxd) setTimeout(tick, 350);
      else drawPath(svg, path, "#b8322a", false, 0);
    })();
  }

  // ---------------- параметры ----------------
  function renderParams() {
    var cls = { "ПАСПОРТ": "t-pass", "ВЫБОР": "t-choice", "ИЗМЕРИТЬ": "t-meas" };
    var h = "<tr><th>Параметр</th><th>Значение</th><th>Источник</th><th>Описание</th></tr>";
    for (var k in META) h += "<tr><td><code>" + k + "</code></td><td>" + META[k].value + '</td><td><span class="tag ' + (cls[META[k].tag] || "") + '">' + META[k].tag + "</span></td><td>" + META[k].note + "</td></tr>";
    $("params").innerHTML = h;
    var v = CFG.DRIVE_DPS / 360 * Math.PI * CFG.WHEEL_MM;
    $("timing").innerHTML = "<p>Скорость по прямой: " + CFG.DRIVE_DPS + " °/с × π × " + CFG.WHEEL_MM + " мм / 360° = <b>" + v.toFixed(0) + " мм/с</b> (≈ " +
      Math.round(100 * CFG.DRIVE_DPS / (CFG.LARGE_MOTOR_RPM * 6)) + " % от паспортного максимума " + CFG.LARGE_MOTOR_RPM + " об/мин).</p>" +
      "<p>Одна клетка: <b>" + S.straightTime(1).toFixed(2) + " с</b> · четыре клетки подряд: <b>" + S.straightTime(4).toFixed(2) + " с</b></p>" +
      "<p>Поворот на 90°: <b>" + S.turnTime().toFixed(2) + " с</b> · подъём вил: <b>" + S.forkTime().toFixed(2) + " с</b></p>" +
      '<p class="small">Профиль скорости — трапеция с разгоном ' + CFG.ACCEL_MMS2 + " мм/с² (синтетика до замера).</p>";
    var g = 9.81, arm = CFG.CARGO_G / 1000 * g * CFG.FORK_ARM_MM / 10, mot = arm / CFG.FORK_GEAR_RATIO;
    $("torque").innerHTML = "<p>Груз с поддоном и вилами: " + CFG.CARGO_G + " г, плечо " + CFG.FORK_ARM_MM + " мм.</p>" +
      "<p>Момент на оси вил: " + (CFG.CARGO_G / 1000) + " кг × 9,81 × " + (CFG.FORK_ARM_MM / 10) + " см = <b>" + arm.toFixed(1) + " Н·см</b></p>" +
      "<p>Через редуктор 1:" + CFG.FORK_GEAR_RATIO + " на моторе: <b>" + mot.toFixed(1) + " Н·см</b></p>" +
      "<p>Средний мотор (паспорт): рабочий момент " + CFG.MEDIUM_MOTOR_RUN_NCM + " Н·см → запас <b>× " + (CFG.MEDIUM_MOTOR_RUN_NCM / mot).toFixed(1) + "</b> " +
      (mot <= CFG.MEDIUM_MOTOR_RUN_NCM ? '<span class="good">хватает</span>' : '<span class="bad">не хватает</span>') + "</p>";
  }

  // ---------------- события ----------------
  function toggleCell(c) {
    if (st.busy || isSpecial(c)) { if (isSpecial(c)) setStatus("Зону загрузки и зоны хранения перекрыть нельзя.", "warn"); return; }
    var i = st.wh.obstacles.findIndex(function (o) { return o[0] === c[0] && o[1] === c[1]; });
    if (i >= 0) st.wh.obstacles.splice(i, 1); else st.wh.obstacles.push(c);
    st.lastPaths = null; $("layout").value = ""; render();
    var cell = $("map").querySelector('[data-x="' + c[0] + '"][data-y="' + c[1] + '"]'); if (cell) cell.focus();
  }

  function init() {
    var cb = $("cargoButtons");
    for (var n = 1; n <= 9; n++) (function (n) {
      var b = document.createElement("button");
      b.innerHTML = n + "<small>→ " + S.zoneForCargo(n) + "</small>";
      b.setAttribute("aria-label", "Груз " + n + " в зону " + S.zoneForCargo(n));
      b.onclick = function () { addCargo(n); };
      cb.appendChild(b);
    })(n);
    $("btnRandom").onclick = function () { for (var i = 0; i < 5; i++) addCargo(1 + Math.floor(st.rng() * 9)); };
    $("btnClearQ").onclick = function () { st.queue = st.busy ? st.queue.slice(0, 1) : []; renderQueue(); };
    $("btnRun").onclick = runQueue;
    $("btnUnload").onclick = function () { S.ZONE_NAMES.forEach(function (z) { st.wh.fill[z] = 0; }); render(); setStatus("Склад отгружен."); };
    $("layout").onchange = function () {
      if (this.value === "") return;
      st.wh.obstacles = S.LAYOUTS[this.value].map(function (c) { return [c[0], c[1]]; });
      st.lastPaths = null; render(); setStatus("Схема препятствий " + this.value + ".");
    };
    $("compare").onchange = render;
    $("map").addEventListener("click", function (e) {
      var g = e.target.closest(".cell"); if (g) toggleCell([+g.dataset.x, +g.dataset.y]);
    });
    $("map").addEventListener("keydown", function (e) {
      var f = st.focus.slice(), m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (m) { f = [Math.min(4, Math.max(0, f[0] + m[0])), Math.min(4, Math.max(0, f[1] + m[1]))]; st.focus = f; render();
               $("map").querySelector('[data-x="' + f[0] + '"][data-y="' + f[1] + '"]').focus(); e.preventDefault(); }
      if (e.key === "Enter" || e.key === " ") { toggleCell(st.focus); e.preventDefault(); }
    });
    $("btnCsvLog").onclick = function () {
      download("журнал_смены.csv", "n;cargo;zone;method;cells;commands;time_s;stop_err_mm;result\n" + st.log.map(function (r) {
        return [r.n, r.cargo, r.zone, r.mode, r.cells, r.cmds, r.time.toFixed(2), r.stopErr.toFixed(1), r.note].join(";"); }).join("\n"));
    };
    $("btnExp").onclick = runExperiment;
    $("btnCsvExp").onclick = function () {
      download("protocol_web.csv", "layout;zone;rep;method;cells;turns;time_s;stop_err_mm;drop;miscount\n" + st.expRows.map(function (r) {
        return [r.layout, r.zone, r.rep, r.method, r.cells, r.turns, r.time.toFixed(2), r.stopErr.toFixed(1), +r.drop, +r.miss].join(";"); }).join("\n"));
    };
    $("btnWave").onclick = showWave;
    document.querySelectorAll(".tab").forEach(function (t) {
      t.onclick = function () {
        document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); x.setAttribute("aria-selected", "false"); });
        document.querySelectorAll(".page").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active"); t.setAttribute("aria-selected", "true");
        $("tab-" + t.dataset.tab).classList.add("active");
        if (t.dataset.tab === "how") showWave();
      };
    });
    renderParams(); render();
    onHash();
    window.addEventListener("hashchange", onHash);
  }

  // Ссылки вида index.html#exp открывают нужную вкладку (удобно для показа жюри)
  function onHash() {
    var h = location.hash;
    if (h === "#demo" && !st.busy) { $("layout").value = "1"; $("layout").onchange(); [2, 5, 8, 1].forEach(addCargo); $("speed").value = 8; runQueue(); }
    if (h === "#exp") { document.querySelector('[data-tab="exp"]').click(); runExperiment(); }
    if (h === "#how") { document.querySelector('[data-tab="how"]').click(); }
    if (h === "#robot") { document.querySelector('[data-tab="robot"]').click(); }
  }
  init();
})();
