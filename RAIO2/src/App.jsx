import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/AuthContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import LearnPage from './pages/LearnPage';
import NewsPage from './pages/NewsPage';
import LifePage from './pages/LifePage';
import ProfilePage from './pages/ProfilePage';
import Layout from './components/Layout';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen bg-sv-bg">
    <p className="pixel-title text-lg">加载中...</p>
  </div>;
  if (!user) return <Navigate to="/login" />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout><HomePage /></Layout></ProtectedRoute>} />
      <Route path="/library" element={<ProtectedRoute><Layout><LibraryPage /></Layout></ProtectedRoute>} />
      <Route path="/learn" element={<ProtectedRoute><Layout><LearnPage /></Layout></ProtectedRoute>} />
      <Route path="/news" element={<ProtectedRoute><Layout><NewsPage /></Layout></ProtectedRoute>} />
      <Route path="/life" element={<ProtectedRoute><Layout><LifePage /></Layout></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Layout><ProfilePage /></Layout></ProtectedRoute>} />
    </Routes>
  );
}
