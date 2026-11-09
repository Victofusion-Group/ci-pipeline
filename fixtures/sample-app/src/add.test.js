import { expect, test } from 'vitest';
import { add } from './add.js';

test('adds two numbers', () => {
  expect(add(2, 3)).toBe(5);
});
