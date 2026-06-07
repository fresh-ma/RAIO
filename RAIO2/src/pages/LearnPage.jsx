import React, { useState, useEffect } from 'react';
import { useAuth } from '../store/AuthContext';
import { getCourses, generateCourse, generateQuiz, updateProgress } from '../api';

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

export default function LearnPage() {
  const { token } = useAuth();
  const [courses, setCourses] = useState([]);
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeCourse, setActiveCourse] = useState(null);
  const [quizData, setQuizData] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [activeChapter, setActiveChapter] = useState(null);
  const [nodePanel, setNodePanel] = useState(null);

  useEffect(() => {
    loadCourses();
  }, [token]);

  async function loadCourses() {
    if (!token) return;
    try {
      const data = await getCourses(token);
      setCourses(data);
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

  const activeCourseData = activeCourse ? courses.find(c => c.id === activeCourse.id) : null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="pixel-title text-sm">🎓 大师之路</h2>
        <span className="text-xs text-sv-text2 font-pixel-cn">100小时从入门到精通</span>
      </div>
      
      {/* 生成新课程 */}
      <div className="pixel-panel mb-4">
        <p className="text-xs text-sv-gold font-pixel-cn mb-2">输入你想学习的方向，AI将为你定制学习路径</p>
        <div className="flex gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            className="pixel-input flex-1 text-sm"
            placeholder="例如：线性代数、机器学习、Python..."
          />
          <button onClick={handleGenerate} disabled={loading} className="pixel-btn pixel-btn-gold px-4 text-xs">
            {loading ? '⏳ 生成中' : '🚀 生成路径'}
          </button>
        </div>
      </div>
      
      {/* 测验模态框 */}
      {quizData && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setQuizData(null)}>
          <div className="pixel-panel w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="pixel-title text-xs">⚔️ 章节测验: {activeChapter?.chapter?.title}</h3>
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
                  <p className="text-xs text-sv-teal mt-2 font-pixel-cn">💡 {q.explanation}</p>
                )}
              </div>
            ))}
            
            <div className="flex justify-between">
              {quizSubmitted ? (
                <button onClick={() => setQuizData(null)} className="pixel-btn pixel-btn-gold px-4 text-xs">
                  ✅ 完成测验
                </button>
              ) : (
                <button onClick={submitQuiz} className="pixel-btn pixel-btn-gold px-4 text-xs">
                  📝 提交答案
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {nodePanel && (
        <div className="fixed inset-0 bg-black/50 z-40 flex justify-end" onClick={() => setNodePanel(null)}>
          <div className="skill-drawer w-full max-w-xl h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
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
              <h4 className="text-xs text-sv-gold font-pixel-cn mb-2">核心逻辑</h4>
              <p className="text-sm text-sv-text leading-relaxed font-pixel-cn">
                {nodePanel.chapter.summary || `围绕「${nodePanel.chapter.title}」建立概念、方法与实践之间的联系。`}
              </p>
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
            </div>
          </div>
        </div>
      )}
      
      {/* 课程列表 */}
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
              onClick={() => setActiveCourse(course)}
              style={isActive ? { borderColor: '#e8b830' } : {}}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm text-sv-gold font-pixel-cn">{course.topic}</h3>
                <span className="text-xs text-sv-teal">{completed}/{total} · {pct}%</span>
              </div>
              
              {/* 进度条 */}
              <div className="pixel-progress mb-3">
                <div className="pixel-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              
              {/* 章节列表 */}
              {isActive && (
                <div className="space-y-2">
                  {chapters.map((ch, i) => {
                    const prog = progressList.find(p => p.chapter_idx === i);
                    const status = prog?.status || 'pending';
                    const statusIcon = status === 'passed' ? '✅' : status === 'review' ? '🔄' : status === 'studying' ? '📖' : '⬜';
                    
                    return (
                      <div
                        key={i}
                        className="skill-node p-2 bg-black/20 rounded border border-sv-border"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNodePanel({ course, chapter: ch, chapterIdx: i, status });
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>{statusIcon}</span>
                            <div>
                              <p className="text-xs text-sv-cream font-pixel-cn">{ch.title}</p>
                              <p className="text-xs text-sv-text2">
                                {'⭐'.repeat(ch.difficulty || 1)} · {ch.duration || '--'}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); startQuiz(course.id, i, ch); }}
                            className="pixel-btn pixel-btn-teal px-2 py-1 text-xs"
                          >
                            ⚔️ 测验
                          </button>
                        </div>
                        {ch.summary && (
                          <p className="text-xs text-sv-text2 mt-2 font-pixel-cn leading-relaxed line-clamp-2">
                            {ch.summary}
                          </p>
                        )}
                        {ch.points && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {ch.points.map((p, pi) => (
                              <span key={pi} className="text-xs bg-sv-dark/50 px-2 py-0.5 rounded text-sv-text2 font-pixel-cn">
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {courses.length === 0 && (
        <div className="pixel-panel text-center py-12">
          <span className="text-4xl block mb-4">🎓</span>
          <p className="font-pixel-cn text-sm text-sv-text2">还没有学习路径</p>
          <p className="text-xs text-sv-text2 mt-2">输入主题，让AI帮你制定学习计划</p>
        </div>
      )}
    </div>
  );
}
