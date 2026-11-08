// chat_thread — direct conversation (only between people who shared an accepted plan).
import React from 'react';
import { useRoute } from '@react-navigation/native';
import ChatView from './components/ChatView';

export default function ChatThreadScreen() {
  const route = useRoute();
  return <ChatView conversationId={route.params?.conversationId} />;
}
