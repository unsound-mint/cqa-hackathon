import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/csv.js';

describe('csv', () => {
  it('handles quotes, embedded commas/newlines and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","line1\nline2"\r\n"he said ""hi""",z\n')).toEqual([['a', 'b'], ['x, y', 'line1\nline2'], ['he said "hi"', 'z']]);
  });
  it('reads the semicolon files Excel writes in RU/KZ locales', () => {
    expect(parseCsv('a;b;c\n1;"x;y";3\n')).toEqual([['a', 'b', 'c'], ['1', 'x;y', '3']]);
  });
  it('skips blank lines and round-trips', () => {
    const rows = [['a', 'b'], ['x,1', 'q"r'], ['', 'z']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('a,b\n\n,\n')).toEqual([['a', 'b']]);
  });
});
