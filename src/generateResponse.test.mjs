import test from 'node:test';
import { PassThrough } from 'node:stream';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { STATUS_CODES } from 'node:http';
import createError from 'http-errors';
import generateResponse from './generateResponse.mjs';

test('generateResponse', () => {
  {
    const ctx = {};
    try {
      generateResponse(ctx);
      throw new Error('xxx');
    } catch (error) {
      assert.equal(error.statusCode, 503);
      assert.equal(ctx.error.message, '`ctx.response` unset');
      assert.equal(ctx.error.statusCode, 503);
      assert.equal(error.message, createError(503).message);
    }
  }
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
  assert(response.headers.includes('application/json; charset=utf-8'));
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

test('generateResponse content-encoding gzip', () => {
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
  assert(response.headers.includes('application/json; charset=utf-8'));
  assert.deepEqual(
    ctx.response.data,
    JSON.parse(zlib.unzipSync(response.body).toString()),
  );
});

test('generateResponse content-encoding unkown', () => {
  const ctx = {
    request: {
      headers: {
        'accept-encoding': 'gzips',
      },
    },
    response: {
      headers: {
        server: 'Quan',
        'content-encoding': 'gzip',
        'content-type': 'aaa',
      },
      data: {
        name: 'quan',
      },
    },
  };
  const response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.headers, ['server', 'Quan', 'Content-Type', 'application/json; charset=utf-8']);
  assert.deepEqual(
    ctx.response.data,
    JSON.parse(response.body),
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
  assert(response.headers.includes('application/json; charset=utf-8'));
  assert(!response.headers.includes('Content-Encoding'));
  assert.deepEqual(
    {
      name: 'quan',
    },
    JSON.parse(response.body),
  );
});

test('generateResponse data gzip 1', () => {
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
  assert(response.headers.includes('application/json; charset=utf-8'));
  assert(response.headers.includes('gzip'));
  assert(response.headers.includes('Content-Encoding'));
  assert.deepEqual(
    {
      name: 'quan',
    },
    JSON.parse(zlib.unzipSync(response.body)),
  );
});

test('generateResponse data gzip 2', () => {
  const ctx = {
    request: {
      headers: {
        'accept-encoding': 'br',
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
  assert(response.headers.includes('application/json; charset=utf-8'));
  assert(response.headers.includes('br'));
  assert(response.headers.includes('Content-Encoding'));
  assert.deepEqual(
    {
      name: 'quan',
    },
    JSON.parse(zlib.brotliDecompressSync(response.body)),
  );
});

test('generateResponse data gzip 3', () => {
  const ctx = {
    request: {
      headers: {
        'accept-encoding': 'br',
      },
    },
    response: {
      body: 'abcdef',
    },
  };
  const response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert(!response.headers.includes('application/json; charset=utf-8'));
  assert(response.headers.includes('br'));
  assert(response.headers.includes('Content-Encoding'));
  assert.deepEqual(
    'abcdef',
    zlib.brotliDecompressSync(response.body).toString(),
  );
});

test('generateResponse data gzip 3', () => {
  const ctx = {
    request: {
      headers: {
        'accept-encoding': 'br',
      },
    },
    response: {
      headers: {
        'content-encoding': 'gzip',
      },
      body: 'abcdef',
    },
  };
  const response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert(response.headers.includes('gzip'));
  assert(response.headers.includes('content-encoding'));
  assert(response.body !== 'abcdef');
  assert.deepEqual(
    'abcdef',
    response.body.toString(),
  );
});

test('generateResponse data gzip 3', () => {
  const ctx = {
    request: {
      headers: {
        'accept-encoding': 'gzip',
      },
    },
    response: {
      body: 'abcdef',
    },
  };
  const response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert(response.headers.includes('gzip'));
  assert(response.headers.includes('Content-Encoding'));
  assert(response.headers.includes('gzip'));
  assert(response.body !== 'abcdef');
  assert.deepEqual(
    'abcdef',
    zlib.unzipSync(response.body).toString(),
  );
});

test('generateResponse data gzip 4', () => {
  const ctx = {
    request: {
      headers: {
        'accept-encoding': 'gzips',
      },
    },
    response: {
      body: 'abcdef',
    },
  };
  const response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert(!response.headers.includes('gzips'));
  assert.equal(response.body.toString(), 'abcdef');
});

test('generateResponse data gzip 5', () => {
  const ctx = {
    request: {
      headers: {
        'accept-encoding': 'gzip',
      },
    },
    response: {
      headers: {
        'content-encoding': 'gzips',
      },
      body: 'abcdef',
    },
  };
  const response = generateResponse(ctx);
  assert.equal(response.statusCode, 200);
  assert(response.headers.includes('gzips'));
  assert(response.headers.includes('content-encoding'));
  assert.equal(response.body.toString(), 'abcdef');
});
