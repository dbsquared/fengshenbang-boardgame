/* =========================================================================
 * 封神榜 · 地牢（第一章）可玩原型  v0.4
 * 纯前端 / 原生 JS / SVG 渲染
 * 规则依据：../资料/封神榜规则书解析.md
 * 真实数据来源：素材原图/ （石友角色卡包、第一章剧情、地牢版图原图）
 *
 * v0.4 改动（用户绿笔标定六边形 → 全网格反解）：
 *   - 用户在 第一章-地牢-六边形标记.jpg 手绘一个六边形作为标定锚
 *   - 由 14 个标记物（4卒/5虚线圈/4火球/2火盆）拟合单应性矩阵 HOM
 *   - flat-top 三角格，SIZE=193，格心距≈334px，残差≤20px
 *   - 地图坐标系整体平移至 (0,0) 起点；邻接用 odd-q 列偏移
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------------- 网格几何（2026-09-06 用户绿笔标定版） ----------------
   * 用户在 第一章-地牢-六边形标记.jpg 手绘了一个六边形（内含虚线圈+宝箱）。
   * 以该六边形为锚，反解出全部标记物（4卒/5虚线圈/4火球/2火盆）共 14 点，
   * 全部落在同一个「flat-top 三角格」上，最小二乘拟合单应性矩阵（吸收拍照透视）：
   *   格心 (c,r) → 照片像素 (x,y)：
   *     i = (c + 2r + (c&1)) / 2 ,  j = (c - 2r - (c&1)) / 2
   *     [x y 1]ᵀ ~ HOM · [i j 1]ᵀ
   *   SIZE=193（格心距 √3R≈334px，与卒列垂直间距、红绿火球 568px=2×1.5R 一致）
   * 拟合残差 ≤20px。未再使用旧的刚性 OX/OY 公式。
   */
  const HOM = [
    [270.559652, 290.409270, 1179.79849],
    [145.910300, -164.473193, 1037.85004],
    [-0.008549, 0.004061, 1.0],
  ];
  const SIZE = 193;          // flat-top 六边形外接圆半径（由用户标记六边形反解）
  const SQRT3 = Math.sqrt(3);
  const PHOTO_W = 4080;
  const PHOTO_H = 3060;
  const VB_X = 0;
  const VB_Y = 0;
  const VB_W = PHOTO_W;
  const VB_H = PHOTO_H;

  /* ---------------- 地图布局（单应性格坐标系） ----------------
   * 图例: . 可走  # 墙/岩石  S 卒（姬昌胜利目标） P 玩家起点
   *       J 姬昌牢（墓碑）  B 宝箱  F 殷商步兵  R 殷商弓兵
   * 可玩区：中央亮橙色地板，c∈[0,9] r∈[0,4]（已含坐标平移）
   */
  const PLAY = { minCol: 0, maxCol: 9, minRow: 0, maxRow: 4 };

  // 内部岩石（不可走入/穿越）
  // 2026-09-06 深夜 v0.4.2（修正-2.jpg）：
  //   · 蓝火球格 (1,2) 为可走（用户蓝圈标注），恢复为殷商步兵出生点
  //   · 左侧大火盆实际在 (3,2)（此前误标 (1,2)），用户红X确认为障碍
  //   · (0,1) 为虚线圈格（修正-1 X#2），保持岩石
  //   红X共 10 格（修正-1）+ 火盆 (3,2)，共 16 格
  const ROCK_CELLS = [
    '3,2',                              // 左侧大火盆（用户红X，v0.4.2 修正位置）
    '7,1',                              // 右火盆岩台
    '3,3', '4,3',                       // 中部岩垄（宝箱下方）
    '4,0', '5,0',                       // 顶部岩垄（两块，锁链下方）
    '0,0', '0,1', '0,2', '0,3', '0,4',  // 左边界整列（用户红X）
    '3,4', '7,4', '9,4',                // 底行（用户红X）
    '6,1', '5,3',                       // 中部（用户红X）
  ];
  const ROCK_SET = new Set(ROCK_CELLS);

  // 说明书 P21「关卡设置⑦」：将玩家模型放置在地图上「卒」图标位置，
  // 每名玩家可自由选择 4 个位置的其中 1 个，但不能处于同一个格中。
  // 即「卒」格既是玩家起点，也是姬昌的胜利目标。本原型为单人，默认取 (9,0)。
  const SPECIAL = {
    '9,0': 'S', '9,1': 'S', '9,2': 'S', '9,3': 'S',  // 右列 4 卒（玩家起点 / 姬昌胜利目标）
    '1,3': 'J',   // 姬昌牢（虚线圈+墓碑）
    '4,4': 'B',   // 宝箱（虚线圈+宝箱，用户绿笔标记格）
    '1,2': 'F',   // 殷商步兵（蓝色火球，v0.4.2 恢复）
    '2,1': 'F',   // 殷商步兵（绿色火球）
    '4,1': 'R',   // 殷商弓兵（红色火球）
    '5,2': 'R',   // 殷商弓兵（黄色火球）
  };

  // 地图尺寸 = PLAY 外加一圈墙
  const MAP_ROWS = 7;   // rows 0..6
  const MAP_COLS = 11;  // cols 0..10

  // 程序化生成 LAYOUT（与 cells 数组同尺寸，便于调试；cells 解析不依赖 LAYOUT 字符串）
  const LAYOUT = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    let row = '';
    for (let c = 0; c < MAP_COLS; c++) {
      const k = c + ',' + r;
      if (c < PLAY.minCol || c > PLAY.maxCol || r < PLAY.minRow || r > PLAY.maxRow) row += '#';
      else if (ROCK_SET.has(k)) row += '#';
      else if (SPECIAL[k]) row += SPECIAL[k];
      else row += '.';
    }
    LAYOUT.push(row);
  }

  /* ---------------- 六边形数学 (flat-top, odd-q 列偏移) ----------------
   * 邻格方向（col 偶/奇两套）——由单应性像素反查验证（相邻格心距 √3R≈334px）：
   *   垂直同列上下相邻；偶列斜邻为 (c±1, r) 与 (c±1, r-1)，
   *   奇列斜邻为 (c±1, r) 与 (c±1, r+1)（奇列整体下移半格）。
   *   旧表左斜向写反（(c-1, r∓1) 误为 (c-1, r±1)），2026-09-06 修正。
   */
  const ODDQ_DIRS = [
    [[0, -1], [0, +1], [-1, 0], [-1, -1], [+1, 0], [+1, -1]],  // 偶数列
    [[0, -1], [0, +1], [-1, 0], [-1, +1], [+1, 0], [+1, +1]],  // 奇数列
  ];
  function neighbors(c) {
    const parity = c.col & 1;
    const out = [];
    for (const d of ODDQ_DIRS[parity]) out.push({ col: c.col + d[0], row: c.row + d[1] });
    return out;
  }
  function inBounds(c) { return c.row >= 0 && c.row < MAP_ROWS && c.col >= 0 && c.col < MAP_COLS; }
  // odd-q offset → cube 坐标
  function toCube(c) {
    const q = c.col;
    const rz = c.row - ((c.col - (c.col & 1)) / 2);
    return { x: q, z: rz, y: -q - rz };
  }
  function hexDist(a, b) { const A = toCube(a), B = toCube(b); return (Math.abs(A.x - B.x) + Math.abs(A.y - B.y) + Math.abs(A.z - B.z)) / 2; }
  function key(c) { return c.col + ',' + c.row; }
  function eq(a, b) { return a.col === b.col && a.row === b.row; }

  /* ---------------- 地图解析 ---------------- */
  const cells = [];
  const goals = []; // 玩家起点(姬昌胜利目标)
  let playerStart, jiStart, markerStart, minionSpawns = [];
  const rockSet = new Set(); // 反向集合，用于渲染岩石样式
  ROCK_CELLS.forEach(k => rockSet.add(k));
  for (let r = 0; r < MAP_ROWS; r++) {
    cells[r] = [];
    for (let c = 0; c < MAP_COLS; c++) {
      const k = c + ',' + r;
      const cell = { col: c, row: r, type: 'solid', feature: null, markerType: null };
      // 在 PLAY 矩形内的岩石才是可识别的内部岩石；矩形外都是墙
      if (c < PLAY.minCol || c > PLAY.maxCol || r < PLAY.minRow || r > PLAY.maxRow) {
        cell.type = 'wall';
      } else if (rockSet.has(k)) {
        cell.type = 'rock';
      } else if (SPECIAL[k]) {
        cell.type = 'floor';
        const sp = SPECIAL[k];
        if (sp === 'S') { cell.feature = 'goal'; goals.push({ col: c, row: r }); }
        else if (sp === 'J') { jiStart = { col: c, row: r }; cell.feature = 'ji'; }
        else if (sp === 'B') { cell.feature = 'chest'; }
        else if (sp === '*') { cell.feature = 'marker'; cell.markerType = 'heal'; markerStart = { col: c, row: r }; }
        else { cell.type = 'floor'; minionSpawns.push({ col: c, row: r, kind: sp }); }
      } else {
        cell.type = 'floor';
      }
      cells[r][c] = cell;
    }
  }
  // 玩家起点 = 4 个「卒」格之一（说明书 P21 关卡设置⑦）；单人原型默认最上方那个
  playerStart = { col: goals[0].col, row: goals[0].row };
  function cellAt(c) { return inBounds(c) ? cells[c.row][c.col] : null; }

  /* ---------------- 石友真实初始属性（按装备卡颜色数字之和 §3.1.3） ----------------
   * 由 石友角色卡包-正面.jpg 三张装备卡逐格裁出，卡面红/绿/蓝/橙 圆框数字：
   *   生锈的长枪 (武器·枪)  → 红1 绿0 蓝0 橙1   (武力1 内力0 灵力0 体力1)   被动/主动: 无特殊效果
   *   布衣        (防具)     → 红0 绿1 蓝0 橙0   (武力0 内力1 灵力0 体力0)   被动/主动: 无特殊效果
   *   琥珀串珠   (宝物)     → 红1 绿0 蓝0 橙1   (武力1 内力0 灵力0 体力1)
   *     · 主动技能: 承受 体力+3 伤害 (派猫时代为受击)
   *     · 图腾:    召唤 灵兽·通灵猫 (交互阶段可召)
   * 合计: 武力2 / 内力1 / 灵力0 / 体力2
   * 生命 = 8 + 体力×3 = 14
   * 移动 = 2 (本套装无 +移 加成)
   */
  const EQUIPMENT = [
    { key: 'spear', name: '生锈的长枪', type: '武器', weapon: '枪', img: '素材原图/装备卡-生锈的长枪.png',
      colors: { wu: 1, nei: 0, ling: 0, ti: 1 } },
    { key: 'cloth', name: '布衣', type: '防具', weapon: '', img: '素材原图/装备卡-布衣.png',
      colors: { wu: 0, nei: 1, ling: 0, ti: 0 } },
    { key: 'amber', name: '琥珀串珠', type: '宝物', weapon: '', img: '素材原图/装备卡-琥珀串珠.png',
      colors: { wu: 1, nei: 0, ling: 0, ti: 1 }, moveBonus: 0, absorb: 3, beast: '灵猫' },
  ];
  function sumEquipment() {
    const t = { wu: 0, nei: 0, ling: 0, ti: 0 };
    EQUIPMENT.forEach(e => { t.wu += e.colors.wu; t.nei += e.colors.nei; t.ling += e.colors.ling; t.ti += e.colors.ti; });
    let moveBonus = 0;
    EQUIPMENT.forEach(e => { if (e.moveBonus) moveBonus += e.moveBonus; });
    return { ...t, moveBonus };
  }
  const _sum = sumEquipment();
  const PLAYER_BASE = {
    wu: _sum.wu, nei: _sum.nei, ling: _sum.ling, ti: _sum.ti,
    hp: 8 + _sum.ti * 3, move: 2 + _sum.moveBonus,
  };

  /* ---------------- 石友初始卡组 ---------------- */
  const CARD_TPL = {
    tunci:    { id: 'tunci',    name: '突刺',   cost: 1, weapon: '枪', dmgMode: 'fixed', dmg: 2, range: 1, type: 'attack', desc: '造成2点伤害（需枪）' },
    yongtui:  { id: 'yongtui',  name: '用劲推', cost: 1, weapon: '',   dmgMode: 'wu',   range: 1, push: 1, type: 'attack', desc: '造成(武-1)伤害，推远1格' },
    lianhuan: { id: 'lianhuan', name: '连环掌', cost: 1, weapon: '',   dmgMode: 'wu',   range: 1, push: 1, type: 'attack', desc: '造成(武-1)伤害，推远1格' },
    gedang:   { id: 'gedang',   name: '格挡',   cost: 0, weapon: '',   type: 'react', desc: '减少1点伤害（应对卡）' },
    feitui:   { id: 'feitui',   name: '飞踢',   cost: 1, weapon: '',   dmgMode: 'wu',   range: 1, selfMove: true, type: 'attack', desc: '移动1格并造成(武-1)伤害' },
    tiaoxi:   { id: 'tiaoxi',   name: '调息',   cost: 'X', weapon: '', type: 'heal', healHp: 1, gainNei: 1, desc: '恢复1生命与1内力（耗全部内力X）' },
    huima:    { id: 'huima',    name: '回马枪', cost: 'X', weapon: '枪', dmgMode: 'wu', range: 1, selfMove: true, type: 'attack', desc: '移动1格造成(武-1)伤害（需枪）' },
  };
  function mkCard(id) { return Object.assign({}, CARD_TPL[id]); }
  function cardCost(card) { return card.cost === 'X' ? player.panel.nei : card.cost; }
  function cardDmg(card) { return card.dmgMode === 'fixed' ? card.dmg : Math.max(1, player.panel.wu - 1); }

  /* ---------------- 灵兽：通灵猫（琥珀串珠·特殊技能） ---------------- */
  // 移动2格 + 对相邻敌人造成1伤害。交互阶段可派出，已派出的猫本回合不再行动。
  function makeSpiritCat() {
    return { id: 'cat', name: '通灵猫', char: '貓', kind: 'spirit', isSpirit: true,
             pos: { col: player.pos.col, row: player.pos.row },
             move: 2, atk: 1, range: 1, alive: true, used: false,
             // 灵兽卡 4P-11：生命 5；与玩家相邻时伤害 +1。
             // 原型中仍暂列为非敌方目标（敌方不会主动攻击猫）。
             hp: 5, maxHp: 5 };
  }

  /* ---------------- 单位 ---------------- */
  // 敌方介绍卡 1-01：殷商步兵 HP5 / 殷商弓兵 HP3；被动技能 均「无特殊效果」
  // 攻击/移动/射程定义于敌方行动卡（用户提示：第一章正面/背面一一对应）
  //   殷商步兵  突刺 1-06/1-08/1-14 + 上挑 1-05：移动 2 格 → 距离 1 造成 3 伤害
  //   殷商弓兵  射击 1-11/1-12/1-15：移动 1 格 → 距离 3 造成 2 伤害
  // 第一章无头目（用户确认）。
  const MINION_TYPES = [
    { id: 'inf', name: '殷商步兵', char: '步', hp: 5, atk: 3, range: 1, move: 2 },
    { id: 'arc', name: '殷商弓兵', char: '弓', hp: 3, atk: 2, range: 3, move: 1 },
  ];
  function makeMinion(spawn, idx) {
    const spec = spawn.kind === 'R' ? MINION_TYPES[1] : MINION_TYPES[0];
    return {
      id: spec.id, name: spec.name, char: spec.char, kind: 'minion',
      type: spawn.kind === 'R' ? 'R' : 'F',   // F=步兵 R=弓兵（对应行动卡归属）
      pos: { col: spawn.col, row: spawn.row }, hp: spec.hp, maxHp: spec.hp,
      atk: spec.atk, range: spec.range, move: spec.move,
      spawn: { col: spawn.col, row: spawn.row },
      alive: true, reviveAtGoal: true, revives: 0, passive: '无特殊效果',
    };
  }
  /* ---------------- 敌方行动牌库（规则书 §4.4 / 说明书 P21） ----------------
   * 每个「敌方行动」阶段只结算牌库最上面的 1 张行动卡，由卡面右上角标明的兵种执行；
   * 该兵种若已阵亡，则改为在卒格复活（说明书 P22「源源不断的敌兵」）。
   * 牌库用完则将弃牌区洗混重来。
   * 第一章行动卡（资料提取 §7.2）：步兵 4 张（突刺 1-06/08/14 + 上挑 1-05）、弓兵 3 张（射击 1-11/12/15）
   */
  const ACTION_DECK_DEF = [
    { type: 'F', name: '突刺', code: '1-06' }, { type: 'F', name: '突刺', code: '1-08' },
    { type: 'F', name: '突刺', code: '1-14' }, { type: 'F', name: '上挑', code: '1-05' },
    { type: 'R', name: '射击', code: '1-11' }, { type: 'R', name: '射击', code: '1-12' },
    { type: 'R', name: '射击', code: '1-15' },
  ];
  let actionDeck = [], actionDiscard = [];
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function resetActionDeck() { actionDeck = shuffle(ACTION_DECK_DEF.slice()); actionDiscard = []; }
  function drawAction() {
    if (!actionDeck.length) { actionDeck = shuffle(actionDiscard.slice()); actionDiscard = []; }
    const c = actionDeck.shift(); if (c) actionDiscard.push(c); return c;
  }
  // 原型辅助：原规则（说明书 P22「源源不断的敌兵」）为无限复活，单人原型下几乎无法通关，
  // 故默认限制每只小兵最多复活 3 次；取消勾选「辅助」即恢复原规则。
  // 默认严格遵循说明书原规则：不擅自改动任何属性。
  // 姬昌 1 血 / 每回合 1 格；小兵 4 只；内力 1；小兵无限复活。
  // 下方开关为「偏离原规则的辅助」，默认全部关闭，需用户主动勾选才生效。
  const ASSIST = { enabled: false, reviveLimit: 999, jiHpAssist: false, drill: false, soloScale: false, jiStep2: false, neiAssist: false };
  // 姬昌生命：原规则 1（剧情卡 setup「1 枚数值为 1 的生命值标记」）；辅助模式下 6
  // （护送全程 8~9 步，弓兵射程 3 且优先攻击他，1 血必被点杀）。
  function jiHp() { return (ASSIST.enabled && ASSIST.jiHpAssist) ? 12 : 1; }
  // 内力：原规则 = 装备卡绿字之和（石友为 1，即每回合只出 1 张招式）。
  // 本章为 4 人局，4 名玩家合计每回合约 4 张；单人原型补偿为 4。
  function neiMax() { return (ASSIST.enabled && ASSIST.neiAssist) ? 4 : PLAYER_BASE.nei; }
  let player, jiChang, enemies, spiritCat;
  let UNIT_INFO = {};   // uid → 悬停信息卡 HTML（renderBoard 时刷新）
  function freshState() {
    player = {
      id: 'p', name: '石友', char: '石',
      pos: { col: playerStart.col, row: playerStart.row },
      panel: { wu: PLAYER_BASE.wu, nei: neiMax(), ling: PLAYER_BASE.ling, ti: PLAYER_BASE.ti,
               hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.hp, move: PLAYER_BASE.move,
               moveLeft: PLAYER_BASE.move, neiLeft: neiMax() },
      hand: [mkCard('tunci'), mkCard('yongtui'), mkCard('lianhuan'), mkCard('gedang'), mkCard('feitui'), mkCard('tiaoxi'), mkCard('huima')],
      discard: [],
      equipment: EQUIPMENT,
      status: { stun: false, poison: 0 }, alive: true, blockNext: false,
    };
    // 姬昌生命值 = 1（剧情卡 setup：「放置 1 枚数值为 1 的生命值标记」；
    // 说明书 P22 失败条件之一即「姬昌生命值为 0」）
    // found=false：未触发剧情前他锁在牢房里，不是场上单位，敌方不能以他为目标。
    // 说明书 P22「找到姬昌后，他会作为我方同伴参与行动」+ 小贴士「激活剧情牌是找到姬昌的关键」。
    jiChang = { name: '姬昌', char: '昌', pos: { col: jiStart.col, row: jiStart.row },
                hp: jiHp(), maxHp: jiHp(), found: false };
    // 单人配平：4 人局的 4 只小兵对单人原型约 10 点/回合伤害（石友仅 14 血），
    // 故辅助模式下只上 2 只（1 步兵 + 1 弓兵）。
    const spawns = ((ASSIST.enabled && ASSIST.soloScale) ? minionSpawns.slice(0, 2) : minionSpawns);
    enemies = spawns.map((s, i) => makeMinion(s, i));
    spiritCat = null; // 尚未派出
    if (markerStart) { cellAt(markerStart).feature = 'marker'; cellAt(markerStart).markerType = 'heal'; }
  }

  /* ---------------- 全局状态 ---------------- */
  const state = {
    phase: 'move', turn: 1, status: 'playing', msg: '', busy: false,
    selectedCard: null, attackPlayed: false, catMode: false, catStep: 0,
    reachSet: new Set(), tgtSet: new Set(), log: [],
  };
  const PHASE_NAME = { move: '移动阶段', attack: '出招阶段', interact: '交互阶段', enemy: '敌方行动' };

  /* ---------------- 占用 / 查询 ---------------- */
  function isOccupied(c) {
    if (player.alive && eq(player.pos, c)) return true;
    if (jiChang.hp > 0 && eq(jiChang.pos, c)) return true;
    for (const e of enemies) if (e.alive && eq(e.pos, c)) return true;
    if (spiritCat && spiritCat.alive && eq(spiritCat.pos, c)) return true;
    return false;
  }
  function enemyAt(c) { return enemies.find(e => e.alive && eq(e.pos, c)) || null; }

  /* ---------------- 移动可达 (BFS) ---------------- */
  function computeReach() {
    const reach = new Set();
    if (state.phase !== 'move') return reach;
    const start = player.pos;
    const dist = {}; dist[key(start)] = 0;
    const q = [start];
    while (q.length) {
      const cur = q.shift();
      const d = dist[key(cur)];
      if (d >= player.panel.moveLeft) continue;
      for (const nb of neighbors(cur)) {
        if (!inBounds(nb)) continue;
        const cl = cellAt(nb);
        if (!cl || cl.type === 'wall' || cl.type === 'rock') continue;
        if (isOccupied(nb)) continue;
        const k = key(nb);
        if (dist[k] === undefined) { dist[k] = d + 1; reach.add(k); q.push(nb); }
      }
    }
    return reach;
  }
  function isReachable(col, row) { return state.reachSet.has(col + ',' + row); }

  /* ---------------- 路径 (BFS) ---------------- */
  function pathTo(from, target) {
    const prev = {}, dist = {}; const q = [from]; dist[key(from)] = 0;
    while (q.length) {
      const cur = q.shift();
      if (eq(cur, target)) break;
      for (const nb of neighbors(cur)) {
        if (!inBounds(nb)) continue;
        const cl = cellAt(nb);
        if (!cl || cl.type === 'wall' || cl.type === 'rock') continue;
        if (isOccupied(nb) && !eq(nb, target)) continue;
        const k = key(nb);
        if (dist[k] === undefined) { dist[k] = dist[key(cur)] + 1; prev[k] = cur; q.push(nb); }
      }
    }
    if (dist[key(target)] === undefined) return null;
    const path = []; let cur = target;
    while (!eq(cur, from)) { path.unshift(cur); cur = prev[key(cur)]; if (cur === undefined) return null; }
    return path;
  }

  /* ---------------- 战斗 / 技能 ---------------- */
  function canPlay(card) {
    const cost = cardCost(card);
    if ((card.type === 'attack' || card.type === 'heal') && player.panel.neiLeft < cost) return false;
    if (card.weapon && card.weapon !== player.equipment[0].weapon) return false;
    return true;
  }
  function enemiesInRange(range) { return enemies.filter(e => e.alive && hexDist(player.pos, e.pos) <= range); }
  function isTargetable(en) {
    if (!state.selectedCard || state.selectedCard.type !== 'attack') return false;
    return hexDist(player.pos, en.pos) <= state.selectedCard.range;
  }
  function playCard(card, targetEnemy) {
    if (!canPlay(card)) { log('无法施展：' + card.name, 'bad'); return; }
    const cost = cardCost(card);
    if (card.type === 'react') {
      player.blockNext = true;
      log('石友架招（格挡）：将抵消下一次伤害', 'hit');
    } else if (card.type === 'heal') {
      player.panel.neiLeft -= cost;
      player.panel.hp = Math.min(player.panel.maxHp, player.panel.hp + (card.healHp || 0));
      player.panel.neiLeft += (card.gainNei || 0);
      log('石友调息：恢复' + (card.healHp || 0) + '生命、内力+1', 'hit');
    } else {
      player.panel.neiLeft -= cost;
      const dmg = cardDmg(card);
      const hits = card.aoe ? enemiesInRange(card.range) : (targetEnemy ? [targetEnemy] : []);
      hits.forEach(en => { en.hp -= dmg; log('石友以「' + card.name + '」对' + en.name + '造成' + dmg + '点伤害', 'hit'); });
      if (hits.length === 0) log('「' + card.name + '」未命中目标', 'bad');
      if (card.selfMove && targetEnemy) {
        const p = pathTo(player.pos, targetEnemy.pos);
        if (p && p.length) { const s = p[0]; if (!isOccupied(s)) player.pos = s; }
      }
      if (card.push && targetEnemy) {
        // 沿 (enemy - player) 方向推1格
        const dx = targetEnemy.pos.col - player.pos.col;
        const dy = targetEnemy.pos.row - player.pos.row;
        // 取最近方向
        const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]];
        let best = dirs[0], bestd = 999;
        dirs.forEach(d => { const dd = Math.hypot(d[0]-dx, d[1]-dy); if (dd < bestd) { bestd = dd; best = d; } });
        const np = { col: targetEnemy.pos.col + best[0], row: targetEnemy.pos.row + best[1] };
        if (inBounds(np)) {
          const cl = cellAt(np);
          if (cl && cl.type !== 'wall' && cl.type !== 'rock' && !isOccupied(np)) {
            targetEnemy.pos = np;
            log(targetEnemy.name + '被推远一格', 'hit');
          }
        }
      }
    }
    const idx = player.hand.indexOf(card); if (idx >= 0) player.hand.splice(idx, 1);
    player.discard.push(card);
    state.attackPlayed = true; state.selectedCard = null;
    checkDeaths(); checkEnd(); render();
  }

  /* ---------------- 通灵猫行动 ---------------- */
  // 派出 / 移动 / 攻击：交互阶段分两步：先点击召唤落点（≤2格且路径通），再点击相邻敌人攻击
  function canCatReach(c) {
    if (!spiritCat || !spiritCat.alive) return false;
    const d = hexDist(spiritCat.pos, c);
    if (d > 2 || d === 0) return false;
    const p = pathTo(spiritCat.pos, c);
    return !!p;
  }
  function catAtk(en) {
    if (!spiritCat || !spiritCat.alive || !en || !en.alive) return;
    let dmg = spiritCat.atk;
    if (hexDist(spiritCat.pos, player.pos) === 1) dmg += 1;
    en.hp -= dmg;
    log('通灵猫扑击' + en.name + '造成' + dmg + '点伤害', 'hit');
    spiritCat.used = true; state.catMode = false;
    checkDeaths(); checkEnd(); render();
  }
  function stepCat(toC) {
    if (!spiritCat) return;
    spiritCat.pos = { col: toC.col, row: toC.row };
    log('通灵猫移动到 (' + toC.col + ',' + toC.row + ')', 'hit');
    render();
  }

  /* ---------------- 原型辅助 ---------------- */
  function applyJiHp() {
    if (!jiChang) return;
    const v = jiHp();
    jiChang.maxHp = v;
    if (!jiChang.found) jiChang.hp = v;              // 未出场：直接按新上限设置
    else jiChang.hp = Math.min(jiChang.hp, v);       // 已在场：不回血，仅夹紧上限
  }
  // 演练模式：清空小兵，用于确定性验证「找到姬昌 → 护送到卒格 → 胜利」链路
  function applyDrill() {
    if (!enemies) return;
    if (ASSIST.drill) {
      enemies.forEach(e => { e.alive = false; });
    } else {
      enemies.forEach(e => {
        if (isOccupied(e.spawn)) return;             // 出生点被占则暂不恢复
        e.pos = { col: e.spawn.col, row: e.spawn.row };
        e.hp = e.maxHp; e.alive = true; e.revives = 0;
      });
    }
  }
  /* ---------------- 敌方 AI ---------------- */
  function enemyAct(e) {
    // 未触发剧情前姬昌在牢房里，不是合法目标。
    // 注：规则书 §4.4 灵兽也是敌方目标，但通灵猫缺少灵兽卡生命值数据，原型暂不列为目标。
    const targets = [player, jiChang]
      .filter(t => t && hpOf(t) > 0 && (t.alive !== false)
                    && (t !== jiChang || jiChang.found));
    if (!targets.length) return;
    targets.sort((a, b) => hexDist(e.pos, a.pos) - hexDist(e.pos, b.pos));
    const moveTarget = targets[0];
    // 敌方移动规则：在射程内则停止移动（规则书 §4.4），否则向最近目标靠拢
    if (hexDist(e.pos, moveTarget.pos) > e.range) {
      const path = pathTo(e.pos, moveTarget.pos);
      if (path && path.length) {
        for (let i = 0; i < e.move && i < path.length; i++) {
          const step = path[i];
          if (isOccupied(step)) break;
          e.pos = step;
          if (hexDist(e.pos, moveTarget.pos) <= e.range) break;
        }
      }
    }
    // 说明书 P22「护送姬昌」：若姬昌与玩家同时处在敌方最近攻击范围内，敌方优先攻击姬昌
    const inRange = targets.filter(t => hexDist(e.pos, t.pos) <= e.range);
    if (inRange.length) {
      const tgt = (jiChang.hp > 0 && inRange.indexOf(jiChang) >= 0) ? jiChang : inRange[0];
      enemyAttack(e, tgt);
    }
  }
  // 注意：玩家的血量在 player.panel.hp，姬昌/小兵在各自的 .hp —— 统一走这两个存取器，
  // 否则会出现「攻击日志正常但玩家永远不掉血」的假象（v0.5 修复）。
  function hpOf(t) { return t === player ? player.panel.hp : t.hp; }
  function dealDamage(t, dmg) { if (t === player) player.panel.hp -= dmg; else t.hp -= dmg; }
  function enemyAttack(e, target) {
    let dmg = e.atk;
    if (target.blockNext) { target.blockNext = false; log(target.name + '架招抵消了' + e.name + '的攻击！', 'hit'); return; }
    dealDamage(target, dmg);
    log(e.name + '攻击' + target.name + '，造成' + dmg + '点伤害', 'bad');
    if (target === player) {
      if (player.panel.hp <= 0) { player.panel.hp = 0; player.alive = false; }
    } else if (target.hp <= 0) { target.hp = 0; }
  }

  /* ---------------- 复活（回到玩家起点/卒） ---------------- */
  function reviveMinions() {
    if (ASSIST.drill) return;   // 演练模式：不复活
    enemies.forEach(e => { if (e.kind === 'minion' && !e.alive && e.reviveAtGoal) reviveOne(e); });
  }
  // 复活单只：说明书 P22「源源不断的敌兵」——改为在「离玩家最近的卒格」复活；
  // 若所有卒格都有单位，则在与卒格相邻、且离玩家最近的格子上复活。
  function reviveOne(e) {
    if (e.kind !== 'minion' || e.alive || !e.reviveAtGoal) return false;
    if (ASSIST.drill) return false;
    if (ASSIST.enabled && e.revives >= ASSIST.reviveLimit) return false;  // 辅助：复活次数用尽
    const sorted = goals.slice().sort((a, b) => hexDist(player.pos, a) - hexDist(player.pos, b));
    let spot = sorted.find(g => !isOccupied(g));
    if (!spot) {
      const cands = [];
      sorted.forEach(g => neighbors(g).forEach(n => {
        const cl = cellAt(n);
        if (cl && cl.type === 'floor' && !isOccupied(n)) cands.push(n);
      }));
      cands.sort((a, b) => hexDist(player.pos, a) - hexDist(player.pos, b));
      spot = cands[0];
    }
    if (!spot) return false;
    e.pos = { col: spot.col, row: spot.row };
    e.hp = e.maxHp; e.alive = true; e.revives += 1;
    log(e.name + '在离玩家最近的起点（卒）复活！' +
        (ASSIST.enabled ? '（剩余复活 ' + (ASSIST.reviveLimit - e.revives) + ' 次）' : ''), 'bad');
    return true;
  }

  /* ---------------- 姬昌护送 ---------------- */
  function stepJiChang() {
    if (!jiChang.found) { log('尚未找到姬昌，先走到牢房相邻格', 'bad'); render(); return; }
    const sorted = goals.slice().sort((a, b) => hexDist(jiChang.pos, a) - hexDist(jiChang.pos, b));
    const goal = sorted[0];
    const path = pathTo(jiChang.pos, goal);
    if (path && path.length) {
      // 辅助：姬昌每回合走 2 格（同伴行动卡数据缺失；护送全程 8 步否则过慢）
      const steps = (ASSIST.enabled && ASSIST.jiStep2) ? Math.min(2, path.length) : 1;
      let moved = 0;
      for (let i = 0; i < steps; i++) {
        const p2 = pathTo(jiChang.pos, goal);
        if (!p2 || !p2.length) break;
        const step = p2[0];
        if (isOccupied(step)) { log('姬昌被挡住，无法前进', 'bad'); break; }
        jiChang.pos = { col: step.col, row: step.row };
        moved += 1;
      }
      if (moved) log('姬昌向起点（卒）移动 ' + moved + ' 格', 'hit');
    } else log('姬昌无路可走', 'bad');
    checkEnd(); render();
  }

  /* ---------------- 阶段推进 ---------------- */
  function endPhase() {
    if (state.busy || state.status !== 'playing') return;
    if (state.phase === 'move') { state.phase = 'attack'; state.attackPlayed = false; state.selectedCard = null; }
    else if (state.phase === 'attack') { state.phase = 'interact'; state.selectedCard = null; }
    else if (state.phase === 'interact') {
      state.phase = 'enemy'; state.selectedCard = null; state.catMode = false;
      // 通灵猫：本阶段出过则收回
      if (spiritCat) { spiritCat = null; }
      runEnemyPhase(); return;
    }
    render();
  }
  function startNewTurn() {
    state.turn += 1; state.phase = 'move';
    player.panel.moveLeft = player.panel.move;
    player.panel.neiLeft = player.panel.nei;
    player.blockNext = false; state.busy = false; state.catMode = false;
    render();
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function runEnemyPhase() {
    state.busy = true; render();
    // 规则：每阶段只结算牌库最上面的 1 张敌方行动卡（说明书 P21④ / 规则书 §4.4）
    const card = drawAction();
    const unitName = card.type === 'R' ? '殷商弓兵' : '殷商步兵';
    log('—— 敌方行动：' + card.name + '（' + card.code + '）· ' + unitName + ' ——');
    const actor = enemies.find(e => e.alive && e.type === card.type);
    if (actor) {
      enemyAct(actor); checkEnd(); render();
      if (state.status !== 'playing') { state.busy = false; return; }
      await sleep(450);
    } else {
      // 该兵种已阵亡：轮到他行动时不执行行动，改为在卒格复活（说明书 P22）
      const dead = enemies.find(e => !e.alive && e.type === card.type);
      if (dead && reviveOne(dead)) render();
      else log(unitName + '不在场，跳过', '');
      await sleep(300);
    }
    if (state.status !== 'playing') { state.busy = false; render(); return; }
    await sleep(200); startNewTurn();
  }

  /* ---------------- 胜负 ---------------- */
  function jiChangAtGoal() { return cellAt(jiChang.pos) && cellAt(jiChang.pos).feature === 'goal'; }
  function checkEnd() {
    if (state.status !== 'playing') return;
    if (jiChang.hp <= 0) { state.status = 'lose'; state.msg = '姬昌陨落，护送失败！'; }
    else if (player.panel.hp <= 0) { state.status = 'lose'; state.msg = '石友阵亡，地牢失守！'; }
    else if (jiChangAtGoal()) { state.status = 'win'; state.msg = '姬昌安然回到起点 —— 第一章·地牢通关！'; }
    else if (!ASSIST.drill && enemies.every(e => !e.alive)) { state.status = 'win'; state.msg = '地牢肃地，姬昌得以护送！'; }
    if (state.status !== 'playing') log(state.msg, state.status === 'win' ? 'win' : 'bad');
  }
  function checkDeaths() {
    for (const e of enemies) {
      if (e.alive && e.hp <= 0) { e.alive = false; log(e.name + '被击倒！', 'win'); }
    }
  }

  /* ---------------- 交互：点击格子 ---------------- */
  function onCellClick(col, row) {
    if (state.busy || state.status !== 'playing') return;
    const c = { col, row };
    if (state.phase === 'move') { if (isReachable(col, row)) stepMove(c); }
    else if (state.phase === 'attack') {
      if (state.selectedCard && state.selectedCard.type === 'attack') {
        const en = enemyAt(c);
        if (en && isTargetable(en)) playCard(state.selectedCard, en);
      }
    } else if (state.phase === 'interact') {
      if (state.catMode) {
        const en = enemyAt(c);
        if (en && spiritCat && hexDist(spiritCat.pos, c) === 1) { catAtk(en); return; }
        if (spiritCat && !spiritCat.used && canCatReach(c)) { stepCat(c); return; }
      }
    }
  }
  function stepMove(c) {
    player.pos = { col: c.col, row: c.row };
    player.panel.moveLeft -= 1;
    const cell = cellAt(c);
    if (cell.feature === 'marker' && cell.markerType === 'heal') {
      const before = player.panel.hp;
      player.panel.hp = Math.min(player.panel.maxHp, player.panel.hp + 4);
      log('触发叹号标记：治疗 +' + (player.panel.hp - before) + ' 生命', 'hit');
      cell.feature = null; cell.markerType = null;
    }
    // 剧情触发：走到牢房相邻格即「找到姬昌」（说明书：激活剧情牌是找到姬昌的关键）
    if (!jiChang.found && jiChang.hp > 0 && hexDist(player.pos, jiChang.pos) <= 1) {
      jiChang.found = true;
      log('剧情·地牢深处：找到姬昌！他作为同伴加入行动（生命 ' + jiChang.maxHp +
          '，敌方在射程内会优先攻击他）', 'win');
    }
    render();
  }

  /* ---------------- 日志 ---------------- */
  function log(text, cls) {
    state.log.unshift({ t: text, c: cls || '' });
    if (state.log.length > 60) state.log.pop();
  }

  /* ---------------- 渲染 ---------------- */
  function hexCenter(col, row) {
    // 单应性格心映射（透视已校正），见文件头「网格几何」说明。
    // 地图坐标相对标定锚整体平移了 (+2,+1)；(c,r)→(i,j) 对平移不是不变的，
    // 换算后 i 需 -2、j 不变（推导见 memory/2026-09-06.md）。
    const i = (col + 2 * row + (col & 1)) / 2 - 2;
    const j = (col - 2 * row - (col & 1)) / 2;
    const den = HOM[2][0] * i + HOM[2][1] * j + 1;
    return {
      x: (HOM[0][0] * i + HOM[0][1] * j + HOM[0][2]) / den,
      y: (HOM[1][0] * i + HOM[1][1] * j + HOM[1][2]) / den,
    };
  }
  function hexPoints(cx, cy) {
    // flat-top 6 顶点（顺时针，从右侧开始）
    const s3_2 = SIZE * SQRT3 / 2;
    const pts = [
      [cx + SIZE,   cy         ],
      [cx + SIZE/2, cy - s3_2  ],
      [cx - SIZE/2, cy - s3_2  ],
      [cx - SIZE,   cy         ],
      [cx - SIZE/2, cy + s3_2  ],
      [cx + SIZE/2, cy + s3_2  ],
    ];
    return pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  }
  function renderBoard() {
    const svg = document.getElementById('board');
    svg.setAttribute('viewBox', VB_X + ' ' + VB_Y + ' ' + VB_W + ' ' + VB_H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    UNIT_INFO = {};
    state.reachSet = computeReach();
    state.tgtSet = new Set();
    if (state.phase === 'attack' && state.selectedCard && state.selectedCard.type === 'attack') {
      enemiesInRange(state.selectedCard.range).forEach(e => state.tgtSet.add(key(e.pos)));
    }

    let s = '';
    // 底图：第一章·地牢原图（与 viewBox 一致）
    s += '<image href="素材原图/章节地图/第一章-地牢.jpg" ' +
      'x="0" y="0" width="' + PHOTO_W + '" height="' + PHOTO_H + '" preserveAspectRatio="xMidYMid slice"/>';
    // 压暗叠层
    s += '<rect class="board-veil" x="0" y="0" width="' + PHOTO_W + '" height="' + PHOTO_H + '"/>';

    // 可走 / 岩石格子（墙不渲染，原图岩壁就是墙）
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const cell = cells[r][c];
        if (cell.type === 'wall') continue;
        const { x, y } = hexCenter(c, r);
        const k = c + ',' + r;
        let cls = 'hex';
        if (cell.type === 'rock') cls += ' rock';
        if (cell.feature === 'goal') cls += ' exit';
        if (state.reachSet.has(k)) cls += ' reach';
        if (state.tgtSet.has(k)) cls += ' tgt';
        if (state.catMode && spiritCat && !spiritCat.used) {
          const cl = cellAt({ col: c, row: r });
          if (cl && cl.type === 'floor') {
            if (canCatReach({ col: c, row: r })) cls += ' cat-reach';
            if (hexDist(spiritCat.pos, { col: c, row: r }) === 1 && enemyAt({ col: c, row: r })) cls += ' cat-tgt';
          }
        }
        const label = cell.feature === 'goal' ? '卒' : (cell.feature === 'ji' ? '牢' : (cell.feature === 'chest' ? '宝' : (cell.feature === 'start' ? '入' : '')));
        s += '<polygon class="' + cls + '" data-col="' + c + '" data-row="' + r + '" points="' + hexPoints(x, y) + '">';
        s += '<title>' + (label || ('(' + c + ',' + r + ')')) + '</title></polygon>';
        if (cell.feature === 'goal') s += '<circle class="exit-glow" cx="' + x + '" cy="' + y + '" r="' + (SIZE * 0.62) + '"/>';
        if (cell.feature === 'marker') s += '<text class="marker" x="' + x + '" y="' + y + '">！</text>';
      }
    }
    /* 单位渲染：同格多单位时水平错开（重叠效果），各自保留 hover 与点击 */
    const unitList = [];
    enemies.forEach((e, i) => { if (e.alive) unitList.push([e, 'u-minion', 'm' + i]); });
    if (jiChang.hp > 0) unitList.push([jiChang, 'u-ji', 'ji']);
    if (player.alive) unitList.push([player, 'u-player', 'p']);
    if (spiritCat && spiritCat.alive) unitList.push([spiritCat, 'u-cat', 'cat']);
    const cellTotal = {}, cellIdx = {};
    unitList.forEach(([u]) => { const k = key(u.pos); cellTotal[k] = (cellTotal[k] || 0) + 1; });
    unitList.forEach(([u, cls, uid]) => {
      const k = key(u.pos);
      const idx = cellIdx[k] || 0; cellIdx[k] = idx + 1;
      s += unit(u, cls, uid, idx, cellTotal[k]);
    });
    svg.innerHTML = s;
  }
  function unit(u, cls, uid, idx, total) {
    let { x, y } = hexCenter(u.pos.col, u.pos.row);
    let r = SIZE * 0.55, fs = 96;
    if (total > 1) {  // 错位：按序号水平排开并缩小
      x += (idx - (total - 1) / 2) * SIZE * 0.58;
      r = SIZE * 0.40;
      fs = 68;
    }
    UNIT_INFO[uid] = describeUnit(u, cls);
    const dim = (u === jiChang && !jiChang.found) ? ' opacity=".55"' : '';
    const kindAttr = u.type ? ' data-kind="' + u.type + '"' : '';
    let out = '<circle class="unit-circle ' + cls + '" data-uid="' + uid + '" data-col="' + u.pos.col + '" data-row="' + u.pos.row +
      '" cx="' + x + '" cy="' + y + '" r="' + r + '"' + dim + kindAttr + '/>';
    out += '<text class="unit-label" style="font-size:' + fs + 'px" x="' + x + '" y="' + y + '">' + u.char + '</text>';
    const hp = u.hp != null ? u.hp : (u.panel ? u.panel.hp : '');
    if (hp != '') out += '<text class="unit-hp" style="font-size:' + (total > 1 ? 30 : 40) + 'px" x="' + x + '" y="' + (y + r * 1.18) + '">' + hp + '</text>';
    return out;
  }
  /* 单位悬停信息卡内容 */
  function describeUnit(u, cls) {
    let h = '';
    if (cls === 'u-player') {
      const p = u.panel;
      h += '<b>石友 · 少年英雄</b><br>';
      h += '生命 ' + p.hp + '/' + p.maxHp + '（8+体力×3）<br>';
      h += '武力 ' + p.wu + ' ／ 内力 ' + p.nei + ' ／ 灵力 ' + p.ling + ' ／ 体力 ' + p.ti + '<br>';
      h += '移动 ' + p.move + ' ／ 剩余移动 ' + p.moveLeft + ' ／ 剩余内力 ' + p.neiLeft + '<br>';
      h += '装备：' + u.equipment.map(e => e.name).join('、') + '<br>';
      h += '<span class="tip-dim">琥珀串珠可召灵兽·通灵猫（交互阶段）</span>';
    } else if (cls === 'u-minion') {
      h += '<b>' + u.name + '</b>（敌方）<br>';
      h += '生命 ' + u.hp + '/' + u.maxHp + '<br>';
      h += '攻击 ' + u.atk + ' ／ 移动 ' + u.move + ' ／ 射程 ' + u.range + '<br>';
      h += '<span class="tip-dim">击杀后在「离玩家最近的卒格」复活' +
        (ASSIST.enabled ? '；剩余复活 ' + Math.max(0, ASSIST.reviveLimit - u.revives) + ' 次' : '（原规则：无限）') +
        '</span>';
    } else if (cls === 'u-ji') {
      h += '<b>姬昌</b>（护送目标）<br>';
      h += '生命 ' + u.hp + '/' + u.maxHp + '　状态：' + (u.found ? '已加入队伍' : '<b>未发现</b>（锁在牢房，敌方无法以他为目标）') + '<br>';
      h += '<span class="tip-dim">无战斗力。走到他相邻格即触发剧情「找到姬昌」；之后石友相邻时点「护送姬昌」让他向最近的「卒」移动一格，抵达任意「卒」格即胜利。<br>注意：说明书 P22——若姬昌与玩家同时进入敌方射程，<b>敌方优先攻击姬昌</b>。</span>';
    } else if (cls === 'u-cat') {
      h += '<b>灵兽 · 通灵猫</b><br>';
      h += '生命 ' + u.hp + '/' + u.maxHp + '（灵兽卡 4P-11；原型中敌方暂不攻击猫）<br>';
      h += '移动 2 ／ 伤害 1（与玩家相邻则 +1，交互阶段可操作）<br>';
      h += '<span class="tip-dim">代替石友承受伤害；阶段结束自动收回</span>';
    }
    return h;
  }
  function renderPanel() {
    const p = player.panel;
    const el = document.getElementById('playerPanel');
    const pct = Math.round(p.hp / p.maxHp * 100);
    const eqHtml = player.equipment.map(e =>
      '<div class="eq-card" title="' + e.name + ' (' + e.type + ')">' +
      '<img src="' + e.img + '" alt="' + e.name + '" onerror="this.style.background=&quot;#3a2f24&quot;this.style.minHeight=&quot;80px&quot;"/>' +
      '<div class="eq-info">' +
      '<div class="eq-name">' + e.name + '</div>' +
      '<div class="eq-stats">武力<span class="c-red">' + e.colors.wu + '</span> 内力<span class="c-green">' + e.colors.nei + '</span> 灵力<span class="c-blue">' + e.colors.ling + '</span> 体力<span class="c-orange">' + e.colors.ti + '</span></div>' +
      (e.moveBonus ? '<div class="eq-bonus">移动+1</div>' : '') +
      (e.beast ? '<div class="eq-bonus">灵兽：' + e.beast + '</div>' : '') +
      '</div></div>'
    ).join('');
    el.innerHTML =
      '<div class="hero-row"><img class="hero-portrait" src="素材原图/石友头像.jpg" alt="石友"/>' +
      '<div class="meta"><h3>' + player.name + ' · 少年英雄</h3>' +
      '<div class="eq-line">装备合计 → 武力' + p.wu + ' / 内力' + p.nei + ' / 灵力' + p.ling + ' / 体力' + p.ti + '</div>' +
      '</div></div>' +
      '<div class="eq-row">' + eqHtml + '</div>' +
      '<div class="stat-grid">' + stat('武力', p.wu) + stat('内力', p.nei) + stat('灵力', p.ling) + stat('体力', p.ti) + '</div>' +
      '<div class="hpbar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="sub"><span>生命 ' + p.hp + '/' + p.maxHp + '</span><span>移动 ' + p.moveLeft + '/' + p.move + '</span><span>内力 ' + p.neiLeft + '/' + p.nei + '</span></div>' +
      '<div class="sub"><span>姬昌 ' + (jiChang.found ? jiChang.hp + '/' + jiChang.maxHp + '（已加入）' : '未发现') +
        '</span><span>目标：送姬昌回起点（卒）</span></div>';
  }
  function stat(k, v) { return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
  function renderHand() {
    const el = document.getElementById('hand');
    el.innerHTML = '';
    if (player.hand.length === 0) { el.innerHTML = '<div style="color:var(--ink-dim);font-size:13px">（手牌为空，可「休整」收回）</div>'; return; }
    player.hand.forEach(card => {
      const dis = state.phase !== 'attack' || !canPlay(card);
      const div = document.createElement('div');
      div.className = 'card' + (state.selectedCard === card ? ' sel' : '') + (dis ? ' dis' : '');
      div.innerHTML =
        '<div class="cost">' + (card.cost === 'X' ? 'X' : card.cost) + '</div>' +
        '<div class="nm">' + card.name + '</div>' +
        '<div class="ds">' + (card.desc || '') + '</div>' +
        (card.weapon ? '<div class="wp">' + card.weapon + '</div>' : '');
      if (!dis) div.addEventListener('click', () => {
        if (card.type === 'react') { playCard(card, null); return; }
        state.selectedCard = (state.selectedCard === card) ? null : card;
        render();
      });
      el.appendChild(div);
    });
  }
  function renderButtons() {
    document.getElementById('btnRest').disabled =
      !(state.phase === 'attack' && !state.attackPlayed && player.discard.length > 0 && player.hand.length === 0);
    const adjacent = hexDist(player.pos, jiChang.pos) === 1;
    document.getElementById('btnEscort').disabled = !(state.phase === 'interact' && adjacent && jiChang.hp > 0);
    document.getElementById('btnCat').disabled = !(state.phase === 'interact' && !spiritCat);
    document.getElementById('btnEnd').disabled = state.busy || state.status !== 'playing';
  }
  function renderLog() {
    document.getElementById('log').innerHTML = state.log.map(l => '<p class="l ' + l.c + '">' + l.t + '</p>').join('');
  }
  function render() {
    document.getElementById('phaseBadge').textContent = PHASE_NAME[state.phase] || state.phase;
    document.getElementById('turnInfo').textContent = '回合 ' + state.turn;
    const banner = document.getElementById('banner');
    if (state.status === 'win') { banner.textContent = state.msg; banner.className = 'banner win'; }
    else if (state.status === 'lose') { banner.textContent = state.msg; banner.className = 'banner lose'; }
    else { banner.textContent = ''; banner.className = 'banner'; }
    renderBoard(); renderPanel(); renderHand(); renderButtons(); renderLog(); renderDeck();
  }
  /* 敌方行动牌库状态（规则书 §4.4：每阶段结算最上面 1 张） */
  function renderDeck() {
    const el = document.getElementById('deckInfo');
    if (!el) return;
    const last = actionDiscard.length ? actionDiscard[actionDiscard.length - 1] : null;
    el.innerHTML =
      '<div class="deck-line"><span>牌库 <b>' + actionDeck.length + '</b> 张</span>' +
      '<span>弃牌 <b>' + actionDiscard.length + '</b> 张</span></div>' +
      (last ? '<div class="tip-dim">上一张：' + last.name + '（' + last.code + '）· ' +
        (last.type === 'R' ? '殷商弓兵' : '殷商步兵') + '</div>' : '<div class="tip-dim">本局尚未结算行动卡</div>');
  }

  /* ---------------- 素材原图 / 剧情 弹窗 ---------------- */
  const STORY = '【第一章 · 地牢深处】\n\n四人顺着廊道，在廊道最深处的牢房中，看到一位白发苍苍的老人……\n\n将姬昌立牌放在牢房格，作为同伴行动。当姬昌移动至任意玩家起点（卒）时，游戏胜利。';
  const REF_IMAGES = [
    { src: '素材原图/石友角色卡包-正面.jpg', cap: '石友·角色卡包(正面)' },
    { src: '素材原图/石友角色卡包-背面.jpg', cap: '石友·角色卡包(背面)' },
    { src: '素材原图/角色面板.jpg', cap: '角色面板' },
    { src: '素材原图/第一章-正面.jpg', cap: '第一章·卡牌摊放(原图)' },
    { src: '素材原图/第一章-背面.jpg', cap: '第一章·卡牌(背面)' },
    { src: '素材原图/第一章剧情-正面.jpg', cap: '第一章剧情(正面)' },
    { src: '素材原图/第一章剧情-背面.jpg', cap: '第一章剧情(背面·设置)' },
    { src: '素材原图/提示卡-正面.jpg', cap: '提示卡(正面)' },
    { src: '素材原图/提示卡-反面.jpg', cap: '提示卡(反面·图标释义)' },
    { src: '素材原图/浪潮-第五章.jpg', cap: '第五章版图样例(参考)' },
  ];
  function openModal(html) { document.getElementById('modalBody').innerHTML = html; document.getElementById('modal').classList.remove('hidden'); }
  function closeModal() { document.getElementById('modal').classList.add('hidden'); }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    document.getElementById('board').addEventListener('click', e => {
      const poly = e.target.closest('[data-col]');
      if (poly) onCellClick(+poly.dataset.col, +poly.dataset.row);
    });
    // 单位悬停信息卡
    const board = document.getElementById('board');
    const tip = document.getElementById('unitTip');
    board.addEventListener('mousemove', e => {
      const t = e.target.closest ? e.target.closest('.unit-circle') : null;
      const info = t && UNIT_INFO[t.dataset.uid];
      if (info) {
        tip.innerHTML = info;
        tip.style.display = 'block';
        const r = tip.getBoundingClientRect();
        const pad = 16;
        let x = e.clientX + pad, y = e.clientY + pad;
        if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
        if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
      } else {
        tip.style.display = 'none';
      }
    });
    board.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    document.getElementById('btnEnd').addEventListener('click', endPhase);
    document.getElementById('btnRest').addEventListener('click', () => {
      if (state.phase !== 'attack' || state.attackPlayed || player.hand.length > 0) return;
      player.hand = player.discard; player.discard = [];
      log('石友休整：收回全部招式', 'hit');
      state.attackPlayed = true; render();
    });
    document.getElementById('btnEscort').addEventListener('click', () => {
      if (state.phase === 'interact' && hexDist(player.pos, jiChang.pos) === 1) stepJiChang();
    });
    document.getElementById('btnCat').addEventListener('click', () => {
      if (state.phase !== 'interact' || spiritCat) return;
      spiritCat = makeSpiritCat();
      state.catMode = true;
      log('琥珀串珠激活：派出通灵猫！点击 ≤2 格的格子移动，再点相邻敌人扑击', 'win');
      render();
    });
    const chk = document.getElementById('chkAssist');
    if (chk) {
      chk.checked = ASSIST.enabled;
      chk.addEventListener('change', () => {
        ASSIST.enabled = chk.checked;
        const chkJi = document.getElementById('chkJiHp');
        if (chkJi) chkJi.disabled = !chk.checked;
        applyJiHp();
        log(chk.checked ? '原型辅助：小兵复活上限 3 次' : '已关闭辅助：恢复说明书原规则（小兵无限复活）', 'hit');
        render();
      });
    }
    const chkJi = document.getElementById('chkJiHp');
    if (chkJi) {
      chkJi.checked = ASSIST.jiHpAssist;
      chkJi.addEventListener('change', () => {
        ASSIST.jiHpAssist = chkJi.checked;
        applyJiHp();
        log('姬昌生命上限：' + jiHp() + (jiHp() === 1 ? '（原规则）' : '（辅助）'), 'hit');
        render();
      });
    }
    const chkSolo = document.getElementById('chkSolo');
    if (chkSolo) {
      chkSolo.checked = ASSIST.soloScale;
      chkSolo.addEventListener('change', () => {
        ASSIST.soloScale = chkSolo.checked;
        restart();
        log('单人配平：小兵 ' + (chkSolo.checked && ASSIST.enabled ? 2 : 4) + ' 只（已重开本局）', 'hit');
      });
    }
    const chkDrill = document.getElementById('chkDrill');
    if (chkDrill) {
      chkDrill.checked = ASSIST.drill;
      chkDrill.addEventListener('change', () => {
        ASSIST.drill = chkDrill.checked;
        applyDrill();
        log(chkDrill.checked ? '演练模式：已清空小兵（胜利条件仅剩「护送姬昌到卒格」）'
                             : '演练模式关闭：小兵回到出生点', 'hit');
        render();
      });
    }
    document.getElementById('btnRestart').addEventListener('click', () => {
      restart();
      log('已重开本局。', 'hit');
      render();
    });
    document.getElementById('btnStory').addEventListener('click', () =>
      openModal('<h2>第一章 · 地牢深处</h2><div class="story-text">' + STORY + '</div>'));
    document.getElementById('btnRef').addEventListener('click', () =>
      openModal('<h2>素材原图 · 参考</h2><div class="gallery">' +
        REF_IMAGES.map(r => '<figure><img src="' + r.src + '" alt="' + r.cap + '"/><figcaption>' + r.cap + '</figcaption></figure>').join('') + '</div>'));
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    document.getElementById('modalBody').addEventListener('click', e => { if (e.target.tagName === 'IMG') e.target.classList.toggle('zoom'); });
  }

  /* ---------------- 启动 ---------------- */
  function restart() {
    freshState(); resetActionDeck();
    state.phase = 'move'; state.turn = 1; state.status = 'playing'; state.msg = '';
    state.selectedCard = null; state.attackPlayed = false; state.busy = false; state.catMode = false; state.log = [];
    render();
  }
  function init() {
    freshState(); resetActionDeck();
    state.phase = 'move'; state.turn = 1; state.status = 'playing'; state.msg = '';
    state.selectedCard = null; state.attackPlayed = false; state.busy = false; state.catMode = false; state.log = [];
    log('【第一章·地牢】护送姬昌回到任意玩家起点（卒）即胜利。', 'win');
    log('石友装备：生锈的长枪（枪）、布衣、琥珀串珠（灵猫）。', 'hit');
    log('属性按 §3.1.3 求和：武力2 / 内力1 / 灵力0 / 体力2 → 生命14 / 移动2。', 'hit');
    log('敌方：殷商步兵 HP5/攻3/移2/射程1 + 殷商弓兵 HP3/攻2/移1/射程3，会在卒格复活。', 'bad');
    log('交互阶段可点「召灵猫」派出通灵猫：移动2格，可对相邻敌人造成1伤害。', 'hit');
    bind();
    render();
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();
})();