# DEV data notes (aggregates only; no transcript text)

Source: organizer DEV group, 65 records. Re-check these numbers when a new group is imported.

| | Chats | Voice calls |
|---|---|---|
| Count | 60 (RU 30, KZ 15, EN 15) | 5 (all RU, all with audio URL) |
| Messages | about 15 (operator about 3) | 45-115 (operator 13-51) |
| Timestamps | `MM:SS`, 1-second resolution | ISO with sub-second precision, 5-11 min per call |
| Text | typed | automatic speech recognition: garbled words, split sentences, 32-55% of turns have 1-3 words |

Facts the evaluator relies on (computed in `services/evaluation/facts.ts`):
- Every record has an operator-join system event and a first operator message. Voice calls start with an IVR phase (bot menu, key presses as short client messages); the first human operator speaks at index 12 or later.
- Hold and consultation: 1 call has a hold window containing 27 "operator" messages that are spoken to a colleague, not the client.
- Recording pauses: 4 of 5 calls have "recording paused/resumed" events; speech inside is missing, so absence claims there are unsafe.
- Anonymization placeholders (`[Имя скрыто]`, `[Данные идентификации скрыты]`, `[Персональные данные скрыты]`) appear in 4 records; they are not operator errors.
- Identity-verification system events exist in 4 of 65 records (one phrasing each in RU, KZ, EN, plus one more RU).
- Timestamps are monotonic; ties are rare. Operator-join to first operator message takes about 37-132 s in chats.

Detector coverage on this set (rules only, no model): criterion 01 decided 60/65 (Yes; the 5 undecided are real No/ambiguous cases or garbled voice), criterion 07 decided 6/65 under the strict reading (2 Yes, 4 N/A; 48 chats end with only a goodbye and go to the model). Re-run after changing the patterns.
