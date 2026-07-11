import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../store/AuthContext';
import {
  searchPapers,
  getSavedPapers,
  savePaper,
  resolvePaper,
  removePaper,
  getNote,
  saveNote,
  summarizePaper,
  getFulltext,
  getFetchRuns,
  generateEvidenceSummary,
  getPaperEvidence,
  getPaperPdfBlob,
  parsePaper,
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
  const [externalInput, setExternalInput] = useState('');
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
  const [showLogPaper, setShowLogPaper] = useState(null);
  const [fetchRuns, setFetchRuns] = useState([]);
  const [fetchRunsLoading, setFetchRunsLoading] = useState(false);
  const [paperAction, setPaperAction] = useState({ paperId: null, type: '' });
  const [paperActionError, setPaperActionError] = useState('');
  const [evidencePaper, setEvidencePaper] = useState(null);
  const [evidenceData, setEvidenceData] = useState({ analysis: null, evidence: [] });

  async function openPaperPdf(paperId, page) {
    const viewer = window.open('about:blank', '_blank');
    try {
      const blob = await getPaperPdfBlob(token, paperId);
      const url = URL.createObjectURL(blob);
      if (viewer) viewer.location.href = `${url}${page ? `#page=${page}` : ''}`;
      else window.open(`${url}${page ? `#page=${page}` : ''}`, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e) {
      if (viewer) viewer.close();
      setPaperActionError(e.message || '打开PDF失败');
    }
  }

  async function handleParsePaper(paper) {
    setPaperAction({ paperId: paper.id, type: 'parse' });
    setPaperActionError('');
    try {
      await parsePaper(token, paper.id);
    } catch (e) {
      setPaperActionError(e.message || 'PDF解析失败');
    } finally {
      setPaperAction({ paperId: null, type: '' });
    }
  }

  async function handleGenerateEvidence(paper) {
    setPaperAction({ paperId: paper.id, type: 'evidence' });
    setPaperActionError('');
    try {
      const result = await generateEvidenceSummary(token, paper.id);
      setEvidencePaper(paper);
      setEvidenceData({
        analysis: {
          summary: result.summary,
          coverage_pages: result.coverage_pages,
          total_pages: result.total_pages,
        },
        evidence: result.evidence || [],
      });
    } catch (e) {
      setPaperActionError(e.message || '证据链生成失败');
    } finally {
      setPaperAction({ paperId: null, type: '' });
    }
  }

  async function openEvidence(paper) {
    setEvidencePaper(paper);
    setEvidenceData({ analysis: null, evidence: [] });
    setPaperActionError('');
    try {
      const data = await getPaperEvidence(token, paper.id);
      setEvidenceData(data || { analysis: null, evidence: [] });
    } catch (e) {
      setPaperActionError(e.message || '获取证据链失败');
    }
  }

  async function handleGetFulltext(paperId) {
    setSavedPapers(prev => prev.map(p => p.id === paperId ? { ...p, pdf_status: 'fetching' } : p));
    try {
      const data = await getFulltext(token, paperId);
      setSavedPapers(prev => prev.map(p => p.id === paperId ? { ...p, pdf_status: data.pdf_status, pdf_path: data.pdf_path, pdf_source: data.pdf_source } : p));
    } catch (e) {
      setSavedPapers(prev => prev.map(p => p.id === paperId ? { ...p, pdf_status: 'failed' } : p));
    }
  }

  async function openFetchRuns(paper) {
    setShowLogPaper(paper);
    setFetchRunsLoading(true);
    try {
      const runs = await getFetchRuns(token, paper.id);
      setFetchRuns(runs || []);
    } catch (e) {
      console.error('获取日志失败:', e);
      setFetchRuns([]);
    } finally {
      setFetchRunsLoading(false);
    }
  }

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

  function buildExternalPaper(input) {
    const value = input.trim();
    const doi = value.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]?.replace(/[)\].,;]+$/g, '') || '';
    const arxivId = value.match(/arxiv\.org\/(?:abs|pdf)\/([^?#/]+)/i)?.[1]?.replace(/\.pdf$/i, '') || '';
    const isUrl = /^https?:\/\//i.test(value);
    return {
      arxiv_id: arxivId,
      doi,
      identifier_type: arxivId ? 'arxiv' : doi ? 'doi' : isUrl ? 'url' : '',
      title: doi ? `DOI: ${doi}` : value,
      authors: '',
      abstract: '手动添加的单篇论文，供开放获取解析或服务器网络单篇直取使用。',
      url: isUrl ? value : doi ? `https://doi.org/${doi}` : '',
    };
  }

  async function handleAddExternalPaper() {
    if (!externalInput.trim()) return;
    try {
      let paper = buildExternalPaper(externalInput);
      if (!paper.arxiv_id && !paper.doi && !paper.url) {
        throw new Error('请输入 arXiv 链接、DOI 或论文页面 URL');
      }
      if (!paper.arxiv_id) {
        try {
          const resolved = await resolvePaper(token, paper.doi || paper.url || externalInput);
          paper = {
            ...paper,
            ...resolved,
            doi: resolved.doi || paper.doi,
            url: resolved.url || paper.url,
            identifier_type: resolved.doi ? 'doi' : paper.identifier_type,
          };
        } catch (e) {
          console.warn('元数据补全失败，保留手动输入:', e.message);
        }
      }
      const newSaved = await savePaper(token, paper);
      setSavedPapers(newSaved);
      setExternalInput('');
      setTab('saved');
    } catch (e) {
      console.error('添加论文失败:', e);
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
        <div className="flex gap-2 mb-3">
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
        <div className="flex flex-col md:flex-row gap-2 pt-3" style={{ borderTop: '2px dashed #4a4a6a' }}>
          <input
            value={externalInput}
            onChange={(e) => setExternalInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddExternalPaper()}
            className="pixel-input flex-1 text-sm"
            placeholder="添加单篇 DOI 或论文链接，用于开放获取解析和服务器网络直取"
          />
          <button onClick={handleAddExternalPaper} className="pixel-btn pixel-btn-teal px-4 text-xs">
            添加单篇
          </button>
        </div>
        <p className="text-xs text-sv-text2 font-pixel-cn mt-2">
          单篇直取使用部署服务器（gzy-38）所在网络；只有服务器位于校园网时才可能复用机构出口。不批量抓取、不自动登录、不绕过验证码。
        </p>
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

      {paperActionError && (
        <div className="pixel-panel mb-4 text-xs text-sv-red font-pixel-cn">
          {paperActionError}
        </div>
      )}

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
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-xs text-sv-teal">
                        {paper.identifier_type === 'doi' ? paper.doi : paper.identifier_type === 'url' ? 'URL 单篇' : paper.arxiv_id}
                      </span>
                      {paper.pdf_status === 'fetched' && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-pixel-cn border border-emerald-500/30">
                          已获取 ({paper.pdf_source || 'PDF'})
                        </span>
                      )}
                      {paper.pdf_status === 'fetching' && (
                        <span className="text-[10px] text-sv-gold bg-sv-gold/10 px-1.5 py-0.5 rounded font-pixel-cn border border-sv-gold/30 animate-pulse">
                          ⏳ 获取中...
                        </span>
                      )}
                      {paper.pdf_status === 'failed' && (
                        <button onClick={() => openFetchRuns(paper)} className="text-[10px] text-sv-red bg-sv-red/10 px-1.5 py-0.5 rounded font-pixel-cn border border-sv-red/30 hover:bg-sv-red/20 transition-colors">
                          ❌ 获取失败 (查看原因)
                        </button>
                      )}
                    </div>
                    {summaryMap[paper.id] && (
                      <div className="mt-3 border-t border-sv-border pt-3">
                        <MarkdownPreview content={summaryMap[paper.id]} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {(paper.pdf_status !== 'fetched' && paper.pdf_status !== 'fetching') && (
                      <button onClick={() => handleGetFulltext(paper.id)} className="pixel-btn pixel-btn-teal px-2 py-1 text-xs">
                        📥 获取全文
                      </button>
                    )}
                    {paper.pdf_status === 'fetched' && (
                      <>
                        <button onClick={() => openPaperPdf(paper.id)} className="pixel-btn px-2 py-1 text-xs bg-sv-dark text-sv-cream"
                          style={{ border: '3px solid #4a4a6a' }}>
                          📄 打开PDF
                        </button>
                        <button
                          onClick={() => handleParsePaper(paper)}
                          disabled={paperAction.paperId === paper.id}
                          className="pixel-btn pixel-btn-teal px-2 py-1 text-xs"
                        >
                          {paperAction.paperId === paper.id && paperAction.type === 'parse' ? '解析中' : '解析PDF'}
                        </button>
                        <button
                          onClick={() => handleGenerateEvidence(paper)}
                          disabled={paperAction.paperId === paper.id}
                          className="pixel-btn pixel-btn-gold px-2 py-1 text-xs"
                        >
                          {paperAction.paperId === paper.id && paperAction.type === 'evidence' ? '核验中' : '生成证据链'}
                        </button>
                        <button onClick={() => openEvidence(paper)} className="pixel-btn px-2 py-1 text-xs bg-sv-dark text-sv-cream"
                          style={{ border: '3px solid #4a4a6a' }}>
                          查看证据
                        </button>
                      </>
                    )}
                    <button onClick={() => openNote(paper)} className="pixel-btn pixel-btn-gold px-2 py-1 text-xs">
                      📝 笔记
                    </button>
                    <button onClick={() => handleSummarize(paper)} disabled={summaryLoadingId === paper.id} className="pixel-btn pixel-btn-teal px-2 py-1 text-xs">
                      {summaryLoadingId === paper.id ? '...' : '摘要总结'}
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

      {evidencePaper && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setEvidencePaper(null)}>
          <div className="pixel-panel w-full max-w-4xl max-h-[86vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3 pb-2" style={{ borderBottom: '3px dashed #4a4a6a' }}>
              <div>
                <h3 className="pixel-title text-xs">证据链阅读</h3>
                <p className="text-xs text-sv-text2 mt-2 font-pixel-cn line-clamp-1">{evidencePaper.title}</p>
              </div>
              <button onClick={() => setEvidencePaper(null)} className="text-sv-red text-lg"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[320px]">
              {evidenceData.analysis?.summary && (
                <div className="news-brief mb-4">
                  <p className="text-xs text-sv-gold font-pixel-cn mb-2">全文概述</p>
                  <p className="text-sm text-sv-text leading-relaxed font-pixel-cn">{evidenceData.analysis.summary}</p>
                  <p className="text-[10px] text-sv-text2 mt-2 font-pixel-cn">
                    上下文覆盖 {evidenceData.analysis.coverage_pages || 0}/{evidenceData.analysis.total_pages || 0} 页
                  </p>
                </div>
              )}

              {(evidenceData.evidence || []).length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-xs text-sv-text2 font-pixel-cn mb-3">还没有证据链结果</p>
                  <button onClick={() => handleGenerateEvidence(evidencePaper)} className="pixel-btn pixel-btn-gold px-4 text-xs">
                    解析全文并生成
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {(evidenceData.evidence || []).map((item, index) => (
                    <div key={item.id || index} className="pixel-panel bg-black/10">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span className="text-xs text-sv-gold font-pixel-cn">{item.evidence_type || 'other'}</span>
                        <span className={`text-[10px] font-pixel-cn ${item.verified ? 'text-emerald-400' : 'text-sv-red'}`}>
                          {item.verified ? '原文精确匹配' : '需人工核验'}
                        </span>
                      </div>
                      <p className="text-sm text-sv-text font-pixel-cn leading-relaxed mb-2">{item.claim}</p>
                      <blockquote className="text-xs text-sv-text2 leading-relaxed border-l-2 border-sv-teal pl-3">
                        {item.snippet || '无原文片段'}
                      </blockquote>
                      <div className="flex items-center justify-between gap-2 mt-3">
                        <span className="text-[10px] text-sv-text2 font-pixel-cn">{item.verification_note}</span>
                        {item.page && (
                          <button onClick={() => openPaperPdf(evidencePaper.id, item.page)} className="pixel-btn pixel-btn-teal px-2 py-1 text-xs">
                            回到第 {item.page} 页
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showLogPaper && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowLogPaper(null)}>
          <div className="pixel-panel w-full max-w-lg max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3 pb-2" style={{ borderBottom: '3px dashed #4a4a6a' }}>
              <div>
                <h3 className="pixel-title text-xs">📥 全文获取日志</h3>
                <p className="text-xs text-sv-text2 mt-2 font-pixel-cn line-clamp-1">{showLogPaper.title}</p>
              </div>
              <button onClick={() => setShowLogPaper(null)} className="text-sv-red text-lg"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px] py-2">
              {fetchRunsLoading ? (
                <p className="text-xs text-sv-text2 font-pixel-cn">⏳ 加载中...</p>
              ) : fetchRuns.length === 0 ? (
                <p className="text-xs text-sv-text2 font-pixel-cn">无获取记录</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {fetchRuns[0]?.steps?.map((step, idx) => (
                    <div key={idx} className="flex gap-2 text-xs font-pixel-cn bg-black/20 p-2 rounded">
                      <span className={step.status === 'success' ? 'text-emerald-400' : step.status === 'failed' ? 'text-sv-red' : 'text-sv-gold'}>
                        {step.status === 'success' ? '●' : step.status === 'failed' ? '✖' : '○'}
                      </span>
                      <div className="flex-1">
                        <div className="flex justify-between font-bold">
                          <span>{step.step}</span>
                          <span className="text-[10px] text-sv-text2">{step.time}</span>
                        </div>
                        {step.detail && <p className="text-sv-text2 mt-1 text-[11px] leading-relaxed break-all">{step.detail}</p>}
                      </div>
                    </div>
                  ))}
                  {fetchRuns[0]?.error && (
                    <div className="bg-sv-red/10 border border-sv-red/30 p-2 rounded text-sv-red text-xs font-pixel-cn mt-2">
                      错误详情: {fetchRuns[0].error}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end mt-3 pt-2" style={{ borderTop: '3px dashed #4a4a6a' }}>
              <button onClick={() => setShowLogPaper(null)} className="pixel-btn bg-sv-dark text-sv-cream px-4 py-1 text-xs"
                style={{ border: '3px solid #4a4a6a' }}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
