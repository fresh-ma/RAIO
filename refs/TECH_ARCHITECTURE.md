# 🏗️ RAIO 技术架构文档

## 1. 文件结构规划

```
RAIO.jsx (单文件 React Artifact)
├── // ===== 全局配置 =====
│   ├── THEME — 配色、字体、CSS 变量
│   ├── STAR_REWARDS — 星星奖励规则表
│   └── AGENT_CHARACTERS — 5个 Agent 角色定义 + 装扮数据
│
├── // ===== 像素绘制引擎 =====
│   ├── PixelAgent 组件 — 通用像素角色渲染器
│   ├── PIXEL_DATA — 角色/装扮的颜色矩阵数据
│   └── usePixelAnimation — idle/talking/celebrating 动画 hook
│
├── // ===== 核心 Hooks =====
│   ├── useStorage — window.storage 封装 (get/set/list)
│   ├── useStars — 星星积分管理 (add/deduct/getTotal)
│   ├── useWardrobe — 换装状态管理
│   └── useClaudeAPI — Anthropic API 调用封装
│
├── // ===== 页面组件 =====
│   ├── HomePage — 首页 (猫头鹰 + 状态卡片 + 对话)
│   ├── PaperAgent — 论文搜索/收藏/问答
│   ├── ServerAgent — 服务器状态解析/可视化
│   ├── LearningAgent — 学习路径/测验
│   ├── LifeAgent — Todo/日历/花园/情绪
│   └── WardrobePanel — 换装面板 (overlay)
│
├── // ===== 共享 UI 组件 =====
│   ├── PixelBorder — 像素边框容器
│   ├── DialogBox — 星露谷对话框
│   ├── PixelButton — 像素按钮
│   ├── StarCounter — 顶栏星星显示 + 飘字动画
│   ├── NavBar — 左侧导航
│   └── HUD — 顶部状态栏
│
└── // ===== App 主组件 =====
    └── App — 路由切换 + 全局状态 Provider
```

## 2. 关键数据流

### 2.1 arXiv 论文搜索流程
```
用户输入 "如何用 LLM 做代码生成"
        ↓
[Claude API] 查询拆解 → 3-5 个子查询
        ↓
[Promise.all] 并行调用 arXiv API (/api/query)
        ↓
XML 响应解析 → 提取 title, authors, abstract, id, published
        ↓
去重 (按 arXiv ID)
        ↓
[Claude API] 相关性打分 (batch: 所有 title+abstract → 1-10 分)
        ↓
排序 + 生成领域地图总结
        ↓
渲染结果 → 用户可收藏 → window.storage 持久化
```

### 2.2 arXiv API 调用示例
```javascript
const searchArxiv = async (query, maxResults = 10) => {
  const url = `https://export.arxiv.org/api/query?` +
    `search_query=all:${encodeURIComponent(query)}` +
    `&start=0&max_results=${maxResults}` +
    `&sortBy=relevance&sortOrder=descending`;
  
  const response = await fetch(url);
  const text = await response.text();
  
  // 解析 Atom XML
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'text/xml');
  const entries = xml.querySelectorAll('entry');
  
  return Array.from(entries).map(entry => ({
    id: entry.querySelector('id')?.textContent?.split('/abs/')[1],
    title: entry.querySelector('title')?.textContent?.trim(),
    summary: entry.querySelector('summary')?.textContent?.trim(),
    authors: Array.from(entry.querySelectorAll('author name')).map(a => a.textContent),
    published: entry.querySelector('published')?.textContent,
    link: entry.querySelector('id')?.textContent,
  }));
};
```

### 2.3 Claude API 调用封装
```javascript
const callClaude = async (systemPrompt, userMessage) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await response.json();
  return data.content?.[0]?.text || "";
};
```

## 3. 像素角色技术方案

### 3.1 CSS box-shadow 像素渲染
```javascript
// 颜色矩阵 → CSS box-shadow 字符串
const matrixToBoxShadow = (matrix, pixelSize = 3) => {
  const shadows = [];
  matrix.forEach((row, y) => {
    row.forEach((color, x) => {
      if (color) {
        shadows.push(
          `${(x + 1) * pixelSize}px ${(y + 1) * pixelSize}px 0 0 ${color}`
        );
      }
    });
  });
  return shadows.join(', ');
};

// React 组件
const PixelSprite = ({ matrix, pixelSize = 3, animation = 'idle' }) => {
  const boxShadow = useMemo(() => matrixToBoxShadow(matrix, pixelSize), [matrix, pixelSize]);
  const width = matrix[0].length * pixelSize;
  const height = matrix.length * pixelSize;
  
  return (
    <div 
      className={`pixel-sprite pixel-${animation}`}
      style={{
        width: `${pixelSize}px`,
        height: `${pixelSize}px`,
        boxShadow,
        overflow: 'hidden',
        // 容器需要额外空间
        margin: `0 ${width}px ${height}px 0`,
      }}
    />
  );
};
```

### 3.2 装扮图层叠加
```javascript
// 多图层合并: body (底层) → outfit → hat → heldItem (顶层)
const mergeLayers = (layers) => {
  const base = layers[0].map(row => [...row]); // deep copy base
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    for (let y = 0; y < layer.length; y++) {
      for (let x = 0; x < layer[y].length; x++) {
        if (layer[y][x]) { // 非 null 就覆盖
          base[y][x] = layer[y][x];
        }
      }
    }
  }
  return base;
};
```

### 3.3 动画 CSS
```css
@keyframes pixel-idle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

@keyframes pixel-talking {
  0%, 100% { transform: translateY(0); }
  25% { transform: translateY(-1px); }
  75% { transform: translateY(1px); }
}

@keyframes pixel-celebrating {
  0% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-4px) rotate(-5deg); }
  50% { transform: translateY(-8px) rotate(0deg); }
  75% { transform: translateY(-4px) rotate(5deg); }
  100% { transform: translateY(0) rotate(0deg); }
}

.pixel-idle { animation: pixel-idle 2s ease-in-out infinite; }
.pixel-talking { animation: pixel-talking 0.4s ease-in-out infinite; }
.pixel-celebrating { animation: pixel-celebrating 0.6s ease-in-out 3; }
```

## 4. window.storage 封装

```javascript
const useStorage = () => {
  const get = async (key) => {
    try {
      const result = await window.storage.get(key);
      return result ? JSON.parse(result.value) : null;
    } catch { return null; }
  };
  
  const set = async (key, value) => {
    try {
      return await window.storage.set(key, JSON.stringify(value));
    } catch (e) { console.error('Storage error:', e); return null; }
  };
  
  const remove = async (key) => {
    try { return await window.storage.delete(key); }
    catch { return null; }
  };
  
  return { get, set, remove };
};
```

## 5. 星星系统逻辑

```javascript
const useStars = () => {
  const storage = useStorage();
  const [stars, setStars] = useState(0);
  const [flyAnimation, setFlyAnimation] = useState(null); // { amount, x, y }
  
  useEffect(() => {
    storage.get('game:stars').then(data => {
      if (data) setStars(data.total || 0);
    });
  }, []);
  
  const addStars = async (amount, reason) => {
    const newTotal = stars + amount;
    setStars(newTotal);
    setFlyAnimation({ amount, key: Date.now() }); // 触发飘字
    setTimeout(() => setFlyAnimation(null), 1500);
    
    const history = (await storage.get('game:stars'))?.history || [];
    history.push({ amount, reason, date: new Date().toISOString() });
    await storage.set('game:stars', { total: newTotal, history });
  };
  
  return { stars, addStars, flyAnimation };
};
```

## 6. 像素边框 CSS 系统

```css
/* 星露谷式三层边框 */
.pixel-panel {
  background: var(--bg-card);
  border: 3px solid var(--border-pixel);
  box-shadow:
    inset 2px 2px 0 rgba(255,255,255,0.08),
    inset -2px -2px 0 rgba(0,0,0,0.15),
    3px 3px 0 rgba(0,0,0,0.4);
  border-radius: 2px;
  image-rendering: pixelated;
}

/* 对话框 (双层边框) */
.pixel-dialog {
  background: var(--bg-panel);
  border: 4px solid var(--border-light);
  outline: 3px solid var(--border-pixel);
  outline-offset: 2px;
  box-shadow: 4px 4px 0 rgba(0,0,0,0.4);
  padding: 16px 20px;
  position: relative;
}

/* 对话框小三角 */
.pixel-dialog::before {
  content: '';
  position: absolute;
  bottom: -12px;
  left: 20px;
  width: 0; height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 12px solid var(--border-light);
}

/* 按钮按下效果 */
.pixel-btn {
  font-family: "Press Start 2P", monospace;
  font-size: 10px;
  padding: 8px 16px;
  border: none;
  color: white;
  cursor: pointer;
  box-shadow:
    inset -3px -3px 0 rgba(0,0,0,0.25),
    3px 3px 0 rgba(0,0,0,0.35);
  transition: transform 0.05s, box-shadow 0.05s;
}
.pixel-btn:active {
  transform: translate(2px, 2px);
  box-shadow: inset -1px -1px 0 rgba(0,0,0,0.2);
}

/* 星星飘字动画 */
@keyframes star-fly {
  0% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-30px); }
}
.star-fly {
  animation: star-fly 1.2s ease-out forwards;
  color: var(--accent-gold);
  font-family: "Press Start 2P", monospace;
  font-size: 12px;
  pointer-events: none;
}
```
