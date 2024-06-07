import { Buffer } from 'node:buffer';
import assert from 'node:assert';
import { PassThrough, Readable } from 'node:stream';
import createError from 'http-errors';
import { createConnector } from '@quanxiaoxiao/socket';
import {
  decodeHttpRequest,
  encodeHttp,
  parseHttpPath,
} from '@quanxiaoxiao/http-utils';
import {
  HttpParserError,
  NetConnectTimeoutError,
  SocketCloseError,
} from '@quanxiaoxiao/http-request';
import {
  wrapStreamWrite,
  wrapStreamRead,
} from '@quanxiaoxiao/node-utils';
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
  const controller = new AbortController();

  const state = {
    dateTimeCreate: Date.now(),
    timeOnStart: performance.now(),
    timeOnActive: null,
    timeOnLastActive: null,
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

  const calcTimeByRequest = () => performance.now() - state.ctx.request.timeOnStart;

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

  const handleError = (error, ctx) => {
    if (!controller.signal.aborted) {
      ctx.error = error;
      doResponseError(ctx);
    } else {
      console.warn(error);
    }
  };

  const doResponse = async (ctx) => {
    assert(!ctx.error);
    if (!controller.signal.aborted && ctx.socket.writable) {
      if (ctx.response && ctx.response.body instanceof Readable) {
        const encodeHttpResponse = encodeHttp({
          statusCode: ctx.response.statusCode || 200,
          headers: ctx.response._headers || ctx.response.headersRaw || ctx.response.headers,
          body: new PassThrough(),
          onHeader: (chunk) => {
            state.connector.write(Buffer.concat([chunk, Buffer.from('\r\n')]));
          },
        });
        process.nextTick(() => {
          try {
            wrapStreamRead({
              signal: controller.signal,
              stream: ctx.response.body,
              onData: (chunk) => state.connector.write(encodeHttpResponse(chunk)),
              onEnd: () => {
                try {
                  state.connector.write(encodeHttpResponse());
                } catch (error) {
                  if (!controller.signal.aborted) {
                    controller.abort();
                    ctx.error = error;
                    if (onClose) {
                      onClose(ctx);
                    }
                  }
                }
                if (!controller.signal.aborted) {
                  doResponseEnd();
                }
              },
              onError: (error) => handleError(error, ctx),
            });
          } catch (error) {
            handleError(error, ctx);
          }
        });
      } else {
        try {
          if (ctx.onResponse) {
            await ctx.onResponse(ctx);
            assert(!controller.signal.aborted);
          }
          const response = generateResponse(ctx);
          state.connector.write(encodeHttp(response));
          doResponseEnd();
        } catch (error) {
          handleError(error, ctx);
        }
      }
    }
  };

  const doForward = async (ctx) => {
    assert(ctx.requestForward);
    if (!ctx.onResponse && !ctx.requestForward.onBody) {
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
        ctx.request.timeOnStartLine = calcTimeByRequest();
        ctx.request.httpVersion = ret.httpVersion;
        ctx.request.method = ret.method;
        const [pathname, querystring, query] = parseHttpPath(ret.path);
        ctx.request.path = ret.path;
        ctx.request.pathname = pathname;
        ctx.request.querystring = querystring;
        ctx.request.query = query;
        if (onHttpRequestStartLine) {
          await onHttpRequestStartLine(ctx);
          assert(!controller.signal.aborted);
        }
      },
      onHeader: async (ret) => {
        state.step = 2;
        ctx.request.headersRaw = ret.headersRaw;
        ctx.request.headers = ret.headers;
        ctx.request.timeOnHeader = calcTimeByRequest();
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
                      (error) => handleError(error, ctx),
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
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = calcTimeByRequest();
        }
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
        ctx.request.timeOnEnd = calcTimeByRequest();
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = ctx.request.timeOnEnd;
        }
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
      request: {
        dateTimeCreate: Date.now(),
        timeOnStart: performance.now(),
        timeOnStartLine: null,
        timeOnHeader: null,
        timeOnBody: null,
        timeOnEnd: null,
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
        const now = performance.now();
        if (state.timeOnActive == null) {
          state.timeOnLastActive = now;
        } else {
          state.timeOnLastActive = state.timeOnActive;
        }
        state.timeOnActive = now;
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
      onDrain: () => {
        if (state.ctx
          && state.ctx.response
          && state.ctx.response.body instanceof Readable
          && state.ctx.response.body.isPaused()
        ) {
          state.ctx.response.body.resume();
        }
      },
      onClose: () => {
        assert(!controller.signal.aborted);
        controller.abort();
        if (state.ctx) {
          state.ctx.error = new Error('Socket Close Error');
          if (onClose) {
            onClose(state.ctx);
          }
        }
      },
      onError: (error) => {
        if (!controller.signal.aborted) {
          controller.abort();
          if (state.ctx) {
            state.ctx.error = error;
            if (onClose) {
              onClose(state.ctx);
            }
          }
        }
      },
    },
    () => socket,
  );
};
