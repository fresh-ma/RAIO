import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../store/AuthContext';
import { getCourses, generateCourse, generateQuiz, generateChapterMaterial, updateProgress } from '../api';

function makeResourceLinks(topic, chapter) {
  const keyword = encodeURIComponent(`${topic} ${chapter?.title || ''} ${chapter?.points?.[0] || ''}`.trim());
  const generated = Array.isArray(chapter?.resources) ? chapter.resources.filter(r => r?.url) : [];
  const defaults = [
    { type: 'video', label: 'B站视频', url: `https://search.bilibili.com/all?keyword=${keyword}` },
    { type: 'video', label: 'YouTube', url: `https://www.youtube.com/results?search_query=${keyword}` },
    { type: 'tutorial', label: '菜鸟教程', url: `https://www.runoob.com/?s=${keyword}` },
    { type: 'blog', label: '图文博客', url: `https://www.bing.com/search?q=${keyword}+教程+博客` },
  ];

  const seen = new Set();
  return [...generated, ...defaults].filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 6);
}

function sanitizeFileName(name = 'raio-growth') {
  return String(name || 'raio-growth').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'raio-growth';
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildCourseMindmap(course) {
  const chapters = course?.outline?.chapters || [];
  return {
    label: course?.topic || '成长主题',
    children: chapters.map(chapter => ({
      label: chapter.title || '未命名章节',
      meta: `${chapter.duration || '--'} · 难度 ${chapter.difficulty || 1}/5`,
      children: (chapter.points || []).slice(0, 6).map(point => ({ label: point })),
    })),
  };
}

function buildChapterMindmap(course, chapter) {
  const resources = makeResourceLinks(course?.topic, chapter).slice(0, 4);
  return {
    label: chapter?.title || '章节',
    children: [
      {
        label: '核心逻辑',
        children: [chapter?.summary || '建立概念、方法与实践之间的联系。'].map(label => ({ label })),
      },
      {
        label: '知识点',
        children: (chapter?.points || ['基础概念']).slice(0, 8).map(label => ({ label })),
      },
      {
        label: '资源入口',
        children: resources.map(resource => ({ label: resource.label || resource.type || '资源' })),
      },
    ],
  };
}

function buildCourseMarkdown(course) {
  if (course?.outline?.markdown) return course.outline.markdown;
  const chapters = course?.outline?.chapters || [];
  const lines = [`# ${course?.topic || '成长之路'}`, '', '> RAIO 成长之路学习材料', ''];
  chapters.forEach((chapter, index) => {
    lines.push(`## ${index + 1}. ${chapter.title}`);
    lines.push('');
    lines.push(`- 难度：${chapter.difficulty || 1}/5`);
    lines.push(`- 预计时长：${chapter.duration || '--'}`);
    lines.push('');
    lines.push(chapter.summary || '');
    lines.push('');
    lines.push('### 知识点');
    (chapter.points || []).forEach(point => lines.push(`- ${point}`));
    lines.push('');
    lines.push('### 学习文本');
    lines.push(chapter.learning_text || '本章详细学习材料尚未生成。请在章节详情中点击“生成本章材料”。');
    lines.push('');
  });
  return lines.join('\n');
}

function splitLabel(label, maxChars = 12, maxLines = 3) {
  const chars = [...String(label || '')];
  const lines = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += maxChars) {
    lines.push(chars.slice(i, i + maxChars).join(''));
  }
  if (chars.length > maxChars * maxLines && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  }
  return lines.length ? lines : [''];
}

function layoutMindmap(root) {
  let cursor = 0;
  let nodeId = 0;
  let maxDepth = 0;
  const nodes = [];
  const edges = [];
  const nodeWidth = 176;
  const rowGap = 74;
  const colGap = 230;

  function visit(rawNode, depth, parentId = null) {
    maxDepth = Math.max(maxDepth, depth);
    const id = `node-${nodeId++}`;
    const children = Array.isArray(rawNode?.children) ? rawNode.children : [];
    const laidChildren = children.map(child => visit(child, depth + 1, id));
    const y = laidChildren.length
      ? laidChildren.reduce((sum, child) => sum + child.y, 0) / laidChildren.length
      : 52 + cursor++ * rowGap;
    const node = {
      id,
      parentId,
      label: rawNode?.label || '',
      meta: rawNode?.meta || '',
      depth,
      x: 32 + depth * colGap,
      y,
      width: nodeWidth,
      height: rawNode?.meta ? 58 : 48,
    };
    nodes.push(node);
    laidChildren.forEach(child => edges.push({ from: node, to: child }));
    return node;
  }

  visit(root, 0);
  const height = Math.max(190, cursor * rowGap + 104);
  const width = Math.max(420, 64 + (maxDepth + 1) * colGap + nodeWidth);
  return { nodes, edges, width, height };
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMindmapSvg(data, title = 'RAIO Growth Map') {
  const layout = layoutMindmap(data);
  const edgeMarkup = layout.edges.map(edge => {
    const x1 = edge.from.x + edge.from.width;
    const y1 = edge.from.y;
    const x2 = edge.to.x;
    const y2 = edge.to.y;
    const mid = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="#4ecdc4" stroke-width="2" opacity="0.65"/>`;
  }).join('');
  const nodeMarkup = layout.nodes.map(node => {
    const lines = splitLabel(node.label, node.depth === 0 ? 10 : 12, 3);
    const fill = node.depth === 0 ? '#e8b830' : node.depth === 1 ? '#2f5f73' : '#26334f';
    const textColor = node.depth === 0 ? '#1a1a2e' : '#f5e6c8';
    const textY = node.y - (lines.length - 1) * 7;
    const tspans = lines.map((line, index) => `<tspan x="${node.x + node.width / 2}" y="${textY + index * 15}">${escapeXml(line)}</tspan>`).join('');
    const meta = node.meta ? `<text x="${node.x + node.width / 2}" y="${node.y + 24}" text-anchor="middle" font-size="10" fill="#b8a888">${escapeXml(node.meta)}</text>` : '';
    return `<rect x="${node.x}" y="${node.y - node.height / 2}" width="${node.width}" height="${node.height}" rx="6" fill="${fill}" stroke="#4a4a6a" stroke-width="2"/><text text-anchor="middle" font-size="12" font-family="Arial, sans-serif" font-weight="700" fill="${textColor}">${tspans}</text>${meta}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${escapeXml(title)}"><rect width="100%" height="100%" fill="#1a1a2e"/><text x="24" y="28" fill="#e8b830" font-size="14" font-family="Arial, sans-serif" font-weight="700">${escapeXml(title)}</text>${edgeMarkup}${nodeMarkup}</svg>`;
}

function MindmapCanvas({ data, title }) {
  const layout = useMemo(() => layoutMindmap(data), [data]);
  return (
    <div className="mindmap-stage">
      <svg className="mindmap-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={title}>
        {layout.edges.map((edge, index) => {
          const x1 = edge.from.x + edge.from.width;
          const y1 = edge.from.y;
          const x2 = edge.to.x;
          const y2 = edge.to.y;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={index}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="rgba(78, 205, 196, 0.72)"
              strokeWidth="2"
            />
          );
        })}
        {layout.nodes.map(node => {
          const lines = splitLabel(node.label, node.depth === 0 ? 10 : 12, 3);
          const fill = node.depth === 0 ? '#e8b830' : node.depth === 1 ? '#2f5f73' : '#26334f';
          const textColor = node.depth === 0 ? '#1a1a2e' : '#f5e6c8';
          const textY = node.y - (lines.length - 1) * 7;
          return (
            <g key={node.id} className="mindmap-node">
              <rect
                x={node.x}
                y={node.y - node.height / 2}
                width={node.width}
                height={node.height}
                rx="6"
                fill={fill}
                stroke="#4a4a6a"
                strokeWidth="2"
              />
              <text textAnchor="middle" fontSize="12" fontWeight="700" fill={textColor}>
                {lines.map((line, index) => (
                  <tspan key={index} x={node.x + node.width / 2} y={textY + index * 15}>{line}</tspan>
                ))}
              </text>
              {node.meta && (
                <text x={node.x + node.width / 2} y={node.y + 24} textAnchor="middle" fontSize="10" fill="#b8a888">
                  {node.meta}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function LearnPage() {
  const { token } = useAuth();
  const [courses, setCourses] = useState([]);
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeCourse, setActiveCourse] = useState(null);
  const [activeView, setActiveView] = useState('map');
  const [quizData, setQuizData] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [activeChapter, setActiveChapter] = useState(null);
  const [nodePanel, setNodePanel] = useState(null);
  const [materialLoadingKey, setMaterialLoadingKey] = useState('');
  const [materialError, setMaterialError] = useState('');

  useEffect(() => {
    loadCourses();
  }, [token]);

  async function loadCourses() {
    if (!token) return;
    try {
      const data = await getCourses(token);
      setCourses(data);
      setActiveCourse(prev => {
        if (prev) return data.find(course => course.id === prev.id) || data[0] || null;
        return data[0] || null;
      });
    } catch (e) {
      console.error('加载课程失败:', e);
    }
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setLoading(true);
    try {
      const course = await generateCourse(token, topic.trim());
      setCourses(prev => [course, ...prev]);
      setActiveCourse(course);
      setActiveView('map');
      setTopic('');
    } catch (e) {
      console.error('生成课程失败:', e);
    } finally {
      setLoading(false);
    }
  }

  async function startQuiz(courseId, chapterIdx, chapter) {
    setActiveChapter({ courseId, chapterIdx, chapter });
    setLoading(true);
    try {
      const quiz = await generateQuiz(token, {
        courseId,
        chapterIdx,
        chapterTitle: chapter.title,
        points: chapter.points,
      });
      setQuizData(quiz);
      setQuizAnswers({});
      setQuizSubmitted(false);
    } catch (e) {
      console.error('生成测验失败:', e);
    } finally {
      setLoading(false);
    }
  }

  async function submitQuiz() {
    setQuizSubmitted(true);
    let correct = 0;
    (quizData.questions || []).forEach((q, i) => {
      if (quizAnswers[i] === q.answer) correct++;
    });
    const total = (quizData.questions || []).length || 1;
    const score = Math.round((correct / total) * 100);
    const status = score >= 60 ? 'passed' : 'review';

    await updateProgress(token, {
      courseId: activeChapter.courseId,
      chapterIdx: activeChapter.chapterIdx,
      status,
      score,
    });

    loadCourses();
  }

  async function markChapter(courseId, chapterIdx, status) {
    await updateProgress(token, { courseId, chapterIdx, status, score: status === 'passed' ? 100 : 0 });
    await loadCourses();
    setNodePanel(prev => prev ? { ...prev, status } : prev);
  }

  async function handleGenerateMaterial(courseId, chapterIdx, force = false) {
    const key = `${courseId}:${chapterIdx}`;
    setMaterialLoadingKey(key);
    setMaterialError('');
    try {
      const result = await generateChapterMaterial(token, { courseId, chapterIdx, force });
      if (result.course) {
        setCourses(prev => prev.map(course => course.id === result.course.id ? result.course : course));
        setActiveCourse(result.course);
        const chapter = result.course.outline?.chapters?.[chapterIdx] || result.chapter;
        setNodePanel(prev => prev ? { ...prev, course: result.course, chapter } : prev);
      }
    } catch (e) {
      setMaterialError(e.message || '章节材料生成失败');
    } finally {
      setMaterialLoadingKey('');
    }
  }

  function downloadCourseMarkdown(course) {
    downloadFile(`${sanitizeFileName(course.topic)}-学习材料.md`, buildCourseMarkdown(course), 'text/markdown;charset=utf-8');
  }

  function downloadCourseMap(course) {
    const map = course?.outline?.mindmap || buildCourseMindmap(course);
    downloadFile(`${sanitizeFileName(course.topic)}-思维导图.svg`, buildMindmapSvg(map, `${course.topic} · 成长地图`), 'image/svg+xml;charset=utf-8');
  }

  function downloadChapterMap(course, chapter) {
    const map = buildChapterMindmap(course, chapter);
    downloadFile(`${sanitizeFileName(`${course.topic}-${chapter.title}`)}-章节导图.svg`, buildMindmapSvg(map, `${chapter.title} · 章节地图`), 'image/svg+xml;charset=utf-8');
  }

  const activeCourseData = activeCourse ? courses.find(c => c.id === activeCourse.id) : null;
  const activeMindmap = activeCourseData?.outline?.mindmap || (activeCourseData ? buildCourseMindmap(activeCourseData) : null);
  const nodePanelMaterialKey = nodePanel ? `${nodePanel.course.id}:${nodePanel.chapterIdx}` : '';
  const nodePanelMaterialLoading = Boolean(nodePanelMaterialKey && materialLoadingKey === nodePanelMaterialKey);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="pixel-title text-sm">🎓 成长之路</h2>
          <span className="text-xs text-sv-text2 font-pixel-cn">学习路径 · 思维导图 · 按需教材 · 随堂测验</span>
        </div>
        {activeCourseData && (
          <div className="hidden sm:flex gap-2">
            <button onClick={() => downloadCourseMarkdown(activeCourseData)} className="pixel-btn pixel-btn-teal px-3 py-1 text-xs">
              下载材料
            </button>
            <button onClick={() => downloadCourseMap(activeCourseData)} className="pixel-btn pixel-btn-gold px-3 py-1 text-xs">
              下载导图
            </button>
          </div>
        )}
      </div>

      <div className="pixel-panel mb-4">
        <p className="text-xs text-sv-gold font-pixel-cn mb-2">输入方向，先生成成长路径和思维导图；章节学习材料可在需要时单独生成</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            className="pixel-input flex-1 text-sm"
            placeholder="例如：线性代数、机器学习、Python..."
          />
          <button onClick={handleGenerate} disabled={loading} className="pixel-btn pixel-btn-gold px-4 text-xs">
            {loading ? '生成中' : '生成路径'}
          </button>
        </div>
      </div>

      {activeCourseData && (
        <div className="pixel-panel mb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
            <div>
              <p className="text-xs text-sv-teal font-pixel-cn mb-1">当前成长路径</p>
              <h3 className="text-sm text-sv-gold font-pixel-cn">{activeCourseData.topic}</h3>
            </div>
            <div className="growth-tabs">
              <button className={activeView === 'map' ? 'active' : ''} onClick={() => setActiveView('map')}>总览地图</button>
              <button className={activeView === 'chapters' ? 'active' : ''} onClick={() => setActiveView('chapters')}>章节节点</button>
            </div>
          </div>

          {activeView === 'map' && activeMindmap && (
            <MindmapCanvas data={activeMindmap} title={`${activeCourseData.topic} 成长地图`} />
          )}

          {activeView === 'chapters' && (
            <div className="space-y-2">
              {(activeCourseData.outline?.chapters || []).map((chapter, index) => {
                const progress = (activeCourseData.progress || []).find(p => p.chapter_idx === index);
                const status = progress?.status || 'pending';
                const statusText = status === 'passed' ? '已完成' : status === 'review' ? '待复习' : status === 'studying' ? '学习中' : '未开始';
                return (
                  <button
                    key={index}
                    className="growth-row"
                    onClick={() => setNodePanel({ course: activeCourseData, chapter, chapterIdx: index, status })}
                  >
                    <span className={`growth-dot ${status}`} />
                    <span className="flex-1">
                      <strong>{chapter.title}</strong>
                      <small>{chapter.duration || '--'} · 难度 {chapter.difficulty || 1}/5 · {statusText} · {chapter.learning_text ? '材料已生成' : '材料未生成'}</small>
                    </span>
                    <span className="text-sv-gold">查看</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="sm:hidden flex flex-wrap gap-2 mt-3">
            <button onClick={() => downloadCourseMarkdown(activeCourseData)} className="pixel-btn pixel-btn-teal px-3 py-1 text-xs">
              下载材料
            </button>
            <button onClick={() => downloadCourseMap(activeCourseData)} className="pixel-btn pixel-btn-gold px-3 py-1 text-xs">
              下载导图
            </button>
          </div>
        </div>
      )}

      {quizData && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setQuizData(null)}>
          <div className="pixel-panel w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="pixel-title text-xs">章节测验: {activeChapter?.chapter?.title}</h3>
              <button onClick={() => setQuizData(null)} className="text-sv-red text-lg"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
            </div>

            {(quizData.questions || []).map((q, qi) => (
              <div key={qi} className="mb-4 p-3 bg-black/20 rounded border border-sv-border">
                <p className="text-sm font-pixel-cn mb-2">{qi + 1}. {q.question}</p>
                {(q.options || []).map((opt, oi) => {
                  let optClass = 'bg-sv-panel2 border-sv-border text-sv-text';
                  if (quizSubmitted) {
                    if (oi === q.answer) optClass = 'bg-green-900/50 border-green-500 text-green-300';
                    else if (quizAnswers[qi] === oi && oi !== q.answer) optClass = 'bg-red-900/50 border-red-500 text-red-300';
                  } else if (quizAnswers[qi] === oi) {
                    optClass = 'bg-sv-gold/20 border-sv-gold text-sv-gold';
                  }
                  return (
                    <button
                      key={oi}
                      onClick={() => !quizSubmitted && setQuizAnswers(prev => ({ ...prev, [qi]: oi }))}
                      className={`w-full text-left px-3 py-2 mb-1 text-xs font-pixel-cn rounded border ${optClass}`}
                      style={{ cursor: quizSubmitted ? 'default' : 'pointer' }}
                      disabled={quizSubmitted}
                    >
                      {opt}
                    </button>
                  );
                })}
                {quizSubmitted && q.explanation && (
                  <p className="text-xs text-sv-teal mt-2 font-pixel-cn">解析：{q.explanation}</p>
                )}
              </div>
            ))}

            <div className="flex justify-between">
              {quizSubmitted ? (
                <button onClick={() => setQuizData(null)} className="pixel-btn pixel-btn-gold px-4 text-xs">
                  完成测验
                </button>
              ) : (
                <button onClick={submitQuiz} className="pixel-btn pixel-btn-gold px-4 text-xs">
                  提交答案
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {nodePanel && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={() => setNodePanel(null)}>
          <div className="skill-drawer w-full max-w-3xl h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-sv-teal font-pixel-cn mb-2">{nodePanel.course.topic}</p>
                <h3 className="pixel-title text-xs leading-relaxed">{nodePanel.chapter.title}</h3>
              </div>
              <button onClick={() => setNodePanel(null)} className="text-sv-red text-lg"
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-sv-text2 mb-2">
                <span>Progress</span>
                <span>{nodePanel.status === 'passed' ? '已完成' : nodePanel.status === 'studying' ? '学习中' : nodePanel.status === 'review' ? '待复习' : '未开始'}</span>
              </div>
              <div className="pixel-progress">
                <div className="pixel-progress-fill" style={{ width: nodePanel.status === 'passed' ? '100%' : nodePanel.status === 'studying' ? '45%' : nodePanel.status === 'review' ? '70%' : '8%' }} />
              </div>
            </div>

            <div className="mb-5">
              <h4 className="text-xs text-sv-gold font-pixel-cn mb-2">章节地图</h4>
              <MindmapCanvas data={buildChapterMindmap(nodePanel.course, nodePanel.chapter)} title={`${nodePanel.chapter.title} 章节地图`} />
            </div>

            <div className="mb-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                <h4 className="text-xs text-sv-gold font-pixel-cn">学习材料</h4>
                <button
                  onClick={() => handleGenerateMaterial(nodePanel.course.id, nodePanel.chapterIdx, Boolean(nodePanel.chapter.learning_text))}
                  disabled={nodePanelMaterialLoading}
                  className="pixel-btn pixel-btn-teal px-3 py-1 text-xs"
                >
                  {nodePanelMaterialLoading
                    ? '生成中'
                    : nodePanel.chapter.learning_text
                      ? '重新生成'
                      : '生成本章材料'}
                </button>
              </div>
              {materialError && (
                <p className="text-xs text-sv-red font-pixel-cn mb-2">{materialError}</p>
              )}
              {nodePanel.chapter.learning_text ? (
                <div className="markdown-preview growth-material">
                  <ReactMarkdown>{nodePanel.chapter.learning_text}</ReactMarkdown>
                </div>
              ) : (
                <div className="growth-material-empty">
                  <p>{nodePanel.chapter.summary || `围绕「${nodePanel.chapter.title}」建立概念、方法与实践之间的联系。`}</p>
                  <p>本章详细学习材料尚未生成。点击上方按钮后，系统会单独调用模型生成这一章的具体讲解、误区、练习和完成标准。</p>
                </div>
              )}
            </div>

            <div className="mb-5">
              <h4 className="text-xs text-sv-gold font-pixel-cn mb-2">知识点</h4>
              <div className="flex flex-wrap gap-2">
                {(nodePanel.chapter.points || ['基础概念']).map((point, i) => (
                  <span key={i} className="skill-tag">{point}</span>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <h4 className="text-xs text-sv-gold font-pixel-cn mb-2">外部资源</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {makeResourceLinks(nodePanel.course.topic, nodePanel.chapter).map((res, i) => (
                  <a key={i} href={res.url} target="_blank" rel="noopener noreferrer" className="resource-link">
                    <span>{res.type === 'video' ? '▶' : res.type === 'tutorial' ? '▣' : '◇'}</span>
                    <span>{res.label || res.type || '资源'}</span>
                  </a>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => markChapter(nodePanel.course.id, nodePanel.chapterIdx, 'studying')}
                className="pixel-btn pixel-btn-teal px-3 py-1 text-xs"
              >
                标记学习中
              </button>
              <button
                onClick={() => markChapter(nodePanel.course.id, nodePanel.chapterIdx, 'passed')}
                className="pixel-btn pixel-btn-gold px-3 py-1 text-xs"
              >
                点亮节点
              </button>
              <button
                onClick={() => startQuiz(nodePanel.course.id, nodePanel.chapterIdx, nodePanel.chapter)}
                className="pixel-btn px-3 py-1 text-xs bg-sv-dark text-sv-cream"
                style={{ border: '3px solid #4a4a6a' }}
              >
                随堂测试
              </button>
              <button
                onClick={() => downloadChapterMap(nodePanel.course, nodePanel.chapter)}
                className="pixel-btn px-3 py-1 text-xs bg-sv-panel2 text-sv-cream"
                style={{ border: '3px solid #4a4a6a' }}
              >
                下载章节导图
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {courses.map(course => {
          const isActive = activeCourseData?.id === course.id;
          const chapters = course.outline?.chapters || [];
          const progressList = course.progress || [];
          const completed = progressList.filter(p => p.status === 'passed').length;
          const total = chapters.length;
          const pct = total > 0 ? Math.round(completed / total * 100) : 0;

          return (
            <div key={course.id}
              className={`pixel-panel cursor-pointer transition-all ${isActive ? 'border-sv-gold' : ''}`}
              onClick={() => { setActiveCourse(course); setActiveView('map'); }}
              style={isActive ? { borderColor: '#e8b830' } : {}}
            >
              <div className="flex items-center justify-between mb-2 gap-3">
                <h3 className="text-sm text-sv-gold font-pixel-cn">{course.topic}</h3>
                <span className="text-xs text-sv-teal whitespace-nowrap">{completed}/{total} · {pct}%</span>
              </div>
              <div className="pixel-progress mb-3">
                <div className="pixel-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex flex-wrap gap-1">
                {chapters.slice(0, 5).map((chapter, index) => {
                  const progress = progressList.find(p => p.chapter_idx === index);
                  return (
                    <span key={index} className={`growth-mini ${progress?.status || 'pending'}`}>
                      {chapter.title}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {courses.length === 0 && (
        <div className="pixel-panel text-center py-12">
          <span className="text-4xl block mb-4">🎓</span>
          <p className="font-pixel-cn text-sm text-sv-text2">还没有成长路径</p>
          <p className="text-xs text-sv-text2 mt-2">输入主题，让AI帮你制定学习计划</p>
        </div>
      )}
    </div>
  );
}
