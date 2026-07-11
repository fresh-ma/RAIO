const API_BASE = '/api';

function getHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function getUserApiKey() {
  return localStorage.getItem('raio_maas_api_key') || '';
}

function getUserModel() {
  return localStorage.getItem('raio_maas_model') || '';
}

function getAIHeaders(token) {
  const apiKey = getUserApiKey();
  const model = getUserModel();
  return {
    ...getHeaders(token),
    ...(apiKey ? { 'X-MAAS-API-KEY': apiKey } : {}),
    ...(model ? { 'X-MAAS-MODEL': model } : {}),
  };
}

async function readJson(res, fallbackMessage = '请求失败') {
  if (res.status === 401) {
    localStorage.removeItem('raio_token');
    localStorage.removeItem('raio_user');
    window.location.href = '/login';
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

export async function register(username, password) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, confirm_password: password }),
  });
  return readJson(res, '注册失败');
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return readJson(res, '登录失败');
}

export async function getProfile(token) {
  const res = await fetch(`${API_BASE}/user/profile`, { headers: getHeaders(token) });
  return readJson(res, '获取用户信息失败');
}

export async function updateProfile(token, updates) {
  const res = await fetch(`${API_BASE}/user/profile`, {
    method: 'PUT',
    headers: getHeaders(token),
    body: JSON.stringify(updates),
  });
  return readJson(res, '更新用户信息失败');
}

export async function getTodos(token) {
  const res = await fetch(`${API_BASE}/todos`, { headers: getHeaders(token) });
  return readJson(res, '获取待办失败');
}

export async function addTodo(token, content) {
  const res = await fetch(`${API_BASE}/todos`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ content }),
  });
  return readJson(res, '添加待办失败');
}

export async function toggleTodo(token, id, done) {
  const res = await fetch(`${API_BASE}/todos/${id}`, {
    method: 'PUT',
    headers: getHeaders(token),
    body: JSON.stringify({ done }),
  });
  return readJson(res, '更新待办失败');
}

export async function deleteTodo(token, id) {
  const res = await fetch(`${API_BASE}/todos/${id}`, {
    method: 'DELETE',
    headers: getHeaders(token),
  });
  return readJson(res, '删除待办失败');
}

export async function getAchievements(token) {
  const res = await fetch(`${API_BASE}/achievements`, { headers: getHeaders(token) });
  return readJson(res, '获取成就失败');
}

export async function getGlobalRadar(token) {
  const res = await fetch(`${API_BASE}/global/radar`, { headers: getHeaders(token) });
  return readJson(res, '获取全局画像失败');
}

export async function getChatHistory(token) {
  const res = await fetch(`${API_BASE}/chat/history`, { headers: getHeaders(token) });
  return readJson(res, '获取聊天历史失败');
}

export async function searchPapers(token, q) {
  const res = await fetch(`${API_BASE}/papers/search?q=${encodeURIComponent(q)}`, { headers: getHeaders(token) });
  return readJson(res, '论文搜索失败');
}

export async function getSavedPapers(token) {
  const res = await fetch(`${API_BASE}/papers/saved`, { headers: getHeaders(token) });
  return readJson(res, '获取收藏论文失败');
}

export async function savePaper(token, paper) {
  const res = await fetch(`${API_BASE}/papers/save`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(paper),
  });
  return readJson(res, '收藏论文失败');
}

export async function resolvePaper(token, input) {
  const res = await fetch(`${API_BASE}/papers/resolve`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ input }),
  });
  return readJson(res, '论文元数据补全失败');
}

export async function removePaper(token, id) {
  const res = await fetch(`${API_BASE}/papers/${id}`, {
    method: 'DELETE',
    headers: getHeaders(token),
  });
  return readJson(res, '移除论文失败');
}

export async function getNote(token, paperId) {
  const res = await fetch(`${API_BASE}/notes/${paperId}`, { headers: getHeaders(token) });
  return readJson(res, '获取笔记失败');
}

export async function saveNote(token, paperId, content) {
  const res = await fetch(`${API_BASE}/notes/${paperId}`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ content }),
  });
  return readJson(res, '保存笔记失败');
}

export async function summarizePaper(token, paperId) {
  const res = await fetch(`${API_BASE}/papers/${paperId}/summary`, {
    method: 'POST',
    headers: getAIHeaders(token),
  });
  return readJson(res, '论文总结失败');
}

export async function getFulltext(token, paperId) {
  const res = await fetch(`${API_BASE}/papers/${paperId}/fulltext`, {
    method: 'POST',
    headers: getHeaders(token),
  });
  return readJson(res, '获取全文失败');
}

export async function getFetchRuns(token, paperId) {
  const res = await fetch(`${API_BASE}/papers/${paperId}/fetch-runs`, {
    headers: getHeaders(token),
  });
  return readJson(res, '获取全文日志失败');
}

export async function getPaperPdfBlob(token, paperId) {
  const res = await fetch(`${API_BASE}/papers/${paperId}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '打开PDF失败');
  }
  return res.blob();
}

export async function parsePaper(token, paperId) {
  const res = await fetch(`${API_BASE}/papers/${paperId}/parse`, {
    method: 'POST',
    headers: getHeaders(token),
  });
  return readJson(res, 'PDF解析失败');
}

export async function generateEvidenceSummary(token, paperId) {
  const res = await fetch(`${API_BASE}/papers/${paperId}/evidence-summary`, {
    method: 'POST',
    headers: getAIHeaders(token),
  });
  return readJson(res, '证据链总结失败');
}

export async function getPaperEvidence(token, paperId) {
  const res = await fetch(`${API_BASE}/papers/${paperId}/evidence`, {
    headers: getHeaders(token),
  });
  return readJson(res, '获取证据链失败');
}

export async function getAgentRuns(token) {
  const res = await fetch(`${API_BASE}/agent/runs`, { headers: getHeaders(token) });
  return readJson(res, '获取Agent执行记录失败');
}

export async function getCourses(token) {
  const res = await fetch(`${API_BASE}/learn/courses`, { headers: getHeaders(token) });
  return readJson(res, '获取学习路径失败');
}

export async function generateCourse(token, topic) {
  const res = await fetch(`${API_BASE}/learn/generate`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify({ topic }),
  });
  return readJson(res, '生成学习路径失败');
}

export async function generateQuiz(token, data) {
  const res = await fetch(`${API_BASE}/learn/quiz`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify(data),
  });
  return readJson(res, '生成测验失败');
}

export async function updateProgress(token, data) {
  const res = await fetch(`${API_BASE}/learn/progress`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(data),
  });
  return readJson(res, '更新学习进度失败');
}

export async function getNews(token) {
  const res = await fetch(`${API_BASE}/news`, { headers: getHeaders(token) });
  return readJson(res, '获取新闻失败');
}

export async function analyzeNews(token, item, question) {
  const res = await fetch(`${API_BASE}/news/analyze`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify({ item, question }),
  });
  return readJson(res, '新闻解析失败');
}

export async function followNews(token, item) {
  const res = await fetch(`${API_BASE}/news/follow`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify({ item }),
  });
  return readJson(res, '联动失败');
}

// SSE 流式聊天
export function streamChat(token, message, agent, onChunk, onDone, onError, onAgentInfo) {
  const controller = new AbortController();
  const body = { message };
  if (agent && agent !== 'auto') body.agent = agent;
  
  fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('raio_token');
          localStorage.removeItem('raio_user');
          window.location.href = '/login';
          return;
        }
        const err = await res.json().catch(() => ({ error: '请求失败' }));
        onError(err.error || '聊天服务错误');
        return;
      }
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              onDone();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'agent' && onAgentInfo) {
                onAgentInfo(parsed);
              } else if (parsed.type === 'content') {
                onChunk(parsed.content);
              } else if (parsed.type === 'error') {
                onError(parsed.error);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
      onDone();
    })
    .catch((e) => {
      if (e.name !== 'AbortError') {
        onError(e.message || '网络错误');
      }
    });
  
  return () => controller.abort();
}
