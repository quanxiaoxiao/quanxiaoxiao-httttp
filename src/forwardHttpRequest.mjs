import { Readable } from 'node:stream';
import assert from 'node:assert';
import request from '@quanxiaoxiao/http-request';
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
  return request(
    {
      method: options.method,
      path: options.path,
      headers: options.headers,
      signal,
      onBody: ctx.response && ctx.response.body ? ctx.response.body : null,
      onRequest: async (requestOptions, state) => {
        if (onRequest) {
          await onRequest(requestOptions, state);
        }
        if (!signal || !signal.aborted) {
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
};
