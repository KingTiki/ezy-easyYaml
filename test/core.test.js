'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const yaml = require('yaml');
test('YAML core passes the processing suite', () => {
  const root = path.resolve(__dirname, '..');
  const context = vm.createContext({ console, YamlTestParser: yaml });
  const core = buildSync({ entryPoints: [path.join(root, 'media/yaml-core.js')], bundle: true, platform: 'browser', format: 'iife', write: false });
  vm.runInContext(core.outputFiles[0].text, context, { filename: 'yaml-core.bundle.js' });
  for (const file of ['test/fixtures/template.js', 'test/core-suite.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const results = context.YamlStudioTests.run(context.YAML_TEST_FIXTURE);
  assert.equal(results.failed, 0, JSON.stringify(results.results.filter(result => !result.passed)));
  console.log(`${results.passed} YAML checks passed`);
});
