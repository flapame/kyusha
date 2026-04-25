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
  barriers: [],
  logs: [],
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
    gojoBlock: 0,       // 五条被动存档
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
  return def && def.avatar ? def.avatar : "";
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
        <li>选中英雄后，点击空格移动，点击敌方进行攻击。</li>
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
    return `
      <div class="heroCard heroPick ${disabled ? "disabled" : ""}" data-id="${id}">
        <strong>${def.name}</strong>
        <div class="small">${escapeHtml(def.spawnHint)}</div>
        <div class="small" style="margin-top:6px">HP ${def.maxHp} / 攻击 ${def.atk} / 普攻范围 ${def.attackRange}</div>
      </div>
    `;
  }).join("");

  openOverlay(`
    <h2>英雄选择</h2>
    <p>当前轮到：<strong>${TEAM[team].name}</strong> 选择第 ${pickedCount + 1} 位英雄。</p>
    <div class="small">提示：同一方不能重复选择同一英雄；但双方可以选择同一个英雄类型。</div>
    <div class="grid2" style="margin-top:12px">
      ${heroCards}
    </div>
    <div class="overlayActions">
      <button class="btnGhost" id="backIntroBtn">查看规则</button>
    </div>
  `);

  $("backIntroBtn").onclick = showIntro;

  document.querySelectorAll(".heroPick:not(.disabled)").forEach(el => {
    el.addEventListener("click", () => chooseDraftHero(el.dataset.id));
  });
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
    // 如果当前队伍已经全部部署完成，自动切到下一方。
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
        <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:4px">
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
      h.gojoBlock = unused;
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

    // 灼烧：每回合开始时造成 1 点伤害，持续若干回合
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
// 统一伤害入口：普攻、技能、结界、灼烧都尽量走这里，方便统计总伤害 / 承伤 / 减伤。
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

  const finalDamage = Math.max(0, rawDamage - reduction);

  if (finalDamage > 0) {
    target.hp -= finalDamage;
    target.stats.taken += finalDamage;
    if (source) source.stats.dealt += finalDamage;
    log(`${source ? source.name : "系统"} 对 ${target.name} 造成 ${finalDamage} 点${reason === "伤害" ? "伤害" : reason}。`);
  } else {
    log(`${target.name} 完全抵挡了这次${reason}。`);
  }

  if (reduction > 0) {
    target.stats.reduced += reduction;
  }

  // 宿傩被动：无论受到伤害还是攻击敌方，只要发生伤害结算，就在相应位置留下标记
  if (target.defId === "sukuna") {
    target.marks.push({ x: target.x, y: target.y });
  }
  if (source && source.defId === "sukuna" && finalDamage > 0) {
    source.marks.push({ x: target.x, y: target.y });
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
  checkGameOver();
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
        h.frozenTurns = Math.max(h.frozenTurns, 1);
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
        applyDamage(owner, h, 3, "赤夜结界");
        h.burnTurns = Math.max(h.burnTurns, 2);
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

  return [];
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// ----------------------
// 渲染：整体
// ----------------------
// 统一渲染入口：任何状态变化后尽量调用这里，避免漏刷某个面板。
function renderAll() {
  renderHud();
  renderGrid();
  renderSelectedPanel(selectedHero());
  renderSkillBar(selectedHero());
}

function renderHud() {
  $("phaseBadge").textContent = `阶段：${phaseText(state.phase)}`;
  $("turnBadge").textContent = `回合：${state.turn}`;

  $("blueApBadge").textContent = `蓝方行动点数：${teamAP("blue")} / ${state.apMax.blue || 0}`;
  $("redApBadge").textContent = `红方行动点数：${teamAP("red")} / ${state.apMax.red || 0}`;

  const turnBadge = $("turnTeamBadge");
  if (turnBadge) {
    turnBadge.textContent = `当前行动：${TEAM[state.activeTeam].name}`;
    turnBadge.className = `badge turn ${state.activeTeam}`;
  }

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

      if (selected) {
        if (selected.uid === hero?.uid) {
          cell.classList.add("selected");
        }
      }

      // 可移动/攻击高亮
      if (state.phase === "battle" && selected && canAct(selected)) {
        if (state.selectedMode === "move") {
          const reach = reachableCells(selected);
          if (reach.some(c => c.x === x && c.y === y)) cell.classList.add("moveHint");
        } else if (state.selectedMode === "attack") {
          const targets = attackTargets(selected);
          if (targets.some(t => t.x === x && t.y === y)) cell.classList.add("attackHint");
        } else if (state.selectedMode === "skill") {
          // 技能时的高亮主要由 pendingAction 控制，具体在 skillBar 或弹窗里处理
        }
      }

      // 结界/屏障效果的可视化：简单打底
      state.effects.forEach(e => {
        if (e.type === "mountainBarrier" && e.cells.some(c => c.x === x && c.y === y)) {
          cell.classList.add("blockHint");
        }
      });

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = `${x},${y}`;
      cell.appendChild(coord);

      if (hero) {
        const unit = document.createElement("div");
        unit.className = `unit ${hero.team}`;
        const fx = formatHeroFx(hero);
        const hpPct = hero.maxHp > 0 ? clamp((hero.hp / hero.maxHp) * 100, 0, 100) : 0;
        unit.innerHTML = `
          <img class="unitPortrait" src="${escapeHtml(heroAvatar(hero))}" alt="${escapeHtml(hero.name)}立绘" draggable="false">
          <div class="name">${escapeHtml(hero.name)}</div>
          <div class="unitHpTrack" aria-label="生命值">
            <div class="unitHpFill ${hero.team}" style="width:${hpPct}%"></div>
          </div>
          <div class="hp">HP ${hero.hp}/${hero.maxHp}</div>
          <div class="fx">${escapeHtml(fx)}</div>
        `;
        cell.appendChild(unit);
      }

      cell.addEventListener("click", () => onCellTap(x, y));
      grid.appendChild(cell);
    }
  }
}

function formatHeroFx(hero) {
  const fx = [];
  if (hero.frozenTurns > 0) fx.push(`冻结${hero.frozenTurns}`);
  if (hero.rootedTurns > 0) fx.push(`缠绕${hero.rootedTurns}`);
  if (hero.burnTurns > 0) fx.push(`灼烧${hero.burnTurns}`);
  if (hero.defId === "gojo" && hero.gojoBlock > 0) fx.push(`防御${hero.gojoBlock}`);
  if (hero.defId === "archer" && hero.buffs.archerFreeMove > 0) fx.push(`轻步${hero.buffs.archerFreeMove}回合`);
  if (hero.marks.length > 0) fx.push(`标记${hero.marks.length}`);
  return fx.join(" | ");
}

function renderSelectedPanel(hero) {
  const summary = $("selectedInfo");
  const detail = $("heroDetail");
  if (!summary || !detail) return;

  if (!hero) {
    $("selectedPill").textContent = "未选择英雄";
    summary.innerHTML = `<div class="hintText">点击一位已部署的英雄，查看属性、被动与技能。</div>`;
    detail.innerHTML = `<div class="hintText">这里会显示完整技能介绍、战斗统计和状态说明。</div>`;
    return;
  }

  const def = heroDef(hero);
  $("selectedPill").textContent = `${hero.name} · ${TEAM[hero.team].name}`;

  const skillChips = def.skills.map(s => `
    <span class="skillChip">技能${s.no}：${escapeHtml(s.title)}</span>
  `).join("");

  const skillCards = def.skills.map(s => `
    <div class="skillDetail">
      <strong>技能${s.no}：${escapeHtml(s.title)}</strong>
      <div class="smallCaps">消耗：${escapeHtml(s.costText)}</div>
      <div class="heroMeta">${escapeHtml(s.desc)}</div>
    </div>
  `).join("");

  summary.innerHTML = `
    <div class="heroCard">
      <div class="heroBrief">
        <div class="avatar ${hero.team}">
          ${heroAvatar(hero)
            ? `<img class="avatarImg" src="${escapeHtml(heroAvatar(hero))}" alt="${escapeHtml(hero.name)}头像" draggable="false">`
            : escapeHtml(hero.name.slice(0, 1))}
        </div>
        <div class="heroBriefMain">
          <div class="heroTitle">${escapeHtml(hero.name)}</div>
          <div class="heroMeta">
            阵营：${TEAM[hero.team].name}<br>
            生命：${hero.hp}/${hero.maxHp}　攻击：${hero.atk}　普攻范围：${hero.attackRange}<br>
            普攻消耗：${hero.attackCost}　普通攻击次数：${hero.attackTimesThisTurn}/2
          </div>
        </div>
      </div>
    </div>
    <div class="heroCard">
      <strong>被动与状态</strong>
      <div class="heroMeta">被动：${escapeHtml(def.passive)}<br>当前状态：${escapeHtml(formatHeroFx(hero) || "无")}</div>
    </div>
    <div class="heroCard">
      <strong>技能速览</strong>
      <div class="skillChipRow">${skillChips}</div>
    </div>
  `;

  detail.innerHTML = `
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
  const bar = $("skillBar");
  bar.innerHTML = "";

  if (!hero || state.phase !== "battle" || !canAct(hero)) {
    bar.innerHTML = `<button disabled>请先选择可行动英雄</button>`;
    return;
  }

  const def = heroDef(hero);
  def.skills.forEach(s => {
    // 被动技能不放按钮，只展示描述。
    if (s.costText === "被动") return;
    const btn = document.createElement("button");
    btn.className = "skillButton";
    btn.innerHTML = `
      <span class="skillNo">技能${s.no}</span>
      <span class="skillName">${escapeHtml(s.title)}</span>
      <span class="skillCost">${escapeHtml(s.costText)}</span>
    `;
    btn.onclick = () => useSkill(hero, s.no);
    btn.disabled = !isSkillAvailable(hero, s.no);
    bar.appendChild(btn);
  });

  if (!def.skills.some(s => s.costText !== "被动")) {
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
    return teamAP(hero.team) >= 2 && hero.hp > 1;
  }

  if (hero.defId === "sword" && skillNo === 2) {
    return teamAP(hero.team) >= 5 && skillTargets(hero, 2).length > 0;
  }

  if (hero.defId === "sukuna" && skillNo === 2) {
    return hero.marks.length >= 5;
  }

  if (hero.defId === "sukuna" && skillNo === 4) {
    return hero.phase2 && teamAP(hero.team) >= 2;
  }

  if (hero.defId === "gojo" && skillNo === 2) {
    return teamAP(hero.team) >= 10;
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

  const hero = selectedHero();
  const target = heroAt(x, y);

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
  }

  // 未进入某个特殊选择状态时，按当前模式处理
  if (state.selectedMode === "move") {
    if (!target) {
      performMove(hero, x, y);
      return;
    }
  }

  if (state.selectedMode === "attack") {
    if (target && target.team !== hero.team) {
      performAttack(hero, target);
      return;
    }
  }

  if (state.selectedMode === "skill") {
    // 技能模式下点击空地没有意义；需要技能按钮触发 target/direction 逻辑
    return;
  }

  // 默认：如果点的是己方英雄，切换选择；否则不处理
  if (target && target.team === state.activeTeam) {
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

  hero.x = targetX;
  hero.y = targetY;
  log(`【${TEAM[hero.team].name}】${hero.name} 移动 (${hero.x},${hero.y}) → (${targetX},${targetY})，行动点数 ${apText(hero.team)}。`);
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
    resolveSwordSkill1(hero);
    return;
  }

  if (hero.defId === "sword" && skillNo === 2) {
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

  if (hero.defId === "sukuna" && skillNo === 4) {
    resolveSukunaSkill4(hero);
    return;
  }

  if (hero.defId === "gojo" && skillNo === 2) {
    resolveGojoSkill2(hero);
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
    showTargetSelection(hero, skillNo, "nightSkill1", "选择目标", "请选择 2 格内敌方英雄，造成 2 点伤害并附加灼烧。");
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

// ----------------------
// 各英雄技能结算
// ----------------------
function resolveSwordSkill1(hero) {
  if (teamAP(hero.team) < 2) return;
  state.ap[hero.team] -= 2;
  hero.tempAtkBonus += 1;
  hero.hp -= 1;
  log(`【${hero.name}】发动一式·血刃：本回合攻击力 +1，并失去 1 点生命。`);
  renderAll();
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

  hero.frozenTurns = Math.max(hero.frozenTurns, 2);
  log(`【${hero.name}】进入冻结状态 2 回合。`);
  checkGameOver();
  renderAll();
}

function resolveSukunaSkill2(hero) {
  if (hero.marks.length < 5) return;

  // 为了稳定与可读，这里将“标记连线范围”简化为“所有标记所在格”。
  // 如果以后你想做更严格的线段判定，只需要改这里，不用改其它文件。
  const markedCells = new Set(hero.marks.map(m => keyOf(m.x, m.y)));
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

function resolveSukunaSkill4(hero) {
  if (!hero.phase2) return;
  if (teamAP(hero.team) < 2) return;

  state.ap[hero.team] -= 2;

  state.effects.push({
    type: "sukunaDomain",
    ownerUid: hero.uid,
    team: hero.team,
    x: hero.x,
    y: hero.y,
    radius: 3,
    triggerTurn: state.turn + 1
  });

  log(`【${hero.name}】展开神魔领域：下回合开始时生效。`);
  renderAll();
}

function resolveGojoSkill2(hero) {
  if (teamAP(hero.team) < 10) return;
  state.ap[hero.team] -= 10;

  state.effects.push({
    type: "gojoDomain",
    ownerUid: hero.uid,
    team: hero.team,
    x: hero.x,
    y: hero.y,
    radius: 2,
    triggerTurn: state.turn + 1
  });

  log(`【${hero.name}】展开无量空处：下回合开始时生效。`);
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
  target.rootedTurns = Math.max(target.rootedTurns, 1);
  log(`【${hero.name}】使目标进入缠绕 1 回合。`);
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
  target.burnTurns = Math.max(target.burnTurns, 2);
  log(`【${hero.name}】附加灼烧 2 回合。`);
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
    triggerTurn: state.turn + 1
  });

  log(`【${hero.name}】展开赤夜结界：下回合开始时生效。`);
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
  $("btnMoveMode").onclick = () => {
    const hero = selectedHero();
    if (!hero) return;
    state.selectedMode = "move";
    renderAll();
  };
  $("btnAttackMode").onclick = () => {
    const hero = selectedHero();
    if (!hero) return;
    state.selectedMode = "attack";
    renderAll();
  };
  $("btnSkillMode").onclick = () => {
    const hero = selectedHero();
    if (!hero) return;
    state.selectedMode = "skill";
    renderAll();
  };
}

// ----------------------
// 初始化
// ----------------------
function init() {
  bindButtons();
  updateHud();
  renderAll();
  showIntro();
}

function updateHud() {
  renderHud();
}

// 在页面加载完成后启动
window.addEventListener("DOMContentLoaded", init);
