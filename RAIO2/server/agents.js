import { AGENT_RUNTIMES, MAAS_API_URL, MAAS_API_KEY, MAAS_MODEL } from './config.js';

// Agent 路由：根据意图分发到不同 Agent
const AGENTS = {
  lumo: {
    name: '洛墨 / Lumo',
    role: 'dispatcher',
    description: '调度Agent，负责理解用户意图并分配任务',
    gender: 'male',
    avatar: 'Alex',
    icon: '🌙',
    color: '#6ea8fe',
  },
  hoot: {
    name: '鸮言 / Hoot',
    role: 'dispatcher',
    description: '调度Agent，负责理解用户意图并分配任务',
    gender: 'female',
    avatar: 'Haley',
    icon: '🦉',
    color: '#e8b830',
  },
  bookworm: {
    name: '书蠹 / Bookworm',
    role: 'paper',
    description: '论文相关Agent，擅长论文搜索、总结、推荐',
    icon: '📚',
    color: '#4ecdc4',
  },
  scholar: {
    name: '学者 / Scholar',
    role: 'learn',
    description: '学习路径Agent，擅长制定学习计划、出题测验',
    icon: '🎓',
    color: '#9bd67d',
  },
  bloom: {
    name: '花匠 / Bloom',
    role: 'life',
    description: '生活管理Agent，擅长待办管理、情绪关怀',
    icon: '🌻',
    color: '#f6c177',
  },
  gears: {
    name: '齿轮 / Gears',
    role: 'server',
    description: '技术服务Agent，擅长服务器运维、编程辅助',
    icon: '⚙️',
    color: '#c4a7e7',
  }
};

function getAgentSystemPrompt(agentKey, context = {}) {
  const prompts = {
    lumo: `你是「洛墨」，RAIO平台的男性调度Agent。你的名字来源于"luminous"（光），性格沉稳可靠。
你负责理解用户意图，决定由哪个专业Agent来处理。你可以直接回答简单的闲聊和日常问题。
对于论文相关问题，建议用户去找「书蠹」；学习规划找「学者」；生活琐事找「花匠」；技术问题找「齿轮」。
你的回答应该温暖、专业、有幽默感。使用中文回答。
当前用户：${context.username || '科研同学'}`,

    hoot: `你是「鸮言」，RAIO平台的女性调度Agent。你的名字来源于猫头鹰的叫声（hoot），性格活泼聪慧。
你负责理解用户意图，决定由哪个专业Agent来处理。你可以直接回答简单的闲聊和日常问题。
对于论文相关问题，建议用户去找「书蠹」；学习规划找「学者」；生活琐事找「花匠」；技术问题找「齿轮」。
你的回答应该灵动、幽默、充满活力。使用中文回答。
当前用户：${context.username || '科研同学'}`,

    bookworm: `你是「书蠹」，RAIO平台的论文Agent。名字来源于书虫（bookworm），但更有文化气息。
你擅长：论文搜索策略优化、论文摘要总结、研究路线梳理、经典论文推荐。
当用户搜索论文时，给出关键词建议和搜索策略；当用户收藏论文时，提供简要点评和相关论文推荐。
回答要学术但不枯燥，像图书馆管理员一样亲切专业。使用中文回答。`,

    scholar: `你是「学者」，RAIO平台的学习规划Agent。
你擅长：制定学习大纲、拆解知识点、设计测验题、推荐学习资源。
生成学习大纲时，按章节组织，每个章节包含：标题、难度（1-5⭐）、预计时长、核心知识点。
测验题全部设计为选择题（4个选项），每章4题，包含解析。
回答要有条理，像耐心的导师。使用中文回答。`,

    bloom: `你是「花匠」，RAIO平台的生活管理Agent。
你擅长：待办事项管理建议、情绪疏导、科研生活平衡建议、习惯养成。
你会关心用户的情绪状态，在用户压力大时给予鼓励，在用户取得进展时给予祝贺。
回答要温暖治愈，像星露谷的邻居一样。使用中文回答。`,

    gears: `你是「齿轮」，RAIO平台的技术服务Agent。
你擅长：编程问题解答、服务器运维建议、开发工具推荐、技术方案评审。
回答问题时要给出可操作的步骤和代码示例。
回答要精确、高效、直接。使用中文回答。`,
  };
  
  return prompts[agentKey] || prompts.lumo;
}

// 意图识别（基于关键词匹配的简单路由）
function detectAgent(message) {
  const lower = message.toLowerCase();
  
  // 论文相关
  if (/论文|paper|arxiv|搜索|文献|引用|期刊|发表|阅读|笔记/.test(lower)) {
    return 'bookworm';
  }
  // 学习相关
  if (/学习|课程|测验|练习|路径|大纲|知识点|教程/.test(lower)) {
    return 'scholar';
  }
  // 生活相关
  if (/待办|todo|心情|压力|休息|习惯|加油|累|焦虑/.test(lower)) {
    return 'bloom';
  }
  // 技术相关
  if (/代码|服务器|部署|编程|bug|api|docker|ssh/.test(lower)) {
    return 'gears';
  }
  
  // 默认：调度Agent
  return 'lumo';
}

function resolveAgent(agentKey, userMessage) {
  if (agentKey && agentKey !== 'auto' && AGENTS[agentKey]) return agentKey;
  return detectAgent(userMessage);
}

function getAgentRuntime(agentKey) {
  return AGENT_RUNTIMES[agentKey] || {
    apiUrl: MAAS_API_URL,
    apiKey: MAAS_API_KEY,
    model: MAAS_MODEL,
  };
}

// 构建消息列表
function buildMessages(agentKey, userMessage, history = [], context = {}) {
  const systemPrompt = getAgentSystemPrompt(agentKey, context);
  const messages = [{ role: 'system', content: systemPrompt }];
  
  // 添加历史消息（最近10条）
  const recent = history.slice(-10);
  for (const msg of recent) {
    messages.push({ role: msg.role, content: msg.content });
  }
  
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// SSE 流式调用大模型
export async function streamChat(userMessage, history = [], context = {}) {
  const agentKey = resolveAgent(context.agent, userMessage);
  const runtime = getAgentRuntime(agentKey);
  const messages = buildMessages(agentKey, userMessage, history, context);
  
  const response = await fetch(runtime.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify({
      model: runtime.model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`大模型API错误: ${response.status} - ${errText}`);
  }
  
  return { response, agentKey, agentName: AGENTS[agentKey]?.name || agentKey, model: runtime.model };
}

// 非流式调用（用于生成学习大纲、测验等需要完整响应的场景）
export async function chatComplete(userMessage, history = [], context = {}) {
  const agentKey = resolveAgent(context.agent || 'scholar', userMessage);
  const runtime = getAgentRuntime(agentKey);
  const messages = buildMessages(agentKey, userMessage, history, context);
  
  const response = await fetch(runtime.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify({
      model: runtime.model,
      messages,
      stream: false,
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`大模型API错误: ${response.status} - ${errText}`);
  }
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export { AGENTS, getAgentSystemPrompt, detectAgent, resolveAgent };
