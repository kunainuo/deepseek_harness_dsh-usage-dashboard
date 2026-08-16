# DSH 用量仪表盘（DSH Usage Dashboard）

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web 应用打造的**持久化用量仪表盘**插件。

它在一个悬浮卡片中展示你的 **DeepSeek API 余额**与**本地 Token 消耗统计**（按天 / 按模型 / 按会话），带条形图与自动刷新；并且以**常驻组合插件**方式安装 —— 每次启动 DSH 自动加载，**重启不消失**。

![Status](https://img.shields.io/badge/status-stable-green) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## 功能特性

| 功能 | 说明 |
| --- | --- |
| 💰 **API 余额** | 实时查询 `https://api.deepseek.com/user/balance`（总余额 / 充值余额 / 赠送余额 / 账户可用状态 / 币种），60 秒缓存 |
| 📊 **Token 统计** | 累计输入 / 输出 / 总 token、模型调用次数、会话数 —— 从本地 DSH 会话日志计算 |
| 📈 **每日条形图** | 近 14 天 Token 消耗，堆叠柱状（输入 + 输出） |
| 📊 **按模型条形图** | 各模型（deepseek-chat、deepseek-reasoner 等）的 Token 消耗对比 |
| 🏆 **消耗 TOP 会话** | Token 消耗最高的 5 个会话 |
| 🪟 **悬浮卡片** | 固定右下角、置顶显示：紧凑摘要 ↔ 展开完整仪表盘 |
| 🔘 **侧边栏按钮** | 侧边栏底部「用量」按钮（窄栏模式显示 📊），开关悬浮卡片 |
| ⏱ **自动刷新** | 默认每 60 秒；可切换 30 秒 / 1 分钟 / 5 分钟 / 关闭，防重叠并发 |
| ♻️ **持久化** | 安装进 DSH profile 组合 —— 关机/重启 DSH 后依然存在（无需重复批准） |

## 截图

![紧凑悬浮卡片](screenshots/floating-card-compact.png)

![展开的完整仪表盘](screenshots/dashboard-expanded.png)

![侧边栏「用量」按钮](screenshots/sidebar-button.png)

## 环境要求

- **DSH Web 模式**正在运行（`npx @deepseek-ai/dsh web` 或你平时的启动方式）
- **DeepSeek API Key** 已在 DSH 中配置（`设置 → 模型` 会写入 `$DSH_HOME/.credentials.yaml` 的 `DEEPSEEK_API_KEY`）
- **PowerShell**（用于安装/卸载脚本），或按下方手动步骤操作
- DSH 宿主上的 **Node.js ≥ 22**（用于 zstd 原始日志快读）

## 安装

### 自动安装（推荐）

```powershell
# 在本仓库目录下执行
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

脚本会：

1. 定位 `$DSH_HOME`（默认 `~/.dsh`）与 `web` profile；
2. 把插件包复制到 `$DSH_HOME/profiles/node_modules/dsh-usage-dashboard/`；
3. 向 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加组合行（幂等）；
4. 若存在旧版 `@local/usage-dashboard` 安装则自动迁移清理。

随后**重启 DSH**（`npx @deepseek-ai/dsh web`）。仪表盘自动出现 —— 无需批准、无需再次安装。

### 手动安装

1. 将 `package.json` 与 `lib/` 复制到 `$DSH_HOME/profiles/node_modules/dsh-usage-dashboard/`。
2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加：

   ```yaml
   - insert:
       - id: usage-dashboard
         name: 'dsh-usage-dashboard'
   ```

3. 重启 DSH。

### 卸载

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

或手动：删除 `$DSH_HOME/profiles/node_modules/dsh-usage-dashboard/`，并从 `cordis.patch.yml` 移除 `usage-dashboard` 行。

## 使用方法

1. 点击侧边栏底部「**用量**」按钮（窄栏显示 📊 图标）打开悬浮卡片；
2. 紧凑卡片显示**总余额 / 累计 Token / 模型调用次数 / 更新时间**，点击卡片主体（或「＋」）展开完整仪表盘；
3. 展开后可见余额卡片组、Token 统计、近 14 天堆叠条形图、按模型条形图、消耗 TOP 会话表；
4. 使用「**自动刷新**」开关与间隔选择（30 秒 / 1 分钟 / 5 分钟），或点「**刷新**」手动更新；
5. 点「✕」关闭卡片，随时可用侧边栏按钮重新打开。

## 工作原理

```
┌────────────────────────── 浏览器（客户端） ───────────────────────────────┐
│  lib/client.js （产品 __ModuleLoader__ bundle，纯 React）                  │
│    • 注册槽位：sidebar.footer.action + shell.overlay                       │
│    • 每次刷新 fetch('/usage-dashboard/data')                              │
│    • 通过客户端 timer 服务实现自动刷新                                    │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ GET /usage-dashboard/data
┌───────────────┴────────────────── DSH 宿主（服务端） ──────────────────────┐
│  lib/index.js （普通 Cordis 组合插件）                                    │
│    • 在 ctx.webServer 上注册精确路由（inject: webServer）                  │
│    • 余额：credentials.resolve('DEEPSEEK_API_KEY')                        │
│            → curl https://api.deepseek.com/user/balance（60 秒缓存）      │
│    • 用量：sessionPersistence.readRaw(id) 快路径                           │
│            （原始 JSONL + zstd 多帧解码，无回放校验，秒级）                │
│            兜底：sessionQuery.readSession                                 │
│            聚合为 totals / 按天 / 按模型 / TOP 会话（5 分钟缓存）          │
└────────────────────────────────────────────────────────────────────────────┘
```

- 客户端以 `/plugins/dsh-usage-dashboard/client.js` 由 DSH 的 `client-modules` 服务直接伺服 —— 采用产品 `window.__ModuleLoader__` bundle 格式，**无需构建步骤**；
- 宿主与客户端共处一个双面包（`package.json`：`main` 为宿主入口，`dsh.client` + `exports["./client"]` 为浏览器入口）。

## 配置项

打开 `lib/index.js`，调整文件顶部常量：

| 常量 | 默认值 | 含义 |
| --- | --- | --- |
| `BALANCE_TTL_MS` | 60 000 | 余额响应缓存时长（毫秒） |
| `USAGE_TTL_MS` | 300 000 | 用量聚合结果缓存时长（毫秒） |
| `MAX_SESSIONS` | 100 | 扫描的会话数上限（最新的在前） |

客户端默认（`lib/client.js`）：自动刷新**开启**、间隔 **60 秒**。

## 数据与隐私

- API Key 通过 DSH 的 `credentials` 服务读取，**仅在宿主进程内**用于调用官方余额接口：不会下发到浏览器、不会写日志、不会离开你的机器。
- Token 统计**完全本地**计算，基于你自己的 DSH 会话日志；无遥测、无第三方服务。
- 自动刷新开关为内存态（浏览器刷新后恢复默认），符合 DSH 动态插件约定。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| DSH 启动报错：`failed to parse ... cordis.patch.yml: end of the stream or a document separator is expected` | 全新 profile 模板里的裸 `[]` 行残留在了插入行旁边。重新执行 `scripts/install.ps1`（新版会自动剥离裸 `[]`），或手动删除 `[]` 行 |
| 卡片显示「余额：未配置 DEEPSEEK_API_KEY」 | 在 DSH `设置 → 模型` 中填入 API Key |
| `/usage-dashboard/data` 返回应用 HTML 而非 JSON | 宿主未注册路由 —— 查看 DSH 启动日志；确认是 web profile（存在 `webServer`） |
| 首次加载较慢 | 全新启动后首次扫描读取原始日志（通常数秒）；若异常慢说明 `readRaw` 快路径回退到了验证式读取 |
| DSH 升级后组件消失 | 重新执行 `scripts/install.ps1` |

## 开发

```
dsh-usage-dashboard/
├── package.json        # 双面包元数据（宿主 main + dsh.client）
├── lib/
│   ├── index.js        # 宿主：HTTP 路由、余额与用量聚合
│   └── client.js       # 浏览器：React UI、槽位、fetch、自动刷新
├── scripts/
│   ├── install.ps1     # 安装到 DSH（复制 + 打补丁，幂等，含旧名迁移）
│   └── uninstall.ps1   # 从 DSH 卸载
├── screenshots/        # README 截图
├── README.md           # 英文说明
└── LICENSE             # MIT
```

修改方式：

- **宿主行为**（数据、缓存、路由）→ 改 `lib/index.js`，重跑 `scripts/install.ps1` 并重启 DSH；
- **界面** → 改 `lib/client.js`（`__ModuleLoader__` factory 内 `require("react")` 写纯 React），重跑安装脚本并重启 DSH；保持模块 `id` 与包名一致。

## 开源协议

[MIT](./LICENSE)
