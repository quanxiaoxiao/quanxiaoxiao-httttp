import fs from 'node:fs';
import url from 'node:url';
import assert from 'node:assert';
import path from 'node:path';
import _ from 'lodash';
import Ajv from 'ajv';
import { getPathname } from '@quanxiaoxiao/node-utils';

const codeName = path.basename(url.fileURLToPath(import.meta.url), '.mjs');

const ajv = new Ajv();

const schema = {
  type: 'object',
  properties: {
    hostname: {
      type: 'string',
      minLength: 1,
    },
    protocol: {
      enum: ['http:', 'https:', null],
    },
    port: {
      type: 'integer',
      minimum: 1,
      maximum: 65535,
    },
  },
  required: ['hostname', 'port'],
};

const validate = ajv.compile(schema);

export default (state, str) => {
  assert(_.isPlainObject(state));

  if (!str) {
    return state;
  }

  const pairList = str.split(';');

  const hosts = {};

  for (let i = 0; i < pairList.length; i++) {
    const [name, resourcePath] = pairList[i].split(':');
    if (!resourcePath) {
      continue;
    }
    const pathname = getPathname(resourcePath.trim());
    if (!fs.existsSync(pathname)) {
      console.warn(`[${codeName}] \`${pathname}\` not found`);
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(pathname));
      const hostnames = Object.keys(data);
      hosts[name.trim()] = {};
      for (let j = 0; j < hostnames.length; j++) {
        const hostname = hostnames[j];
        const hostItem = data[hostname];
        if (!validate(hostItem)) {
          console.warn(`[${codeName}] \`${name.trim()}.${hostname}\` host invalid ${JSON.stringify(validate.errors)}`);
          continue;
        }
        hosts[name.trim()][hostname] = {
          hostname: hostItem.hostname,
          port: hostItem.port,
          protocol: hostItem.protocol || 'http:',
        };
      }
    } catch (error) {
      console.warn(`[${codeName}] \`${name.trim()}\` ${error.message}`);
    }
  }

  state.hosts = hosts;

  return state;
};
