/* eslint no-use-before-define: 0 */
import { Buffer } from 'node:buffer';
import process from 'node:process';
import qs from 'node:querystring';
import assert from 'node:assert';
import { PassThrough } from 'node:stream';
import createError from 'http-errors';
import { createConnector } from '@quanxiaoxiao/socket';
import { decodeHttpRequest, encodeHttp } from '@quanxiaoxiao/http-utils';
import forwardRequest from './forwardRequest.mjs';
import forwardWebsocket from './forwardWebsocket.mjs';
import attachResponseError from './attachResponseError.mjs';
import generateResponse from './generateResponse.mjs';

export default ({
  socket,
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

  const controller = new AbortController();

  const state = {
    ctx: null,
    execute: null,
    connector: null,
  };

  const doResponseError = (ctx) => {
    if (!controller.signal.aborted) {
      attachResponseError(ctx);
      if (onHttpError) {
        onHttpError(ctx);
      } else {
        console.error(ctx.error);
      }
      try {
        state.connector.end(encodeHttp(ctx.response));
      } catch (error) {
        console.warn(error);
      } finally {
        controller.abort();
      }
    }
  };

  const doResponse = async (ctx) => {
    if (!controller.signal.aborted) {
      try {
        if (ctx.onResponse) {
          await ctx.onResponse(ctx);
          assert(!controller.signal.aborted);
        }
        const response = generateResponse(ctx);
        state.connector.write(encodeHttp(response));
        state.ctx = null;
        if (onHttpResponseEnd) {
          onHttpResponseEnd(ctx);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          ctx.error = error;
          doResponseError(ctx);
        }
      }
    }
  };

  const doForward = async (ctx) => {
    assert(ctx.requestForward);
    if (!ctx.onResponse) {
      ctx.requestForward.onBody = new PassThrough();
    }
    await forwardRequest({
      signal: controller.signal,
      ctx,
      onForwardConnecting,
      onForwardConnect,
      onChunkIncoming,
    });
    assert(!controller.signal.aborted);
    if (ctx.onResponse) {
      await ctx.onResponse(ctx);
      assert(!controller.signal.aborted);
      state.connector.write(encodeHttp(generateResponse(ctx)));
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
          assert(!controller.signal.aborted);
        }
      },
      onHeader: async (ret) => {
        ctx.request.headersRaw = ret.headersRaw;
        ctx.request.headers = ret.headers;
        if (onHttpRequestHeader) {
          await onHttpRequestHeader(ctx);
          assert(!controller.signal.aborted);
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
            assert(!controller.signal.aborted);
          }
          if (state.connector.detach()) {
            controller.signal.removeEventListener('abort', handleAbortOnSignal);
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
            if (!ctx.request.body) {
              ctx.request.body = new PassThrough();
            }
            assert(ctx.request.body.writable);
            assert(ctx.request.body.readable);

            const streamThrottle = () => {
              const handleRequestBodyOnDrain = () => {
                state.connection.resume();
              };
              ctx.request.body.on('drain', handleRequestBodyOnDrain);
              return () => {
                ctx.request.body.off('drain', handleRequestBodyOnDrain);
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
                  if (!controller.signal.aborted) {
                    ctx.error = error;
                    doResponseError(ctx);
                  }
                },
              );
          }
        }
      },
      onBody: (chunk) => {
        if (!ctx.request.connection) {
          if (ctx.onRequest) {
            ctx.request.body = ctx.request.body ? Buffer.concat([ctx.request.body, chunk]) : chunk;
          } else {
            const ret = ctx.request.body.write(chunk);
            if (ret === false) {
              state.connector.pause();
            }
          }
        }
      },
      onEnd: async () => {
        if (!ctx.request.connection) {
          if (onHttpRequestEnd) {
            await onHttpRequestEnd(ctx);
            assert(!controller.signal.aborted);
          }
          if (ctx.onRequest) {
            await ctx.onRequest(ctx);
            assert(!controller.signal.aborted);
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

  const check = () => {
    assert(!controller.signal.aborted);
    if (!state.ctx) {
      state.ctx = {
        socket,
        remoteAddress: clientAddress,
        request: {
          connection: false,
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
        onHttpRequest(state.ctx);
      }
      bindExcute(state.ctx);
    }
  };

  const execute = (chunk) => {
    state.execute(chunk)
      .then(
        () => {},
        (error) => {
          if (!controller.signal.aborted) {
            if (state.ctx) {
              state.ctx.error = error;
              doResponseError(state.ctx);
            } else {
              state.connector();
            }
          }
        },
      );
  };

  state.connector = createConnector(
    {
      onData: (chunk) => {
        check();
        if (chunk.length > 0) {
          if (onChunkOutgoing) {
            onChunkOutgoing(state.ctx, chunk);
          }
          execute(chunk);
        }
      },
      onClose: () => {
        assert(!controller.signal.aborted);
        controller.abort();
      },
      onError: () => {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      },
    },
    () => socket,
  );

  controller.signal.addEventListener('abort', handleAbortOnSignal, { once: true });
};
