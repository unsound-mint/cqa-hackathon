import { readFileSync } from 'node:fs';
import { DemoBundleSchema, type Conversation, type Criterion, type TranscriptMessage } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { conversations } from '../src/db/schema.js';
import { ASSISTED_DETECTORS } from '../src/services/evaluation/detectors/index.js';
import { deriveFacts } from '../src/services/evaluation/facts.js';
import type { LlmProvider, ProviderRequest } from '../src/services/evaluation/provider.js';

const det = ASSISTED_DETECTORS.verification!;
const crit = (over: Partial<Criterion> = {}): Criterion => ({ id: '03', title: 'Идентификация', instructions: 'x', weight: 20, kind: 'boolean', allowedValues: [true, false], allowNA: true, detector: 'verification', ...over });
const conv = (rows: [TranscriptMessage['speaker'], string][], language: Conversation['language'] = 'RU'): Conversation => ({
  id: 'v', datasetGroupId: 'g', language, channel: 'agent chat', audioUrl: null,
  transcript: rows.map(([speaker, text], index) => ({ index, timestamp: '00:00', speaker, text })),
});
const VERIFIED = 'Личность клиента подтверждена.';
const ans = (over: object = {}) => ({ verificationRequired: true, reason: 'оператор назвал статус заказа', confidence: 'high', firstProtectedDisclosure: { messageIndex: 3, quote: 'Ваш заказ' }, ...over });
const decide = (c: Conversation, a: object, criterion = crit()) => det.decide({ conversation: c, facts: deriveFacts(c), criterion }, det.validate({ conversation: c, facts: deriveFacts(c) }, a).answers!);

describe('verification: the verdict comes from code and system events', () => {
  const ok = conv([['client', 'где заказ?'], ['operator', 'Подтвердите код'], ['system', VERIFIED], ['operator', 'Ваш заказ в пути']]);

  it('Yes when the identity-verified event precedes the first protected disclosure', () => {
    const r = decide(ok, ans());
    expect(r).toMatchObject({ value: true, isNA: false, source: 'hybrid', confidence: 'high' });
    expect(r.evidence).toEqual([{ messageIndex: 2, quote: 'Личность клиента подтверждена' }, { messageIndex: 3, quote: 'Ваш заказ' }]);
    expect(r.checkedRange).toEqual({ from: 0, to: 3 });
  });

  it('No when the event only appears after the disclosure', () => {
    const late = conv([['client', 'где заказ?'], ['operator', 'Ваш заказ в пути'], ['system', VERIFIED]]);
    const r = decide(late, ans({ firstProtectedDisclosure: { messageIndex: 1, quote: 'Ваш заказ' } }));
    expect(r).toMatchObject({ value: false, source: 'hybrid' });
    expect(r.explanation).toMatch(/только после/);
  });

  it('No when required but no event exists, even if the operator claims to have verified', () => {
    const claim = conv([['client', 'где заказ?'], ['operator', 'Я проверил вашу личность. Ваш заказ в пути']]);
    const r = decide(claim, ans({ firstProtectedDisclosure: { messageIndex: 1, quote: 'Ваш заказ' } }));
    expect(r).toMatchObject({ value: false });
    expect(r.explanation).toMatch(/нет/);
  });

  it('No with LOW confidence when the recording was paused (a human must look)', () => {
    const paused = conv([['client', 'q'], ['system', 'Запись и транскрибирование приостановлены.'], ['system', 'Запись и транскрибирование возобновлены.'], ['operator', 'Ваш заказ в пути']]);
    const r = decide(paused, ans());
    expect(r).toMatchObject({ value: false, confidence: 'low' });
    expect(r.explanation).toMatch(/паузы/);
  });

  describe('verification phrasing the code does not know', () => {
    const NEW = 'Клиент успешно прошёл аутентификацию.';
    const unk = conv([['client', 'где заказ?'], ['operator', 'Подтвердите код'], ['system', NEW], ['operator', 'Ваш заказ в пути']]);
    const found = { unrecognizedVerificationEvent: { messageIndex: 2, quote: 'успешно прошёл аутентификацию' } };

    it('without the model spotting it, an unknown phrasing still yields No (the known risk)', () => {
      expect(decide(unk, ans())).toMatchObject({ value: false });
    });

    it('a model-spotted system event before the disclosure counts, with confidence capped at medium', () => {
      const r = decide(unk, ans(found));
      expect(r).toMatchObject({ value: true, confidence: 'medium', source: 'hybrid' });
      expect(r.evidence[0]).toEqual({ messageIndex: 2, quote: 'успешно прошёл аутентификацию' });
    });

    it.each([
      ['an operator message', { messageIndex: 1, quote: 'Подтвердите код' }, /must be a system message/],
      ['a quote that is not in the message', { messageIndex: 2, quote: 'нет такой фразы' }, /not found verbatim/],
      ['an index outside the transcript', { messageIndex: 99, quote: 'x' }, /outside the transcript/],
    ])('rejects %s as the event', (_n, ev, re) => {
      expect(det.validate({ conversation: unk, facts: deriveFacts(unk) }, ans({ unrecognizedVerificationEvent: ev })).problems.join()).toMatch(re);
    });

    it('rejects naming an event the code already recognised', () => {
      const known = conv([['client', 'q'], ['system', VERIFIED], ['operator', 'Ваш заказ']]);
      const v = det.validate({ conversation: known, facts: deriveFacts(known) }, ans({ firstProtectedDisclosure: { messageIndex: 2, quote: 'Ваш заказ' }, unrecognizedVerificationEvent: { messageIndex: 1, quote: 'Личность' } }));
      expect(v.problems.join()).toMatch(/already a recognised/);
    });
  });

  it('N/A when verification was not required, carrying the reason', () => {
    const faq = conv([['client', 'как найти отчёт?'], ['operator', 'Откройте меню.']]);
    const r = decide(faq, ans({ verificationRequired: false, reason: 'справочный вопрос', firstProtectedDisclosure: null }));
    expect(r).toMatchObject({ value: null, isNA: true, naReason: 'справочный вопрос', source: 'hybrid' });
  });

  it('required with no disclosure yet: Yes if an event exists, else No', () => {
    const verifiedOnly = conv([['client', 'q'], ['operator', 'Назовите код'], ['system', VERIFIED]]);
    expect(decide(verifiedOnly, ans({ firstProtectedDisclosure: null }))).toMatchObject({ value: true });
    const none = conv([['client', 'q'], ['operator', 'Назовите код']]);
    expect(decide(none, ans({ firstProtectedDisclosure: null }))).toMatchObject({ value: false });
  });

  it('works in KZ and EN with their own phrasing', () => {
    const kz = conv([['client', 'q'], ['system', 'Клиенттің жеке басы расталды.'], ['operator', 'Тапсырысыңыз жолда']], 'KZ');
    expect(decide(kz, ans({ firstProtectedDisclosure: { messageIndex: 2, quote: 'Тапсырысыңыз' } })).explanation).toMatch(/Ереже/);
    const en = conv([['client', 'q'], ['system', 'Customer identity verified.'], ['operator', 'Your order is on its way']], 'EN');
    expect(decide(en, ans({ firstProtectedDisclosure: { messageIndex: 2, quote: 'Your order' } }))).toMatchObject({ value: true });
  });

  it('only applies to boolean criteria that can express N/A', () => {
    expect(det.appliesTo(crit())).toBe(true);
    expect(det.appliesTo(crit({ allowNA: false }))).toBe(false);
    expect(det.appliesTo(crit({ kind: 'discrete-scale', allowedValues: [0, 1] }))).toBe(false);
  });
});

describe('verification: the model\'s answers are checked against the transcript', () => {
  const c = conv([['client', 'q'], ['bot', 'Ваш заказ'], ['operator', 'Ваш заказ в пути']]);
  const problems = (a: unknown) => det.validate({ conversation: c, facts: deriveFacts(c) }, a).problems.join(' | ');

  it.each([
    ['index outside the transcript', ans({ firstProtectedDisclosure: { messageIndex: 99, quote: 'x' } }), /outside the transcript/],
    ['a bot message as the disclosure', ans({ firstProtectedDisclosure: { messageIndex: 1, quote: 'Ваш заказ' } }), /must be an operator message/],
    ['a quote that is not in the message', ans({ firstProtectedDisclosure: { messageIndex: 2, quote: 'выдуманная цитата' } }), /not found verbatim/],
    ['not required but a disclosure given', ans({ verificationRequired: false, firstProtectedDisclosure: { messageIndex: 2, quote: 'Ваш заказ' } }), /contradicts/],
    ['malformed answers', { verificationRequired: 'yes' }, /answers/],
  ])('rejects %s', (_n, a, re) => {
    expect(problems(a)).toMatch(re);
  });

  it('accepts a grounded answer', () => {
    expect(problems(ans({ firstProtectedDisclosure: { messageIndex: 2, quote: 'Ваш заказ' } }))).toBe('');
  });
});

describe('verification inside the evaluation pipeline', () => {
  const demo = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8'))).conversations[0]!;

  function run(answer: (n: number, req: ProviderRequest) => { assisted?: unknown; extraResults?: unknown[] }) {
    const calls: ProviderRequest[] = [];
    const provider: LlmProvider = {
      name: 'fake', model: 'fake-1',
      async complete(req) {
        calls.push(req);
        const p = JSON.parse(req.user) as { checklist: { criteria: { id: string; kind: string; allowedValues: unknown[] }[] } };
        const a = answer(calls.length, req);
        const results = p.checklist.criteria.map((c) => ({
          criterionId: c.id, value: c.kind === 'discrete-scale' ? [...(c.allowedValues as number[])].sort((x, y) => y - x)[1] : c.id === '08' ? false : true,
          isNA: false, explanation: 'ok', confidence: 'high', evidence: [{ messageIndex: 8, quote: 'Вижу заказ' }],
        }));
        return { output: { results: [...results, ...(a.extraResults ?? [])], assisted: a.assisted } };
      },
    };
    const db = openDb(':memory:');
    db.insert(conversations).values({ ...demo, importedAt: 'now' }).run();
    const app = buildApp({ db, provider });
    return { app, calls };
  }
  const good = { verificationRequired: true, reason: 'r', confidence: 'high', firstProtectedDisclosure: { messageIndex: 8, quote: 'Вижу заказ' } };
  const start = async (app: ReturnType<typeof run>['app']) => {
    const { jobId } = (await app.inject({ method: 'POST', url: '/api/evaluations', payload: { conversationIds: [demo.id], checklistVersionId: 'checklist-original-v1' } })).json();
    await app.runner.idle();
    const job = (await app.inject({ url: `/api/jobs/${jobId}` })).json();
    return (await app.inject({ url: `/api/evaluations/${job.evaluationIds[0]}` })).json();
  };

  it('the model gets only the narrow question for 03, and code produces a hybrid Yes from the system event', async () => {
    const { app, calls } = run(() => ({ assisted: [{ criterionId: '03', answers: good }] }));
    const ev = await start(app);
    const sent = JSON.parse(calls[0]!.user);
    expect(sent.checklist.criteria.map((c: { id: string }) => c.id)).not.toContain('03');
    expect(sent.assistedQuestions[0]).toMatchObject({ criterionId: '03' });
    expect(ev.originalResults.find((r: { criterionId: string }) => r.criterionId === '03')).toMatchObject({ source: 'hybrid', value: true });
    expect(ev.status).toBe('completed');
  });

  it('a model that tries to decide 03 itself or skips the answer is sent back once, then repaired', async () => {
    const { app, calls } = run((n) => (n === 1 ? { extraResults: [{ criterionId: '03', value: true, isNA: false, explanation: 'x', evidence: [{ messageIndex: 1 }] }] } : { assisted: [{ criterionId: '03', answers: good }] }));
    const ev = await start(app);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.user).previousAnswerProblems.join()).toMatch(/unknown criterion 03|expected exactly one answer for 03/);
    expect(ev.status).toBe('completed');
  });

  it('an ungrounded answer (invented quote) fails twice and is recorded as a failed evaluation', async () => {
    const bad = { ...good, firstProtectedDisclosure: { messageIndex: 8, quote: 'выдуманная цитата' } };
    const { app, calls } = run(() => ({ assisted: [{ criterionId: '03', answers: bad }] }));
    const ev = await start(app);
    expect(calls).toHaveLength(2);
    expect(ev).toMatchObject({ status: 'failed', originalResults: [] });
    expect(ev.error).toMatch(/assisted 03/);
  });

  it('reuse covers the hybrid result: re-weighting needs no new model call', async () => {
    const { app, calls } = run(() => ({ assisted: [{ criterionId: '03', answers: good }] }));
    const first = await start(app);
    const before = calls.length;
    const cl = (await app.inject({ url: '/api/checklists/checklist-original-v1' })).json();
    const { id: _i, version: _v, createdAt: _c, ...rest } = cl;
    const v2 = (await app.inject({ method: 'POST', url: '/api/checklists', payload: { ...rest, criteria: rest.criteria.map((c: { id: string }) => (c.id === '03' ? { ...c, weight: 0 } : c)) } })).json();
    const { jobId } = (await app.inject({ method: 'POST', url: '/api/evaluations', payload: { conversationIds: [demo.id], checklistVersionId: v2.id } })).json();
    await app.runner.idle();
    expect(calls).toHaveLength(before);
    const second = (await app.inject({ url: `/api/evaluations/${(await app.inject({ url: `/api/jobs/${jobId}` })).json().evaluationIds[0]}` })).json();
    expect(second.originalResults.find((r: { criterionId: string }) => r.criterionId === '03')).toMatchObject({ source: 'hybrid', reusedFrom: first.id });
    expect(second.originalTotal).not.toBe(first.originalTotal);
  });
});
