'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createController } = require('../../host');

async function run() {
  const artifacts = path.resolve(__dirname, '../..', '.artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const resultFile = path.join(artifacts, 'vscode-integration-result.json');
  const checks = [];
  let controller;
  let extension;
  const clipboardBefore = await vscode.env.clipboard.readText();
  try {
    extension = vscode.extensions.getExtension('ezy-local.ezy-easy-yaml');
    assert.ok(extension, 'Extension registered');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('ezy.open') && commands.includes('ezy.openTemplate'));
    await vscode.commands.executeCommand('ezy.open');
    extension.exports.dispose();
    checks.push('installed extension activation and registered open command');

    const fixture = vscode.Uri.file(path.join(artifacts, 'extension-template.yml'));
    const config = vscode.Uri.file(path.join(artifacts, 'extension-config.yml'));
    const output = vscode.Uri.file(path.join(artifacts, 'extension-saved.yml'));
    await vscode.workspace.fs.writeFile(fixture, Buffer.from('app:\n  enabled: true\n  name: example\n'));
    await vscode.workspace.fs.writeFile(config, Buffer.from('app:\n  enabled: false\n'));
    let onMessage;
    let readyResolve;
    let loadedResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const loaded = new Promise(resolve => { loadedResolve = resolve; });
    let panels = 0;
    let reveals = 0;
    const responses = [];
    const hostVscode = { Uri: vscode.Uri, ViewColumn: vscode.ViewColumn, workspace: vscode.workspace, env: vscode.env, window: {
      showErrorMessage: (...args) => vscode.window.showErrorMessage(...args),
      showOpenDialog: async () => [config],
      showSaveDialog: async () => output,
      showWarningMessage: async () => undefined,
      createWebviewPanel(...args) {
        panels++;
        const real = vscode.window.createWebviewPanel(...args);
        const wrapped = { webview: {
          cspSource: real.webview.cspSource,
          asWebviewUri: uri => real.webview.asWebviewUri(uri),
          postMessage: async message => { responses.push(message); return real.webview.postMessage(message); },
          onDidReceiveMessage(callback) {
            onMessage = callback;
            return real.webview.onDidReceiveMessage(async message => {
              await callback(message);
              if (message.type === 'ready') readyResolve();
              if (message.type === 'templateLoaded') loadedResolve();
            });
          },
          set html(value) { real.webview.html = value; }
        },
        onDidDispose: callback => real.onDidDispose(callback),
        dispose: () => real.dispose(),
        reveal: () => { reveals++; real.reveal(); }
        };
        return wrapped;
      }
    } };
    const timeout = promise => Promise.race([promise, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Webview handshake timed out')), 20000); timer.unref();
    })]);
    controller = createController(hostVscode, { extensionUri: extension.extensionUri });
    controller.open(fixture);
    await timeout(ready); await timeout(loaded);
    checks.push('actual VS Code webview executes local scripts under CSP and loads context template');
    controller.open(); assert.equal(panels, 1); assert.equal(reveals, 1);
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    controller.open(); assert.equal(panels, 1);
    checks.push('single panel reused after editor/tab switch');
    const before = responses.length;
    await controller.open(config); assert.equal(responses.length, before);
    checks.push('template replacement cancellation preserves session');
    await onMessage({ type: 'openConfig', id: 900 });
    assert.match(responses.at(-1).data.text, /enabled: false/);
    await onMessage({ type: 'save', id: 901, filename: 'result.yml', text: 'app:\n  enabled: false\n' });
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(output)).toString(), 'app:\n  enabled: false\n');
    checks.push('VS Code filesystem read/import/save round trip');
    await onMessage({ type: 'copy', id: 902, text: 'app:\n  enabled: false\n' });
    assert.equal(await vscode.env.clipboard.readText(), 'app:\n  enabled: false\n');
    checks.push('native VS Code clipboard');
    controller.dispose();
    controller.open(); assert.equal(panels, 2);
    checks.push('closing starts a new session');
    fs.writeFileSync(resultFile, JSON.stringify({ passed: true, checks }, null, 2));
  } catch (error) {
    fs.writeFileSync(resultFile, JSON.stringify({ passed: false, checks, error: error.stack }, null, 2));
    throw error;
  } finally {
    controller?.dispose(); extension?.exports?.dispose();
    await vscode.env.clipboard.writeText(clipboardBefore);
  }
}
exports.run = run;
