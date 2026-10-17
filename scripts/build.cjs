'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
buildSync({
  entryPoints: [path.join(root, 'media/webview.js')],
  outfile: path.join(root, 'dist/webview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome114',
  minify: true,
  legalComments: 'eof'
});
const yamlRoot = path.dirname(require.resolve('yaml/package.json'));
const metadata = require('yaml/package.json');
fs.writeFileSync(path.join(root, 'dist/THIRD_PARTY_LICENSES.txt'),
  `yaml ${metadata.version} (${metadata.license})\n${metadata.homepage}\n\n` +
  fs.readFileSync(path.join(yamlRoot, 'LICENSE'), 'utf8'));
console.log('Built dist/webview.js and dependency license notices.');
