# RAIO2 成长之路改造方案

> 技术实现方案 · 2026-07-11

---

## 一、需求概述

| 项目 | 现状 | 目标 |
|------|------|------|
| 名称 | 大师之路 | 成长之路 |
| 内容形态 | 纯文本大纲（JSON chapters） | 文本大纲 + 思维导图（总览 + 分章） |
| 模型策略 | 仅文本模型（一次 LLM 调用） | 文本模型（生成内容 + 导图数据结构）+ 文生图模型（生成导图图片） |
| 可下载 | 无 | MD 文本可下载 · 导图 PNG 可下载 |

---

## 二、总体架构

```
用户输入主题 "Transformer"
          │
          ▼
┌─────────────────────────────────────────────┐
│           POST /api/learn/generate           │
│                                              │
│  Step 1: 文本模型 (deepseek-v4-flash)         │
│    生成: { chapters, mindmap_tree, mindmap_md }│
│                                              │
│  Step 2: 图片模型 (ImageGen)  ← 异步可选       │
│    传入 mindmap_md → 生成导图图片 → 存本地     │
│                                              │
│  Step 3: 全部存入 SQLite                      │
│    outline + mindmap_json + mindmap_md        │
│    + mindmap_image_path                       │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│                 前端渲染                       │
│                                               │
│  思维导图区: markmap-view 渲染 (交互式)         │
│  章节列表区: 原有卡片 (保留)                    │
│  下载按钮: [下载 MD 文本] [下载导图 PNG]        │
└──────────────────────────────────────────────┘
```

---

## 三、数据库迁移

在 `server/db.js` 的 `learn_courses` 表创建后追加 ALTER：

```sql
-- 新增字段（向后兼容，已有数据默认 NULL）
ALTER TABLE learn_courses ADD COLUMN mindmap_json TEXT;
ALTER TABLE learn_courses ADD COLUMN mindmap_md TEXT;
ALTER TABLE learn_courses ADD COLUMN mindmap_image TEXT;
```

在 `server/db.js` 的 `createTables()` 末尾追加 migration 逻辑：

```javascript
// 在 createTables() 末尾
try { db.run("ALTER TABLE learn_courses ADD COLUMN mindmap_json TEXT"); } catch(e) {}
try { db.run("ALTER TABLE learn_courses ADD COLUMN mindmap_md TEXT"); } catch(e) {}
try { db.run("ALTER TABLE learn_courses ADD COLUMN mindmap_image TEXT"); } catch(e) {}
```

---

## 四、后端改造

### 4.1 修改 POST /api/learn/generate

**现有流程**：LLM 生成 outline JSON → 存库 → 返回

**新流程**：

```javascript
// server/index.js  -  修改 /api/learn/generate

app.post('/api/learn/generate', authMiddleware, async (req, res) => {
  const { topic } = req.body;
  // ... 现有验证不变 ...

  // ===== Step 1: 文本模型 — 生成大纲 + 思维导图结构 =====
  const outlinePrompt = `请为「${topic}」生成一个学习路径。
严格按以下JSON返回：
{
  "chapters": [...],           // 保留原有格式
  "mindmap_tree": {            // 新增：思维导图树结构
    "name": "${topic}",
    "children": [
      {
        "name": "章节1标题",
        "children": [
          { "name": "知识点1" },
          { "name": "知识点2" }
        ]
      }
    ]
  },
  "mindmap_md": "# ${topic}\\n\\n## 章节1\\n- 知识点1\\n- 知识点2\\n\\n## 章节2\\n- ..."
}`;
  
  const result = await chatComplete(outlinePrompt, [], { agent: 'scholar', ...aiConfig });
  const parsed = JSON.parse(result.match(/\{[\s\S]*\}/)[0]);
  
  // 存库（新增 mindmap 字段）
  run(`INSERT INTO learn_courses (user_id, topic, outline, mindmap_json, mindmap_md)
       VALUES (?, ?, ?, ?, ?)`,
    [userId, topic, JSON.stringify(parsed),
     JSON.stringify(parsed.mindmap_tree || {}),
     parsed.mindmap_md || '']);
  
  // ===== Step 2: 图片模型 — 生成导图图片 (fire-and-forget) =====
  const courseId = getOne('SELECT id FROM learn_courses WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]).id;
  
  // 异步发起，不阻塞响应
  generateMindmapImage(courseId, parsed.mindmap_md || buildMdFromChapters(parsed.chapters), userId);
  
  // ... 返回 course 对象（含 mindmap 字段）...
});
```

### 4.2 新增：思维导图图片生成函数

在 `server/index.js` 或单独的 `server/mindmap.js` 中：

```javascript
// server/mindmap.js

/**
 * 异步生成思维导图图片
 * 使用 ImageGen 工具生成，结果存入 mindmap_image 字段
 */
async function generateMindmapImage(courseId, mindmapMd, userId) {
  const imagePrompt = `A clean professional mind map diagram showing a structured learning path.
Use a tree layout with a central topic and branching subtopics.
Style: minimal, flat design, soft indigo and amber accent colors on white background,
clean typography, professional academic look.
Title at the center, connected branches forming a knowledge tree.

Content:
${mindmapMd.slice(0, 1000)}`;

  try {
    // 调用 ImageGen（具体 API 取决于你们接入的图片生成服务）
    const imageResult = await callImageGenAPI(imagePrompt);
    
    // 存为本地文件
    const imagePath = path.join(__dirname, '..', 'data', `mindmap_${courseId}_${Date.now()}.png`);
    fs.writeFileSync(imagePath, imageResult);
    
    // 更新数据库
    run('UPDATE learn_courses SET mindmap_image = ? WHERE id = ?',
      [imagePath, courseId]);
    
    console.log(`[MindMap] 图片已生成: ${imagePath}`);
  } catch (e) {
    console.error(`[MindMap] 图片生成失败 (课程 ${courseId}):`, e.message);
    // 不设置 mindmap_image，前端降级到交互导图
  }
}
```

### 4.3 新增：章节子导图生成端点

```javascript
// POST /api/learn/mindmap-chapter
app.post('/api/learn/mindmap-chapter', authMiddleware, async (req, res) => {
  const { courseId, chapterIdx } = req.body;
  const aiConfig = getAIRequestConfig(req);
  if (aiConfig.error) return res.status(400).json({ error: aiConfig.error });

  const course = getOne(
    'SELECT outline, mindmap_json FROM learn_courses WHERE id = ? AND user_id = ?',
    [courseId, req.user.userId]
  );
  if (!course) return res.status(404).json({ error: '课程不存在' });

  const outline = JSON.parse(course.outline);
  const chapter = outline.chapters?.[chapterIdx];
  if (!chapter) return res.status(404).json({ error: '章节不存在' });

  // 从缓存读取
  const fullMindmap = JSON.parse(course.mindmap_json || '{}');
  const cached = fullMindmap.children?.[chapterIdx];
  if (cached) {
    return res.json({ mindmap_tree: cached, fromCache: true });
  }

  // 未缓存则用 LLM 生成子导图
  const prompt = `为以下章节生成一个详细的知识点思维导图，以JSON树结构返回：
{
  "name": "章节标题",
  "children": [
    { "name": "子主题", "children": [{ "name": "具体知识点" }] }
  ]
}
章节：${chapter.title}
知识点：${(chapter.points || []).join('、')}
生成4-6个第二层节点，每个2-3个第三层节点。`;

  const result = await chatComplete(prompt, [], { agent: 'scholar', ...aiConfig });
  const chapterTree = JSON.parse(result.match(/\{[\s\S]*\}/)[0]);

  // 缓存到 mindmap_json 对应位置
  if (!fullMindmap.children) fullMindmap.children = [];
  fullMindmap.children[chapterIdx] = chapterTree;
  run('UPDATE learn_courses SET mindmap_json = ? WHERE id = ?',
    [JSON.stringify(fullMindmap), courseId]);

  res.json({ mindmap_tree: chapterTree, fromCache: false });
});
```

### 4.4 下载端点

```javascript
// GET /api/learn/:id/download-md
app.get('/api/learn/:id/download-md', authMiddleware, (req, res) => {
  const course = getOne(
    'SELECT topic, outline, mindmap_md FROM learn_courses WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.userId]
  );
  if (!course) return res.status(404).json({ error: '课程不存在' });

  const md = course.mindmap_md || buildMdFromChapters(JSON.parse(course.outline).chapters);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="${encodeURIComponent(course.topic)}_学习路径.md"`);
  res.send(md);
});

// GET /api/learn/:id/download-mindmap
app.get('/api/learn/:id/download-mindmap', authMiddleware, (req, res) => {
  const course = getOne(
    'SELECT mindmap_image, topic FROM learn_courses WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.userId]
  );
  if (!course?.mindmap_image || !fs.existsSync(course.mindmap_image)) {
    return res.status(404).json({ error: '导图图片未生成，请稍后再试' });
  }
  res.download(course.mindmap_image,
    `${encodeURIComponent(course.topic)}_思维导图.png`);
});
```

### 4.5 修改 GET /api/learn/courses

在现有查询后附加 mindmap 字段：

```javascript
// GET /api/learn/courses 
// 在 for (const c of courses) 循环中添加：
c.mindmap_json = safeParse(c.mindmap_json, {});
c.mindmap_md = c.mindmap_md || '';
c.has_mindmap_image = !!(c.mindmap_image && fs.existsSync(c.mindmap_image));
c.mindmap_image_url = c.has_mindmap_image 
  ? `/api/learn/${c.id}/download-mindmap` 
  : null;
```

---

## 五、前端改造

### 5.1 安装依赖

```bash
npm install markmap-lib markmap-view html-to-image
```

### 5.2 新增组件：MindMapViewer.jsx

```jsx
// src/components/MindMapViewer.jsx

import React, { useEffect, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { toPng } from 'html-to-image';

const transformer = new Transformer();

export default function MindMapViewer({ markdown, title, onImageReady }) {
  const svgRef = useRef(null);
  const mmRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!markdown || !svgRef.current) return;

    try {
      // 清理旧实例
      if (mmRef.current) {
        svgRef.current.innerHTML = '';
      }

      // 转换 Markdown → mindmap 数据
      const { root, features } = transformer.transform(markdown);

      // 渲染
      mmRef.current = Markmap.create(svgRef.current, {
        autoFit: true,
        colorFreezeLevel: 2,
        duration: 300,
        maxWidth: 260,
        paddingX: 12,
      }, root);

      setError('');
    } catch (e) {
      setError('思维导图渲染失败');
      console.error(e);
    }

    return () => {
      if (mmRef.current) mmRef.current.destroy();
    };
  }, [markdown]);

  // 导出为 PNG
  async function handleExportPng() {
    if (!svgRef.current) return;
    try {
      const dataUrl = await toPng(svgRef.current, { backgroundColor: '#ffffff' });
      onImageReady?.(dataUrl);
      return dataUrl;
    } catch (e) {
      console.error('导出PNG失败:', e);
    }
  }

  return (
    <div className="mindmap-container">
      {error && <p className="mindmap-error">{error}</p>}
      <svg ref={svgRef} className="mindmap-svg" style={{ width: '100%', minHeight: 360 }} />
    </div>
  );
}
```

### 5.3 修改 LearnPage.jsx

关键改动点：

```jsx
// 在页面顶部引入
import MindMapViewer from '../components/MindMapViewer';
import { downloadMd, downloadMindmapImage } from '../api';

// 新增 state
const [mindmapTab, setMindmapTab] = useState('overview'); // 'overview' | 'chapter'
const [activeChapterMindmap, setActiveChapterMindmap] = useState(null);
const [chapterMindmapCache, setChapterMindmapCache] = useState({});

// 标题改为 "成长之路"
<h2>🌱 成长之路</h2>

// 课程卡片内新增思维导图区域
{isActive && (
  <>
    {/* Tab 切换: 大纲 | 思维导图 */}
    <div className="mindmap-tabs mb-3">
      <button onClick={() => setMindmapTab('outline')}>📋 大纲</button>
      <button onClick={() => setMindmapTab('mindmap')}>🧠 思维导图</button>
    </div>

    {mindmapTab === 'outline' && (
      /* 原有的章节列表 */
    )}

    {mindmapTab === 'mindmap' && (
      <div className="mindmap-section">
        <MindMapViewer markdown={course.mindmap_md || buildMdFromOutline(course.outline)} />
        <div className="flex gap-2 mt-3">
          <DownloadButton onClick={() => downloadMd(token, course.id)}>
            📥 下载学习大纲 (MD)
          </DownloadButton>
          <DownloadButton onClick={() => downloadMindmapImage(token, course.id)}>
            🖼️ 下载思维导图 (PNG)
          </DownloadButton>
        </div>
      </div>
    )}
  </>
)}

// 章节详情面板新增子导图入口
{nodePanel && (
  <div className="skill-drawer ...">
    {/* 原有章节信息 */}
    
    {/* 新增：子思维导图 */}
    <div className="mb-5">
      <h4>🧠 章节知识导图</h4>
      {chapterMindmapCache[nodePanel.chapterIdx] ? (
        <MindMapViewer markdown={chapterMindmapToMd(chapterMindmapCache[nodePanel.chapterIdx])} />
      ) : (
        <button onClick={async () => {
          const data = await fetchChapterMindmap(token, activeCourse.id, nodePanel.chapterIdx);
          setChapterMindmapCache(prev => ({ ...prev, [nodePanel.chapterIdx]: data.mindmap_tree }));
        }}>
          生成章节导图
        </button>
      )}
    </div>
  </div>
)}
```

### 5.4 新增 API 函数（src/api/index.js）

```javascript
// 下载学习大纲 MD
export async function downloadMd(token, courseId) {
  window.open(`/api/learn/${courseId}/download-md`, '_blank');
}

// 下载思维导图 PNG
export async function downloadMindmapImage(token, courseId) {
  window.open(`/api/learn/${courseId}/download-mindmap`, '_blank');
}

// 获取章节子导图
export async function fetchChapterMindmap(token, courseId, chapterIdx) {
  const res = await fetch('/api/learn/mindmap-chapter', {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify({ courseId, chapterIdx }),
  });
  return readJson(res, '获取章节导图失败');
}
```

---

## 六、双模型调用策略

### 6.1 文本模型（主力）

| 用途 | 模型 | 调用时机 |
|------|------|---------|
| 生成学习大纲 | deepseek-v4-flash（现有） | POST /api/learn/generate |
| 生成总览导图结构 | 同上（同一个 prompt）| 同上 |
| 生成章节子导图 | 同上 | POST /api/learn/mindmap-chapter |

**Prompt 设计要点**：
- 大纲和导图 data 在同一个 prompt 中产出，一次调用减少延迟
- `mindmap_json` 是标准树结构 `{ name, children }`
- `mindmap_md` 是 Markdown 列表格式，`markmap-lib` 直接消费

### 6.2 图片模型（增强视觉）

| 用途 | 实现方式 | 调用时机 |
|------|---------|---------|
| 生成导图海报图片 | ImageGen API | 生成大纲完成后异步发起 |
| 章节导图图片 | ImageGen API（可选，量少时 LLM 生成 Markdown 更可靠）| 用户主动点击时 |

**ImageGen 调用要点**：
- `fire-and-forget` 模式：不阻塞用户响应
- 生成成功后更新 `mindmap_image` 字段
- 如果生成失败，前端降级到交互式 markmap 渲染（用户无感知）
- 对于章节子导图：**不推荐用 ImageGen**（文本模型直接生成 MD 更可靠）。图片模型只在总览导图做"海报效果"

**ImageGen 降级方案**：
- 如果 ImageGen 不可用/成本过高 → 完全依赖客户端 markmap 渲染
- `html-to-image` 可以把 markmap 渲染结果导出为 PNG → 作为下载图片的 fallback

---

## 七、工程清单

### 7.1 数据库
- [x] `learn_courses` 表新增 `mindmap_json`、`mindmap_md`、`mindmap_image` 三个 TEXT 列

### 7.2 后端
| 文件 | 改动 |
|------|------|
| `server/db.js` | `createTables()` 末尾追加 ALTER migration |
| `server/index.js` | 修改 `/api/learn/generate` — 产出 mindmap 结构；新增 `/api/learn/mindmap-chapter` 端点；新增 `/api/learn/:id/download-md` 和 `/download-mindmap` 端点；修改 `/api/learn/courses` 附加 mindmap 字段 |
| `server/mindmap.js` | 新建，含 `generateMindmapImage()` 和 `buildMdFromChapters()` |

### 7.3 前端
| 文件 | 改动 |
|------|------|
| `src/components/MindMapViewer.jsx` | 新建，markmap 渲染 + PNG 导出 |
| `src/pages/LearnPage.jsx` | 改名；增思维导图 Tab；增章节子导图入口；增下载按钮 |
| `src/api/index.js` | 新增 `downloadMd`、`downloadMindmapImage`、`fetchChapterMindmap` |

### 7.4 依赖
```bash
npm install markmap-lib markmap-view html-to-image
```

---

## 八、数据流完整路径图

```
用户打开"成长之路"页面
        │
        ├── GET /api/learn/courses → 返回课程列表 (含 mindmap_md, has_mindmap_image)
        │
        ├── 点击课程 → 展开详情
        │       │
        │       ├── Tab: 大纲 → 原有章节列表 (不变)
        │       │
        │       └── Tab: 思维导图
        │               │
        │               ├── 总览导图: <MindMapViewer markdown={course.mindmap_md} />
        │               │       └── 交互: 缩放/拖拽/折叠
        │               │
        │               ├── 下载 MD: GET /api/learn/:id/download-md
        │               │       └── 浏览器下载 .md 文件
        │               │
        │               └── 下载 PNG:
        │                       ├── 优先: GET /api/learn/:id/download-mindmap
        │                       │          └── 返回 ImageGen 生成的图片
        │                       └── 降级: 前端 html-to-image 导出 markmap SVG
        │                                  └── 浏览器下载 .png
        │
        ├── 点击章节 → 右侧抽屉
        │       │
        │       ├── 原有: 知识点、资源链接、测验
        │       │
        │       └── 新增: "章节导图" 
        │               └── POST /api/learn/mindmap-chapter
        │                       └── 首次: LLM 生成子导图 → 缓存 → 渲染
        │                       └── 二次: 读缓存直接渲染
        │
        └── 空状态 → "输入主题，AI 将为你生成包含思维导图的学习计划"
```

---

## 九、注意事项

1. **markmap 中文渲染**：markmap 对中文支持良好，但需在 CSS 中设置 `font-family: "PingFang SC", "Microsoft YaHei", sans-serif`
2. **大导图性能**：如果章节超过 20 个，总览导图节点会很多，markmap 的 `autoFit` 会自动缩放。建议限制 LLM 生成导图深度 ≤ 4 层
3. **ImageGen 异步**：用 `fire-and-forget` 模式，不阻塞 HTTP 响应。用户可以在图片未生成时正常使用前端交互导图
4. **缓存优先级**：子导图一旦生成就缓存到 `mindmap_json` 的 `children[index]` 中，二次访问零延迟
5. **向后兼容**：旧课程 `mindmap_md` 为 NULL → 前端用 `buildMdFromOutline(outline.chapters)` 兜底生成
