/* eslint no-proto: 0 */
import assert from 'node:assert';
import { STATUS_CODES } from 'node:http';

export default (ctx) => {
  assert(ctx.error instanceof Error);
  ctx.response = {
    statusCode: ctx.error.statusCode,
    body: null,
  };
  if (ctx.response.statusCode == null) {
    ctx.response.statusCode = 500;
  }
  if (ctx.response.statusCode >= 400
    && ctx.response.statusCode <= 499
    && ctx.error.message
  ) {
    ctx.response.body = ctx.error.message;
  }
  assert(ctx.response.statusCode >= 0 && ctx.response.statusCode <= 999);
  if (STATUS_CODES[ctx.response.statusCode]) {
    ctx.response.statusText = STATUS_CODES[ctx.response.statusCode];
    if (!ctx.response.body) {
      ctx.response.body = ctx.response.statusText;
    }
  }
};
