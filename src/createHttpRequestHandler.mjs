import { Readable } from 'node:stream';
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
    }
  },
  onHttpResponse: async (ctx) => {
    await ctx.requestHandler.fn(ctx);
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
