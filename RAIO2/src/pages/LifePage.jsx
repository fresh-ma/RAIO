import React, { useState, useEffect } from 'react';

const FLOWERS = [
  { id: 'sunflower', name: '向日葵', emoji: '🌻', growthTime: 3, stages: ['🌱', '🌿', '🌸', '🌻'] },
  { id: 'tulip', name: '郁金香', emoji: '🌷', growthTime: 2, stages: ['🌱', '🌿', '🌷'] },
  { id: 'rose', name: '玫瑰', emoji: '🌹', growthTime: 4, stages: ['🌱', '🌿', '🍀', '🌸', '🌹'] },
  { id: 'lavender', name: '薰衣草', emoji: '💜', growthTime: 3, stages: ['🌱', '🌿', '💜', '💐'] },
];

const MOODS = [
  { emoji: '😊', label: '开心' },
  { emoji: '😌', label: '平静' },
  { emoji: '😅', label: '忙碌' },
  { emoji: '😤', label: '烦躁' },
  { emoji: '😴', label: '疲惫' },
  { emoji: '🤔', label: '思考' },
];

export default function LifePage() {
  const [garden, setGarden] = useState([]);
  const [selectedFlower, setSelectedFlower] = useState(null);
  const [mood, setMood] = useState(null);
  const [moodLog, setMoodLog] = useState([]);
  const [waterAnim, setWaterAnim] = useState({});

  useEffect(() => {
    // 从 localStorage 加载数据
    const savedGarden = localStorage.getItem('raio_garden');
    const savedMood = localStorage.getItem('raio_mood_log');
    const savedToday = localStorage.getItem('raio_mood_today');
    
    if (savedGarden) {
      const g = JSON.parse(savedGarden);
      // 检查生长进度
      const now = Date.now();
      const updated = g.map(plant => {
        const age = Math.floor((now - plant.plantedAt) / (plant.growthTime * 60 * 60 * 1000));
        const stageIdx = Math.min(age, plant.stages.length - 1);
        return { ...plant, currentStage: stageIdx };
      });
      setGarden(updated);
    }
    
    if (savedMood) setMoodLog(JSON.parse(savedMood));
    if (savedToday) setMood(JSON.parse(savedToday));
  }, []);

  function plantFlower(flower) {
    const newPlant = {
      id: Date.now(),
      ...flower,
      plantedAt: Date.now(),
      currentStage: 0,
      watered: false,
    };
    const newGarden = [...garden, newPlant];
    setGarden(newGarden);
    localStorage.setItem('raio_garden', JSON.stringify(newGarden));
    setSelectedFlower(null);
  }

  function waterPlant(id) {
    setWaterAnim(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setWaterAnim(prev => ({ ...prev, [id]: false })), 1000);
    
    const newGarden = garden.map(p => p.id === id ? { ...p, watered: true } : p);
    setGarden(newGarden);
    localStorage.setItem('raio_garden', JSON.stringify(newGarden));
  }

  function removePlant(id) {
    const newGarden = garden.filter(p => p.id !== id);
    setGarden(newGarden);
    localStorage.setItem('raio_garden', JSON.stringify(newGarden));
  }

  function logMood(m) {
    const today = new Date().toISOString().split('T')[0];
    setMood(m);
    localStorage.setItem('raio_mood_today', JSON.stringify(m));
    
    const newLog = [{ ...m, date: today, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }, ...moodLog.slice(0, 29)];
    setMoodLog(newLog);
    localStorage.setItem('raio_mood_log', JSON.stringify(newLog));
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="pixel-title text-sm">🌻 活着</h2>
        <span className="text-xs text-sv-text2 font-pixel-cn">科研之余，别忘了生活</span>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 心情记录 */}
        <div className="pixel-panel">
          <h3 className="pixel-title text-xs mb-3">💭 今日心情</h3>
          
          <div className="flex flex-wrap gap-2 mb-4">
            {MOODS.map(m => (
              <button
                key={m.emoji}
                onClick={() => logMood(m)}
                className={`px-3 py-2 text-lg rounded border-2 transition-all
                  ${mood?.emoji === m.emoji
                    ? 'bg-sv-gold/20 border-sv-gold scale-110'
                    : 'bg-sv-panel2 border-sv-border hover:border-sv-teal'
                  }`}
                style={{ cursor: 'pointer' }}
              >
                {m.emoji}
              </button>
            ))}
          </div>
          
          {mood && (
            <div className="p-3 bg-sv-gold/10 rounded border border-sv-gold/30 mb-3">
              <p className="text-sm font-pixel-cn">
                {mood.emoji} 今天心情：{mood.label}
              </p>
              <p className="text-xs text-sv-text2 mt-1">记录时间：{mood.time}</p>
            </div>
          )}
          
          {moodLog.length > 0 && (
            <div>
              <p className="text-xs text-sv-text2 mb-2 font-pixel-cn">心情记录</p>
              <div className="max-h-[150px] overflow-y-auto space-y-1">
                {moodLog.slice(0, 7).map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-sv-text2">
                    <span>{m.emoji}</span>
                    <span>{m.label}</span>
                    <span className="text-sv-text2/50">{m.date} {m.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* 花园 */}
        <div className="pixel-panel">
          <h3 className="pixel-title text-xs mb-3">🌿 我的小花园</h3>
          
          {/* 种花选择 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {FLOWERS.map(f => (
              <button
                key={f.id}
                onClick={() => setSelectedFlower(selectedFlower?.id === f.id ? null : f)}
                className={`px-3 py-2 text-sm rounded border-2 font-pixel-cn transition-all
                  ${selectedFlower?.id === f.id
                    ? 'bg-sv-gold/20 border-sv-gold'
                    : 'bg-sv-panel2 border-sv-border hover:border-sv-teal'
                  }`}
                style={{ cursor: 'pointer' }}
              >
                {f.emoji} {f.name}
              </button>
            ))}
            {selectedFlower && (
              <button
                onClick={() => plantFlower(selectedFlower)}
                className="pixel-btn pixel-btn-gold px-3 py-2 text-xs"
              >
                🌱 种下
              </button>
            )}
          </div>
          
          {/* 花园展示 */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 min-h-[200px]">
            {garden.length === 0 ? (
              <div className="col-span-full flex items-center justify-center h-[200px] text-sv-text2">
                <div className="text-center">
                  <p className="text-3xl mb-2">🌱</p>
                  <p className="text-xs font-pixel-cn">花园空空如也，种点什么吧！</p>
                </div>
              </div>
            ) : (
              garden.map(plant => (
                <div key={plant.id} className="relative p-3 bg-black/20 rounded border border-sv-border text-center group">
                  <div className="text-3xl mb-1 float-anim" style={{ animationDelay: `${Math.random() * 2}s` }}>
                    {plant.stages[plant.currentStage]}
                  </div>
                  <p className="text-xs text-sv-text2 font-pixel-cn">{plant.name}</p>
                  <p className="text-xs text-sv-teal">
                    {plant.currentStage === plant.stages.length - 1 ? '已盛开' : `成长中 ${plant.currentStage + 1}/${plant.stages.length}`}
                  </p>
                  
                  {/* 浇水动画 */}
                  {waterAnim[plant.id] && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 text-xl animate-bounce">
                      💧💧💧
                    </div>
                  )}
                  
                  {/* 操作按钮 */}
                  <div className="flex justify-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => waterPlant(plant.id)} className="text-xs text-sv-teal"
                      style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                      💧浇水
                    </button>
                    <button onClick={() => removePlant(plant.id)} className="text-xs text-sv-red"
                      style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {/* 激励语 */}
      <div className="pixel-panel mt-4 text-center">
        <p className="text-sv-gold font-pixel-cn text-sm">
          🌟 科研是一场马拉松，不是百米冲刺。记得休息，记得呼吸。 🌟
        </p>
      </div>
    </div>
  );
}
