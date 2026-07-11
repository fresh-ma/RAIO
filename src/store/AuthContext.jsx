import React, { createContext, useContext, useState, useEffect } from 'react';
import { DEFAULT_MAAS_MODEL } from '../../shared/maasModels';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [maasApiKey, setMaasApiKey] = useState('');
  const [maasModel, setMaasModel] = useState(DEFAULT_MAAS_MODEL);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('raio_token');
    const savedUser = localStorage.getItem('raio_user');
    const savedApiKey = localStorage.getItem('raio_maas_api_key');
    const savedModel = localStorage.getItem('raio_maas_model') || DEFAULT_MAAS_MODEL;
    if (savedToken && savedUser && savedApiKey) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      setMaasApiKey(savedApiKey);
      setMaasModel(savedModel);
    } else if (savedToken || savedUser) {
      localStorage.removeItem('raio_token');
      localStorage.removeItem('raio_user');
      localStorage.removeItem('raio_maas_api_key');
      localStorage.removeItem('raio_maas_model');
    }
    setLoading(false);
  }, []);

  const login = (newToken, newUser, apiKey, model = DEFAULT_MAAS_MODEL) => {
    setToken(newToken);
    setUser(newUser);
    setMaasApiKey(apiKey || '');
    setMaasModel(model);
    localStorage.setItem('raio_token', newToken);
    localStorage.setItem('raio_user', JSON.stringify(newUser));
    localStorage.setItem('raio_maas_api_key', apiKey || '');
    localStorage.setItem('raio_maas_model', model);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setMaasApiKey('');
    setMaasModel(DEFAULT_MAAS_MODEL);
    localStorage.removeItem('raio_token');
    localStorage.removeItem('raio_user');
    localStorage.removeItem('raio_maas_api_key');
    localStorage.removeItem('raio_maas_model');
  };

  const updateUser = (updates) => {
    const newUser = { ...user, ...updates };
    setUser(newUser);
    localStorage.setItem('raio_user', JSON.stringify(newUser));
  };

  const updateMaasModel = (model) => {
    setMaasModel(model);
    localStorage.setItem('raio_maas_model', model);
  };

  const updateMaasApiKey = (apiKey) => {
    setMaasApiKey(apiKey);
    localStorage.setItem('raio_maas_api_key', apiKey || '');
  };

  return (
    <AuthContext.Provider value={{ user, token, maasApiKey, maasModel, loading, login, logout, updateUser, updateMaasModel, updateMaasApiKey }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}
