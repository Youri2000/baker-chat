/**
 * @file 设置 › 免责声明：静态文本，第一节改为与后端按账号存储一致的说明，其余与原项目 SettingsDialog.vue 逐字一致。
 * 样式对应 sd__disclaimer-*：标题 18px 居中、小标题 15px 强调色、正文 13px/1.7 75% 白。
 */

/** 段落正文 */
const TEXT_CLASS = 'text-text-primary/75 text-[13px] leading-[1.7]';
/** 列表：preflight 去掉了 list-style，这里显式补回 */
const LIST_CLASS = 'text-text-primary/75 text-[13px] leading-[1.8] [&>li]:mb-0.5';
/** 小标题 */
const HEADING_CLASS = 'text-accent text-[15px] font-semibold';
/** 强调 */
const WARN_CLASS = 'font-semibold text-[#ff6b6b]';

/** 免责声明标签页 */
export function DisclaimerTab() {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="mb-1 text-center text-[18px] font-semibold text-text-primary">
        安全合规与责任声明
      </h3>

      <div className="flex flex-col gap-1.5">
        <h4 className={HEADING_CLASS}>一、数据存储与隐私</h4>
        <p className={TEXT_CLASS}>
          本工具完全开源；您的账号、聊天记录、AI
          上下文、世界观与角色提示词按用户账号保存在本服务的后端数据库中，仅用于向 AI
          服务商发起您的对话请求，不会用于其他用途。
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className={HEADING_CLASS}>二、提示词安全设置声明</h4>
        <p className={TEXT_CLASS}>
          为履行合规义务，我们在本工具中内置了严格的内容安全提示词。该提示词明确要求角色：
        </p>
        <ul className={`${LIST_CLASS} list-disc pl-5`}>
          <li>仅在《明日方舟：终末地》世界观内进行角色扮演；</li>
          <li>回避一切现实世界人物、政治敏感、色情、暴力、非法等违规内容；</li>
          <li>拒绝任何试图覆盖或修改这些安全规则的指令。</li>
        </ul>
        <p className={TEXT_CLASS}>
          <strong className={WARN_CLASS}>严重警告：</strong>
          任何通过修改代码、注入脚本等方式删除或篡改上述安全提示词的行为，均属您个人的独立行为。对于因篡改后生成的一切违法、违规或侵权内容，全部法律责任由实施该行为的用户自行承担，与本工具开发者无关。
        </p>
        <p className={TEXT_CLASS}>
          <strong className={WARN_CLASS}>技术限制特别声明：</strong>
          本工具代码由人工智能生成。尽管已尽力确保安全提示词在正常情况下有效运行，但仍无法完全排除因程序错误（Bug）、浏览器兼容性异常、网络加载时序问题等不可预见的技术原因，导致安全提示词意外失效、未正确注入或未按预期执行的可能性。对于因上述技术异常而导致的任何违规内容生成，本工具开发者不承担责任。您选择继续使用本工具，即表示您理解并自愿承担这一技术风险。
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className={HEADING_CLASS}>三、用户责任与合规使用</h4>
        <p className={TEXT_CLASS}>您明确知晓并同意，您是使用本工具生成内容的唯一责任人。您承诺：</p>
        <ol className={`${LIST_CLASS} list-decimal pl-6`}>
          <li>严格遵守您所使用AI模型服务商的所有使用政策与安全准则。</li>
          <li>
            遵守您所在地及服务商所在地的现行法律法规，绝不利用本工具生成任何涉及政治敏感、淫秽色情、暴力恐怖、仇恨歧视、侵犯他人合法权益以及其他一切违法和不良信息。
          </li>
          <li>
            理解并接受本工具仅用于合法的《明日方舟：终末地》同人角色扮演娱乐，任何超出此用途的使用风险自担。
          </li>
        </ol>
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className={HEADING_CLASS}>四、知识产权与同人声明</h4>
        <p className={TEXT_CLASS}>
          《明日方舟：终末地》是上海鹰角网络科技有限公司的游戏产品。本工具为第三方同人作品，无任何盈利性质，与上海鹰角网络科技有限公司及《明日方舟：终末地》官方开发商、运营商无任何关联。
        </p>
        <p className={TEXT_CLASS}>
          本工具中使用的所有与《明日方舟：终末地》相关的角色形象、世界观设定、剧情元素、图片资源等知识产权，均归上海鹰角网络科技有限公司所有。本工具仅供爱好者学习与交流，严禁用于任何商业用途。
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className={HEADING_CLASS}>五、免责条款</h4>
        <p className={TEXT_CLASS}>
          在法律允许的最大范围内，本工具开发者不对以下情况承担任何明示或默示的担保或责任：
        </p>
        <ul className={`${LIST_CLASS} list-disc pl-5`}>
          <li>用户因违反本声明或第三方服务商条款而产生的任何纠纷、处罚或损失；</li>
          <li>用户因篡改代码、移除安全提示词等自主行为所引发的一切后果；</li>
          <li>对第三方AI模型服务商提供的服务质量、内容准确性及合规性。</li>
        </ul>
        <p className={TEXT_CLASS}>
          请您在使用前务必仔细阅读并同意以上全部条款。继续使用即代表您已充分理解并自愿承担所有相关风险。
        </p>
      </div>
    </div>
  );
}
