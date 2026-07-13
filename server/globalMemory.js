import { getOne, query, run, saveDB } from './db.js';

export const RADAR_DOMAINS = [
  { key: 'literature', label: '文献力', color: '#4ecdc4' },
  { key: 'learning', label: '学习力', color: '#9bd67d' },
  { key: 'frontier', label: '前沿力', color: '#e8b830' },
  { key: 'synthesis', label: '推演力', color: '#c4a7e7' },
  { key: 'execution', label: '行动力', color: '#6ea8fe' },
  { key: 'reflection', label: '表达力', color: '#f6c177' },
];

const DOMAIN_KEYS = new Set(RADAR_DOMAINS.map(domain => domain.key));

function trimText(value = '', max = 900) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch (e) {
    return fallback;
  }
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.join(',');
  return String(tags || '');
}

export function awardExp(userId, domain, amount) {
  if (!DOMAIN_KEYS.has(domain) || !amount) return;
  const current = getOne(
    'SELECT exp FROM user_exp WHERE user_id = ? AND domain = ?',
    [userId, domain]
  );

  if (current) {
    run(
      "UPDATE user_exp SET exp = exp + ?, updated_at = datetime('now', 'localtime') WHERE user_id = ? AND domain = ?",
      [amount, userId, domain]
    );
  } else {
    run(
      'INSERT INTO user_exp (user_id, domain, exp) VALUES (?, ?, ?)',
      [userId, domain, amount]
    );
  }
}

export function awardExpBatch(userId, awards = {}) {
  Object.entries(awards).forEach(([domain, amount]) => awardExp(userId, domain, amount));
}

export function recordMemoryEvent(userId, event) {
  const sourceType = event.sourceType || 'activity';
  const sourceId = String(event.sourceId || '');
  if (event.dedupe && sourceId) {
    const existing = getOne(
      'SELECT id FROM global_memories WHERE user_id = ? AND source_type = ? AND source_id = ?',
      [userId, sourceType, sourceId]
    );
    if (existing) return false;
  }

  const title = trimText(event.title || '未命名记忆', 180);
  const content = trimText(event.content || '', 1400);
  const tags = normalizeTags(event.tags);

  run(
    `INSERT INTO global_memories (user_id, source_type, source_id, title, content, tags, weight)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      sourceType,
      sourceId,
      title,
      content,
      tags,
      Number(event.weight || 1),
    ]
  );

  if (event.awards) awardExpBatch(userId, event.awards);
  saveDB();
  return true;
}

function tokenize(text = '') {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9][a-z0-9+_.-]{1,}/g) || [];
  const chineseBlocks = lower.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const chinese = chineseBlocks.flatMap(block => {
    const terms = [block];
    for (let i = 0; i < block.length - 1; i += 1) {
      terms.push(block.slice(i, i + 2));
    }
    for (let i = 0; i < block.length - 2; i += 1) {
      terms.push(block.slice(i, i + 3));
    }
    return terms;
  });

  return unique([...latin, ...chinese])
    .filter(term => term.length >= 2)
    .slice(0, 28);
}

function dayDistance(createdAt) {
  if (!createdAt) return 999;
  const normalized = String(createdAt).replace(' ', 'T');
  const time = new Date(normalized).getTime();
  if (Number.isNaN(time)) return 999;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function scoreItem(item, terms, message) {
  const text = `${item.title} ${item.content} ${item.tags || ''}`.toLowerCase();
  let score = Number(item.weight || 1);

  for (const term of terms) {
    if (text.includes(term)) score += term.length > 3 ? 3 : 1.6;
  }

  const days = dayDistance(item.created_at || item.updated_at || item.saved_at);
  if (/昨天|昨日/.test(message) && days === 1) score += 6;
  if (/今天|今日|刚才|最近/.test(message) && days <= 2) score += 4;
  score += Math.max(0, 4 - Math.min(days, 4));

  return score;
}

function courseToMemory(course) {
  const outline = safeJsonParse(course.outline, { chapters: [] });
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters : [];
  const chapterText = chapters
    .slice(0, 6)
    .map((chapter, index) => `${index + 1}. ${chapter.title || ''}: ${(chapter.points || []).join('、')}`)
    .join('\n');

  return {
    source_type: 'learn_course',
    source_id: String(course.id),
    title: `学习路径：${course.topic}`,
    content: trimText(chapterText || course.topic, 900),
    tags: '成长之路,学习路径',
    weight: 1.8,
    created_at: course.created_at,
  };
}

export function buildUserRagContext(userId, message) {
  const terms = tokenize(message);
  const memories = query(
    `SELECT source_type, source_id, title, content, tags, weight, created_at
     FROM global_memories
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 80`,
    [userId]
  );

  const papers = query(
    `SELECT p.id, p.title, p.abstract, p.arxiv_id, p.saved_at, n.content AS note_content, n.updated_at
     FROM papers p
     LEFT JOIN notes n ON n.paper_id = p.id AND n.user_id = p.user_id
     WHERE p.user_id = ?
     ORDER BY p.saved_at DESC
     LIMIT 50`,
    [userId]
  ).map(paper => ({
    source_type: 'library',
    source_id: String(paper.id),
    title: `图书馆论文：${paper.title || paper.arxiv_id}`,
    content: trimText(`摘要：${paper.abstract || '暂无'}\n笔记：${paper.note_content || '暂无'}`, 1100),
    tags: `图书馆,论文,${paper.arxiv_id || ''}`,
    weight: paper.note_content ? 2.4 : 1.7,
    created_at: paper.updated_at || paper.saved_at,
  }));

  const courses = query(
    `SELECT id, topic, outline, created_at
     FROM learn_courses
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 35`,
    [userId]
  ).map(courseToMemory);

  const pool = [...memories, ...papers, ...courses];
  if (!pool.length) return { items: [], contextText: '' };

  const scored = pool
    .map(item => ({ ...item, score: scoreItem(item, terms, message) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const contextText = scored
    .map((item, index) => {
      const source = item.source_type === 'library'
        ? '图书馆'
        : item.source_type === 'learn_course'
          ? '成长之路'
          : item.source_type.includes('news')
            ? '新闻视野'
            : '全局记忆';
      return `${index + 1}. 【${source}】${item.title}\n${trimText(item.content, 520)}`;
    })
    .join('\n\n');

  return { items: scored, contextText };
}

function scoreFromExp(exp) {
  return Math.min(100, Math.round(100 * (1 - Math.exp(-Number(exp || 0) / 180))));
}

function getCounts(userId) {
  const paperCount = getOne('SELECT COUNT(*) AS cnt FROM papers WHERE user_id = ?', [userId])?.cnt || 0;
  const noteCount = getOne(
    "SELECT COUNT(*) AS cnt FROM notes WHERE user_id = ? AND length(trim(content)) > 0",
    [userId]
  )?.cnt || 0;
  const noteChars = getOne(
    "SELECT COALESCE(SUM(length(content)), 0) AS cnt FROM notes WHERE user_id = ?",
    [userId]
  )?.cnt || 0;
  const courseCount = getOne('SELECT COUNT(*) AS cnt FROM learn_courses WHERE user_id = ?', [userId])?.cnt || 0;
  const passedCount = getOne(
    `SELECT COUNT(*) AS cnt
     FROM learn_progress lp
     JOIN learn_courses lc ON lc.id = lp.course_id
     WHERE lc.user_id = ? AND lp.status = 'passed'`,
    [userId]
  )?.cnt || 0;
  const doneTodoCount = getOne(
    'SELECT COUNT(*) AS cnt FROM todos WHERE user_id = ? AND done = 1',
    [userId]
  )?.cnt || 0;
  const chatCount = getOne(
    "SELECT COUNT(*) AS cnt FROM chat_history WHERE user_id = ? AND role = 'user'",
    [userId]
  )?.cnt || 0;
  const newsFocusCount = getOne(
    "SELECT COUNT(*) AS cnt FROM global_memories WHERE user_id = ? AND source_type = 'news_focus'",
    [userId]
  )?.cnt || 0;

  return {
    paperCount,
    noteCount,
    noteChars,
    courseCount,
    passedCount,
    doneTodoCount,
    chatCount,
    newsFocusCount,
  };
}

export function ensureBaselineExp(userId) {
  const existing = getOne(
    "SELECT id FROM global_memories WHERE user_id = ? AND source_type = 'exp_baseline_v1'",
    [userId]
  );
  if (existing) return;

  const counts = getCounts(userId);
  const awards = {
    literature: counts.paperCount * 10 + counts.noteCount * 12,
    learning: counts.courseCount * 16 + counts.passedCount * 10,
    frontier: counts.newsFocusCount * 12,
    synthesis: counts.chatCount * 2,
    execution: counts.doneTodoCount * 6 + counts.passedCount * 4,
    reflection: Math.min(120, Math.floor(counts.noteChars / 90)),
  };

  recordMemoryEvent(userId, {
    sourceType: 'exp_baseline_v1',
    title: '历史学习行为基线画像',
    content: `论文 ${counts.paperCount} 篇，笔记 ${counts.noteCount} 条，学习路径 ${counts.courseCount} 条，已完成节点 ${counts.passedCount} 个。`,
    tags: ['画像', 'EXP', 'baseline'],
    weight: 0.4,
    awards,
  });
}

export function getGlobalRadar(userId) {
  ensureBaselineExp(userId);
  const rows = query('SELECT domain, exp FROM user_exp WHERE user_id = ?', [userId]);
  const expMap = Object.fromEntries(rows.map(row => [row.domain, Number(row.exp || 0)]));
  const memories = query(
    `SELECT id, source_type, title, content, tags, created_at
     FROM global_memories
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 8`,
    [userId]
  );

  const domains = RADAR_DOMAINS.map(domain => {
    const exp = expMap[domain.key] || 0;
    return {
      ...domain,
      exp,
      score: scoreFromExp(exp),
    };
  });

  return {
    domains,
    memories,
    counts: getCounts(userId),
  };
}

export function recordDailyNewsRead(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = getOne(
    "SELECT id FROM global_memories WHERE user_id = ? AND source_type = 'news_read' AND source_id = ?",
    [userId, today]
  );
  if (existing) return;

  recordMemoryEvent(userId, {
    sourceType: 'news_read',
    sourceId: today,
    title: `${today} 新闻视野阅读`,
    content: '用户打开新闻视野，完成一次前沿动态巡检。',
    tags: ['新闻视野', '每日阅读'],
    weight: 0.8,
    awards: { frontier: 4, execution: 1 },
  });
}
