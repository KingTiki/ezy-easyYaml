'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 5 * 1024 * 1024;
const yamlFilters = { YAML: ['yml', 'yaml'] };

function renderHtml(webview, extensionUri, vscode) {
  const media = vscode.Uri.joinPath(extensionUri, 'media');
  const nonce = crypto.randomBytes(24).toString('base64');
  let html = fs.readFileSync(path.join(extensionUri.fsPath, 'media', 'index.html'), 'utf8');
  html = html.replace(/(src|href)="(styles\.css|\.\.\/dist\/webview\.js)"/g,
    (_, attribute, asset) => `${attribute}="${webview.asWebviewUri(vscode.Uri.joinPath(media, asset))}"`);
  html = html.replace(/<script /g, `<script nonce="${nonce}" `);
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource}; connect-src 'none';`;
  return html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`);
}

function validRequest(message) {
  if (!message || typeof message !== 'object' || !Number.isSafeInteger(message.id) || message.id < 1) return false;
  if (!['ready', 'openTemplate', 'openConfig', 'save', 'copy', 'resetSession'].includes(message.type)) return false;
  if (message.type === 'save' || message.type === 'copy') {
    if (typeof message.text !== 'string' || !message.text || Buffer.byteLength(message.text) > MAX_BYTES) return false;
  }
  if (message.type === 'save') {
    if (typeof message.filename !== 'string' || message.filename.length > 255 || !/\.ya?ml$/i.test(message.filename) || /[<>:"/\\|?*\x00-\x1f]/.test(message.filename)) return false;
  }
  return true;
}

function createController(vscode, context) {
  let panel;
  let ready = false;
  let loaded = false;
  let queuedUri;
  let lastDirectory;
  let operations = Promise.resolve();
  const enqueue = action => {
    const result = operations.then(action);
    operations = result.catch(() => {});
    return result;
  };
  const reply = (target, id, data, error) => target.webview.postMessage({ type: 'response', id, data, error });

  async function readYaml(uri) {
    if (!/\.ya?ml$/i.test(uri.path)) throw new Error('Bitte eine .yml- oder .yaml-Datei wählen.');
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_BYTES) throw new Error('Die Datei darf höchstens 5 MB groß sein.');
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_BYTES) throw new Error('Die Datei darf höchstens 5 MB groß sein.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { name: path.posix.basename(uri.path), size: bytes.byteLength, text };
  }

  async function confirmReplace() {
    return !loaded || await vscode.window.showWarningMessage('Neue Vorlage laden? Der aktuelle EZY-Arbeitsstand wird verworfen.', { modal: true }, 'Vorlage wechseln') === 'Vorlage wechseln';
  }

  async function chooseFile() {
    const uris = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, filters: yamlFilters });
    return uris?.[0];
  }

  async function openUri(uri, target) {
    try {
      const file = await readYaml(uri);
      if (panel !== target || !(await confirmReplace()) || panel !== target) return;
      lastDirectory = vscode.Uri.joinPath(uri, '..');
      await target.webview.postMessage({ type: 'template', file });
    } catch (error) { await vscode.window.showErrorMessage('EZY: ' + error.message); }
  }

  async function handle(message, target) {
    if (target !== panel) return;
    // Acknowledgement is only session metadata, never a filesystem instruction.
    if (message?.type === 'templateLoaded') { loaded = true; return; }
    if (!validRequest(message)) {
      if (Number.isSafeInteger(message?.id)) await reply(target, message.id, undefined, 'Ungültige EZY-Anfrage.');
      return;
    }
    try {
      let data;
      if (message.type === 'ready') {
        ready = true;
        data = { ready: true };
      } else if (message.type === 'resetSession') {
        loaded = false;
        queuedUri = undefined;
        lastDirectory = undefined;
        data = { reset: true };
      } else if (message.type === 'openTemplate' || message.type === 'openConfig') {
        const uri = await chooseFile();
        if (panel !== target) return;
        if (uri) {
          const file = await readYaml(uri);
          if (message.type !== 'openTemplate' || await confirmReplace()) {
            if (panel !== target) return;
            lastDirectory = vscode.Uri.joinPath(uri, '..');
            data = file;
          }
        }
      } else if (message.type === 'save') {
        const directory = lastDirectory || vscode.workspace.workspaceFolders?.[0]?.uri;
        const uri = await vscode.window.showSaveDialog({
          defaultUri: directory ? vscode.Uri.joinPath(directory, message.filename) : vscode.Uri.file(path.join(require('node:os').homedir(), message.filename)),
          filters: yamlFilters, saveLabel: 'YAML speichern'
        });
        if (panel !== target) return;
        if (uri) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(message.text, 'utf8'));
          lastDirectory = vscode.Uri.joinPath(uri, '..');
          data = { saved: true, name: path.posix.basename(uri.path) };
        }
      } else if (message.type === 'copy') {
        await vscode.env.clipboard.writeText(message.text);
        data = { copied: true };
      }
      if (panel !== target) return;
      await reply(target, message.id, data);
      if (message.type === 'ready' && queuedUri) {
        const uri = queuedUri; queuedUri = undefined;
        await openUri(uri, target);
      }
    } catch (error) { if (panel === target) await reply(target, message.id, undefined, error.message); }
  }

  function open(uri) {
    if (!panel) {
      ready = false; loaded = false; queuedUri = uri;
      const target = vscode.window.createWebviewPanel('ezy.configurator', 'EZY – Easy YAML', vscode.ViewColumn.Active, {
        enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media'), vscode.Uri.joinPath(context.extensionUri, 'dist')]
      });
      panel = target;
      target.onDidDispose(() => { if (panel === target) { panel = undefined; ready = false; loaded = false; queuedUri = undefined; lastDirectory = undefined; } });
      target.webview.onDidReceiveMessage(message => enqueue(() => handle(message, target)));
      target.webview.html = renderHtml(target.webview, context.extensionUri, vscode);
    } else {
      panel.reveal();
      if (uri) {
        if (!ready) queuedUri = uri;
        else { const target = panel; return enqueue(() => openUri(uri, target)); }
      }
    }
  }
  return { open, dispose() { panel?.dispose(); } };
}
module.exports = { createController, renderHtml, validRequest, MAX_BYTES };
