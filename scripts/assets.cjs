'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [path.join(root, 'test/ui.cjs')], {
  cwd: root,
  env: { ...process.env,
    EZY_SCREENSHOT_OUT: path.join(root, 'docs/images/ezy-editor.png'),
    EZY_ICON_OUT: path.join(root, 'assets/ezy-icon.png')
  },
  stdio: 'inherit', windowsHide: true
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
