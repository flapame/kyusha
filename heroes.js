/*
  heroes.js
  ==========
  这一份文件只放“英雄数据”和“游戏规则文本”。
  以后你改数值时，优先改这里：
  - 血量、攻击、攻击距离、攻击消耗
  - 被动说明
  - 技能说明
  - 技能条件

  注意：
  1) 这里尽量只放“描述 + 基础数值”，不要写复杂逻辑。
  2) 真正的技能结算逻辑在 game.js。
  3) avatar 字段指向 avatars/ 文件夹里的头像图片。
  4) effects.attack / effects.hit 指向攻击特效与命中特效图片，后期可直接替换文件。
*/

window.GAME_RULES = [
  "棋盘为 9×4；左侧 3×2 为蓝方出生区，右侧 3×2 为红方出生区。",
  "每个玩家从英雄池中选择 3 位英雄；同一位英雄可以被双方同时选择。",
  "双方随机决定先后手；首回合先手获得 2 点行动点，后手通过临时行动点卡补足到 2 点。之后每到自己的回合，行动点自动回复并逐回合上涨，上限 10 点。",
  "每位玩家自己的行动点会在回合开始时自动回复，并按回合逐一上涨 1 点，上限 10 点。",
  "移动消耗 1 点行动点；普通攻击每位英雄每回合最多 2 次，第二次攻击额外消耗 1 点行动点。",
  "英雄死亡后不能再行动；任一方全部英雄阵亡时，游戏结束并进入结算。",
  "被动技能也会在英雄信息面板中显示，方便你查看完整规则。"
];

// 所有英雄的统一定义。
// 你以后新增英雄，通常只需要在这里新增一条对象，然后再在 game.js 里补一个对应的结算函数。
window.HERO_DEFS = {
  sword: {
    id: "sword",
    name: "剑仙",
    teamColor: "blue",
    avatar: "avatars/sword.png",
    portrait: "info_avatars/sword.png",
    effects: {
      attack: "assets/effects/attack_01.png",
      hit: "assets/effects/hit_01.png"
    },
    maxHp: 7,
    atk: 2,
    attackRange: 1,
    attackCost: 1,
    spawnHint: "近战突袭型，擅长强化后爆发。",
    passive: "对目标造成伤害后，会恢复造成伤害量一半（向上取整）的生命值。",
    skills: [
      {
        no: 1,
        title: "剑心回响",
        costText: "被动",
        desc: "对目标造成伤害后，会恢复造成伤害量一半（向上取整）的生命值。",
        icon: "assets/skills/sword_skill1.png",
        phase1Only: true
      },
      {
        no: 2,
        title: "二式·突刺",
        costText: "5 行动点",
        desc: "对 2 格内敌方英雄使用。冲到目标身后 1 格，造成 4 点伤害；若穿过目标后，自身周围 1 格内存在其他敌方英雄，则对范围内所有其他敌方英雄造成 2 点伤害。",
        icon: "assets/skills/sword_skill2.png",
        phase1Only: true
      },
      {
        no: 3,
        title: "终式·万剑归宗",
        costText: "10 行动点",
        desc: "开启仙剑领域，领域范围为自身周围 1 格，持续 2 回合。开启时自身血量降至 1。领域每回合对领域内敌方英雄造成 1 点伤害，并在伤害处留下“剑”标记；若该格已存在标记，则标记数量 +1。自身受到致命伤时，可消耗 1 个“剑”标记抵挡此次伤害。",
        icon: "assets/skills/sword_skill3.png",
        phase1Only: true
      }
    ]
  },

  sukuna: {
    id: "sukuna",
    name: "两面宿傩",
    teamColor: "red",
    avatar: "avatars/sukuna.png",
    portrait: "info_avatars/sukuna.png",
    phase2Avatar: "avatars/sukuna_phase2.png",
    effects: {
      attack: "assets/effects/attack_02.png",
      hit: "assets/effects/hit_02.png"
    },
    maxHp: 20,
    atk: 1,
    attackRange: 1,
    attackCost: 1,
    spawnHint: "行动消耗血量，擅长标记、群体爆发与二阶段变身。",
    passive: "每回合开始时固定受到 1 点真实伤害；受到伤害或对敌方造成伤害时会留下标记。血量降至 0 后不会立即死亡，进入二阶段“神武解”，回复至 10 生命、攻击力提升到 2，并解锁领域技能。",
    skills: [
      {
        no: 1,
        title: "标记被动",
        costText: "被动",
        desc: "每当你受到伤害，或攻击敌方造成伤害时，会在对应位置留下一个标记。",
        icon: "assets/skills/sukuna_skill1.png",
        phase1Only: true
      },
      {
        no: 2,
        title: "伏魔·解",
        costText: "无直接行动点消耗",
        desc: "当标记数量 ≥ 5 时可释放。对标记连线范围内所有角色造成 4 点伤害，不分敌我（包括自身）。",
        icon: "assets/skills/sukuna_skill2.png",
        phase1Only: true
      },
      {
        no: 3,
        title: "二阶段·神武解",
        costText: "被动",
        desc: "当生命值降至 0 时，进入二阶段：生命回复到 10，攻击力提升到 2。",
        icon: "assets/skills/sukuna_skill3.png"
      },
      {
        no: 4,
        title: "原身之恶",
        costText: "被动",
        desc: "当宿傩处于二阶段并造成伤害时，对目标施加 2 回合禁锢效果。",
        icon: "assets/skills/sukuna_skill4.png",
        phase2Only: true
      },
      {
        no: 5,
        title: "伏魔御厨子",
        costText: "8 行动点",
        desc: "以自身为中心，3 格范围内形成领域。领域不限制移动；在两回合后开始时，对领域内所有其他角色造成 9 点伤害。",
        icon: "assets/skills/sukuna_skill5.png",
        phase2Only: true
      }
    ]
  },

  gojo: {
    id: "gojo",
    name: "五条悟",
    teamColor: "blue",
    avatar: "avatars/gojo.png",
    portrait: "info_avatars/gojo.png",
    phase2Avatar: "avatars/gojo_phase2.png",
    effects: {
      attack: "assets/effects/attack_03.png",
      hit: "assets/effects/hit_03.png"
    },
    maxHp: 11,
    atk: 3,
    attackRange: 1,
    attackCost: 2,
    spawnHint: "高爆发中距离角色，擅长无下限防御、苍/赫与领域控制。",
    passive: "若上回合仍有未使用的行动点，则会将这些行动点转化为『无下限防御』。当本回合受到伤害时，先消耗该防御值抵挡伤害；若防御值不足，则剩余伤害扣血。第一次释放领域后会进入二阶段，并解锁虚式•茈。",
    skills: [
      {
        no: 1,
        title: "无下限防御",
        costText: "被动",
        desc: "若上回合有未使用的行动点，则本回合开始时获得等量防御值；受到伤害时先由防御值抵挡。",
        icon: "assets/skills/gojo_skill1.png"
      },
      {
        no: 2,
        title: "苍",
        costText: "3 行动点",
        desc: "对自身周围 1 格内的敌方英雄造成 2 点伤害；也可对周围 1 格内空格释放并留下苍标记。同一时间只会存在一个苍标记。",
        icon: "assets/skills/gojo_skill2.png"
      },
      {
        no: 3,
        title: "赫",
        costText: "3 行动点",
        desc: "对自身周围 3 格内的敌方英雄造成 2 点伤害，并在目标格留下赫标记。同一时间只会存在一个赫标记。",
        icon: "assets/skills/gojo_skill3.png"
      },
      {
        no: 4,
        title: "领域·无量空处",
        costText: "10 行动点",
        desc: "以自身为中心，2 格范围内形成领域。领域持续 2 回合；在两回合后开始时，对领域内除自身外所有角色造成 2 点伤害并冻结 2 回合。第一次释放后进入二阶段。",
        icon: "assets/skills/gojo_skill4.png"
      },
      {
        no: 5,
        title: "虚式•茈",
        costText: "10 行动点",
        desc: "若场上同时存在苍标记与赫标记，则会在两标记连线中点处形成圆形范围，对范围内所有英雄（包括自身）造成 10 点伤害；结算后苍与赫标记消失。",
        icon: "assets/skills/gojo_skill5.png",
        phase2Only: true
      }
    ]
  },

  archer: {
    id: "archer",
    name: "寂声射手",
    teamColor: "blue",
    avatar: "avatars/archer.png",
    portrait: "info_avatars/archer.png",
    effects: {
      attack: "assets/effects/attack_04.png",
      hit: "assets/effects/hit_04.png"
    },
    maxHp: 8,
    atk: 1,
    attackRange: 3,
    attackCost: 2,
    spawnHint: "远程压制与偷点专家，适合打节奏。",
    passive: "攻击敌方角色时，会偷取敌方玩家下回合 1 点行动点。",
    skills: [
      {
        no: 1,
        title: "连射",
        costText: "2 行动点",
        desc: "对 3 格范围内敌方造成 1 点伤害。",
        icon: "assets/skills/archer_skill1.png"
      },
      {
        no: 2,
        title: "轻步潜行",
        costText: "6 行动点",
        desc: "接下来的 2 回合内，移动消耗变为 0；但每回合最多移动 2 次，且每次移动不能超过 2 格。",
        icon: "assets/skills/archer_skill2.png"
      },
      {
        no: 3,
        title: "缠绕箭",
        costText: "6 行动点",
        desc: "对 1 格范围内敌方造成 3 点伤害并施加缠绕 2 回合。缠绕期间目标只能移动或普通攻击，不能释放技能。",
        icon: "assets/skills/archer_skill3.png"
      }
    ]
  },

  mountain: {
    id: "mountain",
    name: "山脉之神",
    teamColor: "red",
    avatar: "avatars/mountain.png",
    portrait: "info_avatars/mountain.png",
    effects: {
      attack: "assets/effects/attack_05.png",
      hit: "assets/effects/hit_05.png"
    },
    maxHp: 15,
    atk: 2,
    attackRange: 1,
    attackCost: 2,
    spawnHint: "偏防守与地形控制，能封路也能减伤。",
    passive: "对目标造成伤害后，会恢复造成伤害量一半（向上取整）的生命值。",
    skills: [
      {
        no: 1,
        title: "封路",
        costText: "4 行动点",
        desc: "指定方向直线 3 格内生成封路地形。其他角色无法到达、无法穿过；若释放时路径中已有角色，敌方受 2 点伤害，我方回复 2 点生命，然后封路立即消失。",
        icon: "assets/skills/mountain_skill1.png"
      },
      {
        no: 2,
        title: "山体庇护",
        costText: "8 行动点",
        desc: "以自身为中心，1 格范围内展开领域。下回合开始前，领域内所有我方英雄（包含自身）受到的伤害减少 1。",
        icon: "assets/skills/mountain_skill2.png"
      }
    ]
  },

  night: {
    id: "night",
    name: "烈焰之夜神",
    teamColor: "red",
    avatar: "avatars/night.png",
    portrait: "info_avatars/night.png",
    effects: {
      attack: "assets/effects/attack_06.png",
      hit: "assets/effects/hit_06.png"
    },
    maxHp: 9,
    atk: 1,
    attackRange: 2,
    attackCost: 1,
    spawnHint: "灼烧型法师，擅长持续伤害与范围引爆。",
    passive: "无额外被动。",
    skills: [
      {
        no: 1,
        title: "烈焰灼击",
        costText: "2 行动点",
        desc: "对 2 格范围内敌方造成 2 点伤害并附加灼烧 3 回合（每回合开始时受到 1 点伤害）。",
        icon: "assets/skills/night_skill1.png"
      },
      {
        no: 2,
        title: "焰爆",
        costText: "6 行动点",
        desc: "若场上存在至少 2 名被灼烧的英雄，则对所有被灼烧英雄造成 2 点伤害。",
        icon: "assets/skills/night_skill2.png"
      },
      {
        no: 3,
        title: "领域·赤夜领域",
        costText: "9 行动点",
        desc: "以自身为中心，2 格范围内展开领域。两回合后开始时，对领域内所有敌方英雄造成 3 点伤害并附加灼烧 3 回合。",
        icon: "assets/skills/night_skill3.png"
      }
    ]
  }
};
