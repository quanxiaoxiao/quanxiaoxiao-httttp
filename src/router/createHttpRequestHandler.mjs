import assert from 'node:assert';
import {
  PassThrough,
  Readable,
  Writable,
} from 'node:stream';

import {
  decodeContentToJSON,
  getHeaderValue,
  hasHttpBodyContent,
  isHttpWebSocketUpgrade,
} from '@quanxiaoxiao/http-utils';
import createError from 'http-errors';
import _ from 'lodash';

import forwardWebsocket from '../forwardWebsocket.mjs';
import readStream from '../readStream.mjs';
import attachRequestForward from './attachRequestForward.mjs';

export default ({
  list: routeMatchList,
  onCors,
  onRequest,
  onResponse,
  logger,
}) => ({
  onHttpRequestStartLine: (ctx) => {
    const routeMatched = routeMatchList.find((routeItem) => routeItem.urlMatch(ctx.request.pathname));
    if (!routeMatched) {
      throw createError(404);
    }
    ctx.routeMatched = routeMatched;
  },
  onHttpRequestHeader: async (ctx) => {
    const requestHandler = ctx.routeMatched[ctx.request.method];
    if (!requestHandler) {
      if (ctx.request.method === 'OPTIONS' && onCors) {
        onCors(ctx);
        return;
      }
      throw createError(405);
    }
    ctx.requestHandler = requestHandler;
    if (onRequest) {
      await onRequest(ctx);
      assert(!ctx.signal.aborted);
      assert(!ctx.socket.destroyed);
      if (ctx.response) {
        ctx.routeMatched = null;
        ctx.requestHandler = null;
      }
    }
    if (!ctx.routeMatched) {
      return;
    }
    ctx.request.params = ctx.routeMatched.urlMatch(ctx.request.pathname).params;

    if (ctx.requestHandler && ctx.requestHandler.query) {
      ctx.request.query = ctx.requestHandler.query(ctx.request.query);
    } else if (ctx.routeMatched.query) {
      ctx.request.query = ctx.routeMatched.query(ctx.request.query);
    }

    if (ctx.requestHandler && ctx.requestHandler.match) {
      if (!ctx.requestHandler.match(ctx.request)) {
        throw createError(400);
      }
    } else if (ctx.routeMatched.match && !ctx.routeMatched.match(ctx.request)) {
      throw createError(400);
    }

    if (ctx.socket.writable && ctx.routeMatched.onPre) {
      await ctx.routeMatched.onPre(ctx);
      assert(!ctx.socket.destroyed);
      assert(!ctx.signal.aborted);
    }

    if (!isHttpWebSocketUpgrade(ctx.request) && ctx.forward) {
      if (hasHttpBodyContent(ctx.request.headers)) {
        ctx.request.body = new PassThrough();
      }
      await attachRequestForward(ctx);
    }
  },
  onWebSocket: async ({ ctx, ...hooks }) => {
    if (!ctx.requestHandler) {
      throw createError(404);
    }
    await ctx.requestHandler.fn(ctx);
    if (!ctx.forward) {
      throw createError(503);
    }
    assert(_.isPlainObject(ctx.forward));
    await forwardWebsocket({
      socket: ctx.socket,
      signal: ctx.signal,
      request: ctx.request,
      ...hooks,
      options: {
        ...ctx.forward,
        hostname: ctx.forward.hostname,
        port: ctx.forward.port,
        protocol: ctx.forward.protocol || 'http:',
      },
    });
  },
  onHttpRequestEnd: async (ctx) => {
    if (ctx.request.connection || !ctx.requestHandler) {
      return;
    }
    if (ctx.forward) {
      assert(ctx.requestForward);
      await ctx.requestHandler.fn(ctx);
      return;
    }

    if (ctx.request.end) {
      if (ctx.request.body instanceof Writable && !ctx.request.body.writableEnded) {
        ctx.request.end();

        if (ctx.request.body instanceof Readable) {
          const buf = await readStream(ctx.request.body, ctx.signal);
          ctx.request.body = buf;
        }
      }

      if (ctx.requestHandler.validate && Buffer.isBuffer(ctx.request.body)) {
        try {
          ctx.request.data = decodeContentToJSON(ctx.request.body, ctx.request.headers);
        } catch (error) {
          console.warn(error);
          throw createError(400);
        }
      }
    }
    if (ctx.requestHandler.validate && !ctx.requestHandler.validate(ctx.request.data)) {
      throw createError(400, JSON.stringify(ctx.requestHandler.validate.errors));
    }
    await ctx.requestHandler.fn(ctx);
    if (ctx.forward) {
      await attachRequestForward(ctx);
    }
  },
  onHttpResponse: async (ctx) => {
    if (ctx.request.method !== 'OPTIONS' && !ctx.response && ctx.requestForward) {
      if (ctx.requestForward.timeOnResponseHeader == null) {
        await new Promise((resolve) => {
          ctx.requestForward.promise(() => {
            resolve();
          });
        });
        assert(!ctx.signal.aborted);
        assert(!ctx.socket.destroyed);
        if (ctx.response == null) {
          ctx.response = {
            ...ctx.requestForward.response,
          };
        }
      } else {
        ctx.response = {
          ...ctx.requestForward.response,
        };
      }
    }
    if (!ctx.response) {
      console.warn(`${ctx.request.method} ${ctx.request.path} ctx.response unconfig`);
      throw createError(503);
    }
    if (ctx.request.method !== 'OPTIONS' && ctx.routeMatched && ctx.routeMatched.select) {
      if (!Object.hasOwnProperty.call(ctx.response, 'data')) {
        if (ctx.response.body instanceof Readable
          && ctx.response.body.readable
        ) {
          if (ctx.response.headers) {
            const contentLengthWithResponse = getHeaderValue(ctx.response.headers, 'content-length');
            const contentTypeWithResponse = getHeaderValue(ctx.response.headers, 'content-type');
            if (contentLengthWithResponse === 0) {
              ctx.response.body = null;
              ctx.response.data = null;
            } else if (contentTypeWithResponse && /application\/json/i.test(contentTypeWithResponse) && !ctx.signal.aborted) {
              const buf = await readStream(ctx.response.body, ctx.signal);
              if (!ctx.socket.destroyed) {
                ctx.response.body = buf;
                ctx.response.data = ctx.routeMatched.select(decodeContentToJSON(buf, ctx.response.headers));
              }
            }
          }
        }
      } else {
        ctx.response.data = ctx.routeMatched.select(ctx.response.data);
      }
    }
    if (onResponse) {
      await onResponse(ctx);
    }
  },
  onHttpResponseEnd: (ctx) => {
    if (ctx.request.method !== 'OPTIONS' && ctx.routeMatched && ctx.routeMatched.onPost) {
      ctx.routeMatched.onPost(ctx);
    }
  },
  onHttpError: (ctx) => {
    assert(ctx.error && ctx.error.response);
    let message = ctx.error.message;
    if (ctx.request.method) {
      message = `${ctx.request.method} ${ctx.request.path} ${ctx.error.response.statusCode} \`${ctx.error.message}\``;
    }
    if (ctx.error.code !== 'ABORT_ERR') {
      if (logger && logger.warn) {
        logger.warn(message);
      } else {
        console.warn(message);
      }
      if (ctx.error.response.statusCode >= 500 && ctx.error.response.statusCode <= 599) {
        console.error(ctx.error);
      }
    }
  },
  onSocketClose: (data, ctx) => {
    if (ctx
      && ctx.forward
      && ctx.forward.onClose
    ) {
      ctx.forward.onClose(ctx);
    }
  },
});
