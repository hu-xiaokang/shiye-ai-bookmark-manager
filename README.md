# 拾页 · AI 智能书签

> 简体中文 | [English](README.en.md)

<p align="center">
  <img src="assets/shiye-logo.svg" width="96" alt="拾页 Logo" />
</p>

> Local-first, BYOK AI bookmark manager for Chrome.

拾页是一款本地优先、无需账号的 Chrome 智能书签管理器。它与 Chrome 原生书签联动，使用你自己配置的大模型自动分类、生成中文标签和内容摘要，并提供全库模糊搜索、常用网址、最近浏览、重复治理和安全恢复。

## 界面预览

<p align="center">
  <img src="assets/screenshots/library-en.png" width="900" alt="拾页英文版网址分类与搜索主界面" />
</p>

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/save-bookmark-en.png" alt="新建收藏弹窗" /></td>
    <td width="50%"><img src="assets/screenshots/ai-organized-en.png" alt="AI 自动分类、摘要与标签结果" /></td>
  </tr>
  <tr>
    <td align="center">收藏当前网页</td>
    <td align="center">AI 分类、摘要与标签</td>
  </tr>
</table>

## 核心特点

- **本地优先**：收藏、配置和浏览统计保存在当前浏览器中。
- **自带模型密钥（BYOK）**：支持 OpenAI Chat Completions 兼容接口。
- **原生书签联动**：监听 Chrome 书签的新增、修改和删除。
- **智能整理**：自动生成分类、中文标签和完整摘要。
- **节省 Token**：长正文按开头、中段和结尾进行信息保留式压缩，并限制模型输出长度。
- **搜索优先**：搜索标题、摘要、标签、分类、网址和域名。
- **长期可靠**：提供回收站、重复合并、安全快照与导入预检。
- **无需构建**：原生 HTML、CSS、JavaScript，下载后即可加载。
- **多语言**：内置简体中文和英文，支持跟随浏览器语言，并可继续扩展其他语言。

## 安装

1. 打开 Chrome，在地址栏输入 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目文件夹。
4. 固定“拾页”图标，点击即可开始使用。

也可以从 GitHub Releases 下载发布包，解压后按上述方式加载。

## 配置模型

在插件右上角进入设置，填写：

- API URL：服务根地址、`/v1` 地址或完整的 `/chat/completions` 地址均可。
- API Key：模型服务提供的密钥。
- 模型名称：例如 `gpt-4o-mini`、`deepseek-chat` 或服务商支持的其他模型。

建议先点击“测试连接”，成功后保存。API Key 仅保存在当前浏览器的 `chrome.storage.local` 中。

## 功能概览

- 收藏或更新当前网页
- 一键扫描现有 Chrome 原生书签，预览新增、关联和重复数量，并批量进行 AI 分类、标签与摘要整理
- 编辑已收藏网址的标题、URL、分类、摘要和内容标签
- 将网址标记为“稍后阅读”，按到期时间优先展示，并在到期后自动取消标记
- AI 自动选择分类，生成标签和摘要
- 为 AI 分类结果生成置信度；低置信度网页在用户打开并可读取正文后，可按默认设置自动复核一次
- 读取当前网页正文并生成可编辑的内容摘要
- 已打开网页优先从浏览器标签页读取登录态和动态渲染后的正文，并支持从内嵌框架提取内容
- 对标题、摘要、标签、分类和域名进行全库模糊搜索，支持 `⌘/Ctrl + K` 或 `/` 快速聚焦
- 常用网址：综合访问次数、最近访问时间、主动输入次数和活跃浏览时长排名
- 最近浏览：读取 Chrome 历史记录，并严格按最后访问时间倒序展示
- 按分类筛选、全文搜索、删除和打开收藏
- 自定义分类
- 右键快速收藏页面或链接
- 与 Chrome 原生书签联动：新增和修改自动同步，删除时按设置自动删除或由用户确认
- 可配置默认行为：新收藏自动 AI 分类与摘要，原生书签删除时自动同步删除
- 本地模型用量统计：请求次数、成功率、输入/输出 Token、今日用量、估算节省量及功能拆分
- 回收站：删除后保留 30 天，支持立即撤销、恢复和彻底删除；删除分类前迁移其中收藏
- 重复网址治理：忽略常见跟踪参数识别重复项，支持合并标题、摘要、标签与原生书签关联
- AI 整理队列：展示等待、处理中、完成和失败状态，支持单条重试与批量补处理
- 安全备份：默认排除 API Key，导入前预检重复项，支持合并导入、覆盖恢复和操作前安全快照
- JSON 数据导入、导出和安全清空
- 界面语言可选择跟随浏览器、简体中文或英文；AI 标签和摘要会使用对应语言生成

## 多语言扩展

运行时界面翻译集中在 `i18n.js`，Chrome 扩展名称、描述和右键菜单翻译位于 `_locales/`。新增语言时，添加一份资源表、设置页选项和对应的 `_locales/<locale>/messages.json` 即可；未翻译文案会自动回退到简体中文。

## 隐私说明

收藏、浏览时长统计和配置保存在本机。插件会读取 Chrome 历史记录，用于生成“常用网址”和“最近浏览”视图，并监听 Chrome 原生书签的新增、修改和删除以实现联动；浏览历史不会发送给模型服务。启用自动整理或主动执行“一键整理 Chrome 书签”后，收藏标题、网址和可读取的网页正文会发送到你配置的模型服务；公开网页正文以不携带 Cookie 的方式读取，本机和私有网络地址不会在后台访问。

详细说明见 [PRIVACY.md](PRIVACY.md)。

## 项目结构

```text
├── manifest.json       # Chrome Manifest V3 清单
├── i18n.js             # 界面多语言资源与翻译工具
├── category-colors.js  # 稳定、高区分度的分类自动配色
├── bookmark-model.js   # 稍后阅读标记、到期时间与分类约束
├── model-utils.js      # 输入压缩、Token 估算与模型输出预算
├── app-utils.js        # URL 规范化、响应解析和安全转义
├── ai-client.js        # 统一的模型提示词、请求和响应协议
├── page-content.js     # 标签页正文读取、公开页面抓取与安全过滤
├── _locales/           # Chrome 扩展名称、描述和右键菜单翻译
├── tests/              # 共享模块、分类配色、Token 优化与书签导入测试
├── background.js       # 原生书签同步、AI 队列、浏览统计
├── popup.html/js/css   # 插件主界面
├── options.html/js/css # 设置和数据管理
├── assets/             # Logo 等资源
└── icons/              # Chrome 扩展图标
```

## 开发与贡献

项目无需安装依赖。修改代码后，在 `chrome://extensions/` 中点击“重新加载”即可验证。

欢迎提交 Issue 和 Pull Request。开始贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请参考 [SECURITY.md](SECURITY.md)。

## 路线图

- 批量导入和批量 AI 整理
- 语义搜索
- 失效链接检测
- Ollama、LM Studio 等本地模型预设
- 更完善的数据迁移与自动化测试

## License

[MIT](LICENSE)
