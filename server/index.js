import express from 'express';
import cors from 'cors';
import path from 'path';
import fsSync from 'fs';
import crypto from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
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
import {
  buildEvidenceContext,
  extractJsonObject,
  parsePdfFile,
  validateEvidenceClaims,
} from './pdfParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const MAX_FULLTEXT_BYTES = 80 * 1024 * 1024;
const INSTITUTIONAL_FETCH_INTERVAL_MS = 30 * 1000;
const institutionalFetchClock = new Map();

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

// 兼容旧版静态素材路径
const legacyAssetsPath = path.join(__dirname, '..', 'Stardew valley');
app.use('/assets/stardew', express.static(legacyAssetsPath));

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

// ============ 聊天路由（SSE 流式 + 可执行论文工具） ============

function detectPaperToolIntent(message = '') {
  const text = String(message).toLowerCase();
  if (/完整证据链|全流程|全文.*(?:解析|证据)|获取.*解析.*证据/.test(text)) return 'paper_pipeline';
  if (/证据链|证据总结|核验证据|全文总结/.test(text)) return 'evidence_summary';
  if (/解析\s*(?:pdf|论文|全文)|pdf\s*解析|提取章节/.test(text)) return 'parse_pdf';
  if (/获取全文|下载全文|获取\s*pdf|下载\s*pdf/.test(text)) return 'fetch_fulltext';
  return '';
}

function resolvePaperForTool(userId, message = '') {
  const explicitId = String(message).match(/(?:paper\s*[:#]|论文\s*[#：:]?)\s*(\d+)/i)?.[1];
  if (explicitId) {
    return getOne('SELECT * FROM papers WHERE id = ? AND user_id = ?', [explicitId, userId]);
  }

  const doi = String(message).match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];
  if (doi) {
    const paper = getOne('SELECT * FROM papers WHERE user_id = ? AND lower(doi) = lower(?)', [userId, doi]);
    if (paper) return paper;
  }

  const arxivId = String(message).match(/\b(?:arxiv[:\s]*)?(\d{4}\.\d{4,5}(?:v\d+)?)\b/i)?.[1];
  if (arxivId) {
    const paper = getOne('SELECT * FROM papers WHERE user_id = ? AND arxiv_id = ?', [userId, arxivId]);
    if (paper) return paper;
  }

  return getOne('SELECT * FROM papers WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
}

function paperToolAgent(tool) {
  if (tool === 'fetch_fulltext') return 'bookworm';
  if (tool === 'parse_pdf') return 'gears';
  if (tool === 'evidence_summary') return 'bloom';
  return 'lumo';
}

async function executePaperTool(tool, paper, userId, aiConfig) {
  if (!paper) throw new Error('没有找到可操作的收藏论文，请先在图书馆收藏论文，或在指令中写明“论文 #ID”');
  if (tool === 'fetch_fulltext') return fetchPaperFulltext(paper.id, userId);
  if (tool === 'parse_pdf') return parsePaperPdf(paper.id, userId);
  if (tool === 'evidence_summary') return generatePaperEvidence(paper.id, userId, aiConfig);
  if (tool === 'paper_pipeline') {
    const fetchResult = await fetchPaperFulltext(paper.id, userId);
    const parseResult = await parsePaperPdf(paper.id, userId);
    const evidenceResult = await generatePaperEvidence(paper.id, userId, aiConfig);
    return { fetchResult, parseResult, evidenceResult };
  }
  throw new Error('不支持的论文工具');
}

function formatPaperToolResult(tool, paper, result) {
  const title = paper?.title || paper?.arxiv_id || `论文 #${paper?.id}`;
  if (tool === 'fetch_fulltext') {
    return `## 全文获取完成\n\n- 论文：${title}\n- 来源：${result.pdf_source || '本地已有文件'}\n- 状态：已保存并通过 PDF 文件头校验\n\n现在可以继续输入“解析论文 #${paper.id}”。`;
  }
  if (tool === 'parse_pdf') {
    return `## PDF 解析完成\n\n- 论文：${title}\n- 页数：${result.page_count}\n- 已解析页面：${result.parsed_pages}\n- 提取字符：${result.char_count}\n\n现在可以继续输入“生成论文 #${paper.id} 的证据链”。`;
  }
  const evidenceResult = tool === 'paper_pipeline' ? result.evidenceResult : result;
  return `## 证据链任务完成\n\n- 论文：${title}\n- 覆盖页面：${evidenceResult.coverage_pages}/${evidenceResult.total_pages}\n- 证据条目：${evidenceResult.evidence.length}\n- 自动精确核验：${evidenceResult.verified_count}/${evidenceResult.evidence.length}\n\n${evidenceResult.summary || '已生成证据条目，请在图书馆查看并回跳原文。'}\n\n未通过精确匹配的证据已标记为“需人工核验”，不会冒充可靠引用。`;
}

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

    const toolIntent = detectPaperToolIntent(message);
    if (toolIntent) {
      const paper = resolvePaperForTool(userId, message);
      const agentKey = paperToolAgent(toolIntent);
      const startedAt = Date.now();
      const runId = startAgentRun(userId, paper?.id, toolIntent, message);
      res.write(`data: ${JSON.stringify({ type: 'agent', agent: agentKey, name: AGENTS[agentKey]?.name || agentKey, model: aiConfig.model, tool: toolIntent })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'content', content: `正在执行：识别论文 → 调用工具 → 校验结果。\n\n` })}\n\n`);

      let fullContent = '';
      try {
        const result = await executePaperTool(toolIntent, paper, userId, aiConfig);
        fullContent = formatPaperToolResult(toolIntent, paper, result);
        finishAgentRun(runId, 'success', JSON.stringify(result), '', startedAt);
      } catch (e) {
        fullContent = `## 任务执行失败\n\n${e.message}\n\n系统已记录失败原因，没有把未完成的步骤标记为成功。`;
        finishAgentRun(runId, 'failed', '', e.message, startedAt);
      }

      res.write(`data: ${JSON.stringify({ type: 'content', content: fullContent })}\n\n`);
      run("INSERT INTO chat_history (user_id, role, content, agent) VALUES (?, ?, ?, ?)",
        [userId, 'assistant', fullContent, agentKey]);
      recordMemoryEvent(userId, {
        sourceType: 'agent_tool_run',
        sourceId: String(runId || ''),
        title: `Agent 工具任务：${toolIntent}`,
        content: fullContent,
        tags: ['Agent', '工具调用', toolIntent],
        weight: 2.4,
        awards: { execution: 10, literature: 6 },
      });
      saveDB();
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    
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

function normalizeDoi(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return match ? match[0].replace(/[)\].,;]+$/g, '') : '';
}

function sanitizeIdentifier(value = 'paper') {
  return String(value || 'paper')
    .replace(/^https?:\/\//i, '')
    .replace(/[\/\\:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'paper';
}

function isArxivIdentifier(value = '') {
  const id = String(value || '').trim();
  return /^\d{4}\.\d{4,5}(v\d+)?$/i.test(id) || /^[a-z.-]+\/\d{7}(v\d+)?$/i.test(id);
}

function stableUrlId(url = '') {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
}

function decodeHtmlAttr(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function resolveMaybeRelativeUrl(candidate, baseUrl) {
  try {
    return new URL(decodeHtmlAttr(candidate), baseUrl).toString();
  } catch {
    return '';
  }
}

function extractPdfUrlFromHtml(html = '', baseUrl = '') {
  const patterns = [
    /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i,
    /<meta[^>]+name=["']dc\.identifier["'][^>]+content=["']([^"']+\.pdf[^"']*)["']/i,
    /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const resolved = resolveMaybeRelativeUrl(match[1], baseUrl);
      if (resolved) return resolved;
    }
  }
  return '';
}

function getDataDir() {
  const currentDbPath = process.env.RAIO_DB_PATH || path.join(__dirname, '..', 'data', 'raio.db');
  return path.dirname(currentDbPath);
}

function buildPdfStoragePath(identifier) {
  const dataDir = getDataDir();
  const fileName = `${sanitizeIdentifier(identifier)}.pdf`;
  return {
    dataDir,
    pdfsDir: path.join(dataDir, 'pdfs'),
    relativePathForDb: path.join('pdfs', fileName),
    absolutePath: path.join(dataDir, 'pdfs', fileName),
  };
}

function checkInstitutionalFetchRateLimit(userId) {
  const now = Date.now();
  const last = institutionalFetchClock.get(userId) || 0;
  const waitMs = INSTITUTIONAL_FETCH_INTERVAL_MS - (now - last);
  if (waitMs > 0) {
    throw new Error(`服务器网络全文直取已限速，请 ${Math.ceil(waitMs / 1000)} 秒后再试。`);
  }
  institutionalFetchClock.set(userId, now);
}

function isPrivateAddress(address = '') {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || a >= 224;
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb');
  }
  return true;
}

async function assertSafeRemoteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('无效的远程地址');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('只允许访问 HTTP/HTTPS 地址');
  }
  if (url.username || url.password) {
    throw new Error('远程地址不得包含账号或密码');
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('为保护本机网络，禁止访问私网或本地地址');
  }
}

async function fetchWithTimeout(url, timeout = 7000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let currentUrl = String(url);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertSafeRemoteUrl(currentUrl);
      const response = await fetch(currentUrl, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
    }
    throw new Error('远程地址重定向次数过多');
  } finally {
    clearTimeout(timer);
  }
}

async function readPdfBufferFromResponse(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_FULLTEXT_BYTES) {
    throw new Error(`PDF 文件过大（${Math.round(contentLength / 1024 / 1024)}MB），已停止下载`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_FULLTEXT_BYTES) {
    throw new Error(`PDF 文件过大（${Math.round(buffer.length / 1024 / 1024)}MB），已停止下载`);
  }
  if (buffer.length < 4 || buffer.slice(0, 4).toString() !== '%PDF') {
    throw new Error('下载的内容不是合法的 PDF 文件，可能是落地页、访问限制或验证码页面');
  }
  return buffer;
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

function normalizeCourseOutline(outline, topic) {
  const normalized = outline && typeof outline === 'object' ? outline : {};
  const chapters = Array.isArray(normalized.chapters) ? normalized.chapters : [];
  normalized.chapters = chapters.map((chapter, index) => ({
    title: String(chapter?.title || `第 ${index + 1} 章`).trim(),
    difficulty: Math.min(5, Math.max(1, Number(chapter?.difficulty || 2))),
    duration: String(chapter?.duration || '1小时').trim(),
    summary: String(chapter?.summary || '围绕本章主题建立概念、方法与实践之间的联系。').trim(),
    points: Array.isArray(chapter?.points) && chapter.points.length
      ? chapter.points.map(point => String(point).trim()).filter(Boolean).slice(0, 8)
      : ['核心概念', '实践任务'],
    resources: Array.isArray(chapter?.resources) ? chapter.resources.filter(item => item?.url).slice(0, 6) : [],
    learning_text: String(chapter?.learning_text || chapter?.lesson || '').trim(),
  }));

  normalized.mindmap = buildCourseMindmap(topic, normalized.chapters);
  normalized.markdown = buildCourseMarkdown(topic, normalized.chapters);
  return normalized;
}

function buildCourseMindmap(topic, chapters = []) {
  return {
    label: topic || '成长主题',
    children: chapters.map(chapter => ({
      label: chapter.title,
      meta: `${chapter.duration || ''} · 难度 ${chapter.difficulty || 1}/5`,
      children: (chapter.points || []).slice(0, 6).map(point => ({ label: point })),
    })),
  };
}

function buildCourseMarkdown(topic, chapters = []) {
  const lines = [`# ${topic || '成长之路'}`, '', '> RAIO 成长之路自动生成的学习材料，可继续配合章节测验和思维导图使用。', ''];
  chapters.forEach((chapter, index) => {
    lines.push(`## ${index + 1}. ${chapter.title}`);
    lines.push('');
    lines.push(`- 难度：${chapter.difficulty || 1}/5`);
    lines.push(`- 预计时长：${chapter.duration || '待定'}`);
    lines.push('');
    lines.push(chapter.summary || '本章用于建立关键概念与实践路径。');
    lines.push('');
    lines.push('### 知识点');
    (chapter.points || []).forEach(point => lines.push(`- ${point}`));
    lines.push('');
    lines.push('### 学习文本');
    lines.push(chapter.learning_text || '本章详细学习材料尚未生成。请在章节详情中点击“生成本章材料”。');
    lines.push('');
    if (Array.isArray(chapter.resources) && chapter.resources.length) {
      lines.push('### 资源入口');
      chapter.resources.forEach(resource => lines.push(`- [${resource.label || resource.type || '资源'}](${resource.url})`));
      lines.push('');
    }
  });
  return lines.join('\n');
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

  outline = normalizeCourseOutline(outline, `微学习：${topic.slice(0, 60)}`);

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

function firstCrossrefAuthor(message = {}) {
  return (message.author || [])
    .map(author => [author.given, author.family].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(', ');
}

async function resolvePaperMetadata(input = '') {
  const value = String(input).trim();
  const doi = normalizeDoi(value);
  let crossref = null;
  let openAlex = null;

  if (doi) {
    const [crossrefResult, openAlexResult] = await Promise.allSettled([
      fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, 10000)
        .then(async response => response.ok ? (await response.json()).message : null),
      fetchWithTimeout(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`, 10000)
        .then(async response => response.ok ? response.json() : null),
    ]);
    crossref = crossrefResult.status === 'fulfilled' ? crossrefResult.value : null;
    openAlex = openAlexResult.status === 'fulfilled' ? openAlexResult.value : null;
  } else {
    const response = await fetchWithTimeout(
      `https://api.crossref.org/works?query.title=${encodeURIComponent(value)}&rows=1`,
      10000
    );
    if (response.ok) crossref = (await response.json()).message?.items?.[0] || null;
  }

  const resolvedDoi = normalizeDoi(crossref?.DOI || openAlex?.doi || doi);
  const title = crossref?.title?.[0] || openAlex?.title || value;
  const authors = firstCrossrefAuthor(crossref)
    || (openAlex?.authorships || []).map(item => item.author?.display_name).filter(Boolean).join(', ');
  const abstract = crossref?.abstract || openAlex?.abstract || '';
  const landingUrl = crossref?.URL || openAlex?.doi || (resolvedDoi ? `https://doi.org/${resolvedDoi}` : '');
  const oaLocation = openAlex?.best_oa_location || openAlex?.primary_location || null;

  return {
    doi: resolvedDoi,
    identifier_type: resolvedDoi ? 'doi' : 'title',
    title,
    authors,
    abstract: decodeXmlText(abstract),
    url: landingUrl,
    open_access: Boolean(openAlex?.open_access?.is_oa || oaLocation?.is_oa),
    pdf_url: oaLocation?.pdf_url || '',
    source: openAlex ? 'Crossref + OpenAlex' : 'Crossref',
  };
}

async function findOpenAccessPdf(doi) {
  if (!doi) return null;
  const candidates = [];
  const openAlexResponse = await fetchWithTimeout(
    `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`,
    10000
  );
  if (openAlexResponse.ok) {
    const work = await openAlexResponse.json();
    const location = work.best_oa_location || work.primary_location;
    if (location?.pdf_url) candidates.push({ url: location.pdf_url, source: 'OpenAlex OA' });
  }

  const email = process.env.UNPAYWALL_EMAIL?.trim();
  if (email) {
    const response = await fetchWithTimeout(
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`,
      10000
    );
    if (response.ok) {
      const work = await response.json();
      const location = work.best_oa_location;
      if (location?.url_for_pdf) candidates.unshift({ url: location.url_for_pdf, source: 'Unpaywall OA' });
    }
  }
  return candidates[0] || null;
}

app.post('/api/papers/resolve', authMiddleware, async (req, res) => {
  const input = req.body?.input || req.body?.doi || req.body?.title;
  if (!String(input || '').trim()) return res.status(400).json({ error: '请提供 DOI 或论文标题' });
  try {
    res.json(await resolvePaperMetadata(input));
  } catch (e) {
    res.status(502).json({ error: `论文元数据补全失败：${e.message}` });
  }
});

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
  const { arxiv_id, title, authors, abstract, url, doi } = req.body;
  const normalizedDoi = normalizeDoi(doi || url || title);
  const arxivFromUrl = extractArxivId(url);
  const cleanArxivId = String(arxiv_id || arxivFromUrl || '').trim();
  let identifierType = 'arxiv';
  let storageId = cleanArxivId;

  if (!storageId && normalizedDoi) {
    identifierType = 'doi';
    storageId = `doi:${sanitizeIdentifier(normalizedDoi)}`;
  } else if (!storageId && url) {
    identifierType = 'url';
    storageId = `url:${stableUrlId(url)}`;
  }

  if (!storageId) return res.status(400).json({ error: '论文标识不能为空，请提供 arXiv ID、DOI 或论文链接' });
  
  const existing = getOne("SELECT id FROM papers WHERE user_id = ? AND arxiv_id = ?", [req.user.userId, storageId]);
  if (existing) return res.status(400).json({ error: '已收藏该论文' });
  
  run("INSERT INTO papers (user_id, arxiv_id, doi, identifier_type, title, authors, abstract, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [req.user.userId, storageId, normalizedDoi, identifierType, title || normalizedDoi || url || storageId, authors || '', abstract || '', url || (normalizedDoi ? `https://doi.org/${normalizedDoi}` : '')]);
  const savedPaper = getOne(
    "SELECT * FROM papers WHERE user_id = ? AND arxiv_id = ?",
    [req.user.userId, storageId]
  );
  recordMemoryEvent(req.user.userId, {
    sourceType: 'paper_save',
    sourceId: String(savedPaper?.id || storageId),
    title: `收藏论文：${title || normalizedDoi || storageId}`,
    content: `作者：${authors || '未知'}\n摘要：${abstract || '暂无'}`,
    tags: ['图书馆', '论文', storageId],
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

// ============ 全文获取与解析工具 ============

async function fetchPaperFulltext(paperId, userId) {
  const paper = getOne("SELECT * FROM papers WHERE id = ? AND user_id = ?", [paperId, userId]);
  if (!paper) throw new Error('论文不存在');

  const existingPath = paper.pdf_path ? path.join(getDataDir(), 'pdfs', path.basename(paper.pdf_path)) : '';
  if (paper.pdf_status === 'fetched' && paper.pdf_path && fsSync.existsSync(existingPath)) {
    return {
      success: true,
      message: '全文已存在',
      pdf_path: paper.pdf_path,
      pdf_source: paper.pdf_source,
      pdf_status: paper.pdf_status,
      steps: [],
    };
  }

  run("UPDATE papers SET pdf_status = 'fetching' WHERE id = ?", [paperId]);
  saveDB();

  const steps = [];
  const logStep = (stepName, status, detail = '') => {
    steps.push({
      step: stepName,
      status: status,
      detail: detail,
      time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    });
  };

  const startTime = Date.now();
  logStep('初始化全文获取链', 'success', `Paper ID: ${paperId}, Title: ${paper.title}`);

  try {
    let buffer = null;
    let pdfSource = '';
    let storageIdentifier = paper.arxiv_id || paper.doi || paper.url || `paper-${paperId}`;
    const arxivId = isArxivIdentifier(paper.arxiv_id) ? paper.arxiv_id : extractArxivId(paper.url);

    if (arxivId) {
      const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
      storageIdentifier = arxivId;
      pdfSource = 'arXiv';
      logStep('解析文献标识符', 'success', `arXiv ID: ${arxivId}`);
      logStep('定位开放获取PDF', 'success', `arXiv URL: ${pdfUrl}`);
      logStep('开始下载PDF', 'pending', `尝试下载: ${pdfUrl}`);

      const response = await fetchWithTimeout(pdfUrl, 30000);
      if (!response.ok) {
        logStep('开始下载PDF', 'failed', `下载失败，HTTP状态码: ${response.status}`);
        throw new Error(`下载 PDF 失败，服务器返回状态码: ${response.status}`);
      }
      buffer = await readPdfBufferFromResponse(response);
      logStep('校验PDF文件', 'success', '文件头为 %PDF');
    } else {
      const doi = normalizeDoi(paper.doi || paper.url || paper.title);
      let oaCandidate = null;
      if (doi) {
        logStep('查询开放获取版本', 'pending', `DOI: ${doi}`);
        try {
          oaCandidate = await findOpenAccessPdf(doi);
        } catch (e) {
          logStep('查询开放获取版本', 'failed', e.message);
        }
      }

      if (oaCandidate?.url) {
        try {
          logStep('查询开放获取版本', 'success', `${oaCandidate.source}: ${oaCandidate.url}`);
          const oaResponse = await fetchWithTimeout(oaCandidate.url, 30000, {
            headers: {
              Accept: 'application/pdf',
              'User-Agent': 'RAIO/1.0 open-access-fulltext-fetch',
            },
          });
          if (!oaResponse.ok) throw new Error(`HTTP ${oaResponse.status}`);
          buffer = await readPdfBufferFromResponse(oaResponse);
          pdfSource = oaCandidate.source;
          storageIdentifier = doi;
          logStep('下载开放获取PDF', 'success', oaResponse.url || oaCandidate.url);
        } catch (e) {
          logStep('下载开放获取PDF', 'failed', `${e.message}，继续尝试论文落地页`);
        }
      }

      if (!buffer) {
        checkInstitutionalFetchRateLimit(userId);
        const landingUrl = paper.url || (doi ? `https://doi.org/${doi}` : '');
        if (!landingUrl) {
          logStep('解析文献标识符', 'failed', '未找到 arXiv ID、DOI 或论文链接');
          throw new Error('未找到可用于获取全文的 arXiv ID、DOI 或论文链接');
        }

        logStep('进入服务器网络单篇直取', 'success', '仅访问当前论文，不批量抓取，不自动登录，不绕过验证码');
        logStep('访问论文落地页', 'pending', landingUrl);
        const response = await fetchWithTimeout(landingUrl, 25000, {
          headers: {
            Accept: 'application/pdf,text/html,application/xhtml+xml',
            'User-Agent': 'RAIO/1.0 single-paper-fulltext-fetch',
          },
          redirect: 'follow',
        });
        if (!response.ok) {
          logStep('访问论文落地页', 'failed', `HTTP ${response.status}`);
          throw new Error(`服务器网络直取失败，落地页返回 HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (/application\/pdf/i.test(contentType) || /\.pdf(?:$|\?)/i.test(response.url || landingUrl)) {
          buffer = await readPdfBufferFromResponse(response);
          pdfSource = doi ? 'server DOI direct' : 'server URL direct';
          storageIdentifier = doi || landingUrl;
          logStep('获取PDF直链', 'success', response.url || landingUrl);
        } else {
          const html = await response.text();
          const pdfUrl = extractPdfUrlFromHtml(html, response.url || landingUrl);
          if (!pdfUrl) {
            logStep('查找PDF链接', 'failed', '落地页未暴露 citation_pdf_url 或直接 PDF 链接');
            throw new Error('服务器可访问页面中未找到直接 PDF 链接；若该库需要网页登录或验证码，请手动下载，后续再接入合规机构适配器');
          }
          logStep('查找PDF链接', 'success', pdfUrl);

          const pdfResponse = await fetchWithTimeout(pdfUrl, 30000, {
            headers: {
              Accept: 'application/pdf',
              Referer: response.url || landingUrl,
              'User-Agent': 'RAIO/1.0 single-paper-fulltext-fetch',
            },
            redirect: 'follow',
          });
          if (!pdfResponse.ok) {
            logStep('下载服务器PDF', 'failed', `HTTP ${pdfResponse.status}`);
            throw new Error(`服务器网络 PDF 下载失败，服务器返回 HTTP ${pdfResponse.status}`);
          }
          buffer = await readPdfBufferFromResponse(pdfResponse);
          pdfSource = doi ? 'server DOI' : 'server URL';
          storageIdentifier = doi || landingUrl;
          logStep('下载服务器PDF', 'success', pdfResponse.url || pdfUrl);
        }
      }
    }

    const { pdfsDir, relativePathForDb, absolutePath } = buildPdfStoragePath(storageIdentifier);
    if (!fsSync.existsSync(pdfsDir)) fsSync.mkdirSync(pdfsDir, { recursive: true });
    fsSync.writeFileSync(absolutePath, buffer);
    logStep('保存文件', 'success', `保存成功: ${relativePathForDb} (${buffer.length} 字节)`);

    run(
      "UPDATE papers SET pdf_status = 'fetched', pdf_path = ?, pdf_source = ? WHERE id = ?",
      [relativePathForDb, pdfSource, paperId]
    );
    logStep('获取全文完成', 'success');

    const duration = Date.now() - startTime;
    run(
      "INSERT INTO paper_fetch_runs (paper_id, steps, status, duration_ms, error) VALUES (?, ?, 'success', ?, '')",
      [paperId, JSON.stringify(steps), duration]
    );
    saveDB();

    return {
      success: true,
      pdf_path: relativePathForDb,
      pdf_source: pdfSource,
      pdf_status: 'fetched',
      steps: steps
    };
  } catch (e) {
    console.error('获取全文错误:', e);
    logStep('获取全文发生异常', 'failed', e.message);

    const duration = Date.now() - startTime;
    run("UPDATE papers SET pdf_status = 'failed' WHERE id = ?", [paperId]);
    run(
      "INSERT INTO paper_fetch_runs (paper_id, steps, status, duration_ms, error) VALUES (?, ?, 'failed', ?, ?)",
      [paperId, JSON.stringify(steps), duration, e.message]
    );
    saveDB();

    e.paperToolResult = {
      error: e.message || '获取全文失败',
      pdf_status: 'failed',
      steps: steps
    };
    throw e;
  }
}

app.post('/api/papers/:id/fulltext', authMiddleware, async (req, res) => {
  try {
    res.json(await fetchPaperFulltext(req.params.id, req.user.userId));
  } catch (e) {
    const status = e.message === '论文不存在' ? 404 : 500;
    res.status(status).json(e.paperToolResult || { error: e.message || '获取全文失败' });
  }
});

app.get('/api/papers/:id/fetch-runs', authMiddleware, (req, res) => {
  const paperId = req.params.id;
  const userId = req.user.userId;

  const paper = getOne("SELECT id FROM papers WHERE id = ? AND user_id = ?", [paperId, userId]);
  if (!paper) {
    return res.status(404).json({ error: '论文不存在' });
  }

  const runs = query("SELECT * FROM paper_fetch_runs WHERE paper_id = ? ORDER BY id DESC LIMIT 5", [paperId]);
  for (const r of runs) {
    try {
      r.steps = JSON.parse(r.steps || '[]');
    } catch (e) {
      r.steps = [];
    }
  }
  res.json(runs);
});

function getOwnedPaperPdf(paperId, userId) {
  const paper = getOne("SELECT * FROM papers WHERE id = ? AND user_id = ?", [paperId, userId]);
  if (!paper) throw new Error('论文不存在');
  if (paper.pdf_status !== 'fetched' || !paper.pdf_path) throw new Error('请先获取论文全文');

  const pdfRoot = path.resolve(getDataDir(), 'pdfs');
  const absolutePath = path.resolve(getDataDir(), paper.pdf_path);
  if (!absolutePath.startsWith(`${pdfRoot}${path.sep}`) || !fsSync.existsSync(absolutePath)) {
    throw new Error('PDF 文件不存在或路径无效');
  }
  return { paper, absolutePath };
}

async function parsePaperPdf(paperId, userId) {
  const { paper, absolutePath } = getOwnedPaperPdf(paperId, userId);
  const parsed = await parsePdfFile(absolutePath);

  run('DELETE FROM paper_sections WHERE paper_id = ?', [paperId]);
  for (const page of parsed.pages) {
    run(
      'INSERT INTO paper_sections (paper_id, page_number, section_title, content) VALUES (?, ?, ?, ?)',
      [paperId, page.page, page.title, page.content]
    );
  }
  saveDB();

  return {
    success: true,
    paper_id: Number(paperId),
    title: paper.title,
    page_count: parsed.pageCount,
    parsed_pages: parsed.pages.length,
    char_count: parsed.charCount,
  };
}

async function generatePaperEvidence(paperId, userId, aiConfig) {
  const paper = getOne("SELECT * FROM papers WHERE id = ? AND user_id = ?", [paperId, userId]);
  if (!paper) throw new Error('论文不存在');

  let sections = query(
    'SELECT page_number AS page, section_title AS title, content FROM paper_sections WHERE paper_id = ? ORDER BY page_number',
    [paperId]
  );
  if (!sections.length) {
    await parsePaperPdf(paperId, userId);
    sections = query(
      'SELECT page_number AS page, section_title AS title, content FROM paper_sections WHERE paper_id = ? ORDER BY page_number',
      [paperId]
    );
  }

  const context = buildEvidenceContext(sections, 45000);
  const coveredPages = new Set([...context.matchAll(/\[PAGE (\d+)\]/g)].map(match => Number(match[1]))).size;
  const prompt = `你是严谨的论文证据核验 Agent。请只依据下面带页码的论文原文生成总结，不得使用外部知识，不得把推断写成原文事实。

论文标题：${paper.title || ''}

严格返回 JSON，不要输出代码围栏或其他文字：
{
  "summary": "不超过200字的全文概述；材料不足时明确说明",
  "claims": [
    {
      "claim": "一条可核验结论",
      "page": 3,
      "snippet": "从该页逐字复制的原文片段，不超过180字符",
      "evidence_type": "method|experiment|result|limitation|other"
    }
  ]
}

要求：输出 3-8 条最重要结论；snippet 必须逐字来自指定页；没有足够证据就不要生成该结论。

论文原文：
${context}`;

  const result = await chatComplete(prompt, [], { agent: 'bloom', ...aiConfig });
  const parsed = extractJsonObject(result);
  const evidence = validateEvidenceClaims(parsed.claims, sections);
  const summary = String(parsed.summary || '').trim();

  run('DELETE FROM paper_evidence WHERE paper_id = ?', [paperId]);
  for (const item of evidence) {
    run(
      `INSERT INTO paper_evidence
        (paper_id, claim, page_number, snippet, evidence_type, confidence, verified, verification_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paperId,
        item.claim,
        item.page,
        item.snippet,
        item.evidence_type,
        item.confidence,
        item.verified ? 1 : 0,
        item.verification_note,
      ]
    );
  }
  run(
    `INSERT INTO paper_analyses (paper_id, summary, coverage_pages, total_pages, updated_at)
     VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
     ON CONFLICT(paper_id) DO UPDATE SET
       summary = excluded.summary,
       coverage_pages = excluded.coverage_pages,
       total_pages = excluded.total_pages,
       updated_at = excluded.updated_at`,
    [paperId, summary, coveredPages, sections.length]
  );
  saveDB();

  recordMemoryEvent(userId, {
    sourceType: 'paper_evidence',
    sourceId: String(paperId),
    title: `证据链总结：${paper.title || paper.arxiv_id}`,
    content: `${summary}\n${evidence.map(item => `- ${item.claim}（第${item.page || '?'}页）`).join('\n')}`,
    tags: ['图书馆', '证据链', evidence.every(item => item.verified) ? '已核验' : '待核验'],
    weight: 3,
    awards: { literature: 12, synthesis: 12, reflection: 8 },
  });

  return {
    success: true,
    paper_id: Number(paperId),
    title: paper.title,
    summary,
    coverage_pages: coveredPages,
    total_pages: sections.length,
    evidence,
    verified_count: evidence.filter(item => item.verified).length,
  };
}

function startAgentRun(userId, paperId, tool, input) {
  run(
    "INSERT INTO agent_runs (user_id, paper_id, tool, status, input) VALUES (?, ?, ?, 'running', ?)",
    [userId, paperId || null, tool, input || '']
  );
  return getOne('SELECT id FROM agent_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId])?.id;
}

function finishAgentRun(runId, status, output = '', error = '', startedAt = Date.now()) {
  if (!runId) return;
  run(
    'UPDATE agent_runs SET status = ?, output = ?, error = ?, duration_ms = ? WHERE id = ?',
    [status, output, error, Date.now() - startedAt, runId]
  );
  saveDB();
}

app.get('/api/papers/:id/pdf', authMiddleware, (req, res) => {
  try {
    const { paper, absolutePath } = getOwnedPaperPdf(req.params.id, req.user.userId);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `inline; filename="paper-${paper.id}.pdf"`);
    res.sendFile(absolutePath);
  } catch (e) {
    res.status(e.message === '论文不存在' ? 404 : 400).json({ error: e.message });
  }
});

app.post('/api/papers/:id/parse', authMiddleware, async (req, res) => {
  const startedAt = Date.now();
  const runId = startAgentRun(req.user.userId, Number(req.params.id), 'parse_pdf', `paper:${req.params.id}`);
  try {
    const result = await parsePaperPdf(req.params.id, req.user.userId);
    finishAgentRun(runId, 'success', JSON.stringify(result), '', startedAt);
    res.json(result);
  } catch (e) {
    finishAgentRun(runId, 'failed', '', e.message, startedAt);
    res.status(e.message === '论文不存在' ? 404 : 400).json({ error: e.message });
  }
});

app.post('/api/papers/:id/evidence-summary', authMiddleware, async (req, res) => {
  const aiConfig = getAIRequestConfig(req);
  if (aiConfig.error) return res.status(400).json({ error: aiConfig.error });
  const startedAt = Date.now();
  const runId = startAgentRun(req.user.userId, Number(req.params.id), 'evidence_summary', `paper:${req.params.id}`);
  try {
    const result = await generatePaperEvidence(req.params.id, req.user.userId, aiConfig);
    finishAgentRun(runId, 'success', JSON.stringify({ verified_count: result.verified_count }), '', startedAt);
    res.json(result);
  } catch (e) {
    finishAgentRun(runId, 'failed', '', e.message, startedAt);
    res.status(e.message === '论文不存在' ? 404 : 500).json({ error: e.message || '证据链总结失败' });
  }
});

app.get('/api/papers/:id/evidence', authMiddleware, (req, res) => {
  const paper = getOne('SELECT id FROM papers WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId]);
  if (!paper) return res.status(404).json({ error: '论文不存在' });
  const analysis = getOne('SELECT * FROM paper_analyses WHERE paper_id = ?', [req.params.id]);
  const evidence = query(
    `SELECT id, claim, page_number AS page, snippet, evidence_type, confidence,
            verified, verification_note, created_at
     FROM paper_evidence WHERE paper_id = ? ORDER BY id`,
    [req.params.id]
  );
  res.json({ analysis, evidence });
});

app.get('/api/agent/runs', authMiddleware, (req, res) => {
  const runs = query(
    `SELECT ar.*, p.title AS paper_title
     FROM agent_runs ar LEFT JOIN papers p ON p.id = ar.paper_id
     WHERE ar.user_id = ? ORDER BY ar.id DESC LIMIT 20`,
    [req.user.userId]
  );
  res.json(runs);
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
      c.outline = normalizeCourseOutline(c.outline, c.topic);
    } catch (e) {
      c.outline = normalizeCourseOutline({ chapters: [] }, c.topic);
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
生成5-7个章节，从基础到进阶。difficulty范围1-5。这里只生成路径规划，不要生成大段学习正文。外部资源优先给B站、YouTube、菜鸟教程或高质量博客的搜索/教程链接，不要编造不存在的具体课程。`;
    
    const result = await chatComplete(prompt, [], { agent: 'scholar', ...aiConfig });
    
    // 解析JSON
    let outline;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      outline = JSON.parse(jsonMatch[0]);
    } catch (e) {
      outline = { chapters: [{ title: topic, difficulty: 1, duration: "2小时", summary: "从基础概念开始建立学习框架。", points: ["基础知识"], resources: [] }] };
    }
    outline = normalizeCourseOutline(outline, topic);
    
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
      tags: ['成长之路', '学习路径', '思维导图'],
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

app.post('/api/learn/material', authMiddleware, async (req, res) => {
  try {
    const { courseId, chapterIdx, force } = req.body;
    const index = Number(chapterIdx);
    if (!courseId || !Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: '请提供有效的课程和章节' });
    }

    const aiConfig = getAIRequestConfig(req);
    if (aiConfig.error) return res.status(400).json({ error: aiConfig.error });

    const course = getOne(
      "SELECT * FROM learn_courses WHERE id = ? AND user_id = ?",
      [courseId, req.user.userId]
    );
    if (!course) return res.status(404).json({ error: '学习路径不存在' });

    let outline;
    try {
      outline = normalizeCourseOutline(JSON.parse(course.outline || '{}'), course.topic);
    } catch (e) {
      outline = normalizeCourseOutline({ chapters: [] }, course.topic);
    }

    const chapter = outline.chapters[index];
    if (!chapter) return res.status(404).json({ error: '章节不存在' });
    if (chapter.learning_text && !force) {
      course.outline = outline;
      course.progress = query("SELECT * FROM learn_progress WHERE course_id = ? ORDER BY chapter_idx", [course.id]);
      return res.json({ course, chapter, cached: true });
    }

    const prompt = `请为学习路径「${course.topic}」中的章节「${chapter.title}」生成一份具体、可直接阅读的中文学习材料。

章节摘要：${chapter.summary || '暂无'}
核心知识点：${(chapter.points || []).join('、') || chapter.title}
预计时长：${chapter.duration || '未指定'}
难度：${chapter.difficulty || 2}/5

请使用 Markdown 输出，内容要像正常对话中的知识讲解，而不是大纲。要求：
1. 先用通俗语言解释本章要解决什么问题。
2. 分小节讲清楚每个核心知识点，包含关键概念、直觉理解、常见误区。
3. 给出一个可操作的小练习或阅读任务。
4. 给出本章完成标准。
5. 不要编造不存在的具体课程、论文或链接。
6. 篇幅控制在 900-1400 字。`;

    const material = (await chatComplete(prompt, [], { agent: 'scholar', ...aiConfig })).trim();
    chapter.learning_text = material || '本章材料生成失败，请稍后重试。';
    outline = normalizeCourseOutline(outline, course.topic);

    run(
      "UPDATE learn_courses SET outline = ? WHERE id = ? AND user_id = ?",
      [JSON.stringify(outline), courseId, req.user.userId]
    );
    saveDB();

    const updatedCourse = getOne(
      "SELECT * FROM learn_courses WHERE id = ? AND user_id = ?",
      [courseId, req.user.userId]
    );
    updatedCourse.outline = outline;
    updatedCourse.progress = query("SELECT * FROM learn_progress WHERE course_id = ? ORDER BY chapter_idx", [courseId]);

    recordMemoryEvent(req.user.userId, {
      sourceType: 'learn_material',
      sourceId: `${courseId}:${index}`,
      title: `生成章节材料：${course.topic} / ${chapter.title}`,
      content: material,
      tags: ['成长之路', '章节材料', course.topic, chapter.title],
      weight: 2,
      dedupe: true,
      awards: { learning: 8, reflection: 4 },
    });

    res.json({ course: updatedCourse, chapter: outline.chapters[index], cached: false });
  } catch (e) {
    console.error('生成章节材料错误:', e);
    res.status(500).json({ error: '生成章节材料失败' });
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
    tags: ['成长之路', status],
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
        tags: ['新闻视野', '成长之路', topic, `course:${course.id}`],
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

// ============ 兼容旧版静态素材列表 ============

app.get('/api/stardew/list', (req, res) => {
  try {
    const dir = req.query.dir || '';
    const targetPath = path.join(legacyAssetsPath, dir);
    
    // 安全检查
    if (!targetPath.startsWith(legacyAssetsPath)) {
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

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'raio-agent',
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
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
    console.log(`\nRAIO 科研 Agent 服务已启动: http://localhost:${PORT}`);
    console.log(`前端开发服务器: http://localhost:5174`);
    console.log(`兼容静态素材路径: http://localhost:${PORT}/assets/stardew/`);
  });
}

start();
