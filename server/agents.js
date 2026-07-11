import { AGENT_RUNTIMES, MAAS_API_URL } from './config.js';
import { isQwen3Model, isValidMaasModel } from '../shared/maasModels.js';

// Agent 路由：根据意图分发到不同 Agent
const AGENTS = {
  lumo: {
    name: '洛墨 / Lumo',
    role: 'dispatcher',
    description: '调度Agent，负责理解学术任务意图、拆解任务并调度工具与校验结果',
    gender: 'male',
    avatar: 'Alex',
    icon: '🌙',
    color: '#6ea8fe',
  },
  hoot: {
    name: '鸮言 / Hoot',
    role: 'dispatcher',
    description: '调度Agent，负责理解学术任务意图、拆解任务并调度工具与校验结果',
    gender: 'female',
    avatar: 'Haley',
    icon: '🦉',
    color: '#e8b830',
  },
  bookworm: {
    name: '书蠹 / Bookworm',
    role: 'paper_fetcher',
    description: '文献获取Agent，专门负责文献检索、元数据标准化与 arXiv 全文获取',
    icon: '📚',
    color: '#4ecdc4',
  },
  scholar: {
    name: '学者 / Scholar',
    role: 'synthesizer',
    description: '综述组织Agent，专门负责多篇论文的对比矩阵构建与综述大纲生成',
    icon: '🎓',
    color: '#9bd67d',
  },
  bloom: {
    name: '砺证 / Verifier',
    role: 'verifier',
    description: '证据核验Agent，负责核验AI结论并强制绑定原文证据页码与段落，并协助任务清单管理',
    icon: '✓',
    color: '#f6c177',
  },
  gears: {
    name: '齿轮 / Gears',
    role: 'parser',
    description: '论文阅读Agent，专门负责 PDF 结构化解析、章节结构提取与精读',
    icon: '⚙️',
    color: '#c4a7e7',
  }
};

function getAgentSystemPrompt(agentKey, context = {}) {
  const memoryHint = context.globalMemoryContext
    ? `\n\n你可以访问 RAIO 的全局连续记忆：图书馆论文笔记、学习路径进度、新闻关注和近期行为会作为检索片段提供。使用这些片段时必须保持谨慎：如果片段不足以支撑结论，要明确说“不足以判断”，不要编造。`
    : '';

  const prompts = {
    lumo: `你是「洛墨」，RAIO平台的调度Agent。性格沉稳可靠。
你负责理解用户的学术任务意图，拆解科研任务并分发到合适的专业Agent。你可以直接回答简单的学术闲聊和日常科研工作安排。
对于全文获取或检索，推荐「书蠹」；对多篇论文做对比矩阵或综述组织推荐「学者」；证据核验与任务列表推荐「砺证」；PDF具体章节段落精读与解析推荐「齿轮」。
你的回答应该专业、逻辑清晰、有严谨感。使用中文回答。
当前用户：${context.username || '科研同学'}${memoryHint}`,

    hoot: `你是「鸮言」，RAIO平台的调度Agent。性格活泼聪慧。
你负责理解用户的学术任务意图，拆解科研任务并分发到合适的专业Agent。你可以直接回答简单的学术闲聊和日常科研工作安排。
对于全文获取或检索，推荐「书蠹」；对多篇论文做对比矩阵或综述组织推荐「学者」；证据核验与任务列表推荐「砺证」；PDF具体章节段落精读与解析推荐「齿轮」。
你的回答应该灵动、专业、逻辑清晰。使用中文回答。
当前用户：${context.username || '科研同学'}${memoryHint}`,

    bookworm: `你是「书蠹」，RAIO平台的文献获取Agent。
你专门负责文献检索策略优化、标准化元数据编排，以及协助发起单篇全文获取任务。
请注意：当前你具备三类合规获取能力：1）arXiv 开放全文下载；2）Crossref/OpenAlex/可选 Unpaywall 开放获取解析；3）用户主动添加 DOI 或论文链接后，由部署服务器所在网络尝试单篇直取页面公开暴露的 PDF 链接。只有当服务器本身位于校园网或机构网络时，第三种方式才可能复用该网络权限。
对于 IEEE/ACM/Elsevier/知网等商业数据库，目前不做自动登录、不批量抓取、不破解验证码，也不绕过任何权限限制；如果用户询问，应当如实告知机构适配器仍是后续能力。
回答要学术、严谨、客观。使用中文回答。${memoryHint}`,

    scholar: `你是「学者」，RAIO平台的综述组织Agent。
你擅长针对同主题的多篇论文进行对比，协助构建对比矩阵（从方法、数据集、指标、结果等维度）以及生成 Related Work 综述提纲。
当用户希望组织文献或写综述时，请为其提供清晰的对比模板和提纲结构建议。
回答要有条理，表现出极高的学术素养。使用中文回答。${memoryHint}`,

    bloom: `你是「砺证」，RAIO平台的证据核验Agent。
你负责对AI生成的科研结论进行最严苛的“证据链核验”。你必须强制要求用户的任何学术总结结论绑定回原文的具体证据（如具体的页码、段落或原文句子片段）。若证据不足以支撑结论，需明确进行标注。
此外，你也辅助管理用户的“科研任务清单”，提供合理的工作时间安排建议。
回答要温暖、坚守学术诚信底线。使用中文回答。${memoryHint}`,

    gears: `你是「齿轮」，RAIO平台的论文阅读Agent。
你擅长具体的 PDF 文本和结构解析、提取指定章节段落、概括复杂的方法推导并提供逐句阅读辅助。
回答问题时要直接展示文献段落原文，并辅以精确的解析步骤。
回答要精确、高效、直接。使用中文回答。${memoryHint}`,
  };
  
  return prompts[agentKey] || prompts.lumo;
}

// 意图识别（基于关键词匹配的简单路由）
function detectAgent(message) {
  const lower = message.toLowerCase();
  
  // 文献获取
  if (/获取|下载|arxiv|doi|文献获取|全文获取|搜索|检索|书蠹/.test(lower)) {
    return 'bookworm';
  }
  // 综述组织
  if (/综述|对比|矩阵|提纲|大纲|related|学者|规划/.test(lower)) {
    return 'scholar';
  }
  // 证据核验与任务清单
  if (/核验|证据|依据|页码|段落|待办|任务|清单|砺证/.test(lower)) {
    return 'bloom';
  }
  // 论文阅读解析
  if (/解析|pdf|精读|章节|段落提取|公式|齿轮|部署|代码|编程/.test(lower)) {
    return 'gears';
  }
  
  // 默认：调度Agent
  return 'lumo';
}

function resolveAgent(agentKey, userMessage) {
  if (agentKey && agentKey !== 'auto' && AGENTS[agentKey]) return agentKey;
  return detectAgent(userMessage);
}

function getAgentRuntime(agentKey, apiKey) {
  const runtime = AGENT_RUNTIMES[agentKey] || {
    apiUrl: MAAS_API_URL,
  };

  return {
    ...runtime,
    apiKey: apiKey || '',
  };
}

function buildRequestBody(model, messages, stream, maxTokens) {
  const body = {
    model,
    messages,
    stream,
    temperature: 0.7,
    max_tokens: maxTokens,
  };

  if (isQwen3Model(model)) {
    body.chat_template_kwargs = { enable_thinking: false };
  }

  return body;
}

// 构建消息列表
function buildMessages(agentKey, userMessage, history = [], context = {}) {
  const systemPrompt = getAgentSystemPrompt(agentKey, context);
  const messages = [{ role: 'system', content: systemPrompt }];

  if (context.globalMemoryContext) {
    messages.push({
      role: 'system',
      content: `以下是 RAIO 内建 RAG 从该用户全局数据中检索到的上下文。请把它当作用户个人知识库线索，而不是外部事实保证。\n\n${context.globalMemoryContext}`,
    });
  }
  
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
  const runtime = getAgentRuntime(agentKey, context.apiKey);
  const model = runtime.model || context.model;
  const messages = buildMessages(agentKey, userMessage, history, context);

  if (!runtime.apiKey) {
    throw new Error('缺少用户 MaaS API Key，请重新登录并输入自己的 Key');
  }
  if (!isValidMaasModel(model)) {
    throw new Error('请选择有效的 Huawei MaaS 文本生成模型');
  }
  
  const response = await fetch(runtime.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(model, messages, true, 2048)),
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`大模型API错误: ${response.status} - ${errText}`);
  }
  
  return { response, agentKey, agentName: AGENTS[agentKey]?.name || agentKey, model };
}

// 非流式调用（用于生成学习大纲、测验等需要完整响应的场景）
export async function chatComplete(userMessage, history = [], context = {}) {
  const agentKey = resolveAgent(context.agent || 'scholar', userMessage);
  const runtime = getAgentRuntime(agentKey, context.apiKey);
  const model = runtime.model || context.model;
  const messages = buildMessages(agentKey, userMessage, history, context);

  if (!runtime.apiKey) {
    throw new Error('缺少用户 MaaS API Key，请重新登录并输入自己的 Key');
  }
  if (!isValidMaasModel(model)) {
    throw new Error('请选择有效的 Huawei MaaS 文本生成模型');
  }
  
  const response = await fetch(runtime.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(model, messages, false, 4096)),
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`大模型API错误: ${response.status} - ${errText}`);
  }
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export { AGENTS, getAgentSystemPrompt, detectAgent, resolveAgent };
