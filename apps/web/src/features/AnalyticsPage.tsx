import { can, type Actor, type Appeal, type AuditEvent, type ChecklistVersion, type Comment, type Conversation, type Crosscheck, type Directory, type Evaluation, type SaveTimelineEventInput, type Tag, type Task, type TimelineEvent } from '@cqa/contracts';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/ApiContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/error-note';
import { Select } from '@/components/ui/field';
import { Segment } from '@/components/ui/segment';
import { agreement, criterionSignals, csatStats, errorStats, fcr, followUp, MIN_N, qaMetrics, rankOperators, rankTeams, trainingEffect, weeklyTrend, type FollowUpStage, type RankRow } from '@/lib/analytics';
import { formatScore } from '@/lib/present';
import { ERROR_ORIGIN_LABELS } from '@cqa/contracts';
import { ShareBar, TrendChart } from './analytics/Charts';

type Props = {
  identity: Actor;
  conversations: Conversation[];
  evaluations: Evaluation[];
  checklists: ChecklistVersion[];
  appeals: Appeal[];
  directory: Directory;
  tags: Tag[];
  tasks: Task[];
  comments: Comment[];
  timeline: TimelineEvent[];
  onAddTimeline: (input: SaveTimelineEventInput) => Promise<void>;
  onOpenDialog: (id: string) => void;
  /** Fictional data in the mock: said once, on the page. */
  demo: boolean;
};

type Tab = 'ranking' | 'trend' | 'errors' | 'qa' | 'critical' | 'clients';
const TABS: [Tab, string][] = [['ranking', 'Рейтинг'], ['trend', 'Динамика и обучение'], ['errors', 'Ошибки и правила'], ['critical', 'Критичные случаи'], ['qa', 'Работа QA'], ['clients', 'Клиенты']];
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const num = (x: number | null) => formatScore(x === null ? null : Math.round(x * 100) / 100);
const Empty = ({ children }: { children: string }) => <p className="rounded-card border border-line bg-surface p-4 text-sm text-muted">{children}</p>;
const Card = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card">
    <div><h2 className="text-base font-semibold leading-6">{title}</h2>{hint && <p className="max-w-prose text-xs text-muted">{hint}</p>}</div>
    {children}
  </div>
);

function RankTable({ rows, label }: { rows: RankRow[]; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] border-collapse text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-8 text-left"><th scope="col" className="w-10 pr-2 font-medium">№</th><th scope="col" className="pr-3 font-medium">{label}</th><th scope="col" className="whitespace-nowrap pr-3 text-right font-medium">Оценено</th><th scope="col" className="whitespace-nowrap pr-3 text-right font-medium">Средний итог</th><th scope="col" className="hidden pl-4 font-medium sm:table-cell" /><th scope="col" className="text-right font-medium">Нарушений</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="h-10">
              <td className="pr-2 tabular-nums text-muted">{r.rank ?? '—'}</td>
              <th scope="row" className="py-1 pr-3 text-left font-medium">{r.name}{r.teamName && <span className="ml-2 text-xs font-normal text-muted">{r.teamName}</span>}{!r.rankable && <Badge className="ml-2" title={`Меньше ${MIN_N} оценённых диалогов: в рейтинге не участвует`}>мало данных</Badge>}</th>
              <td className="whitespace-nowrap pr-3 text-right tabular-nums">{r.n} из {r.dialogs}</td>
              <td className="whitespace-nowrap pr-3 text-right tabular-nums">{num(r.average)}</td>
              <td className="hidden pl-4 sm:table-cell"><ShareBar value={r.average === null ? null : r.average / 100} /></td>
              <td className="text-right tabular-nums">{r.violations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STAGE: Record<FollowUpStage, { label: string; tone: 'danger' | 'warn' | 'neutral' | 'success' }> = {
  unreviewed: { label: 'Никто не проверил', tone: 'danger' },
  no_comment: { label: 'Нет комментария оператору', tone: 'warn' },
  unacknowledged: { label: 'Оператор не ознакомился', tone: 'warn' },
  done: { label: 'Разобрано', tone: 'success' },
};

/** Team analytics. Everything is computed in the browser from lists the API already scoped to the viewer (a manager gets only their team). */
export function AnalyticsPage(p: Props) {
  const api = useApi();
  const [tab, setTab] = useState<Tab>('ranking');
  const ctx = useMemo(() => ({ conversations: p.conversations, evaluations: p.evaluations, checklists: p.checklists, appeals: p.appeals, directory: p.directory }), [p.conversations, p.evaluations, p.checklists, p.appeals, p.directory]);
  const operators = p.directory.people.filter((x) => x.role === 'operator' && p.conversations.some((c) => c.operatorId === x.id));
  const [group, setGroup] = useState('all');
  const [events, setEvents] = useState<AuditEvent[] | null | 'denied'>(null);
  const [crosschecks, setCrosschecks] = useState<Crosscheck[]>([]);
  useEffect(() => {
    if (tab !== 'qa') return;
    let live = true;
    api.listEvents({ limit: 5000 }).then((e) => live && setEvents(e), () => live && setEvents('denied'));
    api.listCrosschecks().then((c) => live && setCrosschecks(c), () => undefined);
    return () => { live = false; };
  }, [tab, api]);

  const ids = useMemo(() => {
    if (group === 'all') return null;
    if (group.startsWith('team:')) return new Set(p.directory.people.filter((x) => x.teamId === group.slice(5)).map((x) => x.id));
    return new Set([group.slice(3)]);
  }, [group, p.directory.people]);
  const trend = useMemo(() => weeklyTrend(ctx, ids), [ctx, ids]);

  const signals = useMemo(() => criterionSignals(ctx), [ctx]);
  const errors = useMemo(() => errorStats(p.tags), [p.tags]);
  const follow = useMemo(() => followUp(p.conversations, p.evaluations, p.comments), [p.conversations, p.evaluations, p.comments]);
  const csat = useMemo(() => csatStats(p.conversations, p.evaluations, p.checklists), [p.conversations, p.evaluations, p.checklists]);
  const repeat = useMemo(() => fcr(p.conversations), [p.conversations]);
  const agree = useMemo(() => agreement(crosschecks, p.evaluations), [crosschecks, p.evaluations]);
  const qa = useMemo(() => (Array.isArray(events) ? qaMetrics(events, p.tasks, p.conversations, p.evaluations, p.directory) : null), [events, p.tasks, p.conversations, p.evaluations, p.directory]);
  const critTitle = (id: string) => signals.find((s) => s.criterionId === id)?.title ?? id;

  // Add-event form (top managers).
  const [form, setForm] = useState({ title: '', date: new Date().toISOString().slice(0, 10), kind: 'training' as TimelineEvent['kind'], participants: new Set<string>(), comparison: new Set<string>() });
  const [formError, setFormError] = useState<unknown>(null);
  const toggle = (k: 'participants' | 'comparison', id: string) => setForm((f) => { const s = new Set(f[k]); if (!s.delete(id)) s.add(id); return { ...f, [k]: s }; });

  return (
    <section aria-label="Аналитика" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 overflow-auto p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8">Аналитика</h1>
        <p className="max-w-prose text-sm text-muted">{p.identity.role === 'manager' ? 'Данные вашей группы.' : 'Данные всех групп.'} Каждая цифра показана вместе с числом диалогов; на малой выборке рейтингов и выводов нет.{p.demo && ' Демо: сотрудники, даты и оценки вымышлены, в наборе организаторов таких данных нет.'}</p>
      </div>
      <div role="tablist" aria-label="Разделы аналитики" className="flex max-w-full flex-wrap gap-1 self-start rounded-3xl bg-fill p-1">
        {TABS.map(([id, label]) => <Segment key={id} pressed={tab === id} onClick={() => setTab(id)}>{label}</Segment>)}
      </div>

      {tab === 'ranking' && (
        <>
          <Card title="Группы" hint={`В рейтинге участвуют группы и операторы минимум с ${MIN_N} оценёнными диалогами.`}>
            {p.directory.teams.length ? <RankTable rows={rankTeams(ctx)} label="Группа" /> : <Empty>Групп пока нет: их создаёт администратор в разделе «Команда».</Empty>}
          </Card>
          <Card title="Операторы">
            {operators.length ? <RankTable rows={rankOperators(ctx)} label="Оператор" /> : <Empty>Нет диалогов, назначенных операторам из справочника.</Empty>}
          </Card>
        </>
      )}

      {tab === 'trend' && (
        <>
          <Card title="Средний итог по неделям" hint="Неделя — по дате оценки диалога: в данных организаторов нет дат звонков. Пунктир — события шкалы (обучения, смена правил).">
            <label className="flex items-center gap-2 text-sm">Кто<Select aria-label="Кто" value={group} onChange={(e) => setGroup(e.target.value)} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="all">Все</option>{p.directory.teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}{operators.map((o) => <option key={o.id} value={`op:${o.id}`}>{o.name}</option>)}</Select></label>
            <TrendChart points={trend} events={p.timeline} />
            <table className="text-sm"><caption className="sr-only">Данные графика</caption><thead className="text-xs text-muted"><tr className="text-left"><th scope="col" className="pr-6 font-medium">Неделя с</th><th scope="col" className="pr-6 text-right font-medium">Диалогов</th><th scope="col" className="text-right font-medium">Средний итог</th></tr></thead><tbody>{trend.map((t) => <tr key={t.week}><td className="pr-6 tabular-nums">{t.week}</td><td className="pr-6 text-right tabular-nums">{t.n}</td><td className="text-right tabular-nums">{num(t.average)}</td></tr>)}</tbody></table>
          </Card>
          <Card title="Помогло ли обучение" hint="Сравниваем прошедших обучение со сравнительной группой, которую не обучали: изменение у первых минус изменение у вторых. Нужно минимум по 5 оценённых диалогов до и после в каждой группе.">
            {p.timeline.filter((e) => e.participantIds.length > 0).length === 0 && <Empty>Событий с участниками пока нет. Топ-менеджер добавляет обучение ниже.</Empty>}
            {p.timeline.filter((e) => e.participantIds.length > 0).map((e) => {
              const t = trainingEffect(e, ctx);
              return (
                <div key={e.id} className="rounded-xl border border-line p-3 text-sm">
                  <p className="font-medium">{e.title} <span className="font-normal text-muted tabular-nums">{e.date}</span></p>
                  <p className="text-xs text-muted">Прошли: {t.participants.before.n}→{t.participants.after.n} диалогов; сравнительная группа: {t.comparison.before.n}→{t.comparison.after.n}</p>
                  <p className="mt-1">{t.enough ? <>Эффект: <strong className="tabular-nums">{t.effect! > 0 ? '+' : ''}{num(t.effect)}</strong> балла <span className="text-muted">(прошли: {num(t.participants.before.average)} → {num(t.participants.after.average)}; сравнение: {num(t.comparison.before.average)} → {num(t.comparison.after.average)})</span></> : <span className="text-muted">Данных пока мало для вывода{t.participantChange !== null && e.comparisonIds.length === 0 ? `; без сравнительной группы изменение у обученных ${t.participantChange > 0 ? '+' : ''}${num(t.participantChange)}, но оно может быть сезонным` : ''}.</span>}</p>
                </div>
              );
            })}
          </Card>
          {can(p.identity, 'timeline') && (
            <Card title="Добавить событие на шкалу" hint="Обучение, смена правила или чек-листа. Версии чек-листа на шкалу попадают сами.">
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setFormError(null); p.onAddTimeline({ date: form.date, title: form.title.trim(), kind: form.kind, participantIds: [...form.participants], comparisonIds: [...form.comparison] }).then(() => setForm((f) => ({ ...f, title: '', participants: new Set(), comparison: new Set() })), setFormError); }}>
                <div className="flex flex-wrap gap-2">
                  <input aria-label="Название события" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Название" className="h-8 min-w-56 flex-1 rounded-full border border-transparent bg-fill px-3 text-sm" />
                  <input aria-label="Дата события" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="h-8 rounded-full border border-transparent bg-fill px-3 text-sm" />
                  <Select aria-label="Вид события" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as TimelineEvent['kind'] })} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="training">Обучение</option><option value="policy">Смена правил</option><option value="other">Другое</option></Select>
                </div>
                {form.kind === 'training' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(['participants', 'comparison'] as const).map((k) => (
                      <fieldset key={k}><legend className="text-xs font-medium">{k === 'participants' ? 'Прошли обучение' : 'Сравнительная группа (не обучали)'}</legend>
                        {p.directory.people.filter((x) => x.role === 'operator').map((o) => <label key={o.id} className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={form[k].has(o.id)} disabled={form[k === 'participants' ? 'comparison' : 'participants'].has(o.id)} onChange={() => toggle(k, o.id)} />{o.name}</label>)}
                      </fieldset>
                    ))}
                  </div>
                )}
                <Button type="submit" size="sm" variant="primary" disabled={!form.title.trim()}>Добавить на шкалу</Button>
                <ErrorNote error={formError} />
              </form>
            </Card>
          )}
        </>
      )}

      {tab === 'errors' && (
        <>
          <Card title="Какое правило оспаривают чаще всего" hint="Критерий, который проверяющие часто меняют, а апелляции по нему чаще удовлетворяют, скорее неясен, чем оператор слаб. Вывод делается от 10 результатов.">
            {signals.length === 0 ? <Empty>Нет оценок.</Empty> : (
              <table className="w-full text-sm"><caption className="sr-only">Спорные критерии</caption><thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-8 text-left"><th scope="col" className="font-medium">Критерий</th><th scope="col" className="text-right font-medium">Результатов</th><th scope="col" className="text-right font-medium">Изменено проверяющими</th><th scope="col" className="text-right font-medium">Апелляций / удовл.</th><th scope="col" className="text-right font-medium">Потеряно баллов</th><th scope="col" className="pl-4 font-medium" /></tr></thead><tbody className="divide-y divide-line">
                {signals.map((s) => <tr key={s.criterionId} className="h-10"><th scope="row" className="text-left font-normal"><span className="mr-2 tabular-nums text-muted">{s.criterionId}</span>{s.title}</th><td className="text-right tabular-nums">{s.n}</td><td className="text-right tabular-nums">{s.changed}</td><td className="text-right tabular-nums">{s.appeals} / {s.overturned}</td><td className="text-right tabular-nums">{pct(s.lostShare)}</td><td className="pl-4">{s.suspectUnclear && <Badge tone="warn">возможно, неясное правило</Badge>}</td></tr>)}
              </tbody></table>
            )}
          </Card>
          <Card title="Причины ошибок" hint="Проверяющие отмечают, где корень: оператор, процесс банка, неясное правило или инструмент. Отметки не меняют оценку.">
            {errors.total === 0 ? <Empty>Отметок пока нет: проверяющий ставит их на критерии в карточке диалога.</Empty> : (
              <>
                <ul className="grid gap-3 sm:grid-cols-4">{(Object.keys(errors.byOrigin) as (keyof typeof errors.byOrigin)[]).map((o) => <li key={o} className="rounded-xl border border-line p-3"><p className="text-xs text-muted">{ERROR_ORIGIN_LABELS[o]}</p><p className="text-2xl font-semibold tabular-nums">{errors.byOrigin[o]}</p><ShareBar value={errors.byOrigin[o] / errors.total} tone={o === 'operator' ? 'brand' : 'warn'} /></li>)}</ul>
                <p className="text-sm">Не по вине оператора: <strong className="tabular-nums">{pct(errors.notOperatorShare)}</strong> из {errors.total} отметок.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><h3 className="text-sm font-medium">Частые категории</h3><ul className="mt-1 space-y-1 text-sm">{errors.byLabel.slice(0, 6).map((l) => <li key={l.label} className="flex justify-between gap-4"><span>{l.label}</span><span className="tabular-nums">{l.count}</span></li>)}</ul></div>
                  <div><h3 className="text-sm font-medium">По критериям</h3><ul className="mt-1 space-y-1 text-sm">{errors.byCriterion.slice(0, 6).map((l) => <li key={l.criterionId} className="flex justify-between gap-4"><span>{l.criterionId} {critTitle(l.criterionId)}</span><span className="tabular-nums">{l.count}</span></li>)}</ul></div>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {tab === 'critical' && (
        <Card title="Грубые нарушения: разобраны ли" hint="Разобрано = диалог проверен, оператору написан комментарий и он с ним ознакомился.">
          {follow.length === 0 ? <Empty>Грубых нарушений в доступных вам диалогах нет.</Empty> : (
            <>
              <ul className="flex flex-wrap gap-2 text-sm">{(Object.keys(STAGE) as FollowUpStage[]).map((s) => <li key={s}><Badge tone={STAGE[s].tone}>{STAGE[s].label}: {follow.filter((f) => f.stage === s).length}</Badge></li>)}</ul>
              <table className="w-full text-sm"><caption className="sr-only">Грубые нарушения</caption><tbody className="divide-y divide-line">
                {follow.sort((a, b) => Object.keys(STAGE).indexOf(a.stage) - Object.keys(STAGE).indexOf(b.stage)).map((f) => { const c = p.conversations.find((x) => x.id === f.conversationId); return <tr key={f.conversationId} className="h-10"><td><button type="button" onClick={() => p.onOpenDialog(f.conversationId)} className="font-medium text-accent underline-offset-2 hover:underline">{f.conversationId}</button></td><td className="text-muted">{p.directory.people.find((x) => x.id === c?.operatorId)?.name ?? '—'}</td><td className="text-right"><Badge tone={STAGE[f.stage].tone}>{STAGE[f.stage].label}</Badge></td></tr>; })}
              </tbody></table>
            </>
          )}
        </Card>
      )}

      {tab === 'qa' && (
        <>
          <Card title="Работа QA" hint="Время проверки считается по журналу: от «взято в работу» до «проверено» одним человеком.">
            {events === 'denied' ? <Empty>Журнал действий доступен топ-менеджеру и администратору, поэтому время проверок не посчитать.</Empty> : qa === null ? <Empty>Загрузка…</Empty> : (
              <>
                <dl className="grid gap-3 sm:grid-cols-4">
                  {[['Очередь', `${qa.queueLength}`, 'оценённых диалогов без проверки'], ['Самый старый', qa.backlogAgeDays === null ? '—' : `${num(qa.backlogAgeDays)} дн.`, 'ждёт проверки'], ['Медиана проверки', qa.medianMinutes === null ? '—' : `${num(qa.medianMinutes)} мин`, 'от «в работе» до «проверено»'], ['За 7 дней', `${qa.reviewedLast7Days}`, `в среднем ${num(qa.perDay)} в день`]].map(([k, v, h]) => <div key={k} className="rounded-xl border border-line p-3"><dt className="text-xs text-muted">{k}</dt><dd className="text-2xl font-semibold tabular-nums">{v}</dd><p className="text-xs text-muted">{h}</p></div>)}
                </dl>
                <table className="w-full text-sm"><caption className="sr-only">Проверяющие</caption><thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-8 text-left"><th scope="col" className="font-medium">Проверяющий</th><th scope="col" className="text-right font-medium">Проверено</th><th scope="col" className="text-right font-medium">С замером</th><th scope="col" className="text-right font-medium">Медиана, мин</th><th scope="col" className="text-right font-medium">Открытых задач</th></tr></thead><tbody className="divide-y divide-line">{qa.rows.map((r) => <tr key={r.reviewerId} className="h-10"><th scope="row" className="text-left font-medium">{r.reviewer}</th><td className="text-right tabular-nums">{r.reviewed}</td><td className="text-right tabular-nums">{r.timed}</td><td className="text-right tabular-nums">{num(r.medianMinutes)}</td><td className="text-right tabular-nums">{r.openTasks}</td></tr>)}</tbody></table>
              </>
            )}
          </Card>
          <Card title="Согласованность проверок" hint="Контрольная проверка — повторная оценка вслепую. Совпадение: тот же ответ, что после первой проверки, и что исходный ответ ИИ. Проверка топ-менеджера — контроль самой QA-команды.">
            {agree.rows.length === 0 ? <Empty>{p.identity.role === 'manager' ? 'Контрольных проверок по вашей группе пока нет' : 'Контрольных проверок пока нет: топ-менеджер назначает их на странице «Задачи».'}</Empty> : (
              <>
                <table className="w-full text-sm"><caption className="sr-only">Согласованность</caption><thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-8 text-left"><th scope="col" className="font-medium">Кто проверял</th><th scope="col" className="text-right font-medium">Проверок</th><th scope="col" className="text-right font-medium">С первой проверкой</th><th scope="col" className="text-right font-medium">С ИИ</th></tr></thead><tbody className="divide-y divide-line">{agree.rows.map((r) => <tr key={r.reviewerId} className="h-10"><th scope="row" className="text-left font-medium">{r.reviewer}{r.role === 'lead' && <Badge className="ml-2">контроль QA</Badge>}</th><td className="text-right tabular-nums">{r.checks}</td><td className="text-right tabular-nums">{r.results >= MIN_N ? pct(r.agreeFirst / r.results) : <span className="text-muted" title={`Мало данных: ${r.results} из ${MIN_N} результатов`}>—</span>}</td><td className="text-right tabular-nums">{r.results >= MIN_N ? pct(r.agreeAi / r.results) : <span className="text-muted">—</span>}</td></tr>)}</tbody></table>
                {(() => {
                  const enough = agree.byCriterion.filter((c) => c.results >= MIN_N).slice(0, 3);
                  return <p className="text-xs text-muted">{enough.length ? `Меньше всего согласия: ${enough.map((c) => `${c.criterionId} ${critTitle(c.criterionId)} (${pct(c.agreeFirst / c.results)})`).join('; ')}.` : `Процент согласия показывается от ${MIN_N} результатов; пока проверок мало для вывода.`}</p>;
                })()}
              </>
            )}
          </Card>
        </>
      )}

      {tab === 'clients' && (
        <>
          <Card title="Повторные обращения (FCR)" hint="Доля диалогов, после которых тот же клиент не писал снова в течение 7 дней. Нужны идентификатор клиента и время диалога.">
            {repeat === null ? <Empty>В данных нет идентификатора клиента и времени диалога, поэтому повторные обращения не посчитать. Когда источник их передаст, цифры появятся здесь.</Empty> : <p className="text-sm">Решено с первого обращения: <strong className="text-2xl tabular-nums">{pct(repeat.rate)}</strong> <span className="text-muted">({repeat.contacts} диалогов, {repeat.clients} клиентов, повторных: {repeat.repeated})</span></p>}
          </Card>
          <Card title="Оценка клиента и наши критерии" hint="Совпадают ли критерии с тем, что чувствует клиент: связь оценки клиента с итогом и критерии, по которым довольные и недовольные клиенты различаются сильнее всего.">
            {csat === null ? <Empty>В данных нет оценок клиентов (например, «оцените работу оператора»). Когда они появятся, здесь будет видно, какие критерии действительно влияют на удовлетворённость.</Empty> : (
              <>
                <p className="text-sm">Оценок: <strong className="tabular-nums">{csat.n}</strong>, средняя {num(csat.average)}; связь с итоговым баллом (корреляция): <strong className="tabular-nums">{csat.correlation === null ? '—' : csat.correlation.toFixed(2).replace('.', ',')}</strong>{csat.n < 20 && <span className="text-muted"> — выборка маленькая</span>}</p>
                <table className="w-full text-sm"><caption className="sr-only">Критерии и оценка клиента</caption><thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-8 text-left"><th scope="col" className="font-medium">Критерий</th><th scope="col" className="text-right font-medium">Баллов при оценке 1–2</th><th scope="col" className="text-right font-medium">Баллов при оценке 4–5</th><th scope="col" className="text-right font-medium">Разрыв</th></tr></thead><tbody className="divide-y divide-line">{csat.criteria.map((c) => <tr key={c.criterionId} className="h-10"><th scope="row" className="text-left font-normal"><span className="mr-2 tabular-nums text-muted">{c.criterionId}</span>{c.title}</th><td className="text-right tabular-nums">{pct(c.low)}</td><td className="text-right tabular-nums">{pct(c.high)}</td><td className="text-right tabular-nums">{c.gap === null ? '—' : `${c.gap > 0 ? '+' : ''}${Math.round(c.gap * 100)} п.п.`}</td></tr>)}</tbody></table>
              </>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
