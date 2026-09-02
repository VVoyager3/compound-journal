import { DIMENSIONS, type Dimension } from './model.ts';

export type AssessmentLength = 30 | 60;

export interface AssessmentQuestion {
  id: string;
  dimension: Dimension;
  text: string;
  reverse: boolean;
}

const QUESTION_BANK: Record<Dimension, Array<{ text: string; reverse?: boolean }>> = {
  energy: [
    { text: '醒来后，我有足够精力开始一天。' },
    { text: '白天大部分时候，我的体力够用。' },
    { text: '最近的睡眠能让我恢复。' },
    { text: '我能规律吃饭并补充水分。' },
    { text: '我能完成日常活动，不会很快耗尽体力。' },
    { text: '疲劳或身体不适影响了我的日常安排。', reverse: true },
    { text: '累的时候，我能及时停下来休息。' },
    { text: '久坐之后，我会主动活动身体。' },
    { text: '我的入睡和起床时间大体稳定。' },
    { text: '我能注意到身体发出的疲劳信号。' },
    { text: '我经常靠硬撑才能完成一天。', reverse: true },
    { text: '休息之后，我通常能明显恢复。' },
  ],
  mind: [
    { text: '我能分辨自己现在是什么情绪。' },
    { text: '遇到压力时，我能慢慢恢复平静。' },
    { text: '最近大部分时间，我的情绪相对稳定。' },
    { text: '我能把注意力放回眼前正在做的事。' },
    { text: '我愿意给自己留出喘息的时间。' },
    { text: '担忧或反复思考让我难以停下来。', reverse: true },
    { text: '事情不顺时，我不会立刻否定自己。' },
    { text: '我能向别人说出自己的真实感受。' },
    { text: '最近我很少被情绪突然淹没。' },
    { text: '我知道什么方法能让自己平静一些。' },
    { text: '小事也会让我持续紧绷很久。', reverse: true },
    { text: '面对变化时，我仍能保留一点掌控感。' },
  ],
  connection: [
    { text: '我身边有可以说真话的人。' },
    { text: '需要帮助时，我知道可以联系谁。' },
    { text: '最近我和重要的人有真实交流。' },
    { text: '我能感受到别人对我的关心。' },
    { text: '我也有精力关心身边重要的人。' },
    { text: '即使和别人在一起，我仍常感到孤单。', reverse: true },
    { text: '关系中出现不舒服时，我能表达边界。' },
    { text: '我能接受来自亲近之人的支持。' },
    { text: '我和重要的人之间有基本的信任。' },
    { text: '我有一些不带任务目的的相处时间。' },
    { text: '我常因为害怕麻烦别人而独自硬撑。', reverse: true },
    { text: '最近我对身边的人有连接感。' },
  ],
  progress: [
    { text: '我知道最近最重要的一件事是什么。' },
    { text: '我能把重要事情推进一小步。' },
    { text: '工作或学习中，我能看到一些结果。' },
    { text: '我能区分真正重要的事和临时干扰。' },
    { text: '每天开始时，我大致知道从哪里着手。' },
    { text: '我做了很多事，却仍不知道自己推进了什么。', reverse: true },
    { text: '任务太大时，我能把它缩小。' },
    { text: '我能为重要事情留出相对完整的时间。' },
    { text: '遇到卡点时，我会调整方法而不是一直硬耗。' },
    { text: '最近的投入和我想去的方向基本一致。' },
    { text: '临时事务经常打乱我真正想做的事。', reverse: true },
    { text: '结束一天时，我通常知道自己完成了什么。' },
  ],
  play: [
    { text: '最近我做过纯粹因为喜欢而做的事。' },
    { text: '休息时，我能暂时不想工作或任务。' },
    { text: '我仍会对一些事感到好奇或期待。' },
    { text: '最近的生活里有让我开心或觉得有趣的时刻。' },
    { text: '我有不追求产出也可以安心度过的时间。' },
    { text: '即使有空，我也很难真正放松。', reverse: true },
    { text: '我愿意尝试一点新的活动或体验。' },
    { text: '我能找到适合自己的休闲方式。' },
    { text: '玩乐之后，我通常会感觉恢复了一些。' },
    { text: '我能允许自己休息，而不是一直感到内疚。' },
    { text: '最近每一天都只剩下必须完成的事情。', reverse: true },
    { text: '我的一周里有值得期待的非工作安排。' },
  ],
};

export function assessmentQuestions(length: AssessmentLength): AssessmentQuestion[] {
  const perDimension = length / DIMENSIONS.length;
  return DIMENSIONS.flatMap(({ key }) => QUESTION_BANK[key].slice(0, perDimension).map((question, index) => ({
    id: `${key}-${index + 1}`,
    dimension: key,
    text: question.text,
    reverse: question.reverse ?? false,
  })));
}

export function scoreDimensionAssessment(
  dimension: Dimension,
  questions: AssessmentQuestion[],
  answers: Readonly<Record<string, number>>,
): number {
  const dimensionQuestions = questions.filter((question) => question.dimension === dimension);
  if (!dimensionQuestions.length) throw new Error('问卷缺少状态维度。');
  let total = 0;
  for (const question of dimensionQuestions) {
    const answer = answers[question.id];
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 1 || answer > 5) throw new Error('请回答全部问题。');
    total += question.reverse ? 6 - answer : answer;
  }
  return Math.round(total / dimensionQuestions.length * 20);
}

export function scoreAssessment(questions: AssessmentQuestion[], answers: Readonly<Record<string, number>>): Record<Dimension, number> {
  return Object.fromEntries(DIMENSIONS.map(({ key }) => [key, scoreDimensionAssessment(key, questions, answers)])) as Record<Dimension, number>;
}
