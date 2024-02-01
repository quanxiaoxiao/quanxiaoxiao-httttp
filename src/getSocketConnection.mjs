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
      rejectUnauthorized: !(process.env.HTTPS_REJECT_UNAUTHRIZED === 'false'),
      secureContext: tls.createSecureContext({
        secureProtocol: 'TLSv1_2_method',
      }),
    };
    if (servername) {
      options.servername = servername;
    }
    return tls.connect(options);
  }
  assert(protocol === 'http:');
  return net.connect({
    host: hostname || '127.0.0.1',
    port,
  });
};
