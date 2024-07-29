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
  assert(ctx.response == null);
  const socket = getSocketConnect({
    hostname: options.hostname,
    port: options.port,
    protocol: options.protocol || 'http:',
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
    path: options.path,
    headers: options.headers,
  };

  if (requestForwardOptions.method == null) {
    requestForwardOptions.method = ctx.request.method;
  }
  if (requestForwardOptions.path == null) {
    requestForwardOptions.path = ctx.request.path;
  }

  if (!Object.hasOwnProperty.call(requestForwardOptions, 'headers')) {
    requestForwardOptions.headers = [
      ...filterHeaders(ctx.request.headersRaw, ['host']),
      'Host',
      `${options.hostname}:${options.port}`,
    ];
  } else if (!Object.hasOwnProperty.call('Host', requestForwardOptions.headers)
    && !Object.hasOwnProperty.call('host', requestForwardOptions.headers)) {
    requestForwardOptions.headers['Host'] = `${options.hostname}:${options.port}`;
  }

  if (Object.hasOwnProperty.call(options, 'body')) {
    requestForwardOptions.body = options.body;
  } else if (hasHttpBodyContent(ctx.request.headers) && !ctx.request.body) {
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
      onRequest: options.onRequest,
      onChunkIncoming: options.onChunkIncoming,
      onChunkOutgoing: options.onChunkOutgoing,
      onEnd: options.onEnd,
      onStartLine: async (state) => {
        ctx.response.httpVersion = state.httpVersion;
        ctx.response.statusCode = state.statusCode;
        ctx.response.statusText = state.statusText;
        if (options.onStartLine) {
          await options.onStartLine(ctx);
        }
      },
      onHeader: async (state) => {
        ctx.response.headersRaw = state.headersRaw;
        ctx.response.headers = state.headers;
        if (options.onHeader) {
          await options.onHeader(ctx);
          assert(!ctx.signal.aborted);
        }
        if (ctx.response._promise && !ctx.signal.aborted) {
          await ctx.response._promise();
        }
      },
    },
    () => socket,
  )
    .then(
      () => {},
      (error) => {
        if (!ctx.signal.aborted) {
          if (ctx.error == null) {
            ctx.error = error;
          }
          if (ctx.response._promise) {
            ctx.response._promise();
          }
        }
      },
    );
};
