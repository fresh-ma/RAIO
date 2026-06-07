import express from 'express';
import cors from 'cors';
import path from 'path';
import fsSync from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { initDB, getDB, query, run, getOne, saveDB, checkAchievement } from './db.js';
import { generateToken, authMiddleware } from './auth.js';
import { streamChat, chatComplete, detectAgent, resolveAgent, AGENTS } from './agents.js';
import { PORT } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

function getRequestApiKey(req) {
  const value = req.headers['x-maas-api-key'];
  return Array.isArray(value) ? value[0]?.trim() : value?.trim();
}

// 静态资源：星露谷素材
const stardewPath = path.join(__dirname, '..', 'Stardew valley');
app.use('/assets/stardew', express.static(stardewPath));

// 生产模式：serve 前端 build
app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));

// ============ 认证路由 ============

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (!/^[a-zA-Z0-9]{3,12}$/.test(username)) {
      return res.status(400).json({ error: '用户名需为3-12位字母数字' });
    }
    if (!/^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z\d]{8,15}$/.test(password)) {
      return res.status(400).json({ error: '密码需为8-15位字母+数字组合' });
    }
    
    const existing = getOne("SELECT id FROM users WHERE username = ?", [username]);
    if (existing) {
      return res.status(400).json({ error: '用户名已存在' });
    }
    
    const hash = await bcrypt.hash(password, 10);
    run("INSERT INTO users (username, password, display_id, avatar) VALUES (?, ?, ?, ?)",
      [username, hash, username, 'Alex']);
    
    const user = getOne("SELECT id, username FROM users WHERE username = ?", [username]);
    const token = generateToken(user.id, user.username);
    
    // 解锁"初来乍到"成就
    checkAchievement(user.id, 'first_login');
    
    res.json({ token, user: { id: user.id, username: user.username, avatar: 'Alex' } });
  } catch (e) {
    console.error('注册错误:', e);
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    const user = getOne("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) {
      return res.status(400).json({ error: '用户名或密码错误' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: '用户名或密码错误' });
    }
    
    const token = generateToken(user.id, user.username);
    checkAchievement(user.id, 'first_login');
    
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_id: user.display_id || user.username,
        avatar: user.avatar || 'Alex',
        location: user.location || '',
        email: user.email || '',
        gender: user.gender || 0,
      }
    });
  } catch (e) {
    console.error('登录错误:', e);
    res.status(500).json({ error: '登录失败' });
  }
});

// ============ 用户信息 ============

app.get('/api/user/profile', authMiddleware, (req, res) => {
  const user = getOne("SELECT id, username, display_id, avatar, location, email, gender FROM users WHERE id = ?", [req.user.userId]);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

app.put('/api/user/profile', authMiddleware, (req, res) => {
  const { display_id, avatar, location, email, gender } = req.body;
  run("UPDATE users SET display_id=?, avatar=?, location=?, email=?, gender=? WHERE id=?",
    [display_id, avatar, location, email, gender, req.user.userId]);
  res.json({ success: true });
});

// ============ 聊天路由（SSE 流式） ============

app.post('/api/chat/stream', authMiddleware, async (req, res) => {
  try {
    const { message, agent } = req.body;
    const userId = req.user.userId;
    const username = req.user.username;

    if (!message?.trim()) {
      return res.status(400).json({ error: '消息不能为空' });
    }

    const apiKey = getRequestApiKey(req);
    if (!apiKey) {
      return res.status(400).json({ error: '缺少用户 MaaS API Key，请重新登录并输入自己的 Key' });
    }
    
    const requestedAgent = agent && agent !== 'auto' ? agent : null;
    const detectedAgent = resolveAgent(requestedAgent, message);

    // 获取当前消息之前的历史，避免把本轮用户消息重复塞进模型上下文
    const history = query(
      "SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 20",
      [userId]
    ).reverse();

    // 保存用户消息
    run("INSERT INTO chat_history (user_id, role, content, agent) VALUES (?, ?, ?, ?)",
      [userId, 'user', message, requestedAgent || detectedAgent]);
    
    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    const context = { agent: requestedAgent || undefined, username, apiKey };
    const { response: llmResponse, agentKey, agentName, model } = await streamChat(message, history, context);
    
    // 发送 Agent 信息
    res.write(`data: ${JSON.stringify({ type: 'agent', agent: agentKey, name: agentName, model })}\n\n`);
    
    let fullContent = '';
    const reader = llmResponse.body.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              res.write(`data: [DONE]\n\n`);
              break;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                res.write(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (e) {
      console.error('SSE读取错误:', e.message);
    }
    
    // 保存AI回复
    if (fullContent) {
      run("INSERT INTO chat_history (user_id, role, content, agent) VALUES (?, ?, ?, ?)",
        [userId, 'assistant', fullContent, agentKey]);
      saveDB();
      
      // 检查聊天成就
      const chatCount = getOne("SELECT COUNT(*) as cnt FROM chat_history WHERE user_id = ? AND role = 'user'", [userId]);
      if (chatCount?.cnt >= 1) checkAchievement(userId, 'first_chat');
      if (chatCount?.cnt >= 10) checkAchievement(userId, 'chat_10');
    }
    
    res.end();
  } catch (e) {
    console.error('聊天流错误:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: '聊天服务错误' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
      res.end();
    }
  }
});

// 获取聊天历史
app.get('/api/chat/history', authMiddleware, (req, res) => {
  const history = query(
    "SELECT id, role, content, agent, created_at FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 50",
    [req.user.userId]
  ).reverse();
  res.json(history);
});

// ============ Todo 路由 ============

app.get('/api/todos', authMiddleware, (req, res) => {
  const todos = query("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId]);
  res.json(todos);
});

app.post('/api/todos', authMiddleware, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '待办内容不能为空' });
  
  run("INSERT INTO todos (user_id, content) VALUES (?, ?)", [req.user.userId, content]);
  
  // 检查成就
  checkAchievement(req.user.userId, 'first_todo');
  const todoCount = getOne("SELECT COUNT(*) as cnt FROM todos WHERE user_id = ?", [req.user.userId]);
  if (todoCount?.cnt >= 7) checkAchievement(req.user.userId, 'todo_7');
  
  const todos = query("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId]);
  res.json(todos);
});

app.put('/api/todos/:id', authMiddleware, (req, res) => {
  const { done } = req.body;
  run("UPDATE todos SET done = ? WHERE id = ? AND user_id = ?", [done ? 1 : 0, req.params.id, req.user.userId]);
  const todos = query("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId]);
  res.json(todos);
});

app.delete('/api/todos/:id', authMiddleware, (req, res) => {
  run("DELETE FROM todos WHERE id = ? AND user_id = ?", [req.params.id, req.user.userId]);
  const todos = query("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId]);
  res.json(todos);
});

// ============ 成就路由 ============

app.get('/api/achievements', authMiddleware, (req, res) => {
  const all = query("SELECT a.*, CASE WHEN ua.user_id IS NOT NULL THEN 1 ELSE 0 END as unlocked, ua.unlocked_at FROM achievements a LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?", [req.user.userId]);
  res.json(all);
});

// ============ 论文/图书馆路由 ============

app.get('/api/papers/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: '请提供搜索关键词' });
    
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=5&sortBy=relevance&sortOrder=descending`;
    const response = await fetch(url);
    const xml = await response.text();
    
    // 简单 XML 解析
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];
      const getTag = (tag) => {
        const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim() : '';
      };
      const arxivId = getTag('id').replace('http://arxiv.org/abs/', '');
      entries.push({
        arxiv_id: arxivId,
        title: getTag('title').replace(/\n/g, ' ').trim(),
        authors: [...entry.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1]).join(', '),
        abstract: getTag('summary').replace(/\n/g, ' ').trim(),
        url: `https://arxiv.org/abs/${arxivId}`,
      });
    }
    
    res.json({ papers: entries, query: q });
  } catch (e) {
    console.error('论文搜索错误:', e);
    res.status(500).json({ error: '论文搜索失败' });
  }
});

app.get('/api/papers/saved', authMiddleware, (req, res) => {
  const papers = query("SELECT * FROM papers WHERE user_id = ? ORDER BY saved_at DESC", [req.user.userId]);
  res.json(papers);
});

app.post('/api/papers/save', authMiddleware, (req, res) => {
  const { arxiv_id, title, authors, abstract, url } = req.body;
  if (!arxiv_id) return res.status(400).json({ error: '论文ID不能为空' });
  
  const existing = getOne("SELECT id FROM papers WHERE user_id = ? AND arxiv_id = ?", [req.user.userId, arxiv_id]);
  if (existing) return res.status(400).json({ error: '已收藏该论文' });
  
  run("INSERT INTO papers (user_id, arxiv_id, title, authors, abstract, url) VALUES (?, ?, ?, ?, ?, ?)",
    [req.user.userId, arxiv_id, title, authors, abstract, url]);
  
  // 检查成就
  checkAchievement(req.user.userId, 'first_paper');
  const paperCount = getOne("SELECT COUNT(*) as cnt FROM papers WHERE user_id = ?", [req.user.userId]);
  if (paperCount?.cnt >= 5) checkAchievement(req.user.userId, 'paper_5');
  
  const papers = query("SELECT * FROM papers WHERE user_id = ? ORDER BY saved_at DESC", [req.user.userId]);
  res.json(papers);
});

app.delete('/api/papers/:id', authMiddleware, (req, res) => {
  run("DELETE FROM notes WHERE paper_id = ? AND user_id = ?", [req.params.id, req.user.userId]);
  run("DELETE FROM papers WHERE id = ? AND user_id = ?", [req.params.id, req.user.userId]);
  const papers = query("SELECT * FROM papers WHERE user_id = ? ORDER BY saved_at DESC", [req.user.userId]);
  res.json(papers);
});

// ============ 笔记路由 ============

app.get('/api/notes/:paperId', authMiddleware, (req, res) => {
  const note = getOne("SELECT * FROM notes WHERE paper_id = ? AND user_id = ?", [req.params.paperId, req.user.userId]);
  res.json(note || { content: '' });
});

app.post('/api/notes/:paperId', authMiddleware, (req, res) => {
  const { content } = req.body;
  const existing = getOne("SELECT id FROM notes WHERE paper_id = ? AND user_id = ?", [req.params.paperId, req.user.userId]);
  
  if (existing) {
    run("UPDATE notes SET content = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", [content, existing.id]);
  } else {
    run("INSERT INTO notes (user_id, paper_id, content) VALUES (?, ?, ?)", [req.user.userId, req.params.paperId, content]);
    checkAchievement(req.user.userId, 'first_note');
  }
  
  res.json({ success: true });
});

app.post('/api/papers/:id/summary', authMiddleware, async (req, res) => {
  try {
    const apiKey = getRequestApiKey(req);
    if (!apiKey) {
      return res.status(400).json({ error: '缺少用户 MaaS API Key，请重新登录并输入自己的 Key' });
    }

    const paper = getOne(
      "SELECT * FROM papers WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.userId]
    );
    if (!paper) return res.status(404).json({ error: '论文不存在' });

    const note = getOne(
      "SELECT content FROM notes WHERE paper_id = ? AND user_id = ?",
      [req.params.id, req.user.userId]
    );

    const prompt = `请基于下面的论文信息生成中文学术伴读总结，使用Markdown格式，保持严谨，不要编造原文没有的信息。

论文标题：${paper.title || ''}
作者：${paper.authors || ''}
arXiv ID：${paper.arxiv_id || ''}
摘要：${paper.abstract || ''}
用户笔记：${note?.content || '暂无'}

请按以下结构输出：
## TL;DR
用1-2句话概括论文。

## 核心贡献
列出3点以内，说明每一点依据。

## 方法与实验线索
概括可能的方法、数据或实验观察；如果摘要不足以判断，请明确说明。

## 局限与追问
列出值得继续阅读原文确认的问题。`;

    const summary = await chatComplete(prompt, [], { agent: 'bookworm', apiKey });
    res.json({ summary });
  } catch (e) {
    console.error('论文总结错误:', e);
    res.status(500).json({ error: '论文总结失败' });
  }
});

// ============ 学习路径路由 ============

app.get('/api/learn/courses', authMiddleware, (req, res) => {
  const courses = query("SELECT * FROM learn_courses WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId]);
  // 附加进度
  for (const c of courses) {
    try {
      c.outline = JSON.parse(c.outline || '{}');
      if (Array.isArray(c.outline)) c.outline = { chapters: c.outline };
      if (!Array.isArray(c.outline.chapters)) c.outline.chapters = [];
    } catch (e) {
      c.outline = { chapters: [] };
    }
    c.progress = query("SELECT * FROM learn_progress WHERE course_id = ? ORDER BY chapter_idx", [c.id]);
  }
  res.json(courses);
});

app.post('/api/learn/generate', authMiddleware, async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: '请提供学习主题' });
    const apiKey = getRequestApiKey(req);
    if (!apiKey) {
      return res.status(400).json({ error: '缺少用户 MaaS API Key，请重新登录并输入自己的 Key' });
    }
    
    const prompt = `请为「${topic}」生成一个学习路径大纲。严格按照以下JSON格式返回，不要包含其他内容：
{
  "chapters": [
    {
      "title": "章节标题",
      "difficulty": 3,
      "duration": "2小时",
      "summary": "本章核心逻辑，用2-3句话说明为什么要学这一章",
      "points": ["知识点1", "知识点2", "知识点3"],
      "resources": [
        { "type": "video", "label": "推荐搜索关键词", "url": "https://search.bilibili.com/all?keyword=关键词" },
        { "type": "blog", "label": "图文教程关键词", "url": "https://www.bing.com/search?q=关键词+教程" }
      ]
    }
  ]
}
生成5-7个章节，从基础到进阶。difficulty范围1-5。外部资源优先给B站、YouTube、菜鸟教程或高质量博客的搜索/教程链接，不要编造不存在的具体课程。`;
    
    const result = await chatComplete(prompt, [], { agent: 'scholar', apiKey });
    
    // 解析JSON
    let outline;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      outline = JSON.parse(jsonMatch[0]);
    } catch (e) {
      outline = { chapters: [{ title: topic, difficulty: 1, duration: "2小时", summary: "从基础概念开始建立学习框架。", points: ["基础知识"], resources: [] }] };
    }
    if (!Array.isArray(outline.chapters)) outline.chapters = [];
    
    // 保存课程
    run("INSERT INTO learn_courses (user_id, topic, outline) VALUES (?, ?, ?)",
      [req.user.userId, topic, JSON.stringify(outline)]);
    
    const course = getOne("SELECT * FROM learn_courses WHERE user_id = ? ORDER BY id DESC LIMIT 1", [req.user.userId]);
    course.outline = outline;
    course.progress = [];
    
    checkAchievement(req.user.userId, 'first_learn');
    
    res.json(course);
  } catch (e) {
    console.error('生成学习路径错误:', e);
    res.status(500).json({ error: '生成学习路径失败' });
  }
});

app.post('/api/learn/quiz', authMiddleware, async (req, res) => {
  try {
    const { courseId, chapterIdx, chapterTitle, points } = req.body;
    const apiKey = getRequestApiKey(req);
    if (!apiKey) {
      return res.status(400).json({ error: '缺少用户 MaaS API Key，请重新登录并输入自己的 Key' });
    }
    
    const prompt = `请为章节「${chapterTitle}」出4道选择题，涵盖知识点：${points?.join('、') || chapterTitle}。
严格按以下JSON格式返回，不要包含其他内容：
{
  "questions": [
    {
      "question": "题目",
      "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"],
      "answer": 0,
      "explanation": "解析"
    }
  ]
}
answer是正确答案的索引(0-3)。`;
    
    const result = await chatComplete(prompt, [], { agent: 'scholar', apiKey });
    
    let quiz;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      quiz = JSON.parse(jsonMatch[0]);
    } catch (e) {
      quiz = { questions: [{ question: "题目加载失败", options: ["A","B","C","D"], answer: 0, explanation: "" }] };
    }
    
    res.json(quiz);
  } catch (e) {
    console.error('生成测验错误:', e);
    res.status(500).json({ error: '生成测验失败' });
  }
});

app.post('/api/learn/progress', authMiddleware, (req, res) => {
  const { courseId, chapterIdx, status, score } = req.body;
  
  const existing = getOne(
    "SELECT id FROM learn_progress WHERE course_id = ? AND chapter_idx = ?",
    [courseId, chapterIdx]
  );
  
  if (existing) {
    run("UPDATE learn_progress SET status = ?, score = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
      [status, score || 0, existing.id]);
  } else {
    run("INSERT INTO learn_progress (course_id, chapter_idx, status, score) VALUES (?, ?, ?, ?)",
      [courseId, chapterIdx, status, score || 0]);
  }
  
  if (status === 'passed') {
    checkAchievement(req.user.userId, 'first_quiz');
  }
  
  res.json({ success: true });
});

// ============ 新闻路由 ============

function decodeXmlText(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWithTimeout(url, timeout = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseNewsItems(text) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(text)) !== null && items.length < 8) {
    const item = match[1];
    const titleM = item.match(/<title>([\s\S]*?)<\/title>/);
    const linkM = item.match(/<link>([\s\S]*?)<\/link>/);
    const descM = item.match(/<description>([\s\S]*?)<\/description>/);
    const dateM = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

    if (titleM) {
      items.push({
        title: decodeXmlText(titleM[1]),
        url: linkM ? decodeXmlText(linkM[1]) : '',
        description: decodeXmlText(descM?.[1] || '').slice(0, 420),
        publishedAt: dateM ? decodeXmlText(dateM[1]) : '',
        source: 'arXiv cs.AI',
      });
    }
  }

  return items;
}

function fallbackNews() {
  return [
    {
      title: 'arXiv cs.AI 暂时无法连接，已启用离线资讯占位',
      description: '网络或上游 RSS 不稳定时，RAIO 会保持新闻页可见。稍后刷新即可重新拉取最新学术动态。',
      url: 'https://arxiv.org/list/cs.AI/recent',
      publishedAt: new Date().toISOString(),
      source: 'RAIO fallback',
    },
    {
      title: '建议关注：多智能体、检索增强生成、科研工作流自动化',
      description: '这些方向与 RAIO 当前的 Agent 路由、论文伴读和学习路径功能高度相关，可作为近期阅读关键词。',
      url: 'https://arxiv.org/search/cs?query=multi-agent+retrieval+augmented+generation+research+workflow&searchtype=all',
      publishedAt: new Date().toISOString(),
      source: 'RAIO fallback',
    },
  ];
}

function buildDigest(items) {
  return {
    date: new Date().toLocaleDateString('zh-CN'),
    bullets: items.slice(0, 3).map((item, idx) => ({
      title: `#${idx + 1} ${item.title}`,
      detail: item.description || '建议打开原文查看摘要与方法细节。',
    })),
  };
}

app.get('/api/news', authMiddleware, async (req, res) => {
  try {
    const url = 'https://export.arxiv.org/rss/cs.AI';
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`RSS ${response.status}`);
    const text = await response.text();
    const items = parseNewsItems(text);
    const news = items.length ? items : fallbackNews();
    res.json({ news, digest: buildDigest(news), fallback: items.length === 0 });
  } catch (e) {
    console.error('获取新闻错误:', e);
    const news = fallbackNews();
    res.json({ news, digest: buildDigest(news), fallback: true });
  }
});

app.post('/api/news/analyze', authMiddleware, async (req, res) => {
  const { item, question } = req.body;
  if (!item?.title) return res.status(400).json({ error: '新闻内容不能为空' });
  const apiKey = getRequestApiKey(req);
  if (!apiKey) {
    return res.status(400).json({ error: '缺少用户 MaaS API Key，请重新登录并输入自己的 Key' });
  }

  const fallback = `## 解析\n这条资讯的核心是：${item.title}\n\n## 对科研的可能意义\n${item.description || '需要阅读原文进一步确认方法、实验与结论。'}\n\n## 建议追问\n- 它解决了什么具体问题？\n- 方法是否能迁移到我的研究方向？\n- 实验设置是否足够支撑结论？`;

  try {
    const prompt = `请作为科研资讯分析助手，用中文解析下面这条学术新闻。保持谨慎，不要编造原文没有的信息。

标题：${item.title}
摘要/描述：${item.description || ''}
来源：${item.source || ''}
用户追问：${question || '这对我当前研究有什么启发？'}

请输出Markdown，包含：核心内容、研究影响、可追问问题。`;
    const analysis = await chatComplete(prompt, [], { agent: 'bookworm', apiKey });
    res.json({ analysis });
  } catch (e) {
    console.error('新闻解析错误:', e.message);
    res.json({ analysis: fallback, fallback: true });
  }
});

// ============ 星露谷素材列表 ============

app.get('/api/stardew/list', (req, res) => {
  try {
    const dir = req.query.dir || '';
    const targetPath = path.join(stardewPath, dir);
    
    // 安全检查
    if (!targetPath.startsWith(stardewPath)) {
      return res.status(403).json({ error: '非法路径' });
    }
    
    if (!fsSync.existsSync(targetPath)) {
      return res.json({ files: [], dirs: [] });
    }
    
    const entries = fsSync.readdirSync(targetPath, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    
    res.json({ files, dirs });
  } catch (e) {
    res.status(500).json({ error: '读取失败' });
  }
});

// ============ SPA 回退（生产模式） ============

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// ============ 启动服务器 ============

async function start() {
  await initDB();
  
  app.listen(PORT, () => {
    console.log(`\n🚜 RAIO 服务器已启动: http://localhost:${PORT}`);
    console.log(`📦 前端开发服务器: http://localhost:5174`);
    console.log(`🎮 星露谷素材: http://localhost:${PORT}/assets/stardew/`);
  });
}

start();
