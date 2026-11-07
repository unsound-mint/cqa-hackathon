# Design rules (apps/web)

Read before changing UI. A test (`apps/web/test/grid.test.ts`) fails on off-grid spacing, off-scale radii (`rounded-md`) and off-rhythm control heights (`h-7`, `h-9`, `h-11`).

## Grid
- **4px unit, 8px rhythm.** Spacing and component sizes are multiples of 8 (4 for tight gaps, icons, type). Material's layout guide uses the same split: most measurements on 8dp, icons and type on 4dp.
- Spacing scale (Tailwind steps): 4 (`1`), 8 (`2`), 12 (`3`), 16 (`4`), 24 (`6`), 32 (`8`), 48 (`12`). No half steps (`gap-1.5`, `px-3.5`, `py-0.5`) and no arbitrary pixel values that are not multiples of 4.
- Control heights: 32 compact (`h-8`), 40 default (`h-10`), 48 primary or touch (`h-12`). Badges 24 (`h-6`).
- Radii: 4 bubble tails, 8 inputs, 12 rows, messages and form boxes, 16 cards, full for pills and chips.
- Layout widths: nav sidebar 72, queue rail 280, verdict panel 480 up to 1600 CSS px and then 30vw up to 640 (so criterion titles stop wrapping on wide screens), page gutter 16/24, gap between panes 16. The queue rail and the verdict panel are resizable from xl (drag the faint grip in the 16 px gap, or focus it and use ←/→, Home/End, Enter to reset; double-click resets); widths are remembered per browser and the transcript never gets narrower than 28rem. The queue rail has the dialogs page's filters as three compact dropdowns (state with counts, language, channel; one shared filter (one shared filter; N jumps to the next dialog needing attention) and can be hidden (remembered per browser); the transcript header then carries previous/next and the dialog picker. The verdict panel and the 72 px nav rail are not hideable.
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
1. What a reviewer came for: is the dialog OK, so the banner is the large score and the violation status on one line, plus state chips only when there are any. Where points went is the list (colored rows with reasons), not repeated in the banner; how the total is made (earned of applicable, N/A) is the score's tooltip; the checklist version always sits in one slim bar under the banner (text, or a picker when the dialog was evaluated under several versions, with "Пересчитать по версии N" on the right when a newer one exists). The banner's color is the verdict: brand dark green without a serious violation, deep red with one (the reason sits in the banner, no nested box).
2. Then the open criterion and its evidence (selected row, tags and ring on the cited messages).
3. Then the graded party: operator messages carry the weight (tinted row, green name); client is plain; bot and system recede.
4. Metadata (weights, time, source, confidence) is small and muted. Chips are for state only (answer, needs review, changed, appeal), never for static facts (language, channel are plain text).
5. Collapsed criterion rows are one line (32 px): id, title, grade chip. Full marks are quiet text; a fill means points lost (amber) or nothing earned / a violation (red). A row that lost points, needs review, has an appeal or was changed shows the first two lines of its explanation without opening; full-marks rows stay one quiet line (the raised flag's reason is in the banner, not repeated). Rows get more air (40 px) from 50rem of viewport height. A row that lost points also draws the share earned as a 4 px bar under its grade chip (inside the row, no extra height); full marks, N/A, flags and changed grades get none.
6. One score unit on screen: a criterion shows points of its weight ("10,50 из 15", `grade()` in `lib/present.ts`); scale steps appear only in the answer options of a correction. Scores with a fraction always show two digits.

## Color
- Neutrals carry the UI; green is an accent: marks, focus, the open row, the primary action. `text-accent` is the green for text (#164734 light, #5FD28D dark). Bright green `#02B140` never carries white text.
- Red only for a violation or an error, amber only for "needs a human look" or a partial score. A grade a reviewer changed is neutral, not amber or green. Score shapes follow the same rule: the banner's ring around the total, a neutral 4 px bar per queue row (red with a violation, amber when a review is pending), the bar under a lost-points chip (`components/ui/meter.tsx`); they repeat a number shown beside them, so they are `aria-hidden`.
- Depth: canvas, raised cards (`shadow-card`, a faint top highlight on dark) and fills/bubbles above them are three distinct levels in both themes. Theme colors are CSS variables (`index.css`); components use the semantic names.

## One place per fact
- Show each fact once, where it is used. The violation reason is in the verdict banner (the rail and the list carry only a short flag); the queue is the rail beside the dialog, so arrows and a dropdown appear only when the rail does not fit (below 1536 px); the position in the queue is the highlighted row.
- The score banner states the score and what it is made of ("earned X of Y possible points", which criteria were not counted). Per-criterion detail lives in the rows.
- Fictional data is announced once: the sidebar "Демо" label in mock mode; the verdict panel labels a mock evaluation only when the app is not in mock mode.
- No overview that repeats the list below it. Quiet by default: tags on messages are tints, solid only for the open criterion; the "Требуют внимания" filter and export sit in the panel footer, on one line that never wraps.
- One transcript view: a chat (client left, operator right, system centered). No view toggle and no conversation map: evidence is reached through the numbered tags on messages and the chips in the verdict rows. Speakers carry a 24 px avatar next to the name.
- Chats get a time rail in the margin left of the column when the transcript is at least 52rem wide (container query): a hairline with a dot per message (operator green, others receding) that scrolls with the chat; the open criterion's cited messages get a larger dot in its tone. It is decoration, not navigation. Calls get none: the call bar already shows the same moments.
- Spotlight: with a criterion open, messages it does not cite step back to 80 % opacity (outside the checked range for an absence claim; full on hover or focus) and cited bubbles get the brand ring with a soft glow. Opening a criterion scrolls to its first cited message unless one is already in view.

## Motion
- Small and functional: the total counts up once per dialog (JS, so it checks reduced motion itself and hands assistive tech the final value only), score bars grow in, an opened criterion's details fade in (`.reveal`), the selected queue row eases its fill. `prefers-reduced-motion` turns all of it off.

## Reading on every screen
- **Measure:** 50-75 characters per line (Baymard); WCAG 1.4.8 (AAA) asks for 80 or fewer on average. The chat column is capped at 44rem and bubbles at 80% of it, which gives about 54 `ch` (roughly 60 letters) at every width we measured (1280 to 3840 CSS px). Long paragraphs use `max-w-[65ch]` or `max-w-prose`.
- **No scroll:** banner plus collapsed rows of an 8-10 criterion checklist without lost points fit without scrolling from about 1440x790 CSS px of viewport (dialogs with many lost points scroll a little there, because their reasons are shown) (a 1440x900 screen minus browser chrome); smaller laptops and longer checklists scroll the list only. Measure `scrollHeight - clientHeight` of the list, not screenshots.
- **Scale:** the root size is the user's own setting (100%) and grows from 1600 CSS px of width and 900 of height (whichever gives less) up to a 125% cap (a 27-inch QHD monitor at 100% is about 118%; a 4K screen at 100% hits the cap). Laptops with OS scaling already report a smaller CSS width and stay at 100%. Sizes are rem or ch, never fixed px for layout widths, so the UI follows both the browser font setting and zoom.
- **Reflow:** no horizontal scroll from 320 CSS px (WCAG 1.4.10); below 1280 the two panes become tabs, below 768 the sidebar becomes a top bar.
- **Text:** body 16/24, explanations 16/24, secondary 14/20, meta 12/16; `text-wrap: pretty` on paragraphs and `balance` on headings.
- **Calls:** the transcript header carries a call bar instead of the native player: play/pause, the recording as a waveform colored by who speaks (operator green, client ink, bot receding; decoded in the browser, speaker bands alone until then), dashed marks where recording was paused, and evidence markers above it (the open criterion's moments, or every lost-point moment when none is open). Everything links to the chat: a click on the bar puts the playhead exactly there (drag to scrub) and the chat follows to the message spoken there, a marker plays its fragment and shows its message, "В чате" shows what is playing; the message being spoken is outlined. Times everywhere are positions on the conversation clock ("01:05"; the original timestamp is in the tooltip). Every recorded message also has a ▶ that plays exactly its fragment; speech before the recording started or while paused has none (`lib/player.tsx` maps clock to recording). A recording that fails to load says so, offers Повторить and the organizer's page.

## Screens
- Dialogs list: one quiet toolbar. The review-state switch (segments with counts; a colored dot, not colored text, marks violations and review) carries the decision; search, language and channel are small. Rows carry a status chip only when there is something to do (not evaluated, failed, review count); an evaluated dialog has none.
- Checklist editor: from 1024 px a grouped list beside the selected criterion's form (what is judged: title, instructions, N/A; how it is scored: section, type, steps, weight, flag). Below 1024 the form opens inside the list. Delete lives in the form; up/down moves within a section.
- Statistics (`#/stats`): computed in the browser from the lists the app already loads (`lib/stats.ts`, no endpoint). Counts the current evaluation of each dialog; the criterion table follows one checklist version (picker when several were used) and works for any criterion, ranked by points, never by id. Bars repeat numbers written beside them and are `aria-hidden`. Filter: language only (dialogs carry no operator id).
- Targets: every control is at least 24 px in both directions (sort headers 32, row links 24); checkboxes are 16 px inside a label that is at least 32 px tall.

## Reviewer actions
- A reviewer corrects a criterion directly ("Изменить оценку"); "Оспорить" files an appeal, the operator's dispute path, decided on the Апелляции page. Corrections are history of the dialog and never enter the appeal queue.
- Decision forms preselect nothing, list every answer with its points, mark the current one, and preview the new dialog total before saving. After a change the row shows the reviewer's reason and, below it, the AI's original answer with its evidence.
- A form with unsent text marks itself `data-draft="dirty"`; review shortcuts are ignored while one exists.

