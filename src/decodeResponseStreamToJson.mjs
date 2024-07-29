import assert from 'node:assert';
import { wrapStreamRead } from '@quanxiaoxiao/node-utils';
import { decodeContentToJSON } from '@quanxiaoxiao/http-utils';

export default async (ctx) => {
  assert(ctx.signal && !ctx.signal.aborted);
  assert(ctx.response && ctx.response.body);
  assert(ctx.response.body.readable);
  const data = await new Promise((resolve, reject) => {
    const bufList = [];
    wrapStreamRead({
      signal: ctx.signal,
      stream: ctx.response.body,
      onData: (chunk) => {
        bufList.push(chunk);
      },
      onEnd: () => {
        if (bufList.length === 0) {
          resolve(null);
        } else {
          resolve(decodeContentToJSON(
            Buffer.concat(bufList),
            ctx.response.headers,
          ));
        }
      },
      onError: (error) => {
        reject(error);
      },
    });
  });
  assert(!ctx.signal.aborted);
  return data;
};
