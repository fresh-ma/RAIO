import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../store/AuthContext';
import { streamChat, getTodos, addTodo, toggleTodo, deleteTodo, getAchievements } from '../api';

export default function HomePage() {
  const { user, token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAgent, setCurrentAgent] = useState('lumo');
  const [todos, setTodos] = useState([]);
  const [todoInput, setTodoInput] = useState('');
  const [achievements, setAchievements] = useState([]);
  const [newAchievement, setNewAchievement] = useState(null);
  const chatEndRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    loadData();
  }, [token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadData() {
    if (!token) return;
    try {
      const [t, a] = await Promise.all([getTodos(token), getAchievements(token)]);
      setTodos(t);
      setAchievements(a);
    } catch (e) {
      console.error('加载数据失败:', e);
    }
  }

  function handleSend() {
    if (!input.trim() || isStreaming) return;
    
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setIsStreaming(true);
    
    let fullContent = '';
    
    abortRef.current = streamChat(
      token,
      msg,
      user?.gender === 1 ? 'hoot' : 'lumo',
      // onChunk
      (chunk) => {
        fullContent += chunk;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last?.streaming) {
            return [...prev.slice(0, -1), { ...last, content: fullContent }];
          }
          return [...prev, { role: 'assistant', content: fullContent, streaming: true, agent: currentAgent }];
        });
      },
      // onDone
      () => {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.streaming) {
            return [...prev.slice(0, -1), { ...last, streaming: false }];
          }
          return prev;
        });
        setIsStreaming(false);
        loadData(); // 刷新成就
      },
      // onError
      (err) => {
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ 错误: ${err}`, agent: 'system' }]);
        setIsStreaming(false);
      },
      // onAgentInfo
      (info) => {
        setCurrentAgent(info.agent);
      }
    );
  }

  async function handleAddTodo() {
    if (!todoInput.trim()) return;
    try {
      const newTodos = await addTodo(token, todoInput.trim());
      setTodos(newTodos);
      setTodoInput('');
    } catch (e) {
      console.error('添加待办失败:', e);
    }
  }

  async function handleToggleTodo(id, done) {
    try {
      const newTodos = await toggleTodo(token, id, !done);
      setTodos(newTodos);
    } catch (e) {
      console.error('切换待办失败:', e);
    }
  }

  async function handleDeleteTodo(id) {
    try {
      const newTodos = await deleteTodo(token, id);
      setTodos(newTodos);
    } catch (e) {
      console.error('删除待办失败:', e);
    }
  }

  const unlockedAchievements = achievements.filter(a => a.unlocked);
  const agentAvatar = user?.gender === 1 ? '👩' : '👨';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 聊天区域 */}
      <div className="lg:col-span-2 pixel-panel flex flex-col" style={{ height: '75vh' }}>
        {/* 聊天头部 */}
        <div className="flex items-center justify-between mb-3 pb-2" style={{ borderBottom: '3px dashed #4a4a6a' }}>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{agentAvatar}</span>
            <div>
              <h2 className="pixel-title text-xs">智能助手</h2>
              <p className="text-xs text-sv-text2 font-pixel-cn">
                {currentAgent === 'hoot' ? '鸮言 / Hoot' : '洛墨 / Lumo'}
              </p>
            </div>
          </div>
          {isStreaming && <span className="text-sv-gold text-xs cursor-blink font-pixel">● 回复中</span>}
        </div>
        
        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto mb-3 pr-1" style={{ minHeight: 0 }}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-sv-text2">
              <span className="text-4xl mb-4">🚜</span>
              <p className="font-pixel-cn text-sm">向你的 Agent 助手打个招呼吧！</p>
              <p className="text-xs mt-2 text-sv-text2">论文搜索·学习规划·待办管理·技术问答</p>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm font-pixel-cn leading-relaxed
                ${msg.role === 'user'
                  ? 'bg-sv-dark text-sv-cream'
                  : 'bg-sv-panel2 text-sv-text border border-sv-border'
                }`}
              >
                {msg.role === 'assistant' && msg.agent && msg.agent !== 'lumo' && msg.agent !== 'hoot' && (
                  <span className="text-xs text-sv-gold block mb-1">
                    {msg.agent === 'bookworm' ? '📚 书蠹' : msg.agent === 'scholar' ? '🎓 学者' : msg.agent === 'bloom' ? '🌻 花匠' : msg.agent === 'gears' ? '⚙️ 齿轮' : ''}
                  </span>
                )}
                {msg.content}
                {msg.streaming && <span className="cursor-blink text-sv-gold">▊</span>}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        
        {/* 输入区域 */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            className="pixel-input flex-1 text-sm"
            placeholder="输入消息..."
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="pixel-btn pixel-btn-gold px-4"
          >
            发送
          </button>
        </div>
      </div>
      
      {/* 右侧面板 */}
      <div className="flex flex-col gap-4">
        {/* 待办事项 */}
        <div className="pixel-panel flex-1" style={{ maxHeight: '35vh' }}>
          <h3 className="pixel-title text-xs mb-3">📋 待办事项</h3>
          
          <div className="flex gap-1 mb-3">
            <input
              value={todoInput}
              onChange={(e) => setTodoInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTodo()}
              className="pixel-input flex-1 text-xs"
              placeholder="新的待办..."
            />
            <button onClick={handleAddTodo} className="pixel-btn pixel-btn-teal px-2 text-xs">
              +
            </button>
          </div>
          
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(35vh - 100px)' }}>
            {todos.length === 0 ? (
              <p className="text-xs text-sv-text2 text-center py-4 font-pixel-cn">暂无待办，添加一个吧 ✨</p>
            ) : (
              todos.map(todo => (
                <div key={todo.id} className="flex items-center gap-2 mb-2 px-2 py-1 bg-black/20 rounded">
                  <button
                    onClick={() => handleToggleTodo(todo.id, todo.done)}
                    className="text-lg"
                    style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                  >
                    {todo.done ? '✅' : '⬜'}
                  </button>
                  <span className={`flex-1 text-xs font-pixel-cn ${todo.done ? 'line-through text-sv-text2' : 'text-sv-cream'}`}>
                    {todo.content}
                  </span>
                  <button
                    onClick={() => handleDeleteTodo(todo.id)}
                    className="text-sv-red text-xs hover:text-red-300"
                    style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* 成就公告栏 */}
        <div className="pixel-panel flex-1" style={{ maxHeight: '35vh' }}>
          <h3 className="pixel-title text-xs mb-3">🏆 成就公告栏</h3>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(35vh - 60px)' }}>
            {unlockedAchievements.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-2xl mb-2">🔒</p>
                <p className="text-xs text-sv-text2 font-pixel-cn">探索更多功能来解锁成就！</p>
              </div>
            ) : (
              unlockedAchievements.map(a => (
                <div key={a.id} className="achieve-unlock flex items-center gap-2 mb-2 px-2 py-1 bg-sv-gold/10 rounded border border-sv-gold/30">
                  <span className="text-lg">{a.icon}</span>
                  <div>
                    <p className="text-xs text-sv-gold font-pixel-cn">{a.name}</p>
                    <p className="text-xs text-sv-text2">{a.description}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
