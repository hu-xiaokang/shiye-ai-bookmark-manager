# Contributing

感谢你参与改进拾页。

## 本地开发

1. Fork 并克隆仓库。
2. 打开 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择仓库目录。
5. 修改代码后点击扩展卡片上的“重新加载”。

项目采用原生 HTML、CSS 和 JavaScript，无需安装依赖或执行构建。

## 提交建议

- 一个 Pull Request 只解决一个清晰问题。
- UI 修改请附修改前后截图。
- 新增数据字段时应考虑旧数据兼容、备份和恢复。
- 涉及用户数据或权限时，请同步更新 `PRIVACY.md`。
- 提交前至少执行：

```bash
node --test
node --check popup.js
node --check options.js
node --check background.js
```

## Commit 信息

推荐使用简洁的英文动词开头，例如：

- `feat: add semantic bookmark search`
- `fix: preserve category during native sync`
- `docs: clarify model privacy behavior`
