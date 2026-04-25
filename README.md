# 9×4 战棋对战

## 文件说明
- `index.html`：页面结构，只负责把界面和脚本连起来。
- `style.css`：界面样式，只改颜色、布局、按钮、面板样式时改这里。
- `heroes.js`：英雄数据和技能描述；后续新增英雄或改数值，优先改这里。
- `game.js`：游戏逻辑；回合、移动、攻击、技能结算、结算统计都在这里。

## 上传到 GitHub Pages
1. 把这 4 个核心文件放到仓库根目录。
2. 确保文件名都是小写：`index.html`、`style.css`、`heroes.js`、`game.js`。
3. 到仓库 `Settings -> Pages`，选择 `Deploy from branch`。
4. Branch 选 `main`，Folder 选 `/root`。
5. 保存后等待页面生成。

## 注意
- 不要把文件放进二级文件夹。
- 不要把 `test.txt`、`test_write.txt` 这类测试文件一起上传。

头像使用说明：把头像图片放在 avatars/ 文件夹，文件名与 heroes.js 中的 avatar 字段一致即可。


## 像素头像与立绘
- 头像图片放在 `avatars/` 文件夹里。
- `heroes.js` 里的 `avatar` 字段决定每个英雄使用哪张图。
- 如果你以后想替换头像，只需要把对应图片文件覆盖掉，或改 `avatar` 字段指向新的文件名。
- 上传到 GitHub Pages 时，要把 `avatars/` 文件夹和 `index.html` 放在同一层级。
