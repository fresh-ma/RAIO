import React, { useState, useEffect } from 'react';
import { useAuth } from '../store/AuthContext';
import { getNews } from '../api';

export default function NewsPage() {
  const { token } = useAuth();
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNews();
  }, [token]);

  async function loadNews() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await getNews(token);
      setNews(data.news || []);
    } catch (e) {
      console.error('加载新闻失败:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="pixel-title text-sm">📰 八卦早知道</h2>
        <span className="text-xs text-sv-text2 font-pixel-cn">学术前沿一手掌握</span>
      </div>
      
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
                  <h3 className="text-sm text-sv-gold font-pixel-cn mb-1 leading-relaxed">{item.title}</h3>
                  {item.description && (
                    <p className="text-xs text-sv-text2 leading-relaxed mb-2 line-clamp-3">{item.description}</p>
                  )}
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener"
                      className="text-xs text-sv-teal hover:underline font-pixel-cn">
                      🔗 查看原文 →
                    </a>
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
