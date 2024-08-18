import { STATUS_CODES } from 'node:http';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import assert from 'node:assert';
import createError from 'http-errors';
import {
  convertObjectToArray,
  filterHeaders,
  encodeContentEncoding,
  setHeaders,
} from '@quanxiaoxiao/http-utils';

export default (ctx) => {
  assert(!ctx.error);
  if (!ctx.response) {
    ctx.error = new Error('`ctx.response` unset');
    ctx.error.statusCode = 503;
    throw createError(503);
  }
  const response = {
    statusCode: ctx.response.statusCode ?? 200,
    headers: ctx.response.headers || {},
    body: ctx.response.body ?? null,
  };
  if (ctx.response.body instanceof Readable) {
    if (ctx.response.headers && ctx.response.headers['content-length'] === 0) {
      if (!ctx.response.body.destroyed) {
        ctx.response.body.destroy();
      }
      response.body = null;
    } else {
      assert(!ctx.response.body.readable);
      assert(Object.hasOwnProperty.call(ctx.response, 'data'));
    }
  }
  if (STATUS_CODES[response.statusCode]) {
    response.statusText = STATUS_CODES[response.statusCode];
  }
  if (ctx.response._headers) {
    response.headers = ctx.response._headers;
  } else if (ctx.response.headersRaw) {
    response.headers = ctx.response.headersRaw;
  }

  if (!Array.isArray(response.headers)) {
    response.headers = convertObjectToArray(response.headers);
  }
  if (Object.hasOwnProperty.call(ctx.response, 'data')) {
    if (ctx.response.data == null) {
      response.body = null;
    } else {
      response.headers = filterHeaders(
        response.headers,
        ['content-encoding'],
      );
      if (ctx.request
        && ctx.request.headers
        && Object.hasOwnProperty.call(ctx.request.headers, 'accept-encoding')
      ) {
        const chunk = Buffer.from(JSON.stringify(ctx.response.data));
        const ret = encodeContentEncoding(chunk, ctx.request.headers['accept-encoding']);
        if (ret.name) {
          response.headers = setHeaders(
            response.headers,
            {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Encoding': ret.name,
            },
          );
        } else {
          response.headers = setHeaders(
            response.headers,
            {
              'Content-Type': 'application/json; charset=utf-8',
            },
          );
        }
        response.body = ret.buf;
      } else {
        response.headers = setHeaders(
          response.headers,
          {
            'Content-Type': 'application/json; charset=utf-8',
          },
        );
        response.body = JSON.stringify(ctx.response.data);
      }
    }
  }
  assert(response.statusCode >= 0 && response.statusCode <= 999);
  if (response.body != null) {
    assert(Buffer.isBuffer(response.body) || typeof response.body === 'string');
  }
  return response;
};
