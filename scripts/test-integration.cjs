'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const extensionRoot = path.resolve(__dirname, '..');
const artifacts = path.join(extensionRoot, '.artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const report = path.join(artifacts, 'vscode-integration-result.json');
if (fs.existsSync(report)) fs.unlinkSync(report);
let executable = process.env.EZY_CODE;
if (!executable) {
  if (process.platform === 'win32') {
    try {
      const launcher = execFileSync('where.exe', ['code.cmd'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
      executable = path.resolve(path.dirname(launcher), '../Code.exe');
    } catch {
      executable = path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe');
    }
  } else executable = 'code';
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CHROME_CRASHPAD_PIPE_NAME;
for (const key of Object.keys(env)) if (key.startsWith('VSCODE_')) delete env[key];
const logPath = path.join(artifacts, 'vscode-integration-startup.log');
const log = fs.openSync(logPath, 'w');
const child = spawn(executable, [
  `--extensionDevelopmentPath=${extensionRoot}`,
  `--extensionTestsPath=${path.join(extensionRoot, 'test/integration')}`,
  `--user-data-dir=${path.join(artifacts, 'vscode-profile')}`,
  `--extensions-dir=${path.join(artifacts, 'vscode-extensions')}`,
  '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--disable-telemetry'
], { env, windowsHide: true, stdio: ['ignore', log, log] });
fs.closeSync(log);
const started = Date.now();
const timer = setInterval(() => {
  if (fs.existsSync(report)) {
    clearInterval(timer);
    const result = JSON.parse(fs.readFileSync(report, 'utf8'));
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
    child.unref();
  } else if (Date.now() - started > 60000) {
    clearInterval(timer);
    child.kill();
    console.error('VS Code integration test timed out. Startup log: ' + logPath); process.exitCode = 1;
  }
}, 500);
child.on('error', error => { clearInterval(timer); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => {
  if (!fs.existsSync(report)) {
    clearInterval(timer);
    console.error('VS Code exited before completing integration tests (' + code + '). Startup log: ' + logPath);
    process.exitCode = 1;
  }
});
