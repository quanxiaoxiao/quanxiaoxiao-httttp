/* eslint no-proto: 0 */
import assert from 'node:assert';
import { STATUS_CODES } from 'node:http';

export default (ctx) => {
  assert(ctx.error instanceof Error);
  const response = {
    statusCode: ctx.error.statusCode,
    body: null,
  };
  if (response.statusCode == null) {
    response.statusCode = 500;
  }
  if (response.statusCode >= 400
    && response.statusCode <= 499
    && ctx.error.message
  ) {
    response.body = ctx.error.message;
  }
  assert(response.statusCode >= 0 && response.statusCode <= 999);
  if (STATUS_CODES[response.statusCode]) {
    response.statusText = STATUS_CODES[response.statusCode];
    if (!response.body) {
      response.body = response.statusText;
    }
  }
  ctx.error.response = response;
};
