import assert from 'node:assert';
import {
  http,
  pipeSocketForward,
} from '@quanxiaoxiao/about-net';
import createError from 'http-errors';
import getSocketConnection from './getSocketConnection.mjs';
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
  assert(ctx.requestForward);

  const state = {
    isResponsed: false,
    isErrorEmit: false,
    decode: http.decodeHttpResponse(),
  };

  ctx.response = {
    dateTimeCreate: Date.now(),
    dateTimeConnect: null,
    dateTimeResponse: null,
    dateTimeBody: null,
    dateTimeHeader: null,
    dateTimeEnd: null,
    httpVersion: null,
    statusCode: null,
    statusText: null,
    headers: {},
    headersRaw: [],
  };

  ctx.requestForward = {
    method: 'GET',
    path: ctx.request.path,
    body: null,
    headers: http.convertHttpHeaders(ctx.request._headers || ctx.request.headersRaw || ctx.request.headers || []),
    hostname: ctx.request.hostname,
    protocol: 'http:',
    port: 80,
    dateTimeConnect: null,
    ...ctx.requestForward,
  };

  const doResponseError = () => {
    if (!state.isErrorEmit && ctx.socket.writable) {
      state.isErrorEmit = true;
      attachResponseError(ctx);
      if (onHttpError) {
        try {
          onHttpError(ctx);
        } catch (error) {
          console.error(error);
        }
      } else {
        console.error(ctx.error);
      }
      ctx.socket.end(http.encodeHttp(ctx.response));
    }
  };

  if (onForwardConnecting) {
    try {
      await onForwardConnecting(ctx);
    } catch (error) {
      ctx.error = error;
      doResponseError();
    }
  }

  if (ctx.socket.writable) {
    pipeSocketForward(
      ctx.socket,
      {
        getConnect: () => getSocketConnection({
          hostname: ctx.requestForward.hostname,
          port: ctx.requestForward.port,
          servername: ctx.requestForward.servername,
          protocol: ctx.requestForward.protocol,
        }),
        sourceBufList: [
          http.encodeHttp({
            path: ctx.requestForward.path,
            headers: ctx.requestForward.headers,
            method: 'GET',
            body: null,
          }),
        ],
        onConnect: () => {
          ctx.requestForward.dateTimeConnect = Date.now();
          ctx.response.dateTimeConnect = ctx.requestForward.dateTimeConnect;
          if (onForwardConnect) {
            onForwardConnect(ctx);
          }
        },
        onIncoming: (chunk) => {
          if (ctx.response.dateTimeResponse === null) {
            ctx.response.dateTimeResponse = Date.now();
          }
          if (!state.isResponsed) {
            state.decode(chunk)
              .then(
                (response) => {
                  if (response.complete) {
                    state.isResponsed = true;
                    ctx.response.dateTimeHeader = Date.now();
                    ctx.response.dateTimeBody = ctx.response.dateTimeHeader;
                    ctx.response.statusCode = response.statusCode;
                    ctx.response.statusText = response.statusText;
                    ctx.response.httpVersion = response.httpVersion;
                    ctx.response.headers = response.headers;
                    ctx.response.headersRaw = response.headersRaw;
                  }
                },
                (error) => {
                  ctx.error = error;
                  if (!state.isResponsed) {
                    doResponseError();
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
          ctx.response.dateTimeEnd = Date.now();
          if (state.isResponsed) {
            if (onHttpResponseEnd) {
              onHttpResponseEnd(ctx);
            }
          } else {
            ctx.error = createError(502);
            if (onHttpError) {
              attachResponseError(ctx);
              onHttpError(ctx);
            }
          }
        },
        onError: (error) => {
          ctx.error = error;
          if (!state.isResponsed && onHttpError) {
            attachResponseError(ctx);
            onHttpError(ctx);
          }
        },
      },
    );
  }
};
