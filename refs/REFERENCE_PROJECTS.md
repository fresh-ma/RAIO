# 📚 RAIO 参考项目 & 资源汇总

> Agent 开发时请仔细阅读这些参考，提取可复用的架构思路、UI 模式和像素风技术方案。

---

## 🏆 一、核心参考项目（必看）

### 1. Habitica — 游戏化任务管理鼻祖
- **GitHub**: https://github.com/HabitRPG/habitica ⭐ 13.5k+
- **为什么参考**: RAIO 的游戏化系统（星星积分、换装、成就）直接对标 Habitica。它是"把生活当 RPG 玩"的开创者。
- **重点学习**:
  - 像素角色资源存储在 `assets/` 目录，人物 sprite 的组织方式（分层: body/hat/outfit/weapon）
  - 任务完成 → 获得金币/经验值 的奖励逻辑
  - 装备系统的数据结构设计
  - 社交功能（组队打怪 → RAIO 里可以变成"组队读论文"）
- **关键代码路径**: `habitica/website/common/script/` 包含核心算法

### 2. PaperCircle — 多智能体论文发现框架 (ACL Oral 2026)
- **GitHub**: https://github.com/MAXNORM8650/papercircle
- **论文**: https://arxiv.org/abs/2604.06170
- **为什么参考**: 这是和 RAIO Paper Agent 最接近的学术项目，多智能体论文搜索+分析。
- **重点学习**:
  - 多 Agent 协作架构: Query Agent → Search Agent → Sorting Agent → Analysis Agent → Export Agent
  - arXiv API + Scopus + IEEE 多源检索 + BM25 + TF-IDF 混合排序
  - Paper Mind Graph: 从论文中提取概念、方法、实验的知识图谱
  - 前端用 React 18 + TypeScript，和 RAIO 技术栈一致
- **关键代码路径**: 
  - `src/components/Papers/` — 论文发现、详情、分析视图
  - `src/lib/` — arXiv client, API helpers
  - `backend/agents/` — Agent 编排管道

### 3. StardewOS — 星露谷风格操作系统 UI
- **GitHub**: https://github.com/FernandoBade/stardewOS
- **为什么参考**: 纯 HTML/SASS/JS 实现的星露谷主题桌面 UI，是 RAIO 视觉风格的直接参考。
- **重点学习**:
  - 星露谷式窗口系统（可拖拽、可最大化）
  - 自定义像素字体的引入方式（`@font-face` + `font/StardewValley.woff`）
  - 星露谷配色方案和 CSS 变量体系
  - 像素风光标（`cursor: url('img/coursor.png'), auto`）
  - 启动动画（zoom in + blur 过渡）
- **关键技术**: SASS 变量体系、窗口管理 JS、像素字体集成

---

## 🎨 二、像素风 & CSS 技术参考

### 4. pixel-art-react — 像素画 CSS 生成器
- **GitHub**: https://github.com/jvalen/pixel-art-react ⭐ 高
- **为什么参考**: RAIO 的 Agent 像素角色需要用 CSS box-shadow 技术绘制，这个项目是该技术的最佳实践。
- **重点学习**:
  - box-shadow + keyframes 组合实现像素动画
  - 颜色矩阵 → CSS box-shadow 字符串的转换算法
  - 导出为 CSS class 的方式（RAIO 的每套装扮可以是一个 CSS class）
- **在线体验**: https://www.pixelartcss.com/

### 5. box-shadow-sprite — CSS 像素角色 sprite 动画
- **GitHub**: https://github.com/jvalen/box-shadow-sprite
- **为什么参考**: 展示了如何用纯 CSS box-shadow 创建可控制的角色 sprite（多帧动画+键盘控制）
- **重点学习**:
  - 多帧像素角色的 CSS class 切换逻辑
  - idle/walk/action 动画帧的组织方式
  - 直接可用于 RAIO 的 Agent idle 动画

### 6. Pixelact UI — 像素风 React 组件库 (基于 shadcn)
- **GitHub**: https://github.com/pixelact-ui/pixelact-ui
- **为什么参考**: 基于 shadcn/ui 的像素风组件库，Button/Card/Input 等组件都有像素样式。RAIO 可以直接参考其像素边框、按钮的 CSS 实现。
- **重点学习**:
  - CSS 变量定义像素主题色
  - Tailwind + 像素风的结合方式
  - 像素风表单控件样式

### 7. CSS Pixel Art 技术教程
- **Pixelator 在线工具**: https://elrumordelaluz.github.io/Pixelator/
  - 可视化绘制像素画，自动生成 CSS box-shadow 代码
  - 用来快速制作 RAIO 的 Agent 基础形象
- **技术原理文章**: https://fjolt.com/article/css-pixel-art-generator/
  - 详细讲解 box-shadow pixel art 的缩放和渲染原理
- **PixelArtUI React 库**: https://medium.com/@yazed.jamal/create-pixel-art-using-pixelartui-f429a72af451
  - `pixelartui-react` npm 包，提供 `<Pixelator>` 组件 + `cssToPixelator()` 工具函数

---

## 🤖 三、AI Agent 架构参考

### 8. AutoResearchClaw — 全自动科研 Agent
- **GitHub**: https://github.com/aiming-lab/AutoResearchClaw
- **为什么参考**: "Chat an Idea, Get a Paper" 的全自动科研流程，多源搜索（OpenAlex → Semantic Scholar → arXiv）。
- **重点学习**:
  - 多源论文搜索策略（先 OpenAlex，回退到 Semantic Scholar，再到 arXiv）
  - 实验计划生成 + 硬件感知的代码生成
  - 从 idea 到 paper 的完整 Agent pipeline

### 9. Tongyi DeepResearch — 阿里通义深度研究 Agent
- **GitHub**: https://github.com/Alibaba-NLP/DeepResearch
- **为什么参考**: SOTA 级的深度搜索 Agent，ReAct + IterResearch 双范式。
- **重点学习**:
  - ReAct 推理框架（搜索 + 推理交替进行）
  - 长时间信息搜索任务的 Agent 架构
  - 多步搜索的查询优化策略

### 10. redis-arXiv-search — arXiv 语义搜索 Demo
- **GitHub**: https://github.com/redis-developer/redis-arXiv-search
- **为什么参考**: React + TypeScript 的 arXiv 论文搜索 SPA，技术栈和 RAIO 高度一致。
- **重点学习**:
  - arXiv 数据集的处理方式
  - FastAPI + React SPA 的前后端结构
  - 论文搜索结果的 UI 展示模式

---

## 🎮 四、游戏化 & 生产力工具参考

### 11. 桃源乡 — 文字版星露谷 (Vue3 + 像素 + 中国风)
- **GitHub Topic**: https://github.com/topics/pixel-art?l=typescript (搜索"桃源乡")
- **为什么参考**: Vue3 + Tailwind + 像素风 + 中国风的田园模拟经营游戏，和 RAIO 的"像素花园"概念相似。

### 12. 游戏化生产力工具合集
- **GitHub Topic**: https://github.com/topics/gamified-productivity
- **关键项目**:
  - Quest Journal — 把目标变成 RPG 任务，XP/等级/故事驱动
  - GamifyRoutine — 习惯追踪 + XP + 每日随机奖励 + Discord Webhook
- **设计启发**: 如何让积分系统不沦为"打卡式焦虑"，而是真正有正向激励

---

## 🔧 五、技术工具 & 资源

### 字体
- **Press Start 2P** (像素标题字体): https://fonts.google.com/specimen/Press+Start+2P
- **Noto Sans SC** (中文正文): https://fonts.google.com/noto/specimen/Noto+Sans+SC
- **JetBrains Mono** (代码): https://fonts.google.com/specimen/JetBrains+Mono

### arXiv API
- **官方文档**: https://info.arxiv.org/help/api/index.html
- **搜索端点**: `http://export.arxiv.org/api/query?search_query=all:{query}&max_results=10`
- **返回格式**: Atom XML，需要解析 `<entry>` 中的 title, summary, author, published, link

### CSS Pixel Art 在线工具
- **pixelartcss.com** — 绘制像素画 → 导出 CSS box-shadow
- **Pixelator** — https://elrumordelaluz.github.io/Pixelator/

### React 可用库 (RAIO artifact 环境内)
- `recharts` — 数据可视化（花园统计、学习进度图）
- `lucide-react` — 图标库
- `lodash` — 工具函数
- `shadcn/ui` — 基础组件（可叠加像素风 CSS）

---

## 📐 六、架构速查

### PaperCircle 的多 Agent 流水线（RAIO Paper Agent 可直接参考）
```
用户查询
  ↓
Query Agent (意图理解、查询改写)
  ↓
Search Agent (多源检索: arXiv / Scopus / IEEE)
  ↓
Sorting Agent (BM25 + TF-IDF 混合排序, 去重)
  ↓
Analysis Agent (论文摘要分析、知识图谱提取)
  ↓
Export Agent (格式化输出: JSON/CSV/BibTeX/Markdown)
  ↓
Tracker (状态管理、持久化)
```

### Habitica 的角色装备数据结构
```javascript
// 简化版，RAIO 可参考
{
  character: "bookworm",
  stats: { level: 5, xp: 250, stars: 1250 },
  equipment: {
    hat: { key: "graduation_cap", unlocked: true },
    outfit: { key: "academic_robe", unlocked: true },
    heldItem: { key: "book", unlocked: true }
  },
  unlockedOutfits: ["graduation_cap", "ancient_robe", "lab_coat"],
  achievements: [
    { id: "first_paper", name: "第一篇论文", unlockedAt: "2026-05-20" }
  ]
}
```

---

## 💡 七、给 Agent 的实施建议

1. **Paper Agent 架构**: 参考 PaperCircle 的多 Agent 流水线，但简化为单次 Claude API 调用（query 拆解 + 结果排序合并为一个 prompt），arXiv API 并行搜索用 `Promise.all`。

2. **像素角色绘制**: 不要用图片文件！用 CSS box-shadow 或 SVG path。参考 pixel-art-react 的方案，把每个 Agent 的每套装扮定义为一个颜色矩阵数组，运行时生成 box-shadow CSS。

3. **换装系统**: 参考 Habitica 的装备数据结构，用 `window.storage` 持久化。UI 参考 Habitica 的装备选择面板。

4. **星露谷 UI 风格**: 参考 StardewOS 的配色和边框系统。关键是 **双层像素边框** + **暖色调背景** + **Press Start 2P 像素字体**（仅标题）。

5. **游戏化积分**: 参考 Habitica 的 XP/Gold 双币制，RAIO 简化为单币制（星星）。关键是获得星星时的 **即时视觉反馈**（飘字动画 + 音效感）。
