import { Readable } from 'node:stream';

import { decodeContentToJSON } from '@quanxiaoxiao/http-utils';

import readStream from './readStream.mjs';

export default async (ctx) => {
  if (ctx.requestForward
    && ctx.requestForward.response.body instanceof Readable
    && ctx.requestForward.response.body.readable
  ) {
    const buf = await readStream(ctx.requestForward.response.body, ctx.signal);
    if (ctx.requestForward.response.statusCode >= 200 && ctx.requestForward.response.statusCode <= 299) {
      try {
        const data = decodeContentToJSON(
          buf,
          ctx.requestForward.response.headers,
        );
        if (ctx.response) {
          ctx.response.data = data;
        } else {
          ctx.response = {
            data,
          };
        }
      } catch (error) {
        console.warn(error);
        ctx.response = {
          statusCode: ctx.requestForward.response.statusCode,
          headers: ctx.requestForward.response.headers,
          body: buf,
        };
      }
    } else {
      ctx.response = {
        statusCode: ctx.requestForward.response.statusCode,
        headers: ctx.requestForward.response.headers,
        body: buf,
      };
    }
  }
};
