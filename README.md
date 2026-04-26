# 战棋对战

这是一个 9×4 战棋游戏项目。

## 文件说明

- `index.html`：页面结构。
- `style.css`：UI 样式、棋盘皮肤与特效展示。
- `game.js`：游戏逻辑、回合、技能、部署和结算。
- `heroes.js`：英雄数据、技能描述、规则文本与头像/特效路径。
- `avatars/`：英雄头像图片目录。
- `assets/effects/`：普通攻击特效与命中特效图片目录。

## 头像替换

当前六位英雄的头像位已经接好。你以后只需要把图片放进 `avatars/`，并保持文件名一致即可：

- `avatars/sword.png`
- `avatars/sukuna.png`
- `avatars/gojo.png`
- `avatars/archer.png`
- `avatars/mountain.png`
- `avatars/night.png`

## 攻击特效替换

每位英雄都预留了独立的攻击特效与命中特效路径。直接替换同名 PNG 就能改特效，不需要改代码：

- `assets/effects/attack_01.png` ~ `attack_06.png`
- `assets/effects/hit_01.png` ~ `hit_06.png`

在 `heroes.js` 中，每位英雄都通过 `effects.attack` 和 `effects.hit` 指向对应图片。

## 技能图标预留

如果后续你想给技能再补图片，可以在 `heroes.js` 里给技能对象增加 `icon` 字段，例如：

```js
{
  no: 1,
  title: "一式·血刃",
  costText: "2 行动点",
  desc: "...",
  icon: "icons/sword_skill1.png"
}
```

前端已经预留了图标槽位，没有图片时会自动显示占位内容。
