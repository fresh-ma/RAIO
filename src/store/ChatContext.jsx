import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAgent, setCurrentAgent] = useState('lumo');
  const [selectedAgent, setSelectedAgent] = useState('auto');
  const [currentModel, setCurrentModel] = useState('');
  const abortRef = useRef(null);

  const clearChat = () => {
    setMessages([]);
    setInput('');
    setIsStreaming(false);
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
  };

  useEffect(() => {
    clearChat();
  }, [user?.id]);

  return (
    <ChatContext.Provider value={{
      messages,
      setMessages,
      input,
      setInput,
      isStreaming,
      setIsStreaming,
      currentAgent,
      setCurrentAgent,
      selectedAgent,
      setSelectedAgent,
      currentModel,
      setCurrentModel,
      abortRef,
      clearChat
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
