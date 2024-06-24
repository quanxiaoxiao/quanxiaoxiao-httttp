import { Readable } from 'node:stream';
import assert from 'node:assert';
import _ from 'lodash';
import request, { NetConnectTimeoutError } from '@quanxiaoxiao/http-request';
import getSocketConnection from './getSocketConnection.mjs';

export default ({
  signal,
  options,
  ctx,
  onRequest,
  onStartLine,
  onHeader,
  onEnd,
}) => {
  const hasRequestBody = Object.hasOwnProperty.call(options, 'body');
  if (hasRequestBody) {
    assert(options.body === null
      || options.body instanceof Readable
      || Buffer.isBuffer(options.body)
      || typeof options.body === 'string'
    );
  }
  if (!ctx.response) {
    ctx.response = {
      body: null,
    };
  }
  assert(_.isPlainObject(ctx.response));
  if (ctx.response.body) {
    assert(ctx.response.body instanceof Readable);
  }
  ctx.response.httpVersion = null;
  ctx.response.statusCode = null;
  ctx.response.statusText = null;
  ctx.response.headers = {};
  ctx.response.headersRaw = [];
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
      onStartLine: async (state) => {
        ctx.response.httpVersion = state.httpVersion;
        ctx.response.statusCode = state.statusCode;
        ctx.response.statusText = state.statusText;
        if (onStartLine) {
          await onStartLine(ctx, state);
        }
      },
      onHeader: async (state) => {
        ctx.response.headers = state.headers;
        ctx.response.headersRaw = state.headersRaw;
        if (onHeader) {
          await onHeader(ctx, state);
        }
      },
      onEnd: async (state) => {
        if (!ctx.response.body) {
          ctx.response.body = state.body;
        } else {
          ctx.response.body.end();
        }
        if (onEnd) {
          await onEnd(ctx, state);
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
        ctx.error = error;
        if (!signal || !signal.aborted) {
          if (error.state.timeOnConnect == null) {
            ctx.response.statusCode = 502;
          } else if (error instanceof NetConnectTimeoutError) {
            ctx.response.statusCode = 504;
          } else {
            ctx.response.statusCode = 500;
          }
        }
      },
    )
};
