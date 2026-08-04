# 招采工作进展协同版

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zqf1314/Execel)

这是原单页招采工具的多人协同版。一个 Cloudflare Worker 同时托管静态前端和 `/api/*` 接口，D1 保存所有同事共享的业务数据、数据版本及操作日志，不需要单独创建 Cloudflare Pages 项目。

GitHub 只保存源码和数据库迁移，不保存生产业务数据。迁移前 HTML、浏览器数据快照和本地开发数据库均已被 `.gitignore` 排除。

## 自定义表格列

管理员登录后可以点击顶部的 **列设置**：

- 修改现有 8 个业务列的显示名称；底层字段标识不会变化，改名不会丢失数据。
- 新增最多 30 个自定义列，每个名称最长 60 个字符，每个单元格最长 2000 个字符。
- 新列会自动加入项目新增/编辑表单、明细表、全部列搜索、Excel 导出、WPS 复制和 JSON 备份。
- 列设置和自定义单元格都保存在 D1，其他同事会在约 3 秒内看到变化。
- 列名称修改带独立版本检测并写入操作日志；普通编辑者和只读账号不能修改表格结构。

为避免误删整列后造成公共数据不可恢复，当前版本只提供新增和改名，不提供删除列。

## 一键部署

点击上方 **Deploy to Cloudflare**：

1. 登录 Cloudflare 并授权连接 GitHub。
2. 按页面提示填写或确认新 Git 仓库名、Worker 名称和 D1 名称。
3. 保留自动识别的部署命令 `npm run deploy`，然后开始部署。
4. Cloudflare 会自动创建 D1、执行 `migrations/` 中尚未执行的迁移、部署 Worker，并为后续 Git 推送启用 Workers Builds 自动部署。
5. 部署完成后打开 Cloudflare 给出的 `workers.dev` 地址；网页和 API 使用同一个域名。

这个按钮本身会在部署者的 GitHub/GitLab 账户中复制一份新仓库，所以通常不必预先 Fork。已 Fork 且未修改源码时也可以直接点击；如果需要部署 Fork 中已经修改过的内容，请把按钮链接里的仓库地址替换为自己的 Fork 地址。

### 默认一键部署：无需填写环境变量

Cloudflare 最后一步“创建和部署”页面只需要：

| 页面项目 | 直接使用的默认值 |
| --- | --- |
| D1 数据位置 | 保持 `Automatic` |
| 启用读取复制 | 不勾选 |
| 环境变量 | 不会出现，无需填写 |

直接点击“部署”即可。程序在未设置 `ALLOW_ANONYMOUS` 时默认按 `true` 运行，部署完成后立即可以多人使用。

如果部署页面仍然要求填写 `ALLOWED_ORIGINS` 或其他环境变量，说明打开的是旧模板快照。请退出该流程，回到本 README 重新点击部署按钮。

## 两种权限模式教程

### 模式一：`ALLOW_ANONYMOUS=true`（默认、零配置）

适合先部署验收，或网址只在可信同事之间流转的场景：

1. 点击部署按钮。
2. D1 数据位置保持 `Automatic`，读取复制不勾选。
3. 不需要添加任何环境变量，直接部署。
4. 把生成的 Worker 地址发给同事，所有人读写同一份 D1 数据。

没有设置 `ALLOW_ANONYMOUS` 与明确设置为 `true` 的效果相同。此模式下访问者不需要登录，知道网址的人拥有编辑和导入权限。

### 模式二：`ALLOW_ANONYMOUS=false`（Cloudflare Access 登录保护）

适合正式使用，只允许指定邮箱登录：

1. 先按默认模式完成一次部署。
2. 打开 Cloudflare 控制台：**Workers & Pages → 当前 Worker → Settings → Domains & Routes**。
3. 在 `workers.dev` 路由旁点击 **Enable Cloudflare Access**。
4. 在 Access 设置中添加允许登录的同事邮箱或邮箱域名。启用弹窗会显示 Team Domain 和 Application Audience (AUD) Tag。
5. 打开 **当前 Worker → Settings → Variables and Secrets**，添加下表中的普通文本变量，然后保存并部署：

| 变量名 | 应填写的值 | 示例 |
| --- | --- | --- |
| `ALLOW_ANONYMOUS` | 固定填写 `false` | `false` |
| `TEAM_DOMAIN` | Access 弹窗显示的 Team Domain | `https://your-team.cloudflareaccess.com` |
| `POLICY_AUD` | Access 弹窗显示的 Application Audience (AUD) Tag | 复制弹窗中的完整值 |
| `ADMIN_EMAILS` | 管理员邮箱，多个用英文逗号分隔 | `admin@example.com` |
| `READ_ONLY_EMAILS` | 可选；只读邮箱，多个用英文逗号分隔 | `viewer@example.com` |

不要添加 `ALLOWED_ORIGINS`：网页和 API 使用同一个 Worker 域名，同源访问不需要配置它。部署命令带有 `--keep-vars`，以后 Git 自动部署时会保留在控制台设置的这些变量。

### 环境变量默认值

| 变量名 | 未设置时的默认行为 |
| --- | --- |
| `ALLOW_ANONYMOUS` | `true`，公开协作模式 |
| `TEAM_DOMAIN` | 不设置；仅 `ALLOW_ANONYMOUS=false` 时需要 |
| `POLICY_AUD` | 不设置；仅 `ALLOW_ANONYMOUS=false` 时需要 |
| `ADMIN_EMAILS` | 空；公开模式的匿名用户自动拥有管理员权限，Access 模式下则无人拥有导入权限 |
| `READ_ONLY_EMAILS` | 空；Access 允许的成员默认可以编辑 |
| `ALLOWED_ORIGINS` | 空；只允许同源网页正常调用 API |

`ALLOW_ANONYMOUS` 只接受 `true` 或 `false`，填写其他内容时 Worker 会明确报告配置错误。

## 自定义域名配置（可选）

推荐使用独立子域名，例如 `zhaocai.example.com`。前提是根域名 `example.com` 已添加到当前 Cloudflare 账户并处于 **Active** 状态。

### 绑定域名

1. 先完成 Worker 一键部署。
2. 打开 **Workers & Pages → 当前 Worker → Domains**。如果控制台仍是旧布局，则进入 **Settings → Domains & Routes**。
3. 点击 **Add → Custom Domain**。
4. 输入完整主机名，例如 `zhaocai.example.com`；不要填写 `https://`、路径或末尾斜杠。
5. 点击 **Add Custom Domain**，等待状态变为可用。
6. 打开 `https://zhaocai.example.com` 验证网页，再访问 `https://zhaocai.example.com/api/health` 验证接口。

Cloudflare 会自动创建所需 DNS 记录并签发 HTTPS 证书，不需要把 Worker 的 `workers.dev` 地址手动配置成 CNAME。选择的主机名不能已有 CNAME；为避免影响现有网站，优先使用一个没有 DNS 记录的新子域名。

本项目的前端和 API 始终位于同一域名，因此绑定自定义域后：

- 不需要修改 `public/config.js`。
- 不需要添加 `ALLOWED_ORIGINS`。
- 不需要另外创建 `api.example.com`。
- 根域名 `example.com` 与 `www.example.com` 是两个不同主机名；需要同时支持时，应分别添加或设置重定向。

### 自定义域 + `ALLOW_ANONYMOUS=true`

无需其他配置。自定义域生效后直接使用，但任何知道该域名的人都可以查看和修改数据。

### 自定义域 + `ALLOW_ANONYMOUS=false`

1. 先按上面的步骤绑定自定义域。
2. 打开 **Zero Trust → Access → Applications → Add an application → Self-hosted**。
3. 将 Application domain 设置为完整自定义域，例如 `zhaocai.example.com`，并添加允许访问的邮箱或邮箱域策略。
4. 从该 Access 应用复制 Team Domain 和 Application Audience (AUD) Tag。
5. 回到 Worker 的 **Settings → Variables and Secrets**，按“模式二”教程填写 `ALLOW_ANONYMOUS=false`、`TEAM_DOMAIN`、`POLICY_AUD`、`ADMIN_EMAILS` 等变量。
6. 登录自定义域验证成功后，可在 Worker 的 **Domains** 页面关闭 `workers.dev`，避免同事误用旧地址。

`POLICY_AUD` 必须来自保护这个自定义域的 Access 应用；不要复制其他应用的 AUD。

> 一键部署会复制当前仓库并创建全新的 D1，不会复制任何现有业务数据。

## 本地运行

需要 Node.js 20 或更高版本：

```powershell
npm.cmd install
npm.cmd run db:migrate:local
npm.cmd run dev
```

打开 Wrangler 输出的本地地址。本地未设置环境变量时同样使用默认公开协作模式。

完整校验：

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:columns
npm.cmd run test:import
```

## 目录

- `public/`：由 Worker Static Assets 托管的前端。
- `worker/src/`：Worker REST API。
- `migrations/`：D1 数据库迁移；一键部署时自动执行。
- `tests/`：输入校验、迁移和本地端到端测试。
- `legacy/`：仅本地保留的迁移前备份，不会提交 GitHub。

## 数据迁移

首次打开公共空库时，如果当前浏览器仍保存旧版的三个 `localStorage` 数据键，管理员会看到一次性迁移横幅。建议先导出 JSON 备份，再确认导入。导入请求有唯一 ID，重复点击不会产生第二份数据；公共库已有业务数据后会拒绝再次导入。

## 并发、同步与现有功能

- 每条项目、采购类别、采购方式和表格列都有独立 `version`。
- 更新和删除必须提交读取时的版本；版本不一致返回 `409 Conflict`，页面会提示重新加载，避免多人互相覆盖。
- 前端每 3 秒检查全局版本，发生变化才下载完整快照。
- 所有写请求都带 UUID `requestId`，操作日志以此去重。
- 离线时保留已加载数据供查看，但阻止写入。
- 现有筛选、汇总看板、WPS 复制和 Excel 导出继续使用同一份前端数据模型；新增列自动接入搜索和导出。

## 安全说明

- Worker 会验证 Cloudflare Access JWT 的签名、签发者、受众和有效期。
- SQL 全部使用参数绑定，前端对业务字段进行 HTML 转义。
- D1 的 `audit_logs` 不提供修改或删除接口。
- `wrangler.jsonc` 不包含账户专属资源 ID 或任何密钥；D1 由 Cloudflare 自动配置绑定。

Cloudflare 官方参考：[Deploy 按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/)、[Worker 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[一键为 workers.dev 启用 Access](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/)、[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)。
