import { Readable } from 'node:stream';
import assert from 'node:assert';
import request, { NetConnectTimeoutError } from '@quanxiaoxiao/http-request';
import getSocketConnection from './getSocketConnection.mjs';

export default ({
  signal,
  options,
  ctx,
  onRequest,
}) => {
  if (ctx.response && ctx.response.body) {
    assert(ctx.response.body instanceof Readable);
  }
  const hasRequestBody = Object.hasOwnProperty.call(options, 'body');
  if (hasRequestBody) {
    assert(options.body === null
      || Buffer.isBuffer(options.body)
      || typeof options.body === 'string'
    );
  }
  if (!ctx.response) {
    ctx.response = {
      httpVersion: null,
      statusCode: null,
      statusText: null,
      headers: {},
      headersRaw: [],
      body: null,
    };
  }
  return request(
    {
      method: options.method,
      path: options.path,
      headers: options.headers,
      ...hasRequestBody ? { body: options.body } : {},
      signal,
      onBody: ctx.response && ctx.response.body ? ctx.response.body : null,
      onRequest: async (requestOptions, state) => {
        if (onRequest) {
          await onRequest(requestOptions, state);
        }
      },
      onStartLine: (state) => {
        ctx.response.httpVersion = state.httpVersion;
        ctx.response.statusCode = state.statusCode;
        ctx.response.statusText = state.statusText;
      },
      onHeader: (state) => {
        ctx.response.headers = state.headers;
        ctx.response.headersRaw = state.headersRaw;
      },
      onEnd: (state) => {
        if (!ctx.response.body) {
          ctx.response.body = state.body;
        }
      },
    },
    () => getSocketConnection({
      hostname: options.hostname,
      servername: options.servername,
      port: options.port,
      protocol: options.protocol || 'http:',
    }),
  )
    .then(
      () => {},
      (error) => {
        if (!signal || !signal.aborted) {
          if (error.state.timeOnConnect == null) {
            ctx.response.statusCode = 502;
          } else if (error instanceof NetConnectTimeoutError) {
            ctx.response.statusCode = 504;
          } else {
            ctx.response.statusCode = 500;
          }
        }
        ctx.error = error;
      },
    )
};
