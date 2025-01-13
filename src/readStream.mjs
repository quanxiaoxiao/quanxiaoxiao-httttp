import assert from 'node:assert';

import { wrapStreamRead } from '@quanxiaoxiao/node-utils';

export default async (stream, signal) => {
  if (signal) {
    assert(!signal.aborted);
  }
  assert(stream && stream.readable);
  const bufList = [];
  await new Promise((resolve, reject) => {
    wrapStreamRead({
      signal,
      stream,
      onData: (chunk) => {
        bufList.push(chunk);
      },
      onEnd: () => {
        resolve();
      },
      onError: (error) => {
        reject(error);
      },
    });
  });
  assert(!signal.aborted);
  return Buffer.concat(bufList);
};
