import assert from 'node:assert';
import test from 'node:test';
import parseHtml from './parseHtml.mjs';

test('parseHtml 1', () => {
  const ret = parseHtml('<html');
  assert.equal(ret, null);
});

test('parseHtml 2', () => {
  const ret = parseHtml(`
  <html>
    <head>
    </head>
    <body>
      <div>
      asdf
      </div>
    </body>
  </html>
  `);
  assert.deepEqual(ret.documentAttributeList, []);
});

test('parseHtml 3', () => {
  const ret = parseHtml(`
  <!DOCTYPE html>
  <html
    lang="en"
  >
    <head>
    </head>
    <body>
      <div>
      asdf
      </div>
    </body>
  </html>
  `);
  assert.equal(ret.documentAttributeList[0].name, 'lang');
  assert.equal(ret.documentAttributeList[0].value, 'en');
});
