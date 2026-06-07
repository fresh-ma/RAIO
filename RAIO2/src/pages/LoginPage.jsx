import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { register, login } from '../api';

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login: doLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!apiKey.trim()) {
      setError('请输入你的 MaaS API Key');
      return;
    }
    
    if (isRegister) {
      if (!/^[a-zA-Z0-9]{3,12}$/.test(username)) {
        setError('用户名需为3-12位字母数字');
        return;
      }
      if (!/^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z\d]{8,15}$/.test(password)) {
        setError('密码需为8-15位字母+数字组合');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次密码不一致');
        return;
      }
    }
    
    setLoading(true);
    try {
      const data = isRegister
        ? await register(username, password)
        : await login(username, password);
      doLogin(data.token, data.user, apiKey.trim());
      navigate('/');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sv-bg relative overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(rgba(26,26,46,0.85), rgba(26,26,46,0.85)), url('/assets/stardew/Stardew valley/DesertTiles..png')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* 装饰元素 */}
      <div className="absolute top-10 left-10 text-4xl float-anim">🌟</div>
      <div className="absolute top-20 right-20 text-3xl float-anim" style={{ animationDelay: '1s' }}>⭐</div>
      <div className="absolute bottom-20 left-20 text-2xl float-anim" style={{ animationDelay: '0.5s' }}>🌾</div>
      <div className="absolute bottom-10 right-10 text-4xl float-anim" style={{ animationDelay: '1.5s' }}>🌻</div>
      
      <div className="pixel-panel w-full max-w-md mx-4 relative z-10">
        {/* 标题 */}
        <div className="text-center mb-6">
          <h1 className="pixel-title text-xl mb-2">🚜 RAIO</h1>
          <p className="text-sv-text2 text-sm font-pixel-cn">Research All In One</p>
          <p className="text-sv-text2 text-xs mt-1">用星露谷的方式做科研</p>
        </div>
        
        {/* 切换按钮 */}
        <div className="flex mb-6 gap-2">
          <button
            onClick={() => { setIsRegister(false); setError(''); }}
            className={`flex-1 py-2 text-xs font-pixel-cn ${!isRegister ? 'bg-sv-gold text-sv-bg' : 'bg-sv-panel2 text-sv-text2'} pixel-btn`}
            style={{ border: `3px solid ${!isRegister ? '#e8b830' : '#4a4a6a'}` }}
          >
            登录
          </button>
          <button
            onClick={() => { setIsRegister(true); setError(''); }}
            className={`flex-1 py-2 text-xs font-pixel-cn ${isRegister ? 'bg-sv-gold text-sv-bg' : 'bg-sv-panel2 text-sv-text2'} pixel-btn`}
            style={{ border: `3px solid ${isRegister ? '#e8b830' : '#4a4a6a'}` }}
          >
            注册
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="pixel-input"
              placeholder="3-12位字母数字"
              required
            />
          </div>
          
          <div className="mb-4">
            <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pixel-input"
              placeholder="8-15位字母+数字"
              required
            />
          </div>
          
          {isRegister && (
            <div className="mb-4">
              <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pixel-input"
                placeholder="再次输入密码"
                required
              />
            </div>
          )}

          <div className="mb-4">
            <label className="text-xs text-sv-gold font-pixel-cn mb-1 block">MaaS API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pixel-input"
              placeholder="输入你自己的模型 API Key"
              autoComplete="off"
              required
            />
            <p className="text-xs text-sv-text2 mt-1 font-pixel-cn">仅保存在本机浏览器，用于你的 AI 请求</p>
          </div>
          
          {error && (
            <div className="mb-4 p-2 bg-red-900/50 border border-sv-red text-sv-red text-xs font-pixel-cn rounded">
              ⚠️ {error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={loading}
            className="pixel-btn pixel-btn-gold w-full py-3 text-sm font-pixel-cn"
          >
            {loading ? '⏳ 处理中...' : isRegister ? '🎮 创建角色' : '🚜 进入农场'}
          </button>
        </form>
        
        <div className="mt-4 text-center">
          <p className="text-xs text-sv-text2 font-pixel-cn">
            {isRegister ? '已有账号？' : '新用户？'}
            <button
              onClick={() => { setIsRegister(!isRegister); setError(''); }}
              className="text-sv-teal ml-1 hover:underline"
              style={{ border: 'none', background: 'none', cursor: 'pointer' }}
            >
              {isRegister ? '去登录' : '去注册'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
