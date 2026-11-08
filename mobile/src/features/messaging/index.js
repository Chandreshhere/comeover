// Feature module: messaging (inbox, direct and activity group chats).
import InboxScreen from './InboxScreen';
import ChatThreadScreen from './ChatThreadScreen';
import GroupChatScreen from './GroupChatScreen';

export const screens = {
  inbox: InboxScreen,
  chat_thread: ChatThreadScreen,
  group_chat: GroupChatScreen,
};
