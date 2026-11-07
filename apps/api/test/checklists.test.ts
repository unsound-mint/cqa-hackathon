import { readFileSync } from 'node:fs';
import { DemoBundleSchema } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { ORIGINAL_CHECKLIST } from '../src/services/checklists.js';

const app = () => buildApp({ db: openDb(':memory:') });
const post = (a: ReturnType<typeof app>, payload: object) => a.inject({ method: 'POST', url: '/api/checklists', payload });
const strip = ({ id: _i, version: _v, createdAt: _c, ...rest }: typeof ORIGINAL_CHECKLIST) => rest;

describe('checklists', () => {
  it('starts with the original checklist as version 1', async () => {
    const list = (await app().inject({ url: '/api/checklists' })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'checklist-original-v1', version: 1 });
    expect(list[0].criteria.map((c: { id: string }) => c.id)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
  });

  it('the fictional fixture checklist cannot drift from the canonical one', () => {
    const fixture = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8'))).checklists[0];
    expect(fixture).toEqual(ORIGINAL_CHECKLIST);
  });

  it('saving a changed or new criterion creates an immutable new version', async () => {
    const a = app();
    const changed = strip(ORIGINAL_CHECKLIST);
    changed.criteria = [
      ...changed.criteria.map((c) => (c.id === '06' ? { ...c, instructions: 'Новая формулировка', weight: 25 } : c)),
      { id: 'x1', title: 'Новый', instructions: 'любой текст', weight: 10, kind: 'discrete-scale', allowedValues: [0, 1, 2], allowNA: true, naCondition: 'если неприменимо' },
    ];
    const res = await post(a, changed);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'checklist-v2', version: 2 });
    const list = (await a.inject({ url: '/api/checklists' })).json();
    expect(list).toHaveLength(2);
    expect(list[0].criteria.find((c: { id: string }) => c.id === '06').weight).toBe(15); // v1 untouched
    expect(list[1].criteria.find((c: { id: string }) => c.id === 'x1').allowNA).toBe(true);
    expect((await a.inject({ url: '/api/checklists/checklist-v2' })).json().version).toBe(2);
    expect((await a.inject({ url: '/api/checklists/nope' })).statusCode).toBe(404);
  });

  it('versions increase monotonically', async () => {
    const a = app();
    for (let i = 2; i <= 4; i++) expect((await post(a, strip(ORIGINAL_CHECKLIST))).json().version).toBe(i);
  });

  it('rejects invalid configuration with field paths', async () => {
    const a = app();
    const bad = strip(ORIGINAL_CHECKLIST);
    bad.criteria = [{ ...bad.criteria[0]!, allowedValues: [true] }, { ...bad.criteria[0]!, id: 'dup' }, { ...bad.criteria[0]!, id: 'dup' }];
    const res = await post(a, bad);
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.length).toBeGreaterThan(0);
    expect((await a.inject({ url: '/api/checklists' })).json()).toHaveLength(1);
  });

  it('seeding is idempotent over an existing database', async () => {
    const db = openDb(':memory:');
    buildApp({ db });
    buildApp({ db });
    expect((await buildApp({ db }).inject({ url: '/api/checklists' })).json()).toHaveLength(1);
  });
});
