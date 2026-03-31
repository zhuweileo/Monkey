# TODOS

## [TODO-1] 脚本执行报错 v2 AI 修复功能

**What:** 脚本执行失败时，提供"让 AI 修复"按钮。把原始描述 + 错误堆栈 + 原脚本发回给 AI，获得修复版本。

**Why:** AI 最能体现价值的场景之一就是 debug。技术用户看到脚本报错，第一反应是"让 AI 帮我修"。v1 先做 toast 提示验证用户需求，确认后做这个功能。

**Pros:** 强化"AI 降低门槛"的核心价值主张；对技术用户高价值；错误修复循环是 Tampermonkey 的常见场景。

**Cons:** 需要设计错误捕获机制（content script 中的 `try/catch` + 消息传回 sidepanel）；错误堆栈可能包含用户敏感页面信息。

**Context:** v1 在 content script 中捕获脚本执行异常并显示 toast 提示。v2 在 toast 上加一个"让 AI 修复"按钮，点击后打开 sidepanel 并预填"修复此脚本"的请求上下文。当前 content script 不向 sidepanel 发送任何消息，需要新增消息类型 `SCRIPT_ERROR`。

**Depends on:** v1 基础错误处理（Next Steps 第 9 步）完成后再做。

---

## [TODO-2] SPA 路由监听

**What:** 使用 `chrome.webNavigation.onHistoryStateUpdated` 监听 SPA 内路由变化，在 URL 变化时重新检查并执行匹配脚本。

**Why:** Twitter/X、YouTube、GitHub 等高频使用的网站都是 SPA。没有这个功能，用户在这些网站内切换页面时，脚本不会重新执行，体验极差。这是 v1 完成后优先级最高的功能。

**Pros:** 解决最常用网站的核心场景；`webNavigation.onHistoryStateUpdated` 是标准 Chrome API，有明确文档支持。

**Cons:** 需要在 manifest 中增加 `"webNavigation"` 权限；需要处理 URL 未真正变化（仅 hash 变化）的过滤逻辑；可能导致脚本在同一页面内重复执行（需要幂等性设计或执行去重）。

**Context:** 当前 background SW 只监听 `chrome.tabs.onUpdated`（过滤 `status: 'complete'`），只在完整页面加载时触发。SPA 内路由变化不会触发此事件。需要在 background SW 中增加第二个监听器并复用同一套匹配+注入逻辑。

**Depends on:** v1 核心注入逻辑完成后。

---

## [TODO-3] .user.js 导出功能

**What:** 在脚本管理列表中为每个脚本添加"导出"按钮，导出标准 `// ==UserScript==` 格式的 `.user.js` 文件。

**Why:** 让用户能把 AI 生成的脚本在 Tampermonkey / Violentmonkey 中使用，打破数据孤岛，提升用户信任感。对于想迁移到标准工具的技术用户尤其有价值。

**Pros:** 提升用户信任（"你的脚本是你的，不被锁定"）；技术用户可以在 Tampermonkey 中进一步修改；实现成本低（脚本已经有 `==UserScript==` 头，直接下载即可）。

**Cons:** 需要确保 `@grant` 声明正确（v1 脚本可能没有声明 `@grant none`，导致导出后在 Tampermonkey 中报错）。

**Context:** `StoredScript.code` 已经包含完整的 `// ==UserScript==` 头，导出本质上是触发文件下载：`URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))`。注意需要验证 AI 生成的脚本头是否符合 Tampermonkey 规范（尤其是 `@match` 和 `@run-at` 字段的格式）。

**Depends on:** 无前置依赖，v2 任意时间可做。
