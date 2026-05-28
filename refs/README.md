# 🧬 RAIO Project Planning — 项目规划文件夹

> 本文件夹包含 RAIO (Research All-in-One) 科研助手的全部规划文档、参考资源和技术素材。
> **Agent 开发时请按顺序阅读。**

---

## 📁 文件夹结构

```
RAIO-project-planning/
│
├── 📋 README.md              ← 你正在看的文件 (阅读顺序指南)
├── 📋 RAIO_Project_Prompt.md  ← ⭐ 主 Prompt (产品设计+功能详解)
│
├── references/                ← 参考项目和外部资源
│   └── REFERENCE_PROJECTS.md  ← 10+ 个 GitHub 高星项目分析
│
├── architecture/              ← 技术架构和实现方案
│   └── TECH_ARCHITECTURE.md   ← 文件结构、数据流、API 调用、CSS 系统
│
└── assets/                    ← 素材定义 (像素角色、配色)
    └── PIXEL_CHARACTERS.md    ← 5 个 Agent 角色的像素绘制规范
```

---

## 📖 推荐阅读顺序

### Step 1: 理解产品 (10 分钟)
1. **`RAIO_Project_Prompt.md`** — 从头到尾读一遍，理解产品哲学、功能设计、星露谷美学方向

### Step 2: 了解参考 (5 分钟) 
2. **`references/REFERENCE_PROJECTS.md`** — 重点看:
   - **Habitica** (游戏化+换装系统参考)
   - **PaperCircle** (论文搜索 Agent 架构参考)  
   - **StardewOS** (星露谷 UI 风格参考)
   - **pixel-art-react** (CSS box-shadow 像素绘制技术参考)

### Step 3: 掌握技术方案 (5 分钟)
3. **`architecture/TECH_ARCHITECTURE.md`** — 看清:
   - 单文件 React 组件结构
   - arXiv API 调用方式
   - Claude API 封装
   - 像素角色渲染引擎
   - 星星积分系统
   - 像素边框 CSS 系统

### Step 4: 角色素材 (5 分钟)
4. **`assets/PIXEL_CHARACTERS.md`** — 了解:
   - 5 个角色的视觉描述和色板
   - 装扮变体的颜色方案
   - 动画帧定义
   - 图层叠加逻辑

### Step 5: 开始编码 🚀
按照 `RAIO_Project_Prompt.md` 中 **第 6 节 "实现优先级"** 的 P0/P1/P2 顺序开发。

---

## ⚡ 快速参考 — 关键技术决策

| 决策点 | 方案 | 原因 |
|--------|------|------|
| 像素角色绘制 | CSS box-shadow | 不依赖图片文件，可在 React Artifact 内运行 |
| 数据持久化 | window.storage | Artifact 跨 session 唯一可用方案 |
| Agent 大脑 | Anthropic API (Sonnet 4) | 环境内可直接调用，无需 API key |
| 论文搜索 | arXiv API (Atom XML) | 公开免费，无需认证，CORS 友好 |
| 状态管理 | React useState + useReducer | 单文件不能用 Zustand，用原生 Hook |
| 样式方案 | Tailwind 工具类 + 内联 CSS 变量 | Artifact 环境支持 Tailwind core |
| 像素字体 | Google Fonts "Press Start 2P" | CDN 加载，免费像素字体 |
| 图标 | lucide-react | Artifact 环境已内置 |

---

## 🎯 核心目标提醒

> **这个产品的成功标准不是"功能完整"，而是"打开的第一秒就让人想用"。**
>
> 宁可只做 3 个功能但每个都精致到位，也不要 5 个功能全是半成品。
> 
> 像素 Agent 朝你挥手 + 星星飘字动画 + 一次成功的论文搜索 = 已经赢了。
