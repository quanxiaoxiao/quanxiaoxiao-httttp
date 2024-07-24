import { PassThrough } from 'node:stream';
import createError from 'http-errors';
import { filterHeaders } from '@quanxiaoxiao/http-utils';
import { waitConnect } from '@quanxiaoxiao/socket';
import request, { getSocketConnect } from '@quanxiaoxiao/http-request';

export default async (
  ctx,
  {
    hostname,
    port,
    method,
    pathname,
    querystring,
    headers,
    body,
  },
) => {
  const socket = getSocketConnect({
    hostname,
    port,
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
    method,
    path: pathname,
    headers,
    body,
  };

  if (requestForwardOptions.method == null) {
    requestForwardOptions.method = ctx.request.method;
  }
  if (requestForwardOptions.path == null) {
    requestForwardOptions.path = ctx.request.pathname;
  }

  if (querystring) {
    requestForwardOptions.path = `${requestForwardOptions.path}?${querystring}`;
  } else if (ctx.request.querystring) {
    requestForwardOptions.path = `${requestForwardOptions.path}?${ctx.request.querystring}`;
  }

  if (requestForwardOptions.headers == null) {
    requestForwardOptions.headers = [
      ...filterHeaders(ctx.request.headersRaw, ['host', 'content-length', 'transform-encoding']),
      'Host',
      `${hostname}:${port}`,
    ];
  } else {
    requestForwardOptions.headers['Host'] = `${hostname}:${port}`;
  }

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
          ctx.response._promise();
        }
      },
    );
};
