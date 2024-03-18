import { Buffer } from 'node:buffer';
import assert from 'node:assert';
import { PassThrough, Transform } from 'node:stream';
import _ from 'lodash';
import { encodeHttp, convertObjectToArray } from '@quanxiaoxiao/http-utils';
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

  if (!Array.isArray(ctx.requestForward.headers)) {
    assert(_.isPlainObject(ctx.requestForward.headers));
    ctx.requestForward.headers = convertObjectToArray(ctx.requestForward.headers);
  }

  if (onForwardConnecting) {
    await onForwardConnecting(ctx);
    assert(!signal.aborted);
  }

  assert(Array.isArray(ctx.requestForward.headers));

  const forwardOptions = {
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

  if (ctx.requestForward.onBody) {
    forwardOptions.onBody = ctx.requestForward.onBody;
  }

  forwardOptions.onRequest = async () => {
    assert(!signal.aborted);
    ctx.requestForward.dateTimeConnect = Date.now();
    ctx.response.dateTimeConnect = ctx.requestForward.dateTimeConnect;
    if (onForwardConnect) {
      await onForwardConnect(ctx);
      assert(!signal.aborted);
    }
  };

  forwardOptions.onHeader = async (remoteResponse) => {
    assert(!signal.aborted);
    ctx.response.httpVersion = remoteResponse.httpVersion;
    ctx.response.statusCode = remoteResponse.statusCode;
    ctx.response.statusText = remoteResponse.statusText;
    ctx.response.headersRaw = remoteResponse.headersRaw;
    ctx.response.headers = remoteResponse.headers;

    if (forwardOptions.onBody) {
      assert(forwardOptions.onBody.readable);
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

        forwardOptions.onBody
          .pipe(state.transform)
          .pipe(ctx.socket);
      } else {
        forwardOptions.onBody.destroy();
        ctx.socket.write(encodeHttp(ctx.response));
      }
    }
  };

  const responseItem = await request(
    forwardOptions,
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

  if (!forwardOptions.onBody) {
    ctx.response.body = responseItem.body;
  } else if (!forwardOptions.onBody.destroyed) {
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
      forwardOptions.onBody.destroy();
      ctx.socket.write(state.encode());
    });
  }
};
