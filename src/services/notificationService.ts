import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { TodoChange, TodoChangeType } from '../models';

const SOUND_FILES: Record<TodoChangeType, string> = {
  added: 'gorev-eklendi.mp3',
  removed: 'gorev-silindi.mp3',
  completed: 'gorev-yapildi.mp3',
  reopened: 'gorev-duzenlendi.mp3',
  updated: 'gorev-duzenlendi.mp3',
};

export class NotificationService {
  public constructor(private readonly soundsDirectory: string) {}

  public async notify(changes: TodoChange[], soundEnabled: boolean): Promise<void> {
    if (!changes.length) {
      return;
    }

    if (soundEnabled) {
      this.playSound(changes[0].type);
    }

    const message = formatMessage(changes);
    void vscode.window.showInformationMessage(message);
  }

  private playSound(type: TodoChangeType): void {
    const filePath = path.join(this.soundsDirectory, SOUND_FILES[type]);
    const platform = process.platform;

    if (platform === 'darwin') {
      runBackground('afplay', [filePath]);
      return;
    }

    if (platform === 'win32') {
      runBackground('powershell', [
        '-c',
        `(New-Object Media.SoundPlayer '${escapePowerShell(filePath)}').PlaySync()`,
      ]);
      return;
    }

    if (runBackground('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath])) {
      return;
    }

    runBackground('sh', ['-c', 'printf "\\a"']);
  }
}

function formatMessage(changes: TodoChange[]): string {
  if (changes.length === 1) {
    return formatSingle(changes[0]);
  }

  const added = count(changes, 'added');
  const removed = count(changes, 'removed');
  const completed = count(changes, 'completed');
  const reopened = count(changes, 'reopened');
  const updated = count(changes, 'updated');
  const parts = [
    added && `${added} eklendi`,
    removed && `${removed} silindi`,
    completed && `${completed} tamamlandı`,
    reopened && `${reopened} tekrar açıldı`,
    updated && `${updated} güncellendi`,
  ].filter(Boolean);

  return `Git Note güncellendi: ${parts.join(', ')}`;
}

function formatSingle(change: TodoChange): string {
  const todo = change.after ?? change.before;
  const text = todo?.text ?? 'Todo';

  if (change.type === 'added') {
    return `${change.after?.author ?? 'Birisi'} yeni todo ekledi: ${text}`;
  }

  if (change.type === 'removed') {
    return `Todo silindi: ${text}`;
  }

  if (change.type === 'completed') {
    return `${change.after?.updatedBy ?? 'Birisi'} todo tamamladı: ${text}`;
  }

  if (change.type === 'updated') {
    return `${change.after?.updatedBy ?? 'Birisi'} todo güncelledi: ${text}`;
  }

  return `${change.after?.updatedBy ?? 'Birisi'} todo tekrar açtı: ${text}`;
}

function count(changes: TodoChange[], type: TodoChange['type']): number {
  return changes.filter((change) => change.type === type).length;
}

function runBackground(command: string, args: string[]): boolean {
  try {
    const child = spawn(command, args, {
      detached: false,
      stdio: 'ignore',
    });

    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function escapeShell(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function escapePowerShell(value: string): string {
  return value.replaceAll("'", "''");
}
