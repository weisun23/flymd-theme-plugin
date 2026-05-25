# flymd-theme-plugin

[flyMD](https://github.com/flyhunterl/flymd) 的第三方主题管理插件。支持从 URL、GitHub 仓库、本地文件导入自定义主题，一键切换外观。

## 特性

- 三种安装来源：URL（.css / theme.json）、GitHub（`user/repo[@branch]`）、本地文件或目录
- 顶栏「主题」菜单：列出已安装主题，点击即切换，当前主题打 ✓
- 设置面板：下拉切换 + 卡片列表（应用 / 删除 / 打开目录）+ 安装入口
- 主题持久化到本地数据目录，独立于 flyMD 主程序
- 启动时自动恢复上次应用的主题
- 支持主题包内的本地资源（图片、字体、图标），安装时自动拷贝

## 安装

在 flyMD 的「扩展」面板中，输入以下任一方式安装本插件：

- GitHub 仓库：`flyhunterl/flymd-theme-plugin`
- URL：`https://raw.githubusercontent.com/flyhunterl/flymd-theme-plugin/main/manifest.json`

## 使用

安装后侧栏会出现「主题」菜单：

- **来自 URL** — 输入 `.css` 或 `theme.json` 的链接
- **来自 GitHub** — 输入 `user/repo` 或 `user/repo@branch`
- **来自本地目录/文件** — 选择本地 `.css`、`theme.json` 或主题目录

切换主题后立即生效，无需重启。

## 写自己的主题

主题本质上是一段全局 CSS，注入到 flyMD 的 `<style>` 标签中覆盖内置样式。支持两种格式：

### 单文件主题

一个 `.css` 文件，顶部用注释声明元数据（全部可选）：

```css
/* @id my-theme */
/* @name 我的主题 */
/* @author your-name */
/* @version 1.0.0 */
/* @description 一句话描述 */

.container {
  --bg: #1a1033;
  --fg: #e9d5ff;
}
```

### 主题包

目录内含 `theme.json` + CSS 文件 + 可选资源：

```
my-theme/
├─ theme.json
├─ style.css
└─ images/       ← 可选
```

详细的 CSS 变量清单、选择器参考、调试技巧和发布流程，请参阅 [主题开发指南](docs/theming-guide.md)。

## 主题存储位置

```
Windows: %LOCALAPPDATA%\com.flymd\flymd\themes\<theme-id>\
```

可在「主题」菜单中选「打开主题目录」直接定位。

## 示例

`examples/` 目录提供了可直接安装试用的示例主题：

- `examples/peach-oolong/` — 主题包示范（含 `theme.json` + `style.css`）

在 flyMD 中选「主题 → 来自本地目录/文件...」，选择示例目录即可安装。

## 安全提示

主题就是 CSS，CSS 可以通过 `url()`、`@import` 拉取远端资源。请只安装来自可信来源的主题。

## License

MIT
