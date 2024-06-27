/* eslint max-classes-per-file: 0 */
import test from 'node:test';
import assert from 'node:assert';
import { STATUS_CODES } from 'node:http';
import createError from 'http-errors';
import attachResponseError from './attachResponseError.mjs';

test('attachResponseError', () => {
  assert.throws(
    () => {
      const ctx = {};
      attachResponseError(ctx);
    },
    (error) => error instanceof assert.AssertionError,
  );
  assert.throws(
    () => {
      const ctx = {
        error: {},
      };
      attachResponseError(ctx);
    },
    (error) => error instanceof assert.AssertionError,
  );
  const ctx = {};
  const error = new Error();
  ctx.error = error;
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 500);
  assert.equal(ctx.response.statusText, STATUS_CODES[500]);

  ctx.error = createError(404, 'test not found');
  ctx.response.body = 'aaaaaaa';
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 404);
  assert.equal(ctx.response.statusText, STATUS_CODES[404]);
  assert.equal(ctx.response.body, 'test not found');

  ctx.error = new Error();
  ctx.error.code = 'ECONNRESET';
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 500);

  ctx.error = createError(503);
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 503);

  ctx.error = createError(405);
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 405);
});
