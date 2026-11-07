import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { KitSchema } from './offline.js';
import { parseDataset } from '../../apps/api/src/services/import/dataset.js';

const { values: v } = parseArgs({ options: { data: { type: 'string' }, checklist: { type: 'string' }, out: { type: 'string' } } });
if (!v.data || !v.out) throw Error('Usage: tsx evaluation/src/make-offline.ts --data data/raw/dev.json --out evaluation/private/eldana/Разметка.html [--checklist FILE]');
const root = new URL('../../', import.meta.url);
const parsed = parseDataset(JSON.parse(readFileSync(resolve(v.data), 'utf8')), 'DEV');
if (parsed.failed.length) throw Error(`Dataset has ${parsed.failed.length} invalid records; refusing partial export`);
const checklist = JSON.parse(readFileSync(v.checklist ? resolve(v.checklist) : new URL('apps/api/src/checklists/original.json', root), 'utf8'));
const payload = { checklist, conversations: parsed.conversations };
const kit = KitSchema.parse({ ...payload, id: createHash('sha256').update(JSON.stringify(payload)).digest('hex') });
const bundled = await build({ stdin: { contents: `import {installOffline} from './evaluation/src/offline.ts'; installOffline(${JSON.stringify(kit)});`, resolveDir: new URL(root).pathname }, bundle: true, write: false, format: 'iife', platform: 'browser', minify: true });
let page = readFileSync(new URL('apps/api/static/label.html', root), 'utf8');
page = page.replace(/async function api\(path, opts\) \{[\s\S]*?\n\}/, 'async function api(path, opts) { return window.offlineApi(path, opts); }');
page = page.replace('<button id="btnReport" type="button">Сравнение с моделью</button>', '<button id="btnBackup" type="button">Скачать резервную копию</button><label>Восстановить копию <input id="restore" type="file" accept=".json"></label>');
page = page.replace("$('btnCsv').onclick = () => { location.href = '/api/labels.csv'; };", "$('btnCsv').onclick = () => window.offlineCsv(); $('btnBackup').onclick = () => window.offlineBackup(); $('restore').onchange = async e => { try { if(e.target.files[0]) await window.offlineRestore(e.target.files[0]); } catch(err) { alert(err.message); } };");
page = page.replace("$('btnReport').onclick = () => { $('dlgReport').showModal(); };", '');
page = page.replace('<label>Ваше имя:', '<label>Рецензент: <select id="profile" aria-label="Рецензент"></select></label><button id="newProfile" type="button">Новый рецензент</button><label>Имя:');
page = page.replace("$('reviewer').value = localStorage.getItem('reviewer') || '';", `$('reviewer').value = window.offlineProfile.name; $('reviewer').readOnly = true;
  for(const p of window.offlineProfiles) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; o.selected = p.id === window.offlineProfile.id; $('profile').append(o); }
  $('profile').onchange = async e => { await flushDrafts(); window.offlineSwitch(e.target.value); };
  $('newProfile').onclick = async () => { const name = prompt('Имя нового рецензента (отдельные ответы и история):'); if(name !== null) { await flushDrafts(); try { window.offlineNewProfile(name); } catch(e) { alert(e.message); } } };`);
page = page.replace('async function selectConv(id) {', 'async function selectConv(id) { await flushDrafts();');
page = page.replace('async function init() {', `async function flushDrafts() { for(const t of st.timers.values()) clearTimeout(t); st.timers.clear(); for(const c of st.checklist?.criteria || []) if(st.cur && st.drafts.has(st.cur.id + '|' + c.id)) await save(c.id); }
window.addEventListener('beforeunload', e => { if(st.drafts.size) { e.preventDefault(); e.returnValue = ''; } });
async function init() {`);
page = page.replace('() => window.offlineCsv()', 'async () => { await flushDrafts(); window.offlineCsv(); }');
page = page.replace('() => window.offlineBackup()', 'async () => { await flushDrafts(); window.offlineBackup(); }');
page = page.replace('<main>', '<p class="hint">Работает без интернета. Ответы сохраняются только в этом браузере на этом устройстве. После каждой сессии скачайте CSV и резервную копию и отправьте Денису приватно. Не используйте режим инкогнито. PDF организаторов — главный источник правил.</p><main>');
page = page.replace('.msg .who { display: none; }', '.msg .who { display: block; }');
page = page.replace("m.timestamp.length > 8 ? m.timestamp.slice(11, 19) : m.timestamp", 'm.timestamp');
page = page.replace('position: sticky; top: 0; z-index: 5;', 'position: static;');
page = page.replace('top: 62px; max-height: calc(100vh - 74px)', 'top: 12px; max-height: calc(100vh - 24px)');
page = page.replace('</style>', '.msg { grid-template-columns: 36px minmax(50px,auto) 75px minmax(0,1fr); } .msg .t { overflow-wrap:anywhere; } @media(max-width:1100px){ .msg { grid-template-columns:36px 1fr; } .msg .txt { grid-column:1/-1; } } @media(prefers-reduced-motion:reduce){ .msg.flash{animation:none} } </style>');
// Script payload is untrusted transcript text: no literal closing script tag may survive embedding.
const script = bundled.outputFiles[0]!.text.replace(/<\//g, '<\\/');
page = page.replace('<script>', () => '<script>try {' + script + '} catch(e) { document.body.replaceChildren(document.createTextNode("Не удалось открыть сохранения: " + e.message + ". Не очищайте данные браузера; обратитесь к Денису.")); throw e; }\n');
const out = resolve(v.out);
if (existsSync(out)) throw Error('Output already exists; refusing to overwrite a delivery file');
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, page, { mode: 0o600 });
console.log(`Created offline kit: ${parsed.conversations.length} conversations, checklist ${kit.checklist.id}. ${out}`);
