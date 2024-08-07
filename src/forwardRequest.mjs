import { PassThrough } from 'node:stream';
import assert from 'node:assert';
import createError from 'http-errors';
import Ajv from 'ajv';
import { hasHttpBodyContent } from '@quanxiaoxiao/http-utils';
import { waitConnect } from '@quanxiaoxiao/socket';
import request, { getSocketConnect } from '@quanxiaoxiao/http-request';
import generateRequestForwardOptions from './generateRequestForwardOptions.mjs';

const requestSchema = {
  type: 'object',
  properties: {
    method: {
      enum: ['GET', 'POST', 'PUT', 'DELETE'],
    },
    path: {
      type: 'string',
      pattern: '^\\/.*',
    },
    querystring: {
      type: 'string',
      nullable: true,
    },
    headers: {
      type: 'object',
    },
    headersRaw: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['method', 'path', 'headers', 'headersRaw'],
};

const requestAjv = new Ajv();
const requestValidate = requestAjv.compile(requestSchema);

export default async (
  ctx,
  options,
) => {
  if (!requestValidate(ctx.request)) {
    throw new Error(JSON.stringify(requestAjv.errors));
  }
  assert(ctx.signal && typeof ctx.signal.aborted === 'boolean' && !ctx.signal.aborted);
  assert(Number.isInteger(options.port) && options.port > 0 && options.port <= 65535);
  const state = {
    dateTimeConnect: null,
    complete: false,
  };
  const socket = getSocketConnect({
    hostname: options.hostname,
    port: options.port,
    protocol: options.protocol || 'http:',
  });
  try {
     await waitConnect(
       socket,
       10 * 1000,
       ctx.signal,
     );
    state.dateTimeConnect = Date.now();
  } catch (error) {
    if (!ctx.signal.aborted) {
      console.error(error);
      throw createError(502);
    }
  }

  const requestForwardOptions = generateRequestForwardOptions(options, ctx.request);

  if (Object.hasOwnProperty.call(options, 'body')) {
    requestForwardOptions.body = options.body;
  } else if (hasHttpBodyContent(ctx.request.headers) && !ctx.request.body) {
    ctx.request.body = new PassThrough();
    requestForwardOptions.body = ctx.request.body;
  }

  if (!ctx.response) {
    ctx.response = {
      statusCode: null,
      statusText: null,
      httpVersion: null,
      headersRaw: [],
      headers: {},
      body: new PassThrough(),
    };
  } else {
    ctx.response.statusCode = null;
    ctx.response.statusText = null;
    ctx.response.httpVersion = null;
    ctx.response.headers = {};
    ctx.response.headersRaw = [];
    if (!Object.hasOwnProperty.call(ctx.response, 'body')) {
      ctx.response.body = new PassThrough();
    }
  }

  ctx.response.promise = (fn) => {
    ctx.response._promise = fn;
  };

  request(
    {
      ...requestForwardOptions,
      signal: ctx.signal,
      onBody: ctx.response.body,
      onRequest: options.onRequest,
      onChunkIncoming: options.onChunkIncoming,
      onChunkOutgoing: options.onChunkOutgoing,
      onEnd: options.onEnd,
      onStartLine: async (state) => {
        ctx.response.httpVersion = state.httpVersion;
        ctx.response.statusCode = state.statusCode;
        ctx.response.statusText = state.statusText;
        if (options.onStartLine) {
          await options.onStartLine(ctx);
        }
      },
      onHeader: async (state) => {
        ctx.response.headersRaw = state.headersRaw;
        ctx.response.headers = state.headers;
        if (options.onHeader) {
          await options.onHeader(ctx);
          assert(!ctx.signal.aborted);
        }
        if (!state.complete) {
          state.complete = true;
          if (!ctx.signal.aborted && ctx.response._promise) {
            await ctx.response._promise();
          }
        }
      },
    },
    () => socket,
  )
    .then(
      () => {},
      (error) => {
        if (!state.complete) {
          state.complete = true;
          if (!ctx.signal.aborted) {
            if (ctx.error == null) {
              ctx.error = error;
            }
            if (ctx.response._promise) {
              ctx.response._promise();
            }
          }
        }
      },
    );
};
