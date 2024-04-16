import { Buffer } from 'node:buffer';
import qs from 'node:querystring';
import assert from 'node:assert';
import { PassThrough } from 'node:stream';
import createError from 'http-errors';
import { createConnector } from '@quanxiaoxiao/socket';
import { decodeHttpRequest, encodeHttp } from '@quanxiaoxiao/http-utils';
import {
  HttpParserError,
  NetConnectTimeoutError,
  SocketCloseError,
} from '@quanxiaoxiao/http-request';
import { wrapStreamWrite } from '@quanxiaoxiao/node-utils';
import forwardRequest from './forwardRequest.mjs';
import forwardWebsocket from './forwardWebsocket.mjs';
import attachResponseError from './attachResponseError.mjs';
import generateResponse from './generateResponse.mjs';

const promisee = async (fn, ...args) => {
  const ret = await fn(...args);
  return ret;
};

export default ({
  socket,
  onClose,
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
    timeCreate: Date.now(),
    timeOnStart: performance.now(),
    timeOnLastActive: null,
    timeOnActive: null,
    bytesIncoming: 0,
    ctx: null,
    count: 0,
    step: -1,
    execute: null,
    connector: null,
  };

  const doResponseEnd = () => {
    const { ctx } = state;
    state.step = -1;
    state.ctx = null;
    if (onHttpResponseEnd) {
      try {
        onHttpResponseEnd(ctx);
      } catch (error) {
        console.warn(error);
      }
    }
  };

  const doResponseError = (ctx) => {
    if (!controller.signal.aborted) {
      attachResponseError(ctx);
      if (onHttpError) {
        onHttpError(ctx);
      } else {
        console.warn(ctx.error);
      }
      try {
        state.connector.end(encodeHttp(ctx.response));
      } catch (error) {
        console.warn(error);
      } finally {
        if (!controller.signal.aborted) {
          controller.abort();
        }
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
        doResponseEnd();
      } catch (error) {
        if (!controller.signal.aborted && state.ctx) {
          ctx.error = error;
          doResponseError(ctx);
        } else {
          console.warn(error);
        }
      }
    }
  };

  const doForward = async (ctx) => {
    assert(ctx.requestForward);
    if (!ctx.onResponse) {
      ctx.requestForward.onBody = new PassThrough();
    }
    forwardRequest({
      ctx,
      signal: controller.signal,
      onForwardConnecting,
      onForwardConnect,
      onChunkIncoming,
    })
      .then(
        () => {
          assert(!controller.signal.aborted);
        },
      )
      .then(() => {
        if (ctx.onResponse) {
          return promisee(ctx.onResponse, ctx)
            .then(() => {
              assert(!controller.signal.aborted);
              state.connector.write(encodeHttp(generateResponse(ctx)));
            });
        }
        return Promise.resolve(ctx);
      })
      .then(
        () => {
          doResponseEnd();
        },
        (error) => {
          if (!controller.signal.aborted) {
            ctx.error = error;
            if (error instanceof HttpParserError) {
              ctx.error.statusCode = 502;
            } else if (error instanceof NetConnectTimeoutError) {
              ctx.error.statusCode = 504;
            } else if (error instanceof SocketCloseError) {
              ctx.error.statusCode = 502;
            }
            doResponseError(ctx);
          }
        },
      );
  };

  const bindExcute = (ctx) => {
    state.execute = decodeHttpRequest({
      onStartLine: async (ret) => {
        state.step = 1;
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
        state.step = 2;
        ctx.request.headersRaw = ret.headersRaw;
        ctx.request.headers = ret.headers;
        if (onHttpRequestHeader) {
          await onHttpRequestHeader(ctx);
          assert(!controller.signal.aborted);
        }
        if (ctx.request.headers.upgrade) {
          if (!/^websocket$/i.test(ctx.request.headers.upgrade)) {
            throw createError(510);
          }
          if (ctx.request.method !== 'GET') {
            throw createError(400);
          }
          if (!ctx.requestForward) {
            throw createError(510);
          }
          ctx.request.connection = true;
          if (onHttpRequestConnection) {
            await onHttpRequestConnection(ctx);
            assert(!controller.signal.aborted);
          }
          if (state.connector.detach()) {
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
        } else if (!Object.hasOwnProperty.call(ctx, 'onRequest')) {
          if (ctx.request.headers['content-length'] > 0
              || /^chunked$/i.test(ctx.request.headers['transfer-encoding'])) {
            if (!ctx.request.body) {
              ctx.request.body = new PassThrough();
            }
            ctx.request._write = wrapStreamWrite({
              stream: ctx.request.body,
              signal: controller.signal,
              onPause: () => {
                state.connector.pause();
              },
              onDrain: () => {
                state.connector.resume();
              },
              onError: (error) => {
                if (!controller.signal.aborted) {
                  ctx.error = new Error(`request body stream, \`${error.message}\``);
                  doResponseError(ctx);
                }
              },
              onEnd: () => {
                if (onHttpRequestEnd) {
                  promisee(onHttpRequestEnd, ctx)
                    .then(
                      () => {
                        assert(!Object.hasOwnProperty.call(ctx, 'onRequest'));
                      },
                    )
                    .then(
                      () => {
                        if (!controller.signal.aborted && !ctx.requestForward) {
                          doResponse(ctx);
                        }
                      },
                      (error) => {
                        if (!controller.signal.aborted) {
                          ctx.error = error;
                          doResponseError(ctx);
                        } else {
                          console.warn(error);
                        }
                      },
                    );
                } else if (!ctx.requestForward) {
                  doResponse(ctx);
                }
              },
            });
          }

          if (ctx.requestForward) {
            doForward(ctx);
          }
        } else {
          assert(typeof ctx.onRequest === 'function');
        }
      },
      onBody: (chunk) => {
        assert(!controller.signal.aborted);
        if (state.step === 2) {
          state.step = 3;
        }
        if (!ctx.request.connection) {
          if (ctx.onRequest) {
            ctx.request.body = ctx.request.body ? Buffer.concat([ctx.request.body, chunk]) : chunk;
          } else {
            ctx.request._write(chunk);
          }
        }
      },
      onEnd: async () => {
        state.step = 4;
        if (!ctx.request.connection) {
          if (ctx.request._write) {
            ctx.request._write();
          } else {
            if (onHttpRequestEnd) {
              const isOnResponseUnbind = !Object.hasOwnProperty.call(ctx, 'onRequest');
              await onHttpRequestEnd(ctx);
              assert(!controller.signal.aborted);
              if (isOnResponseUnbind) {
                assert(!Object.hasOwnProperty.call(ctx, 'onRequest'));
              }
            }
            if (ctx.onRequest) {
              await ctx.onRequest(ctx);
              assert(!controller.signal.aborted);
              if (ctx.response) {
                doResponse(ctx);
              } else if (ctx.requestForward) {
                doForward(ctx);
              } else {
                throw createError(503);
              }
            } else if (!ctx.requestForward) {
              doResponse(ctx);
            }
          }
        }
      },
    });
  };

  const attachContext = () => {
    state.step = 0;
    state.count += 1;
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
      try {
        onHttpRequest(state.ctx);
        assert(state.ctx.response === null);
      } catch (error) {
        state.ctx.error = error;
      }
    }
    if (state.ctx.error) {
      doResponseError(state.ctx);
    } else if (!controller.signal.aborted) {
      bindExcute(state.ctx);
    }
  };

  const execute = (chunk) => {
    state.execute(chunk)
      .then(
        (ret) => {
          if (ret.complete && ret.dataBuf.length > 0) {
            if (!controller.signal.aborted) {
              if (state.ctx) {
                state.ctx.error = createError(400);
                doResponseError(state.ctx);
              } else {
                state.connector();
                controller.abort();
              }
            }
          }
        },
        (error) => {
          if (!controller.signal.aborted) {
            if (state.ctx) {
              state.ctx.error = error;
              if (error instanceof HttpParserError) {
                error.statusCode = 400;
              }
              doResponseError(state.ctx);
            } else {
              console.warn(error);
              state.connector();
              controller.abort();
            }
          }
        },
      );
  };

  state.connector = createConnector(
    {
      onData: (chunk) => {
        assert(!controller.signal.aborted);
        const size = chunk.length;
        state.bytesIncoming += size;
        if (state.timeOnActive == null) {
          state.timeOnLastActive = performance.now();
        } else {
          state.timeOnLastActive = state.timeOnActive;
        }
        state.timeOnActive = performance.now();
        if (!state.ctx) {
          attachContext();
        }
        if (!controller.signal.aborted && size > 0) {
          if (onChunkOutgoing) {
            onChunkOutgoing(state.ctx, chunk);
          }
          execute(chunk);
        }
      },
      onClose: () => {
        assert(!controller.signal.aborted);
        controller.abort();
        if (state.ctx && onClose) {
          onClose(state.ctx);
        }
      },
      onError: (error) => {
        console.warn(error);
        if (!controller.signal.aborted) {
          controller.abort();
          if (state.ctx && onClose) {
            onClose(state.ctx);
          }
        }
      },
    },
    () => socket,
  );
};
