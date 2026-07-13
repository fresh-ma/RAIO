import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';

const NAV_ITEMS = [
  { path: '/', label: '🏠 主页', icon: '🏠' },
  { path: '/library', label: '📚 图书馆', icon: '📚' },
  { path: '/learn', label: '🎓 成长之路', icon: '🎓' },
  { path: '/news', label: '📰 前沿视野', icon: '📰' },
];

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-sv-bg flex flex-col">
      {/* 顶部导航 */}
      <nav className="bg-sv-bg2 border-b-3 border-sv-border pixel-border-top" style={{ borderBottom: '3px solid #4a4a6a' }}>
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <span className="text-2xl">🔬</span>
            <h1 className="pixel-title text-sm md:text-base">RAIO</h1>
            <span className="text-sv-text2 text-xs hidden md:inline">Research All In One</span>
          </div>
          
          {/* 桌面端导航 */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(item => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`px-3 py-2 text-xs font-pixel-cn transition-all rounded
                  ${location.pathname === item.path
                    ? 'bg-sv-gold text-sv-bg pixel-btn-gold'
                    : 'text-sv-text2 hover:text-sv-gold hover:bg-sv-panel2'
                  }`}
                style={{ border: 'none', boxShadow: 'none', cursor: 'pointer' }}
              >
                {item.label}
              </button>
            ))}
          </div>
          
          {/* 用户信息 */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/profile')}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-sv-panel2 transition-colors"
              style={{ border: 'none', background: 'none', color: 'var(--sv-text)', cursor: 'pointer' }}
            >
              <div className="w-8 h-8 rounded-full bg-sv-gold flex items-center justify-center text-sm">
                {user?.avatar === 'Haley' ? '👩' : '👨'}
              </div>
              <span className="text-xs hidden md:inline text-sv-gold">{user?.display_id || user?.username}</span>
            </button>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="text-xs text-sv-red hover:text-red-300 px-2 py-1"
              style={{ border: 'none', background: 'none', cursor: 'pointer' }}
            >
              退出
            </button>
            
            {/* 移动端菜单按钮 */}
            <button
              className="md:hidden text-sv-gold text-xl px-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{ border: 'none', background: 'none', cursor: 'pointer' }}
            >
              {mobileMenuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>
        
        {/* 移动端菜单 */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-sv-bg2 border-t border-sv-border">
            {NAV_ITEMS.map(item => (
              <button
                key={item.path}
                onClick={() => { navigate(item.path); setMobileMenuOpen(false); }}
                className={`w-full text-left px-6 py-3 text-sm font-pixel-cn
                  ${location.pathname === item.path
                    ? 'bg-sv-gold text-sv-bg'
                    : 'text-sv-text2 hover:bg-sv-panel'
                  }`}
                style={{ border: 'none', cursor: 'pointer', display: 'block' }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </nav>
      
      {/* 主内容 */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4">
        {children}
      </main>
      
      {/* 底部 */}
      <footer className="bg-sv-bg2 border-t-3 border-sv-border py-3 text-center" style={{ borderTop: '3px solid #4a4a6a' }}>
        <p className="text-xs text-sv-text2 font-pixel">RAIO © 2026 · 本地科研 Agent 工作台</p>
      </footer>
    </div>
  );
}
