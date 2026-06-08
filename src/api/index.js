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

export async function register(username, password) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, confirm_password: password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '注册失败');
  return data;
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '登录失败');
  return data;
}

export async function getProfile(token) {
  const res = await fetch(`${API_BASE}/user/profile`, { headers: getHeaders(token) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

export async function updateProfile(token, updates) {
  const res = await fetch(`${API_BASE}/user/profile`, {
    method: 'PUT',
    headers: getHeaders(token),
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function getTodos(token) {
  const res = await fetch(`${API_BASE}/todos`, { headers: getHeaders(token) });
  return res.json();
}

export async function addTodo(token, content) {
  const res = await fetch(`${API_BASE}/todos`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ content }),
  });
  return res.json();
}

export async function toggleTodo(token, id, done) {
  const res = await fetch(`${API_BASE}/todos/${id}`, {
    method: 'PUT',
    headers: getHeaders(token),
    body: JSON.stringify({ done }),
  });
  return res.json();
}

export async function deleteTodo(token, id) {
  const res = await fetch(`${API_BASE}/todos/${id}`, {
    method: 'DELETE',
    headers: getHeaders(token),
  });
  return res.json();
}

export async function getAchievements(token) {
  const res = await fetch(`${API_BASE}/achievements`, { headers: getHeaders(token) });
  return res.json();
}

export async function getGlobalRadar(token) {
  const res = await fetch(`${API_BASE}/global/radar`, { headers: getHeaders(token) });
  return res.json();
}

export async function getChatHistory(token) {
  const res = await fetch(`${API_BASE}/chat/history`, { headers: getHeaders(token) });
  return res.json();
}

export async function searchPapers(token, q) {
  const res = await fetch(`${API_BASE}/papers/search?q=${encodeURIComponent(q)}`, { headers: getHeaders(token) });
  return res.json();
}

export async function getSavedPapers(token) {
  const res = await fetch(`${API_BASE}/papers/saved`, { headers: getHeaders(token) });
  return res.json();
}

export async function savePaper(token, paper) {
  const res = await fetch(`${API_BASE}/papers/save`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(paper),
  });
  return res.json();
}

export async function removePaper(token, id) {
  const res = await fetch(`${API_BASE}/papers/${id}`, {
    method: 'DELETE',
    headers: getHeaders(token),
  });
  return res.json();
}

export async function getNote(token, paperId) {
  const res = await fetch(`${API_BASE}/notes/${paperId}`, { headers: getHeaders(token) });
  return res.json();
}

export async function saveNote(token, paperId, content) {
  const res = await fetch(`${API_BASE}/notes/${paperId}`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ content }),
  });
  return res.json();
}

export async function summarizePaper(token, paperId) {
  const res = await fetch(`${API_BASE}/papers/${paperId}/summary`, {
    method: 'POST',
    headers: getAIHeaders(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '论文总结失败');
  return data;
}

export async function getCourses(token) {
  const res = await fetch(`${API_BASE}/learn/courses`, { headers: getHeaders(token) });
  return res.json();
}

export async function generateCourse(token, topic) {
  const res = await fetch(`${API_BASE}/learn/generate`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify({ topic }),
  });
  return res.json();
}

export async function generateQuiz(token, data) {
  const res = await fetch(`${API_BASE}/learn/quiz`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateProgress(token, data) {
  const res = await fetch(`${API_BASE}/learn/progress`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getNews(token) {
  const res = await fetch(`${API_BASE}/news`, { headers: getHeaders(token) });
  return res.json();
}

export async function analyzeNews(token, item, question) {
  const res = await fetch(`${API_BASE}/news/analyze`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify({ item, question }),
  });
  return res.json();
}

export async function followNews(token, item) {
  const res = await fetch(`${API_BASE}/news/follow`, {
    method: 'POST',
    headers: getAIHeaders(token),
    body: JSON.stringify({ item }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '联动失败');
  return data;
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
