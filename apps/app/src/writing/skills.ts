export const writingSkills = [
  {
    id: "novel-intent",
    title: "拆解章节意图",
    instruction:
      "读用户要求和已确认设定，列出本章目标、视角、必写内容、禁止内容和未决问题。不擅自补足重大世界观事实。只产出本阶段结果，等待作者确认。",
  },
  {
    id: "novel-timeline",
    title: "梳理故事时间线",
    instruction:
      "根据已确认意图，生成T1、T2等编号的时间线。每项注明人物、时空、冲突、转折及与上一事件的因果联系。不自行进入正文创作。",
  },
  {
    id: "novel-events",
    title: "设计小事件",
    instruction:
      "为时间线补充E1、E2等编号的小事件。每项有目的、起因、行动和结果。保留用户锁定的细节，避免随机添加无关支线。",
  },
  {
    id: "novel-scenes",
    title: "展开场景",
    instruction:
      "按场景组织事件，以人物动作、对白、可观察细节推进。检索本书风格样本及临时参考，记录来源。参考不成为本书事实，不照搬原文。",
  },
  {
    id: "novel-draft",
    title: "形成完整章节",
    instruction:
      "将已确认场景组织成完整正文，检查衔接、时序、人物认知和因果。避免逐条事件机械拼接，不用章节总结代替故事。只输出正文。",
  },
  {
    id: "novel-style",
    title: "核对章节风格",
    instruction:
      "对照本书风格与选用参考，给出具体原句、问题、依据与可选改法。区分设定错误与审美偏好，不强行统一句长，不自动修改或定稿正文。",
  },
];
export function skillFile(skill: (typeof writingSkills)[number]) {
  return `---\nname: ${skill.id}\ndescription: ${skill.title}\n---\n\n${skill.instruction}\n\n所有生成产物交由应用保存；用户确认由应用管理，不能自行代替作者确认。\n`;
}
