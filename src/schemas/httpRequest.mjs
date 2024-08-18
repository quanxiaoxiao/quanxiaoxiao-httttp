import Ajv from 'ajv';

const ajv = new Ajv();

const validate = ajv.compile({
  type: 'object',
  properties: {
    path: {
      type: 'string',
    },
    headers: {
      type: 'object',
    },
    headersRaw: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    method: {
      type: 'string',
    },
  },
  required: [
    'path',
    'method',
    'headersRaw',
  ],
});

export default validate;

