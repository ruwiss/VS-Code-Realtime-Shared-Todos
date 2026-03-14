import * as vscode from 'vscode';
import { GitNoteConfig } from './models';
import { resolveDeviceName } from './utils/deviceName';

export function getConfig(): GitNoteConfig {
  const config = vscode.workspace.getConfiguration('gitNote');

  return {
    deviceName: resolveDeviceName(),
    soundEnabled: config.get<boolean>('notifications.soundEnabled', true),
    notifyOnOwnChanges: config.get<boolean>('notifications.notifyOnOwnChanges', false),
  };
}
