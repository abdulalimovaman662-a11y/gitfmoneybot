'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME_CONFIG, scoreGuess, makeMemoryDeck } = require('./minigames');

test('all mini-games cost 15 silver and have the agreed daily limits', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(GAME_CONFIG).map(([key, value]) => [key, [value.price, value.dailyLimit]])),
    { reaction: [15, 5], safe: [15, 3], memory: [15, 5] }
  );
});

test('safe cracking counts exact and misplaced digits without double counting', () => {
  assert.deepEqual(scoreGuess('1122', '1212'), { exact: 2, misplaced: 2 });
  assert.deepEqual(scoreGuess('1234', '1234'), { exact: 4, misplaced: 0 });
  assert.deepEqual(scoreGuess('1234', '5678'), { exact: 0, misplaced: 0 });
});

test('memory deck always contains eight pairs and sixteen cards', () => {
  const deck = makeMemoryDeck();
  assert.equal(deck.length, 16);
  const counts = new Map();
  for (const value of deck) counts.set(value, (counts.get(value) || 0) + 1);
  assert.equal(counts.size, 8);
  for (const count of counts.values()) assert.equal(count, 2);
});
