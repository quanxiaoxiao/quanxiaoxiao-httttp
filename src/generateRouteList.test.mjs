import test from 'node:test';
import assert from 'node:assert';
import generateRouteList from './generateRouteList.mjs';

test('generateRouteList', () => {
  assert.throws(() => {
    generateRouteList([]);
  });
  assert.throws(() => {
    generateRouteList(null);
  });
  assert.throws(() => {
    generateRouteList(1);
  });
  assert.throws(() => {
    generateRouteList('');
  });
  assert.equal(generateRouteList({}).length, 0);
  assert.equal(generateRouteList({
    '/': {},
  }).length, 1);
  assert.equal(generateRouteList({
    '/quan': {},
    'rice/aaa': {},
  }).length, 1);
  assert.equal(generateRouteList({
    '/': {
      match: {
        'query.name': 'quan',
      },
    },
  }).length, 1);
  assert.equal(generateRouteList({
    '/quan': {
      match: {
        'query.name': {
          $eq: 'quan',
          $ne: 'rice',
        },
      },
    },
  }).length, 0);
});
