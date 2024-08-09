import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { Readable, PassThrough } from 'node:stream';
import createError from 'http-errors';
import { waitConnect } from '@quanxiaoxiao/socket';
import request, { getSocketConnect } from '@quanxiaoxiao/http-request';
import generateRequestForwardOptions from '../generateRequestForwardOptions.mjs';

export default async (ctx) => {
  assert(!ctx.requestForward);
  ctx.requestForward = {
    timeOnConnect: null,
    timeOnResponseStartLine: null,
    timeOnResponseHeader: null,
    request: {
      ...generateRequestForwardOptions(ctx.forward, ctx.request),
      body: null,
    },
    response: {
      body: new PassThrough(),
      statusCode: null,
      statusText: null,
      httpVersion: null,
      headersRaw: [],
      headers: {},
    },
    socket: getSocketConnect({
      hostname: ctx.forward.hostname,
      port: ctx.forward.port,
      protocol: ctx.forward.protocol || 'http:',
    }),
  };

  ctx.requestForward.promise = (fn) => {
    ctx.requestForward._promise = fn;
  };

  try {
    await waitConnect(ctx.requestForward.socket, 1000 * 10, ctx.signal);
    ctx.requestForward.timeOnConnect = performance.now() - ctx.request.timeOnStart;
    if (ctx.forward.onConnect) {
      ctx.forward.onConnect();
    }
  } catch (error) {
    if (ctx.signal.aborted) {
      throw error;
    }
    console.warn(error);
    throw createError(502);
  }
  if (Object.hasOwnProperty.call(ctx.forward, 'body')) {
    ctx.requestForward.request.body = ctx.forward.body;
  } else if (ctx.request.body instanceof Readable
    && !ctx.request.body.readableEnded) {
    ctx.requestForward.request.body = ctx.request.body;
  } else if (Buffer.isBuffer(ctx.request.body)) {
    ctx.requestForward.request.body = ctx.request.body;
  }
  request(
    {
      signal: ctx.signal,
      method: ctx.requestForward.request.method,
      path: ctx.requestForward.request.path,
      headers: ctx.requestForward.request.headers,
      body: ctx.requestForward.request.body,
      onChunkOutgoing: (chunk) => {
        if (ctx.forward.onChunkOutgoing) {
          ctx.forward.onChunkOutgoing(chunk);
        }
      },
      onChunkIncoming: (chunk) => {
        if (ctx.forward.onChunkIncoming) {
          ctx.forward.onChunkIncoming(chunk);
        }
      },
      onStartLine: (ret) => {
        ctx.requestForward.response.httpVersion = ret.httpVersion;
        ctx.requestForward.response.statusCode = ret.statusCode;
        ctx.requestForward.response.statusText = ret.statusText;
        ctx.requestForward.timeOnResponseStartLine = ret.timeOnResponseStartLine;
      },
      onHeader: (ret) => {
        ctx.requestForward.response.headersRaw = ret.headersRaw;
        ctx.requestForward.response.headers = ret.headers;
        ctx.requestForward.timeOnResponseHeader = ret.timeOnResponseHeader;
        if (ctx.requestForward._promise) {
          ctx.requestForward._promise();
        }
      },
      onBody: ctx.requestForward.response.body,
    },
    () => ctx.requestForward.socket,
  )
    .then(
      () => {},
      (error) => {
        if (!ctx.signal.aborted) {
          if (ctx.error == null) {
            ctx.error = error;
          }
        }
      },
    );
};
