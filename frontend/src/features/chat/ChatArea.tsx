/**
 * @file 右侧聊天区入口：未选中会话时显示空态；选中后显示聊天条（点击循环三种样式并保存）、聊天框、遮罩与装饰、
 * 角色名、消息列表（key=会话 id，切换时重挂载播放入场动画）和输入面板。放在 DesignCanvas 内，全部为画布坐标。
 * 会话与消息来自 chatStore，聊天条样式与我方头像性别来自 settingsStore。
 */
import { findCharacter, MINE_AVATARS } from '@/constants/characters';
import { CHAT_BOTTOM_DECO, CHAT_CORNER_DECO, CHAT_FRAME_BOX, CHAT_STRIP } from '@/constants/design';
import { CHAT_STRIPS, MATERIALS } from '@/constants/materials';
import { boxStyle } from '@/features/chat/boxStyle';
import { ChatEmpty } from '@/features/chat/ChatEmpty';
import { ChatFrame } from '@/features/chat/ChatFrame';
import { ChatInput } from '@/features/chat/ChatInput';
import { useChatStore } from '@/features/chat/chatStore';
import { MessageList } from '@/features/chat/MessageList';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 聊天条样式循环：v1 → v2 → v3 → v1 */
const NEXT_STRIP = [1, 2, 0] as const;

/** 聊天条上角色名的字号（text-name 令牌），用于垂直居中 */
const NAME_FONT_SIZE = 24.12;

/** 聊天区 */
export function ChatArea() {
  const conversation = useChatStore((s) =>
    s.conversations.find((c) => c.id === s.activeConversationId),
  );
  const messages = useChatStore((s) =>
    s.activeConversationId === null ? undefined : s.messagesByConversation[s.activeConversationId],
  );
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  // 设置尚未加载时按后端默认值显示
  const stripVariant = settings?.strip_variant ?? 0;
  const myGender = settings?.my_gender ?? 'male';
  const character = conversation === undefined ? null : findCharacter(conversation.character_name);

  /** 点击聊天条：切到下一种样式并保存 */
  function handleCycleStrip() {
    void updateSettings({ strip_variant: NEXT_STRIP[stripVariant] });
  }

  /** 点击我方头像：切换管理员性别并保存 */
  function handleToggleGender() {
    void updateSettings({ my_gender: myGender === 'male' ? 'female' : 'male' });
  }

  return (
    <section className="absolute top-0 left-0 h-0 w-0">
      {character === null ? (
        <ChatEmpty />
      ) : (
        <>
          {/* ⚠️ 零尺寸容器内的 img 必须 max-w-none：preflight 的 max-width:100% 会把宽度压成 0 */}
          {/* 右上角装饰：左右镜像，位于遮罩之上、其他元素之下 */}
          <img
            className="pointer-events-none absolute z-0 max-w-none origin-[right_center] -scale-x-100 opacity-20"
            style={{ left: CHAT_CORNER_DECO.x, top: CHAT_CORNER_DECO.y, width: CHAT_CORNER_DECO.w }}
            src={MATERIALS.chatCornerDeco45}
            alt=""
          />
          <img
            role="button"
            aria-label="切换聊天条样式"
            className="absolute z-[1] max-w-none cursor-pointer select-none"
            style={boxStyle(CHAT_STRIP)}
            src={CHAT_STRIPS[stripVariant]}
            alt=""
            onClick={handleCycleStrip}
          />
          <ChatFrame />
          {/* 半透明白色遮罩（z2，底部两角圆角）与浅色叠加，都只盖聊天框区域，不拦截事件 */}
          <div
            className="pointer-events-none absolute z-[2] rounded-b-panel bg-chat-tint"
            style={boxStyle(CHAT_FRAME_BOX)}
          />
          <div
            className="pointer-events-none absolute bg-chat-tint"
            style={boxStyle(CHAT_FRAME_BOX)}
          />
          <p
            className="absolute z-[2] text-name leading-none font-medium whitespace-nowrap text-text-primary select-text"
            style={{
              left: CHAT_STRIP.x + 48,
              top: CHAT_STRIP.y + (CHAT_STRIP.h - NAME_FONT_SIZE) / 2,
            }}
          >
            {character.name}
          </p>
        </>
      )}
      <img
        className="pointer-events-none absolute z-[4] max-w-none"
        style={boxStyle(CHAT_BOTTOM_DECO)}
        src={MATERIALS.chatBottomDeco}
        alt=""
      />
      {/* 消息未拉取到之前不挂载列表，首屏消息才不会被当成追加行播放尺寸过渡 */}
      {character !== null && conversation !== undefined && messages !== undefined && (
        <MessageList
          key={conversation.id}
          conversationId={conversation.id}
          messages={messages}
          otherAvatar={character.avatar}
          mineAvatar={MINE_AVATARS[myGender]}
          onMineAvatarClick={handleToggleGender}
        />
      )}
      {character !== null && <ChatInput />}
    </section>
  );
}
