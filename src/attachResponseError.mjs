/* eslint no-proto: 0 */
import assert from 'node:assert';
import { STATUS_CODES } from 'node:http';
import { getCurrentDateName } from '@quanxiaoxiao/http-utils';

export default (ctx) => {
  assert(ctx.error instanceof Error);
  ctx.response = {
    statusCode: ctx.error.statusCode,
    headers: {
      Date: getCurrentDateName(),
    },
    body: null,
  };
  if (ctx.response.statusCode == null) {
    const errorName = ctx.error.__proto__.constructor.name;
    if (errorName === 'SocketConnectError') {
      ctx.response.statusCode = 502;
    } else if (errorName === 'SocketConnectTimeoutError') {
      ctx.response.statusCode = 504;
    } else if (errorName === 'UrlParseError') {
      ctx.response.statusCode = 502;
    }
  }
  if (ctx.response.statusCode == null) {
    if (ctx.requestForward) {
      ctx.response.statusCode = 502;
    } else {
      ctx.response.statusCode = 500;
    }
  }
  if (ctx.response.statusCode >= 400
    && ctx.response.statusCode <= 499
    && ctx.error.message
  ) {
    ctx.response.body = ctx.error.message;
  }
  if (STATUS_CODES[ctx.response.statusCode]) {
    ctx.response.statusText = STATUS_CODES[ctx.response.statusCode];
    if (!ctx.response.body) {
      ctx.response.body = ctx.response.statusText;
    }
  }
};
