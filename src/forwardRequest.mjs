import { PassThrough } from 'node:stream';
import assert from 'node:assert';
import createError from 'http-errors';
import { filterHeaders,   hasHttpBodyContent } from '@quanxiaoxiao/http-utils';
import { waitConnect } from '@quanxiaoxiao/socket';
import request, { getSocketConnect } from '@quanxiaoxiao/http-request';

export default async (
  ctx,
  options,
) => {
  assert(Number.isInteger(options.port) && options.port > 0 && options.port <= 65535);
  const socket = getSocketConnect({
    hostname: options.hostname,
    port: options.port,
  });
  try {
     await waitConnect(
       socket,
       10 * 1000,
       ctx.signal,
     );
  } catch (error) {
    if (!ctx.signal.aborted) {
      console.error(error);
      throw createError(502);
    }
  }

  ctx.response = {
    statusCode: null,
    statusText: null,
    httpVersion: null,
    headersRaw: [],
    headers: {},
    body: new PassThrough(),
  };

  const requestForwardOptions = {
    method: options.method,
    path: options.pathname,
    headers: options.headers,
  };

  if (requestForwardOptions.method == null) {
    requestForwardOptions.method = ctx.request.method;
  }
  if (requestForwardOptions.path == null) {
    requestForwardOptions.path = ctx.request.pathname;
  }

  if (options.querystring) {
    requestForwardOptions.path = `${requestForwardOptions.path}?${options.querystring}`;
  } else if (ctx.request.querystring) {
    requestForwardOptions.path = `${requestForwardOptions.path}?${ctx.request.querystring}`;
  }

  if (requestForwardOptions.headers == null) {
    requestForwardOptions.headers = [
      ...filterHeaders(ctx.request.headersRaw, ['host', 'content-length', 'transform-encoding']),
      'Host',
      `${options.hostname}:${options.port}`,
    ];
  } else {
    requestForwardOptions.headers['Host'] = `${options.hostname}:${options.port}`;
  }

  if (Object.hasOwnProperty.call(options, 'body')) {
    requestForwardOptions.body = options.body;
  } else if (hasHttpBodyContent(ctx.request.headers)) {
    ctx.request.body = new PassThrough();
    requestForwardOptions.body = ctx.request.body;
  }

  ctx.response.promise = (fn) => {
    ctx.response._promise = fn;
  };

  request(
    {
      ...requestForwardOptions,
      signal: ctx.signal,
      onBody: ctx.response.body,
      onStartLine: (state) => {
        ctx.response.httpVersion = state.httpVersion;
        ctx.response.statusCode = state.statusCode;
        ctx.response.statusText = state.statusText;
      },
      onHeader: async (state) => {
        ctx.response.headersRaw = state.headersRaw;
        ctx.response.headers = state.headers;
        if (ctx.response._promise) {
          await ctx.response._promise();
        }
      },
    },
    () => socket,
  )
    .then(
      () => {},
      (error) => {
        if (!ctx.signal.aborted && ctx.error == null) {
          ctx.error = error;
          if (ctx.response._promise) {
            ctx.response._promise();
          }
        }
      },
    );
};
