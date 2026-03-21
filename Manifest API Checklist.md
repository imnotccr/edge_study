# 学习专注型 Edge 扩展 Manifest 与 API 实现清单

## 1. 目标

将计划书和 PRD 落到可开发的 MV3 扩展骨架上，明确需要的 Manifest 字段、浏览器 API、动态规则策略和后台职责。

## 2. 建议目录结构

```text
/
├─ manifest.json
├─ popup.html
├─ popup.js
├─ popup.css
├─ background/
│  ├─ service-worker.js
│  ├─ session-manager.js
│  ├─ rules-manager.js
│  ├─ stats-manager.js
│  └─ unlock-manager.js
├─ pages/
│  ├─ start-session.html
│  ├─ start-session.js
│  ├─ options.html
│  ├─ options.js
│  ├─ block.html
│  ├─ block.js
│  ├─ unlock.html
│  ├─ unlock.js
│  ├─ dashboard.html
│  └─ dashboard.js
├─ shared/
│  ├─ storage.js
│  ├─ constants.js
│  ├─ time.js
│  ├─ domain.js
│  └─ theme.js
└─ assets/
   ├─ icons/
   └─ styles/
```

## 3. `manifest.json` 清单

| 键 | 建议值 | 是否必需 | 说明 |
| --- | --- | --- | --- |
| `manifest_version` | `3` | 是 | MV3 扩展基础 |
| `name` | 学习专注型 Edge 扩展 | 是 | 扩展名称 |
| `description` | 学习时仅允许访问白名单网站的专注扩展 | 是 | 简要描述 |
| `version` | `0.1.0` | 是 | MVP 初版 |
| `action` | 指向 `popup.html` | 是 | 扩展弹窗入口 |
| `background` | `service_worker` 指向 `background/service-worker.js` | 是 | 后台逻辑入口 |
| `options_page` | `pages/options.html` | 建议 | 白名单与设置入口 |
| `permissions` | 见下表 | 是 | 浏览器能力声明 |
| `host_permissions` | `["<all_urls>"]` | 是 | 需要对所有导航做判断和拦截 |
| `web_accessible_resources` | 暴露 `pages/block.html` 及其资源 | 是 | 供 DNR 重定向到拦截页 |
| `incognito` | `split` | 建议 | 支持 InPrivate 主框架加载扩展页 |
| `icons` | 16/32/48/128 | 建议 | 商店与系统展示 |
| `commands` | 可选 | 否 | 如未来想加入开发快捷键可用 |

## 4. 所需权限清单

| 权限 | 用途 | 说明 |
| --- | --- | --- |
| `storage` | 存储会话、配置、日志、统计 | 核心持久化能力 |
| `declarativeNetRequest` | 拦截和重定向导航 | 实现专注护栏的核心 |
| `declarativeNetRequestWithHostAccess` | 配合主机权限做规则控制 | 某些实现中会更稳妥 |
| `alarms` | 到期检查 | 不能单独依赖 |
| `tabs` | 扫描并处理现有标签页 | 开始专注时立即拦截已打开页面 |
| `webNavigation` | 记录导航与统计 | 只记录域名级聚合信息 |
| `runtime` | 启动恢复、安装初始化、消息通信 | 后台必需 |

## 5. `web_accessible_resources` 建议

```json
{
  "resources": [
    "pages/block.html",
    "pages/block.js",
    "assets/styles/*",
    "assets/icons/*"
  ],
  "matches": ["<all_urls>"]
}
```

**说明**

1. `block.html` 需要可被重定向访问。
2. 拦截页依赖的脚本、样式、图标也应一起暴露。

## 6. 核心 API 对应关系

| API | 负责内容 | 关键注意事项 |
| --- | --- | --- |
| `chrome.storage.local` | 会话状态、配置、日志、统计 | 关键状态必须落盘 |
| `chrome.declarativeNetRequest` | 白名单放行与非白名单重定向 | 动态规则要有稳定 ID 管理 |
| `chrome.alarms` | 会话结束时机检查 | 浏览器重启后可能丢失 |
| `chrome.runtime.onStartup` | 浏览器启动恢复 | 需重新校验 `endAt` |
| `chrome.runtime.onInstalled` | 初始化默认配置 | 首次安装写入默认值 |
| `chrome.webNavigation` | 记录被拦截域名统计 | 只记录主框架导航 |
| `chrome.tabs.query` | 扫描现有标签页 | 会话开始时执行 |
| `chrome.tabs.update` | 将现有非白名单标签跳到拦截页 | 仅处理可拦截标签 |
| `chrome.storage.onChanged` | 驱动页面实时刷新 | 弹窗、拦截页、汇总页可复用 |

## 7. 后台模块职责

### 7.1 `service-worker.js`

负责事件注册与分发：

1. `onInstalled`
2. `onStartup`
3. `onAlarm`
4. `runtime.onMessage`
5. 必要的导航与标签事件

### 7.2 `session-manager.js`

负责：

1. 创建和结束专注会话
2. 计算剩余时间
3. 恢复重启后的活动会话
4. 管理临时放行状态

### 7.3 `rules-manager.js`

负责：

1. 生成白名单规则
2. 生成默认拦截重定向规则
3. 清理旧规则
4. 处理开发模式快速退出后的规则清空

### 7.4 `stats-manager.js`

负责：

1. 写入被拦截记录
2. 汇总今日、本周、全部数据
3. 执行过期数据清理

### 7.5 `unlock-manager.js`

负责：

1. 生成 5 道乘法题
2. 校验答案
3. 写入解锁记录
4. 管理失败冷却状态

## 8. 动态规则策略

## 8.1 规则目标

1. 白名单域名可正常访问。
2. 非白名单 `http/https` 主框架导航统一跳转到 `block.html`。
3. 专注结束后应完全清理动态规则。

### 8.2 规则设计建议

| 规则类型 | 优先级 | 作用 |
| --- | --- | --- |
| 白名单 `allow` 规则 | 高 | 允许命中白名单域名的主框架导航 |
| 默认 `redirect` 规则 | 低 | 将其他主框架导航跳转到拦截页 |
| 临时放行状态 | 最高或旁路判断 | 生效期间暂停拦截规则或移除重定向规则 |

### 8.3 规则生成建议

1. 专注开始时，根据 `whitelistSnapshot` 生成白名单规则。
2. 再生成一条通配的主框架重定向规则。
3. 临时放行 10 分钟时，优先采用“暂停默认重定向规则”的方式，结束后自动恢复。
4. 专注结束时，删除本会话对应的所有动态规则。

### 8.4 域名匹配建议

1. 首版只做域名和子域开关，不做路径规则。
2. 对 `includeSubdomains = true` 的项，匹配主域和子域。
3. 对 `includeSubdomains = false` 的项，仅匹配精确主机名。
4. 输入白名单时统一做标准化处理，例如小写化、去掉协议和尾部斜杠。

## 9. 会话恢复与计时策略

### 9.1 存储策略

必须持久化以下字段：

1. `activeSessionId`
2. `focusSession`
3. `settings`
4. `whitelistEntries`
5. `blockAttempts`
6. `unlockAttempts`

### 9.2 恢复策略

1. 浏览器启动时读取当前活动会话。
2. 若不存在活动会话，则确保规则已清理。
3. 若存在活动会话且当前时间小于 `endAt`，则恢复规则并补建 alarm。
4. 若存在活动会话但已过期，则自动结束会话并清理规则。

### 9.3 倒计时展示策略

1. UI 倒计时基于 `endAt - Date.now()` 实时计算。
2. `alarms` 只作为兜底唤醒机制。
3. 不依赖内存计时器保存真实状态。

## 10. 已打开标签页的处理

### 10.1 触发时机

专注开始成功后立即执行。

### 10.2 处理流程

1. `tabs.query({})` 获取当前窗口或全部窗口标签页。
2. 跳过浏览器内部页、扩展页、空白页和已是拦截页的标签。
3. 判断标签页 URL 是否命中白名单快照。
4. 对不命中的标签页执行 `tabs.update(tabId, { url: blockPageUrl })`。
5. 记录其来源为 `existing_tab` 的拦截统计。

## 11. 应急解锁实现清单

### 11.1 题目规则

1. 固定 5 题。
2. 每题为两位数乘以两位数。
3. 一次性提交。
4. 必须全部答对才算通过。

### 11.2 结果分支

| 分支 | 行为 |
| --- | --- |
| 临时放行 10 分钟 | 对全部网站暂停拦截 10 分钟 |
| 结束本次专注 | 立即清理规则并结束会话 |
| 提交失败 | 记录失败，按配置决定是否进入冷却 |

### 11.3 冷却配置

1. 设置页使用“开关 + 分钟数输入”。
2. 仅未开始专注时允许修改。
3. 冷却期间禁用再次答题入口。

## 12. 配置页实现清单

| 配置项 | UI 形态 | 存储字段 | 限制 |
| --- | --- | --- | --- |
| 自定义时长上限 | 下拉选择 | `customDurationCapOption` | 仅未开始专注时可改 |
| 统计保留时长 | 数字输入 | `retentionDays` | 正整数 |
| 冷却启用 | 开关 | `unlockCooldownEnabled` | 仅未开始专注时可改 |
| 冷却分钟 | 数字输入 | `unlockCooldownMinutes` | 启用时必填 |
| 主题 | 单选/切换 | `theme` | 可随时修改 |

## 13. 开发模式快速退出按钮

### 13.1 目标

为开发和测试提供快速恢复正常浏览状态的能力。

### 13.2 实现建议

1. 使用环境开关或构建标记控制按钮显示。
2. 仅在 `devToolsEnabled` 或开发构建中渲染。
3. 点击后调用统一的 `forceEndSessionForDebug()`。

### 13.3 `forceEndSessionForDebug()` 应执行的操作

1. 清理当前会话状态。
2. 清理动态拦截规则。
3. 清理临时放行状态。
4. 清理冷却状态。
5. 可选记录一条 `debug_exit` 日志。

## 14. 测试检查清单

### 14.1 功能测试

1. 创建专注会话成功。
2. 白名单站点正常访问。
3. 非白名单站点进入拦截页。
4. 已打开非白名单标签页在开始专注后被立即处理。
5. 浏览器重启后会话恢复正常。
6. 应急解锁答题通过后可选择两种结果。
7. 冷却启用时，失败后无法立刻再次尝试。
8. 专注中白名单与配置为只读。

### 14.2 边界测试

1. 域名输入带协议或路径时应报错。
2. `endAt` 已过期但规则残留时能自动自愈。
3. 临时放行结束后拦截自动恢复。
4. InPrivate 未启用时能给出明确提示。
5. 快速退出按钮在正式模式不出现。

## 15. 建议开发顺序

1. 先搭 `manifest.json` 与 service worker 骨架。
2. 完成会话状态管理与本地存储层。
3. 接入 DNR 动态规则与标签页立即拦截。
4. 完成 `popup`、开始页、拦截页。
5. 完成白名单与设置页。
6. 完成解锁页、汇总页。
7. 最后补开发模式快速退出和测试自检。
