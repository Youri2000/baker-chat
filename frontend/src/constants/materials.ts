/**
 * @file 素材集中导入表：只包含保留功能用到的图片，键名沿用原项目 constants/materials.ts，
 * 便于对照 Vue 组件迁移。PNG 导出、ZIP、自定义背景、移动端专用素材不再复制。
 */
import bgApp from '@/assets/materials/bg_app.webp';
import headerDeco from '@/assets/materials/achievement_main_deco05.webp';
import editPopDecoTl from '@/assets/materials/deco_sns_tweet_decorate_31.webp';
import editPopDecoBr from '@/assets/materials/deco_sns_tweet_decorate_32.webp';
import cardTexture from '@/assets/materials/deco_sns_hudentry_bg.webp';
import cardFaint from '@/assets/materials/deco_sns_tweet_decorate_02.webp';
import subFaint from '@/assets/materials/deco_sns_tweet_decorate_03.webp';
import decoBadge from '@/assets/materials/deco_sns_tweet_decorate_06.webp';
import decoWing from '@/assets/materials/deco_sns_tweet_decorate_42.webp';
import subArrow from '@/assets/materials/deco_source_arrow.webp';
import underline from '@/assets/materials/deco_sns_tweet_decorate.webp';
import cornerDeco from '@/assets/materials/deco_sns_list_decorate.webp';
import chatBadge from '@/assets/materials/icon_sns_chat_01.webp';
import circleBorder from '@/assets/materials/line_common_circle_food.webp';
import cardArrow from '@/assets/materials/deco_common_arrow_p2.webp';
import avatarFrame from '@/assets/materials/bg_snscharentry_head_Line.webp';
import avatarBase from '@/assets/materials/icon_virtualmouse_bg.webp';
import chatStripV1 from '@/assets/materials/chat_strip_v1.webp';
import chatStripV2 from '@/assets/materials/chat_strip_v2.webp';
import chatStripV3 from '@/assets/materials/chat_strip_v3.webp';
import chatBottomDeco from '@/assets/materials/chat_bottom_deco.webp';
import choiceTopDeco from '@/assets/materials/choice_top_deco.webp';
import chatEmptyPlaceholder from '@/assets/materials/chat_empty_placeholder.webp';
import chatCornerDeco45 from '@/assets/materials/deco_sns_tweet_decorate_45.webp';
import editBtnEmoticon from '@/assets/materials/icon_sns_chat_emoticon.webp';
import editBtnChat from '@/assets/materials/icon_sns_chat_04.webp';
import editBtnChat09 from '@/assets/materials/icon_sns_chat_09.webp';
import editBtnDeleteIndeed from '@/assets/materials/icon_tips_delete_indeed.webp';
import loginBtnSetting from '@/assets/materials/login_btn_setting.webp';

/** 素材 URL 表，按使用区域分组；键名 = 原项目键名 */
export const MATERIALS = {
  // 应用背景 / 页头装饰
  bgApp,
  headerDeco,
  // 主卡：纹理、淡影、名字下划线、右上角装饰、折叠按钮圆环与箭头、聊天角标
  cardTexture,
  cardFaint,
  underline,
  cornerDeco,
  circleBorder,
  cardArrow,
  chatBadge,
  // 子卡：淡影、选中徽标、选中翼饰、选中箭头
  subFaint,
  decoBadge,
  decoWing,
  subArrow,
  // 聊天区头像三层中的底图与环形框
  avatarBase,
  avatarFrame,
  // 聊天条三种样式（点击循环）、底部装饰、右上角装饰、空态占位图
  chatStripV1,
  chatStripV2,
  chatStripV3,
  chatBottomDeco,
  chatCornerDeco45,
  chatEmptyPlaceholder,
  // 输入面板：顶部装饰、表情弹层左上/右下角装饰、表情按钮、发送按钮
  choiceTopDeco,
  editPopDecoTl,
  editPopDecoBr,
  editBtnEmoticon,
  editBtnChat,
  // 右上角工具栏：新建会话、对话管理、设置
  editBtnChat09,
  editBtnDeleteIndeed,
  loginBtnSetting,
} as const;

/** 聊天条三种样式按 strip_variant（0/1/2）索引 */
export const CHAT_STRIPS = [chatStripV1, chatStripV2, chatStripV3] as const;
