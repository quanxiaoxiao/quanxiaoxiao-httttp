This is a library for processing HTTP 1.1 packets. During the parsing process, it provides various hook functions such as `onHttpRequest`, `onHttpRequestStartLine`, etc., to facilitate more granular control over packets, output log tracing, and traffic statistics. It also supports the forwarding function of HTTP 1.1 packets. Through reverse proxy, more fine-grained traffic control can be achieved.

## Install

```shell
npm install @quanxiaoxiao/httttp
```

## Quick Start

```javascript
import net from 'node:net';
import { handleSocketHttp } from '@quanxiaoxiao/httttp';

const hooks = {
  onHttpRequest: () => {...},
  onHttpRequestEnd: (ctx) => {
    ctx.response = {
      headers: {
        server: 'quan',
        'content-length': 'text/plain',
      },
      body: 'ok',
    };
  },
};

const server = net.createServer(handleSocketHttp(hooks));

server.listen(3000);
```

## Hooks

- onHttpRequest
- onHttpRequestStartLine
- onHttpRequestHeader
- onHttpRequestConnection
- onHttpRequestEnd
- onForwardConnecting
- onForwardConnect
- onHttpResponseEnd
- onHttpError
- onChunkIncoming
- onChunkOutgoing
- onFinish
