import { STATUS_CODES } from 'node:http';
import createError from 'http-errors';
import { http } from '@quanxiaoxiao/about-net';
import { getCurrentDateName } from '@quanxiaoxiao/http-utils';

export default (ctx) => {
  if (!ctx.response) {
    throw createError(503);
  }
  const response = {
    statusCode: ctx.response.statusCode || 200,
    headers: http.convertHttpHeaders(ctx.response._headers || ctx.response.headersRaw || ctx.response.headers),
    body: ctx.response.body,
  };
  if (STATUS_CODES[response.statusCode]) {
    response.statusText = STATUS_CODES[response.statusCode];
  }
  if (ctx.response.data) {
    response.headers = http.filterHttpHeaders(
      response.headers,
      ['content-encoding'],
    );
    response.headers = http.setHeaders(
      response.headers,
      {
        'Content-Type': 'application/json',
      },
    );
    response.body = JSON.stringify(ctx.response.data);
  }
  response.headers = http.setHeaders(response.headers, {
    Date: getCurrentDateName(),
  });
  return response;
};
