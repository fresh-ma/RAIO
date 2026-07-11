import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.RAIO_DB_PATH || path.join(__dirname, '..', 'data', 'raio.db');

let db = null;
let saveTimer = null;

function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function initDB() {
  ensureDataDir();
  
  const SQL = await initSqlJs();
  
  // 如果已有数据库文件则加载
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  
  createTables();
  seedAchievements();
  
  // 自动保存（每5秒）
  saveTimer = setInterval(saveDB, 5000);
  
  console.log('[DB] SQLite 数据库初始化完成');
  return db;
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      display_id  TEXT,
      avatar      TEXT DEFAULT 'Alex',
      location    TEXT DEFAULT '',
      email       TEXT DEFAULT '',
      gender      INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS todos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      content     TEXT NOT NULL,
      done        INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS achievements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      icon        TEXT DEFAULT '⭐'
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id         INTEGER NOT NULL,
      achievement_id   INTEGER NOT NULL,
      unlocked_at     TEXT DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (user_id, achievement_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (achievement_id) REFERENCES achievements(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS papers (
	      id          INTEGER PRIMARY KEY AUTOINCREMENT,
	      user_id     INTEGER NOT NULL,
	      arxiv_id    TEXT NOT NULL,
	      doi         TEXT DEFAULT '',
	      identifier_type TEXT DEFAULT 'arxiv',
	      title       TEXT,
	      authors     TEXT,
	      abstract    TEXT,
      url         TEXT,
      saved_at    TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, arxiv_id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      paper_id    INTEGER NOT NULL,
      content     TEXT DEFAULT '',
      updated_at  TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS learn_courses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      topic       TEXT NOT NULL,
      outline     TEXT,
      created_at  TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS learn_progress (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id   INTEGER NOT NULL,
      chapter_idx INTEGER NOT NULL,
      status      TEXT DEFAULT 'pending',
      score       INTEGER DEFAULT 0,
      updated_at  TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (course_id) REFERENCES learn_courses(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      agent       TEXT DEFAULT 'lumo',
      created_at  TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS global_memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id   TEXT DEFAULT '',
      title       TEXT NOT NULL,
      content     TEXT DEFAULT '',
      tags        TEXT DEFAULT '',
      weight      REAL DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_exp (
      user_id     INTEGER NOT NULL,
      domain      TEXT NOT NULL,
      exp         INTEGER DEFAULT 0,
      updated_at  TEXT DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (user_id, domain),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 检查 papers 表是否有全文获取相关扩展列，如果没有则新增
  try {
    const cols = db.exec("PRAGMA table_info(papers)");
    if (cols[0]) {
      const colNames = cols[0].values.map(row => row[1]);
      let altered = false;
      if (!colNames.includes('doi')) {
        db.run("ALTER TABLE papers ADD COLUMN doi TEXT DEFAULT ''");
        altered = true;
      }
      if (!colNames.includes('identifier_type')) {
        db.run("ALTER TABLE papers ADD COLUMN identifier_type TEXT DEFAULT 'arxiv'");
        altered = true;
      }
      if (!colNames.includes('pdf_path')) {
        db.run("ALTER TABLE papers ADD COLUMN pdf_path TEXT DEFAULT NULL");
        altered = true;
      }
      if (!colNames.includes('pdf_source')) {
        db.run("ALTER TABLE papers ADD COLUMN pdf_source TEXT DEFAULT NULL");
        altered = true;
      }
      if (!colNames.includes('pdf_status')) {
        db.run("ALTER TABLE papers ADD COLUMN pdf_status TEXT DEFAULT 'not_fetched'");
        altered = true;
      }
      if (altered) {
        saveDB();
        console.log('[DB] papers 表结构升级成功，并已同步写入磁盘');
      }
    }
  } catch (e) {
    console.error('[DB] 升级 papers 表结构失败:', e.message);
  }

  // 检查 paper_fetch_runs 表是否有 duration_ms
  try {
    const cols = db.exec("PRAGMA table_info(paper_fetch_runs)");
    if (cols[0]) {
      const colNames = cols[0].values.map(row => row[1]);
      if (!colNames.includes('duration_ms')) {
        db.run("ALTER TABLE paper_fetch_runs ADD COLUMN duration_ms INTEGER DEFAULT 0");
        saveDB();
        console.log('[DB] paper_fetch_runs 表结构升级成功，已新增 duration_ms');
      }
    }
  } catch (e) {
    console.error('[DB] 升级 paper_fetch_runs 表结构失败:', e.message);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS paper_fetch_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id    INTEGER NOT NULL,
      steps       TEXT DEFAULT '',
      status      TEXT DEFAULT 'pending',
      duration_ms INTEGER DEFAULT 0,
      error       TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paper_sections (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id      INTEGER NOT NULL,
      page_number   INTEGER NOT NULL,
      section_title TEXT DEFAULT '',
      content       TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(paper_id, page_number),
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paper_evidence (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id          INTEGER NOT NULL,
      claim             TEXT NOT NULL,
      page_number       INTEGER,
      snippet           TEXT DEFAULT '',
      evidence_type     TEXT DEFAULT 'other',
      confidence        TEXT DEFAULT 'low',
      verified          INTEGER DEFAULT 0,
      verification_note TEXT DEFAULT '',
      created_at        TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paper_analyses (
      paper_id       INTEGER PRIMARY KEY,
      summary        TEXT DEFAULT '',
      coverage_pages INTEGER DEFAULT 0,
      total_pages    INTEGER DEFAULT 0,
      updated_at     TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      paper_id    INTEGER,
      tool        TEXT NOT NULL,
      status      TEXT DEFAULT 'running',
      input       TEXT DEFAULT '',
      output      TEXT DEFAULT '',
      error       TEXT DEFAULT '',
      duration_ms INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_paper_sections_paper ON paper_sections(paper_id, page_number)');
  db.run('CREATE INDEX IF NOT EXISTS idx_paper_evidence_paper ON paper_evidence(paper_id, page_number)');
  db.run('CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, id)');
  saveDB();
}

function seedAchievements() {
  const count = db.exec("SELECT COUNT(*) as cnt FROM achievements");
  if (count[0] && count[0].values[0][0] > 0) return;
  
  const achievements = [
    { code: 'first_login', name: '初来乍到', description: '首次登录RAIO', icon: '🏠' },
    { code: 'first_chat', name: '打开话匣子', description: '第一次与Agent聊天', icon: '💬' },
    { code: 'first_paper', name: '点亮图书馆', description: '收藏第一篇论文', icon: '📚' },
    { code: 'first_note', name: '笔记小能手', description: '给论文写第一条笔记', icon: '📝' },
    { code: 'first_todo', name: '立志之人', description: '添加第一个待办事项', icon: '✅' },
    { code: 'todo_7', name: '天选打工人', description: '待办事项超过7个', icon: '🔥' },
    { code: 'first_learn', name: '学海无涯', description: '开始第一个学习路径', icon: '🎓' },
    { code: 'first_quiz', name: '初试锋芒', description: '完成第一次测验', icon: '⚔️' },
    { code: 'paper_5', name: '论文收藏家', description: '收藏5篇论文', icon: '📖' },
    { code: 'chat_10', name: '话唠学者', description: '与Agent聊天超过10次', icon: '🗣️' },
  ];
  
  for (const a of achievements) {
    db.run(
      "INSERT OR IGNORE INTO achievements (code, name, description, icon) VALUES (?, ?, ?, ?)",
      [a.code, a.name, a.description, a.icon]
    );
  }
  saveDB();
}

export function saveDB() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('[DB] 保存失败:', e.message);
  }
}

export function getDB() {
  return db;
}

// 查询辅助
export function query(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result[0]) return [];
  return result[0].values.map(row => {
    const obj = {};
    result[0].columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

export function run(sql, params = []) {
  db.run(sql, params);
  return db.getRowsModified();
}

export function getOne(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

// 检查并解锁成就
export function checkAchievement(userId, code) {
  const ach = getOne("SELECT id FROM achievements WHERE code = ?", [code]);
  if (!ach) return false;
  
  const existing = getOne(
    "SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_id = ?",
    [userId, ach.id]
  );
  if (existing) return false;
  
  run(
    "INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)",
    [userId, ach.id]
  );
  saveDB();
  return true;
}
