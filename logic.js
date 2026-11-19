// Логика склада для веб-симулятора: точный перенос robot/sklad.py на JavaScript.
// Совпадение с Python проверяется в pc/verify.py (одни и те же входы -> одни и те же ответы).
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./config.js").EV3_CONFIG);
  } else {
    root.Sklad = factory(root.EV3_CONFIG);
  }
})(this, function (CFG) {
  "use strict";
  var W = 5, H = 5;
  var LOAD = [0, 0];
  var CAPACITY = CFG.CAPACITY;
  var ZONES = { A: [4, 4], B: [0, 4], C: [4, 1] };
  var ZONE_NAMES = ["A", "B", "C"];
  var ZONE_FACING = { A: 0, B: 2, C: 0 };
  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  var LAYOUTS = { 0: [], 1: [[2, 2]], 2: [[2, 0], [3, 3]], 3: [[2, 3], [3, 1]] };

  function key(c) { return c[0] + "," + c[1]; }
  function eq(a, b) { return a[0] === b[0] && a[1] === b[1]; }
  function inside(c) { return c[0] >= 0 && c[0] < W && c[1] >= 0 && c[1] < H; }
  function blockedSet(obst) { var s = {}; (obst || []).forEach(function (c) { s[key(c)] = 1; }); return s; }
  function zoneForCargo(n) { return ZONE_NAMES[(n - 1) % ZONE_NAMES.length]; }
  function mod(a, n) { return ((a % n) + n) % n; }

  function distances(goal, obst) {
    var blocked = blockedSet(obst), dist = {}, queue = [goal], i = 0;
    dist[key(goal)] = 0;
    while (i < queue.length) {
      var cur = queue[i++];
      for (var d = 0; d < 4; d++) {
        var nxt = [cur[0] + DIRS[d][0], cur[1] + DIRS[d][1]];
        if (inside(nxt) && !blocked[key(nxt)] && !(key(nxt) in dist)) {
          dist[key(nxt)] = dist[key(cur)] + 1;
          queue.push(nxt);
        }
      }
    }
    return dist;
  }

  function turnsBetween(a, b) { var k = mod(b - a, 4); return k === 0 ? 0 : (k === 2 ? 2 : 1); }

  function bfs(start, goal, obst, heading) {
    heading = heading || 0;
    var blocked = blockedSet(obst);
    if (blocked[key(start)] || blocked[key(goal)]) return null;
    var dist = distances(goal, obst);
    if (!(key(start) in dist)) return null;
    var memo = {};
    function best(cell, h) {
      var k = key(cell) + "|" + h;
      if (k in memo) return memo[k];
      if (eq(cell, goal)) return (memo[k] = [0, null]);
      var res = null;
      for (var nh = 0; nh < 4; nh++) {
        var nxt = [cell[0] + DIRS[nh][0], cell[1] + DIRS[nh][1]];
        if (dist[key(nxt)] === dist[key(cell)] - 1) {
          var cost = turnsBetween(h, nh) + best(nxt, nh)[0];
          if (res === null || cost < res[0]) res = [cost, [nxt, nh]];
        }
      }
      return (memo[k] = res);
    }
    var path = [start], state = [start, heading];
    while (!eq(state[0], goal)) { state = best(state[0], state[1])[1]; path.push(state[0]); }
    return path;
  }

  function line(a, b) {
    var out = [], dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]), cur = a;
    while (!eq(cur, b)) { cur = [cur[0] + dx, cur[1] + dy]; out.push(cur); }
    return out;
  }
  function route(points) {
    var p = [points[0]];
    for (var k = 1; k < points.length; k++) p = p.concat(line(points[k - 1], points[k]));
    return p;
  }
  var PRIMARY = {
    A: route([[0, 0], [2, 0], [2, 4], [4, 4]]),
    B: route([[0, 0], [2, 0], [2, 4], [0, 4]]),
    C: route([[0, 0], [2, 0], [2, 1], [4, 1]])
  };
  var RING_CCW = route([[0, 0], [4, 0], [4, 4], [0, 4], [0, 1]]);
  var RING_CW = route([[0, 0], [0, 4], [4, 4], [4, 0], [1, 0]]);
  function ringTo(ring, goal) {
    for (var i = 0; i < ring.length; i++) if (eq(ring[i], goal)) return ring.slice(0, i + 1);
    return null;
  }

  function fixedRoute(zone, obst, knowsMap) {
    var blocked = blockedSet(obst), goal = ZONES[zone];
    var cands = [PRIMARY[zone], ringTo(RING_CCW, goal), ringTo(RING_CW, goal)];
    var driven = [LOAD];
    for (var i = 0; i < cands.length; i++) {
      var path = cands[i];
      if (!path) continue;
      var free = path.every(function (c) { return !blocked[key(c)]; });
      if (free) return knowsMap ? path : driven.concat(path.slice(1));
      if (!knowsMap) {
        var k = 0;
        while (!blocked[key(path[k + 1])]) k++;
        var part = path.slice(0, k + 1);
        var back = part.slice(0, -1).reverse();
        driven = driven.concat(part.slice(1), back);
      }
    }
    return null;
  }

  function pathToCommands(path, heading) {
    heading = heading || 0;
    var cmds = [];
    for (var k = 1; k < path.length; k++) {
      var sx = path[k][0] - path[k - 1][0], sy = path[k][1] - path[k - 1][1], need = -1;
      for (var d = 0; d < 4; d++) if (DIRS[d][0] === sx && DIRS[d][1] === sy) need = d;
      var diff = mod(need - heading, 4);
      if (diff === 1) cmds.push(["L", 1]);
      else if (diff === 3) cmds.push(["R", 1]);
      else if (diff === 2) { cmds.push(["R", 1]); cmds.push(["R", 1]); }
      heading = need;
      if (cmds.length && cmds[cmds.length - 1][0] === "F") cmds[cmds.length - 1] = ["F", cmds[cmds.length - 1][1] + 1];
      else cmds.push(["F", 1]);
    }
    return { cmds: cmds, heading: heading };
  }
  function commandsText(cmds) {
    var names = { F: "вперёд", L: "налево", R: "направо" };
    return cmds.map(function (c) { return names[c[0]] + (c[0] === "F" ? " " + c[1] : ""); }).join(", ");
  }
  function countTurns(cmds) { return cmds.filter(function (c) { return c[0] !== "F"; }).length; }

  // --- модель времени (как в sklad.py) ---
  function wheelSpeed(dps) { return dps / 360 * Math.PI * CFG.WHEEL_MM; }
  function moveTime(d, v, a) {
    if (d <= 0) return 0;
    var dAcc = v * v / a;
    if (d >= dAcc) return d / v + v / a;
    return 2 * Math.sqrt(d / a);
  }
  function straightTime(cells) { return moveTime(cells * CFG.CELL_MM, wheelSpeed(CFG.DRIVE_DPS), CFG.ACCEL_MMS2) + CFG.SETTLE_S; }
  function turnTime() { return moveTime(Math.PI * CFG.AXLE_TRACK_MM / 4, wheelSpeed(CFG.TURN_DPS), CFG.ACCEL_MMS2) + CFG.SETTLE_S; }
  function forkTime() { return CFG.FORK_UP_DEG / CFG.FORK_DPS + CFG.SETTLE_S; }
  function commandsTime(cmds) {
    return cmds.reduce(function (t, c) { return t + (c[0] === "F" ? straightTime(c[1]) : turnTime()); }, 0);
  }
  function deliveryTime(zone, path, heading) {
    var r = pathToCommands(path, heading || 0);
    var t = 2 * forkTime() + commandsTime(r.cmds);
    t += turnsBetween(r.heading, ZONE_FACING[zone]) * turnTime();
    var rack = moveTime(CFG.RACK_MM, wheelSpeed(CFG.DRIVE_DPS), CFG.ACCEL_MMS2) + CFG.SETTLE_S;
    return t + 2 * rack;
  }

  // --- склад ---
  function Warehouse(obst) {
    this.obstacles = (obst || []).map(function (c) { return [c[0], c[1]]; });
    this.fill = { A: 0, B: 0, C: 0 };
  }
  Warehouse.prototype.isFull = function (z) { return this.fill[z] >= CAPACITY; };
  Warehouse.prototype.chooseZone = function (cargo) {
    var want = zoneForCargo(cargo);
    if (!this.isFull(want)) return [want, "Груз " + cargo + " → зона " + want];
    var best = null, bestLen = 0, self = this;
    ZONE_NAMES.forEach(function (z) {
      if (self.isFull(z)) return;
      var p = bfs(LOAD, ZONES[z], self.obstacles);
      if (!p) return;
      if (best === null || p.length < bestLen) { best = z; bestLen = p.length; }
    });
    if (best === null) return [null, "Зона " + want + " занята, свободных зон нет"];
    return [best, "Зона " + want + " занята → груз " + cargo + " в зону " + best];
  };
  Warehouse.prototype.store = function (z) { if (this.isFull(z)) throw new Error("zone full"); this.fill[z]++; };
  Warehouse.prototype.take = function (z) { if (this.fill[z] > 0) this.fill[z]--; };

  // --- стохастическая модель заезда (синтетика, как pc/model.py) ---
  var MODEL = { TIME_SIGMA: 0.04, STOP_SIGMA_MM: 2.5, STOP_BIAS_MM: 3.0, P_MISS_LINE: 0.002,
                P_DROP_TURN: 0.002, TURN_SIGMA_DEG: CFG.GYRO_ACC_90_DEG / 3, SETTLE_LEN_MM: 50, STOP_LIMIT_MM: 10 };
  function rng(seed) {        // mulberry32
    var a = seed >>> 0;
    var f = function () {
      a = (a + 0x6D2B79F5) >>> 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.gauss = function (m, s) { var u = 1 - f(), v = f(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return f;
  }
  function simulateRun(zone, path, r) {
    var pc = pathToCommands(path, 0);
    var turns = countTurns(pc.cmds) + turnsBetween(pc.heading, ZONE_FACING[zone]);
    var lines = path.length - 1;
    var t = deliveryTime(zone, path) * r.gauss(1, MODEL.TIME_SIGMA);
    var along = r.gauss(MODEL.STOP_BIAS_MM, MODEL.STOP_SIGMA_MM);
    var theta = turns ? r.gauss(0, MODEL.TURN_SIGMA_DEG) * Math.PI / 180 : 0;
    var err = Math.hypot(along, MODEL.SETTLE_LEN_MM * Math.sin(theta));
    var miss = false, drop = false, i;
    for (i = 0; i < lines; i++) if (r() < MODEL.P_MISS_LINE) miss = true;
    for (i = 0; i < turns; i++) if (r() < MODEL.P_DROP_TURN) drop = true;
    if (miss) err += CFG.CELL_MM;
    return { time: t, stopErr: err, drop: drop, miss: miss, turns: turns,
             ok: !miss && !drop && err <= MODEL.STOP_LIMIT_MM };
  }

  return {
    W: W, H: H, LOAD: LOAD, CAPACITY: CAPACITY, ZONES: ZONES, ZONE_NAMES: ZONE_NAMES, ZONE_FACING: ZONE_FACING,
    DIRS: DIRS, LAYOUTS: LAYOUTS, CFG: CFG, MODEL: MODEL,
    zoneForCargo: zoneForCargo, inside: inside, distances: distances, bfs: bfs, fixedRoute: fixedRoute,
    pathToCommands: pathToCommands, commandsText: commandsText, countTurns: countTurns, turnsBetween: turnsBetween,
    straightTime: straightTime, turnTime: turnTime, forkTime: forkTime, deliveryTime: deliveryTime,
    Warehouse: Warehouse, rng: rng, simulateRun: simulateRun, key: key
  };
});
