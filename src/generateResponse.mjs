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

const handleStreamBody = (response, stream) => {
  if (response.headers?.['content-length'] === 0) {
    if (!stream.destroyed) {
      stream.destroy();
    }
    return null;
  }

  // 确保流不可读且存在 data 属性
  assert(!stream.readable, 'Stream should not be readable');
  assert(
    Object.prototype.hasOwnProperty.call(response, 'data'),
    'Response data property is required for streams',
  );

  return stream;
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

const handleContentEncoding = (body, headers, acceptEncoding) => {
  if (getHeaderValue(headers, 'content-encoding')) {
    return { body, headers };
  }

  const encoding = Array.isArray(acceptEncoding)
    ? acceptEncoding.join(',')
    : acceptEncoding;

  const encoded = encodeContentEncoding(body, encoding);

  const updatedHeaders = encoded.name
    ? setHeaders(headers, { 'Content-Encoding': encoded.name })
    : headers;

  return {
    body: encoded.buf,
    headers: updatedHeaders,
  };
};

const normalizeHeaders = (ctx) => {
  let headers = ctx.response.headers || {};

  if (ctx.response._headers) {
    headers = ctx.response._headers;
  } else if (ctx.response.headersRaw) {
    headers = ctx.response.headersRaw;
  }

  return Array.isArray(headers) ? headers : convertObjectToArray(headers);
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
    headers: normalizeHeaders(ctx),
    body: ctx.response.body ?? null,
  };

  validateStatusCode(response.statusCode);

  if (STATUS_CODES[response.statusCode]) {
    response.statusText = STATUS_CODES[response.statusCode];
  }

  if (ctx.response.body instanceof Readable) {
    response.body = handleStreamBody(ctx.response, ctx.response.body);
  }

  if (Object.hasOwnProperty.call(ctx.response, 'data')) {
    const jsonResult = handleJsonData(ctx.response.data, response.headers);
    response.body = jsonResult.body;
    response.headers = jsonResult.headers;
  }

  if (response.body != null && !(response.body instanceof Readable)) {
    if (typeof response.body === 'string') {
      response.body = Buffer.from(response.body);
    }

    assert(Buffer.isBuffer(response.body), 'Response body must be a Buffer');

    const acceptEncoding = ctx.request?.headers?.['accept-encoding'];

    if (acceptEncoding) {
      const encodingResult = handleContentEncoding(
        response.body,
        response.headers,
        acceptEncoding,
      );
      response.body = encodingResult.body;
      response.headers = encodingResult.headers;
    }
  }
  return response;
};
