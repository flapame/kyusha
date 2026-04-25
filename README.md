# 战棋对战

这是一个 9×4 战棋游戏项目。

## 文件说明

- `index.html`：页面结构。
- `style.css`：UI 样式和棋盘皮肤。
- `game.js`：游戏逻辑、回合、技能、部署和结算。
- `heroes.js`：英雄数据、技能描述和规则文本。
- `avatars/`：英雄头像图片目录。

## 头像替换

当前六位英雄的头像位已经接好。你以后只需要把图片放进 `avatars/`，并保持文件名一致即可：

- `avatars/sword.png`
- `avatars/sukuna.png`
- `avatars/gojo.png`
- `avatars/archer.png`
- `avatars/mountain.png`
- `avatars/night.png`

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
