import assert from 'node:assert';
import test from 'node:test';

import generateRequestForwardOptions from './generateRequestForwardOptions.mjs';

test('generateRequestForwardOptions', () => {
  let ret = generateRequestForwardOptions(
    {
      port: 801,
    },
    {
      method: 'PUT',
      path: '/quan',
      headers: {},
      headersRaw: ['nAme', 'quan'],
    },
  );
  assert.deepEqual(
    ret,
    {
      method: 'PUT',
      path: '/quan',
      headers: ['nAme', 'quan', 'Host', '127.0.0.1:801'],
    },
  );
  ret = generateRequestForwardOptions(
    {
      port: 801,
      path: '/big',
      method: 'GET',
    },
    {
      method: 'PUT',
      path: '/foo',
      headers: {},
      headersRaw: ['nAme', 'quan'],
    },
  );
  assert.deepEqual(
    ret,
    {
      method: 'GET',
      path: '/big',
      headers: ['nAme', 'quan', 'Host', '127.0.0.1:801'],
    },
  );

  ret = generateRequestForwardOptions(
    {
      port: 801,
      headers: {
        host: '192.168.100.111:443',
      },
    },
    {
      method: 'GET',
      path: '/foo',
      headers: {},
      headersRaw: ['Host', '127.0.0.1:3322'],
    },
  );
  assert.deepEqual(
    ret,
    {
      method: 'GET',
      path: '/foo',
      headers: ['host', '192.168.100.111:443'],
    },
  );

  ret = generateRequestForwardOptions(
    {
      port: 801,
      remoteAddress: '127.0.0.1:2233',
      headers: {
        Host: '192.168.100.111:443',
      },
    },
    {
      method: 'GET',
      path: '/foo',
      headers: {},
      headersRaw: ['Host', '127.0.0.1:3322'],
    },
  );
  assert.deepEqual(
    ret,
    {
      method: 'GET',
      path: '/foo',
      headers: ['Host', '192.168.100.111:443', 'X-Remote-Address', '127.0.0.1:2233'],
    },
  );

  ret = generateRequestForwardOptions(
    {
      port: 801,
      hostname: '192.168.100.66',
      remoteAddress: '127.0.0.1:2233',
    },
    {
      method: 'GET',
      path: '/foo',
      headers: {},
      headersRaw: ['Host', '127.0.0.1:3322'],
    },
  );
  assert.deepEqual(
    ret,
    {
      method: 'GET',
      path: '/foo',
      headers: ['Host', '192.168.100.66:801', 'X-Remote-Address', '127.0.0.1:2233'],
    },
  );

  ret = generateRequestForwardOptions(
    {
      port: 801,
    },
    {
      method: 'GET',
      path: '/foo',
      headers: {},
      headersRaw: ['Host', '192.168.100.111:3322'],
    },
  );
  assert.deepEqual(
    ret,
    {
      method: 'GET',
      path: '/foo',
      headers: ['Host', '127.0.0.1:801'],
    },
  );

  ret = generateRequestForwardOptions(
    {
      port: 801,
      remoteAddress: '192.168.100.66:992',
      headers: {
        'X-Remote-Address': '192.168.100.88:3333',
      },
    },
    {
      method: 'GET',
      path: '/foo',
      headers: {
        'X-Remote-Address': '192.168.100.55:3333',
      },
      headersRaw: ['Host', '192.168.100.111:3322'],
    },
  );
  assert.deepEqual(
    ret,
    {
      method: 'GET',
      path: '/foo',
      headers: ['Host', '127.0.0.1:801', 'X-Remote-Address', '192.168.100.66:992'],
    },
  );

  ret = generateRequestForwardOptions(
    {
      port: 801,
    },
  );

  assert.deepEqual(
    ret,
    { method: 'GET', path: '/', headers: ['Host', '127.0.0.1:801'] },
  );

  assert.throws(() => {
    generateRequestForwardOptions(
      {
        port: 0,
      },
      {
        method: 'GET',
        path: '/quan',
        headers: {},
        headersRaw: [],
      },
    );
  });
});
