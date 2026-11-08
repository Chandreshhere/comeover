// group_chat — activity group chat with venue (revealed after acceptance),
// check-in, bill split and trusted-contact sharing context.
import React from 'react';
import { useRoute } from '@react-navigation/native';
import ChatView from './components/ChatView';

export default function GroupChatScreen() {
  const route = useRoute();
  return <ChatView conversationId={route.params?.conversationId} />;
}
