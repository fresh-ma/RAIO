import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../store/AuthContext';
import { getNews, analyzeNews, followNews } from '../api';

const LOCAL_FALLBACK_NEWS = [
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

const LOCAL_FALLBACK_DIGEST = {
  date: new Date().toLocaleDateString('zh-CN'),
  bullets: [
    { title: '#1 离线资讯占位', detail: 'arXiv cs.AI 暂时无法连接，RAIO 已启用离线资讯。' },
    { title: '#2 推荐科研方向', detail: '建议关注：多智能体、检索增强生成、科研工作流自动化。' }
  ]
};

function MarkdownBlock({ content }) {
  return (
    <div className="markdown-preview font-pixel-cn">
      <ReactMarkdown>{content || '暂无解析'}</ReactMarkdown>
    </div>
  );
}

export default function NewsPage() {
  const { token } = useAuth();
  const [news, setNews] = useState([]);
  const [digest, setDigest] = useState(null);
  const [fallback, setFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState(null);
  const [analysis, setAnalysis] = useState('');
  const [question, setQuestion] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [followLoadingKey, setFollowLoadingKey] = useState('');
  const [followResults, setFollowResults] = useState({});

  useEffect(() => {
    loadNews();
  }, [token]);

  async function loadNews() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await getNews(token);
      if (data.news && data.news.length > 0) {
        setNews(data.news);
        setDigest(data.digest || null);
        setFallback(Boolean(data.fallback));
      } else {
        setNews(LOCAL_FALLBACK_NEWS);
        setDigest(LOCAL_FALLBACK_DIGEST);
        setFallback(true);
      }
    } catch (e) {
      console.error('加载新闻失败:', e);
      setNews(LOCAL_FALLBACK_NEWS);
      setDigest(LOCAL_FALLBACK_DIGEST);
      setFallback(true);
    } finally {
      setLoading(false);
    }
  }

  async function openAnalysis(item) {
    setActiveItem(item);
    setAnalysis('');
    setQuestion('');
    setAnalysisLoading(true);
    try {
      const data = await analyzeNews(token, item, '');
      setAnalysis(data.analysis || '');
    } catch (e) {
      setAnalysis('解析失败，请稍后重试。');
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function askFollowup() {
    if (!activeItem) return;
    setAnalysisLoading(true);
    try {
      const data = await analyzeNews(token, activeItem, question);
      setAnalysis(data.analysis || '');
    } catch (e) {
      setAnalysis('解析失败，请稍后重试。');
    } finally {
      setAnalysisLoading(false);
    }
  }

  function getItemKey(item) {
    return item?.url || item?.title || '';
  }

  async function handleFollow(item) {
    const key = getItemKey(item);
    if (!key || followLoadingKey) return;
    setFollowLoadingKey(key);
    try {
      const data = await followNews(token, item);
      setFollowResults(prev => ({ ...prev, [key]: data }));
    } catch (e) {
      setFollowResults(prev => ({ ...prev, [key]: { error: e.message || '联动失败' } }));
    } finally {
      setFollowLoadingKey('');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="pixel-title text-sm">📰 前沿视野</h2>
          <span className="text-xs text-sv-text2 font-pixel-cn">学术前沿一手掌握</span>
        </div>
        <button onClick={loadNews} disabled={loading} className="pixel-btn pixel-btn-teal px-3 py-1 text-xs">
          刷新
        </button>
      </div>

      {digest && (
        <div className="pixel-panel mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="pixel-title text-xs">AI 每日晨报</h3>
            <span className="text-xs text-sv-text2">{digest.date}</span>
          </div>
          {fallback && <p className="text-xs text-sv-gold font-pixel-cn mb-3">当前使用备用资讯源</p>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(digest.bullets || []).map((item, i) => (
              <div key={i} className="news-brief">
                <p className="text-xs text-sv-gold font-pixel-cn mb-2">{item.title}</p>
                <p className="text-xs text-sv-text2 leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeItem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setActiveItem(null)}>
          <div className="pixel-panel w-full max-w-3xl max-h-[82vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="pixel-title text-xs">AI 解析</h3>
                <p className="text-xs text-sv-text2 mt-2 font-pixel-cn">{activeItem.title}</p>
              </div>
              <button onClick={() => setActiveItem(null)} className="text-sv-red text-lg"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[280px] mb-3">
              {analysisLoading ? (
                <p className="text-xs text-sv-text2 font-pixel-cn">⏳ 解析中...</p>
              ) : (
                <MarkdownBlock content={analysis} />
              )}
            </div>

            {followResults[getItemKey(activeItem)] && (
              <div className="synergy-result mb-3">
                {followResults[getItemKey(activeItem)].error || followResults[getItemKey(activeItem)].message}
                {followResults[getItemKey(activeItem)].paper && (
                  <p className="mt-1">图书馆：{followResults[getItemKey(activeItem)].paper.title || followResults[getItemKey(activeItem)].paper.arxiv_id}</p>
                )}
                {followResults[getItemKey(activeItem)].course && (
                  <p className="mt-1">成长之路：{followResults[getItemKey(activeItem)].course.topic}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && askFollowup()}
                className="pixel-input flex-1 text-xs"
                placeholder="继续追问这条资讯..."
              />
              <button onClick={askFollowup} disabled={analysisLoading} className="pixel-btn pixel-btn-gold px-3 text-xs">
                追问
              </button>
              <button
                onClick={() => handleFollow(activeItem)}
                disabled={followLoadingKey === getItemKey(activeItem)}
                className="pixel-btn pixel-btn-teal px-3 text-xs"
              >
                {followLoadingKey === getItemKey(activeItem) ? '联动中' : '关注'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="pixel-panel text-center py-12">
          <p className="font-pixel-cn text-sm text-sv-text2">⏳ 加载中...</p>
        </div>
      ) : news.length === 0 ? (
        <div className="pixel-panel text-center py-12">
          <span className="text-4xl block mb-4">📰</span>
          <p className="font-pixel-cn text-sm text-sv-text2">暂无新闻，稍后再来看看</p>
        </div>
      ) : (
        <div className="space-y-3">
          {news.map((item, i) => (
            <div key={i} className="pixel-panel hover:border-sv-gold/50 transition-colors">
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-1">📄</span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-sm text-sv-gold font-pixel-cn leading-relaxed">{item.title}</h3>
                    {item.source && <span className="text-xs text-sv-teal">{item.source}</span>}
                  </div>
                  {item.description && (
                    <p className="text-xs text-sv-text2 leading-relaxed mb-2 line-clamp-3">{item.description}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openAnalysis(item)} className="pixel-btn pixel-btn-teal px-2 py-1 text-xs">
                      AI解析
                    </button>
                    <button
                      onClick={() => handleFollow(item)}
                      disabled={followLoadingKey === getItemKey(item)}
                      className="pixel-btn pixel-btn-gold px-2 py-1 text-xs"
                    >
                      {followLoadingKey === getItemKey(item) ? '联动中' : '关注联动'}
                    </button>
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer"
                        className="pixel-btn px-2 py-1 text-xs bg-sv-dark text-sv-cream"
                        style={{ border: '3px solid #4a4a6a', textDecoration: 'none' }}>
                        原文
                      </a>
                    )}
                  </div>
                  {followResults[getItemKey(item)] && (
                    <div className="synergy-result mt-3">
                      {followResults[getItemKey(item)].error || followResults[getItemKey(item)].message}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
