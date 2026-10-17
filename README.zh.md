# dsh-plugin-zoom

[![npm version](https://img.shields.io/npm/v/dsh-plugin-zoom.svg)](https://www.npmjs.com/package/dsh-plugin-zoom)
[![license](https://img.shields.io/npm/l/dsh-plugin-zoom.svg)](https://github.com/drliuhuan/dsh-plugin-zoom/blob/main/LICENSE)

一个 DeepSeek Harness 插件：给 Web UI 增加手动「界面缩放」，让高 DPI 显示器上的
文字更大、更清晰。

[English](https://github.com/drliuhuan/dsh-plugin-zoom/blob/main/README.md) | 中文

## 功能

三个入口共用同一个缩放值（75%–200%，5% 步进）：

- **设置 → 通用 → 界面缩放**：带放大/缩小箭头的步进控件，显示当前比例（如 `125%`）、
  当前显示器系统缩放（如 `当前显示器：200%`），以及「重置」回到 100%。
- **Ctrl（macOS 为 ⌘）+ 鼠标滚轮**：在窗口任意位置按 5% 步进缩放；会阻止页面自身的
  滚轮缩放，避免两套缩放同时生效。
- **会话界面右上角**（标题栏右侧 utilities 区、宿主按钮之后）有一个紧凑的
  **`− 125% +`** 控件；点中间的比例即可重置为 100%。

缩放比例会被记住（按主机域的 Cookie + 同源 `localStorage` 镜像），刷新页面、甚至重启
应用后仍然生效。

## 原理

客户端半边只改文档根节点上的一个 CSS 属性：

```css
html { zoom: 1.25; }
```

Chromium 会同时缩放布局、文字以及 fixed/浮层表面，因此整个 Web UI（包括对话框、菜单、
通知和设置面板本身）按同一比例缩放，文字是在更大字号下重新栅格化，而不是被拉伸模糊。
设置行注册在宿主自己的 `settings.general.item` 位置，右上角控件注册在会话标题栏的可增
加位置 `conversation.session.header.utilities`；两者都只使用宿主主题 token，浅色/深色
主题下与旁边控件一致。

## 为什么不用系统缩放

Windows 的显示缩放改变的是物理大小，而不是应用内部的逻辑密度。在较大的高 DPI 显示器
上，界面可能仍然偏小（也可能偏大），而且系统设置会影响所有程序。这个插件只缩放
Harness 的 Web UI，比例由你自己选，并且会记住。

## 0.1.2 修复：放大后 tooltip / 菜单位置漂移

在文档根节点使用 CSS `zoom` 时，Chromium 的 `getBoundingClientRect()` 与
`window.innerWidth`/`innerHeight` 返回的是**视觉坐标**（已经乘过缩放），而
`position: fixed` 子元素的定位坐标又会被再放大一次。宿主 UI 正是用这些值来定位
tooltip、hover card 和菜单，所以它们会偏离锚点 (缩放比例 − 1) × 距左上角距离——
也就是 0.1.1 反馈的问题。0.1.2 安装了一个「几何坐标空间修正」垫片：把这些读取换算
回 CSS 实际使用的布局坐标（指针 `clientX`/`clientY` 在首次真实指针事件自动判定后
同样换算），使宿主的定位、拖拽与命中测试在缩放后与 100% 时表现一致。垫片在 100%
时是恒等变换，插件卸载时恢复原型。React DevTools 修复过同样的浏览器行为，见
[facebook/react#37519](https://github.com/facebook/react/pull/37519)。

如果需要在 DevTools 控制台里对比「没有修正」的行为（重载后生效）：

```js
localStorage.setItem('dsh-plugin-zoom:no-geometry-shim', '1');
// localStorage.removeItem('dsh-plugin-zoom:no-geometry-shim');
```

## 说明与边界

- 缩放比例保存在浏览器里：主存是 Cookie（按主机域保存，不区分端口，所以桌面壳每次随机
  端口重启后仍能记住），同源 localStorage 作为镜像与兜底。
- 这是纯展示偏好：宿主不写任何数据，也不会把状态同步给模型。
- 允许小数比例，但想要最清晰的文字，优先用整数百分比：100%、125%、150%、200%。
- 页面内的 CSS 缩放**不会放大 Electron 的原生窗口按钮**（它由系统绘制在页面之上）。
  比例离 100% 较远时，自定义标题栏可能显得比原生按钮高一些；这是所有渲染端缩放的共同
  外观限制。插件有意不去动 Electron 的原生窗口缩放：插件的宿主半边是独立的 Node 宿主
  进程，拿不到 Electron API。
- 比例调大后，壳看到的逻辑窗口变窄，侧栏可能更早自动收起——与浏览器页面缩放一致。
- 滚动容器、对话框、菜单、通知都在被缩放的文档里，跟随同一比例。
- 插件之前叫 `dsh-plugin-dpi-scale`；已经用旧名字设置过的比例，会在本版本首次加载时自动
  迁移过来。

## 环境要求

- 支持 bundle 的 DSH profile（`@deepseek-ai/dsh-base` / Web profile）。开发与验证环境：
  DSH desktop 0.2.1-rc.2。
- Node.js >= 22 仅运行仓库检查脚本时需要。

## 安装

通过 DSH 插件管理器从 npm 安装：

```
plugin_manager action=install_bundle target=dsh-plugin-zoom@0.1.3
```

或从本地目录安装（目录安装会链接源码，便于开发）：

```
plugin_manager action=install_bundle target=D:\path\to\dsh-plugin-zoom
```

新 bundle 通过 HMR 立即生效；之后修改插件源码，需要刷新页面（或重启 DSH）来加载新的
客户端模块。

## 开发

- `client.js` —— 全部功能：偏好状态、文档缩放、Ctrl+滚轮、通用设置行、会话标题栏控件
  （经典脚本，注册到 `window.__ModuleLoader__`）。
- `index.js` —— 宿主半边，故意留空。
- `cordis.patch.yml` —— 插入 `zoom` Loader 行。
- `locale/*.json` —— 插件管理器里的标题与描述（英/中）。

提交前运行 `npm run check`。

## 发布

`.github/workflows/publish.yml` 通过 **npm trusted publishing（OIDC）** 发布。先在 npmjs.com
把本仓库（workflow `publish.yml`）配置成 trusted publisher，然后创建一个与 `package.json`
版本号一致的 GitHub Release（例如 `v0.1.3`）；workflow 会校验 tag、检查打包文件，并带
provenance 发布。

## 许可证

MIT，见 [LICENSE](https://github.com/drliuhuan/dsh-plugin-zoom/blob/main/LICENSE)。
