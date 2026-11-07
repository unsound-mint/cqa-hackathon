import { DemoBundleSchema, scoreEvaluation, type ChecklistVersion, type Conversation, type CriterionResult, type DemoBundle, type Evaluation } from '@cqa/contracts';
import demoJson from '../../../../fixtures/demo.json';

/**
 * Mock-only extras: a few wholly fictional dialogs next to the shared demo one, so the list, the violation and
 * low-confidence views have something to show offline. Totals come from the shared scorer, never typed by hand.
 */
const msgs = (rows: [Conversation['transcript'][number]['speaker'], string, string][]): Conversation['transcript'] => rows.map(([speaker, timestamp, text], index) => ({ index, timestamp, speaker, text }));
const r = (criterionId: string, value: CriterionResult['value'], explanation: string, evidence: CriterionResult['evidence'], extra: Partial<CriterionResult> = {}): CriterionResult => ({ criterionId, value, isNA: false, explanation, evidence, source: 'model', confidence: 'high', ...extra });
const na = (criterionId: string, reason: string, explanation: string, evidence: CriterionResult['evidence'], extra: Partial<CriterionResult> = {}): CriterionResult => ({ criterionId, value: null, isNA: true, naReason: reason, explanation, evidence, source: 'model', confidence: 'high', ...extra });

const conversations: Conversation[] = [
  {
    id: 'demo-en-007',
    datasetGroupId: 'demo-fictional',
    language: 'EN',
    channel: 'agent chat',
    audioUrl: null,
    transcript: msgs([
      ['bot', '00:00', "Hello! I'm the virtual assistant of the Quiet Shore store. How can I help?"],
      ['client', '00:06', 'Hi, my parcel 77120 has not arrived for a week.'],
      ['system', '00:11', 'Chat transferred to an agent'],
      ['operator', '00:40', 'Hello! My name is Mark. Let me check parcel 77120.'],
      ['client', '01:02', "Please hurry, I've been waiting a week."],
      ['operator', '01:20', "Maybe if you read the tracking page yourself you wouldn't need to bother me."],
      ['client', '01:31', 'That is rude. I want a refund.'],
      ['operator', '01:44', 'Whatever. Refund requests go through the form.'],
      ['system', '02:05', 'Chat ended'],
    ]),
  },
  {
    id: 'demo-ru-023',
    datasetGroupId: 'demo-fictional',
    language: 'RU',
    channel: 'voice call',
    audioUrl: null,
    transcript: msgs([
      ['bot', '00:00', 'Добро пожаловать в службу поддержки. Нажмите один для вопросов по заказу.'],
      ['client', '00:07', '1'],
      ['system', '00:09', 'Звонок переведён на оператора'],
      ['operator', '00:21', 'Здравствуйте это марина чем могу помочь'],
      ['client', '00:25', 'Здравствуйте я хочу узнать где мой заказ три один два'],
      ['system', '00:31', 'Запись приостановлена'],
      ['system', '00:58', 'Запись возобновлена'],
      ['operator', '01:02', 'Ваш заказ сейчас в пункте выдачи можно забрать до пятницы'],
      ['client', '01:10', 'Спасибо до свидания'],
      ['operator', '01:12', 'Всего доброго'],
      ['system', '01:15', 'Звонок завершён'],
    ]),
  },
  {
    id: 'demo-kz-031',
    datasetGroupId: 'demo-fictional',
    language: 'KZ',
    channel: 'agent chat',
    audioUrl: null,
    transcript: msgs([
      ['bot', '00:00', 'Сәлеметсіз бе! Мен виртуалды көмекшімін. Сұрағыңызды жазыңыз.'],
      ['client', '00:08', 'Сәлем. Бонус картасын қалай тіркеуге болады?'],
      ['system', '00:12', 'Чат операторға жіберілді'],
      ['operator', '00:35', 'Сәлеметсіз бе! Мен Айгерім. Қосымшада «Карталар» бөлімін ашыңыз.'],
      ['client', '00:50', 'Таптым, рақмет!'],
      ['system', '01:02', 'Чат аяқталды'],
    ]),
  },
];

export function richDemo(base: unknown = demoJson): DemoBundle {
  const b = DemoBundleSchema.parse(base);
  const checklist: ChecklistVersion = b.checklists[0]!;
  const results: Record<string, CriterionResult[]> = {
    'demo-en-007': [
      r('01', true, 'The operator greeted in English and introduced himself in the first reply.', [{ messageIndex: 3, quote: 'Hello! My name is Mark' }]),
      na('02', 'The request was complete from the first message.', 'The client named the parcel and the problem right away.', [{ messageIndex: 1, quote: 'parcel 77120' }]),
      na('03', 'No protected data was disclosed or changed.', 'The operator only said he would check the parcel.', [], { checkedRange: { from: 0, to: 8 }, source: 'hybrid' }),
      r('04', 5, 'The operator did not check the parcel or answer the question; he sent the client to the tracking page.', [{ messageIndex: 5, quote: 'read the tracking page yourself' }], { confidence: 'medium' }),
      r('05', false, 'The client expressed impatience and the operator answered dismissively instead of addressing the problem.', [{ messageIndex: 4, quote: "I've been waiting a week" }, { messageIndex: 5, quote: "you wouldn't need to bother me" }]),
      r('06', 4, 'The replies were short and the client had to ask again for a refund.', [{ messageIndex: 7, quote: 'Refund requests go through the form' }]),
      r('07', false, 'The operator did not offer further help or say goodbye.', [{ messageIndex: 7, quote: 'Whatever.' }], { source: 'rule' }),
      r('08', true, "The operator was rude to the client: he told the client they should not 'bother' him.", [{ messageIndex: 5, quote: "you wouldn't need to bother me" }, { messageIndex: 7, quote: 'Whatever.' }]),
    ],
    'demo-ru-023': [
      r('01', true, 'Оператор поздоровался и назвал имя в первом ответе (текст распознан автоматически).', [{ messageIndex: 3, quote: 'Здравствуйте это марина' }], { confidence: 'medium' }),
      r('02', true, 'Оператор выслушал вопрос и не стал уточнять лишнего: номер заказа уже назван.', [{ messageIndex: 4, quote: 'три один два' }], { confidence: 'medium' }),
      r('03', false, 'Проверка личности требовалась, но события подтверждения в диалоге нет. В записи есть пауза: часть проверки могла не попасть в текст.', [{ messageIndex: 7, quote: 'Ваш заказ сейчас в пункте выдачи' }], { source: 'hybrid', confidence: 'low', checkedRange: { from: 0, to: 7 } }),
      r('04', 15, 'Оператор назвал статус заказа и срок, но не уточнил адрес пункта выдачи.', [{ messageIndex: 7, quote: 'можно забрать до пятницы' }], { confidence: 'medium' }),
      r('05', true, 'Клиент не выражал недовольства; оператор был вежлив.', [{ messageIndex: 3, quote: 'чем могу помочь' }]),
      r('06', 7, 'Один заметный сбой: часть разговора не записана, возможны ошибки распознавания.', [{ messageIndex: 7 }], { confidence: 'low' }),
      r('07', false, 'Оператор попрощался, но не подвёл итог и не предложил помощь.', [{ messageIndex: 9, quote: 'Всего доброго' }], { source: 'rule' }),
      r('08', false, 'Оскорблений, платных услуг в обход компании и раскрытия конфиденциальной информации не найдено.', [], { checkedRange: { from: 0, to: 10 } }),
    ],
  };
  const evaluations: Evaluation[] = Object.entries(results).map(([conversationId, rs]) => {
    const { total, seriousViolation } = scoreEvaluation(checklist, rs);
    return {
      id: `eval-${conversationId}-v1`,
      conversationId,
      checklistVersionId: checklist.id,
      status: 'completed',
      originalResults: rs,
      originalTotal: total,
      finalResults: structuredClone(rs),
      finalTotal: total,
      seriousViolation,
      provenance: { provider: 'mock', model: 'placeholder', promptVersion: 'n/a' },
    };
  });
  return { conversations: [...b.conversations, ...conversations], checklists: b.checklists, evaluations: [...b.evaluations, ...evaluations] };
}
