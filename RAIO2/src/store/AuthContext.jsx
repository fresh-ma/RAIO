import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [maasApiKey, setMaasApiKey] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('raio_token');
    const savedUser = localStorage.getItem('raio_user');
    const savedApiKey = localStorage.getItem('raio_maas_api_key');
    if (savedToken && savedUser && savedApiKey) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      setMaasApiKey(savedApiKey);
    } else if (savedToken || savedUser) {
      localStorage.removeItem('raio_token');
      localStorage.removeItem('raio_user');
      localStorage.removeItem('raio_maas_api_key');
    }
    setLoading(false);
  }, []);

  const login = (newToken, newUser, apiKey) => {
    setToken(newToken);
    setUser(newUser);
    setMaasApiKey(apiKey || '');
    localStorage.setItem('raio_token', newToken);
    localStorage.setItem('raio_user', JSON.stringify(newUser));
    localStorage.setItem('raio_maas_api_key', apiKey || '');
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setMaasApiKey('');
    localStorage.removeItem('raio_token');
    localStorage.removeItem('raio_user');
    localStorage.removeItem('raio_maas_api_key');
  };

  const updateUser = (updates) => {
    const newUser = { ...user, ...updates };
    setUser(newUser);
    localStorage.setItem('raio_user', JSON.stringify(newUser));
  };

  return (
    <AuthContext.Provider value={{ user, token, maasApiKey, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}
