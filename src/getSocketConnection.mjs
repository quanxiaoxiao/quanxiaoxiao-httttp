import net from 'node:net';
import assert from 'node:assert';
import tls from 'node:tls';

export default ({
  hostname,
  port,
  protocol,
  servername,
}) => {
  assert(port >= 0 && port <= 65535);
  if (protocol === 'https:') {
    const options = {
      host: hostname || '127.0.0.1',
      port,
      noDelay: true,
      rejectUnauthorized: true,
      secureContext: tls.createSecureContext({
        secureProtocol: 'TLSv1_2_method',
      }),
    };
    if (Array.isArray(process.env.TLS_PASS_AUTHORIZES)) {
      options.rejectUnauthorized = !process.env.TLS_PASS_AUTHORIZES(options.host);
    }
    if (servername) {
      options.servername = servername;
    }
    return tls.connect(options);
  }
  assert(protocol === 'http:');
  return net.connect({
    noDelay: true,
    host: hostname || '127.0.0.1',
    port,
  });
};
