import createError from 'http-errors';
import { encodeHttp, decodeHttpResponse } from '@quanxiaoxiao/http-utils';
import { getSocketConnect } from '@quanxiaoxiao/http-request';
import {
  pipeForward,
  waitConnect,
} from '@quanxiaoxiao/socket';
import generateRequestForwardOptions from './generateRequestForwardOptions.mjs';

export default async ({
  options,
  signal,
  socket: clientSocket,
  request,
  onHttpResponseStartLine,
  onHttpResponseHeader,
  onHttpResponseBody,
  onConnect,
  onClose,
  onError,
  onChunkIncoming,
  onChunkOutgoing,
}) => {
  const remoteSocket = getSocketConnect({
    hostname: options.hostname,
    port: options.port,
    protocol: options.protocol || 'http:',
  });
  try {
    await waitConnect(
      remoteSocket,
      1000 * 10,
      signal,
    );
  } catch (error) {
    console.warn(error);
    throw createError(502);
  }

  const decode = decodeHttpResponse({
    onStartLine: onHttpResponseStartLine,
    onHeader: onHttpResponseHeader,
    onBody: onHttpResponseBody,
  });

  pipeForward(
    () => remoteSocket,
    () => clientSocket,
    {
      timeout: 1000 * 50,
      onError,
      onClose,
      onIncoming: onChunkIncoming,
      onOutgoing: (chunk) => {
        decode(chunk)
          .then(
            () => {},
            () => {},
          );
        onChunkOutgoing(chunk);
      },
      onConnect: () => {
        const chunkRequest = encodeHttp(
          {
            ...generateRequestForwardOptions(
              options,
              request,
            ),
            body: null,
          },
        );
        remoteSocket.write(chunkRequest);
        onChunkOutgoing(chunkRequest);
        process.nextTick(() => {
          if (!signal.aborted) {
            onConnect();
          }
        });
      },
    },
  );
};
