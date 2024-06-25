import assert from 'node:assert';
import _ from 'lodash';
import {
  decodeHttpResponse,
  encodeHttp,
} from '@quanxiaoxiao/http-utils';
import { pipeForward } from '@quanxiaoxiao/socket';
import { getSocketConnect } from '@quanxiaoxiao/http-request';
import attachResponseError from './attachResponseError.mjs';

export default async ({
  ctx,
  onForwardConnecting,
  onForwardConnect,
  onChunkIncoming,
  onChunkOutgoing,
  onHttpResponseEnd,
  onHttpError,
}) => {
  assert(_.isPlainObject(ctx.requestForward));

  const state = {
    isResponsed: false,
    timeStart: null,
    decode: null,
  };

  ctx.response = {
    httpVersion: null,
    statusCode: null,
    statusText: null,
    headers: {},
    headersRaw: [],
    body: null,
  };

  ctx.requestForward = {
    method: 'GET',
    path: ctx.request.path,
    body: null,
    hostname: ctx.request.hostname,
    protocol: 'http:',
    port: 80,
    ...ctx.requestForward,
    timeOnConnect: null,
    timeOnRequestSend: null,
    timeOnRequestEnd: null,
    timeOnResponse: null,
    timeOnResponseStartLine: null,
    timeOnResponseHeader: null,
    timeOnResponseBody: null,
    timeOnResponseEnd: null,
  };

  if (!ctx.requestForward.headers) {
    if (ctx.request._headers) {
      ctx.requestForward.headers = ctx.request._headers;
    } else if (ctx.request.headersRaw) {
      ctx.requestForward.headers = ctx.request.headersRaw;
    } else {
      ctx.requestForward.headers = ctx.request.headers || {};
    }
  }

  if (onForwardConnecting) {
    await onForwardConnecting(ctx);
  }

  assert(Array.isArray(ctx.requestForward.headers) || _.isPlainObject(ctx.requestForward.headers));

  state.timeStart = performance.now();

  const calcTime = () => performance.now() - state.timeStart;

  state.decode = decodeHttpResponse({
    onStartLine: (ret) => {
      ctx.requestForward.timeOnResponseStartLine = calcTime();
      ctx.response.statusCode = ret.statusCode;
      ctx.response.statusText = ret.statusText;
      ctx.response.httpVersion = ret.httpVersion;
    },
    onHeader: (ret) => {
      ctx.requestForward.timeOnResponseHeader = calcTime();
      ctx.response.headers = ret.headers;
      ctx.response.headersRaw = ret.headersRaw;
    },
  });

  const socketDest = getSocketConnect({
    hostname: ctx.requestForward.hostname,
    port: ctx.requestForward.port,
    servername: ctx.requestForward.servername,
    protocol: ctx.requestForward.protocol,
  });

  pipeForward(
    () => ctx.socket,
    () => socketDest,
    {
      onConnect: async (ret) => {
        ctx.requestForward.timeOnConnect = ret.timeConnect;
        if (onForwardConnect) {
          await onForwardConnect(ctx);
        }
        if (socketDest.writable) {
          socketDest.write(encodeHttp({
            path: ctx.requestForward.path,
            headers: ctx.requestForward.headers,
            method: 'GET',
            body: null,
          }));
          ctx.requestForward.timeOnRequestSend = calcTime();
          ctx.requestForward.timeOnRequestEnd = ctx.requestForward.timeOnRequestSend;
        }
      },
      onIncoming: (chunk) => {
        if (ctx.requestForward.timeOnResponse === null) {
          ctx.requestForward.timeOnResponse = calcTime();
        }
        if (!state.isResponsed) {
          state.decode(chunk)
            .then(
              (response) => {
                if (response.complete) {
                  state.isResponsed = true;
                  ctx.requestForward.timeOnResponseEnd = calcTime();
                  ctx.requestForward.timeOnResponseBody = ctx.requestForward.timeOnResponseEnd;
                }
              },
              (error) => {
                ctx.error = error;
                if (!state.isResponsed) {
                  attachResponseError(ctx);
                  if (onHttpError) {
                    onHttpError(ctx);
                  } else {
                    console.error(ctx.error);
                  }
                  if (ctx.socket.writable) {
                    ctx.socket.end(encodeHttp(ctx.response));
                  }
                }
              },
            );
        }
        if (onChunkIncoming) {
          onChunkIncoming(ctx, chunk);
        }
      },
      onOutgoing: (chunk) => {
        if (onChunkOutgoing) {
          onChunkOutgoing(ctx, chunk);
        }
      },
      onClose: () => {
        if (!state.isResponsed) {
          throw new Error('socket close error');
        }
        ctx.requestForward.timeOnResponseEnd = calcTime();
        if (onHttpResponseEnd) {
          onHttpResponseEnd(ctx);
        }
      },
      onError: (error) => {
        ctx.error = error;
        if (onHttpError) {
          onHttpError(ctx);
        } else {
          console.warn(error);
        }
      },
    },
  );
};
