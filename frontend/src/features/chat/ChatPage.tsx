/**
 * @file 聊天主页 /：背景层 + 1920×1080 画布（页头、角色列表、聊天区）+ 画布外的工具栏。
 * 挂载时拉取会话列表与设置，供三个功能区消费。
 */
import { useEffect } from 'react';
import { DesignCanvas } from '@/components/DesignCanvas';
import { HeaderTop } from '@/components/HeaderTop';
import { MATERIALS } from '@/constants/materials';
import { CharacterCardList } from '@/features/characters/CharacterCardList';
import { ChatArea } from '@/features/chat/ChatArea';
import { useChatStore } from '@/features/chat/chatStore';
import { Toolbar } from '@/features/settings/Toolbar';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 聊天主页 */
export function ChatPage() {
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    void loadConversations();
    void loadSettings();
  }, [loadConversations, loadSettings]);

  return (
    <>
      <div className="fixed inset-0 z-0">
        <img
          className="absolute inset-0 h-full w-full scale-[1.15] object-cover blur-[16px]"
          src={MATERIALS.bgApp}
          alt=""
        />
        <div className="absolute inset-0 bg-app-mask" />
      </div>
      <DesignCanvas>
        <HeaderTop />
        <CharacterCardList />
        <ChatArea />
      </DesignCanvas>
      <Toolbar />
    </>
  );
}
