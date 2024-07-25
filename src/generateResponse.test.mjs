import test from 'node:test';
import { PassThrough } from 'node:stream';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { STATUS_CODES } from 'node:http';
import generateResponse from './generateResponse.mjs';

test('generateResponse', () => {
  assert.throws(() => {
    const ctx = {};
    generateResponse(ctx);
  });
  assert.throws(() => {
    const ctx = {
      response: {
        body: new PassThrough(),
      },
    };
    generateResponse(ctx);
  });
  assert.throws(() => {
    const ctx = {
      response: {
        body: new PassThrough(),
        data: {
          name: 'quan',
        },
      },
    };
    generateResponse(ctx);
  });
  assert.throws(() => {
    const pass = new PassThrough();
    const ctx = {
      response: {
        body: pass,
      },
    };
    pass.destroy();
    generateResponse(ctx);
  });
  assert.throws(() => {
    const ctx = {
      response: {
        body: 22,
      },
    };
    generateResponse(ctx);
  });
  const ctx = {
    request: {
      headers: {},
    },
    response: {
      statusCode: 204,
      statusText: 'aaa',
      body: null,
    },
  };
  let response = generateResponse(ctx);
  assert(Array.isArray(response.headers));
  assert.equal(response.statusCode, 204);
  assert.equal(response.statusText, STATUS_CODES[204]);
  assert.equal(response.body, null);

  ctx.response = {
    body: 'aaa',
  };
  response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'aaa');

  ctx.response = {
    body: 'aaa',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Encoding': 'gzip',
    },
    data: {
      name: 'bbb',
    },
  };
  response = generateResponse(ctx);
  assert(Array.isArray(response.headers));
  assert.equal(response.body, JSON.stringify({ name: 'bbb' }));
  assert(response.headers.includes('application/json'));
  assert(!response.headers.includes('text/plain'));
  assert(!response.headers.includes('gzip'));

  ctx.response = {
    body: 'ccc',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Encoding': 'gzip',
    },
    _headers: {
      'Content-Type': 'text/html',
    },
  };
  response = generateResponse(ctx);
  assert(Array.isArray(response.headers));
  assert(!response.headers.includes('text/plain'));
  assert(response.headers.includes('text/html'));
});

test('generateResponse gzip', () => {
  const ctx = {
    request: {
      headers: {
        'accept-encoding': 'gzip',
      },
    },
    response: {
      data: {
        name: 'quan',
      },
    },
  };
  const response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert(response.headers.includes('gzip'));
  assert(response.headers.includes('application/json'));
  assert.deepEqual(
    ctx.response.data,
    JSON.parse(zlib.unzipSync(response.body).toString()),
  );
});

test('generateResponse data', () => {
  const pass = new PassThrough();
  const ctx = {
    request: {},
    response: {
      body: pass,
      data: {
        name: 'quan',
      },
    },
  };
  pass.destroy();
  const response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert(response.headers.includes('application/json'));
  assert.deepEqual(
    {
      name: 'quan',
    },
    ctx.response.data,
  );
});
