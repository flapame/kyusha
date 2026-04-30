/*
  game.js
  =======
  这一份文件负责“游戏引擎”：
  - 状态管理
  - 选择 / 移动 / 攻击 / 技能
  - 回合推进
  - 伤害统计
  - 游戏结束与结算

  以后如果你只是改英雄数值，优先去 heroes.js。
  如果你要改规则结算，再动这里。
*/

const HERO_DEFS = window.HERO_DEFS;
const GAME_RULES = window.GAME_RULES;

const W = 9;
const H = 4;

// 左右出生区：每边 3×2
const BLUE_SPAWN = new Set(["0,0","0,1","1,0","1,1","2,0","2,1"]);
const RED_SPAWN  = new Set(["6,2","6,3","7,2","7,3","8,2","8,3"]);

const TEAM = {
  blue: { name: "蓝方", color: "blue" },
  red: { name: "红方", color: "red" }
};

// 工具函数：更稳，不容易改坏
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function inBounds(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
function keyOf(x, y) { return `${x},${y}`; }
function otherTeam(team) { return team === "blue" ? "red" : "blue"; }
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// DOM 快捷函数
const $ = (id) => document.getElementById(id);

const UI_MODE_KEY = "flap_ui_mode";
let uiMode = "portrait";

function getStoredUIMode() {
  try {
    const value = localStorage.getItem(UI_MODE_KEY);
    return value === "landscape" ? "landscape" : value === "portrait" ? "portrait" : "";
  } catch {
    return "";
  }
}

function saveUIMode(mode) {
  try { localStorage.setItem(UI_MODE_KEY, mode); } catch {}
}

function isPhoneLikeViewport() {
  return window.matchMedia("(pointer: coarse)").matches && Math.max(window.innerWidth, window.innerHeight) <= 1024;
}

function shouldShowRotateOverlay() {
  return uiMode === "landscape" && isPhoneLikeViewport() && window.matchMedia("(orientation: portrait)").matches;
}

function updateRotateOverlay() {
  const overlay = $("rotateOverlay");
  if (!overlay) return;
  overlay.classList.toggle("show", shouldShowRotateOverlay());
}

async function requestLandscapeLock() {
  try {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
  } catch (_) {
    // 不同浏览器对全屏支持不一致，忽略即可
  }

  try {
    if (screen.orientation && typeof screen.orientation.lock === "function") {
      await screen.orientation.lock("landscape");
    }
  } catch (_) {
    // 不支持就继续用旋转遮罩提示
  }

  updateRotateOverlay();
}

async function releaseLandscapeLock() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (_) {}

  try {
    if (screen.orientation && typeof screen.orientation.unlock === "function") {
      screen.orientation.unlock();
    }
  } catch (_) {}

  updateRotateOverlay();
}

function applyUIMode(mode, opts = {}) {
  const nextMode = mode === "landscape" ? "landscape" : "portrait";
  uiMode = nextMode;
  document.body.classList.remove("mode-portrait", "mode-landscape");
  document.body.classList.add(`mode-${nextMode}`);
  document.documentElement.dataset.uiMode = nextMode;
  if (opts.persist !== false) saveUIMode(nextMode);
  syncModeButtons();
  renderAll();
  updateRotateOverlay();
}

function syncModeButtons() {
  const switchBtn = $("btnModeSwitch");
  if (switchBtn) {
    switchBtn.textContent = uiMode === "landscape" ? "转换竖屏" : "转换横屏";
  }
  const endTurnBtn = $("btnEndTurn");
  if (endTurnBtn) {
    endTurnBtn.textContent = uiMode === "landscape" ? "结束回合" : "结束回合";
  }
}

function showModeChooser() {
  openOverlay(`
    <div class="introBrand">FLAP 作品</div>
    <h2>选择显示模式</h2>
    <p>请选择适合你设备的界面模式，之后可随时切换。</p>
    <div class="grid2" style="margin-top:12px">
      <button class="btnGood modePickBtn" id="pickPortraitBtn">进入竖屏模式</button>
      <button class="btnDanger modePickBtn" id="pickLandscapeBtn">进入横屏模式</button>
    </div>
  `);
  $("pickPortraitBtn").onclick = async () => {
    closeOverlay();
    await releaseLandscapeLock();
    applyUIMode("portrait");
    showIntro();
  };
  $("pickLandscapeBtn").onclick = async () => {
    closeOverlay();
    applyUIMode("landscape");
    await requestLandscapeLock();
    showIntro();
  };
}

function determineWinnerByScore() {
  const blueAlive = aliveHeroes("blue");
  const redAlive = aliveHeroes("red");
  if (!blueAlive.length && !redAlive.length) {
    const blueTotal = state.heroes.filter(h => h.team === "blue" && !h.dead).reduce((sum, h) => sum + Math.max(h.hp, 0), 0);
    const redTotal = state.heroes.filter(h => h.team === "red" && !h.dead).reduce((sum, h) => sum + Math.max(h.hp, 0), 0);
    return blueTotal >= redTotal ? "blue" : "red";
  }
  if (!blueAlive.length) return "red";
  if (!redAlive.length) return "blue";
  const blueTotal = blueAlive.reduce((sum, h) => sum + h.hp, 0);
  const redTotal = redAlive.reduce((sum, h) => sum + h.hp, 0);
  if (blueTotal === redTotal) return state.activeTeam || "blue";
  return blueTotal > redTotal ? "blue" : "red";
}

function forceEndGame() {
  if (state.phase === "gameover") return;
  const winner = determineWinnerByScore();
  state.phase = "gameover";
  state.endSummary = buildSummary(winner);
  log(`【系统】手动结束游戏，当前判定获胜方：${TEAM[winner].name}。`);
  renderGameOverOverlay(winner);
}

// 核心游戏状态
const state = {
  phase: "intro",          // intro -> draft -> deploy -> battle -> gameover
  turn: 0,
  activeTeam: "blue",
  firstTeam: Math.random() < 0.5 ? "blue" : "red",
  selectedUid: null,
  selectedMode: "move",    // move | attack | skill
  pendingAction: null,     // { kind:'skillTarget'/'direction'/'attackTarget', ... }
  draft: {
    currentTeam: null,
    picks: { blue: [], red: [] }
  },
  deploy: {
    currentTeam: null,
    selectedDraftHero: null,
    placed: { blue: [], red: [] }
  },
  heroes: [],
  effects: [],
  fx: [],
  sukunaLineFx: [],
  barriers: [],
  logs: [],
  floatingTexts: [],
  gojoFx: [],
  suspendGameOverCheck: false,
  // 记录上一回合结束时剩余的行动点数（给五条悟的无下限防御使用）
  lastUnusedAp: { blue: 0, red: 0 },
  // 每个阵营自己的回合计数，用来控制“自动回复 + 逐回合上涨”的行动点数
  turnCount: { blue: 0, red: 0 },
  // 当前回合该阵营的行动点数上限（用于 UI 显示）
  apMax: { blue: 0, red: 0 },
  bonusTurn: null,         // 额外回合 / 特殊回合用的占位字段
  endSummary: null
};

// ----------------------
// 英雄实例化
// ----------------------
let uidCounter = 1;

function createHeroInstance(defId, team) {
  const def = HERO_DEFS[defId];
  return {
    uid: `H${uidCounter++}`,
    defId,
    name: def.name,
    team,
    x: null,
    y: null,
    placed: false,
    dead: false,
    phase2: false,      // 只给宿傩用，其他英雄无影响
    hp: def.maxHp,
    maxHp: def.maxHp,
    atk: def.atk,
    baseAtk: def.atk,
    attackRange: def.attackRange,
    attackCost: def.attackCost,
    moveOnceUsed: 0,    // 射手技能2：每回合可移动次数
    moveCostOverride: null,
    tempAtkBonus: 0,    // 剑仙技能1临时加攻
    frozenTurns: 0,
    rootedTurns: 0,
    stunnedTurns: 0,    // 这种状态相当于“无法行动”
    burnTurns: 0,
    marks: [],
    gojoMarks: { blue: null, red: null },
    gojoBlock: 0,       // 五条被动存档
    swordMarks: [],     // 剑仙“剑”标记
    swordDomain: null,
    sukunaPhase: 0,
    stats: {
      dealt: 0,
      taken: 0,
      reduced: 0
    },
    buffs: {
      mountainShield: 0,   // 受到伤害 -1 的次数/层数
      archerFreeMove: 0,    // 射手移动 0 消耗的持续回合数
      archerFreeMoveLeft: 0 // 每回合还能移动几次
    },
    turnsUsed: 0,
    attackTimesThisTurn: 0
  };
}

// ----------------------
// 日志与渲染辅助
// ----------------------
function log(msg) {
  state.logs.unshift(`[T${state.turn}] ${msg}`);
  state.logs = state.logs.slice(0, 60);
  renderLog();
}

function renderLog() {
  const el = $("log");
  if (!el) return;
  el.innerHTML = state.logs.map(s => `<div>${escapeHtml(s)}</div>`).join("");
  el.scrollTop = 0;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function heroDef(hero) {
  return HERO_DEFS[hero.defId];
}

function heroAvatar(hero) {
  const def = hero ? heroDef(hero) : null;
  if (!def) return "";
  if (hero && hero.phase2 && def.phase2Avatar) return def.phase2Avatar;
  return def.avatar || "";
}

function imgWithFallback(src, alt, className, fallbackHtml) {
  if (!src) return fallbackHtml || "";
  const classAttr = className ? ` class="${className}"` : "";
  const safeSrc = escapeHtml(src);
  const safeAlt = escapeHtml(alt || "");
  const fallback = fallbackHtml ? fallbackHtml : "";
  return `<img${classAttr} src="${safeSrc}" alt="${safeAlt}" draggable="false" onerror="this.style.display='none';const fb=this.nextElementSibling;if(fb)fb.classList.remove('hidden')">${fallback}`;
}

function heroAvatarMarkup(hero, kind = "avatar") {
  const def = hero ? heroDef(hero) : null;
  const src = heroAvatar(hero);
  const letter = escapeHtml((hero?.name || def?.name || "?").slice(0, 1));

  if (kind === "unit") {
    const blockBadge = hero?.defId === "gojo" ? `<div class="unitBlockBadge">防御 ${hero.gojoBlock || 0}</div>` : "";
    return `<div class="unitAvatarWrap"><div class="unitAvatarShell">${imgWithFallback(src, `${escapeHtml(hero?.name || def?.name || '英雄')}头像`, 'unitAvatar', `<div class="unitAvatarFallback hidden">${letter}</div>`)}</div>${blockBadge}</div>`;
  }

  if (kind === "pick") {
    return `<div class="pickAvatar">${imgWithFallback(src, `${escapeHtml(hero?.name || def?.name || '英雄')}头像`, 'pickAvatarImg', `<span class="pickAvatarFallback hidden">${letter}</span>`)}</div>`;
  }

  const team = hero?.team || def?.teamColor || "blue";
  const blockBadge = hero?.defId === "gojo" ? `<div class="avatarBlockBadge">防御 ${hero.gojoBlock || 0}</div>` : "";
  return `<div class="avatarWrap"><div class="avatar ${escapeHtml(team)}">${imgWithFallback(src, `${escapeHtml(hero?.name || def?.name || '英雄')}头像`, 'avatarImg', `<div class="avatarFallback hidden">${letter}</div>`)}</div>${blockBadge}</div>`;
}
function heroPortraitMarkup(hero) {
  const def = hero ? heroDef(hero) : null;
  const infoSrc = hero ? `info_avatars/${hero.defId}${hero.phase2 ? "_phase2" : ""}.png` : "";
  const letter = escapeHtml((hero?.name || def?.name || "?").slice(0, 1));
  return `<div class="heroPortraitShell">${imgWithFallback(infoSrc, `${escapeHtml(hero?.name || def?.name || "英雄")}立绘`, "heroPortraitImg", `<div class="heroPortraitFallback hidden">${letter}</div>`)}</div>`;
}

function visibleSkills(hero) {
  if (!hero) return [];
  const def = heroDef(hero);
  if (!def || !Array.isArray(def.skills)) return [];
  return def.skills.filter(s => hero.phase2 ? !s.phase1Only : !s.phase2Only);
}

function heroEffectAsset(hero, kind) {
  const def = hero ? heroDef(hero) : null;
  if (!def || !def.effects) return "";
  return def.effects[kind] || "";
}

function ensureGojoMarks(hero) {
  if (!hero) return null;
  if (!hero.gojoMarks) hero.gojoMarks = { blue: null, red: null };
  return hero.gojoMarks;
}

function gojoMarkAt(x, y) {
  return state.heroes
    .filter(h => h.defId === 'gojo' && h.gojoMarks)
    .flatMap(h => [
      h.gojoMarks.blue ? { ...h.gojoMarks.blue, type: 'gojoBlue', owner: h.uid } : null,
      h.gojoMarks.red ? { ...h.gojoMarks.red, type: 'gojoRed', owner: h.uid } : null
    ])
    .filter(Boolean)
    .find(m => m.x === x && m.y === y) || null;
}

function setGojoMark(hero, kind, x, y) {
  const marks = ensureGojoMarks(hero);
  if (!marks) return null;
  marks[kind] = { x, y };
  return marks[kind];
}

function clearGojoMarks(hero) {
  const marks = ensureGojoMarks(hero);
  if (!marks) return;
  marks.blue = null;
  marks.red = null;
}

function ensureSwordMarks(hero) {
  if (!hero) return null;
  if (!Array.isArray(hero.swordMarks)) hero.swordMarks = [];
  return hero.swordMarks;
}

function addSwordMark(hero, x, y) {
  const marks = ensureSwordMarks(hero);
  if (!marks) return null;
  const existing = marks.find(m => m.x === x && m.y === y);
  if (existing) {
  existing.count = (existing.count || 1) + 1;
    return existing;
  }
  const mark = { x, y, count: 1 };
  marks.push(mark);
  return mark;
}

function consumeSwordMark(hero) {
  const marks = ensureSwordMarks(hero);
  if (!marks || !marks.length) return false;
  const mark = marks.find(m => (m.count || 1) > 0);
  if (!mark) return false;
  mark.count = (mark.count || 1) - 1;
  if (mark.count <= 0) {
    const idx = marks.indexOf(mark);
    if (idx >= 0) marks.splice(idx, 1);
  }
  return true;
}
function gojoSkillCells(hero, skillNo) {
  if (!hero || hero.defId !== 'gojo') return [];
  const cells = [];
  if (skillNo === 2) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = hero.x + dx;
        const y = hero.y + dy;
        if (!inBounds(x, y)) continue;
        if (dx === 0 && dy === 0) continue;
        const occupant = heroAt(x, y);
        if (occupant && occupant.team === hero.team) continue;
        cells.push({ x, y });
      }
    }
  }
  if (skillNo === 3) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.max(Math.abs(x - hero.x), Math.abs(y - hero.y)) > 3) continue;
        const occupant = heroAt(x, y);
        if (!occupant || occupant.team === hero.team) continue;
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

function gojoMarkSummary(hero) {
  const marks = ensureGojoMarks(hero);
  if (!marks) return '无';
  const parts = [];
  if (marks.blue) parts.push(`苍(${marks.blue.x},${marks.blue.y})`);
  if (marks.red) parts.push(`赫(${marks.red.x},${marks.red.y})`);
  return parts.length ? parts.join(' | ') : '无';
}

function spawnFx(x, y, src, ttl = 560) {
  if (!src) return;
  const id = `fx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.fx.push({ id, x, y, src });
  renderAll();
  window.setTimeout(() => {
    state.fx = state.fx.filter(f => f.id !== id);
    renderAll();
  }, ttl);
}

function spawnCombatFx(source, target) {
  if (!source || !target) return;
  const attackSrc = heroEffectAsset(source, 'attack');
  const hitSrc = heroEffectAsset(source, 'hit');
  const sx = source.x, sy = source.y;
  const tx = target.x, ty = target.y;
  if (attackSrc) spawnFx(sx, sy, attackSrc, 620);
  if (hitSrc) spawnFx(tx, ty, hitSrc, 620);
}

function spawnFloatingText(x, y, text, ttl = 2000, className = "domainFloatText") {
  const id = `txt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.floatingTexts.push({ id, x, y, text, className });
  renderAll();
  window.setTimeout(() => {
    state.floatingTexts = state.floatingTexts.filter(t => t.id !== id);
    renderAll();
  }, ttl);
}

function spawnSukunaSlashFx(lines, ttl = 2000) {
  if (!Array.isArray(lines) || !lines.length) return;
  const id = `slash-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.sukunaLineFx.push({ id, lines });
  renderAll();
  window.setTimeout(() => {
    state.sukunaLineFx = state.sukunaLineFx.filter(f => f.id !== id);
    renderAll();
  }, ttl);
}

function pushGojoFx(effect, ttl = 900) {
  const id = effect.id || `gfx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.gojoFx.push({ ...effect, id });
  renderAll();
  window.setTimeout(() => {
    state.gojoFx = state.gojoFx.filter(f => f.id !== id);
    renderAll();
  }, ttl);
}

function spawnGojoMizushiFx(markA, markB, center) {
  if (!markA || !markB || !center) return;
  pushGojoFx({ type: 'line', from: markA, to: markB }, 1100);
  window.setTimeout(() => {
    pushGojoFx({ type: 'pull', from: markA, to: center, color: 'blue' }, 820);
    pushGojoFx({ type: 'pull', from: markB, to: center, color: 'red' }, 820);
  }, 140);
  window.setTimeout(() => {
    pushGojoFx({ type: 'core', at: center }, 520);
  }, 560);
  window.setTimeout(() => {
    pushGojoFx({ type: 'boom', at: center }, 720);
  }, 860);
}

function addSukunaMark(hero, x, y) {
  if (!hero || hero.dead || hero.defId !== 'sukuna' || hero.phase2) return false;
  if (!Array.isArray(hero.marks)) hero.marks = [];
  const k = keyOf(x, y);
  if (hero.marks.some(m => keyOf(m.x, m.y) === k)) return false;
  hero.marks.push({ x, y });
  return true;
}

function heroByUid(uid) {
  return state.heroes.find(h => h.uid === uid) || null;
}

function maybeTriggerSukunaPhase(hero) {
  if (!hero || hero.defId !== "sukuna") return;
  if (hero.hp > 0 || hero.phase2) return;

  hero.phase2 = true;
  hero.hp = 10;
  hero.maxHp = 10;
  hero.atk = 2;
  hero.attackCost = 2;
  hero.dead = false;
  hero.marks = [];
  state.sukunaLineFx = [];
  log(`【${hero.name}】进入二阶段：神武解！生命恢复至 10，攻击力提升至 2。`);
}

function heroAt(x, y) {
  return state.heroes.find(h => !h.dead && h.placed && h.x === x && h.y === y) || null;
}

function teamHeroes(team) {
  return state.heroes.filter(h => h.team === team);
}

function aliveHeroes(team) {
  return teamHeroes(team).filter(h => !h.dead);
}

function selectedHero() {
  return heroByUid(state.selectedUid);
}

function teamAP(team) {
  return state.ap?.[team] ?? 0;
}

function apText(team) {
  return `${teamAP(team)} / ${state.apMax?.[team] ?? 0}`;
}

function skillIcon(skill) {
  if (!skill) return '<span class="skillIconFallback">?</span>';
  const label = skill.costText === "被动" ? "被" : `S${skill.no}`;
  return imgWithFallback(skill.icon || "", skill.title || "技能图标", "skillIconImg", `<span class="skillIconFallback hidden">${escapeHtml(label)}</span>`);
}

// ----------------------
// 规则与开始界面
// ----------------------
function openOverlay(html) {
  $("overlayContent").innerHTML = html;
  $("overlay").classList.add("show");
}

function closeOverlay() {
  $("overlay").classList.remove("show");
  $("overlayContent").innerHTML = "";
}

function showIntro() {
  state.phase = "intro";
  const rulesHtml = `
    <div class="introBrand">FLAP 作品</div>
    <h2>游戏规则</h2>
    <div class="ruleBox">
      <strong>基础规则</strong>
      <ul class="ruleList">
        ${GAME_RULES.map(r => `<li>${escapeHtml(r)}</li>`).join("")}
      </ul>
    </div>
    <div class="ruleBox" style="margin-top:10px">
      <strong>操作说明</strong>
      <ul class="ruleList">
        <li>点击英雄进行选择。</li>
        <li>选中英雄后，点击空地移动，点击敌方进行普通攻击。</li>
        <li>选中英雄后，底部会显示技能按钮与说明。</li>
        <li>如果你看到了“没有这个技能”，通常表示该英雄本身没有对应技能编号。</li>
        <li>部署阶段可以使用“随机部署当前阵营”按钮，自动帮你摆放当前阵营英雄。</li>
      </ul>
    </div>
    <div class="overlayActions">
      <button class="btnGood" id="startGameBtn">开始游戏</button>
    </div>
  `;
  openOverlay(rulesHtml);
  $("startGameBtn").onclick = () => {
    closeOverlay();
    startDraft();
  };
}

// ----------------------
// 选择英雄：草案阶段
// ----------------------
function startDraft() {
  state.phase = "draft";
  state.draft.currentTeam = state.firstTeam;
  state.draft.picks = { blue: [], red: [] };
  state.deploy.placed = { blue: [], red: [] };
  state.heroes = [];
  uidCounter = 1;
  state.selectedUid = null;
  state.selectedMode = "move";
  state.pendingAction = null;
  state.effects = [];
  state.fx = [];
  state.sukunaLineFx = [];
  state.gojoFx = [];
  state.floatingTexts = [];
  state.barriers = [];
  state.bonusTurn = null;
  state.logs = [];
  state.turn = 0;
  state.ap = { blue: 0, red: 0 };
  state.turnCount = { blue: 0, red: 0 };
  state.apMax = { blue: 0, red: 0 };
  renderAll();
  renderDraftOverlay();
}

function renderDraftOverlay() {
  const team = state.draft.currentTeam;
  const pickedCount = state.draft.picks[team].length;

  const heroCards = Object.entries(HERO_DEFS).map(([id, def]) => {
    const disabled = state.draft.picks[team].includes(id);
    const pickedBlue = state.draft.picks.blue.includes(id);
    const pickedRed = state.draft.picks.red.includes(id);
    const pickClasses = [
      disabled ? "disabled" : "",
      pickedBlue ? "pickedBlue" : "",
      pickedRed ? "pickedRed" : "",
      (pickedBlue && pickedRed) ? "pickedBoth" : ""
    ].filter(Boolean).join(" ");
    const tags = [];
    if (pickedRed) tags.push('<span class="pickTag red">红方已选</span>');
    if (pickedBlue) tags.push('<span class="pickTag blue">蓝方已选</span>');
    if (pickedBlue && pickedRed) tags.push('<span class="pickTag both">双方已选</span>');
    return `
      <div class="heroCard heroPick ${pickClasses}" data-id="${id}">
        <div class="pickAvatar">
          ${imgWithFallback(def.avatar || "", `${escapeHtml(def.name)}头像`, "pickAvatarImg", `<span class="pickAvatarFallback hidden">${escapeHtml(def.name.slice(0,1))}</span>`)}
        </div>
        <strong>${def.name}</strong>
        <div class="small">${escapeHtml(def.spawnHint)}</div>
        <div class="small" style="margin-top:6px">HP ${def.maxHp} / 攻击 ${def.atk} / 普攻范围 ${def.attackRange}</div>
        ${tags.length ? `<div class="pickTagRow">${tags.join("")}</div>` : ""}
      </div>
    `;
  }).join("");

  openOverlay(`
    <h2>英雄选择</h2>
    <div class="draftToolbar">
      <p>当前轮到：<strong>${TEAM[team].name}</strong> 选择第 ${pickedCount + 1} 位英雄。</p>
      <button class="btnGhost draftRandomBtn" id="randomPickBtn">随机选择</button>
    </div>
    <div class="small">提示：同一方不能重复选择同一英雄；但双方可以选择同一个英雄类型。</div>
    <div class="grid2" style="margin-top:12px">
      ${heroCards}
    </div>
    <div class="overlayActions">
      <button class="btnGhost" id="backIntroBtn">查看规则</button>
    </div>
  `);

  $("backIntroBtn").onclick = showIntro;
  const randomPickBtn = $("randomPickBtn");
  if (randomPickBtn) randomPickBtn.onclick = () => chooseRandomDraftHero();

  document.querySelectorAll(".heroPick:not(.disabled)").forEach(el => {
    el.addEventListener("click", () => chooseDraftHero(el.dataset.id));
  });
}


function chooseRandomDraftHero() {
  const team = state.draft.currentTeam;
  const candidates = Object.keys(HERO_DEFS).filter(id => !state.draft.picks[team].includes(id));
  if (!candidates.length) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  chooseDraftHero(pick);
}

function chooseDraftHero(heroId) {
  const team = state.draft.currentTeam;
  if (state.draft.picks[team].includes(heroId)) return;

  state.draft.picks[team].push(heroId);
  log(`${TEAM[team].name} 选择了【${HERO_DEFS[heroId].name}】。`);

  if (state.draft.picks.blue.length === 3 && state.draft.picks.red.length === 3) {
    closeOverlay();
    startDeployment();
    return;
  }

  state.draft.currentTeam = otherTeam(team);
  renderDraftOverlay();
}

// ----------------------
// 选择英雄：部署阶段
// ----------------------
function startDeployment() {
  state.phase = "deploy";
  state.deploy.currentTeam = state.firstTeam;

  // 根据 draft 结果，生成双方英雄实例。
  state.heroes = [
    ...state.draft.picks.blue.map(id => createHeroInstance(id, "blue")),
    ...state.draft.picks.red.map(id => createHeroInstance(id, "red"))
  ];

  // 先把所有英雄标记为未部署。
  state.heroes.forEach(h => {
    h.placed = false;
    h.x = null;
    h.y = null;
  });

  renderAll();
  renderDeployOverlay();
}

function undeployedHeroes(team) {
  return teamHeroes(team).filter(h => !h.placed && !h.dead);
}

function renderDeployOverlay() {
  const team = state.deploy.currentTeam;
  const list = undeployedHeroes(team);

  if (!list.length) {
    const nextTeam = otherTeam(team);
    if (undeployedHeroes(nextTeam).length) {
      state.deploy.currentTeam = nextTeam;
      renderDeployOverlay();
      return;
    }
    closeOverlay();
    startBattle();
    return;
  }

  const heroButtons = list.map(h => {
    const def = heroDef(h);
    const selected = state.deploy.selectedDraftHero?.uid === h.uid;
    return `
      <div class="heroCard heroPick ${selected ? "selected" : ""}" data-uid="${h.uid}">
        ${heroAvatarMarkup(h, "pick")}
        <strong>${h.name}</strong>
        <div class="small">${escapeHtml(def.spawnHint)}</div>
        <div class="small">HP ${h.maxHp} / 攻击 ${h.baseAtk}</div>
      </div>
    `;
  }).join("");

  const spawnCells = (team === "blue" ? ["0,0","0,1","1,0","1,1","2,0","2,1"] : ["6,2","6,3","7,2","7,3","8,2","8,3"])
    .map(key => {
      const [x, y] = key.split(",").map(Number);
      const occupied = heroAt(x, y);
      return `
        <div class="cell ${team === "blue" ? "spawnBlue" : "spawnRed"} ${occupied ? "selected" : ""}" data-x="${x}" data-y="${y}">
          <span class="coord">${x},${y}</span>
        </div>
      `;
    }).join("");

  openOverlay(`
    <h2>英雄部署</h2>
    <p>当前轮到：<strong>${TEAM[team].name}</strong> 放置英雄。</p>
    <div class="small">先点左侧英雄，再点对应出生区格子。每个英雄只需部署一次。</div>

    <div class="grid2" style="margin-top:12px">
      <div class="heroCard">
        <strong>待部署英雄</strong>
        <div class="grid2">
          ${heroButtons}
        </div>
      </div>
      <div class="heroCard">
        <strong>出生区（可点击格子）</strong>
        <div class="grid deployGrid">
          ${spawnCells}
        </div>
      </div>
    </div>

    <div class="overlayActions">
      <button class="btnWarn" id="randomDeployBtn">随机部署当前阵营</button>
      <button class="btnGhost" id="switchDeployBtn">切换到另一方</button>
    </div>
  `);

  $("switchDeployBtn").onclick = () => {
    state.deploy.currentTeam = otherTeam(state.deploy.currentTeam);
    state.deploy.selectedDraftHero = null;
    renderDeployOverlay();
  };

  $("randomDeployBtn").onclick = () => {
    autoDeployCurrentTeam();
  };

  document.querySelectorAll("[data-uid]").forEach(el => {
    el.addEventListener("click", () => {
      const uid = el.dataset.uid;
      state.deploy.selectedDraftHero = heroByUid(uid);
      renderDeployOverlay();
    });
  });

  document.querySelectorAll("[data-x]").forEach(el => {
    el.addEventListener("click", () => {
      const hero = state.deploy.selectedDraftHero;
      if (!hero) return;
      if (hero.team !== state.deploy.currentTeam) return;

      const x = Number(el.dataset.x);
      const y = Number(el.dataset.y);
      const allowed = (hero.team === "blue" ? BLUE_SPAWN : RED_SPAWN).has(keyOf(x, y));
      if (!allowed) return;
      if (heroAt(x, y)) return;

      hero.x = x;
      hero.y = y;
      hero.placed = true;
      state.deploy.selectedDraftHero = null;
      log(`【${TEAM[hero.team].name}】部署【${hero.name}】到 (${x},${y})。`);

      if (!undeployedHeroes(state.deploy.currentTeam).length) {
        const nextTeam = otherTeam(state.deploy.currentTeam);
        if (undeployedHeroes(nextTeam).length) {
          state.deploy.currentTeam = nextTeam;
        }
      }

      renderDeployOverlay();
      renderAll();
    });
  });
}


function autoDeployCurrentTeam() {
  const team = state.deploy.currentTeam;
  const pool = undeployedHeroes(team);
  if (!pool.length) {
    renderDeployOverlay();
    return;
  }

  const spawnList = Array.from(team === "blue" ? BLUE_SPAWN : RED_SPAWN)
    .map(k => {
      const [x, y] = k.split(",").map(Number);
      return { x, y };
    })
    .filter(c => !heroAt(c.x, c.y));

  for (let i = spawnList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spawnList[i], spawnList[j]] = [spawnList[j], spawnList[i]];
  }

  pool.forEach((hero, idx) => {
    const cell = spawnList[idx];
    if (!cell) return;
    hero.x = cell.x;
    hero.y = cell.y;
    hero.placed = true;
    log(`${TEAM[hero.team].name} 随机部署了【${hero.name}】到 (${cell.x},${cell.y})。`);
  });

  state.deploy.selectedDraftHero = null;
  state.deploy.currentTeam = otherTeam(team);

  renderDeployOverlay();
  renderAll();
}

function startBattle() {
  state.phase = "battle";
  state.turn = 1;
  state.sukunaLineFx = [];
  state.floatingTexts = [];
  state.activeTeam = state.firstTeam;

  // 首回合进入战斗。真实的行动点数刷新规则在 beginTurn() 中统一处理。
  log(`随机决定先手：${TEAM[state.firstTeam].name}。`);

  // 进入第一个回合前，先处理开局状态。
  beginTurn(state.activeTeam, { initial: true });
  renderAll();
}

// ----------------------
// 回合推进
// ----------------------
function beginTurn(team, opts = {}) {
  state.activeTeam = team;
  state.turn += opts.initial ? 0 : 1;
  state.selectedUid = null;
  state.pendingAction = null;
  state.selectedMode = "move";

  /*
    行动点数规则：
    1) 每个阵营只在自己的回合开始时自动回复行动点数。
    2) 行动点数会随着该阵营自己的常规回合逐步上涨，最高 10 点。
    3) 首回合统一显示为 2 点。
    4) 五条悟的额外回合不抬高永久上限，只临时给 4 点行动点数。
  */
  const isBonusTurn = !!(state.bonusTurn && state.bonusTurn.team === team && !state.bonusTurn.used && state.bonusTurn.extra);

  if (opts.initial) {
    state.turnCount[team] = 1;
    state.apMax[team] = 2;
    state.ap[team] = 2;
  } else if (isBonusTurn) {
    state.apMax[team] = 4;
    state.ap[team] = 4;
    log(`【${TEAM[team].name}】额外回合：行动点数 4 / 4。`);
    state.bonusTurn.used = true;
  } else {
    state.turnCount[team] += 1;
    state.apMax[team] = clamp(state.turnCount[team] + 1, 2, 10);
    state.ap[team] = state.apMax[team];
  }

  // 回合开始前：处理所有“在本方回合开始时触发”的效果。
  processStartOfTurnEffects(team);

  // 记录上一回合剩余行动点数，用于五条悟被动防御。
  const unused = state.lastUnusedAp[team] ?? 0;
  teamHeroes(team).forEach(h => {
    if (h.dead) return;
    if (h.defId === "gojo") {
      h.gojoBlock = Math.min(unused, 4);
    }
  });

  // 处理每个英雄的本回合准备：
  teamHeroes(team).forEach(h => {
    if (h.dead) return;
    h.attackTimesThisTurn = 0;
    h.moveOnceUsed = 0;
    h.tempAtkBonus = 0;
    h.turnsUsed += 1;
  });

  updateHud();
  renderAll();
  log(`【${TEAM[team].name}】回合开始，行动点数 ${apText(team)}。`);
  checkGameOver();
}

function endTurn() {
  if (state.phase !== "battle") return;

  // 结束当前队伍的回合前，记录残余 AP 供五条防御使用。
  const current = state.activeTeam;
  const next = otherTeam(current);
  state.lastUnusedAp[current] = state.ap[current];
  state.selectedUid = null;
  state.pendingAction = null;
  state.selectedMode = "move";

  // 宿傩固定每回合受到 1 点真实伤害
  teamHeroes(current).forEach(h => {
    if (!h.dead && h.defId === "sukuna") {
      applyDamage(null, h, 1, "宿傩回合固定伤害");
    }
  });

  clearExpiredTemporaryEffects(current);

  if (checkGameOver()) return;

  beginTurn(next);
}

// ----------------------
// 开始/结算时的持续效果处理
// ----------------------
function processStartOfTurnEffects(team) {
  // 1) 先处理场上所有“到点触发”的延迟效果
  const currentTurn = state.turn; // 当前回合编号，用于结算“下回合开始”触发的效果
  const toResolve = state.effects.filter(e => e.triggerTurn === currentTurn);

  toResolve.forEach(effect => {
    resolveDelayedEffect(effect);
  });

  // 触发后删除已结算效果
  state.effects = state.effects.filter(e => !e.triggerTurn || e.triggerTurn > currentTurn);

  // 2) 处理 burn / freeze / root 之类的持续状态
  state.heroes.forEach(h => {
    if (h.dead || !h.placed) return;

    // 灼烧：每回合开始时造成 1 点伤害，持续若干回合（夜神为 3 回合）
    if (h.burnTurns > 0) {
      h.burnTurns -= 1;
      applyDamage(null, h, 1, "灼烧");
    }

    // 冻结：回合开始时减少 1，并在冻结期间无法行动
    if (h.frozenTurns > 0) {
      h.frozenTurns -= 1;
    }

    // 缠绕：只是限制技能，不限制移动和普通攻击；回合递减
    if (h.rootedTurns > 0) {
      h.rootedTurns -= 1;
    }

    // 射手的“0 AP 移动”持续回合数递减
    if (h.buffs.archerFreeMove > 0) {
      h.buffs.archerFreeMove -= 1;
      if (h.buffs.archerFreeMove === 0) {
        h.buffs.archerFreeMoveLeft = 0;
      }
    }
  });

  state.effects.forEach(effect => {
    if (effect.type !== "swordDomain") return;
    if (currentTurn < effect.nextTurn || currentTurn > effect.endTurn) return;
    const owner = heroByUid(effect.ownerUid);
    if (!owner || owner.dead) return;
    const targets = state.heroes.filter(h => !h.dead && h.placed && h.team !== owner.team && Math.abs(h.x - effect.x) + Math.abs(h.y - effect.y) <= effect.radius);
    targets.forEach(t => {
      applyDamage(owner, t, 1, "万剑归宗");
      addSwordMark(owner, t.x, t.y);
    });
    effect.nextTurn = currentTurn + 1;
  });
  state.effects = state.effects.filter(effect => !(effect.type === "swordDomain" && currentTurn > effect.endTurn));

  // 3) 处理山脉之神的减伤光环（如果有）
  // 这里不做回合扣减，因为其持续由 effect 控制。
}

// ----------------------
// 临时效果清理
// ----------------------
function clearExpiredTemporaryEffects(currentTeam) {
  // 这里用来清理“本回合结束就失效”的临时增益
  state.heroes.forEach(h => {
    if (h.dead) return;
    if (h.team === currentTeam) {
      h.tempAtkBonus = 0; // 剑仙的临时加攻自然失效
    }
  });

  // 射手轻步潜行以回合数控制，不在这里清理。
}

// ----------------------
// 结束判定与结算
// ----------------------
function checkGameOver() {
  const blueAlive = aliveHeroes("blue").length;
  const redAlive = aliveHeroes("red").length;

  if (blueAlive > 0 && redAlive > 0) return false;

  state.phase = "gameover";
  const winner = blueAlive > 0 ? "blue" : "red";
  state.endSummary = buildSummary(winner);
  renderGameOverOverlay(winner);
  return true;
}

function buildSummary(winner) {
  return {
    winner,
    heroes: state.heroes.map(h => ({
      uid: h.uid,
      name: h.name,
      team: h.team,
      dealt: h.stats.dealt,
      taken: h.stats.taken,
      reduced: h.stats.reduced,
      hp: h.hp,
      dead: h.dead
    }))
  };
}

function renderGameOverOverlay(winner) {
  const rows = state.heroes.map(h => `
    <tr class="${h.team}">
      <td>${h.name}</td>
      <td>${TEAM[h.team].name}</td>
      <td>${h.stats.dealt}</td>
      <td>${h.stats.taken}</td>
      <td>${h.stats.reduced}</td>
      <td>${h.dead ? "阵亡" : h.hp}</td>
    </tr>
  `).join("");

  openOverlay(`
    <h2>战斗结束</h2>
    <p>获胜方：<strong>${TEAM[winner].name}</strong></p>
    <div class="ruleBox">
      <strong>结算统计</strong>
      <table class="summaryTable">
        <thead>
          <tr>
            <th>英雄</th>
            <th>阵营</th>
            <th>总造成伤害</th>
            <th>总承伤</th>
            <th>总减伤</th>
            <th>最终状态</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <div class="overlayActions">
      <button class="btnGood" id="restartBtn">重新开始</button>
    </div>
  `);

  $("restartBtn").onclick = () => {
    closeOverlay();
    showIntro();
  };
}

// ----------------------
// 伤害与状态处理
// ----------------------
// 统一伤害入口：普攻、技能、领域、灼烧都尽量走这里，方便统计总伤害 / 承伤 / 减伤。
function applyDamage(source, target, rawDamage, reason = "伤害") {
  if (!target || target.dead) return { dealt: 0, reduced: 0, final: 0 };

  let reduction = 0;

  // 五条悟被动：拿上回合未用完行动点作为防御。
  if (target.defId === "gojo" && target.gojoBlock > 0 && rawDamage > 0) {
    const blocked = Math.min(target.gojoBlock, rawDamage);
    target.gojoBlock -= blocked;
    reduction += blocked;
  }

  // 山脉之神的减伤光环：只要命中范围内的友方单位，受到伤害 -1。
  const mountainReductions = getMountainDamageReduction(target);
  reduction += mountainReductions;

  let finalDamage = Math.max(0, rawDamage - reduction);

  if (target.defId === "sword" && rawDamage > 0 && finalDamage >= target.hp) {
    if (consumeSwordMark(target)) {
      const prevented = finalDamage - Math.max(target.hp - 1, 0);
      finalDamage = Math.max(target.hp - 1, 0);
      reduction += prevented;
      log(`【${target.name}】消耗 1 个“剑”标记抵挡了致命伤害。`);
    }
  }

  if (finalDamage > 0) {
    target.hp -= finalDamage;
    target.stats.taken += finalDamage;
    if (source) source.stats.dealt += finalDamage;
    if (source) spawnCombatFx(source, target);
    log(`${source ? source.name : "系统"} 对 ${target.name} 造成 ${finalDamage} 点${reason === "伤害" ? "伤害" : reason}。`);
    if (source && source.defId === "sword" && finalDamage > 0) {
      const healed = Math.ceil(finalDamage / 2);
      source.hp = Math.min(source.maxHp, source.hp + healed);
      log(`【${source.name}】触发剑心回响，回复 ${healed} 点生命。`);
    }
  } else {
    log(`${target.name} 完全抵挡了这次${reason}。`);
  }

  if (reduction > 0) {
    target.stats.reduced += reduction;
  }

  // 宿傩标记：对自己受伤位置、以及自己造成伤害的位置进行标记；二阶段不再留一二技能的标记
  if (target.defId === "sukuna" && !target.phase2) {
    addSukunaMark(target, target.x, target.y);
  }
  if (source && source.defId === "sukuna" && !source.phase2 && finalDamage > 0) {
    addSukunaMark(source, target.x, target.y);
  }
  if (source && source.defId === "sukuna" && source.phase2 && finalDamage > 0) {
    target.rootedTurns = Math.max(target.rootedTurns, 2);
    log(`【${source.name}】触发原身之恶：目标进入禁锢 2 回合。`);
  }

  // 如果生命降到 0 以下，处理宿傩二阶段，或者正常死亡
  if (target.hp <= 0) {
    if (target.defId === "sukuna" && !target.phase2) {
      maybeTriggerSukunaPhase(target);
    } else {
      target.dead = true;
      log(`【${target.name}】阵亡。`);
    }
  }

  updateHud();
  renderAll();
  if (!state.suspendGameOverCheck) checkGameOver();
  return { dealt: finalDamage, reduced: reduction, final: finalDamage };
}

function applySelfHpCost(hero, amount, reason = "生命代价") {
  if (!hero || hero.dead) return;
  hero.hp -= amount;
  log(`【${hero.name}】消耗 ${amount} 点生命（${reason}）。`);
  maybeTriggerSukunaPhase(hero);
  if (hero.hp <= 0 && !hero.phase2) {
    hero.dead = true;
    log(`【${hero.name}】阵亡。`);
  }
  renderAll();
  checkGameOver();
}

function getMountainDamageReduction(target) {
  // 统计当前场上所有“山体庇护”效果中，对该目标有效的减伤层数。
  // 这里采用“在范围内且同阵营”的规则。
  let reduction = 0;
  for (const e of state.effects) {
    if (e.type !== "mountainShield") continue;
    if (e.team !== target.team) continue;
    if (e.triggerTurn && e.triggerTurn > state.turn + 1) continue;
    const d = Math.abs(target.x - e.x) + Math.abs(target.y - e.y);
    if (d <= e.radius) reduction += e.amount;
  }
  return reduction;
}

// ----------------------
// 延迟效果解析
// ----------------------
function resolveDelayedEffect(effect) {
  const owner = heroByUid(effect.ownerUid);
  if (!owner || owner.dead) return;

  if (effect.type === "gojoDomain") {
    let totalDamage = 0;
    state.heroes.forEach(h => {
      if (h.dead || !h.placed) return;
      if (h.uid === owner.uid) return;
      const d = Math.abs(h.x - effect.x) + Math.abs(h.y - effect.y);
      if (d <= effect.radius) {
        const result = applyDamage(owner, h, 2, "无量空处");
        totalDamage += result.final;
        h.frozenTurns = Math.max(h.frozenTurns, 2);
      }
    });

    log(`【${owner.name}】的领域在结算时总共造成 ${totalDamage} 点伤害。`);
    if (totalDamage > 7) {
      state.bonusTurn = { team: owner.team, used: false, extra: true };
      owner.__bonusTurnGranted = true;
      log(`${TEAM[owner.team].name} 获得额外一个回合（行动点数上限 4）。`);
    }
  }

  if (effect.type === "sukunaDomain") {
    state.heroes.forEach(h => {
      if (h.dead || !h.placed) return;
      if (h.uid === owner.uid) return;
      const d = Math.abs(h.x - effect.x) + Math.abs(h.y - effect.y);
      if (d <= effect.radius) {
        applyDamage(owner, h, 9, "神魔领域");
      }
    });
  }

  if (effect.type === "nightDomain") {
    state.heroes.forEach(h => {
      if (h.dead || !h.placed) return;
      if (h.team === owner.team) return;
      const d = Math.abs(h.x - effect.x) + Math.abs(h.y - effect.y);
      if (d <= effect.radius) {
        applyDamage(owner, h, 3, "赤夜领域");
        h.burnTurns = Math.max(h.burnTurns, 3);
      }
    });
  }

  if (effect.type === "mountainBarrier") {
    // 到点后屏障自然消失
  }

  if (effect.type === "archerFreeMove") {
    if (owner && !owner.dead) {
      owner.buffs.archerFreeMove = Math.max(owner.buffs.archerFreeMove, 2);
      owner.buffs.archerFreeMoveLeft = 2;
    }
  }

  if (effect.type === "mountainShield") {
    // 这个是持续型效果，统一在 getMountainDamageReduction 中处理
  }
}

// ----------------------
// 移动 / 攻击可达范围
// ----------------------
function canAct(hero) {
  if (!hero || hero.dead || !hero.placed) return false;
  if (hero.team !== state.activeTeam) return false;
  if (hero.frozenTurns > 0) return false;
  return true;
}

function canUseSkills(hero) {
  if (!canAct(hero)) return false;
  if (hero.rootedTurns > 0) return false; // 缠绕期间不能放技能
  return true;
}

function moveCost(hero, steps) {
  if (hero.defId === "archer" && hero.buffs.archerFreeMove > 0 && hero.buffs.archerFreeMoveLeft > 0) {
    return 0;
  }
  return steps;
}

function attackCost(hero) {
  // 第二次攻击比第一次多消耗 1 点
  return hero.attackTimesThisTurn === 0 ? hero.attackCost : hero.attackCost + 1;
}

function isInsideGojoDomain(hero, x, y) {
  return state.effects.some(e => {
    if (e.type !== "gojoDomain") return false;
    if (state.turn >= e.triggerTurn) return false;
    if (hero.uid === e.ownerUid) return false;
    const d = Math.abs(x - e.x) + Math.abs(y - e.y);
    return d <= e.radius;
  });
}

function isBlockedCell(x, y, movingHero) {
  // 英雄占位
  const occupied = heroAt(x, y);
  if (occupied && occupied.uid !== movingHero.uid) return true;

  // 山脉封路
  for (const e of state.effects) {
    if (e.type !== "mountainBarrier") continue;
    if (e.heroUid === movingHero.uid) continue; // 山神自己可以穿过自己封的路
    if (e.cells.some(c => c.x === x && c.y === y)) return true;
  }

  // 五条悟领域：领域内其他角色不能离开领域
  const currentInside = isInsideGojoDomain(movingHero, movingHero.x, movingHero.y);
  const nextInside = isInsideGojoDomain(movingHero, x, y);
  if (currentInside && !nextInside) return true;

  return false;
}

// BFS 找可移动格子
function reachableCells(hero) {
  const range = (hero.defId === "archer" && hero.buffs.archerFreeMove > 0 && hero.buffs.archerFreeMoveLeft > 0)
    ? 2
    : teamAP(hero.team);

  const visited = new Map();
  const q = [{ x: hero.x, y: hero.y, d: 0 }];
  visited.set(keyOf(hero.x, hero.y), 0);

  const result = [];
  while (q.length) {
    const cur = q.shift();
    if (cur.d >= range) continue;

    const dirs = [
      [1,0],[-1,0],[0,1],[0,-1]
    ];

    for (const [dx,dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nd = cur.d + 1;
      if (!inBounds(nx, ny)) continue;
      const k = keyOf(nx, ny);
      if (visited.has(k) && visited.get(k) <= nd) continue;
      if (isBlockedCell(nx, ny, hero)) continue;

      visited.set(k, nd);
      q.push({ x: nx, y: ny, d: nd });
      result.push({ x: nx, y: ny, d: nd });
    }
  }

  return result;
}

function attackTargets(hero) {
  return state.heroes.filter(t => t.team !== hero.team && !t.dead && t.placed && manhattan(hero, t) <= hero.attackRange);
}

function skillTargets(hero, skillNo) {
  // 根据不同英雄、不同技能返回可选择的目标
  const def = heroDef(hero);
  if (!def) return [];

  if (hero.defId === "sword" && skillNo === 2) {
    return state.heroes.filter(t => t.team !== hero.team && !t.dead && t.placed && manhattan(hero, t) <= 2);
  }

  if (hero.defId === "archer" && skillNo === 3) {
    return state.heroes.filter(t => t.team !== hero.team && !t.dead && t.placed && manhattan(hero, t) <= 1);
  }

  if (hero.defId === "night" && skillNo === 1) {
    return state.heroes.filter(t => t.team !== hero.team && !t.dead && t.placed && manhattan(hero, t) <= 2);
  }

  if (hero.defId === "gojo" && (skillNo === 2 || skillNo === 3)) {
    return skillCells(hero, skillNo).map(c => ({ x: c.x, y: c.y }));
  }

  if (hero.defId === "sukuna" && skillNo === 2) {
    return Array.isArray(hero.marks) ? hero.marks.map(m => ({ x: m.x, y: m.y })) : [];
  }

  return [];
}

function skillCells(hero, skillNo) {
  if (hero.defId === "gojo" && (skillNo === 2 || skillNo === 3)) return gojoSkillCells(hero, skillNo);
  return skillTargets(hero, skillNo);
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// ----------------------
// 渲染：整体
// ----------------------
// 统一渲染入口：任何状态变化后尽量调用这里，避免漏刷某个面板。
function renderAll() {
  const hero = selectedHero();
  renderHud();
  renderGrid();
  renderSelectedPanel(hero);
  renderSkillBar(hero);
  updateLandscapeOverlayState(hero);
}


function updateLandscapeOverlayState(hero) {
  const overlay = $("landscapeSkillOverlay");
  const logDock = document.querySelector(".logDock");
  if (!overlay || !logDock) return;

  const active = uiMode === "landscape" && !!hero && state.phase === "battle" && canAct(hero);
  overlay.classList.toggle("show", active);
  overlay.setAttribute("aria-hidden", active ? "false" : "true");
  logDock.classList.toggle("skillOverlayActive", active);

  const btn = $("btnEndTurnLandscape");
  if (btn) btn.style.display = uiMode === "landscape" ? "inline-flex" : "none";
}
function renderHud() {
  $("phaseBadge").textContent = `阶段：${phaseText(state.phase)}`;
  $("turnBadge").textContent = `回合：${state.turn}`;

  const turnBadge = $("turnTeamBadge");
  if (turnBadge) {
    turnBadge.textContent = `当前行动：${TEAM[state.activeTeam].name}`;
    turnBadge.className = `badge turn ${state.activeTeam}`;
  }

  const blueHud = $("blueHud");
  const redHud = $("redHud");
  if (blueHud) blueHud.textContent = `本方：蓝方 · 行动点 ${teamAP("blue")} / ${state.apMax.blue || 0}`;
  if (redHud) redHud.textContent = `本方：红方 · 行动点 ${teamAP("red")} / ${state.apMax.red || 0}`;

  const blueCard = $("blueCard");
  const redCard = $("redCard");
  if (blueCard && redCard) {
    blueCard.classList.toggle("teamActive", state.activeTeam === "blue");
    redCard.classList.toggle("teamActive", state.activeTeam === "red");
  }

  $("blueApBar").style.width = `${clamp((teamAP("blue") / Math.max(state.apMax.blue, 1)) * 100, 0, 100)}%`;
  $("redApBar").style.width = `${clamp((teamAP("red") / Math.max(state.apMax.red, 1)) * 100, 0, 100)}%`;

  $("blueSummary").textContent = aliveHeroes("blue").map(h => h.name).join("、") || "全员阵亡";
  $("redSummary").textContent = aliveHeroes("red").map(h => h.name).join("、") || "全员阵亡";
}

function phaseText(phase) {
  return {
    intro: "规则说明",
    draft: "英雄选择",
    deploy: "英雄部署",
    battle: "战斗中",
    gameover: "游戏结束"
  }[phase] || phase;
}

function renderGrid() {
  const grid = $("grid");
  if (!grid) return;

  const labelsX = $("boardLabelsX");
  const labelsY = $("boardLabelsY");

  if (labelsX) {
    labelsX.innerHTML = Array.from({ length: W }, (_, x) => `<span class="axisMark">${x}</span>`).join("");
  }
  if (labelsY) {
    labelsY.innerHTML = Array.from({ length: H }, (_, y) => `<span class="axisMark">${y}</span>`).join("");
  }

  grid.innerHTML = "";

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;

      const k = keyOf(x, y);
      if (BLUE_SPAWN.has(k)) cell.classList.add("spawnBlue");
      if (RED_SPAWN.has(k)) cell.classList.add("spawnRed");

      const hero = heroAt(x, y);
      const selected = selectedHero();

      if (selected && selected.uid === hero?.uid) {
        cell.classList.add("selected");
      }

      if (state.phase === "battle" && selected && canAct(selected) && !state.pendingAction) {
        const reach = reachableCells(selected);
        const targets = attackTargets(selected);
        if (reach.some(c => c.x === x && c.y === y)) cell.classList.add("moveHint");
        if (targets.some(t => t.x === x && t.y === y)) cell.classList.add("attackHint");
      }

      if (state.phase === "battle" && state.pendingAction && state.pendingAction.kind === "skillCell") {
        const p = state.pendingAction;
        const hero = heroByUid(p.heroUid);
        if (hero) {
          const cells = skillCells(hero, p.skillNo);
          if (cells.some(c => c.x === x && c.y === y)) cell.classList.add("targetHint");
        }
      }

      state.effects.forEach(e => {
        const within = (() => {
          if (e.type === "mountainBarrier") {
            return Array.isArray(e.cells) && e.cells.some(c => c.x === x && c.y === y);
          }
          const radius = typeof e.radius === "number" ? e.radius : 0;
          return Math.abs(x - e.x) + Math.abs(y - e.y) <= radius;
        })();

        if (!within) return;

        if (e.type === "gojoDomain") {
          cell.classList.add("domainHint", "domainGojo", "domainPulse");
        } else if (e.type === "sukunaDomain") {
          cell.classList.add("domainHint", "domainSukuna", "domainPulse");
        } else if (e.type === "nightDomain") {
          cell.classList.add("domainHint", "domainNight", "domainPulse");
        } else if (e.type === "swordDomain") {
          cell.classList.add("domainHint", "domainSword", "domainPulse");
        } else if (e.type === "mountainBarrier") {
          cell.classList.add("blockHint", "barrierHint");
        } else if (e.type === "mountainShield") {
          cell.classList.add("shieldHint");
        }
      });

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = `${x},${y}`;
      cell.appendChild(coord);

      if (hero) {
        const unit = document.createElement("div");
        unit.className = `unit ${hero.team} ${selected?.uid === hero.uid ? "selected" : ""}`;
        unit.innerHTML = `
          ${heroAvatarMarkup(hero, "unit")}
          <div class="unitHpBar"><span style="width:${clamp((hero.hp / hero.maxHp) * 100, 0, 100)}%"></span></div>
          <div class="unitHpText">${hero.hp}/${hero.maxHp}</div>
        `;
        cell.appendChild(unit);
      }

      const markBits = [];
      state.heroes.forEach(h => {
        if (h.defId === "sukuna" && h.marks) {
          h.marks.forEach((m, idx) => {
            if (m.x === x && m.y === y) markBits.push({ text: "解标记", cls: "sukunaMarkLabel", order: idx });
          });
        }
        if (h.defId === "gojo" && h.gojoMarks) {
          if (h.gojoMarks.blue && h.gojoMarks.blue.x === x && h.gojoMarks.blue.y === y) markBits.push({ text: "苍标记", cls: "gojoBlueMarkLabel" });
          if (h.gojoMarks.red && h.gojoMarks.red.x === x && h.gojoMarks.red.y === y) markBits.push({ text: "赫标记", cls: "gojoRedMarkLabel" });
        }
        if (h.defId === "sword" && Array.isArray(h.swordMarks)) {
          h.swordMarks.forEach(mark => {
            if (mark.x === x && mark.y === y) {
              const count = mark.count || 1;
              markBits.push({ text: count > 1 ? `剑${count}` : "剑标记", cls: "swordMarkLabel" });
            }
          });
        }
      });
      if (markBits.length) {
        const stack = document.createElement("div");
        stack.className = "cellMarkStack";
        markBits.forEach((bit, idx) => {
          const mark = document.createElement("div");
          mark.className = `${bit.cls}`;
          mark.textContent = bit.text;
          mark.style.transform = `translateX(${idx % 2 === 0 ? 0 : 8}px)`;
          stack.appendChild(mark);
        });
        cell.appendChild(stack);
      }

      const fxItems = state.fx.filter(f => f.x === x && f.y === y);
      fxItems.forEach(fx => {
        const fxEl = document.createElement("div");
        fxEl.className = "cellFx";
        fxEl.innerHTML = `<img src="${escapeHtml(fx.src)}" alt="特效" draggable="false">`;
        cell.appendChild(fxEl);
      });

      cell.addEventListener("click", () => onCellTap(x, y));
      grid.appendChild(cell);
    }
  }

  renderBoardTransientLayer();
}


function renderBoardTransientLayer() {
  const grid = $("grid");
  if (!grid) return;
  const oldLayer = grid.querySelector(".boardFxLayer");
  if (oldLayer) oldLayer.remove();

  const layer = document.createElement("div");
  layer.className = "boardFxLayer";

  const gridRect = grid.getBoundingClientRect();
  const cellRects = new Map();
  grid.querySelectorAll(".cell").forEach(cell => {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    cellRects.set(keyOf(x, y), cell.getBoundingClientRect());
  });

  const cellCenter = (x, y) => {
    const ref = cellRects.get(keyOf(Math.max(0, Math.min(W - 1, Math.floor(x))), Math.max(0, Math.min(H - 1, Math.floor(y)))));
    const rightRef = cellRects.get(keyOf(Math.max(0, Math.min(W - 1, Math.ceil(x))), Math.max(0, Math.min(H - 1, Math.floor(y)))));
    const downRef = cellRects.get(keyOf(Math.max(0, Math.min(W - 1, Math.floor(x))), Math.max(0, Math.min(H - 1, Math.ceil(y)))));
    const base = cellRects.get(keyOf(0, 0));
    const stepX = rightRef && ref ? (rightRef.left - ref.left) : (base ? base.width : 40);
    const stepY = downRef && ref ? (downRef.top - ref.top) : (base ? base.height : 40);
    if (!ref) return { x: 0, y: 0 };
    return {
      x: (ref.left - gridRect.left + ref.width / 2) + (x - Math.floor(x)) * stepX,
      y: (ref.top - gridRect.top + ref.height / 2) + (y - Math.floor(y)) * stepY
    };
  };

  state.sukunaLineFx.forEach(fx => {
    fx.lines.forEach(line => {
      const fromRect = cellRects.get(keyOf(line.from.x, line.from.y));
      const toRect = cellRects.get(keyOf(line.to.x, line.to.y));
      if (!fromRect || !toRect) return;
      const sx = fromRect.left - gridRect.left + fromRect.width / 2;
      const sy = fromRect.top - gridRect.top + fromRect.height / 2;
      const ex = toRect.left - gridRect.left + toRect.width / 2;
      const ey = toRect.top - gridRect.top + toRect.height / 2;
      const dx = ex - sx;
      const dy = ey - sy;
      const len = Math.max(24, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const slash = document.createElement("div");
      slash.className = "boardFxSlash";
      slash.style.left = `${sx}px`;
      slash.style.top = `${sy}px`;
      slash.style.width = `${len}px`;
      slash.style.transform = `translateY(-50%) rotate(${angle}deg)`;
      layer.appendChild(slash);
    });
  });

  state.gojoFx.forEach(fx => {
    if (fx.type === 'line') {
      const fromRect = cellRects.get(keyOf(fx.from.x, fx.from.y));
      const toRect = cellRects.get(keyOf(fx.to.x, fx.to.y));
      if (!fromRect || !toRect) return;
      const sx = fromRect.left - gridRect.left + fromRect.width / 2;
      const sy = fromRect.top - gridRect.top + fromRect.height / 2;
      const ex = toRect.left - gridRect.left + toRect.width / 2;
      const ey = toRect.top - gridRect.top + toRect.height / 2;
      const dx = ex - sx;
      const dy = ey - sy;
      const len = Math.max(24, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const line = document.createElement('div');
      line.className = 'boardFxGojoLine';
      line.style.left = `${sx}px`;
      line.style.top = `${sy}px`;
      line.style.width = `${len}px`;
      line.style.transform = `translateY(-50%) rotate(${angle}deg)`;
      layer.appendChild(line);
    } else if (fx.type === 'pull') {
      const from = cellCenter(fx.from.x, fx.from.y);
      const to = cellCenter(fx.to.x, fx.to.y);
      const orb = document.createElement('div');
      orb.className = `boardFxGojoOrb ${fx.color === 'red' ? 'red' : 'blue'} gojoPull`; 
      orb.style.left = `${from.x}px`;
      orb.style.top = `${from.y}px`;
      orb.style.setProperty('--gojo-to-x', `${to.x - from.x}px`);
      orb.style.setProperty('--gojo-to-y', `${to.y - from.y}px`);
      layer.appendChild(orb);
    } else if (fx.type === 'core') {
      const pos = cellCenter(fx.at.x, fx.at.y);
      const core = document.createElement('div');
      core.className = 'boardFxGojoCore';
      core.style.left = `${pos.x}px`;
      core.style.top = `${pos.y}px`;
      layer.appendChild(core);
    } else if (fx.type === 'boom') {
      const pos = cellCenter(fx.at.x, fx.at.y);
      const boom = document.createElement('div');
      boom.className = 'boardFxGojoBoom';
      boom.style.left = `${pos.x}px`;
      boom.style.top = `${pos.y}px`;
      layer.appendChild(boom);
    }
  });

  state.floatingTexts.forEach(t => {
    const rect = cellRects.get(keyOf(t.x, t.y));
    if (!rect) return;
    const txt = document.createElement("div");
    txt.className = `boardFxText ${t.className || "domainFloatText"}`;
    txt.style.left = `${rect.left - gridRect.left + rect.width / 2}px`;
    txt.style.top = `${rect.top - gridRect.top - 10}px`;
    txt.textContent = t.text;
    layer.appendChild(txt);
  });

  grid.appendChild(layer);
}

function formatHeroFx(hero) {
  const fx = [];
  if (hero.frozenTurns > 0) fx.push(`冻结${hero.frozenTurns}`);
  if (hero.rootedTurns > 0) fx.push(`缠绕${hero.rootedTurns}`);
  if (hero.burnTurns > 0) fx.push(`灼烧${hero.burnTurns}`);
  if (hero.defId === "gojo" && hero.gojoBlock > 0) fx.push(`防御${hero.gojoBlock}`);
  if (hero.defId === "gojo" && hero.gojoMarks) {
    if (hero.gojoMarks.blue) fx.push(`苍(${hero.gojoMarks.blue.x},${hero.gojoMarks.blue.y})`);
    if (hero.gojoMarks.red) fx.push(`赫(${hero.gojoMarks.red.x},${hero.gojoMarks.red.y})`);
  }
  if (hero.defId === "sword" && Array.isArray(hero.swordMarks) && hero.swordMarks.length) {
    const total = hero.swordMarks.reduce((sum, m) => sum + (m.count || 1), 0);
    fx.push(`剑${total}`);
  }
  if (hero.defId === "archer" && hero.buffs.archerFreeMove > 0) fx.push(`轻步${hero.buffs.archerFreeMove}回合`);
  if (hero.marks.length > 0) fx.push(`标记${hero.marks.length}`);
  return fx.join(" | ");
}

function renderSelectedPanel(hero) {
  const summary = $("selectedInfo");
  if (!summary) return;

  if (!hero) {
    $("selectedPill").textContent = "未选择英雄";
    $("selectedState").textContent = "—";
    summary.innerHTML = `
      <div class="heroCard">
        <div class="hintText">点击一位已部署英雄，查看属性、被动、主动技能与当前状态。</div>
      </div>
    `;
    return;
  }

  const def = heroDef(hero);
  const skills = visibleSkills(hero);
  $("selectedPill").textContent = `${hero.name} · ${TEAM[hero.team].name}`;
  $("selectedState").textContent = `HP ${hero.hp}/${hero.maxHp} · ${hero.team === "blue" ? "蓝方" : "红方"}`;

  const skillChips = skills.map(s => `
    <span class="skillChip">${s.costText === "被动" ? "被动技能" : "主动技能"} · ${escapeHtml(s.title)}</span>
  `).join("");

  const skillCards = skills.map(s => `
    <div class="skillDetail">
      <div class="skillDetailHead">
        <div class="skillIconSlot">${skillIcon(s)}</div>
        <div class="skillDetailTitleWrap">
          <strong>技能${s.no}：${escapeHtml(s.title)}</strong>
          <div class="smallCaps">${s.costText === "被动" ? "编号：被动 · 类型：被动" : `编号：${s.no} · 类型：主动 · 消耗：${escapeHtml(s.costText)}`}</div>
        </div>
      </div>
      <div class="heroMeta">${escapeHtml(s.desc)}</div>
    </div>
  `).join("");

  const statusText = formatHeroFx(hero) || "无";
  const gojoBlockPct = hero.defId === "gojo" ? clamp((hero.gojoBlock / Math.max(hero.maxHp, 1)) * 100, 0, 100) : 0;
  const gojoPhaseLabel = hero.defId === "gojo" ? (hero.phase2 ? "二阶段" : "一阶段") : "";

  summary.innerHTML = `
    <div class="heroCard">
      <div class="heroBrief">
        ${heroPortraitMarkup(hero)}
        <div class="heroBriefMain">
          <div class="heroTitle">${escapeHtml(hero.name)}</div>
          <div class="heroMeta">
            阵营：${TEAM[hero.team].name}<br>
            生命：${hero.hp}/${hero.maxHp}　攻击：${hero.atk}　普攻范围：${hero.attackRange}<br>
            普攻消耗：${hero.attackCost}　普通攻击次数：${hero.attackTimesThisTurn}/2<br>
            ${hero.defId === "gojo" ? `形态：${gojoPhaseLabel}<br>` : ""}
          </div>
          <div class="miniBarStack">
            <div class="unitHpBar"><span style="width:${clamp((hero.hp / hero.maxHp) * 100, 0, 100)}%"></span></div>
            ${hero.defId === "gojo" ? `<div class="unitHpBar gojoBlock"><span style="width:${gojoBlockPct}%"></span></div>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div class="heroCard">
      <strong>被动与状态</strong>
      <div class="heroMeta">
        <div><strong style="color:#fff">被动：</strong>${escapeHtml(def.passive)}</div>
        <div style="margin-top:6px"><strong style="color:#fff">当前状态：</strong>${escapeHtml(statusText)}</div>
        ${hero.defId === "gojo" ? `<div style="margin-top:6px"><strong style="color:#fff">苍/赫：</strong>${escapeHtml(gojoMarkSummary(hero))}</div>` : ""}
      </div>
    </div>

    <div class="heroCard">
      <strong>技能总览</strong>
      <div class="skillChipRow">${skillChips}</div>
    </div>

    <div class="heroCard">
      <strong>详细技能说明</strong>
      <div class="skillDetailGrid">${skillCards}</div>
    </div>

    <div class="heroCard">
      <strong>战斗统计</strong>
      <div class="heroMeta">总造成伤害：${hero.stats.dealt}</div>
      <div class="heroMeta">总承伤：${hero.stats.taken}</div>
      <div class="heroMeta">总减伤：${hero.stats.reduced}</div>
      <div class="heroMeta">当前回合普通攻击次数：${hero.attackTimesThisTurn}/2</div>
      <div class="heroMeta">标记数量：${hero.marks.length}</div>
    </div>
  `;
}


function renderSkillBar(hero) {
  renderSkillBarInto($("skillBar"), hero, { emptyText: "请先选择可行动英雄" });
  renderSkillBarInto($("landscapeSkillBar"), hero, { emptyText: "请先选择可行动英雄" });
}

function renderSkillBarInto(bar, hero, opts = {}) {
  if (!bar) return;
  bar.innerHTML = "";

  if (!hero || state.phase !== "battle" || !canAct(hero)) {
    bar.innerHTML = `<button disabled>${escapeHtml(opts.emptyText || "请先选择可行动英雄")}</button>`;
    return;
  }

  const skills = visibleSkills(hero);
  skills.forEach(s => {
    if (s.costText === "被动") return;
    const btn = document.createElement("button");
    btn.className = "skillButton";
    btn.innerHTML = `
      <span class="skillButtonIcon">${skillIcon(s)}</span>
      <span class="skillButtonText">
        <span class="skillNo">技能${s.no}</span>
        <span class="skillName">${escapeHtml(s.title)}</span>
        <span class="skillCost">${escapeHtml(s.costText)}</span>
      </span>
    `;
    btn.onclick = () => useSkill(hero, s.no);
    btn.disabled = !isSkillAvailable(hero, s.no);
    bar.appendChild(btn);
  });

  if (!skills.some(s => s.costText !== "被动")) {
    const btn = document.createElement("button");
    btn.textContent = "该英雄暂无主动技能";
    btn.disabled = true;
    bar.appendChild(btn);
  }
}


function isSkillAvailable(hero, skillNo) {
  if (!canUseSkills(hero)) return false;

  // 这里统一做“条件判断”
  if (hero.defId === "sword" && skillNo === 1) {
    return true;
  }

  if (hero.defId === "sword" && skillNo === 2) {
    return teamAP(hero.team) >= 5 && skillTargets(hero, 2).length > 0;
  }

  if (hero.defId === "sword" && skillNo === 3) {
    return teamAP(hero.team) >= 10;
  }

  if (!visibleSkills(hero).some(s => s.no === skillNo)) return false;

  if (hero.defId === "sukuna" && skillNo === 2) {
    return !hero.phase2 && hero.marks.length >= 5;
  }

  if (hero.defId === "sukuna" && skillNo === 5) {
    return hero.phase2 && teamAP(hero.team) >= 8;
  }

  if (hero.defId === "gojo" && skillNo === 2) {
    return teamAP(hero.team) >= 3 && gojoSkillCells(hero, 2).length > 0;
  }

  if (hero.defId === "gojo" && skillNo === 3) {
    return teamAP(hero.team) >= 3 && gojoSkillCells(hero, 3).length > 0;
  }

  if (hero.defId === "gojo" && skillNo === 4) {
    return teamAP(hero.team) >= 10;
  }

  if (hero.defId === "gojo" && skillNo === 5) {
    return hero.phase2 && teamAP(hero.team) >= 10 && hasGojoMizushi(hero);
  }

  if (hero.defId === "archer" && skillNo === 1) {
    return teamAP(hero.team) >= 2;
  }

  if (hero.defId === "archer" && skillNo === 2) {
    return teamAP(hero.team) >= 6;
  }

  if (hero.defId === "archer" && skillNo === 3) {
    return teamAP(hero.team) >= 6 && skillTargets(hero, 3).length > 0;
  }

  if (hero.defId === "mountain" && skillNo === 1) {
    return teamAP(hero.team) >= 4;
  }

  if (hero.defId === "mountain" && skillNo === 2) {
    return teamAP(hero.team) >= 8;
  }

  if (hero.defId === "night" && skillNo === 1) {
    return teamAP(hero.team) >= 2 && skillTargets(hero, 1).length > 0;
  }

  if (hero.defId === "night" && skillNo === 2) {
    return teamAP(hero.team) >= 6 && countBurnedHeroes() >= 2;
  }

  if (hero.defId === "night" && skillNo === 3) {
    return teamAP(hero.team) >= 9;
  }

  return false;
}

function countBurnedHeroes() {
  return state.heroes.filter(h => !h.dead && h.burnTurns > 0).length;
}

// ----------------------
// 点击格子：移动 / 攻击 / 技能
// ----------------------
function onCellTap(x, y) {
  if (state.phase === "intro" || state.phase === "draft" || state.phase === "deploy" || state.phase === "gameover") return;

  let hero = selectedHero();
  const target = heroAt(x, y);

  // 如果回合已经切换，先清掉上一方的选择对象，避免影响下一方直接点选英雄。
  if (hero && hero.team !== state.activeTeam) {
    deselectHero();
    hero = null;
  }

  // 没选中任何英雄时，只允许点己方已部署英雄来选中。
  if (!hero) {
    if (target && target.team === state.activeTeam && !target.dead) {
      selectHero(target.uid);
    }
    return;
  }

  // 点到了自己：取消选择
  if (target && target.uid === hero.uid) {
    deselectHero();
    return;
  }

  // 如果当前处于等待目标状态，优先处理“技能目标”
  if (state.pendingAction) {
    const p = state.pendingAction;
    if (p.kind === "skillTarget" && target) {
      chooseTargetAction(p, target);
      return;
    }
    if (p.kind === "skillCell") {
      chooseCellAction(p, x, y);
      return;
    }
  }

  // 未进入某个特殊选择状态时：
  // 1) 点击攻击范围内的敌方英雄 -> 直接攻击
  // 2) 点击空地 -> 移动
  // 3) 点击己方英雄 -> 切换选择
  const canAttackTarget = target && target.team !== hero.team && attackTargets(hero).some(t => t.uid === target.uid);

  if (canAttackTarget) {
    performAttack(hero, target);
    return;
  }

  if (state.selectedMode === "skill") {
    // 技能模式下点击空地没有意义；需要技能按钮触发 target/direction 逻辑
    return;
  }

  if (!target) {
    performMove(hero, x, y);
    return;
  }

  if (target.team === state.activeTeam) {
    selectHero(target.uid);
  }
}

// ----------------------
// 选择/取消选择
// ----------------------
function selectHero(uid) {
  state.selectedUid = uid;
  state.selectedMode = "move";
  state.pendingAction = null;
  renderAll();

}

function deselectHero() {
  state.selectedUid = null;
  state.pendingAction = null;
  renderAll();
}

// ----------------------
// 移动与普攻
// ----------------------
// 移动结算：先找可达格，再扣行动点数，最后更新坐标。
function performMove(hero, targetX, targetY) {
  if (!canAct(hero)) return;

  const reach = reachableCells(hero).find(c => c.x === targetX && c.y === targetY);
  if (!reach) return;

  const steps = reach.d;
  const cost = moveCost(hero, steps);

  if (hero.defId !== "archer" || hero.buffs.archerFreeMove <= 0) {
    if (teamAP(hero.team) < cost) return;
    state.ap[hero.team] -= cost;
  } else {
    // 射手轻步潜行：每回合最多移动 2 次，每次不超过 2 格
    if (steps > 2) return;
    if (hero.buffs.archerFreeMoveLeft <= 0) return;
    hero.buffs.archerFreeMoveLeft -= 1;
  }

  const fromX = hero.x;
  const fromY = hero.y;
  hero.x = targetX;
  hero.y = targetY;
  log(`【${TEAM[hero.team].name}】${hero.name} 移动 (${fromX},${fromY}) → (${targetX},${targetY})，行动点数 ${apText(hero.team)}。`);
  renderAll();
}

// 普攻结算：检查范围、消耗、第二次攻击加价与伤害统计。
function performAttack(hero, target) {
  if (!canAct(hero)) return;
  if (!target || target.team === hero.team) return;
  if (manhattan(hero, target) > hero.attackRange) return;

  // 每位英雄每回合最多普通攻击 2 次
  if (hero.attackTimesThisTurn >= 2) {
    log(`【${hero.name}】本回合普通攻击已达到上限（2 次）。`);
    return;
  }

  const cost = attackCost(hero);
  if (hero.defId === "sukuna") {
    // 宿傩：行动改为消耗生命，不消耗行动点
    if (hero.hp < cost) return;
    hero.hp -= cost;
    log(`【${TEAM[hero.team].name}】${hero.name} 普通攻击以生命代价结算，消耗 ${cost} 点生命。`);
  } else {
    if (teamAP(hero.team) < cost) return;
    state.ap[hero.team] -= cost;
  }

  hero.attackTimesThisTurn += 1;
  spawnCombatFx(hero, target);
  const damage = hero.atk + hero.tempAtkBonus;
  applyDamage(hero, target, damage, "普攻");

  // 射手被动：攻击敌方会偷取敌方下回合 1 点行动点
  if (hero.defId === "archer") {
    state.effects.push({
      type: "apSteal",
      ownerUid: hero.uid,
      team: hero.team,
      targetTeam: otherTeam(hero.team),
      triggerTurn: state.turn + 1
    });
    log(`【${hero.name}】触发被动：偷取敌方下回合 1 点行动点。`);
  }

  renderAll();
  checkGameOver();
}

// ----------------------
// 技能入口：先检查能不能放，再按英雄类型走对应的结算函数。
// ----------------------
function useSkill(hero, skillNo) {
  if (!canUseSkills(hero)) return;
  if (!isSkillAvailable(hero, skillNo)) return;

  // 先把技能模式切到“安全状态”
  state.selectedMode = "skill";
  state.pendingAction = null;

  if (hero.defId === "sword" && skillNo === 1) {
    log(`【${hero.name}】的被动【剑心回响】已自动生效。`);
    return;
  }

  if (hero.defId === "sword" && skillNo === 2) {
    showTargetSelection(hero, skillNo, "swordSkill2", "选择目标", "请选择 2 格内敌方英雄，突刺到其身后并造成 4 点伤害。");
    return;
  }

  if (hero.defId === "sword" && skillNo === 3) {
    resolveSwordSkill3(hero);
    return;
  }

  if (hero.defId === "sukuna" && skillNo === 1) {
    showTargetSelection(hero, skillNo, "swordSkill2", "选择目标", "请选择 2 格内敌方英雄，突刺到其身后并造成 4 点伤害。");
    return;
  }

  if (hero.defId === "sukuna" && skillNo === 1) {
    // 宿傩的标记被动不需要主动释放按钮，这里仅保留说明
    log("宿傩的标记被动始终生效。");
    return;
  }

  if (hero.defId === "sukuna" && skillNo === 2) {
    resolveSukunaSkill2(hero);
    return;
  }

  if (hero.defId === "sukuna" && skillNo === 5) {
    resolveSukunaSkill5(hero);
    return;
  }

  if (hero.defId === "gojo" && skillNo === 2) {
    showCellSelection(hero, skillNo, "gojoSkill2", "选择苍目标", "请选择自身周围 1 格内的空格或敌方英雄，释放苍并留下苍标记。");
    return;
  }

  if (hero.defId === "gojo" && skillNo === 3) {
    showCellSelection(hero, skillNo, "gojoSkill3", "选择赫目标", "请选择自身周围 3 格内的敌方英雄，造成 2 点伤害并留下赫标记。");
    return;
  }

  if (hero.defId === "gojo" && skillNo === 4) {
    resolveGojoSkill4(hero);
    return;
  }

  if (hero.defId === "gojo" && skillNo === 5) {
    resolveGojoSkill5(hero);
    return;
  }

  if (hero.defId === "archer" && skillNo === 1) {
    showTargetSelection(hero, skillNo, "archerSkill1", "选择目标", "请选择 3 格内敌方英雄，造成 1 点伤害。");
    return;
  }

  if (hero.defId === "archer" && skillNo === 2) {
    resolveArcherSkill2(hero);
    return;
  }

  if (hero.defId === "archer" && skillNo === 3) {
    showTargetSelection(hero, skillNo, "archerSkill3", "选择目标", "请选择 1 格内敌方英雄，造成 3 点伤害并施加缠绕。");
    return;
  }

  if (hero.defId === "mountain" && skillNo === 1) {
    showDirectionPicker(hero);
    return;
  }

  if (hero.defId === "mountain" && skillNo === 2) {
    resolveMountainSkill2(hero);
    return;
  }

  if (hero.defId === "night" && skillNo === 1) {
    showTargetSelection(hero, skillNo, "nightSkill1", "选择目标", "请选择 2 格内敌方英雄，造成 2 点伤害并附加灼烧 3 回合。");
    return;
  }

  if (hero.defId === "night" && skillNo === 2) {
    resolveNightSkill2(hero);
    return;
  }

  if (hero.defId === "night" && skillNo === 3) {
    resolveNightSkill3(hero);
    return;
  }
}

function showTargetSelection(hero, skillNo, actionKey, title, desc) {
  state.pendingAction = {
    kind: "skillTarget",
    heroUid: hero.uid,
    skillNo,
    actionKey,
    title,
    desc
  };
  renderAll();
  log(`【${hero.name}】请选择技能目标。`);
}

function showCellSelection(hero, skillNo, actionKey, title, desc) {
  state.pendingAction = {
    kind: "skillCell",
    heroUid: hero.uid,
    skillNo,
    actionKey,
    title,
    desc
  };
  renderAll();
  log(`【${hero.name}】请选择释放位置。`);
}

function showDirectionPicker(hero) {
  openOverlay(`
    <h2>选择方向</h2>
    <p>【${hero.name}】请选择封路方向。</p>
    <div class="overlayActions">
      <button class="btnGhost" data-dir="up">上</button>
      <button class="btnGhost" data-dir="down">下</button>
      <button class="btnGhost" data-dir="left">左</button>
      <button class="btnGhost" data-dir="right">右</button>
    </div>
  `);

  document.querySelectorAll("[data-dir]").forEach(btn => {
    btn.addEventListener("click", () => {
      closeOverlay();
      resolveMountainSkill1(hero, btn.dataset.dir);
    });
  });
}

function chooseTargetAction(pending, targetHero) {
  const hero = heroByUid(pending.heroUid);
  if (!hero || hero.dead) return;

  if (pending.actionKey === "swordSkill2") {
    resolveSwordSkill2(hero, targetHero);
  } else if (pending.actionKey === "archerSkill1") {
    resolveArcherSkill1(hero, targetHero);
  } else if (pending.actionKey === "archerSkill3") {
    resolveArcherSkill3(hero, targetHero);
  } else if (pending.actionKey === "nightSkill1") {
    resolveNightSkill1(hero, targetHero);
  }

  state.pendingAction = null;
  state.selectedMode = "move";
  renderAll();
}

function chooseCellAction(pending, x, y) {
  const hero = heroByUid(pending.heroUid);
  if (!hero || hero.dead) return;

  if (pending.actionKey === "gojoSkill2") {
    resolveGojoSkill2(hero, x, y);
  } else if (pending.actionKey === "gojoSkill3") {
    resolveGojoSkill3(hero, x, y);
  }

  state.pendingAction = null;
  state.selectedMode = "move";
  renderAll();
}

// ----------------------
// 各英雄技能结算
// ----------------------
function resolveSwordSkill1(hero) {
  log(`【${hero.name}】的被动【剑心回响】已自动生效。`);
}

function resolveSwordSkill2(hero, target) {
  if (!target || target.team === hero.team) return;
  if (teamAP(hero.team) < 5) return;
  if (manhattan(hero, target) > 2) return;

  state.ap[hero.team] -= 5;
  applyDamage(hero, target, 4, "突刺");

  // 按“目标身后一格”进行位移
  const dx = Math.sign(target.x - hero.x);
  const dy = Math.sign(target.y - hero.y);
  const backX = target.x + dx;
  const backY = target.y + dy;

  if (inBounds(backX, backY) && !heroAt(backX, backY)) {
    hero.x = backX;
    hero.y = backY;
    log(`【${hero.name}】突刺到目标身后 (${backX},${backY})。`);
  }

  const splashTargets = state.heroes.filter(h => !h.dead && h.placed && h.team !== hero.team && h.uid !== target.uid && Math.abs(h.x - hero.x) + Math.abs(h.y - hero.y) <= 1);
  if (splashTargets.length) {
    splashTargets.forEach(t => applyDamage(hero, t, 2, "突刺余波"));
    log(`【${hero.name}】突刺穿过目标后，震荡了 ${splashTargets.length} 名周围敌方英雄。`);
  }

  checkGameOver();
  renderAll();
}

function resolveSukunaSkill2(hero) {
  if (hero.phase2 || hero.marks.length < 5) return;

  const marks = hero.marks.slice();
  const markedCells = new Set(marks.map(m => keyOf(m.x, m.y)));
  const lines = [];
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      lines.push({ from: { x: marks[i].x, y: marks[i].y }, to: { x: marks[j].x, y: marks[j].y } });
    }
  }
  spawnSukunaSlashFx(lines, 2000);

  let hitCount = 0;
  state.heroes.forEach(t => {
    if (t.dead || !t.placed) return;
    if (markedCells.has(keyOf(t.x, t.y))) {
      applyDamage(hero, t, 4, "标记爆发");
      hitCount += 1;
    }
  });

  log(`【${hero.name}】释放伏魔·解，命中了 ${hitCount} 个标记位置。`);
  hero.marks = [];
  renderAll();
}

function resolveSukunaSkill5(hero) {
  if (!hero.phase2) return;
  if (teamAP(hero.team) < 8) return;

  state.ap[hero.team] -= 8;

  state.effects.push({
    type: "sukunaDomain",
    ownerUid: hero.uid,
    team: hero.team,
    x: hero.x,
    y: hero.y,
    radius: 3,
    triggerTurn: state.turn + 2
  });
  spawnFloatingText(hero.x, hero.y, "领域展开！", 2000, "domainFloatText");

  log(`【${hero.name}】展开伏魔御厨子（消耗 8 行动点）：两回合后结算。`);
  renderAll();
}

function resolveGojoSkill2(hero, x, y) {
  if (teamAP(hero.team) < 3) return;
  if (Math.max(Math.abs(hero.x - x), Math.abs(hero.y - y)) > 1) return;
  const occupant = heroAt(x, y);
  if (occupant && occupant.team === hero.team) return;

  state.ap[hero.team] -= 3;
  if (occupant && occupant.team !== hero.team) {
    applyDamage(hero, occupant, 2, "苍");
  }
  setGojoMark(hero, "blue", x, y);
  spawnFloatingText(x, y, "苍", 1200, "domainFloatText");
  log(`【${hero.name}】释放苍，并在 (${x},${y}) 留下苍标记。`);
  renderAll();
}

function resolveGojoSkill3(hero, x, y) {
  if (teamAP(hero.team) < 3) return;
  if (Math.max(Math.abs(hero.x - x), Math.abs(hero.y - y)) > 3) return;
  const occupant = heroAt(x, y);
  if (!occupant || occupant.team === hero.team) return;

  state.ap[hero.team] -= 3;
  applyDamage(hero, occupant, 2, "赫");
  setGojoMark(hero, "red", x, y);
  spawnFloatingText(x, y, "赫", 1200, "domainFloatText");
  log(`【${hero.name}】释放赫，并在 (${x},${y}) 留下赫标记。`);
  renderAll();
}

function resolveGojoSkill4(hero) {
  if (teamAP(hero.team) < 10) return;
  state.ap[hero.team] -= 10;

  state.effects.push({
    type: "gojoDomain",
    ownerUid: hero.uid,
    team: hero.team,
    x: hero.x,
    y: hero.y,
    radius: 2,
    triggerTurn: state.turn + 2
  });
  spawnFloatingText(hero.x, hero.y, "领域展开！", 2000, "domainFloatText");

  if (!hero.phase2) {
    hero.phase2 = true;
    log(`【${hero.name}】第一次展开领域，进入二阶段！`);
  }

  log(`【${hero.name}】展开无量空处：两回合后开始结算，领域期间除自身外无法离开。`);
  renderAll();
}

function hasGojoMizushi(hero) {
  const marks = ensureGojoMarks(hero);
  return !!(marks && marks.blue && marks.red);
}

function resolveGojoSkill5(hero) {
  if (teamAP(hero.team) < 10) return;
  const marks = ensureGojoMarks(hero);
  if (!marks || !marks.blue || !marks.red) return;

  const blue = { ...marks.blue };
  const red = { ...marks.red };
  const center = { x: (blue.x + red.x) / 2, y: (blue.y + red.y) / 2 };
  const radius = Math.hypot(blue.x - red.x, blue.y - red.y) / 2;

  state.ap[hero.team] -= 10;
  clearGojoMarks(hero);
  spawnGojoMizushiFx(blue, red, center);

  const targets = state.heroes.filter(h => !h.dead && h.placed && Math.hypot(h.x - center.x, h.y - center.y) <= radius);
  state.suspendGameOverCheck = true;
  targets.forEach(t => {
    applyDamage(hero, t, 10, "虚式•茈");
  });
  state.suspendGameOverCheck = false;

  log(`【${hero.name}】释放虚式•茈，命中 ${targets.length} 名角色。`);
  const blueAlive = aliveHeroes("blue").length;
  const redAlive = aliveHeroes("red").length;
  if (blueAlive === 0 && redAlive === 0) {
    state.phase = "gameover";
    state.endSummary = buildSummary(hero.team);
    renderGameOverOverlay(hero.team);
    return;
  }
  checkGameOver();
  renderAll();
}

function resolveSwordSkill3(hero) {
  if (teamAP(hero.team) < 10) return;
  state.ap[hero.team] -= 10;

  state.effects = state.effects.filter(effect => !(effect.type === "swordDomain" && effect.ownerUid === hero.uid));

  hero.hp = 1;
  state.effects.push({
    type: "swordDomain",
    ownerUid: hero.uid,
    team: hero.team,
    x: hero.x,
    y: hero.y,
    radius: 1,
    nextTurn: state.turn + 1,
    endTurn: state.turn + 2
  });

  log(`【${hero.name}】展开终式·万剑归宗：领域持续 2 回合，开启时血量降至 1。`);
  renderAll();
}
function resolveArcherSkill1(hero, target) {
  if (!target || target.team === hero.team) return;
  if (teamAP(hero.team) < 2) return;
  if (manhattan(hero, target) > 3) return;

  state.ap[hero.team] -= 2;
  applyDamage(hero, target, 1, "连射");
  log(`【${hero.name}】发动连射。`);
  renderAll();
}

function resolveArcherSkill2(hero) {
  if (teamAP(hero.team) < 6) return;
  state.ap[hero.team] -= 6;
  hero.buffs.archerFreeMove = 2;
  hero.buffs.archerFreeMoveLeft = 2;
  log(`【${hero.name}】发动轻步潜行：接下来 2 回合内移动消耗变为 0。`);
  renderAll();
}

function resolveArcherSkill3(hero, target) {
  if (!target || target.team === hero.team) return;
  if (teamAP(hero.team) < 6) return;
  if (manhattan(hero, target) > 1) return;

  state.ap[hero.team] -= 6;
  applyDamage(hero, target, 3, "缠绕箭");
  target.rootedTurns = Math.max(target.rootedTurns, 2);
  log(`【${hero.name}】使目标进入缠绕 2 回合。`);
  renderAll();
}

function resolveMountainSkill1(hero, dir) {
  if (teamAP(hero.team) < 4) return;
  state.ap[hero.team] -= 4;

  const dirs = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
  };
  const [dx, dy] = dirs[dir] || [0, 0];

  const cells = [];
  let hitSomeone = false;

  for (let i = 1; i <= 3; i++) {
    const x = hero.x + dx * i;
    const y = hero.y + dy * i;
    if (!inBounds(x, y)) break;
    cells.push({ x, y });

    const t = heroAt(x, y);
    if (t) {
      hitSomeone = true;
      if (t.team === hero.team) {
        t.hp = Math.min(t.maxHp, t.hp + 2);
        log(`【${hero.name}】为我方【${t.name}】回复 2 点生命。`);
      } else {
        applyDamage(hero, t, 2, "封路碰撞");
      }
    }
  }

  if (!hitSomeone) {
    state.effects.push({
      type: "mountainBarrier",
      ownerUid: hero.uid,
      heroUid: hero.uid,
      team: hero.team,
      cells,
      triggerTurn: state.turn + 1
    });
    log(`【${hero.name}】成功建立封路地形。`);
  } else {
    log(`【${hero.name}】封路时路径内存在角色，封路效果立即消失。`);
  }

  renderAll();
}

function resolveMountainSkill2(hero) {
  if (teamAP(hero.team) < 8) return;
  state.ap[hero.team] -= 8;

  state.effects.push({
    type: "mountainShield",
    ownerUid: hero.uid,
    team: hero.team,
    x: hero.x,
    y: hero.y,
    radius: 1,
    amount: 1,
    triggerTurn: state.turn + 1
  });

  log(`【${hero.name}】展开山体庇护：下回合开始前，我方受到伤害减少 1。`);
  renderAll();
}

function resolveNightSkill1(hero, target) {
  if (!target || target.team === hero.team) return;
  if (teamAP(hero.team) < 2) return;
  if (manhattan(hero, target) > 2) return;

  state.ap[hero.team] -= 2;
  applyDamage(hero, target, 2, "烈焰灼击");
  target.burnTurns = Math.max(target.burnTurns, 3);
  log(`【${hero.name}】附加灼烧 3 回合。`);
  renderAll();
}

function resolveNightSkill2(hero) {
  if (teamAP(hero.team) < 6) return;
  if (countBurnedHeroes() < 2) return;

  state.ap[hero.team] -= 6;
  let hits = 0;
  state.heroes.forEach(h => {
    if (!h.dead && h.burnTurns > 0) {
      applyDamage(hero, h, 2, "焰爆");
      hits += 1;
    }
  });
  log(`【${hero.name}】焰爆命中 ${hits} 位被灼烧英雄。`);
  renderAll();
}

function resolveNightSkill3(hero) {
  if (teamAP(hero.team) < 9) return;
  state.ap[hero.team] -= 9;

  state.effects.push({
    type: "nightDomain",
    ownerUid: hero.uid,
    team: hero.team,
    x: hero.x,
    y: hero.y,
    radius: 2,
    triggerTurn: state.turn + 2
  });
  spawnFloatingText(hero.x, hero.y, "领域展开！", 2000, "domainFloatText");

  log(`【${hero.name}】展开赤夜领域：两回合后结算。`);
  renderAll();
}

// ----------------------
// 工具：状态/说明
// ----------------------
function openInfoOverlay() {
  // 备用：如果以后你想单独查看规则，可再次打开。
  showIntro();
}

// ----------------------
// 结束按钮和模式按钮
// ----------------------
function bindButtons() {
  $("btnDeselect").onclick = deselectHero;
  $("btnEndTurn").onclick = endTurn;
  const endTurnLandscapeBtn = $("btnEndTurnLandscape");
  if (endTurnLandscapeBtn) endTurnLandscapeBtn.onclick = endTurn;
  const endGameBtn = $("btnEndGame");
  if (endGameBtn) endGameBtn.onclick = forceEndGame;
  const modeSwitchBtn = $("btnModeSwitch");
  if (modeSwitchBtn) modeSwitchBtn.onclick = async () => {
    const nextMode = uiMode === "landscape" ? "portrait" : "landscape";
    applyUIMode(nextMode);
    if (nextMode === "landscape") {
      await requestLandscapeLock();
    } else {
      await releaseLandscapeLock();
    }
  };
  const clearBtn = $("clearLogBtn");
  if (clearBtn) clearBtn.onclick = () => {
    state.logs = [];
    renderLog();
  };

  const retryLandscapeBtn = $("retryLandscapeBtn");
  if (retryLandscapeBtn) retryLandscapeBtn.onclick = async () => {
    applyUIMode("landscape");
    await requestLandscapeLock();
  };
  const backPortraitBtn = $("backPortraitBtn");
  if (backPortraitBtn) backPortraitBtn.onclick = async () => {
    applyUIMode("portrait");
    await releaseLandscapeLock();
  };

  window.addEventListener("resize", updateRotateOverlay, { passive: true });
  window.addEventListener("orientationchange", updateRotateOverlay, { passive: true });
  document.addEventListener("fullscreenchange", updateRotateOverlay);
}

// ----------------------
// 初始化
// ----------------------
function init() {
  bindButtons();
  const storedMode = getStoredUIMode();
  const initialMode = storedMode || "portrait";
  applyUIMode(initialMode, { persist: false });
  updateHud();
  renderAll();
  showModeChooser();
  updateRotateOverlay();
}

function updateHud() {
  renderHud();
}

// 在页面加载完成后启动
window.addEventListener("DOMContentLoaded", init);
