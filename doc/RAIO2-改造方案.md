# RAIO2 改造方案

> 编写：资深开发工程师 | 日期：2026-07-07

---

## 目录

1. [总体架构](#一总体架构)
2. [战役一：聚焦·去伪存真](#二战役一聚焦去伪存真)
3. [战役二：突破·学者代理 ⭐核心](#三战役二突破学者代理)
4. [战役三：深化·知识引擎](#四战役三深化知识引擎)
5. [战役四：闭环·评价体系](#五战役四闭环评价体系)
6. [额外建议](#六额外建议路由rag协作)
7. [改造优先级矩阵](#七改造优先级矩阵)
8. [Demo 演示脚本](#八demo-演示脚本)

---

## 一、总体架构

RAIO2 改造围绕四个核心战役推进，从"减负聚焦"到"核心技术突破"再到"体验深化与论证闭环"，最终交付一个定位清晰、差异化显著的科研全栈助手。

```
┌──────────────────────────────────────────────────────────┐
│                    RAIO2 改造总览                          │
│                                                          │
│  ┌───────────────┐   ┌───────────────┐                   │
│  │ 战役一 - 聚焦 │──▶│ 战役二 - 突破 │                   │
│  │ 去伪存真      │   │ 学者代理 ⭐   │                   │
│  │ 砍非核心功能  │   │ 浏览器自动化  │                   │
│  └───────┬───────┘   └───────┬───────┘                   │
│          │                   │                            │
│          ▼                   ▼                            │
│  ┌───────────────┐   ┌───────────────┐                   │
│  │ 战役三 - 深化 │◀──│ 战役四 - 闭环 │                   │
│  │ 知识引擎 2.0  │   │ 评价体系      │                   │
│  │ 导图/问答/缓存│   │ 度量/对比/案例│                   │
│  └───────────────┘   └───────────────┘                   │
│                                                          │
│  技术支撑: Puppeteer + AES加密凭据 + SQLite缓存           │
│           + Mermaid可视化 + 对比实验设计                  │
└──────────────────────────────────────────────────────────┘
```

---

## 二、战役一：聚焦·去伪存真

### 目标

从"功能大杂烩"提炼为"科研利器"，评委明确指出花园种植、心情记录与科研辅助定位不符。

### 具体操作

| 操作 | 涉及范围 | 理由 |
|------|---------|------|
| 删除 Stardew Valley 花园种植 | `server/index.js` 中 `/api/stardew/*` 路由、前端的 Stardew 相关页面组件 | 与科研零关系 |
| 删除心情记录功能 | 如存在相关路由和组件一并移除 | 同上 |
| 删除 Todo 待办事项 | `server/index.js` 中 `/api/todos/*` 路由、`todos` 表、前端 Todo 组件 | 非核心，科研人员有成熟工具 |
| 删除对应数据库表 | `todos` 表及相关 seed 逻辑 | 减少维护负担 |

### 保留核心功能

- 多 Agent 对话系统 (Lumo / DeepScholar / Bookworm / Codex / Scholar)
- 论文检索、收藏、笔记
- 100 天学习路径
- 成就系统
- 全局记忆 RAG

> **改后定位一句话**：RAIO = 科研人员的 AI 全栈助手（查文献 → 下全文 → 写综述 → 学知识 → 积累记忆）

---

## 三、战役二：突破·学者代理

### 3.1 为什么这是核心竞争力

评委原话：

> "让 Agent 去做 LLM 本身做不到的事，例如利用用户本地的机构认证去访问有版权保护的期刊全文，或者自动登录 IEEE、ACM、Elsevier 等文献数据库进行检索和下载——这些操作需要本地 credential、需要与外部系统交互，是纯粹的 LLM 无法绕开的。"

Scholar Proxy Agent 正是对这一反馈的直接回应。

### 3.2 技术架构

```
用户输入: "帮我找 Attention Is All You Need 的全文并总结"
                              │
                              ▼
                  ┌───────────────────────┐
                  │   Agent Orchestrator   │
                  │   LLM 拆解任务为步骤    │
                  │   (Plan→Act→Observe)   │
                  └───────────┬───────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
   │ ArXiv       │    │ IEEE Xplore │    │ ACM DL      │
   │ (免费直连)   │    │ (需机构认证) │    │ (需机构认证) │
   └─────────────┘    └──────┬──────┘    └──────┬──────┘
                             │                  │
                             └────────┬─────────┘
                                      ▼
                          ┌───────────────────────┐
                          │   Puppeteer Browser    │
                          │   - 自动导航登录页面    │
                          │   - 填入用户凭据        │
                          │   - 执行搜索            │
                          │   - 识别下载按钮        │
                          │   - 下载 PDF            │
                          │   - 每步截图回传        │
                          └───────────┬───────────┘
                                      ▼
                          ┌───────────────────────┐
                          │   本地文献库 (SQLite)   │
                          │   元数据 + PDF 路径     │
                          └───────────┬───────────┘
                                      ▼
                          ┌───────────────────────┐
                          │   LLM 总结 + 翻译      │
                          │   生成结构化综述        │
                          └───────────────────────┘
```

### 3.3 新增模块

#### 模块 1：凭据管理器 `server/credentialManager.js`

```javascript
// 接口设计
class CredentialManager {
  // AES-256-GCM 加密存储
  async saveCredentials(userId, database, { username, password }) { }
  // 使用时解密（需用户二次确认）
  async getCredentials(userId, database) { }
  // 检查是否已配置
  async hasCredentials(userId, database) { }
  // 删除凭据
  async deleteCredentials(userId, database) { }
}
```

- 密钥从环境变量 `CREDENTIAL_SECRET` 读取，代码中不出现明文
- 每次 Agent 使用凭据前通过前端弹窗请求用户确认
- 新增 `credentials` 数据库表

#### 模块 2：浏览器自动化引擎 `server/browserAgent.js`

```javascript
class BrowserAgent {
  async init() { /* 启动 headless Chromium，复用 userDataDir 保持登录态 */ }
  async executePlan(plan) {
    // plan = [{ action: 'navigate', url: '...' },
    //         { action: 'fill', selector: '#username', value: '...' },
    //         { action: 'click', selector: '#login-btn' },
    //         { action: 'waitForSelector', selector: '.search-input' },
    //         ... ]
  }
  async screenshot() { /* 截图并返回 base64 */ }
  async downloadPDF(url, filename) { }
  async close() { }
}
```

- 基于 Puppeteer（Node.js 原生，无需额外运行时）
- 复用浏览器 profile 保留登录状态，减少重复认证
- 每步操作产出截图，通过 SSE 流式回传前端进度面板

#### 模块 3：数据库适配器 `server/adapters/`

```javascript
// 每个学术数据库实现统一接口
class DatabaseAdapter {
  async login(browser, credentials) { throw new Error('Not implemented') }
  async search(browser, query) { throw new Error('Not implemented') }
  async getPDF(browser, paperId) { throw new Error('Not implemented') }
}

// 具体实现
class IEEEAdapter extends DatabaseAdapter { ... }
class ACMAdapter extends DatabaseAdapter { ... }
class ElsevierAdapter extends DatabaseAdapter { ... }
class CNKIAdapter extends DatabaseAdapter { ... }  // 知网
```

- 适配器模式，新增数据库只需实现 3 个方法
- 每个适配器包含对应数据库的 DOM 选择器映射

#### 模块 4：新增 Agent——ScholarProxy

```javascript
// server/agents.js
const ScholarProxyAgent = {
  key: 'scholar-proxy',
  name: '学者代理',
  systemPrompt: `你是一个学术代理助手，可以利用用户的机构凭据自动访问付费学术数据库。

你可以执行以下操作：
1. 文献检索：在多个数据库（IEEE、ACM、Elsevier、CNKI）中搜索论文
2. 全文获取：自动登录并下载 PDF 全文
3. 综述生成：基于下载的论文生成结构化综述

执行规则：
- 每次需要用户确认凭据使用
- 下载完成后自动存档到本地文献库
- 对获取到的内容进行总结和翻译`,
};
```

### 3.4 Agent 调度流程

```
用户发送消息
        │
        ▼
  detectAgent(msg) ───── 关键词匹配到 "文献获取" ─────▶ ScholarProxy Agent 激活
        │
        ▼
  LLM 生成执行计划 (JSON):
        {
          "database": "ieee",
          "query": "attention mechanism transformer",
          "actions": [
            "login with credentials",
            "search for papers",
            "filter by relevance",
            "download top 3 PDFs"
          ]
        }
        │
        ▼
  BrowserAgent.executePlan(plan)
        │
        ▼ (SSE 流式推送进度)
  前端展示：进度条 + 操作截图 + 当前状态
        │
        ▼
  PDF 存入本地 → 触发 LLM 总结 → 聊天消息中附带论文卡片
```

### 3.5 为什么评委买账

| 对比维度 | 纯 LLM (ChatGPT/DeepSeek) | RAIO Scholar Proxy |
|---------|--------------------------|-------------------|
| 访问付费期刊 | ❌ 无法 | ✅ 利用机构订阅 |
| 下载全文 PDF | ❌ 只能给链接 | ✅ 自动下载到本地 |
| 跨库聚合检索 | ❌ 手动切换 | ✅ 一键多库 |
| 操作可见性 | ❌ 黑盒 | ✅ 截图流式展示 |
| 凭据安全 | — | ✅ 加密本地存储 + 每次确认 |

---

## 四、战役三：深化·知识引擎

### 4.1 思维导图生成

#### 技术方案

```
用户输入: "我要学习 Transformer 架构"
                    │
                    ▼
          ┌────────────────────┐
          │  LLM 生成大纲       │
          │  Markdown 列表格式  │
          └────────┬───────────┘
                   ▼
          ┌────────────────────┐
          │  markmap 渲染       │  ← 前端: npm install markmap-lib
          │  交互式思维导图     │      零 prompt engineering
          └────────┬───────────┘
                   ▼
          ┌────────────────────┐
          │  存入 SQLite        │  ← mindmap_md 字段
          │  二次访问直接读缓存  │
          └────────────────────┘
```

- **总览导图**：覆盖整个知识领域全景（如 NLP 的所有子领域层级）
- **章节导图**：每个学习章节的详细知识点树，节点可点击展开/折叠
- 用户可在导图上标记"已掌握/学习中/未开始"状态
- 推荐库：**markmap**（从 Markdown 标题层级自动生成思维导图），LLM 只需输出普通 Markdown 列表

#### 数据库扩展

```sql
ALTER TABLE learn_courses ADD COLUMN mindmap_md TEXT;
ALTER TABLE learn_courses ADD COLUMN mindmap_overview TEXT;
ALTER TABLE learn_courses ADD COLUMN mindmap_generated_at TEXT;
```

### 4.2 测验缓存与错题追踪

```sql
ALTER TABLE learn_progress ADD COLUMN quiz_json TEXT;
ALTER TABLE learn_progress ADD COLUMN quiz_generated_at TEXT;
ALTER TABLE learn_progress ADD COLUMN wrong_tags TEXT;
```

- 首次生成测验后存入 `quiz_json`，后续访问直接返回缓存
- 记录每道题的得分，下次出题优先覆盖历史错题涉及的知识点
- `wrong_tags` 存储错题标签，用于针对性出题

### 4.3 知识导师 Agent

在现有 Agent 体系中新增 `Tutor`：

```javascript
const TutorAgent = {
  key: 'tutor',
  name: '知识导师',
  systemPrompt: `你是一个课程专属辅导老师。

当前课程：{course_topic}
章节大纲：{chapter_outline}
用户正在学习：第 {chapter_idx} 章
学习进度：{progress_summary}

你的职责：
1. 回答用户关于本章知识点的任何问题，用通俗易懂的方式解释
2. 如果用户要求出题，生成 3 道针对性题目（单选/判断/简答混合）
3. 用苏格拉底式提问引导用户深入思考（先问"你觉得为什么..."，再给出答案）
4. 用户答错时，不要直接说"错了"，而是解释正确思路并回顾相关概念
5. 可以将当前知识点与用户已有的知识体系联系起来`,
};
```

- 前端呈现：学习页面右下角悬浮导师窗口，类似"小助手"
- 支持 "给我出几道题考考我" 和 "我对 XXX 概念不太理解" 两种主要交互
- 上下文自动注入当前课程大纲 + 历史学习进度

---

## 五、战役四：闭环·评价体系

评委明确反馈："如何评价效果方面建议补充"。

### 5.1 定量指标体系

| 指标 | 测量方式 | 数据来源 |
|------|---------|---------|
| 文献获取成功率 | 成功下载数 / 总检索请求数 | 系统操作日志 |
| 文献获取效率 | Agent 获取 vs 人工获取耗时对比 | 用户实验计时 + 系统日志 |
| 学习知识覆盖度 | 思维导图生成节点 vs 标准大纲对照 | LLM 评估 + 人工抽查 |
| 测验正确率变化 | 首次测验得分 vs 间隔一周后重测得分的差值 | `learn_progress.score` |
| 记忆检索准确率 | RAG 召回结果是否与用户意图匹配 | Top-5 命中率指标 |
| 用户满意度 | 5 点 Likert 量表 | 内置问卷 |

### 5.2 对比实验设计

#### 实验 A：文献获取对比

| 维度 | 对照组 | 实验组 |
|------|--------|--------|
| 工具 | ChatGPT + 人工浏览器检索 | RAIO Scholar Proxy Agent |
| 任务 | 找到 10 篇指定论文的 PDF 全文 | 同左 |
| 人数 | ≥3 名测试者 | 同左 |
| 记录 | 成功率、单篇耗时、主观疲劳度 | 同左 |
| 预期 | 成功率受限于机构订阅 | 成功率 >80%，耗时减少 >70% |

#### 实验 B：学习效果对比

| 维度 | 对照组 | 实验组 |
|------|--------|--------|
| 工具 | Google + ChatGPT 自学 | RAIO 学习模块（导图+测验+导师） |
| 任务 | 7 天内学习不熟悉的领域（如"图神经网络"） | 同左 |
| 第 7 天 | 统一闭卷测试（30 题） | 同左 |
| 预期 | 基准分 | 得分提升 >30% |

#### 实验 C：综述写作效率对比

| 维度 | 对照组 | 实验组 |
|------|--------|--------|
| 工具 | 手动检索 + ChatGPT 辅助 | RAIO 全流程（检索→下载→总结→组织） |
| 任务 | 完成 2000 字文献综述 | 同左 |
| 记录 | 总耗时、引用文献数量、导师评分 | 同左 |

### 5.3 评价报告输出

在 RAIO 中内置一个"使用报告"页面展示：

- 用户累计指标（下载论文数、学习章节数、成就解锁数）
- 与基线对比的可视化图表
- Demo 时可一键导出为比赛展示用数据

---

## 六、额外建议（路由 / RAG / 协作）

### 6.1 Agent 意图路由升级

**现状问题**：`detectAgent` 是关键词优先匹配，脆弱且不可扩展。

**改进方案——两阶段路由**：

```
用户消息
    │
    ▼
阶段一: 关键词快速匹配（保持低延迟，覆盖 80% 场景）
    │
    ├── 命中 → 直接路由
    │
    └── 未命中
           │
           ▼
阶段二: 轻量 LLM 分类（deepseek-v4-flash，约 0.1s）
    │
    └── 返回最匹配的 Agent key
```

- 成本极低（只有未命中时调用一次 flash 模型）
- 但让用户体验从"有时候路由不准"变成"总是能智能判断"
- 新增模糊匹配：用户说"帮我看看这篇"→ 自动识别为 Bookworm

### 6.2 RAG 全局记忆升级

**现状**：基于关键词权重检索（BM25 级别），准确率有限。

**改进**：增加语义检索层
- 本地运行 `all-MiniLM-L6-v2`（仅 80MB），做 embedding
- 记忆存入时同步生成向量，检索时用余弦相似度 Top-K
- 预期：将"记起之前聊过的内容"的准确率从 ~60% 提升到 ~90%

### 6.3 实验室协作知识库（加分项）

- 同一实验室成员可选择性共享论文笔记和学习路径
- "你的同门张三收藏过这篇论文，他的笔记是..."
- 利用了本地社交网络，纯 LLM 无法做到
- 若时间充裕，可作为附加亮点

---

## 七、改造优先级矩阵

| 优先级 | 战役 | 理由 | 预估工时 |
|--------|------|------|----------|
| **P0** | 一·聚焦·去伪存真 | 删代码最快，纯化定位，为后续腾空间 | 0.5 天 |
| **P0** | 二·突破·学者代理 | **核心竞争力**，评委最想要的，Demo 效果最炸 | 3 天 |
| **P1** | 三·深化·知识引擎 | 队友的直接反馈，丰富学习体验 | 2 天 |
| **P1** | 四·闭环·评价体系 | 补齐评委指出的"缺乏评价"短板 | 1 天 |
| **P2** | 额外·路由/RAG/协作 | 锦上添花，视剩余时间取舍 | 视情况 |

### 实施顺序

```
Day 1: 战役一（清理代码） + 战役二架构搭建（Puppeteer 集成 + 凭据管理器）
Day 2: 战役二核心开发（IEEE/ACM 适配器 + Agent 调度 + 前端进度面板）
Day 3: 战役二测试打磨 + 战役三思维导图 + 测验缓存
Day 4: 战役三导师机器人 + 战役四评价体系搭建
Day 5: 整体联调 + Demo 脚本排练 + 对比实验数据收集
```

---

## 八、Demo 演示脚本

比赛决胜点。控制在 **5 分钟**内。

| 时间 | 操作 | 展示内容 |
|------|------|---------|
| 0:00-0:30 | 打开 RAIO，展示简洁界面 | 砍掉花园/Todo 后的纯化体验 |
| 0:30-1:30 | 输入"帮我找 Attention Mechanism 的综述论文" | Agent 自动识别 → 激活 Scholar Proxy → 侧边栏展示浏览器自动登录 IEEE、搜索、逐篇下载的截图流 |
| 1:30-2:30 | 切换到文献库 | 5 篇核心论文已存档，点击任意一篇 → LLM 生成的结构化摘要 + 翻译 |
| 2:30-3:30 | "根据这些论文，帮我生成一个 Transformer 的学习计划" | 一键生成 100 天学习路径 → 总览思维导图渲染 → 点击展开第 1 章 → 章节导图 |
| 3:30-4:30 | 在学习页面打开导师窗口 | "用简单的话给我解释一下 Self-Attention" → 导师回答 → "出两道题考考我" → 即时测验 |
| 4:30-5:00 | 切换到评价页 | 展示本次使用数据：4 分钟完成了原本需要 40 分钟的文献调研 + 学习规划工作 |

### Demo 准备清单

- [ ] 准备 1-2 个学术数据库的测试账号（可用校园网账号或共享测试号）
- [ ] 预缓存几篇论文的检索结果，防止 Demo 时数据库响应慢
- [ ] 准备对比实验的 mock 数据（展示评价页面时用）
- [ ] 录制一段"人工操作"的录屏作为对比素材（可选，放在 PPT 里）
- [ ] 准备一个"如果网络出问题"的降级方案（本地缓存优先）

---

## 附录：当前代码质量速览

在对代码库进行全面审查后，整理以下关键发现供团队参考：

### 做得好的

- 数据库操作全部参数化查询，无 SQL 注入风险
- README 文档详尽，项目结构清晰
- SSE 流式聊天实现正确，缓冲区处理合理
- react-markdown 使用安全（未启用 rehype-raw，天然防 XSS）

### 需要关注的

| 问题 | 严重性 | 说明 |
|------|--------|------|
| TypeScript 配置形同虚设 | 中 | tsconfig 有 `strict:true` 和 `include:["src"]`，但文件全是 `.jsx`，运行 `tsc --noEmit` 返回 "No inputs were found"——类型检查从未生效，给团队造成"有类型安全"的错觉 |
| 无 ESLint/Prettier | 中 | 零代码风格约束，大量重复内联 style，新增团队代码质量管控的第一步 |
| 无自动化测试 | 中 | 没有 `test` script，没有 Vitest/Jest |
| 单一路由文件 | 低 | `server/index.js` 约 1067 行承载全部路由，后续应拆分为 Express Router 模块 |
| CORS 全开放 | 低 | `cors()` 无限制，目前本地运行无影响，后续部署需收紧 |
| `saveDB` 同步写盘 | 低 | 每 5 秒 + 每次操作同步 `fs.writeFileSync`，在低并发下无碍，高并发可能阻塞事件循环 |

> 注意：评委已给出"工程质量扎实"的评价，代码重构不是当前优先事项。以上问题可作为赛后持续改进的待办项。
