import test from 'node:test';
import assert from 'node:assert';
import generateRouteMatchList from './generateRouteMatchList.mjs';

test('generateRouteMatchList', () => {
  assert.throws(() => {
    generateRouteMatchList([]);
  });
  assert.throws(() => {
    generateRouteMatchList(null);
  });
  assert.throws(() => {
    generateRouteMatchList(1);
  });
  assert.throws(() => {
    generateRouteMatchList('');
  });
  assert.equal(generateRouteMatchList({}).length, 0);
  assert.equal(generateRouteMatchList({
    '/': {},
  }).length, 1);
  assert.equal(generateRouteMatchList({
    '/quan': {},
    'rice/aaa': {},
  }).length, 1);
  assert.equal(generateRouteMatchList({
    '/': {
      match: {
        'query.name': 'quan',
      },
    },
  }).length, 1);
  assert.equal(generateRouteMatchList({
    '/quan': {
      match: {
        'query.name': {
          $eq: 'quan',
          $ne: 'rice',
        },
      },
    },
  }).length, 0);
  assert.equal(generateRouteMatchList({
    '/quan': {},
    '{/rice}/aaa': {},
  }).length, 2);
  assert.equal(generateRouteMatchList({
    '/quan': {},
    '{/rice/aaa': {},
  }).length, 1);
});
