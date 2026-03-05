/* ═══════════════════════════════════════════════════════════
   LEVELS PLAYLIST
   Add levels here in order. { path, name }
═══════════════════════════════════════════════════════════ */
const LEVELS = [
  { path: "static/levels/level1.txt", name: "Level 1" },
  { path: "static/levels/level2.txt", name: "Level 2" },
  { path: "static/levels/level3.txt", name: "Level 3" },
  { path: "static/levels/level4.txt", name: "Level 4" },
  { path: "static/levels/level5.txt", name: "Level 5" },
  // Add more levels here — progression is automatic.
];

/* ═══════════════════════════════════════════════════════════
     RULES REGISTRY
     Each key is the character used to place that tablet in a
     level .txt file (digits '1'–'9').
  
     Each rule defines:
       name        – displayed in the sidebar
       description – short plain-English effect description
       color       – accent color for the card and tablet border
       applyToMoves(moves) – receives an array of {dx,dy} moves
                             for one intended action and returns
                             a new array (filter, duplicate, map…)
                             Return [] to cancel the move entirely.
  ═══════════════════════════════════════════════════════════ */
const RULES = {
  // ── Priority 10: Filters (run first) ─────────────────────────
  // Filters remove moves from the list. Running them before
  // transformers means e.g. "No Left + Reverse" blocks right
  // (the intended left is reversed to right, then filtered out).
  1: {
    name: "No Left",
    description: "You cannot move left.",
    color: "#ce4a4a",
    priority: 10,
    applyToMoves: (moves) => moves.filter((m) => !(m.dx === -1 && m.dy === 0)),
  },
  6: {
    name: "No Up",
    description: "You cannot move Up.",
    color: "#ce4a4a",
    priority: 10,
    applyToMoves: (moves) => moves.filter((m) => !(m.dx === 0 && m.dy === -1)),
  },
  3: {
    name: "No Right",
    description: "You cannot move right.",
    color: "#4a8ace",
    priority: 10,
    applyToMoves: (moves) => moves.filter((m) => !(m.dx === 1 && m.dy === 0)),
  },
  9: {
    name: "No Vertical",
    description: "You cannot move up or down.",
    color: "#8ace4a",
    priority: 10,
    applyToMoves: (moves) => moves.filter((m) => m.dy === 0),
  },
  // ── Priority 20: Transformers (run second) ───────────────────
  // Transformers remap moves. Running after filters means the
  // filter already removed disallowed directions before remapping.
  4: {
    name: "Flip Y",
    description: "Up and down are swapped.",
    color: "#4ace7a",
    priority: 25,
    applyToMoves: (moves) => moves.map((m) => ({ dx: m.dx, dy: -m.dy })),
  },
  5: {
    name: "Reverse",
    description: "All directions are inverted.",
    color: "#ce4a8a",
    priority: 20,
    applyToMoves: (moves) => moves.map((m) => ({ dx: -m.dx, dy: -m.dy })),
  },
  // ── Priority 30: Multipliers (run last) ──────────────────────
  2: {
    name: "Echo Step",
    description: "Every move is repeated twice.",
    color: "#ce9a30",
    priority: 30,
    applyToMoves: (moves) => moves.flatMap((m) => [m, m]),
  },
  // Add more rules here. priority: 10=filter, 20=transform, 30=multiply
};

/* ═══════════════════════════════════════════════════════════
     TILE REGISTRY
     '#' wall  '.' floor  'S' spawn  'E' exit
     Tablet tiles are auto-generated below from RULES.
  ═══════════════════════════════════════════════════════════ */
const TILES = {
  "#": { name: "wall", solid: true, color: "#2e2e4a", borderColor: "#1a1a30" },
  ".": {
    name: "floor",
    solid: false,
    color: "#161625",
    borderColor: "#1c1c30",
  },
  S: { name: "spawn", solid: false, color: "#161625", borderColor: "#1c1c30" },
  E: {
    name: "exit",
    solid: false,
    color: "#0f2e2e",
    borderColor: "#1a5a5a",
    isExit: true,
  },
};

// Auto-register a tablet tile for every defined rule.
for (const [ruleId, rule] of Object.entries(RULES)) {
  TILES[ruleId] = {
    name: `tablet_${ruleId}`,
    solid: false,
    color: "#1a1208",
    borderColor: rule.color,
    isTablet: true,
    ruleId,
  };
}

const TILE_UNKNOWN = {
  name: "unknown",
  solid: true,
  color: "#ff00ff",
  borderColor: "#cc00cc",
};

/* ═══════════════════════════════════════════════════════════
     RULE ENGINE
     Tracks which rules are currently active and processes a
     raw {dx,dy} intent through the active-rule pipeline.
  ═══════════════════════════════════════════════════════════ */
const RuleEngine = (() => {
  const activeRules = new Set();

  function processMoves(dx, dy) {
    let moves = [{ dx, dy }];
    // Sort active rules by priority so filters run before transformers
    // before multipliers, regardless of collection order.
    const pipeline = Array.from(activeRules).sort((a, b) => {
      return (RULES[a].priority || 50) - (RULES[b].priority || 50);
    });
    for (const id of pipeline) {
      moves = RULES[id].applyToMoves(moves);
    }
    return moves;
  }

  function activate(ruleId) {
    if (RULES[ruleId]) activeRules.add(ruleId);
  }
  function clear() {
    activeRules.clear();
  }

  return { processMoves, activate, clear };
})();

/* ═══════════════════════════════════════════════════════════
     LEVEL LOADER
  ═══════════════════════════════════════════════════════════ */
async function loadLevel(path, name = "Unknown") {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load level: ${path}`);
  return parseLevel(await response.text(), name);
}

function parseLevel(text, name) {
  const rows = text
    .split("\n")
    .map((line) => line.replace(/\r/g, ""))
    .filter((line) => line.length > 0);

  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  let spawnX = 0,
    spawnY = 0;
  const tabletRuleIds = [];

  const grid = rows.map((row, y) => {
    const cols = row.padEnd(width, "#");
    return cols.split("").map((char, x) => {
      if (char === "S") {
        spawnX = x;
        spawnY = y;
      }
      if (TILES[char]?.isTablet && !tabletRuleIds.includes(char)) {
        tabletRuleIds.push(char);
      }
      return TILES[char] ? char : "#";
    });
  });

  const originalGrid = grid.map((row) => [...row]);
  return {
    grid,
    originalGrid,
    width,
    height,
    spawnX,
    spawnY,
    name,
    tabletRuleIds,
  };
}

function getTile(level, x, y) {
  if (y < 0 || y >= level.height || x < 0 || x >= level.width)
    return TILES["#"];
  return TILES[level.grid[y][x]] ?? TILE_UNKNOWN;
}

/* ═══════════════════════════════════════════════════════════
     PLAYER
  ═══════════════════════════════════════════════════════════ */
function createPlayer(x, y) {
  return { x, y, color: "#5e60ce", borderColor: "#9395f0" };
}

/* ═══════════════════════════════════════════════════════════
     INPUT MANAGER
     Supports both tap (justPressed) and held-key repeat.
     Held movement: fires immediately on keydown, then waits
     REPEAT_DELAY ms before firing again every REPEAT_INTERVAL ms.
  ═══════════════════════════════════════════════════════════ */
const Input = (() => {
  const REPEAT_DELAY = 200; // ms after first press before repeat begins
  const REPEAT_INTERVAL = 150; // ms between each repeated step

  const held = new Set();
  const consumed = new Set(); // for justPressed
  const pendingFire = new Set(); // keys that need an immediate first fire
  const repeatAt = {}; // code -> timestamp of next repeat fire

  window.addEventListener("keydown", (e) => {
    if (!held.has(e.code)) {
      held.add(e.code);
      pendingFire.add(e.code); // fire on very next frame
      repeatAt[e.code] = performance.now() + REPEAT_DELAY; // then start repeat
    }
  });
  window.addEventListener("keyup", (e) => {
    held.delete(e.code);
    consumed.delete(e.code);
    pendingFire.delete(e.code);
    delete repeatAt[e.code];
  });

  // True once per physical keydown (used for non-movement actions).
  function justPressed(code) {
    if (held.has(code) && !consumed.has(code)) {
      consumed.add(code);
      return true;
    }
    return false;
  }

  // True on the first frame a key goes down (immediate tap response),
  // then true again every REPEAT_INTERVAL ms while held.
  function heldFire(code, now) {
    if (!held.has(code)) return false;
    if (pendingFire.has(code)) {
      pendingFire.delete(code);
      return true;
    }
    if (now >= repeatAt[code]) {
      repeatAt[code] = now + REPEAT_INTERVAL;
      return true;
    }
    return false;
  }

  return { justPressed, heldFire };
})();

/* ═══════════════════════════════════════════════════════════
     SCREEN MANAGER
     Controls which full-screen overlay panel is visible.
     States: 'start' | 'playing' | 'level-complete' | 'game-complete'
  ═══════════════════════════════════════════════════════════ */
const Screen = (() => {
  const overlay = document.getElementById("screen");
  const panelStart = document.getElementById("screen-start");
  const panelLevelDone = document.getElementById("screen-level-complete");
  const panelGameDone = document.getElementById("screen-game-complete");
  const lcLevelName = document.getElementById("lc-level-name");
  const lcNextLabel = document.getElementById("lc-next-label");

  const panels = [panelStart, panelLevelDone, panelGameDone];

  function showPanel(panel) {
    overlay.classList.remove("hidden");
    panels.forEach((p) => p.classList.add("hidden"));
    panel.classList.remove("hidden");
    // Re-trigger animation by forcing a reflow
    panel.style.animation = "none";
    void panel.offsetHeight;
    panel.style.animation = "";
  }

  function hide() {
    overlay.classList.add("hidden");
  }

  function showStart() {
    showPanel(panelStart);
  }

  function showLevelComplete(finishedName, nextName) {
    lcLevelName.textContent = finishedName;
    lcNextLabel.textContent = `Up next: ${nextName}`;
    showPanel(panelLevelDone);
  }

  function showGameComplete() {
    showPanel(panelGameDone);
  }

  return { showStart, showLevelComplete, showGameComplete, hide };
})();

/* ═══════════════════════════════════════════════════════════
     SIDEBAR
  ═══════════════════════════════════════════════════════════ */
const Sidebar = (() => {
  const listEl = document.getElementById("rule-list");
  const emptyEl = document.getElementById("sidebar-empty");

  function init(level) {
    listEl.innerHTML = "";
    if (level.tabletRuleIds.length === 0) {
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    for (const ruleId of level.tabletRuleIds) {
      const rule = RULES[ruleId];
      if (!rule) continue;
      const li = document.createElement("li");
      li.className = "rule-card inactive";
      li.id = `rule-card-${ruleId}`;
      li.style.setProperty("--rule-color", rule.color);
      li.innerHTML = `
          <div class="rule-header">
            <span class="rule-icon" style="color: ${rule.color}">${ruleId}</span>
            <span class="rule-name">${rule.name}</span>
          </div>
          <div class="rule-desc">${rule.description}</div>
          <div class="rule-status">Uncollected</div>
        `;
      listEl.appendChild(li);
    }
  }

  function activate(ruleId) {
    const card = document.getElementById(`rule-card-${ruleId}`);
    if (!card) return;
    card.classList.replace("inactive", "active");
    card.querySelector(".rule-status").textContent = "Active";
  }

  return { init, activate };
})();

/* ═══════════════════════════════════════════════════════════
     RENDERER
     All draw functions are pure — they take (ctx, px, py, ...)
     and never read game state directly.
  ═══════════════════════════════════════════════════════════ */
const TILE_SIZE = 32;

// ── Cheap deterministic hash for per-tile visual variation ──
function tileHash(x, y) {
  let h = (x * 73856093) ^ (y * 19349663);
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  return (h >>> 0) / 0xffffffff; // 0..1
}

// ── Main level render pass ──────────────────────────────────
function renderLevel(ctx, level, time) {
  // Pass 1: all floor-type tiles (solid=false) drawn first
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const tile = getTile(level, x, y);
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      if (!tile.solid) drawFloor(ctx, px, py, x, y);
    }
  }

  // Pass 2: wall shadows cast onto adjacent floor tiles
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      if (getTile(level, x, y).solid) drawWallShadow(ctx, level, x, y);
    }
  }

  // Pass 3: wall tiles on top
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const tile = getTile(level, x, y);
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      if (tile.solid) drawWall(ctx, level, px, py, x, y);
    }
  }

  // Pass 4: special tile decorations
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const tile = getTile(level, x, y);
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      if (tile.isExit) drawExit(ctx, px, py);
      if (tile.isTablet) drawTablet(ctx, px, py, tile);
    }
  }
}

// ── Floor tile ──────────────────────────────────────────────
function drawFloor(ctx, px, py, gx, gy) {
  const h = tileHash(gx, gy);

  // Base — subtle brightness variation per tile
  const v = Math.floor(18 + h * 6);
  ctx.fillStyle = `rgb(${v}, ${v}, ${v + 8})`;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

  // Faint tile grout lines
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);

  // Occasional subtle stone scratch — direction varied per tile
  if (h > 0.82) {
    // Derive a second independent value from the same tile
    // by hashing with swapped coords, giving a different angle each time.
    const h2 = tileHash(gy + 7, gx + 3);
    const scratchX = px + 6 + Math.floor(h * 12);
    const scratchY = py + 6 + Math.floor(h2 * 16);
    // dx always positive (left→right), dy can go up or down
    const sdx = 4 + Math.floor(h * 6);
    const sdy = Math.floor(h2 * 8) - 4; // -4..+4 range
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(scratchX, scratchY);
    ctx.lineTo(scratchX + sdx, scratchY + sdy);
    ctx.stroke();
  }
}

// ── Wall tile ───────────────────────────────────────────────
function drawWall(ctx, level, px, py, gx, gy) {
  const h = tileHash(gx, gy);
  const v = Math.floor(34 + h * 10);

  // Base stone fill
  ctx.fillStyle = `rgb(${v - 4},${v - 6},${v + 10})`;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

  // ── Mortar computed in world-space so lines align across tiles.
  //    Brick height = 10px. Without this, tiles at y=32 would have
  //    their first line at +0 leaving only a 2px gap from the prior
  //    tile's last line at +30 — visible as a doubled seam.
  const worldY0 = gy * TILE_SIZE;
  const worldX0 = gx * TILE_SIZE;

  ctx.fillStyle = "rgba(0,0,0,0.22)";

  // Horizontal mortar: first multiple-of-10 world-y inside this tile
  const firstHLine = Math.ceil(worldY0 / 10) * 10;
  for (let wy = firstHLine; wy < worldY0 + TILE_SIZE; wy += 10) {
    ctx.fillRect(px, py + (wy - worldY0), TILE_SIZE, 1);
  }

  // Vertical mortar: iterate each 10px brick row that overlaps the tile
  const firstBrickRow = Math.floor(worldY0 / 10);
  const lastBrickRow = Math.floor((worldY0 + TILE_SIZE - 1) / 10);
  for (let row = firstBrickRow; row <= lastBrickRow; row++) {
    const vOffset = row % 2 === 0 ? 0 : 8;
    const segTop = Math.max(row * 10, worldY0) - worldY0;
    const segBot = Math.min((row + 1) * 10, worldY0 + TILE_SIZE) - worldY0;
    const segH = segBot - segTop;
    for (
      let wx = Math.ceil(worldX0 / 16) * 16 + vOffset - 16;
      wx < worldX0 + TILE_SIZE;
      wx += 16
    ) {
      const lx = wx - worldX0;
      if (lx >= 0 && lx < TILE_SIZE)
        ctx.fillRect(px + lx, py + segTop, 1, segH);
    }
  }

  // Bevel highlights / shadows on edges that face open floor
  const floorAbove = !getTile(level, gx, gy - 1).solid;
  const floorLeft = !getTile(level, gx - 1, gy).solid;
  const floorBelow = !getTile(level, gx, gy + 1).solid;
  const floorRight = !getTile(level, gx + 1, gy).solid;
  if (floorAbove) {
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(px, py, TILE_SIZE, 2);
  }
  if (floorLeft) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(px, py, 2, TILE_SIZE);
  }
  if (floorBelow) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(px, py + TILE_SIZE - 2, TILE_SIZE, 2);
  }
  if (floorRight) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(px + TILE_SIZE - 2, py, 2, TILE_SIZE);
  }
}

// ── Wall shadow projected onto adjacent floor ───────────────
function drawWallShadow(ctx, level, gx, gy) {
  const T = TILE_SIZE;
  // Shadow cast downward onto the floor tile below
  if (!getTile(level, gx, gy + 1).solid) {
    const px = gx * T,
      py = (gy + 1) * T;
    const g = ctx.createLinearGradient(px, py, px, py + 10);
    g.addColorStop(0, "rgba(0,0,0,0.38)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(px, py, T, 10);
  }
  // Shadow cast rightward onto the floor tile to the right
  if (!getTile(level, gx + 1, gy).solid) {
    const px = (gx + 1) * T,
      py = gy * T;
    const g = ctx.createLinearGradient(px, py, px + 8, py);
    g.addColorStop(0, "rgba(0,0,0,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(px, py, 8, T);
  }
}
// ── Exit tile — a flag on a stone base ─────────────────────
//  Stone base drawn as a small 2.5D block.
//  Tall iron pole. Rectangular banner flies to the right.
function drawExit(ctx, px, py) {
  const cx = px + TILE_SIZE / 2;

  // ── Stone base — 2.5D mini-block centred at bottom of tile ──
  const bW = 14; // base front-face width
  const bFH = 5; // base front-face height
  const bTH = 3; // base top-face height
  const bSW = 4; // base right-face width
  const bx = cx - bW / 2; // base left edge
  const bFY = py + TILE_SIZE - bFH - 1; // front-face top y
  const bTY = bFY - bTH; // top-face top y

  // Right shadow face
  ctx.fillStyle = "#252530";
  ctx.fillRect(bx + bW, bTY, bSW, bFH + bTH);

  // Top face
  ctx.fillStyle = "#606070";
  ctx.fillRect(bx, bTY, bW, bTH);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(bx + 1, bTY + 1, bW - 2, 1);

  // Front face
  ctx.fillStyle = "#404050";
  ctx.fillRect(bx, bFY, bW, bFH);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(bx, bFY, 1, bFH);
  ctx.fillRect(bx, bFY, bW, 1);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(bx + bW - 1, bFY, 1, bFH);
  ctx.fillRect(bx, bFY + bFH - 1, bW, 1);

  // Base outline
  ctx.strokeStyle = "rgba(10,10,16,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, bFY + 0.5, bW - 1, bFH - 1);
  ctx.strokeRect(bx + 0.5, bTY + 0.5, bW - 1, bTH - 1);
  ctx.strokeRect(bx + bW + 0.5, bTY + 0.5, bSW - 1, bFH + bTH - 1);

  // ── Pole ─────────────────────────────────────────────────────
  const poleX = cx - 1; // pole left edge (2px wide)
  const poleTop = py + 3;
  const poleBot = bTY;

  // Pole body — two columns: left lighter, right darker
  ctx.fillStyle = "#6a6a78";
  ctx.fillRect(poleX, poleTop, 2, poleBot - poleTop);
  ctx.fillStyle = "#888898";
  ctx.fillRect(poleX, poleTop, 1, poleBot - poleTop); // left highlight
  ctx.fillStyle = "#333340";
  ctx.fillRect(poleX + 1, poleTop, 1, poleBot - poleTop); // right shadow

  // Pole top cap (3×2 px rounded tip)
  ctx.fillStyle = "#888898";
  ctx.fillRect(poleX - 1, poleTop, 4, 1);
  ctx.fillStyle = "#6a6a78";
  ctx.fillRect(poleX - 1, poleTop + 1, 4, 1);

  // ── Rectangular banner ────────────────────────────────────────
  // Hangs from just below the pole cap, flies to the right
  const flagX = poleX + 2; // attaches at right side of pole
  const flagY = poleTop + 2;
  const flagW = 11;
  const flagH = 8;

  // Banner body — dark red
  ctx.fillStyle = "#7a1a1a";
  ctx.fillRect(flagX, flagY, flagW, flagH);

  // Lighter band across the top (fabric highlight)
  ctx.fillStyle = "#9a2a2a";
  ctx.fillRect(flagX, flagY, flagW, 2);

  // Darker band across the bottom (fabric shadow)
  ctx.fillStyle = "#4a0e0e";
  ctx.fillRect(flagX, flagY + flagH - 2, flagW, 2);

  // Right edge highlight — light catches the free edge
  ctx.fillStyle = "#b03030";
  ctx.fillRect(flagX + flagW - 1, flagY + 1, 1, flagH - 2);

  // Small centred stripe detail — one vertical stripe
  ctx.fillStyle = "#c04040";
  ctx.fillRect(flagX + 5, flagY + 1, 1, flagH - 2);

  // Banner outline
  ctx.strokeStyle = "rgba(10,10,16,0.80)";
  ctx.lineWidth = 1;
  ctx.strokeRect(flagX + 0.5, flagY + 0.5, flagW - 1, flagH - 1);

  // Attachment fold — tiny dark strip where flag meets pole
  ctx.fillStyle = "rgba(0,0,0,0.40)";
  ctx.fillRect(flagX, flagY, 2, flagH);
}

// ── Paper note tile ─────────────────────────────────────────
// A small dark piece of paper with a torn/folded corner,
// and the rule number glowing in neon.
function drawTablet(ctx, px, py, tile) {
  const { ruleId } = tile;
  const rule = RULES[ruleId];
  if (!rule) return;
  const [r, g, b] = hexToRgb(rule.color);

  // Paper dimensions — slightly off-centre to feel placed, not stamped
  const PW = 20;
  const PH = 24;
  const ox = px + 6;
  const oy = py + 4;
  const cx = ox + PW / 2;
  const cy = oy + PH / 2 + 2;

  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(ox + 2, oy + 2, PW, PH);

  // Paper body — very dark, near-black with a hint of colour
  ctx.fillStyle = "#0d0d12";
  ctx.fillRect(ox, oy, PW, PH);

  // Fold crease — faint diagonal line from top-right corner
  const foldSize = 5;
  ctx.fillStyle = "#1a1a22";
  // Folded-corner triangle (top-right)
  ctx.beginPath();
  ctx.moveTo(ox + PW - foldSize, oy);
  ctx.lineTo(ox + PW, oy);
  ctx.lineTo(ox + PW, oy + foldSize);
  ctx.closePath();
  ctx.fill();
  // Crease line
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + PW - foldSize, oy);
  ctx.lineTo(ox + PW, oy + foldSize);
  ctx.stroke();

  // Thin border — very subtle
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, PW - 1, PH - 1);

  // Neon number — three passes: wide outer glow, tighter glow, crisp centre
  ctx.font = "bold 15px Courier New";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Outer diffuse glow (shadowBlur on a canvas context)
  ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;
  ctx.shadowBlur = 8;
  ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
  ctx.fillText(ruleId, cx, cy);

  // Mid glow
  ctx.shadowBlur = 4;
  ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
  ctx.fillText(ruleId, cx, cy);

  // Bright centre
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgb(${Math.min(r + 80, 255)},${Math.min(
    g + 80,
    255
  )},${Math.min(b + 80, 255)})`;
  ctx.fillText(ruleId, cx, cy);

  // Reset shadow so it doesn't bleed onto other draw calls
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function renderPlayer(ctx, player, time) {
  const T = TILE_SIZE;
  const px = player.x * T;
  const py = player.y * T;
  // Base outer square
  ctx.fillStyle = player.color;
  ctx.fillRect(px + 4, py + 4, T - 8, T - 8);
  // Bright inner border
  ctx.strokeStyle = player.borderColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 6, py + 6, T - 12, T - 12);
  // Gentle pulsing centre
  const pulseOffset = Math.sin(0.5) * 1.5; // fixed value, no animation
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(
    px + 12 - pulseOffset,
    py + 12 - pulseOffset,
    8 + pulseOffset * 2,
    8 + pulseOffset * 2
  );
}

// ── Utility: parse hex color to [r, g, b] ───────────────────
function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ═══════════════════════════════════════════════════════════
     GAME
  ═══════════════════════════════════════════════════════════ */
const Game = (() => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const nameEl = document.getElementById("level-name");

  let level = null;
  let player = null;
  let levelIndex = 0;
  let accepting = false; // true only after start screen is dismissed

  // ── Resize canvas to fit current level ─────────────────────
  function resizeCanvas() {
    canvas.width = level.width * TILE_SIZE;
    canvas.height = level.height * TILE_SIZE;
  }

  // ── Execute one resolved grid step ─────────────────────────
  function executeStep(dx, dy) {
    const nx = player.x + dx;
    const ny = player.y + dy;
    const tile = getTile(level, nx, ny);
    if (tile.solid) return;

    player.x = nx;
    player.y = ny;

    if (tile.isTablet) collectTablet(nx, ny, tile.ruleId);
    if (tile.isExit) onReachExit();
  }

  // ── Collect a tablet and activate its rule ──────────────────
  function collectTablet(x, y, ruleId) {
    level.grid[y][x] = ".";
    RuleEngine.activate(ruleId);
    Sidebar.activate(ruleId);
    console.log(`Collected tablet: "${RULES[ruleId]?.name}" (rule ${ruleId})`);
  }

  // ── Reached the exit — advance to the next level ───────────
  function onReachExit() {
    accepting = false;
    const nextIndex = levelIndex + 1;
    const hasNext = nextIndex < LEVELS.length;

    if (!hasNext) {
      Screen.showGameComplete();
      return;
    }
    Screen.showLevelComplete(LEVELS[levelIndex].name, LEVELS[nextIndex].name);

    const btn = document.getElementById("btn-next-level");
    btn.onclick = async () => {
      levelIndex = nextIndex;
      await loadAndStart(LEVELS[levelIndex].path, LEVELS[levelIndex].name);
      Screen.hide();
      accepting = true;
    };
  }

  // ── Input → rule pipeline → execute steps ──────────────────
  function handleInput(now) {
    // R key restarts level regardless of accepting state
    if (Input.justPressed("KeyR")) {
      restartLevel();
      return;
    }

    if (!accepting) return;

    let dx = 0,
      dy = 0;
    if (Input.heldFire("ArrowUp", now) || Input.heldFire("KeyW", now)) dy = -1;
    else if (Input.heldFire("ArrowDown", now) || Input.heldFire("KeyS", now))
      dy = 1;
    else if (Input.heldFire("ArrowLeft", now) || Input.heldFire("KeyA", now))
      dx = -1;
    else if (Input.heldFire("ArrowRight", now) || Input.heldFire("KeyD", now))
      dx = 1;
    else return;

    const moves = RuleEngine.processMoves(dx, dy);
    for (const move of moves) executeStep(move.dx, move.dy);
  }

  // ── Main loop ───────────────────────────────────────────────
  function loop(time) {
    if (level && player) {
      handleInput(time);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderLevel(ctx, level, time);
      renderPlayer(ctx, player, time);
    }
    requestAnimationFrame(loop);
  }

  // ── Load a level and reset state ────────────────────────────
  async function loadAndStart(path, displayName) {
    level = await loadLevel(path, displayName);
    player = createPlayer(level.spawnX, level.spawnY);
    RuleEngine.clear();
    resizeCanvas();
    Sidebar.init(level);
    nameEl.textContent = level.name;
    console.log(`Loaded "${level.name}" — ${level.width}×${level.height}`);
  }

  // ── Restart the current level from scratch ─────────────────
  // Resets grid from the stored originalGrid — no network fetch needed.
  function restartLevel() {
    Screen.hide();
    level.grid = level.originalGrid.map((row) => [...row]);
    player = createPlayer(level.spawnX, level.spawnY);
    RuleEngine.clear();
    Sidebar.init(level);
    nameEl.textContent = level.name;
    accepting = true;
  }

  // ── Boot ────────────────────────────────────────────────────
  async function init() {
    await loadAndStart(LEVELS[0].path, LEVELS[0].name);
    requestAnimationFrame(loop);

    // Start screen
    Screen.showStart();
    document.getElementById("btn-start").onclick = () => {
      Screen.hide();
      accepting = true;
    };

    // Restart current level (in-game button, always available)
    document.getElementById("btn-restart-level").onclick = () => restartLevel();

    // Game-complete restart button
    document.getElementById("btn-restart").onclick = async () => {
      levelIndex = 0;
      await loadAndStart(LEVELS[0].path, LEVELS[0].name);
      Screen.hide();
      accepting = true;
    };
  }

  return { init, loadAndStart };
})();

Game.init().catch((err) => console.error("Game failed to start:", err));
