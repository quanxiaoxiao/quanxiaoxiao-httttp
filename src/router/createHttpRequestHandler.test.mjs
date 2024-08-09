import test from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import request, { getSocketConnect } from '@quanxiaoxiao/http-request';
import { waitFor } from '@quanxiaoxiao/utils';
import handleSocketRequest from '../handleSocketRequest.mjs';
import generateRouteMatchList from './generateRouteMatchList.mjs';
import createHttpRequestHandler from './createHttpRequestHandler.mjs';

const _getPort = () => {
  let _port = 4750;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const getPort = _getPort();

test('createHttpRequestHandler', async () => {
  const port = getPort();
  const routeMatchList = generateRouteMatchList({
    '/test': {
      get: (ctx) => {
        ctx.response = {
          body:  'aaa',
        };
      },
      post: async (ctx) => {
        if (ctx.request.body) {
          assert(Buffer.isBuffer(ctx.request.body));
          assert.equal(ctx.request.body.toString(), 'abcd');
          ctx.response = {
            body: 'ccc',
          };
        } else {
          ctx.response = {
            body:  'xxx',
          };
        }
      },
    },
    '/validate': {
      post: {
        validate: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              nullable: false,
            },
            age: {
              type: 'integer',
              minimum: 18,
              maximum: 40,
            },
          },
          required: ['name', 'age'],
        },
        fn: (ctx) => {
          ctx.response = {
            data: {
              name: ctx.request.data.name,
              age: ctx.request.data.age,
            },
          };
        },
      },
    },
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      ...createHttpRequestHandler({
        list: routeMatchList,
      }),
    });
  });
  server.listen(port);
  await waitFor(100);
  let ret = await request(
    {
      path: '/aaa',
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 404);
  ret = await request(
    {
      path: '/test',
      method: 'DELETE',
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 405);
  ret = await request(
    {
      path: '/test',
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.body.toString(), 'aaa');
  ret = await request(
    {
      path: '/test',
      method: 'POST',
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.body.toString(), 'xxx');
  ret = await request(
    {
      path: '/test',
      method: 'POST',
      body: 'abcd',
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.body.toString(), 'ccc');
  ret = await request(
    {
      path: '/validate',
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'quan',
        age: 33,
      }),
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 405);
  ret = await request(
    {
      path: '/validate',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'quan',
        age: 33,
      }),
    },
    () => getSocketConnect({ port }),
  );
  assert.deepEqual(
    {
      name: 'quan',
      age: 33,
    },
    JSON.parse(ret.body.toString()),
  );
  ret = await request(
    {
      path: '/validate',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'quan',
        age: 66,
      }),
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 400);
  server.close();
});

test('createHttpRequestHandler forwardRequest', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const routeMatchList1 = generateRouteMatchList({
    '/select/1': {
      select: {
        type: 'object',
        properties: {
          name: ['.foo', { type: 'string' }],
        },
      },
      get: (ctx) => {
        ctx.response = {
          data: {
            foo: 'quan1',
          },
        };
      },
    },
    '/select/forward/1': {
      select: {
        type: 'object',
        properties: {
          name: ['.foo', { type: 'string' }],
        },
      },
      get: (ctx) => {
        ctx.forward = {
          path: '/select/ss',
          port: port2,
        };
      },
    },
    '/forward/1': {
      onPre: (ctx) => {
        if (ctx.request.method === 'GET') {
          ctx.forward = {
            port: port2,
            path: '/test/quan?name=xxx',
          };
        }
      },
      post: (ctx) => {
        assert(!ctx.response);
        assert(Buffer.isBuffer(ctx.request.body));
        ctx.response = {
          body: 'aaa1',
        };
      },
      get: () => {},
    },
    '/forward/2': {
      match: {
        'query.name': {
          $in: ['quan', 'cqq'],
        },
      },
      onPre: (ctx) => {
        if (ctx.request.method === 'GET') {
          ctx.forward = {
            port: port2,
            path: `/forward/2/${ctx.request.query.name}`,
          };
        }
      },
      get: (ctx) => {
        ctx.response = {
          body: ctx.request.query.name,
        };
      },
      post: {
        validate: {
          type: 'object',
          properties: {
            age: {
              type: 'integer',
              minimum: 30,
              maximum: 40,
            },
            foo: {
              enum: ['big', 'rice'],
            },
          },
          required: ['age', 'foo'],
        },
        fn: (ctx) => {
          assert.deepEqual(ctx.request.data, { foo: 'big', age: 36 });
          ctx.forward = {
            port: port2,
            path: `/forward/2/${ctx.request.query.name}`,
            body: JSON.stringify({
              data: {
                username: ctx.request.data.foo,
                age: ctx.request.data.age,
              },
            }),
          };
        },
      },
    },
  });
  const routeMatchList2 = generateRouteMatchList({
    '/test/quan': {
      get: (ctx) => {
        assert.deepEqual(ctx.request.query, { name: 'xxx' });
        ctx.response = {
          statusCode: 201,
          headers: {
            Server: 'quan',
          },
          body: 'aa',
        };
      },
    },
    '/select/ss': {
      get: (ctx) => {
        ctx.response = {
          data: {
            foo: 'quan2',
          },
        };
      },
    },
    '/forward/2/quan': {
      get: (ctx) => {
        ctx.response = {
          body: 'quan',
        };
      },
    },
    '/forward/2/cqq': {
      get: (ctx) => {
        ctx.response = {
          body: 'cqq',
        };
      },
      post: {
        validate: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                },
                age: {
                  type: 'integer',
                  minimum: 35,
                  maximum: 39,
                },
              },
              required: ['username', 'age'],
            },
          },
          required: ['data'],
        },
        fn: (ctx) => {
          assert.deepEqual(ctx.request.data, {
            data: {
              username: 'big',
              age: 36,
            },
          });
          ctx.response = {
            statusCode: 201,
            data: {
              ss: ctx.request.data.data.username,
            },
          };
        },
      },
    },
  });
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      ...createHttpRequestHandler({
        list: routeMatchList1,
      }),
    });
  });
  server1.listen(port1);
  const server2 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      ...createHttpRequestHandler({
        list: routeMatchList2,
      }),
    });
  });
  server2.listen(port2);
  await waitFor(100);
  let ret = await request(
    {
      path: '/forward/1',
      method: 'GET',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 201);
  assert.equal(ret.body.toString(), 'aa');
  assert.deepEqual(ret.headers, { 'content-length': 2, server: 'quan' });
  ret = await request(
    {
      path: '/forward/1',
      method: 'POST',
      body: 'accs',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.body.toString(), 'aaa1');
  ret = await request(
    {
      path: '/forward/2?name=rice',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 400);
  ret = await request(
    {
      path: '/forward/2?name=quan',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.body.toString(), 'quan');
  ret = await request(
    {
      path: '/forward/2?name=cqq',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.body.toString(), 'cqq');
  ret = await request(
    {
      path: '/forward/2?name=cqq',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        foo: 'big',
        age: 36,
      }),
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 201);
  assert.deepEqual(
    JSON.parse(ret.body),
    { ss: 'big' },
  );
  ret = await request(
    {
      path: '/select/1',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 200);
  assert.deepEqual(
    JSON.parse(ret.body),
    { name: 'quan1' },
  );
  ret = await request(
    {
      path: '/select/forward/1',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 200);
  assert.deepEqual(
    JSON.parse(ret.body),
    { name: 'quan2' },
  );
  server1.close();
  server2.close();
});

test('createHttpRequestHandler forward  post', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const routeMatchList1 = generateRouteMatchList({
    '/sunlandapi/post/1': {
      onPre: (ctx) => {
        ctx.forward = {
          port: port2,
          path: '/post/1',
        };
      },
      post: () => {},
    },
  });
  const routeMatchList2 = generateRouteMatchList({
    '/post/1': {
      post: (ctx) => {
        ctx.response = {
          body: 'ok',
        };
      },
    },
  });
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      ...createHttpRequestHandler({
        list: routeMatchList1,
      }),
    });
  });
  server1.listen(port1);
  const server2 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      ...createHttpRequestHandler({
        list: routeMatchList2,
      }),
    });
  });
  server2.listen(port2);
  await waitFor(100);
  const ret = await request(
    {
      path: '/sunlandapi/post/1',
      method: 'POST',
      body: 'aaa',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.body.toString(), 'ok');
  server1.close();
  server2.close();
});

test('createHttpRequestHandler forward headers', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const routeMatchList1 = generateRouteMatchList({
    '/post/1': {
      onPre: (ctx) => {
        ctx.forward = {
          port: port2,
        };
      },
      post: () => {},
    },
    '/post/2': {
      post: (ctx) => {
        ctx.forward = {
          path: '/post2/1',
          port: port2,
        };
      },
    },
  });
  const routeMatchList2 = generateRouteMatchList({
    '/post/1': {
      post: async (ctx) => {
        assert.equal(ctx.request.body.toString(), 'aaa1');
        assert.deepEqual(
          ctx.request.headers,
          {
            name: 'quan1',
            host: `127.0.0.1:${port2}`,
            'content-length': 4,
          },
        );
        await waitFor(1000);
        ctx.response = {
          statusCode: 201,
          headers: {
            Server: 'quan',
          },
          body: 'ok1',
        };
      },
    },
    '/post2/1': {
      post: async (ctx) => {
        await waitFor(1000);
        ctx.response = {
          statusCode: 202,
          headers: {
            Server: 'quan2',
          },
          body: 'ok2',
        };
      },
    },
  });
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      ...createHttpRequestHandler({
        list: routeMatchList1,
      }),
    });
  });
  server1.listen(port1);
  const server2 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      ...createHttpRequestHandler({
        list: routeMatchList2,
      }),
    });
  });
  server2.listen(port2);
  await waitFor(100);
  let ret
  ret = await request(
    {
      path: '/post/1',
      method: 'POST',
      headers: {
        name: 'quan1',
      },
      body: 'aaa1',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.body.toString(), 'ok1');
  assert.equal(ret.statusCode, 201);
  ret = await request(
    {
      path: '/post/2',
      method: 'POST',
      headers: {
        name: 'quan2',
      },
      body: 'aaa2',
    },
    () => getSocketConnect({ port: port1 }),
  );
  assert.equal(ret.body.toString(), 'ok2');
  assert.equal(ret.statusCode, 202);
  server1.close();
  server2.close();
});
