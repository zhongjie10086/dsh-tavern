# DSH Tavern · 社区修复版

基于 DSH 的文字游戏项目，支持导入 SillyTavern 人物卡、世界书、预设、正则和已兼容的脚本。此分支提供安装与游玩所需的代码和资源，适配的 DSH 内核为 **0.1.5-rc.2**。

本分支维护于 [zhongjie10086/dsh-tavern](https://github.com/zhongjie10086/dsh-tavern/tree/release-r15-clean)，源自 [flizzywine/dsh-tavern](https://github.com/flizzywine/dsh-tavern)。第三方组件保留各自的来源和许可证。

## 安装

命令行安装需要 Node.js 22.19 或更新版本。安装器会准备独立的 DSH 运行环境，无需更改全局 DSH。当前修复版主要在 Windows 命令行环境验证；macOS、Linux、Desktop 与手机端未完成本轮实机验收。

Windows PowerShell：

```powershell
$env:DSH_TAVERN_HOST = 'cli'
$tavernInstaller = [Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/zhongjie10086/dsh-tavern@release-r15-clean/install.ps1'))
Invoke-Expression $tavernInstaller
```

macOS / Linux：

```sh
curl -fsSL https://cdn.jsdelivr.net/gh/zhongjie10086/dsh-tavern@release-r15-clean/install.sh | DSH_TAVERN_HOST=cli sh
```

安装结束后使用终端显示的完整网页地址。之后可使用：

```text
dsh-tavern start
dsh-tavern open
dsh-tavern status
dsh-tavern stop
dsh-tavern restart
```

需要排查安装环境时可运行 `dsh-tavern doctor`。不要向他人公开带访问凭据的完整网页地址或未脱敏的诊断文件。

## 开始游玩

1. 打开页面，配置自己的模型服务和 API 凭据。
2. 导入人物卡；按卡片说明导入其需要的世界书、预设或插件。
3. 选择预设和模型，创建游玩会话。

本项目**不附带私人下载的 Izumi 等游玩预设、人物卡、聊天记录、API 配置或测试数据**。请自行从作者处取得所需内容；第三方脚本是否可用取决于其依赖和使用的接口。

`presets/tavern` 和 `presets/tavern-background` 是启动正文 Agent、后台结算和内置技能的程序配置，属于项目运行依赖，与用户导入的游玩预设不同。请保留这些目录。

## 数据与更新

用户导入的资源、存档和配置由本地安装的数据目录保存，不属于 Git 发布内容。搬家或更新前请备份自己的数据。

本修复版保留应用内更新保护，避免被其他分支覆盖。需要手动更新时使用本分支的安装命令；安装器会校验版本及发布清单。不要混用上游 `main` 的安装命令，也不要直接升级到尚未适配的 DSH 内核。

## 发布内容

此分支包含运行代码、必要的编译产物和构建源码、安装器、依赖锁文件及第三方许可说明。不包含开发测试、测试工具、CI、截图、审阅日志或本机工作记录。开发测试保留在维护工作区；从本分支安装不需要它们。
