import { STATUS_CODES } from 'node:http';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import assert from 'node:assert';
import zlib from 'node:zlib';
import createError from 'http-errors';
import {
  convertObjectToArray,
  filterHeaders,
  setHeaders,
} from '@quanxiaoxiao/http-utils';

export default (ctx) => {
  if (!ctx.response) {
    throw createError(503, '`ctx.response` is empty');
  }
  const response = {
    statusCode: ctx.response.statusCode ?? 200,
    headers: ctx.response.headers || {},
    body: ctx.response.body ?? null,
  };
  assert(!(ctx.response.body instanceof Readable));
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
      if (ctx.request && ctx.request.headers && /\bgzip\b/i.test(ctx.request.headers['accept-encoding'])) {
        response.headers = setHeaders(
          response.headers,
          {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
          },
        );
        response.body = zlib.gzipSync(JSON.stringify(ctx.response.data));
      } else {
        response.headers = setHeaders(
          response.headers,
          {
            'Content-Type': 'application/json',
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
