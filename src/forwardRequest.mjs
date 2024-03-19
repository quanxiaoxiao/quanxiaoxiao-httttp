import { Buffer } from 'node:buffer';
import assert from 'node:assert';
import { PassThrough, Transform } from 'node:stream';
import _ from 'lodash';
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
  const state = {
    encode: null,
    transform: null,
  };
  ctx.response = {
    dateTimeCreate: Date.now(),
    dateTimeConnect: null,
    dateTimeResponse: null,
    dateTimeRequestSend: null,
    dateTimeBody: null,
    dateTimeEnd: null,
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
    dateTimeConnect: null,
    ...ctx.requestForward,
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
    assert(!signal.aborted);
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
  }

  requestForwardOptions.onRequest = async () => {
    assert(!signal.aborted);
    ctx.requestForward.dateTimeConnect = Date.now();
    ctx.response.dateTimeConnect = ctx.requestForward.dateTimeConnect;
    if (onForwardConnect) {
      await onForwardConnect(ctx);
      assert(!signal.aborted);
    }
  };

  requestForwardOptions.onHeader = async (remoteResponse) => {
    assert(!signal.aborted);
    ctx.response.httpVersion = remoteResponse.httpVersion;
    ctx.response.statusCode = remoteResponse.statusCode;
    ctx.response.statusText = remoteResponse.statusText;
    ctx.response.headersRaw = remoteResponse.headersRaw;
    ctx.response.headers = remoteResponse.headers;

    if (requestForwardOptions.onBody) {
      assert(requestForwardOptions.onBody.readable);
      if (ctx.response.headers['content-length'] > 0
          || /^chunked$/i.test(ctx.response.headers['transfer-encoding'])) {
        state.encode = encodeHttp({
          ...ctx.response,
          body: new PassThrough(),
          onHeader: (chunk) => {
            ctx.socket.write(Buffer.concat([chunk, Buffer.from('\r\n')]));
          },
        });

        state.transform = new Transform({
          transform(chunk, encoding, callback) {
            callback(null, state.encode(chunk));
          },
        });

        requestForwardOptions.onBody
          .pipe(state.transform)
          .pipe(ctx.socket);
      } else {
        requestForwardOptions.onBody.destroy();
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

  assert(!signal.aborted);

  ctx.response.dateTimeResponse = responseItem.dateTimeResponse;
  ctx.response.bytesBody = responseItem.bytesResponseBody;
  ctx.response.dateTimeBody = responseItem.dateTimeBody;
  ctx.response.dateTimeEnd = responseItem.dateTimeEnd;
  ctx.response.dateTimeRequestSend = responseItem.dateTimeRequestSend;

  if (!requestForwardOptions.onBody) {
    ctx.response.body = responseItem.body;
  } else if (!requestForwardOptions.onBody.destroyed) {
    await Promise.all([
      state.transform.writableNeedDrain ? new Promise((resolve) => {
        state.transform.once('drain', () => {
          setTimeout(() => {
            resolve();
          }, 5);
        });
      }) : Promise.resolve(),
      ctx.socket.writableNeedDrain ? new Promise((resolve) => {
        ctx.socket.once('drain', () => {
          setTimeout(() => {
            resolve();
          }, 5);
        });
      }) : Promise.resolve(),
    ]);
    assert(!signal.aborted);
    setTimeout(() => {
      state.transform.unpipe(ctx.socket);
      requestForwardOptions.onBody.destroy();
      ctx.socket.write(state.encode());
    });
  }
};
