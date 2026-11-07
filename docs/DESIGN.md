# Design rules (apps/web)

Read before changing UI. A test (`apps/web/test/grid.test.ts`) fails on off-grid spacing, off-scale radii (`rounded-md`) and off-rhythm control heights (`h-7`, `h-9`, `h-11`).

## Grid
- **4px unit, 8px rhythm.** Spacing and component sizes are multiples of 8 (4 for tight gaps, icons, type). Material's layout guide uses the same split: most measurements on 8dp, icons and type on 4dp.
- Spacing scale (Tailwind steps): 4 (`1`), 8 (`2`), 12 (`3`), 16 (`4`), 24 (`6`), 32 (`8`), 48 (`12`). No half steps (`gap-1.5`, `px-3.5`, `py-0.5`) and no arbitrary pixel values that are not multiples of 4.
- Control heights: 32 compact (`h-8`), 40 default (`h-10`), 48 primary or touch (`h-12`). Badges 24 (`h-6`).
- Radii: 4 bubble tails, 8 inputs, 12 rows, messages and form boxes, 16 cards, full for pills and chips.
- Layout widths: nav sidebar 72, queue rail 280, verdict panel 480, page gutter 16/24, gap between panes 16.
- Vertical space belongs to the two working columns (transcript, verdict). No full-width bars above them: navigation and global tools (theme, demo label) live in the slim left sidebar; the dialog title and queue controls sit inside the transcript card.

## Type (size / line-height, all multiples of 4)
| Role | Class | Use |
|---|---|---|
| Score | `text-score` 56/64, semibold | total score only |
| Page title | `text-2xl` 24/32, semibold | one per screen: dialog id, "Диалоги", "Чек-лист" |
| Section title | `text-base` 16/24, semibold | panel headings |
| Primary content | `text-base` 16/24 | message text, criterion titles, row titles |
| Secondary | `text-sm` 14/20 | labels, controls, explanations |
| Meta | `text-xs` 12/16, muted | timestamps, weights, hints |

## Hierarchy
1. The score and any serious violation come first (dark-green banner, largest type, red block for a violation).
2. Then the open criterion and its evidence (selected row, tags and ring on the cited messages).
3. Then the graded party: operator messages carry the weight (tinted row, green name); client is plain; bot and system recede.
4. Metadata (weights, time, source, confidence) is small and muted. Chips are for state only (answer, needs review, changed, appeal), never for static facts (language, channel are plain text).
5. One score unit on screen: a criterion shows points of its weight ("10,50 из 15", `grade()` in `lib/present.ts`); scale steps appear only in the answer options of a correction. Scores with a fraction always show two digits.

## Color
- Neutrals carry the UI; green is an accent: marks, focus, the open row, the primary action. `text-accent` is the green for text (#164734 light, #5FD28D dark). Bright green `#02B140` never carries white text.
- Red only for a violation or an error, amber only for "needs a human look" or a partial score. A grade a reviewer changed is neutral, not amber or green. Theme colors are CSS variables (`index.css`); components use the semantic names.

## One place per fact
- Show each fact once, where it is used. The violation reason is in the verdict banner (the rail and the list carry only a short flag); the queue is the rail beside the dialog, so arrows and a dropdown appear only when the rail does not fit (below 1536 px); the position in the queue is the highlighted row.
- The score banner states the score and what it is made of ("earned X of Y possible points", which criteria were not counted). Per-criterion detail lives in the rows: a points bar appears only where points were lost.
- Fictional data is announced once: the sidebar "Демо" label in mock mode; the verdict panel labels a mock evaluation only when the app is not in mock mode.
- No overview that repeats the list below it. Quiet by default: tags on messages are tints, solid only for the open criterion; export sits in the panel footer.- One transcript view: a chat (client left, operator right, system centered). No view toggle and no conversation map: evidence is reached through the numbered tags on messages and the chips in the verdict rows.

## Reading on every screen
- **Measure:** 50-75 characters per line (Baymard); WCAG 1.4.8 (AAA) asks for 80 or fewer on average. The chat column is capped at 44rem and bubbles at 80% of it, which gives about 54 `ch` (roughly 60 letters) at every width we measured (1280 to 3840 CSS px). Long paragraphs use `max-w-[65ch]` or `max-w-prose`.
- **Scale:** the root size is the user's own setting (100%) and grows from 1600 CSS px up to a 125% cap (a 27-inch QHD monitor at 100% is about 118%; a 4K screen at 100% hits the cap). Laptops with OS scaling already report a smaller CSS width and stay at 100%. Sizes are rem or ch, never fixed px for layout widths, so the UI follows both the browser font setting and zoom.
- **Reflow:** no horizontal scroll from 320 CSS px (WCAG 1.4.10); below 1280 the two panes become tabs, below 768 the sidebar becomes a top bar.
- **Text:** body 16/24, explanations 16/24, secondary 14/20, meta 12/16; `text-wrap: pretty` on paragraphs and `balance` on headings.
- **Calls:** evidence moves the audio player to the message (MM:SS timestamps only) without starting playback; each message has a play-from-here button.

## Reviewer actions
- A reviewer corrects a criterion directly ("Изменить оценку"); "Оспорить" files an appeal, the operator's dispute path, decided on the Апелляции page. Corrections are history of the dialog and never enter the appeal queue.
- Decision forms preselect nothing, list every answer with its points, mark the current one, and preview the new dialog total before saving. After a change the row shows the reviewer's reason and, below it, the AI's original answer with its evidence.
- A form with unsent text marks itself `data-draft="dirty"`; review shortcuts are ignored while one exists.

