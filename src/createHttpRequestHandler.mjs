import assert from 'node:assert';
import { Readable, PassThrough } from 'node:stream';
import { decodeContentToJSON } from '@quanxiaoxiao/http-utils';
import { wrapStreamRead } from '@quanxiaoxiao/node-utils';
import createError from 'http-errors';

export default (routeMatchList, logger) => ({
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
    if (ctx.requestHandler.validate) {
      ctx.request.body = new PassThrough();
      ctx.request.dataBuf = Buffer.from([]);
      wrapStreamRead({
        signal: ctx.signal,
        stream: ctx.request.body,
        onData: (chunk) => {
          ctx.request.dataBuf = Buffer.concat([ctx.request.dataBuf, chunk]);
        },
      });
    }
  },
  onHttpResponse: async (ctx) => {
    if (ctx.response) {
      await new Promise((resolve) => {
        ctx.response.promise = () => {
          resolve();
        };
      });
    } else if (ctx.requestHandler.validate) {
      ctx.request.data = decodeContentToJSON(ctx.request.dataBuf, ctx.request.headers);
      if (!ctx.requestHandler.validate(ctx.request.data)) {
        throw createError(400, JSON.stringify(ctx.requestHandler.validate.errors));
      }
    }
    await ctx.requestHandler.fn(ctx);
    if (!ctx.response) {
      console.warn(`${ctx.request.method} ${ctx.request.path} ctx.response unconfig`);
      throw createError(503);
    }
    if (ctx.routeMatched.select && !(ctx.response.body instanceof Readable)) {
      ctx.response.data = ctx.routeMatched.select(ctx.response.data);
    }
  },
  onHttpResponseEnd: (ctx) => {
    if (ctx.routeMatched.onPost) {
      ctx.routeMatched.onPost(ctx);
    }
  },
  onHttpError: (ctx) => {
    assert(!!ctx.error);
    const message = `$$${ctx.request.method} ${ctx.request.path} ${ctx.response.statusCode} ${ctx.error.message}`;
    if (logger) {
      logger.warn(message);
    } else {
      console.log(message);
    }
    if (ctx.response.statusCode >= 500 && ctx.response.statusCode <= 599) {
      console.error(ctx.error);
    }
  },
});
