import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { STATUS_CODES } from 'node:http';
import { Readable } from 'node:stream';

import {
  convertObjectToArray,
  encodeContentEncoding,
  filterHeaders,
  getHeaderValue,
  setHeaders,
} from '@quanxiaoxiao/http-utils';
import createError from 'http-errors';

const validateStatusCode = (statusCode) => {
  assert(Number.isInteger(statusCode) && statusCode >= 0 && statusCode <= 999, `Invalid response statusCode: ${statusCode}`);
};

const handleJsonData = (data, headers) => {
  if (data == null) {
    return {
      body: null,
      headers,
    };
  }

  const jsonBody = Buffer.from(JSON.stringify(data));
  const filteredHeaders = filterHeaders(headers, ['content-encoding', 'content-type']);

  return {
    body: jsonBody,
    headers: setHeaders(filteredHeaders, {
      'Content-Type': 'application/json; charset=utf-8',
    }),
  };
};

export default (ctx) => {
  assert(!ctx.error, 'Context has error state');
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
    const jsonResult = handleJsonData(ctx.response.data, response.headers);
    response.body = jsonResult.body;
    response.headers = jsonResult.headers;
  }

  validateStatusCode(response.statusCode);

  if (response.body != null) {
    if (typeof response.body === 'string') {
      response.body = Buffer.from(response.body);
    }

    assert(Buffer.isBuffer(response.body), 'Response body must be a Buffer');

    const acceptEncoding = ctx.request?.headers?.['accept-encoding'];

    if (acceptEncoding && !getHeaderValue(response.headers, 'content-encoding')) {
      const ret = encodeContentEncoding(
        response.body,
        Array.isArray(acceptEncoding) ? acceptEncoding.join(',') : acceptEncoding,
      );
      if (ret.name) {
        response.headers = setHeaders(
          response.headers,
          {
            'Content-Encoding': ret.name,
          },
        );
      }
      response.body = ret.buf;
    }
  }
  return response;
};
