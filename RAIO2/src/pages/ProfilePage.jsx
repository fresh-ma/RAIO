import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { updateProfile } from '../api';

const AVATARS = ['Alex', 'Haley', 'Abigail', 'Emily', 'Sam', 'Sebastian', 'Leah', 'Penny', 'Maru', 'Elliott'];
const LOCATIONS = [
  '鹈鹕镇', '煤矿森林', '山区', '海滩', '沙漠', '巫婆沼泽', '姜岛',
  '鹈鹕镇·未名大学', '巫婆沼泽·五道口学院', '煤矿森林·理工学城'
];

export default function ProfilePage() {
  const { user, token, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    display_id: user?.display_id || user?.username || '',
    avatar: user?.avatar || 'Alex',
    location: user?.location || '',
    email: user?.email || '',
    gender: user?.gender || 0,
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateProfile(token, form);
      updateUser(form);
      setEditing(false);
    } catch (e) {
      console.error('保存失败:', e);
    } finally {
      setSaving(false);
    }
  }

  const avatarEmojis = {
    Alex: '👨', Haley: '👩', Abigail: '💜', Emily: '🧵', Sam: '🎸',
    Sebastian: '🏍️', Leah: '🎨', Penny: '📖', Maru: '🔬', Elliott: '✍️'
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="pixel-title text-sm">👤 个人信息</h2>
        <span className="text-xs text-sv-text2 font-pixel-cn">编辑你的角色信息</span>
      </div>
      
      <div className="pixel-panel max-w-2xl">
        {/* 头像区 */}
        <div className="flex items-center gap-4 mb-4 pb-4" style={{ borderBottom: '3px dashed #4a4a6a' }}>
          <div className="w-16 h-16 rounded-full bg-sv-gold flex items-center justify-center text-3xl pixel-border-gold">
            {avatarEmojis[form.avatar] || '👤'}
          </div>
          <div>
            <h3 className="text-lg text-sv-gold font-pixel-cn">{form.display_id}</h3>
            <p className="text-xs text-sv-text2">@{user?.username}</p>
            <p className="text-xs text-sv-teal mt-1">{form.location || '未设置工作地点'}</p>
          </div>
        </div>
        
        {editing ? (
          <div className="space-y-4">
            {/* 显示名 */}
            <div>
              <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">显示ID</label>
              <input
                value={form.display_id}
                onChange={(e) => setForm(p => ({ ...p, display_id: e.target.value }))}
                className="pixel-input text-sm"
              />
            </div>
            
            {/* 性别/Agent */}
            <div>
              <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">Agent 性别</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setForm(p => ({ ...p, gender: 0 }))}
                  className={`px-4 py-2 text-sm font-pixel-cn ${form.gender === 0 ? 'bg-sv-gold text-sv-bg' : 'bg-sv-panel2 text-sv-text2'} pixel-btn`}
                  style={{ border: `3px solid ${form.gender === 0 ? '#e8b830' : '#4a4a6a'}` }}
                >
                  👨 男（洛墨）
                </button>
                <button
                  onClick={() => setForm(p => ({ ...p, gender: 1 }))}
                  className={`px-4 py-2 text-sm font-pixel-cn ${form.gender === 1 ? 'bg-sv-gold text-sv-bg' : 'bg-sv-panel2 text-sv-text2'} pixel-btn`}
                  style={{ border: `3px solid ${form.gender === 1 ? '#e8b830' : '#4a4a6a'}` }}
                >
                  👩 女（鸮言）
                </button>
              </div>
            </div>
            
            {/* 头像选择 */}
            <div>
              <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">选择头像</label>
              <div className="flex flex-wrap gap-2">
                {AVATARS.map(a => (
                  <button
                    key={a}
                    onClick={() => setForm(p => ({ ...p, avatar: a }))}
                    className={`w-12 h-12 rounded-full flex items-center justify-center text-xl
                      ${form.avatar === a ? 'bg-sv-gold pixel-border-gold' : 'bg-sv-panel2 border-2 border-sv-border'}`}
                    style={{ cursor: 'pointer', border: form.avatar === a ? '3px solid #e8b830' : '2px solid #4a4a6a' }}
                  >
                    {avatarEmojis[a] || '👤'}
                  </button>
                ))}
              </div>
            </div>
            
            {/* 工作地点 */}
            <div>
              <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">工作地点</label>
              <select
                value={form.location}
                onChange={(e) => setForm(p => ({ ...p, location: e.target.value }))}
                className="pixel-input text-sm"
                style={{ appearance: 'auto' }}
              >
                <option value="">请选择</option>
                {LOCATIONS.map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <input
                value={form.location}
                onChange={(e) => setForm(p => ({ ...p, location: e.target.value }))}
                className="pixel-input text-sm mt-2"
                placeholder="或自定义工作地点..."
              />
            </div>
            
            {/* 邮箱 */}
            <div>
              <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">邮箱</label>
              <input
                value={form.email}
                onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
                className="pixel-input text-sm"
                placeholder="your@email.com"
                type="email"
              />
            </div>
            
            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving} className="pixel-btn pixel-btn-gold px-4 py-2 text-xs">
                {saving ? '⏳ 保存中' : '💾 保存'}
              </button>
              <button onClick={() => setEditing(false)} className="pixel-btn px-4 py-2 text-xs bg-sv-panel2 text-sv-text2"
                style={{ border: '3px solid #4a4a6a' }}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-sv-text2 font-pixel-cn">用户名</span>
              <span className="text-sm text-sv-cream">{user?.username}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-sv-text2 font-pixel-cn">显示ID</span>
              <span className="text-sm text-sv-cream">{form.display_id}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-sv-text2 font-pixel-cn">Agent</span>
              <span className="text-sm text-sv-cream">{form.gender === 1 ? '👩 鸮言' : '👨 洛墨'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-sv-text2 font-pixel-cn">工作地点</span>
              <span className="text-sm text-sv-cream">{form.location || '未设置'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-sv-text2 font-pixel-cn">邮箱</span>
              <span className="text-sm text-sv-cream">{form.email || '未设置'}</span>
            </div>
            
            <div className="pt-4" style={{ borderTop: '3px dashed #4a4a6a' }}>
              <button onClick={() => setEditing(true)} className="pixel-btn pixel-btn-gold px-4 py-2 text-xs">
                ✏️ 编辑信息
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
