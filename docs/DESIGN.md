# Design rules (apps/web)

Read before changing UI. A test (`apps/web/test/grid.test.ts`) fails on off-grid spacing.

## Grid
- **4px unit, 8px rhythm.** Spacing and component sizes are multiples of 8 (4 for tight gaps, icons, type). Material's layout guide uses the same split: most measurements on 8dp, icons and type on 4dp.
- Spacing scale (Tailwind steps): 4 (`1`), 8 (`2`), 12 (`3`), 16 (`4`), 24 (`6`), 32 (`8`), 48 (`12`). No half steps (`gap-1.5`, `px-3.5`, `py-0.5`) and no arbitrary pixel values that are not multiples of 4.
- Control heights: 32 compact (`h-8`), 40 default (`h-10`), 48 primary or touch (`h-12`). Badges 24 (`h-6`).
- Radii: 8 inputs, 12 rows and messages, 16 cards, full for pills and chips.
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
4. Metadata (weights, time, source, confidence) is small and muted. Chips are for state only (answer, needs review, changed, appeal), never for static facts.

## Color
- Neutrals carry the UI; green is an accent: marks, focus, the open row, the primary action. `text-accent` is the green for text (#164734 light, #5FD28D dark). Bright green `#02B140` never carries white text.
- Red only for a violation or an error, amber only for "needs a human look" or a partial score. Theme colors are CSS variables (`index.css`); components use the semantic names.

## One place per fact
- Show each fact once, where it is used. The violation reason is in the verdict banner (the rail and the list carry only a short flag); the queue is the rail beside the dialog, so arrows and a dropdown appear only when the rail does not fit (below 1536 px); the position in the queue is the highlighted row.
- The score banner states the score and what it is made of ("earned X of Y possible points", which criteria were not counted). Per-criterion detail lives in the rows: a points bar appears only where points were lost.
- No overview that repeats the list below it. Quiet by default: tags on messages are tints, solid only for the open criterion; export sits in the panel footer.- One transcript view: a chat (client left, operator right, system centered). No view toggle and no conversation map: evidence is reached through the numbered tags on messages and the chips in the verdict rows.

