import request from '@quanxiaoxiao/http-request';
import getSocketConnection from './getSocketConnection.mjs';

export default ({
  signal,
  options,
  ctx,
  onRequest,
}) => {
  return request(
    {
      method: options.method,
      path: options.path,
      headers: options.headers,
      signal,
      onRequest: async (requestOptions, state) => {
        if (onRequest) {
          await onRequest(requestOptions, state);
        }
        if (!signal || !signal.aborted) {
          ctx.response = {
            httpVersion: null,
            statusCode: null,
            statusText: null,
            headers: {},
            headersRaw: [],
            body: null,
          };
        }
      },
    },
    () => getSocketConnection({
      hostname: options.hostname,
      servername: options.servername,
      port: options.port,
      protocol: options.protocol || 'http:',
    }),
  )
};
