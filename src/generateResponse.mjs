import { STATUS_CODES } from 'node:http';
import assert from 'node:assert';
import createError from 'http-errors';
import {
  getCurrentDateName,
  convertObjectToArray,
  filterHeaders,
  setHeaders,
} from '@quanxiaoxiao/http-utils';

export default (ctx) => {
  if (!ctx.response) {
    throw createError(503);
  }
  const response = {
    statusCode: ctx.response.statusCode || 200,
    headers: ctx.response.headers || {},
    body: ctx.response.body,
  };
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
  if (ctx.response.data) {
    response.headers = filterHeaders(
      response.headers,
      ['content-encoding'],
    );
    response.headers = setHeaders(
      response.headers,
      {
        'Content-Type': 'application/json',
      },
    );
    response.body = JSON.stringify(ctx.response.data);
  }
  response.headers = setHeaders(response.headers, {
    Date: getCurrentDateName(),
  });
  assert(response.statusCode >= 0 && response.statusCode <= 999);
  return response;
};
