import { describe, expect, it } from 'vitest';
import { displayTime, sinceStart } from '../src/lib/present';
import { fragmentLabel, recordingPosition, segmentOf } from '../src/lib/player';

/** Fictional call in the shape of the real exports: absolute ISO times with sub-second precision. */
const call = {
  id: 'c', datasetGroupId: 'g', language: 'RU' as const, channel: 'voice call' as const, audioUrl: 'https://example.invalid/a.mp3',
  transcript: [
    { index: 0, timestamp: '2026-11-03T13:10:00.6388245+00:00', speaker: 'system' as const, text: 'start' },
    { index: 1, timestamp: '2026-11-03T13:10:15.5558925+00:00', speaker: 'bot' as const, text: 'b' },
    { index: 2, timestamp: '2026-11-03T13:10:17.2970588+00:00', speaker: 'client' as const, text: 'c' },
    { index: 3, timestamp: '2026-11-03T13:10:17.9000000+00:00', speaker: 'operator' as const, text: 'o' },
    { index: 4, timestamp: '2026-11-03T13:11:02.0000000+00:00', speaker: 'operator' as const, text: 'o2' },
  ],
};

describe('recording positions', () => {
  it('measures ISO times from the first message and shows them as a position, not the raw string', () => {
    expect(sinceStart(call, 2)).toEqual({ sec: expect.closeTo(16.66, 2), derived: true });
    expect(displayTime(call, 4)).toBe('01:01');
  });

  it('a fragment runs from a lead-in before the message to just after the next message at least a second later', () => {
    const seg = segmentOf(call, 2)!;
    expect(seg.from).toBeCloseTo(14.66, 2); // 2 s lead-in for clock-derived positions
    expect(seg.to).toBeCloseTo(61.86, 2); // #3 is only 0.6 s later, so the fragment runs to #4 (+0.5 s)
    expect(fragmentLabel(call, seg)).toBe('00:16–01:01');
    expect(segmentOf(call, 0)).toBeNull(); // system events carry no speech
    expect(fragmentLabel(call, segmentOf(call, 4)!)).toBe('с 01:01'); // last message plays to the end
  });

  it('follows the recording, not the clock: it starts at the start event and skips paused stretches', () => {
    const at = (sec: number) => new Date(Date.UTC(2026, 10, 3, 13, 0, 0) + sec * 1000).toISOString();
    const c = {
      ...call,
      transcript: [
        { index: 0, timestamp: at(0), speaker: 'system' as const, text: 'Агент присоединился к разговору с клиентом.' },
        { index: 1, timestamp: at(23), speaker: 'client' as const, text: 'before the recording' },
        { index: 2, timestamp: at(30), speaker: 'system' as const, text: 'Запись и транскрибирование запущены.' },
        { index: 3, timestamp: at(40), speaker: 'operator' as const, text: 'recorded' },
        { index: 4, timestamp: at(56), speaker: 'system' as const, text: 'Запись и транскрибирование приостановлены.' },
        { index: 5, timestamp: at(60), speaker: 'client' as const, text: 'during the pause' },
        { index: 6, timestamp: at(71), speaker: 'system' as const, text: 'Запись и транскрибирование возобновлены.' },
        { index: 7, timestamp: at(80), speaker: 'operator' as const, text: 'after the pause' },
      ],
    };
    expect(recordingPosition(c, 3)).toBe(10); // 40 s on the clock, recording started at 30
    expect(recordingPosition(c, 7)).toBe(35); // 80 - 30 - 15 s paused
    expect(segmentOf(c, 1)).toBeNull(); // spoken before the recording started
    expect(segmentOf(c, 5)).toBeNull(); // spoken while it was paused
    const seg = segmentOf(c, 3)!;
    expect(seg.from).toBe(8); // 2 s lead-in
    expect(seg.to).toBeCloseTo(26.5, 1); // the next event (pause at 56 s) ends it where the recording paused (+0.5)
    expect(fragmentLabel(c, seg)).toBe('00:40–00:56'); // ends at the pause event; labels stay on the clock the transcript shows
  });
});
