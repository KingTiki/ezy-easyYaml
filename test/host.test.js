'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createController, validRequest, MAX_BYTES } = require('../host');

function setup() {
  const uri = value => ({ path: value, fsPath: value, toString() { return 'file://' + value; } });
  const sent = []; const writes = []; const errors = []; const panels = [];
  let receive;
  const state = { open: [uri('/workspace/template.yml')], save: uri('/workspace/result.yml'), confirm: 'Vorlage wechseln', text: 'a: true\n', size: 8 };
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
    ViewColumn: { Active: 1 },
    workspace: { workspaceFolders: [{ uri: uri('/workspace') }], fs: {
      stat: async () => ({ size: state.size }),
      readFile: async () => Buffer.from(state.text),
      writeFile: async (target, bytes) => { if (state.writeError) throw new Error('Read-only'); writes.push([target.path, bytes.toString()]); }
    } },
    env: { clipboard: { writeText: async text => { state.clipboard = text; } } },
    window: {
      showOpenDialog: async () => state.open,
      showSaveDialog: async options => { state.saveOptions = options; return state.save; },
      showWarningMessage: async () => { state.confirmations = (state.confirmations || 0) + 1; return state.confirm; },
      showErrorMessage: async error => errors.push(error),
      createWebviewPanel: (type, title, column, options) => {
        const panel = { options, reveals: 0, webview: {
          cspSource: 'vscode-resource:', asWebviewUri: value => value.toString(),
          postMessage: async message => { sent.push(message); },
          onDidReceiveMessage: callback => { receive = callback; }
        }, reveal() { this.reveals++; }, onDidDispose(callback) { this.onDispose = callback; }, dispose() { this.onDispose(); } };
        panels.push(panel); return panel;
      }
    }
  };
  const extensionPath = path.resolve(__dirname, '..').replace(/\\/g, '/');
  const controller = createController(vscode, { extensionUri: uri(extensionPath) });
  controller.open();
  return { controller, panels, sent, writes, errors, state, uri, send: message => receive(message) };
}

test('message validation rejects arbitrary paths, unknown commands and oversized data', () => {
  assert.equal(validRequest({ id: 1, type: 'save', filename: '../a.yml', text: 'a: 1' }), false);
  assert.equal(validRequest({ id: 1, type: 'delete' }), false);
  assert.equal(validRequest({ id: 1, type: 'copy', text: 'x'.repeat(MAX_BYTES + 1) }), false);
  assert.equal(validRequest({ id: 1, type: 'save', filename: 'config.yml', text: 'a: 1' }), true);
});
test('single retained panel, constrained resources, nonce CSP, new session on close', async () => {
  const x = setup(); x.controller.open();
  assert.equal(x.panels.length, 1); assert.equal(x.panels[0].reveals, 1);
  assert.equal(x.panels[0].options.retainContextWhenHidden, true);
  assert.equal(x.panels[0].options.localResourceRoots.length, 2);
  assert.match(x.panels[0].webview.html, /src="file:\/\/.*\/dist\/webview\.js"/);
  assert.match(x.panels[0].webview.html, /connect-src 'none'/);
  assert.match(x.panels[0].webview.html, /script nonce=/);
  x.controller.dispose(); x.controller.open(); assert.equal(x.panels.length, 2);
});
test('read, cancellation, replacement confirmation and size limits', async () => {
  const x = setup();
  await x.send({ id: 1, type: 'ready' });
  await x.send({ id: 2, type: 'openTemplate' }); assert.equal(x.sent.at(-1).data.text, 'a: true\n');
  await x.send({ type: 'templateLoaded' });
  x.state.confirm = undefined;
  await x.send({ id: 3, type: 'openTemplate' }); assert.equal(x.sent.at(-1).data, undefined); assert.equal(x.state.confirmations, 1);
  x.state.open = undefined;
  await x.send({ id: 4, type: 'openConfig' }); assert.equal(x.sent.at(-1).error, undefined);
  x.state.open = [x.uri('/workspace/a.yml')]; x.state.size = MAX_BYTES + 1;
  await x.send({ id: 5, type: 'openTemplate' }); assert.match(x.sent.at(-1).error, /5 MB/);
  x.state.size = 1; x.state.text = 'x'.repeat(MAX_BYTES + 1);
  await x.send({ id: 6, type: 'openConfig' }); assert.match(x.sent.at(-1).error, /5 MB/);
});
test('context template waits for ready and confirms replacement', async () => {
  const x = setup(); x.controller.dispose(); x.controller.open(x.uri('/workspace/a.yml'));
  await x.send({ id: 1, type: 'ready' }); assert.equal(x.sent.at(-1).type, 'template');
  await x.send({ type: 'templateLoaded' }); x.state.confirm = undefined;
  const count = x.sent.length;
  await x.controller.open(x.uri('/workspace/b.yml')); assert.equal(x.sent.length, count);
});
test('return to start clears replacement guard and remembered directory', async () => {
  const x = setup();
  x.state.open = [x.uri('/previous/template.yml')];
  await x.send({ id: 1, type: 'openTemplate' });
  await x.send({ type: 'templateLoaded' });
  await x.send({ id: 2, type: 'resetSession' });
  assert.equal(x.sent.at(-1).data.reset, true);
  x.state.confirm = undefined;
  await x.send({ id: 3, type: 'openTemplate' });
  assert.equal(x.sent.at(-1).data.name, 'template.yml');
  assert.equal(x.state.confirmations, undefined);
  await x.send({ id: 4, type: 'resetSession' });
  await x.send({ id: 5, type: 'save', filename: 'config.yml', text: 'a: 1' });
  assert.equal(x.state.saveOptions.defaultUri.path, '/workspace/config.yml');
});
test('save uses dialog target, handles cancellation and write failure; copy uses VS Code', async () => {
  const x = setup();
  await x.send({ id: 1, type: 'save', filename: 'config.yml', text: 'a: false\n' });
  assert.deepEqual(x.writes, [['/workspace/result.yml', 'a: false\n']]); assert.equal(x.sent.at(-1).data.saved, true);
  assert.equal(x.state.saveOptions.defaultUri.path, '/workspace/config.yml');
  x.state.save = undefined;
  await x.send({ id: 2, type: 'save', filename: 'config.yml', text: 'a: 1' }); assert.equal(x.writes.length, 1);
  x.state.save = x.uri('/workspace/result.yml'); x.state.writeError = true;
  await x.send({ id: 3, type: 'save', filename: 'config.yml', text: 'a: 1' }); assert.equal(x.sent.at(-1).error, 'Read-only'); assert.equal(x.sent.at(-1).data, undefined);
  await x.send({ id: 4, type: 'copy', text: 'a: false' }); assert.equal(x.state.clipboard, 'a: false');
});
