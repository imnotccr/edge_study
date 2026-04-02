# edge_study
让你在这个时代好好在 edge 浏览器中学习

## 当前开发说明

- 当前仓库默认以发布安全配置运行，`shared/constants.js` 中的 `DEVELOPMENT_BUILD = false`。
- 弹窗中的“快速退出”和持久化错误日志默认关闭，避免在正式环境暴露绕过入口或额外保留敏感数据。
- 如需本地调试，请显式开启开发构建并在测试完成后恢复为 `false`，再重新验证调试入口不会出现在正式界面。

## 仓库与本地数据

- 这个仓库存放的是扩展源码，不包含你的个人使用数据。
- 扩展运行时产生的白名单、会话、统计等内容保存在浏览器扩展存储中，而不是项目文件夹里。

## 建议上传到 GitHub 的内容

- 保留运行扩展所需源码：`manifest.json`、`popup.html`、`popup.js`、`assets/`、`background/`、`pages/`、`shared/`。
- 保留仓库基础文件：`README.md`、`LICENSE`、`.gitignore`。
- 产品文档、线框图、临时脚本可以不作为发布包内容；`.gitattributes` 已将这些文件标记为不进入导出归档。

## 生成 Release 包

- 运行 `powershell -ExecutionPolicy Bypass -File .\build-release.ps1`
- 脚本会生成 `dist/study-focus-guard-v<version>/` 和对应的 `zip`
- 这个 zip 适合上传到 GitHub Release，供别人下载后解压，并在 `edge://extensions/` 中通过“加载解压缩的扩展”使用

## Release 发布建议

- 优先上传你自己生成的 release zip
- 不要依赖 GitHub 自动生成的 `Source code (zip)`  作为最终给用户安装的包
