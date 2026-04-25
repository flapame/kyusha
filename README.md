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

## 头像文件
- `avatars/` 目录保存六张像素头像。若要替换头像，只需把同名 PNG 覆盖掉即可。
