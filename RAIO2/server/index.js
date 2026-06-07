import express from 'express';
import cors from 'cors';
import path from 'path';
import fsSync from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { initDB, getDB, query, run, getOne, saveDB, checkAchievement } from './db.js';
import { generateToken, authMiddleware } from './auth.js';
import { streamChat, chatComplete, detectAgent, AGENTS } from './agents.js';
import { PORT } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

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
    
    // 保存用户消息
    run("INSERT INTO chat_history (user_id, role, content, agent) VALUES (?, ?, ?, ?)",
      [userId, 'user', message, agent || 'lumo']);
    
    // 获取历史
    const history = query(
      "SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 20",
      [userId]
    ).reverse();
    
    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    const context = { agent: agent || undefined, username };
    const { response: llmResponse, agentKey, agentName } = await streamChat(message, history, context);
    
    // 发送 Agent 信息
    res.write(`data: ${JSON.stringify({ type: 'agent', agent: agentKey, name: agentName })}\n\n`);
    
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
    "SELECT role, content, agent, created_at FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 50",
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

// ============ 学习路径路由 ============

app.get('/api/learn/courses', authMiddleware, (req, res) => {
  const courses = query("SELECT * FROM learn_courses WHERE user_id = ? ORDER BY created_at DESC", [req.user.userId]);
  // 附加进度
  for (const c of courses) {
    c.outline = JSON.parse(c.outline || '[]');
    c.progress = query("SELECT * FROM learn_progress WHERE course_id = ? ORDER BY chapter_idx", [c.id]);
  }
  res.json(courses);
});

app.post('/api/learn/generate', authMiddleware, async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: '请提供学习主题' });
    
    const prompt = `请为「${topic}」生成一个学习路径大纲。严格按照以下JSON格式返回，不要包含其他内容：
{
  "chapters": [
    {
      "title": "章节标题",
      "difficulty": 3,
      "duration": "2小时",
      "points": ["知识点1", "知识点2", "知识点3"]
    }
  ]
}
生成5-7个章节，从基础到进阶。difficulty范围1-5。`;
    
    const result = await chatComplete(prompt, [], { agent: 'scholar' });
    
    // 解析JSON
    let outline;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      outline = JSON.parse(jsonMatch[0]);
    } catch (e) {
      outline = { chapters: [{ title: topic, difficulty: 1, duration: "2小时", points: ["基础知识"] }] };
    }
    
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
    
    const result = await chatComplete(prompt, [], { agent: 'scholar' });
    
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

app.get('/api/news', authMiddleware, async (req, res) => {
  try {
    // 简化版：从 arXiv RSS 获取最新论文作为学术新闻
    const url = 'http://export.arxiv.org/rss/cs.AI';
    const response = await fetch(url);
    const text = await response.text();
    
    // 解析 RSS 中的条目
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let count = 0;
    while ((match = itemRegex.exec(text)) !== null && count < 8) {
      const item = match[1];
      const titleM = item.match(/<title>([\s\S]*?)<\/title>/);
      const linkM = item.match(/<link>([\s\S]*?)<\/link>/);
      const descM = item.match(/<description>([\s\S]*?)<\/description>/);
      
      if (titleM) {
        items.push({
          title: titleM[1].replace(/&lt;.*?&gt;/g, '').trim(),
          url: linkM ? linkM[1].trim() : '',
          description: descM ? descM[1].replace(/<[^>]*>/g, '').substring(0, 200) : '',
        });
        count++;
      }
    }
    
    res.json({ news: items });
  } catch (e) {
    console.error('获取新闻错误:', e);
    res.json({ news: [] });
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
