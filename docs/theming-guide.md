# flyMD 主题开发指南

本文档面向**主题作者**。如果你只想安装别人写好的主题，看 [README](../README.md) 即可。

主题在 flyMD 里就是一段 **全局 CSS**。本插件（theme-manager）把这段 CSS 注入到 `document.head` 的一个 `<style id="flymd-theme-plugin-injected">` 标签里，优先级高于 flyMD 的内置样式。**你写的规则可以覆盖任何视觉**——内容区、代码块、顶栏、侧栏、状态栏、对话框，全都行。

> 本插件**不调用** flyMD 的 `flymdTheme.registerTypography / registerMdStyle` API（那两个 API 的 ID 是固定枚举），而是走全局 CSS 注入路径，因此你完全自由。

---

## 0. 稳定性分级（重要）

flyMD 的可改样式分两层，作用力一样大但**升级风险不同**：

| 等级 | 范围 | 风险 |
|------|------|------|
| **稳定 API** | plugin.md 明确暴露的 CSS 变量和选择器 | flyMD 承诺保持，主题不会因升级 break |
| **扩展（实测）** | 从 flyMD 主程序源码扫出来的内部 class 和变量 | 没有稳定承诺，flyMD 大版本可能改名 |

下文每节会标 **🟢 稳定 API** 或 **🟡 扩展**。

**建议：**优先用 🟢 稳定 API 写核心样式；🟡 扩展只用来做点缀（比如改一下 ribbon 颜色、tab 圆角），并在主题描述里写清"基于 flyMD vX.Y.Z 测试"。

---

## 1. 主题包结构

支持两种格式，开发时随意选。

### 1.1 单文件主题

一个 `.css` 文件就够了。文件顶部用 CSS 注释声明元数据（**全部可选**）：

```css
/* @id midnight-amethyst */
/* @name 暗夜紫晶 */
/* @author your-name */
/* @version 1.0.0 */
/* @description 紫色暗黑主题 */

.container {
  --bg: #1a1033;
  --fg: #e9d5ff;
}
```

元数据规则：

| 字段 | 用途 | 缺省时怎么处理 |
|------|------|---------------|
| `@id` | 主题唯一标识，决定磁盘目录名 | 从 `@name` 或文件名 slugify 得到 |
| `@name` | 显示名 | 使用 `@id` |
| `@version` | 版本号 | `0.0.1` |
| `@author` | 作者 | 空 |
| `@description` | 一句话描述 | 空 |

只解析文件**头部 4 KB** 内的 `/* @key value */` 注释。

### 1.2 主题包（含 `theme.json`）

```
my-theme/
├─ theme.json       ← 元数据（必需）
├─ style.css        ← 实际样式（main 字段指向）
├─ images/          ← 可选：背景图、图标等（安装时自动递归拷贝）
├─ icons/           ← 可选：SVG 图标
└─ fonts/           ← 可选：自定义字体文件
```

`theme.json`：

```json
{
  "id": "midnight-amethyst",
  "name": "暗夜紫晶",
  "version": "1.0.0",
  "author": "your-name",
  "description": "紫色暗黑主题",
  "main": "style.css"
}
```

### 1.3 怎么选

- 想分发给别人通过 GitHub 安装 → **主题包**
- 只在本地用、就一个 CSS 文件 → **单文件**

两种格式安装到磁盘后会**统一规范化**为主题包结构。

---

## 2. flyMD 的 CSS 架构

### 2.1 三种内容模式（🟢 稳定 API）

| 模式 | 作用域选择器 | 背景变量 | 内容容器 |
|------|------------|---------|---------|
| 源码（编辑） | `.container` | `--bg` | CodeMirror 编辑器 |
| 阅读 | `.container .preview` | `--preview-bg` | `.preview-body` |
| 所见即所得 | `.container.wysiwyg-v2` | `--wysiwyg-bg` | `.ProseMirror`（Milkdown） |

### 2.2 Typography（排版）class（🟢 稳定 API）

挂在 `.container` 上的 class，控制字体/字号/行距：

`typo-default | typo-serif | typo-modern | typo-reading | typo-academic`

```css
/* 仅 typo-reading 排版下加大行距 */
.container.typo-reading .preview-body,
.container.typo-reading.wysiwyg-v2 .ProseMirror {
  line-height: 2.0;
  font-size: 18px;
}
```

### 2.3 MdStyle（Markdown 风格）class

挂在 `.container` 上的 class，决定 Markdown 元素的视觉风格：

| 等级 | ID |
|------|-----|
| 🟢 稳定 API | `md-standard / md-github / md-notion / md-journal / md-card / md-docs` |
| 🟡 扩展 | `md-typora / md-obsidian / md-bear`（在 v1.3.x 实测存在，但 plugin.md 未列出） |

```css
/* 给 md-docs 风格定制代码配色 */
.container.md-docs {
  --c-key: #1f4eff;
  --c-str: #0ea5e9;
}
```

### 2.4 暗/浅色模式（🟢 稳定 API）

flyMD 通过两条路径切换暗/浅色：

1. 系统偏好：`@media (prefers-color-scheme: dark)`
2. 手动强制：`body.light-mode` / `body.dark-mode`

主题写暗色适配建议同时考虑两条：

```css
/* 系统暗色 */
@media (prefers-color-scheme: dark) {
  .container { --bg: #1a1033; }
}

/* 手动强制暗色（覆盖系统浅色偏好） */
body.dark-mode .container { --bg: #1a1033; }

/* 手动强制浅色（覆盖系统暗色偏好） */
body.light-mode .container { --bg: #fdf6ec; }
```

---

## 3. CSS 变量完整清单

flyMD 的 CSS 变量都定义在 `:root`，主题里**用 `.container { --xxx: ... }` 覆盖**即可（不要用 `:root` 覆盖，作用域过大可能影响应用 chrome）。

### 3.1 内容区颜色（🟢 稳定 API）

| 变量 | 含义 |
|------|------|
| `--bg` | 编辑模式背景 |
| `--fg` | 主前景文字色 |
| `--preview-bg` | 阅读模式背景 |
| `--wysiwyg-bg` | 所见模式背景 |
| `--muted` | 次要文字色 |

### 3.2 代码块（🟢 稳定 API）

| 变量 | 含义 |
|------|------|
| `--code-bg` | 代码块背景 |
| `--code-border` | 代码块边框 |
| `--code-fg` | 代码块默认前景 |
| `--code-muted` | 代码块次要色（行号/注释装饰） |
| `--c-key` | 关键字（keyword） |
| `--c-str` | 字符串（string） |
| `--c-num` | 数字（number） |
| `--c-fn` | 函数名（function） |
| `--c-com` | 注释（comment） |
| `--code-pre-pad-y` | 代码块上下基础内边距 |
| `--code-lang-gap` | 语言角标让位高度（定义在 `.codebox`，不要直接覆盖） |

> ⚠️ 不要直接覆盖 `.codebox pre` 的 `padding-top`。代码块右上角有"语言角标"（如 `js`、`python`），需要 `padding-top = --code-pre-pad-y + --code-lang-gap` 给它让位。直接覆盖会导致角标和首行重叠。

### 3.3 表格（🟡 扩展）

| 变量 | 含义 |
|------|------|
| `--table-border` | 表格边框 |
| `--table-header-bg` | 表头背景 |
| `--table-header-fg` | 表头文字 |
| `--table-row-hover` | 行 hover 背景 |

### 3.4 强调色与交互状态（🟡 扩展）

| 变量 | 含义 | 默认（亮/暗） |
|------|------|------|
| `--accent` | 主强调色（链接、按钮高亮） | `#2563eb` / `#60a5fa` |
| `--accent-hover` | 强调色 hover | `#1d4ed8` / `#3b82f6` |
| `--accent-light` | 强调色弱化背景 | rgba(37,99,235,0.1) |
| `--accent-dark` | 暗模式强调色 | `#60a5fa` |
| `--hover-bg` | 通用 hover 背景 | rgba(127,127,127,0.08) |
| `--active-bg` | 通用 active 背景 | rgba(127,127,127,0.12) |
| `--hover-bg-light` | 暗模式 hover 背景 | rgba(255,255,255,0.08) |

### 3.5 边框与面板（🟡 扩展）

| 变量 | 含义 |
|------|------|
| `--border` | 普通边框 |
| `--border-strong` | 强调边框（所见模式、对话框） |
| `--panel-bg` | 面板/对话框背景 |

### 3.6 设计系统：圆角/间距/阴影/动画（🟡 扩展）

| 变量 | 默认值 |
|------|--------|
| `--radius-sm` | 4px |
| `--radius-md` | 6px |
| `--radius-lg` | 8px |
| `--radius-xl` | 12px |
| `--space-xs` | 4px |
| `--space-sm` | 6px |
| `--space-md` | 8px |
| `--space-lg` | 12px |
| `--space-xl` | 16px |
| `--shadow-sm` | 浅阴影 |
| `--shadow-md` | 中阴影 |
| `--shadow-lg` | 重阴影 |
| `--transition-fast` | 0.15s ease |
| `--transition-normal` | 0.2s ease |

### 3.7 便签（🟡 扩展）

| 变量 | 含义 |
|------|------|
| `--sticky-rgb` | 便签底色（RGB 三元组，如 `255, 230, 200`） |
| `--sticky-fg` | 便签前景文字（覆盖时使用） |

### 3.8 编辑器内边距（🟡 扩展）

| 变量 | 含义 |
|------|------|
| `--editor-pad-x` | 编辑器左右内边距 |
| `--editor-pad-top` | 编辑器顶部内边距 |
| `--editor-pad-bottom` | 编辑器底部内边距 |
| `--editor-line-gutter-width` | 行号栏宽度 |
| `--scroll-past-end` | 末尾留白（约 3.5 行） |

### 3.9 所见模式状态条（🟡 扩展）

| 变量 | 含义 |
|------|------|
| `--wysiwyg-status-h` | 状态条高度（默认 24px） |
| `--wysiwyg-status-bg` | 状态条背景 |

### 3.10 布局（🟡 扩展，主题作者一般不需要碰）

库面板、大纲、停靠面板的尺寸变量，由 flyMD 内部和插件 dock API 维护。**主题里不要覆盖**这些，否则可能破坏布局：

`--library-width / --gap-left-library / --gap-right-library / --gap-left-outline / --gap-right-outline / --outline-left-offset / --outline-right-offset / --workspace-left-gap / --workspace-right-gap / --workspace-bottom-gap / --dock-left-gap / --dock-right-gap / --dock-bottom-gap / --ai-left / --ai-right`

---

## 4. 内容区选择器（🟢 稳定 API）

```css
/* 标题（阅读 + 所见双覆盖） */
.container .preview h1,
.container.wysiwyg-v2 .ProseMirror h1 { /* ... */ }

.container .preview h2, .container .preview h3,
.container.wysiwyg-v2 .ProseMirror h2,
.container.wysiwyg-v2 .ProseMirror h3 { /* ... */ }

/* 链接 */
.container .preview a,
.container.wysiwyg-v2 .ProseMirror a { /* ... */ }

/* 引用块 */
.container .preview blockquote,
.container.wysiwyg-v2 .ProseMirror blockquote { /* ... */ }

/* 行内代码 */
.container .preview code,
.container.wysiwyg-v2 .ProseMirror code { /* ... */ }

/* 代码块 */
.container .codebox { /* ... */ }
.container .codebox pre { /* 注意 padding-top */ }

/* 表格 */
.container .preview table,
.container.wysiwyg-v2 .ProseMirror table { /* ... */ }
.container .preview table th,
.container.wysiwyg-v2 .ProseMirror table th { /* ... */ }

/* 列表 */
.container .preview ul, .container .preview ol,
.container.wysiwyg-v2 .ProseMirror ul,
.container.wysiwyg-v2 .ProseMirror ol { /* ... */ }

/* 水平分割线 */
.container .preview hr,
.container.wysiwyg-v2 .ProseMirror hr { /* ... */ }

/* 阅读模式正文容器 */
.preview-body { /* ... */ }

/* 文档元信息条（preview 顶部 frontmatter 显示） */
.preview-meta-header / .preview-meta-title / .preview-meta-chip { /* ... */ }
```

---

## 5. 应用 chrome 选择器（🟡 扩展）

下面这些是 flyMD v1.3.x 主程序源码里实际存在的 class。**没有稳定承诺**——升级可能改名——但实测可改，可以用来定制整个应用的视觉风格。

> ⚠️ **写 chrome 样式必读：优先级问题**
>
> flyMD 内置样式（`src/style.css`）对 chrome 元素经常用 `.titlebar { background: #xxx }` 这种**直接 class 选择器**，优先级和你写的完全相同。由于内置样式后加载，你的规则常被覆盖。**写 chrome 时务必做以下两件事**：
>
> 1. **提升 specificity**：用 `body .titlebar`、`html body .ribbon` 这种带祖先选择器的写法
> 2. **关键属性加 `!important`**：尤其 `background-color`、`background-image`、`color`
>
> ```css
> /* ❌ 经常被覆盖 */
> .titlebar { background: #3E2723; }
>
> /* ✅ 推荐写法 */
> body .titlebar,
> body .custom-titlebar {
>   background-color: #3E2723 !important;
>   background-image: url(./images/wood.png) !important;
>   background-size: cover !important;
> }
> ```
>
> 另外，**不要用 `background` 简写后再写 `background-image`**——简写会清掉前面写的 image。要么完全用 `background` 一行写完，要么拆成 `background-color` + `background-image` 两行。

### 5.1 顶部 / 标题栏 / 标签页

```css
.titlebar           /* 顶部标题栏（含菜单按钮和窗口控制） */
.custom-titlebar    /* Windows 自定义标题栏 */
.menubar            /* 主菜单栏 */
.tabbar             /* 标签栏整体 */
.tabbar-row         /* 标签栏一行 */
.tabbar-tab         /* 单个 tab */
.tabbar-tab-close   /* tab 关闭按钮 */
.tabbar-tab-dirty   /* 未保存的 tab 标记（小圆点） */
.tabbar-tab-icon
.tabbar-tab-name
.tabbar-new-btn     /* 新建 tab 按钮 */
.window-controls    /* 最小化/最大化/关闭 */
.window-btn
```

> 注：「顶部」实际是 `.titlebar` + `.menubar` + `.tabbar` 三层叠在一起。如果只给 `.titlebar` 加纹理背景，下面两层是纯色，**视觉上看起来整片还是纯色**——三层都要给同一组背景才完整。

### 5.2 左侧 Ribbon（图标栏）

```css
.ribbon             /* 40px 宽的左侧垂直图标栏 */
.ribbon-top
.ribbon-bottom
.ribbon-btn         /* ribbon 上的按钮 */
.ribbon-libs
.ribbon-lib-btn     /* 库切换按钮 */
.ribbon-divider
```

### 5.3 文件库（Library）侧边栏

```css
.library            /* 左侧文件树容器 */
.lib-resize-handle  /* 拖动改变宽度的把手 */
.lib-float-toggle   /* 浮动模式切换 */
.lib-ico            /* 文件图标 */
.lib-ico-folder
.lib-ico-file
.lib-ico-pdf
.lib-ico-svg
.lib-outline        /* 大纲面板 */
```

### 5.4 编辑器外壳

```css
.editor             /* 编辑器主容器 */
.editor-shell
.editor-surface
.editor-gutter      /* 行号栏 */
.editor-line-number
.editor-line-numbers
```

### 5.5 状态栏 / 缩放气泡

```css
.statusbar          /* 底部状态栏 */
.status-zoom        /* 状态栏的缩放显示 */
.zoom-bubble        /* 缩放气泡提示 */
.width-bubble       /* 宽度气泡提示 */
.sync-status        /* 同步状态 */
```

### 5.6 对话框 / 浮层

```css
/* 命令面板 (Ctrl+P / Ctrl+K) */
.command-palette-overlay / .command-palette-dialog / .command-palette-input
.command-palette-list / .command-palette-item / .command-palette-detail

/* 快速搜索 */
.quick-search-overlay / .quick-search-dialog / .quick-search-input
.quick-search-results / .quick-search-item / .quick-search-snippet

/* 关于对话框 */
.about-overlay / .about-dialog / .about-header / .about-body

/* 扩展市场 */
.ext-overlay / .ext-dialog / .ext-list / .ext-item / .ext-tag

/* 链接编辑对话框 */
.link-overlay / .link-dialog / .link-field

/* 上传对话框 */
.upl-overlay / .upl-dialog / .upl-field

/* 同步日志 */
.sync-log-dialog / .sync-log-line / .sync-log-tag-ok / .sync-log-tag-error
```

### 5.7 菜单 / 通知

```css
/* 顶部下拉菜单（addMenuItem 注册的） */
.plugin-menu-item / .plugin-menu-divider / .plugin-menu-group-title
.plugin-menu-submenu / .plugin-menu-arrow

/* 右键上下文菜单 */
.flymd-context-menu / .context-menu-item / .context-menu-icon
.context-menu-label / .context-menu-divider / .context-menu-group

/* 通知 */
.notification-container
.notification-item
```

### 5.8 便签模式

```css
.sticky-color-picker-container
.sticky-color-swatch
.sticky-note-controls
.sticky-opacity-slider
```

### 5.9 Mermaid 图表

```css
.mmd-figure
.mmd-tools
```

### 5.10 主题面板（讽刺：你正在写主题，但这是 flyMD 自带主题面板的 class）

```css
.theme-panel / .theme-panel-content / .theme-section
.theme-swatch / .theme-swatches
.theme-typos / .theme-md / .theme-fonts
.theme-toggle-switch / .theme-slider-row
```

---

## 6. 代码块深度定制（🟡 扩展）

简单主题用 §3.2 的代码块变量（`--c-key / --c-str / ...`）就够了——它们会同时影响阅读模式和所见模式。但如果你想做**精细的代码高亮**（区分 `function name` 和 `type name` 颜色，或者给注释加斜体），就要直接覆盖 highlight.js 的 token class。

### 6.1 阅读模式的代码块结构

```
.codebox                    ← 代码块外层容器（包含语言角标、复制按钮、行号）
  ├─ .code-lang             ← 右上角语言角标（如 "js"、"python"）
  ├─ .code-copy             ← 复制按钮
  ├─ .code-lnums            ← 行号容器
  │   └─ .ln                ← 单个行号
  └─ pre                    ← 代码内容
      └─ code.hljs          ← highlight.js 着色的代码
          ├─ .hljs-keyword
          ├─ .hljs-string
          └─ ...其他 token
```

### 6.2 所见模式的代码块结构（Milkdown）

所见模式下代码块结构更复杂——Milkdown 用"双层"渲染：透明的可编辑层叠在彩色高亮层之上。

```
.ProseMirror
  └─ pre.code-block-wrapper          ← Milkdown 代码块包装器
      ├─ .code-layers                ← 双层容器
      │   ├─ .highlight-layer        ← 渲染彩色高亮（含 .hljs-* token）
      │   └─ .editable-layer         ← 透明可编辑文字层
      ├─ .code-lang-selector         ← 顶部语言选择器
      ├─ .code-lang-input            ← 选择器的输入框
      └─ .code-lang-dropdown         ← 选择器下拉
          └─ .code-lang-item         ← 下拉中的语言条目
```

### 6.3 highlight.js token class 完整清单

flyMD 用的 highlight.js token（实际在源码中出现的）：

| Token class | 含义 |
|------------|------|
| `.hljs` | 代码块根（默认前景/背景） |
| `.hljs-keyword` | 关键字（`if`、`return`、`class`...） |
| `.hljs-string` | 字符串字面量 |
| `.hljs-number` | 数字字面量 |
| `.hljs-literal` | 字面量（`null`、`true`、`false`） |
| `.hljs-comment` | 注释 |
| `.hljs-quote` | 块引用风格注释 |
| `.hljs-function` | 函数声明 |
| `.hljs-title` | 标题/函数名 |
| `.hljs-title.function_` | 函数名（更具体） |
| `.hljs-params` | 函数参数 |
| `.hljs-variable` | 变量名 |
| `.hljs-built_in` | 内置标识符（`console`、`window`） |
| `.hljs-type` | 类型注解 |
| `.hljs-class` | 类声明 |
| `.hljs-attr` | 属性名（HTML 属性、JSON key） |
| `.hljs-property` | 对象属性 |
| `.hljs-operator` | 操作符 |
| `.hljs-punctuation` | 标点符号 |
| `.hljs-section` | 章节标题（HTML 标签、Markdown 标题） |
| `.hljs-selector-tag` | CSS 选择器标签 |
| `.hljs-template-variable` | 模板字符串变量 |
| `.hljs-bullet` | 列表标记 |

### 6.4 精细定制示例

```css
/* 优先用变量（同时影响阅读 + 所见，简单） */
.container {
  --c-key: #c4b5fd;
  --c-str: #67e8f9;
  --c-com: #6b7280;
}

/* 如果要更精细，直接覆盖 hljs token —— 注意要写两套选择器 */

/* 阅读模式 */
.container .preview code.hljs .hljs-built_in {
  color: #f0abfc;
  font-weight: 600;
}
.container .preview code.hljs .hljs-comment {
  font-style: italic;
  color: #9ca3af;
}

/* 所见模式（在 .highlight-layer 下） */
.container.wysiwyg-v2 .ProseMirror pre .highlight-layer .hljs-built_in {
  color: #f0abfc;
  font-weight: 600;
}
.container.wysiwyg-v2 .ProseMirror pre .highlight-layer .hljs-comment {
  font-style: italic;
  color: #9ca3af;
}
```

> 💡 觉得每条规则要写两套很烦？因为阅读模式（`.preview code.hljs`）和所见模式（`.ProseMirror pre .highlight-layer`）的 DOM 结构不一样。但 99% 情况你只需要改 `--c-*` 变量，根本不用碰 hljs class。

---

## 7. 所见模式深度定制：Milkdown / ProseMirror（🟡 扩展）

所见模式（WYSIWYG）是 [Milkdown](https://milkdown.dev/) 编辑器的实例（用了 Crepe 风格）。flyMD 把它挂载在 `#md-wysiwyg-root` 元素下，编辑区是 `.ProseMirror`。

### 7.1 标准元素

跟阅读模式对称，所见模式下 Milkdown 把 Markdown 渲染成对应的 HTML 标签：

```css
.container.wysiwyg-v2 .ProseMirror h1, .ProseMirror h2 /* 标题 */
.container.wysiwyg-v2 .ProseMirror p                   /* 段落 */
.container.wysiwyg-v2 .ProseMirror blockquote          /* 引用 */
.container.wysiwyg-v2 .ProseMirror :not(pre) > code    /* 行内代码（避开代码块） */
.container.wysiwyg-v2 .ProseMirror a                   /* 链接 */
.container.wysiwyg-v2 .ProseMirror img                 /* 图片 */
.container.wysiwyg-v2 .ProseMirror ul, .ProseMirror ol /* 列表 */
.container.wysiwyg-v2 .ProseMirror li                  /* 列表项 */
.container.wysiwyg-v2 .ProseMirror hr                  /* 分割线 */
.container.wysiwyg-v2 .ProseMirror table               /* 表格 */
.container.wysiwyg-v2 .ProseMirror table th, td        /* 表头/单元格 */
```

### 7.2 任务列表（GFM Task List）

```css
li.task-list-item                /* 任务项 li */
.task-list-item-checkbox         /* 复选框 input */
.task-content                    /* 任务文字内容 */
.task-datetime                   /* 任务关联的时间（@2026-05-25 这种语法） */
.task-time-icon                  /* 时间小图标 */
.task-tooltip                    /* hover 提示 */
```

### 7.3 Milkdown 内部 UI

```css
#md-wysiwyg-root                /* 所见模式根 */
.milkdown                       /* Milkdown 编辑器根 */
.milkdown-menu                  /* 顶部工具栏 */
.block-menu                     /* 块菜单（slash 命令、行首气泡） */
```

### 7.4 所见模式的叠加层（overlay）

所见模式不直接渲染图表/公式，而是用 overlay 在 ProseMirror 之上叠一层渲染结果：

```css
#md-wysiwyg-root .overlay-host                  /* overlay 容器 */
#md-wysiwyg-root .overlay-host .ov-katex        /* KaTeX 公式叠加 */
#md-wysiwyg-root .overlay-host .ov-mermaid      /* Mermaid 图表叠加 */
#md-wysiwyg-root .overlay-host .ov-codecopy     /* 代码块复制按钮叠加 */
```

### 7.5 KaTeX 公式

阅读模式直接渲染，所见模式通过 overlay 渲染。两种模式下 KaTeX 自己的 class 是一致的：

```css
.katex                          /* 行内公式 */
.katex-display                  /* 块级（独占行）公式 */
```

KaTeX 内部有 100+ 子 class（`.katex .mord`、`.katex .mfrac` 等），主题一般不需要细调；改 `color` 和 `font-size` 在外层就够了。

### 7.6 Mermaid 图表

```css
.mmd-figure                     /* mermaid 图表容器 */
.mmd-tools                      /* 图表上的工具按钮（缩放、导出） */
.mmd-preview                    /* 图表预览容器 */
.mermaid-chart-display          /* 所见模式下的图表渲染区 */
```

### 7.7 脚注

```css
.md-footnote-tooltip            /* 脚注 hover 提示 */
```

### 7.8 完整示例：所见模式细节定制

```css
/* 任务列表复选框换风格 */
.container.wysiwyg-v2 .ProseMirror .task-list-item-checkbox {
  accent-color: #10b981;
  transform: scale(1.1);
}
.container.wysiwyg-v2 .ProseMirror li.task-list-item .task-content {
  margin-left: 6px;
}

/* 行内代码（避开代码块） */
.container.wysiwyg-v2 .ProseMirror :not(pre) > code {
  background: rgba(196, 181, 253, 0.15);
  color: #c4b5fd;
  padding: 2px 6px;
  border-radius: 4px;
}

/* 代码块语言选择器（所见模式右上角） */
.container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper .code-lang-input {
  color: var(--muted);
  font-size: 11px;
}

/* 公式留白 */
.container.wysiwyg .preview .katex-display {
  margin: 12px 0;
}
```

---

## 8. 完整最小示例

`themes/minty.css`：

```css
/* @id minty */
/* @name 薄荷青 */
/* @author you */
/* @version 1.0.0 */
/* @description 清爽浅色主题 */

/* 1. 内容区基础 */
.container {
  --bg: #f0fdf4;
  --fg: #064e3b;
  --muted: #047857;
  --code-bg: #d1fae5;
  --code-border: #6ee7b7;
  --code-fg: #064e3b;
  --c-key: #047857;
  --c-str: #2563eb;
  --c-num: #b91c1c;
  --c-fn:  #7c3aed;
  --c-com: #6b7280;

  /* 强调色（影响链接、按钮） */
  --accent: #10b981;
  --accent-hover: #059669;
  --accent-light: rgba(16, 185, 129, 0.1);

  /* 表格 */
  --table-border: #6ee7b7;
  --table-header-bg: #d1fae5;
  --table-header-fg: #064e3b;
}

.container .preview { --preview-bg: #ecfdf5; }
.container.wysiwyg-v2 { --wysiwyg-bg: #ecfdf5; }

/* 2. 内容元素 */
.container .preview h1,
.container.wysiwyg-v2 .ProseMirror h1 {
  color: #047857;
  border-bottom: 2px solid rgba(4, 120, 87, 0.2);
}

.container .preview blockquote,
.container.wysiwyg-v2 .ProseMirror blockquote {
  border-left: 4px solid #6ee7b7;
  background: rgba(110, 231, 183, 0.1);
  color: #064e3b;
}

/* 3. 应用 chrome：让 ribbon 和 tab 跟主题协调 */
.ribbon {
  background: #d1fae5;
  border-right: 1px solid #6ee7b7;
}

.tabbar-tab {
  border-radius: var(--radius-md, 6px);
}
```

把这段保存为 `minty.css`，在 flyMD 顶栏「主题 → 来自本地目录/文件...」选中即可。

---

## 9. 本地资源文件支持（图片、字体、图标）

从本地目录安装主题时，theme-manager 会**自动递归拷贝**目录中的所有资源文件到主题目录。支持的文件类型：

| 类型 | 扩展名 |
|------|--------|
| 图片 | `.png` `.jpg` `.jpeg` `.gif` `.svg` `.webp` `.ico` `.bmp` `.avif` |
| 字体 | `.woff` `.woff2` `.ttf` `.otf` `.eot` |

### 9.1 CSS 中引用本地资源

在 CSS 中使用**相对路径** `url()` 引用资源文件。注入时插件会自动将相对路径转换为 Tauri 可识别的绝对 asset URL：

```css
/* 背景图片 */
body {
  background-image: url(./images/bg.jpg);
  background-repeat: repeat;
}

/* SVG 图标 */
.container h1::before {
  content: url(./icons/star.svg);
  display: inline-block;
  width: 20px;
  height: 20px;
}

/* 自定义字体 */
@font-face {
  font-family: 'MyFont';
  src: url(./fonts/myfont.woff2) format('woff2');
  font-display: swap;
}

.container .preview-body {
  font-family: 'MyFont', system-ui, sans-serif;
}
```

### 9.2 主题包目录结构示例

```
starry-night/
├─ theme.json
├─ style.css
├─ images/
│   ├─ stars-pattern.svg    ← 平铺背景图案
│   └─ hr-divider.svg       ← 分割线装饰
├─ icons/
│   ├─ heading.svg          ← 标题装饰图标
│   └─ blockquote.svg       ← 引用块图标
└─ fonts/
    └─ custom.woff2         ← 自定义字体
```

> 示例见 `examples/peach-oolong/`（主题包基础示范）。

### 9.3 URL 转换规则

theme-manager 在主题应用时，会把 CSS 里的相对 `url()` 路径**转换为 blob URL**（通过 `URL.createObjectURL` 把磁盘文件读成内存对象）。这样可以绕过 Tauri asset scope 限制和文件协议跨域限制，所有 webview 都能稳定加载本地资源。

| CSS 中写的 | 转换行为 |
|-----------|---------|
| `url(./images/bg.png)` | ✅ 读盘 → blob → `url(blob:https://...)` |
| `url(images/bg.png)` | ✅ 转换（无 `./` 前缀也行） |
| `url(../shared/x.png)` | ❌ 不转换（不能往上跳出主题目录） |
| `url(https://example.com/bg.png)` | ❌ 不转换（外部 URL 保持原样） |
| `url(data:image/png;base64,...)` | ❌ 不转换（data URI 保持原样） |
| `url(blob:...)` | ❌ 不转换（已经是 blob 直接保留） |

> 切换主题时上一份 blob URL 会被 `URL.revokeObjectURL` 回收，不会有内存泄漏。

### 9.4 注意事项

1. **仅本地安装支持资源拷贝**——从 URL 或 GitHub 安装时只下载 CSS 和 theme.json，不会下载图片资源
2. **子目录递归拷贝**——`images/sub/deep.png` 这样的嵌套路径也会被正确拷贝和引用
3. **外部字体仍可用**——`@import url('https://fonts.googleapis.com/...')` 或 HTTPS `src` 不受影响
4. **base64 内联仍可用**——`url(data:image/svg+xml;base64,...)` 适合小图标，无需额外文件

---

## 10. 调试技巧

### 10.1 用 DevTools（推荐）

打开 flyMD 的开发者工具（`Ctrl+Shift+I` Windows / `Cmd+Option+I` macOS）：

```js
// 1. 看注入的样式
document.getElementById('flymd-theme-plugin-injected').textContent

// 2. 看当前应用的主题 id
document.getElementById('flymd-theme-plugin-injected').dataset.themeId

// 3. 实时改样式做实验（不用反复保存安装）
const tag = document.getElementById('flymd-theme-plugin-injected')
tag.textContent = `
  .container { --bg: red; }
`

// 4. 查看 flyMD 当前用的 Typography / MdStyle
document.querySelector('.container').className

// 5. 查看 chrome 元素实际的 class 名（解决"我的选择器为什么不匹配"）
document.querySelector('.titlebar')?.outerHTML  // 看顶栏
document.querySelector('.ribbon')?.outerHTML    // 看左侧栏
```

调好之后再回到磁盘的 CSS 文件里固化。

### 10.2 DevTools 打不开怎么办

flyMD release 构建可能没启用 `devtools` feature，`Ctrl+Shift+I` 没反应。这时候只能用**纯 CSS 探针**把信息画到屏幕上：

```css
/* 把所有元素的 class 名画在它的右上角，用来找实际的 chrome class 名 */
[class]::after {
  content: attr(class);
  position: absolute;
  top: 0;
  right: 0;
  font-size: 9px;
  color: #ff0;
  background: rgba(0, 0, 0, 0.6);
  padding: 1px 3px;
  pointer-events: none;
  z-index: 99999;
}

/* 检查某条规则是否生效：故意改成扎眼颜色 */
body .titlebar {
  background: magenta !important;  /* 如果整片变品红，说明匹配上了 */
}
```

把这段临时塞到主题 CSS 末尾，切换一次主题（默认 → 自己的主题）就生效。看完调好再删掉。

---

## 11. 兼容性建议

让你的主题在 flyMD 升级时不容易 break：

1. **优先用 🟢 稳定 API**（变量 + `.container/.preview/.preview-body/.ProseMirror/.codebox`），它们是 plugin.md 暴露的契约
2. **🟡 扩展类（chrome）只做点缀**——比如改 ribbon 背景色、tab 圆角，而不是大量 layout 改造
3. **不要覆盖 `:root`**，用 `.container` 作用域；这样不会污染主题面板和对话框
4. **不要碰布局变量**（`--dock-* / --gap-* / --library-width / --workspace-*`），它们由 flyMD 内部维护
5. **测试三种模式**：编辑（Ctrl+E 切换）、阅读、所见即所得，确保都正常
6. 在主题描述里写"基于 flyMD vX.Y.Z 测试"，方便用户判断兼容性

---

## 12. 发布主题

### 通过 GitHub 仓库分发

仓库根目录放 `theme.json` + `style.css`（或 `theme.css`），别人就能用：

```
flyMD 顶栏 → 主题 → 来自 GitHub...
输入：your-name/your-theme-repo
```

或带分支：`your-name/your-theme-repo@dev`

### 通过 URL 分发

把 `.css` 或 `theme.json` 挂在任意 HTTPS 站点：

```
flyMD 顶栏 → 主题 → 来自 URL...
输入：https://example.com/my-theme.css
```

### 安全提示

- CSS 可以通过 `url()`、`@import` 拉远端资源；分发主题时尽量自托管资源
- 用户**不应该**安装来源不明的主题——CSS 能做请求追踪、行为统计

---

## 13. 命名建议

- `id`：纯 ASCII，小写、短横线分隔（`midnight-amethyst`，不要 `My Theme!`）
- `name`：可以用中文，会显示在菜单里
- 文件名建议跟 `id` 保持一致

---

## 14. 参考资料

- [flyMD 官方插件 API 文档](../.docs/plugin.md#主题扩展theme)（含 `flymdTheme` 全局对象）
- 本仓库示例主题：
  - `examples/peach-oolong/` — 主题包基础示范（含 `theme.json` + `style.css`）
- flyMD 主程序源码（用于查 🟡 扩展选择器）：<https://github.com/flyhunterl/flymd/blob/main/src/style.css>
- [highlight.js 官方 token CSS class 列表](https://github.com/highlightjs/highlight.js/blob/main/docs/css-classes-reference.rst)（远比 §6.3 完整，flyMD 不一定都用得上）
- [Milkdown 文档](https://milkdown.dev/docs)（所见模式编辑器内核）

---

## 反馈

发现 flyMD 还有哪些主题相关的钩子/选择器可以补充？或者本插件可以增强哪些能力（多文件资源、主题热更新、调色板 UI 等）？欢迎在仓库提 issue。
