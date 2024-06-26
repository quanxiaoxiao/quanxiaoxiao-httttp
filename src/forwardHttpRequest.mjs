import { Readable } from 'node:stream';
import assert from 'node:assert';
import _ from 'lodash';
import request, {
  NetConnectTimeoutError,
  getSocketConnect,
} from '@quanxiaoxiao/http-request';

export default ({
  signal,
  options,
  ctx,
  onRequest,
  onHttpResponseStartLine,
  onHttpResponseHeader,
  onHttpResponseEnd,
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

  const state = {
    complete: false,
  };

  ctx.response.httpVersion = null;
  ctx.response.statusCode = null;
  ctx.response.statusText = null;
  ctx.response.headers = {};
  ctx.response.headersRaw = [];

  ctx.requestForward = {
    bytesIncoming: 0,
    bytesOutgoing: 0,
    bytesRequestBody: 0,
    bytesResponseBody: 0,
    timeOnConnect: null,
    timeOnRequestSend: null,
    timeOnRequestEnd: null,
    timeOnResponse: null,
    timeOnResponseStartLine: null,
    timeOnResponseHeader: null,
    timeOnResponseBody: null,
    timeOnResponseEnd: null
  };

  return new Promise((resolve, reject) => {
    request(
      {
        method: options.method || 'GET',
        path: options.path || '/',
        headers: options.headers || {},
        ...hasRequestBody ? { body: options.body } : {},
        signal,
        onBody: ctx.response && ctx.response.body ? ctx.response.body : null,
        onRequest: async (requestOptions, result) => {
          ctx.requestForward.timeOnConnect = result.timeOnConnect;
          if (onRequest) {
            await onRequest(ctx);
          }
        },
        onStartLine: async (result) => {
          ctx.requestForward.timeOnRequestSend = result.timeOnRequestSend;
          ctx.requestForward.timeOnRequestEnd = result.timeOnRequestEnd;
          ctx.requestForward.timeOnResponse = result.timeOnResponse;
          ctx.requestForward.timeOnResponseStartLine = result.timeOnResponseStartLine;
          ctx.response.httpVersion = result.httpVersion;
          ctx.response.statusCode = result.statusCode;
          ctx.response.statusText = result.statusText;
          ctx.requestForward.bytesOutgoing = result.bytesOutgoing;
          ctx.requestForward.bytesIncoming = result.bytesIncoming;
          ctx.requestForward.bytesRequestBody = result.bytesRequestBody;
          if (onHttpResponseStartLine) {
            await onHttpResponseStartLine(ctx);
          }
        },
        onHeader: async (result) => {
          ctx.response.headers = result.headers;
          ctx.response.headersRaw = result.headersRaw;
          ctx.requestForward.timeOnResponseHeader = result.timeOnResponseHeader;
          ctx.requestForward.bytesIncoming = result.bytesIncoming;
          if (onHttpResponseHeader) {
            await onHttpResponseHeader(ctx);
          }
          if (ctx.response.body) {
            state.complete = true;
            resolve(result);
          }
        },
        onEnd: async (result) => {
          ctx.requestForward.timeOnResponseBody = result.timeOnResponseBody;
          ctx.requestForward.timeOnResponseEnd = result.timeOnResponseEnd;
          ctx.requestForward.bytesIncoming = result.bytesIncoming;
          ctx.requestForward.bytesResponseBody = result.bytesResponseBody;
          if (!ctx.response.body) {
            ctx.response.body = result.body;
          }
          if (onHttpResponseEnd) {
            await onHttpResponseEnd(ctx);
          }
        },
      },
      () => getSocketConnect({
        hostname: options.hostname,
        servername: options.servername,
        port: options.port,
        protocol: options.protocol || 'http:',
      }),
    )
      .then(
        (result) => {
          if (!state.complete) {
            state.complete = true;
            resolve(result);
          }
        },
        (error) => {
          if (!signal || !signal.aborted) {
            if (error.state.timeOnConnect == null) {
              error.statusCode = 502;
            } else if (error instanceof NetConnectTimeoutError) {
              error.statusCode = 504;
            } else {
              error.statusCode = 500;
            }
          }
          ctx.error = error;
          if (!state.complete) {
            state.complete = true;
            reject(error);
          }
        },
      );
  });
};
