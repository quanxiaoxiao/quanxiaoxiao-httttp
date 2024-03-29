/* eslint no-use-before-define: 0 */
import { Buffer } from 'node:buffer';
import process from 'node:process';
import qs from 'node:querystring';
import assert from 'node:assert';
import { PassThrough } from 'node:stream';
import createError from 'http-errors';
import { decodeHttpRequest, encodeHttp } from '@quanxiaoxiao/http-utils';
import forwardRequest from './forwardRequest.mjs';
import forwardWebsocket from './forwardWebsocket.mjs';
import attachResponseError from './attachResponseError.mjs';
import generateResponse from './generateResponse.mjs';

export default ({
  signal,
  socket,
  doSocketEnd,
  detach,
  onHttpRequest,
  onHttpRequestStartLine,
  onHttpRequestHeader,
  onHttpRequestConnection,
  onHttpRequestEnd,
  onForwardConnecting,
  onForwardConnect,
  onHttpResponseEnd,
  onHttpError,
  onChunkIncoming,
  onChunkOutgoing,
}) => {
  const clientAddress = socket.remoteAddress;

  const state = {
    ctx: null,
    execute: null,
    request: null,
    isErrorEmit: false,
  };

  const doResponseError = (ctx) => {
    if (!signal.aborted && !state.isErrorEmit) {
      state.isErrorEmit = true;
      attachResponseError(ctx);
      if (onHttpError) {
        onHttpError(ctx);
      } else {
        console.error(ctx.error);
      }
      doSocketEnd(encodeHttp(ctx.response));
    }
  };

  const doResponse = async (ctx) => {
    if (!signal.aborted) {
      try {
        if (ctx.onResponse) {
          await ctx.onResponse(ctx);
          assert(!signal.aborted);
        }
        ctx.socket.write(encodeHttp(generateResponse(ctx)));
        state.ctx = null;
        if (onHttpResponseEnd) {
          onHttpResponseEnd(ctx);
        }
      } catch (error) {
        ctx.error = error;
        doResponseError(ctx);
      }
    }
  };

  const doForward = async (ctx) => {
    assert(ctx.requestForward);
    if (!ctx.onResponse) {
      ctx.requestForward.onBody = new PassThrough();
    }
    await forwardRequest({
      signal,
      ctx,
      onForwardConnecting,
      onForwardConnect,
      onChunkIncoming,
    });
    assert(!signal.aborted);
    if (ctx.onResponse) {
      await ctx.onResponse(ctx);
      assert(!signal.aborted);
      ctx.socket.write(encodeHttp(generateResponse(ctx)));
    }
    state.ctx = null;
    if (onHttpResponseEnd) {
      onHttpResponseEnd(ctx);
    }
  };

  const bindExcute = (ctx) => {
    state.execute = decodeHttpRequest({
      onStartLine: async (ret) => {
        const [pathname, querystring = ''] = ret.path.split('?');
        ctx.request.httpVersion = ret.httpVersion;
        ctx.request.method = ret.method;
        ctx.request.path = ret.path || '/';
        ctx.request.pathname = pathname || '/';
        ctx.request.querystring = querystring;
        if (querystring) {
          const query = qs.parse(querystring);
          if (qs.stringify(query) === querystring) {
            ctx.request.query = query;
          }
        }
        if (onHttpRequestStartLine) {
          await onHttpRequestStartLine(ctx);
          assert(!signal.aborted);
        }
      },
      onHeader: async (ret) => {
        ctx.request.dateTimeHeader = Date.now();
        ctx.request.headersRaw = ret.headersRaw;
        ctx.request.headers = ret.headers;
        if (onHttpRequestHeader) {
          await onHttpRequestHeader(ctx);
          assert(!signal.aborted);
        }
        if (ctx.request.headers.upgrade
          && /^websocket$/i.test(ctx.request.headers.upgrade)) {
          if (ctx.request.method !== 'GET') {
            throw createError(400);
          }
          if (!ctx.requestForward) {
            throw createError(503);
          }
          ctx.request.connection = true;
          if (onHttpRequestConnection) {
            await onHttpRequestConnection(ctx);
            assert(!signal.aborted);
          }
          if (detach()) {
            signal.removeEventListener('abort', handleAbortOnSignal);
            forwardWebsocket({
              ctx,
              onForwardConnect,
              onForwardConnecting,
              onChunkIncoming,
              onChunkOutgoing,
              onHttpResponseEnd,
              onHttpError,
            });
          }
        } else if (!ctx.onRequest) {
          if (ctx.request.headers['content-length'] > 0
              || /^chunked$/i.test(ctx.request.headers['transfer-encoding'])) {
            if (ctx.request.body) {
              assert(ctx.request.body.writable);
              assert(ctx.request.body.readable);
            } else {
              ctx.request.body = new PassThrough();
            }

            const streamThrottle = () => {
              const handleBodyOnPause = () => {
                if (!signal.aborted && !socket.isPaused()) {
                  socket.pause();
                }
              };

              const handleBodyOnResume = () => {
                if (!signal.aborted && socket.pause()) {
                  socket.resume();
                }
              };
              ctx.request.body.on('pause', handleBodyOnPause);
              ctx.request.body.on('resume', handleBodyOnResume);
              return () => {
                ctx.request.body.off('pause', handleBodyOnPause);
                ctx.request.body.off('resume', handleBodyOnResume);
              };
            };

            const throttle = streamThrottle();

            if (ctx.requestForward) {
              ctx.request.body.once('end', throttle);
            } else {
              ctx.request.body.once('end', () => {
                throttle();
                process.nextTick(() => {
                  doResponse(ctx);
                });
              });
            }
          }

          if (ctx.requestForward) {
            doForward(ctx)
              .then(
                () => {},
                (error) => {
                  ctx.error = error;
                  doResponseError(ctx);
                },
              );
          }
        }
      },
      onBody: (chunk) => {
        if (!ctx.request.connection) {
          if (ctx.request.dateTimeBody == null) {
            ctx.request.dateTimeBody = Date.now();
          }
          if (ctx.onRequest) {
            ctx.request.body = ctx.request.body ? Buffer.concat([ctx.request.body, chunk]) : chunk;
          } else {
            ctx.request.body.write(chunk);
          }
        }
      },
      onEnd: async () => {
        if (!ctx.request.connection) {
          ctx.request.dateTimeEnd = Date.now();
          if (ctx.request.dateTimeBody == null) {
            ctx.request.dateTimeBody = ctx.request.dateTimeEnd;
          }
          if (onHttpRequestEnd) {
            await onHttpRequestEnd(ctx);
            assert(!signal.aborted);
          }
          if (ctx.onRequest) {
            await ctx.onRequest(ctx);
            assert(!signal.aborted);
            if (ctx.response) {
              doResponse(ctx);
            } else if (ctx.requestForward) {
              await doForward(ctx);
            } else {
              throw createError(503);
            }
          } else if (ctx.request.body) {
            ctx.request.body.end();
          } else if (!ctx.requestForward) {
            doResponse(ctx);
          }
        }
      },
    });
  };

  function handleAbortOnSignal() {
    if (state.ctx
      && state.ctx.request
      && state.ctx.request.body
      && state.ctx.request.body.pipe
      && !state.ctx.request.body.destroyed
    ) {
      state.ctx.request.body.destroy();
    }
  }

  signal.addEventListener('abort', handleAbortOnSignal, { once: true });

  return async (chunk) => {
    assert(!signal.aborted);

    if (!state.ctx) {
      state.ctx = {
        socket,
        request: {
          dateTimeCreate: Date.now(),
          remoteAddress: clientAddress,
          connection: false,
          dateTimeHeader: null,
          dateTimeBody: null,
          dateTimeEnd: null,
          method: null,
          path: null,
          httpVersion: null,
          headersRaw: [],
          headers: {},
          body: null,
          pathname: null,
          querystring: '',
          query: {},
        },
        response: null,
        error: null,
      };
      if (onHttpRequest) {
        await onHttpRequest(state.ctx);
        assert(!signal.aborted);
      }
      bindExcute(state.ctx);
    }

    if (chunk && chunk.length > 0) {
      if (onChunkOutgoing) {
        onChunkOutgoing(state.ctx, chunk);
      }

      try {
        await state.execute(chunk);
      } catch (error) {
        if (!signal.aborted) {
          if (state.ctx) {
            state.ctx.error = error;
            doResponseError(state.ctx);
          } else {
            console.error(error);
            if (!socket.destroyed) {
              socket.destroy();
            }
          }
        }
        if (state.ctx
           && state.ctx.request.body
           && state.ctx.request.body.pipe
           && !state.ctx.request.body.destroyed) {
          state.ctx.request.body.destroy();
        }
      }
    }
  };
};
