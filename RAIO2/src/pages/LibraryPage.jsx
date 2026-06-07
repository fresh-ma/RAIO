import React, { useState, useEffect } from 'react';
import { useAuth } from '../store/AuthContext';
import { searchPapers, getSavedPapers, savePaper, removePaper, getNote, saveNote } from '../api';

export default function LibraryPage() {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [savedPapers, setSavedPapers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('search'); // search | saved
  const [notePaperId, setNotePaperId] = useState(null);
  const [noteContent, setNoteContent] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    loadSaved();
  }, [token]);

  async function loadSaved() {
    if (!token) return;
    try {
      const papers = await getSavedPapers(token);
      setSavedPapers(papers);
    } catch (e) {
      console.error('加载收藏失败:', e);
    }
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await searchPapers(token, query.trim());
      setResults(data.papers || []);
      setTab('search');
    } catch (e) {
      console.error('搜索失败:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(paper) {
    try {
      const newSaved = await savePaper(token, paper);
      setSavedPapers(newSaved);
    } catch (e) {
      if (e.message.includes('已收藏')) return;
      console.error('收藏失败:', e);
    }
  }

  async function handleRemove(id) {
    try {
      const newSaved = await removePaper(token, id);
      setSavedPapers(newSaved);
      if (notePaperId === id) setNotePaperId(null);
    } catch (e) {
      console.error('移除失败:', e);
    }
  }

  async function openNote(paperId) {
    try {
      const note = await getNote(token, paperId);
      setNoteContent(note.content || '');
      setNotePaperId(paperId);
    } catch (e) {
      console.error('加载笔记失败:', e);
    }
  }

  async function saveNoteContent() {
    if (!notePaperId) return;
    setNoteSaving(true);
    try {
      await saveNote(token, notePaperId, noteContent);
    } catch (e) {
      console.error('保存笔记失败:', e);
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="pixel-title text-sm">📚 图书馆</h2>
        <span className="text-xs text-sv-text2 font-pixel-cn">搜索arXiv论文，构建你的个人知识库</span>
      </div>
      
      {/* 搜索栏 */}
      <div className="pixel-panel mb-4">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="pixel-input flex-1 text-sm"
            placeholder="输入关键词搜索论文... (如: transformer, reinforcement learning)"
          />
          <button onClick={handleSearch} disabled={loading} className="pixel-btn pixel-btn-gold px-4 text-xs">
            {loading ? '⏳' : '🔍 搜索'}
          </button>
        </div>
      </div>
      
      {/* Tab 切换 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('search')}
          className={`px-3 py-2 text-xs font-pixel-cn ${tab === 'search' ? 'bg-sv-gold text-sv-bg' : 'bg-sv-panel2 text-sv-text2'} pixel-btn`}
          style={{ border: `3px solid ${tab === 'search' ? '#e8b830' : '#4a4a6a'}` }}
        >
          🔍 搜索结果
        </button>
        <button
          onClick={() => setTab('saved')}
          className={`px-3 py-2 text-xs font-pixel-cn ${tab === 'saved' ? 'bg-sv-gold text-sv-bg' : 'bg-sv-panel2 text-sv-text2'} pixel-btn`}
          style={{ border: `3px solid ${tab === 'saved' ? '#e8b830' : '#4a4a6a'}` }}
        >
          📖 我的收藏 ({savedPapers.length})
        </button>
      </div>
      
      {/* 笔记模态框 */}
      {notePaperId && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setNotePaperId(null)}>
          <div className="pixel-panel w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="pixel-title text-xs">📝 读书笔记</h3>
              <button onClick={() => setNotePaperId(null)} className="text-sv-red text-lg"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
            </div>
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="pixel-input flex-1 text-sm min-h-[300px] resize-none"
              placeholder="在此记录你的笔记... 支持Markdown格式"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setNotePaperId(null)} className="pixel-btn px-3 py-1 text-xs bg-sv-panel2 text-sv-text2"
                style={{ border: '3px solid #4a4a6a' }}>
                关闭
              </button>
              <button onClick={saveNoteContent} disabled={noteSaving} className="pixel-btn pixel-btn-gold px-3 py-1 text-xs">
                {noteSaving ? '⏳ 保存中' : '💾 保存'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 搜索结果 */}
      {tab === 'search' && (
        <div>
          {results.length === 0 && !loading && (
            <div className="pixel-panel text-center py-12">
              <span className="text-4xl block mb-4">📚</span>
              <p className="font-pixel-cn text-sm text-sv-text2">输入关键词开始搜索论文</p>
              <p className="text-xs text-sv-text2 mt-2">支持搜索arXiv上的所有论文</p>
            </div>
          )}
          
          {results.map((paper, i) => (
            <div key={i} className="pixel-panel mb-3">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1">
                  <h4 className="text-sm text-sv-gold font-pixel-cn mb-1 leading-relaxed">{paper.title}</h4>
                  <p className="text-xs text-sv-text2 mb-2">{paper.authors}</p>
                  <p className="text-xs text-sv-text2 leading-relaxed line-clamp-3">{paper.abstract}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => handleSave(paper)} className="pixel-btn pixel-btn-teal px-2 py-1 text-xs">
                    ⭐ 收藏
                  </button>
                  <a href={paper.url} target="_blank" rel="noopener" className="pixel-btn px-2 py-1 text-xs text-center bg-sv-dark text-sv-cream"
                    style={{ border: '3px solid #4a4a6a', textDecoration: 'none' }}>
                    🔗 原文
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* 我的收藏 */}
      {tab === 'saved' && (
        <div>
          {savedPapers.length === 0 ? (
            <div className="pixel-panel text-center py-12">
              <span className="text-4xl block mb-4">📖</span>
              <p className="font-pixel-cn text-sm text-sv-text2">还没有收藏的论文</p>
              <p className="text-xs text-sv-text2 mt-2">搜索并收藏你感兴趣的论文吧</p>
            </div>
          ) : (
            savedPapers.map(paper => (
              <div key={paper.id} className="pixel-panel mb-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1">
                    <h4 className="text-sm text-sv-gold font-pixel-cn mb-1">{paper.title}</h4>
                    <p className="text-xs text-sv-text2 mb-1">{paper.authors}</p>
                    <span className="text-xs text-sv-teal">{paper.arxiv_id}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => openNote(paper.id)} className="pixel-btn pixel-btn-gold px-2 py-1 text-xs">
                      📝 笔记
                    </button>
                    <a href={paper.url} target="_blank" rel="noopener" className="pixel-btn px-2 py-1 text-xs text-center bg-sv-dark text-sv-cream"
                      style={{ border: '3px solid #4a4a6a', textDecoration: 'none' }}>
                      🔗
                    </a>
                    <button onClick={() => handleRemove(paper.id)} className="pixel-btn pixel-btn-red px-2 py-1 text-xs">
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
