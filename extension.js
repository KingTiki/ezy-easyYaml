'use strict';
const vscode = require('vscode');
const { createController } = require('./host');

function activate(context) {
  const controller = createController(vscode, context);
  context.subscriptions.push(controller,
    vscode.commands.registerCommand('ezy.open', () => controller.open()),
    vscode.commands.registerCommand('ezy.openTemplate', uri => controller.open(uri || vscode.window.activeTextEditor?.document.uri)));
  return controller;
}
exports.activate = activate;
