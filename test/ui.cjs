// Verify the extension webview with a mocked VS Code bridge in headless Chrome.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const extensionRoot = process.env.EZY_EXTENSION_ROOT || root;
const { renderHtml } = require(path.join(extensionRoot, 'host'));
const artifacts = path.join(root, '.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const uri = fsPath => ({ fsPath, toString: () => pathToFileURL(fsPath).href });
fs.writeFileSync(path.join(artifacts, 'webview.html'), renderHtml({
  cspSource: 'file:', asWebviewUri: value => value.toString()
}, uri(extensionRoot), { Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) } }));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-studio-chrome-'));
const downloads = fs.mkdtempSync(path.join(artifacts, 'downloads-'));
const chrome = spawn(process.env.EZY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--in-process-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--window-size=1440,1100', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [];
let socket;
let id = 0;
const pending = new Map();
const exceptions = [];
const checks = [];
function assert(value, message) { if (!value) throw new Error(message); }
function check(name, condition) { assert(condition, name); checks.push(name); console.log('PASS ' + name); }
async function until(action, description) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await action()) return; await delay(60); }
  throw new Error('Timeout: ' + description);
}
function command(method, params = {}) {
  const callId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(callId); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(callId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression: '(() => eval(' + JSON.stringify(expression) + '))()', returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function navigate(file) {
  await command('Page.navigate', { url: new URL('file:///' + root.replace(/\\/g, '/') + '/' + file).href });
  await until(() => evaluate('document.readyState === "complete"'), 'page load');
}
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(artifacts, name), Buffer.from(result.data, 'base64'));
}
async function fileInput(file, selector = '#file-input') {
  const document = await command('DOM.getDocument');
  const node = await command('DOM.querySelector', { nodeId: document.root.nodeId, selector });
  await command('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [file] });
}
const setSearch = value => evaluate(`document.getElementById('search').value=${JSON.stringify(value)};document.getElementById('search').dispatchEvent(new Event('input',{bubbles:true}));`);
const select = value => evaluate(`document.querySelector('input[data-select-id][aria-label='+${JSON.stringify(JSON.stringify(value + ' für Export auswählen'))}+']').click();`);
async function main() {
  await until(() => fs.existsSync(path.join(profile, 'DevToolsActivePort')), 'Chrome startup');
  const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.id && pending.has(message.id)) {
      const call = pending.get(message.id); pending.delete(message.id); clearTimeout(call.timer);
      if (message.error) call.reject(new Error(JSON.stringify(message.error))); else call.resolve(message.result);
    }
  });
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Network.enable');
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });


  await command('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.testRequests=[]; globalThis.fileResponse=null; globalThis.saveError=null; globalThis.cancelSave=false;
    globalThis.acquireVsCodeApi=()=>({postMessage(message){
      testRequests.push(message);
      if(message.type==='templateLoaded') return;
      const data = message.type==='openTemplate'||message.type==='openConfig' ? fileResponse : message.type==='save' ? (cancelSave ? undefined : {saved:true,name:message.filename}) : message.type==='copy' ? {copied:true} : message.type==='resetSession' ? {reset:true} : {ready:true};
      const error=message.type==='save' ? saveError : undefined;
      setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'response',id:message.id,data,error}})),0);
    }});` });
  await navigate('.artifacts/webview.html');
  const file = text => JSON.stringify({name:'template.yml',size:Buffer.byteLength(text),text});
  await evaluate('fileResponse='+file('# General help\napp:\n  # hint: <b>literal help</b>\n  #\n  #   indented example\n  # enabled: false\n  enabled: true\n  name: example\n  list:\n    - first\n')+';document.getElementById("load-template").click()');
  await until(()=>evaluate('document.body.classList.contains("has-template")'),'template');
  check('Template acknowledged',await evaluate('testRequests.some(x=>x.type==="templateLoaded")'));
  check('Comments render as formatted plain help without extra fields or value pickers',await evaluate('document.querySelector(".field-hint").textContent==="hint: <b>literal help</b>\\n\\n  indented example\\nenabled: false"&&getComputedStyle(document.querySelector(".field-hint")).whiteSpace==="pre-wrap"&&!document.querySelector(".field-hint b")&&document.querySelectorAll(".field").length===3&&!document.querySelector(".alternative-select")&&document.querySelector(".group-hint").textContent==="General help"'));
  await evaluate('document.querySelector(".field input[data-select-id]").click();document.querySelector("[data-selection-filter=selected]").click()');
  check('Selected filter',await evaluate('Array.from(document.querySelectorAll(".field")).filter(x=>!x.hidden&&!x.parentElement.closest("[hidden]")).length===1'));
  await evaluate('document.querySelector("[data-selection-filter=unselected]").click()');
  await setSearch('enabled');
  check('Search and filter combine',await evaluate('!document.getElementById("no-results").hidden'));
  await setSearch('');
  await evaluate('fileResponse=null;document.getElementById("load-template").click()');
  await delay(50);
  check('Cancelled load preserves template',await evaluate('document.getElementById("source-name").textContent==="template.yml"'));
  await evaluate('fileResponse='+file('a: [')+';document.getElementById("load-template").click()');
  await until(()=>evaluate('!document.getElementById("message").hidden'),'invalid');
  check('Invalid template preserves fields',await evaluate('document.querySelectorAll(".field").length===3'));
  await evaluate('fileResponse='+file('app:\n  enabled: false\n  list:\n    - imported\n')+';document.getElementById("import-export").click()');
  await until(()=>evaluate('document.getElementById("preview").textContent.includes("imported")'),'import');
  check('Import preserves false and list',await evaluate('document.getElementById("preview").textContent.includes("false")'));
  await evaluate('document.querySelector("[data-selection-filter=all]").click();document.getElementById("download").click()');
  await until(()=>evaluate('document.getElementById("toast").textContent.includes("gespeichert")'),'save');
  check('Save sends generated YAML and filename',await evaluate('testRequests.filter(x=>x.type==="save").at(-1).text===document.getElementById("preview").textContent&&testRequests.filter(x=>x.type==="save").at(-1).filename==="template.yml"'));
  await evaluate('document.getElementById("toast").textContent="";cancelSave=true;document.getElementById("download").click()');
  await delay(50);
  check('Cancelled save has no success toast',await evaluate('document.getElementById("toast").textContent===""'));
  await evaluate('cancelSave=false;saveError="Read-only";document.getElementById("download").click()');
  await until(()=>evaluate('document.getElementById("message").textContent==="Read-only"'),'write error');
  check('Write failure has no success toast',await evaluate('document.getElementById("toast").textContent===""'));
  await evaluate('document.getElementById("copy").click()');
  await until(()=>evaluate('testRequests.some(x=>x.type==="copy")'),'copy');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
  check('Narrow view without horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await screenshot('extension-mobile.png');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await screenshot('extension-desktop.png');
  await evaluate('document.getElementById("start-over").click()');
  await until(()=>evaluate('!document.body.classList.contains("has-template")'),'return to start');
  check('Start resets template, fields, preview and filename',await evaluate('document.getElementById("workspace").hidden&&!document.getElementById("drop-zone").hidden&&!document.querySelector("[data-node-id]")&&document.getElementById("filename").value==="config.yml"&&document.getElementById("download").disabled&&document.getElementById("import-name").textContent===""'));
  await evaluate('fileResponse='+file('fresh: true\n')+';document.getElementById("load-template-start").click()');
  await until(()=>evaluate('document.body.classList.contains("has-template")'),'fresh template');
  check('New template after reset starts without import or filters',await evaluate('document.getElementById("selection-count").textContent==="0 ausgewählt"&&document.querySelector("[data-selection-filter=all]").getAttribute("aria-pressed")==="true"&&document.getElementById("filename").value==="config.yml"'));
  await evaluate('fileResponse='+file('{} # document help\n')+';document.getElementById("load-template").click()');
  await until(()=>evaluate('document.getElementById("fields").textContent.includes("document help")'),'document help');
  check('Comments without a field remain visible',await evaluate('!document.querySelector("[data-node-id]")&&document.getElementById("fields").textContent.includes("document help")'));
  await evaluate('window.dispatchEvent(new MessageEvent("message",{data:{type:"template",file:'+file('fromContext: true\n')+'}}))');
  await until(()=>evaluate('document.querySelector(".field-key")?.textContent==="fromContext"'),'context template');
  check('Context-menu template message loads a new template',await evaluate('document.querySelectorAll(".field").length===1&&document.getElementById("selection-count").textContent==="0 ausgewählt"&&testRequests.at(-1).type==="templateLoaded"'));
  check('No browser exceptions',exceptions.length===0);
  fs.writeFileSync(path.join(artifacts,'extension-ui-result.json'),JSON.stringify({passed:true,checks},null,2));
  console.log('PASS '+checks.length+' extension UI checks');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  if(socket&&socket.readyState===WebSocket.OPEN){try{await command('Browser.close');}catch(_){} socket.close();}
  chrome.kill();
});
