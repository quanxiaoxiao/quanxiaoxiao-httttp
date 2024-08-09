import assert from 'node:assert';
import { PassThrough, Readable } from 'node:stream';
import _ from 'lodash';
import createError from 'http-errors';
import {
  hasHttpBodyContent,
  decodeContentToJSON,
} from '@quanxiaoxiao/http-utils';
import forwardWebsocket from '../forwardWebsocket.mjs';
import readStream from '../readStream.mjs';
import attachRequestForward from './attachRequestForward.mjs';

export default ({
  list: routeMatchList,
  onRequest,
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
      throw createError(405);
    }
    ctx.requestHandler = requestHandler;
    if (onRequest) {
      await onRequest(ctx);
      assert(!ctx.signal.aborted);
      if (ctx.response) {
        ctx.routeMatched = null;
        ctx.requestHandler = null;
      }
    }
    if (ctx.routeMatched) {
      ctx.request.params = ctx.routeMatched.urlMatch(ctx.request.pathname).params;
      if (ctx.routeMatched.query) {
        ctx.request.query = ctx.routeMatched.query(ctx.request.query);
      }
      if (ctx.routeMatched.match && !ctx.routeMatched.match(ctx.request)) {
        throw createError(400);
      }
      if (ctx.socket.writable && ctx.routeMatched.onPre) {
        await ctx.routeMatched.onPre(ctx);
        assert(!ctx.signal.aborted);
      }
      if (ctx.forward) {
        if (hasHttpBodyContent(ctx.request.headers)) {
          ctx.request.body = new PassThrough();
        }
        await attachRequestForward(ctx);
      }
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
    if (ctx.requestHandler && !ctx.request.connection) {
      if (!ctx.forward) {
        if (ctx.request.end) {
          if (!ctx.request.body.writableEnded) {
            ctx.request.end();
            const buf = await readStream(ctx.request.body, ctx.signal);
            ctx.request.body = buf;
          }
          if (ctx.requestHandler.validate && Buffer.isBuffer(ctx.request.body)) {
            ctx.request.data = decodeContentToJSON(ctx.request.body, ctx.request.headers);
          }
        }
        if (ctx.requestHandler.validate && !ctx.requestHandler.validate(ctx.request.data)) {
          throw createError(400, JSON.stringify(ctx.requestHandler.validate.errors));
        }
        await ctx.requestHandler.fn(ctx);
        if (ctx.forward) {
          await attachRequestForward(ctx);
        }
      } else {
        await ctx.requestHandler.fn(ctx);
      }
    }
  },
  onHttpResponse: async (ctx) => {
    if (!ctx.response && ctx.requestForward) {
      if (ctx.requestForward.timeOnResponseHeader == null) {
        await new Promise((resolve) => {
          ctx.requestForward.promise(() => {
            resolve();
          });
        });
        assert(!ctx.signal.aborted);
      }
      ctx.response = {
        ...ctx.requestForward.response,
      };
    }
    if (!ctx.response) {
      console.warn(`${ctx.request.method} ${ctx.request.path} ctx.response unconfig`);
      throw createError(503);
    }
    if (ctx.routeMatched && ctx.routeMatched.select) {
      if (!Object.hasOwnProperty.call(ctx.response, 'data')) {
        if (ctx.response.body instanceof Readable
          && ctx.response.body.readable
        ) {
          if (ctx.response.headers && ctx.response.headers['content-length'] === 0) {
            ctx.response.data = null;
          } else {
            const buf = await readStream(ctx.response.body, ctx.signal);
            ctx.response.data = decodeContentToJSON(buf, ctx.response.headers);
          }
        }
      }
      ctx.response.data = ctx.routeMatched.select(ctx.response.data);
    }
  },
  onHttpResponseEnd: (ctx) => {
    if (ctx.routeMatched && ctx.routeMatched.onPost) {
      ctx.routeMatched.onPost(ctx);
    }
  },
  onHttpError: (ctx) => {
    assert(ctx.error && ctx.error.response);
    let message = ctx.error.message;
    if (ctx.request.method) {
      message = `${ctx.request.method} ${ctx.request.path} ${ctx.error.response.statusCode} \`${ctx.error.message}\``;
    }
    if (logger && logger.warn) {
      logger.warn(message);
    } else {
      console.warn(message);
    }
    if (ctx.error.response.statusCode >= 500 && ctx.error.response.statusCode <= 599) {
      console.error(ctx.error);
    }
  },
});
