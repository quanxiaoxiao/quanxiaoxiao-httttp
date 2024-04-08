import { Buffer } from 'node:buffer';
import assert from 'node:assert';
import { PassThrough, Readable, Writable } from 'node:stream';
import _ from 'lodash';
import { wrapStreamRead } from '@quanxiaoxiao/node-utils';
import { encodeHttp } from '@quanxiaoxiao/http-utils';
import request from '@quanxiaoxiao/http-request';
import getSocketConnection from './getSocketConnection.mjs';

export default async ({
  ctx,
  signal,
  onForwardConnecting,
  onForwardConnect,
  onChunkIncoming,
}) => {
  assert(_.isPlainObject(ctx.requestForward));
  ctx.response = {
    bytesBody: 0,
    httpVersion: null,
    statusCode: null,
    statusText: null,
    headers: {},
    headersRaw: [],
    body: null,
  };

  ctx.requestForward = {
    method: ctx.request.method,
    path: ctx.request.path,
    body: ctx.request.body,
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

  const requestForwardOptions = {
    signal,
    method: ctx.requestForward.method,
    path: ctx.requestForward.path,
    headers: ctx.requestForward.headers,
    body: ctx.requestForward.body,
    onIncoming: (chunk) => {
      if (onChunkIncoming) {
        onChunkIncoming(ctx, chunk);
      }
    },
  };

  assert(Array.isArray(requestForwardOptions.headers) || _.isPlainObject(requestForwardOptions.headers));

  if (Object.hasOwnProperty.call(ctx.requestForward, 'onBody')) {
    requestForwardOptions.onBody = ctx.requestForward.onBody;
    if (requestForwardOptions.onBody) {
      assert(requestForwardOptions.onBody instanceof Readable);
      assert(requestForwardOptions.onBody instanceof Writable);
      assert(requestForwardOptions.onBody.readable);
      assert(requestForwardOptions.onBody.writable);
    }
  }

  requestForwardOptions.onRequest = async () => {
    if (onForwardConnect) {
      await onForwardConnect(ctx);
    }
  };

  requestForwardOptions.onHeader = (remoteResponse) => {
    ctx.response.httpVersion = remoteResponse.httpVersion;
    ctx.response.statusCode = remoteResponse.statusCode;
    ctx.response.statusText = remoteResponse.statusText;
    ctx.response.headersRaw = remoteResponse.headersRaw;
    ctx.response.headers = remoteResponse.headers;

    if (requestForwardOptions.onBody) {
      assert(requestForwardOptions.onBody.readable);
      assert(requestForwardOptions.onBody.writable);
      if (ctx.response.headers['content-length'] > 0
          || /^chunked$/i.test(ctx.response.headers['transfer-encoding'])) {
        const encodeHttpResponse = encodeHttp({
          ...ctx.response,
          body: new PassThrough(),
          onHeader: (chunk) => {
            ctx.socket.write(Buffer.concat([chunk, Buffer.from('\r\n')]));
          },
        });

        const handleDrainOnSocket = () => {
          if (requestForwardOptions.onBody.isPaused()) {
            requestForwardOptions.onBody.resume();
          }
        };

        ctx.socket.on('drain', handleDrainOnSocket);

        wrapStreamRead({
          stream: requestForwardOptions.onBody,
          signal,
          onData: (chunk) => ctx.socket.write(encodeHttpResponse(chunk)),
          onEnd: () => {
            ctx.socket.off('drain', handleDrainOnSocket);
            ctx.socket.write(encodeHttpResponse());
          },
          onError: () => {
            ctx.socket.off('drain', handleDrainOnSocket);
          },
        });
      } else if (ctx.socket.writable) {
        ctx.socket.write(encodeHttp(ctx.response));
      }
    }
  };

  const responseItem = await request(
    requestForwardOptions,
    () => getSocketConnection({
      hostname: ctx.requestForward.hostname,
      servername: ctx.requestForward.servername,
      port: ctx.requestForward.port,
      protocol: ctx.requestForward.protocol,
    }),
  );

  ctx.response.bytesBody = responseItem.bytesResponseBody;

  ctx.requestForward.timeOnConnect = responseItem.timeOnConnect;
  ctx.requestForward.timeOnRequestSend = responseItem.timeOnRequestSend;
  ctx.requestForward.timeOnResponse = responseItem.timeOnResponse;
  ctx.requestForward.timeOnRequestEnd = responseItem.timeOnRequestEnd;
  ctx.requestForward.timeOnResponseStartLine = responseItem.timeOnResponseStartLine;
  ctx.requestForward.timeOnResponseHeader = responseItem.timeOnResponseHeader;
  ctx.requestForward.timeOnResponseBody = responseItem.timeOnResponseBody;
  ctx.requestForward.timeOnResponseEnd = responseItem.timeOnResponseEnd;

  if (!requestForwardOptions.onBody) {
    ctx.response.body = responseItem.body;
  }
};
