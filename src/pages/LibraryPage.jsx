import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../store/AuthContext';
import {
  searchPapers,
  getSavedPapers,
  savePaper,
  removePaper,
  getNote,
  saveNote,
  summarizePaper,
} from '../api';

function normalizeMarkdown(content = '') {
  return content
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => `\n\n\`\`\`math\n${expr.trim()}\n\`\`\`\n\n`)
    .replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_, prefix, expr) => `${prefix}\`${expr.trim()}\``);
}

function MarkdownPreview({ content }) {
  if (!content?.trim()) {
    return <p className="text-xs text-sv-text2 font-pixel-cn">暂无内容</p>;
  }

  return (
    <div className="markdown-preview font-pixel-cn">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const lang = /language-(\w+)/.exec(className || '')?.[1];
            const text = String(children).replace(/\n$/, '');
            if (lang || text.includes('\n')) {
              return (
                <pre className={`markdown-code ${lang === 'math' ? 'math-block' : ''}`}>
                  <code>{text}</code>
                </pre>
              );
            }
            return <code className="markdown-inline-code">{children}</code>;
          },
        }}
      >
        {normalizeMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

function sanitizeFileName(name = 'raio-note') {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'raio-note';
}

function buildExportMarkdown(paper, note, summary) {
  return `# ${paper.title || paper.arxiv_id || 'RAIO Paper Note'}

- arXiv: ${paper.arxiv_id || ''}
- Authors: ${paper.authors || ''}
- URL: ${paper.url || ''}

## Abstract

${paper.abstract || '暂无摘要'}

## Reading Notes

${note || '暂无笔记'}

## AI Companion Summary

${summary || '暂无总结'}
`;
}

export default function LibraryPage() {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [savedPapers, setSavedPapers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('search');
  const [notePaper, setNotePaper] = useState(null);
  const [noteContent, setNoteContent] = useState('');
  const [noteMode, setNoteMode] = useState('edit');
  const [noteSaving, setNoteSaving] = useState(false);
  const [summaryMap, setSummaryMap] = useState({});
  const [summaryLoadingId, setSummaryLoadingId] = useState(null);
  const [summaryError, setSummaryError] = useState('');

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
      if (e.message?.includes('已收藏')) return;
      console.error('收藏失败:', e);
    }
  }

  async function handleRemove(id) {
    try {
      const newSaved = await removePaper(token, id);
      setSavedPapers(newSaved);
      if (notePaper?.id === id) setNotePaper(null);
    } catch (e) {
      console.error('移除失败:', e);
    }
  }

  async function openNote(paper) {
    try {
      const note = await getNote(token, paper.id);
      setNoteContent(note.content || '');
      setNotePaper(paper);
      setNoteMode('edit');
      setSummaryError('');
    } catch (e) {
      console.error('加载笔记失败:', e);
    }
  }

  async function saveNoteContent() {
    if (!notePaper) return;
    setNoteSaving(true);
    try {
      await saveNote(token, notePaper.id, noteContent);
    } catch (e) {
      console.error('保存笔记失败:', e);
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleSummarize(paper) {
    setSummaryLoadingId(paper.id);
    setSummaryError('');
    try {
      const data = await summarizePaper(token, paper.id);
      setSummaryMap(prev => ({ ...prev, [paper.id]: data.summary || '' }));
      if (!notePaper) setNotePaper(paper);
      setNoteMode('summary');
    } catch (e) {
      setSummaryError(e.message || '总结失败');
    } finally {
      setSummaryLoadingId(null);
    }
  }

  async function exportPaperMarkdown(paper, knownNote) {
    try {
      const note = knownNote ?? (await getNote(token, paper.id)).content ?? '';
      const summary = summaryMap[paper.id] || '';
      const markdown = buildExportMarkdown(paper, note, summary);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeFileName(paper.title || paper.arxiv_id)}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('导出失败:', e);
    }
  }

  const activeSummary = notePaper ? summaryMap[notePaper.id] || '' : '';

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="pixel-title text-sm">📚 图书馆</h2>
        <span className="text-xs text-sv-text2 font-pixel-cn">搜索arXiv论文，构建你的个人知识库</span>
      </div>

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

      {notePaper && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setNotePaper(null)}>
          <div className="pixel-panel w-full max-w-5xl max-h-[86vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="pixel-title text-xs">📝 读书笔记</h3>
                <p className="text-xs text-sv-text2 mt-2 font-pixel-cn line-clamp-2">{notePaper.title}</p>
              </div>
              <button onClick={() => setNotePaper(null)} className="text-sv-red text-lg"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {['edit', 'preview', 'summary'].map(mode => (
                <button
                  key={mode}
                  onClick={() => setNoteMode(mode)}
                  className={`pixel-btn px-3 py-1 text-xs ${noteMode === mode ? 'pixel-btn-gold' : 'bg-sv-panel2 text-sv-text2'}`}
                  style={{ border: `3px solid ${noteMode === mode ? '#e8b830' : '#4a4a6a'}` }}
                >
                  {mode === 'edit' ? '编辑' : mode === 'preview' ? '预览' : 'AI总结'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto min-h-[360px]">
              {noteMode === 'edit' && (
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  className="pixel-input text-sm min-h-[360px] resize-none"
                  placeholder="在此记录你的笔记... 支持Markdown、代码块与LaTeX公式文本"
                />
              )}

              {noteMode === 'preview' && <MarkdownPreview content={noteContent} />}

              {noteMode === 'summary' && (
                <div>
                  {summaryError && <p className="text-xs text-sv-red font-pixel-cn mb-3">{summaryError}</p>}
                  {summaryLoadingId === notePaper.id ? (
                    <p className="text-xs text-sv-text2 font-pixel-cn">⏳ 总结中...</p>
                  ) : activeSummary ? (
                    <MarkdownPreview content={activeSummary} />
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-xs text-sv-text2 font-pixel-cn mb-3">还没有生成总结</p>
                      <button onClick={() => handleSummarize(notePaper)} className="pixel-btn pixel-btn-teal px-4 text-xs">
                        生成总结
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 mt-3">
              <button onClick={() => exportPaperMarkdown(notePaper, noteContent)} className="pixel-btn px-3 py-1 text-xs bg-sv-dark text-sv-cream"
                style={{ border: '3px solid #4a4a6a' }}>
                下载MD
              </button>
              <button onClick={() => handleSummarize(notePaper)} disabled={summaryLoadingId === notePaper.id} className="pixel-btn pixel-btn-teal px-3 py-1 text-xs">
                {summaryLoadingId === notePaper.id ? '总结中' : 'AI总结'}
              </button>
              <button onClick={saveNoteContent} disabled={noteSaving} className="pixel-btn pixel-btn-gold px-3 py-1 text-xs">
                {noteSaving ? '保存中' : '保存'}
              </button>
              <button onClick={() => setNotePaper(null)} className="pixel-btn bg-sv-dark text-sv-cream px-3 py-1 text-xs"
                style={{ border: '3px solid #4a4a6a' }}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <a href={paper.url} target="_blank" rel="noopener noreferrer" className="pixel-btn px-2 py-1 text-xs text-center bg-sv-dark text-sv-cream"
                    style={{ border: '3px solid #4a4a6a', textDecoration: 'none' }}>
                    🔗 原文
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
                    {summaryMap[paper.id] && (
                      <div className="mt-3 border-t border-sv-border pt-3">
                        <MarkdownPreview content={summaryMap[paper.id]} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => openNote(paper)} className="pixel-btn pixel-btn-gold px-2 py-1 text-xs">
                      📝 笔记
                    </button>
                    <button onClick={() => handleSummarize(paper)} disabled={summaryLoadingId === paper.id} className="pixel-btn pixel-btn-teal px-2 py-1 text-xs">
                      {summaryLoadingId === paper.id ? '...' : 'AI 总结'}
                    </button>
                    <button onClick={() => exportPaperMarkdown(paper)} className="pixel-btn px-2 py-1 text-xs bg-sv-dark text-sv-cream"
                      style={{ border: '3px solid #4a4a6a' }}>
                      MD
                    </button>
                    <a href={paper.url} target="_blank" rel="noopener noreferrer" className="pixel-btn px-2 py-1 text-xs text-center bg-sv-dark text-sv-cream"
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
