# 重置卡防过期提醒

Codex Windows x64 插件，版本 **1.6.2**。按剩余时长通知，并可选择自动使用重置卡。

## 安装

需要 Windows 10/11 x64、已登录的 Codex 桌面客户端及可通过 PATH 调用的 Codex CLI。macOS 暂不支持。

在 Codex 打开“插件 → 添加 → 添加插件市场”：

- 来源：`https://github.com/mayaxiaoan/codex-centurygame-plugins.git`
- Git 引用：`main`，也可以留空。
- 稀疏路径：留空。这个新市场仓库只有目录和说明，不包含运行环境。
- 市场显示名称：**CenturyGame班用插件**。

添加市场只取得轻量目录；选择“重置卡防过期提醒”安装时，再获取独立插件仓库和内置 Node.js。安装阶段仍需下载约33MiB的运行环境及少量插件文件，具体耗时取决于 GitHub 连接。完成后完全退出并重开 Codex。

已有旧 Git 来源时，先移除旧的市场来源，再添加上述新来源。市场内部标识由 reset-guard-creator-local 改为 centurygame-plugins，完整安装 ID 随之变化；个人数据目录、设置和通知标识不变。已有安装请先卸载旧插件，再移除旧市场，添加新市场后安装新版。移除插件与市场不会删除 Documents/Codex/ResetGuardCreator 内的个人数据。不要同时注册两个同名来源。

命令行：

```powershell
codex plugin remove codex-reset-guard-creator@reset-guard-creator-local
codex plugin marketplace remove reset-guard-creator-local
codex plugin marketplace add https://github.com/mayaxiaoan/codex-centurygame-plugins.git
codex plugin add codex-reset-guard-creator@centurygame-plugins
```

全新安装跳过前两条旧版本移除命令。本地 ZIP 安装也可解压到固定目录，在含 manage.ps1 的目录执行 `./manage.ps1 install-plugin`，并保留该目录。

## 1.6.2 的变化

共享市场内部标识统一为 centurygame-plugins，中文显示名仍为 CenturyGame班用插件；通知打开链接同步指向新安装 ID。通知 EXE 保持相同实现和体积。跨仓库条目在安装前会由当前 Codex 加载器清空图标字段，默认拼图图标并非缓存错误；安装后从真实插件包读取卡片重置图标。

## 1.6.1 的变化

1.6.0 的 PowerShell 通知快捷方式曾在实际测试中触发火绒告警，已撤回。1.6.1 更换为标准 EXE 通知入口；经过83项隔离回归测试、Defender单文件扫描，以及用户实际确认收到通知且火绒没有新告警。单次扫描和测试不代表对所有机器或未来规则的保证；不要恢复旧隔离快捷方式、关闭防护或添加白名单。

市场目录与插件内容分开存储在两个新仓库，避免下载旧仓库的大文件历史。
Node.js 22.23.5 仍随包分发，校验并离线解压，不修改系统 PATH，也不依赖已安装的 Node.js。
通知使用约50KB的标准 EXE，直接调用 Windows 通知 API，不再分发或要求安装 .NET 8/9/10、Windows SDK 或第三方通知库。通知快捷方式只指向该 EXE，参数固定为 --open，不启动脚本。
通知 EXE 使用 Windows 自带的 .NET Framework；这不等于完全不使用任何 .NET。它按需启动后退出，不增加常驻服务。
原有 Node 启动器仍使用系统 PowerShell，但通知组件和通知快捷方式不使用 PowerShell。不会修改系统执行策略或杀毒配置。企业策略限制组件或系统通知时会报告失败。

## 设置与运行

| 设置 | 可选值 | 新安装默认 |
| --- | --- | --- |
| 当剩余不足以下时长时通知我 | 24、12、6、3、1小时或永不 | 12小时 |
| 当剩余不足以下时长时自动帮我使用 | 24、12、6、3、1小时或永不使用 | 永不使用 |

升级保留现有选择，不自行启用自动使用。Codex 主窗口打开时运行，插件页无需一直打开；睡眠、断网和关闭期间不能执行，恢复后检查未过期卡片。剩余时间严格小于阈值才触发。
同次打开、同张卡片、同一阈值最多提醒一次；真正重开可再提醒。更改阈值后按新阈值判断，切回本次已提醒阈值不重发。先尝试自动使用，成功后停止提醒；账号或工作区变化时暂停设置。
选择自动使用时长即授权对当前账号卡片自动尝试使用。服务端可能拒绝，无法使用的卡片仍可能过期。接口依赖 Codex App Server experimentalApi，客户端更新后可能需要适配。

## 通知测试

“通知测试”位于“刷新”右侧，仅主动点击时发送一条 Windows 通知。发送期间禁用，结果或错误显示在页面。
不使用卡片，不修改设置和到期提醒去重记录，打开页面和定时刷新不会发送测试通知。
系统接受通知不保证出现横幅；请检查通知设置和勿扰模式。通知仍使用原来的应用标识和插件打开入口。

## 数据和运行环境

个人数据位于 `Documents/Codex/ResetGuardCreator`（可用 RESET_GUARD_CREATOR_HOME 覆盖）。不包含在发行包中。
Node 缓存位于 `%LOCALAPPDATA%/CodexResetGuard/runtimes/<SHA256>`（可用 RESET_GUARD_RUNTIME_CACHE 覆盖）。启动器校验分卷和文件哈希，处理并发首次启动和缓存损坏，不在线下载程序。
插件内部名称 codex-reset-guard-creator、MCP 名 reset-guard-creator、通知标识 Codex.ResetGuard.Creator.Notifications 及个人数据目录保持不变。市场内部名为 centurygame-plugins；通知打开入口已同步更新。

## 开发

构建 Node 后端和界面需要 Node.js 22+ 及 npm；运行用户不需要安装。入口源码是 src/mcp-entry.mjs 和 ui/dashboard.js；src/mcp.mjs、ui/bundle.js 为生成物。
通知源码在 notification-helper/Program.cs，通过 build-notifications.ps1 调用 Windows 自带 Framework 编译器构建，不需要现代 .NET SDK。构建产物在 notification-helper/windows-x64，仅 EXE、配置和图标三个文件。
构建环境使用 build-runtime.ps1 的 NodeDistribution、NodeArchiveSHA256 和新的 WorkDirectory 参数，输入应为经过官方校验的 Node.js Windows x64 分发目录。
测试用模拟账号、卡片和隔离目录，不发送真实通知或消费真实卡片。许可见 THIRD_PARTY_NOTICES.txt、THIRD_PARTY_NOTICES_NATIVE.txt 和 NODE-LICENSE.txt。
