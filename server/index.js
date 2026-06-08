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
import { isValidMaasModel } from '../shared/maasModels.js';
import {
  buildUserRagContext,
  getGlobalRadar,
  recordDailyNewsRead,
  recordMemoryEvent,
} from './globalMemory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

function getRequestApiKey(req) {
  const value = req.headers['x-maas-api-key'];
  return Array.isArray(value) ? value[0]?.trim() : value?.trim();
}

function getRequestModel(req) {
  const value = req.headers['x-maas-model'];
  return Array.isArray(value) ? value[0]?.trim() : value?.trim();
}

function getAIRequestConfig(req) {
  const apiKey = getRequestApiKey(req);
  const model = getRequestModel(req);
  if (!apiKey) return { error: '缺少用户 MaaS API Key，请重新登录并输入自己的 Key' };
  if (!isValidMaasModel(model)) return { error: '请选择有效的 Huawei MaaS 文本生成模型' };
  return { apiKey, model };
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

    const aiConfig = getAIRequestConfig(req);
    if (aiConfig.error) return res.status(400).json({ error: aiConfig.error });
    
    const requestedAgent = agent && agent !== 'auto' ? agent : null;
    const detectedAgent = resolveAgent(requestedAgent, message);

    // 获取当前消息之前的历史，避免把本轮用户消息重复塞进模型上下文
    const history = query(
      "SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 20",
      [userId]
    ).reverse();
    const globalMemory = buildUserRagContext(userId, message);

    // 保存用户消息
    run("INSERT INTO chat_history (user_id, role, content, agent) VALUES (?, ?, ?, ?)",
      [userId, 'user', message, requestedAgent || detectedAgent]);
    
    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    const context = {
      agent: requestedAgent || undefined,
      username,
      globalMemoryContext: globalMemory.contextText,
      ...aiConfig,
    };
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
      recordMemoryEvent(userId, {
        sourceType: 'home_chat',
        sourceId: String(chatCount?.cnt || ''),
        title: `主页问答：${message}`,
        content: `用户：${message}\n助手：${fullContent}`,
        tags: ['主页助手', agentKey, model],
        weight: 1.2,
        awards: { synthesis: 3, reflection: message.length > 18 ? 2 : 1 },
      });
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
  const todo = getOne("SELECT * FROM todos WHERE user_id = ? ORDER BY id DESC LIMIT 1", [req.user.userId]);
  recordMemoryEvent(req.user.userId, {
    sourceType: 'todo_add',
    sourceId: String(todo?.id || ''),
    title: `新增待办：${content}`,
    content,
    tags: ['待办', '行动'],
    weight: 0.8,
    awards: { execution: 2 },
  });
  
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
  if (done) {
    const todo = getOne("SELECT content FROM todos WHERE id = ? AND user_id = ?", [req.params.id, req.user.userId]);
    recordMemoryEvent(req.user.userId, {
      sourceType: 'todo_done',
      sourceId: String(req.params.id),
      title: `完成待办：${todo?.content || req.params.id}`,
      content: todo?.content || '',
      tags: ['待办', '完成'],
      weight: 1.2,
      awards: { execution: 6 },
    });
  }
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

// ============ 全局画像 / 记忆路由 ============

app.get('/api/global/radar', authMiddleware, (req, res) => {
  res.json(getGlobalRadar(req.user.userId));
});

// ============ 论文/图书馆路由 ============

function parseArxivEntries(xml, limit = 5) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null && entries.length < limit) {
    const entry = match[1];
    const getTag = (tag) => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decodeXmlText(m[1]).trim() : '';
    };
    const arxivId = getTag('id').replace('http://arxiv.org/abs/', '').replace('https://arxiv.org/abs/', '');
    entries.push({
      arxiv_id: arxivId,
      title: getTag('title').replace(/\n/g, ' ').trim(),
      authors: [...entry.matchAll(/<name>(.*?)<\/name>/g)].map(m => decodeXmlText(m[1])).join(', '),
      abstract: getTag('summary').replace(/\n/g, ' ').trim(),
      url: `https://arxiv.org/abs/${arxivId}`,
    });
  }

  return entries;
}

async function searchArxivPapers(q, limit = 5) {
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;
  const response = await fetchWithTimeout(url, 9000);
  if (!response.ok) throw new Error(`arXiv ${response.status}`);
  return parseArxivEntries(await response.text(), limit);
}

function extractArxivId(url = '') {
  const match = String(url).match(/arxiv\.org\/(?:abs|pdf)\/([^?#/]+)/i);
  return match?.[1]?.replace(/\.pdf$/i, '') || '';
}

function inferNewsTopic(item = {}) {
  const raw = `${item.title || ''} ${item.description || ''}`;
  const latin = raw.match(/[A-Za-z][A-Za-z0-9+.-]{2,}/g) || [];
  const chinese = raw.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
  const stop = new Set(['using', 'with', 'from', 'towards', 'through', 'based', 'about', 'paper']);
  const terms = [...latin, ...chinese]
    .map(term => term.trim())
    .filter(term => term.length >= 2 && !stop.has(term.toLowerCase()));
  return [...new Set(terms)].slice(0, 6).join(' ') || item.title || 'AI frontier';
}

function fallbackMicroOutline(topic, item = {}) {
  const keyword = encodeURIComponent(topic);
  return {
    chapters: [
      {
        title: `快速读懂：${topic}`,
        difficulty: 2,
        duration: '30分钟',
        summary: `先厘清「${topic}」解决的问题、输入输出和核心假设。`,
        points: ['问题定义', '关键术语', '适用边界'],
        resources: [
          { type: 'paper', label: 'arXiv 相关论文', url: `https://arxiv.org/search/?query=${keyword}&searchtype=all` },
        ],
      },
      {
        title: '方法拆解与对照',
        difficulty: 3,
        duration: '45分钟',
        summary: '把新闻中的新方法拆成模块，并和你已收藏/学习过的方向做对照。',
        points: ['方法结构', '对比基线', '可能迁移点'],
        resources: [
          { type: 'blog', label: '方法教程搜索', url: `https://www.bing.com/search?q=${keyword}+method+tutorial` },
        ],
      },
      {
        title: '形成个人研究问题',
        difficulty: 3,
        duration: '30分钟',
        summary: '输出一个可验证的小问题，决定是否进入深入阅读。',
        points: ['可复现实验', '风险假设', '下一篇必读文献'],
        resources: item.url ? [{ type: 'news', label: '新闻原文', url: item.url }] : [],
      },
    ],
  };
}

async function createMicroCourse(userId, topic, item, aiConfig) {
  let outline = fallbackMicroOutline(topic, item);

  if (!aiConfig.error) {
    try {
      const prompt = `请基于下面的学术资讯，为用户生成一个“微学习路径”。严格返回JSON，不要包含其他内容。
{
  "chapters": [
    {
      "title": "章节标题",
      "difficulty": 2,
      "duration": "30分钟",
      "summary": "学习目标",
      "points": ["知识点1", "知识点2"],
      "resources": [
        { "type": "paper", "label": "推荐搜索关键词", "url": "https://arxiv.org/search/?query=关键词&searchtype=all" }
      ]
    }
  ]
}
资讯标题：${item.title || topic}
资讯描述：${item.description || ''}
主题关键词：${topic}
要求：生成3个章节，资源链接只使用搜索链接或用户提供的原文链接，不要编造具体课程。`;
      const result = await chatComplete(prompt, [], { agent: 'scholar', ...aiConfig });
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.chapters) && parsed.chapters.length) outline = parsed;
    } catch (e) {
      console.error('微学习路径生成降级:', e.message);
    }
  }

  run(
    'INSERT INTO learn_courses (user_id, topic, outline) VALUES (?, ?, ?)',
    [userId, `微学习：${topic.slice(0, 60)}`, JSON.stringify(outline)]
  );

  const course = getOne(
    'SELECT * FROM learn_courses WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    [userId]
  );
  course.outline = outline;
  course.progress = [];
  return course;
}

async function saveCorePaperForNews(userId, item, topic) {
  const arxivId = extractArxivId(item.url);
  const directPaper = arxivId
    ? {
        arxiv_id: arxivId,
        title: item.title,
        authors: item.source || '',
        abstract: item.description || '',
        url: `https://arxiv.org/abs/${arxivId}`,
      }
    : null;

  const candidates = directPaper ? [directPaper] : await searchArxivPapers(topic, 1);
  const paper = candidates[0];
  if (!paper?.arxiv_id) return null;

  const existing = getOne(
    'SELECT * FROM papers WHERE user_id = ? AND arxiv_id = ?',
    [userId, paper.arxiv_id]
  );
  if (existing) return { ...existing, alreadySaved: true };

  run(
    'INSERT INTO papers (user_id, arxiv_id, title, authors, abstract, url) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, paper.arxiv_id, paper.title, paper.authors, paper.abstract, paper.url]
  );

  return getOne(
    'SELECT * FROM papers WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    [userId]
  );
}

app.get('/api/papers/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: '请提供搜索关键词' });

    res.json({ papers: await searchArxivPapers(q, 5), query: q });
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
  const savedPaper = getOne(
    "SELECT * FROM papers WHERE user_id = ? AND arxiv_id = ?",
    [req.user.userId, arxiv_id]
  );
  recordMemoryEvent(req.user.userId, {
    sourceType: 'paper_save',
    sourceId: String(savedPaper?.id || arxiv_id),
    title: `收藏论文：${title || arxiv_id}`,
    content: `作者：${authors || '未知'}\n摘要：${abstract || '暂无'}`,
    tags: ['图书馆', '论文', arxiv_id],
    weight: 1.8,
    awards: { literature: 12, frontier: 4 },
  });
  
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
  const paper = getOne("SELECT title, arxiv_id FROM papers WHERE id = ? AND user_id = ?", [req.params.paperId, req.user.userId]);
  recordMemoryEvent(req.user.userId, {
    sourceType: 'paper_note',
    sourceId: String(req.params.paperId),
    title: `更新论文笔记：${paper?.title || paper?.arxiv_id || req.params.paperId}`,
    content,
    tags: ['图书馆', '笔记'],
    weight: content?.length > 500 ? 2.2 : 1.5,
    awards: { literature: 8, reflection: content?.length > 500 ? 10 : 5 },
  });
  
  res.json({ success: true });
});

app.post('/api/papers/:id/summary', authMiddleware, async (req, res) => {
  try {
    const aiConfig = getAIRequestConfig(req);
    if (aiConfig.error) return res.status(400).json({ error: aiConfig.error });

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

    const summary = await chatComplete(prompt, [], { agent: 'bookworm', ...aiConfig });
    recordMemoryEvent(req.user.userId, {
      sourceType: 'paper_summary',
      sourceId: String(req.params.id),
      title: `AI伴读总结：${paper.title || paper.arxiv_id}`,
      content: summary,
      tags: ['图书馆', 'AI总结'],
      weight: 2.3,
      awards: { literature: 6, synthesis: 8 },
    });
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
    const aiConfig = getAIRequestConfig(req);
    if (aiConfig.error) return res.status(400).json({ error: aiConfig.error });
    
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
    
    const result = await chatComplete(prompt, [], { agent: 'scholar', ...aiConfig });
    
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
    recordMemoryEvent(req.user.userId, {
      sourceType: 'learn_course',
      sourceId: String(course.id),
      title: `生成学习路径：${topic}`,
      content: (outline.chapters || []).map((chapter, index) => `${index + 1}. ${chapter.title}: ${(chapter.points || []).join('、')}`).join('\n'),
      tags: ['大师之路', '学习路径'],
      weight: 1.8,
      awards: { learning: 18, execution: 4 },
    });
    
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
    const aiConfig = getAIRequestConfig(req);
    if (aiConfig.error) return res.status(400).json({ error: aiConfig.error });
    
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
    
    const result = await chatComplete(prompt, [], { agent: 'scholar', ...aiConfig });
    
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
  const course = getOne(
    "SELECT id, topic, outline FROM learn_courses WHERE id = ? AND user_id = ?",
    [courseId, req.user.userId]
  );
  if (!course) return res.status(404).json({ error: '学习路径不存在' });
  
  const existing = getOne(
    "SELECT id, status FROM learn_progress WHERE course_id = ? AND chapter_idx = ?",
    [courseId, chapterIdx]
  );
  const statusChanged = !existing || existing.status !== status;
  const firstPassed = status === 'passed' && existing?.status !== 'passed';
  
  if (existing) {
    run("UPDATE learn_progress SET status = ?, score = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
      [status, score || 0, existing.id]);
  } else {
    run("INSERT INTO learn_progress (course_id, chapter_idx, status, score) VALUES (?, ?, ?, ?)",
      [courseId, chapterIdx, status, score || 0]);
  }
  
  if (firstPassed) {
    checkAchievement(req.user.userId, 'first_quiz');
  }
  let chapterTitle = `第${Number(chapterIdx) + 1}章`;
  try {
    const outline = JSON.parse(course?.outline || '{}');
    chapterTitle = outline.chapters?.[chapterIdx]?.title || chapterTitle;
  } catch (e) {
    // 保留默认章节名
  }
  recordMemoryEvent(req.user.userId, {
    sourceType: 'learn_progress',
    sourceId: `${courseId}:${chapterIdx}:${status}`,
    title: `学习进度：${course?.topic || '学习路径'} / ${chapterTitle}`,
    content: `状态：${status}，得分：${score || 0}`,
    tags: ['大师之路', status],
    weight: status === 'passed' ? 2 : 1.2,
    dedupe: true,
    awards: statusChanged ? {
      learning: firstPassed ? 12 : 5,
      execution: firstPassed ? 8 : 4,
    } : undefined,
  });
  
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
    recordDailyNewsRead(req.user.userId);
    res.json({ news, digest: buildDigest(news), fallback: items.length === 0 });
  } catch (e) {
    console.error('获取新闻错误:', e);
    const news = fallbackNews();
    recordDailyNewsRead(req.user.userId);
    res.json({ news, digest: buildDigest(news), fallback: true });
  }
});

app.post('/api/news/analyze', authMiddleware, async (req, res) => {
  const { item, question } = req.body;
  if (!item?.title) return res.status(400).json({ error: '新闻内容不能为空' });
  const aiConfig = getAIRequestConfig(req);
  if (aiConfig.error) return res.status(400).json({ error: aiConfig.error });

  const fallback = `## 解析\n这条资讯的核心是：${item.title}\n\n## 对科研的可能意义\n${item.description || '需要阅读原文进一步确认方法、实验与结论。'}\n\n## 建议追问\n- 它解决了什么具体问题？\n- 方法是否能迁移到我的研究方向？\n- 实验设置是否足够支撑结论？`;

  try {
    const prompt = `请作为科研资讯分析助手，用中文解析下面这条学术新闻。保持谨慎，不要编造原文没有的信息。

标题：${item.title}
摘要/描述：${item.description || ''}
来源：${item.source || ''}
用户追问：${question || '这对我当前研究有什么启发？'}

请输出Markdown，包含：核心内容、研究影响、可追问问题。`;
    const analysis = await chatComplete(prompt, [], { agent: 'bookworm', ...aiConfig });
    res.json({ analysis });
  } catch (e) {
    console.error('新闻解析错误:', e.message);
    res.json({ analysis: fallback, fallback: true });
  }
});

app.post('/api/news/follow', authMiddleware, async (req, res) => {
  const { item } = req.body;
  if (!item?.title) return res.status(400).json({ error: '新闻内容不能为空' });

  const aiConfig = getAIRequestConfig(req);
  const topic = inferNewsTopic(item);
  const newsKey = item.url || item.title;
  const existingCourseMemory = getOne(
    "SELECT source_id FROM global_memories WHERE user_id = ? AND source_type = 'news_micro_course' AND source_id = ?",
    [req.user.userId, newsKey]
  );
  let savedPaper = null;
  let course = null;
  let paperError = '';
  let courseError = '';

  const isNewFocus = recordMemoryEvent(req.user.userId, {
    sourceType: 'news_focus',
    sourceId: newsKey,
    title: `关注前沿：${item.title}`,
    content: `${item.description || ''}\n来源：${item.source || ''}\n链接：${item.url || ''}`,
    tags: ['新闻视野', topic],
    weight: 2.4,
    dedupe: true,
    awards: { frontier: 18, synthesis: 8, execution: 4 },
  });

  try {
    savedPaper = await saveCorePaperForNews(req.user.userId, item, topic);
    if (savedPaper && !savedPaper.alreadySaved) {
      checkAchievement(req.user.userId, 'first_paper');
      const paperCount = getOne("SELECT COUNT(*) as cnt FROM papers WHERE user_id = ?", [req.user.userId]);
      if (paperCount?.cnt >= 5) checkAchievement(req.user.userId, 'paper_5');
      recordMemoryEvent(req.user.userId, {
        sourceType: 'news_auto_paper',
        sourceId: String(savedPaper.id),
        title: `新闻联动入库：${savedPaper.title || savedPaper.arxiv_id}`,
        content: `来自新闻关注「${item.title}」。摘要：${savedPaper.abstract || '暂无'}`,
        tags: ['新闻视野', '图书馆', topic],
        weight: 2.2,
        awards: { literature: 10, frontier: 6 },
      });
    }
  } catch (e) {
    paperError = e.message || '核心文献抓取失败';
    console.error('新闻联动论文失败:', e.message);
  }

  if (!existingCourseMemory) {
    try {
      course = await createMicroCourse(req.user.userId, topic, item, aiConfig);
      recordMemoryEvent(req.user.userId, {
        sourceType: 'news_micro_course',
        sourceId: newsKey,
        title: `新闻联动微学习：${course.topic}`,
        content: (course.outline.chapters || []).map((chapter, index) => `${index + 1}. ${chapter.title}`).join('\n'),
        tags: ['新闻视野', '大师之路', topic, `course:${course.id}`],
        weight: 2,
        dedupe: true,
        awards: { learning: 14, execution: 6 },
      });
      checkAchievement(req.user.userId, 'first_learn');
    } catch (e) {
      courseError = e.message || '微学习路径生成失败';
      console.error('新闻联动课程失败:', e.message);
    }
  }

  const message = course
    ? (savedPaper ? '已关注：核心文献已进入图书馆，微学习路径已生成。' : '已关注：微学习路径已生成，核心文献抓取稍后可重试。')
    : courseError
      ? (savedPaper ? '已关注：核心文献已进入图书馆，微学习路径生成失败，可稍后重试。' : '已记录关注：微学习路径生成失败，核心文献抓取也可稍后重试。')
      : (savedPaper ? '已关注过：核心文献已在图书馆，微学习路径不重复生成。' : '已关注过：微学习路径不重复生成，核心文献稍后可重试。');

  res.json({
    success: true,
    duplicated: !isNewFocus,
    topic,
    paper: savedPaper,
    paperError,
    courseError,
    course,
    message,
  });
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
