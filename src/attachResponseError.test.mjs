import test from 'node:test';
import assert from 'node:assert';
import { STATUS_CODES } from 'node:http';
import createError from 'http-errors';
import { errors } from '@quanxiaoxiao/about-net';
import attachResponseError from './attachResponseError.mjs';

test('attachResponseError', () => {
  assert.throws(() => {
    const ctx = {};
    attachResponseError(ctx);
  });
  const ctx = {};
  const error = new Error();
  ctx.error = error;
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 500);
  assert.equal(ctx.response.statusText, STATUS_CODES[500]);
  assert.equal(typeof ctx.response.headers.Date, 'string');

  ctx.error = createError(404, 'test not found');
  ctx.response.body = 'aaaaaaa';
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 404);
  assert.equal(ctx.response.statusText, STATUS_CODES[404]);
  assert.equal(ctx.response.body, 'test not found');

  ctx.error = new errors.SocketConnectError();
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 502);

  ctx.error = new errors.SocketConnectTimeoutError();
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 504);

  ctx.error = new errors.UrlParseError();
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 502);

  ctx.error = new Error();
  ctx.error.code = 'ECONNRESET';
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 500);

  ctx.error = new Error();
  ctx.error.code = 'ECONNRESET';
  ctx.requestForward = {};
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 502);

  ctx.error = createError(503);
  ctx.requestForward = {};
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 503);

  ctx.error = createError(405);
  ctx.requestForward = {};
  attachResponseError(ctx);
  assert.equal(ctx.response.statusCode, 405);
});
