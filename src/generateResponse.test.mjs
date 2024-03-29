import test from 'node:test';
import assert from 'node:assert';
import { STATUS_CODES } from 'node:http';
import generateResponse from './generateResponse.mjs';

test('generateResponse', () => {
  assert.throws(() => {
    const ctx = {};
    generateResponse(ctx);
  });
  const ctx = {
    response: {
      statusCode: 204,
      statusText: 'aaa',
      body: null,
    },
  };
  let response = generateResponse(ctx);
  assert(Array.isArray(response.headers));
  assert(response.headers.includes('Date'));
  assert.equal(response.statusCode, 204);
  assert.equal(response.statusText, STATUS_CODES[204]);
  assert.equal(response.body, null);

  ctx.response = {
    body: 'aaa',
  };
  response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'aaa');

  ctx.response = {
    body: 'aaa',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Encoding': 'gzip',
    },
    data: {
      name: 'bbb',
    },
  };
  response = generateResponse(ctx);
  assert.equal(response.body, JSON.stringify({ name: 'bbb' }));
  assert(response.headers.includes('application/json'));
  assert(!response.headers.includes('text/plain'));
  assert(!response.headers.includes('gzip'));

  ctx.response = {
    body: 'ccc',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Encoding': 'gzip',
    },
    _headers: {
      'Content-Type': 'text/html',
    },
  };
  response = generateResponse(ctx);
  assert(!response.headers.includes('text/plain'));
  assert(response.headers.includes('text/html'));
});
