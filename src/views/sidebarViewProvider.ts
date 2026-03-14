import * as vscode from 'vscode';
import { LastActivity } from '../models';
import { TodoSyncService } from '../services/todoSyncService';

type SidebarNode = ProjectTreeItem | StatusTreeItem | LastActivityTreeItem | HintTreeItem;

export class SidebarViewProvider
  implements vscode.TreeDataProvider<SidebarNode>, vscode.Disposable
{
  public static readonly viewType = 'gitNote.sidebarView';

  private readonly emitter = new vscode.EventEmitter<SidebarNode | undefined>();
  private readonly disposables: vscode.Disposable[] = [this.emitter];

  public readonly onDidChangeTreeData = this.emitter.event;

  public constructor(private readonly syncService: TodoSyncService) {
    this.disposables.push(
      this.syncService.onDidChangeTodos(() => this.refresh()),
      this.syncService.onDidChangeStatus(() => this.refresh()),
      this.syncService.onDidChangeBucket(() => this.refresh()),
    );
  }

  public getTreeItem(element: SidebarNode): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: SidebarNode): SidebarNode[] {
    if (element) {
      return [];
    }

    const status = this.syncService.getStatus();
    const currentBucket = this.syncService.getCurrentBucket();
    const items: SidebarNode[] = [
      new ProjectTreeItem(currentBucket),
      new StatusTreeItem(status.state, status.message),
      new LastActivityTreeItem(this.syncService.getLastActivity()),
    ];

    if (status.state === 'needsBucket') {
      items.push(
        new HintTreeItem(
          'Henüz proje yok',
          'Projeleri aç',
          'gitNote.openProjects',
          'folder-library',
          'projectHint',
        ),
      );
    }

    return items;
  }

  public refresh(): void {
    this.emitter.fire(undefined);
  }

  public dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}

class ProjectTreeItem extends vscode.TreeItem {
  public constructor(currentBucket: string) {
    super('Projeler', vscode.TreeItemCollapsibleState.None);
    this.id = 'git-note-projects';
    this.description = currentBucket || 'Seçilmedi';
    this.tooltip = currentBucket
      ? `Aktif proje: ${currentBucket}`
      : 'Aktif proje seçilmedi';
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.contextValue = 'projects';
    this.command = { command: 'gitNote.openProjects', title: 'Projeleri Aç' };
  }
}

class StatusTreeItem extends vscode.TreeItem {
  public constructor(state: string, message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.id = 'git-note-status';
    this.description = statusLabel(state);
    this.tooltip = `Durum: ${message}`;
    this.iconPath = new vscode.ThemeIcon(statusIcon(state), statusColor(state));
    this.contextValue = 'status';
  }
}

class LastActivityTreeItem extends vscode.TreeItem {
  public constructor(activity?: LastActivity) {
    super('Son aktivite', vscode.TreeItemCollapsibleState.None);
    this.id = 'git-note-last-activity';
    this.contextValue = 'activity';
    this.iconPath = new vscode.ThemeIcon('history');

    if (!activity) {
      this.description = 'Henüz yok';
      this.tooltip = 'Henüz aktivite kaydı yok.';
      return;
    }

    this.description = `${activity.deviceName} · ${formatTimestamp(activity.timestamp)}`;
    this.tooltip = [
      `Cihaz: ${activity.deviceName}`,
      `İşlem: ${activityLabel(activity.type)}`,
      `Todo: ${activity.todoText}`,
      `Tarih: ${formatTimestamp(activity.timestamp)}`,
    ].join('\n');
  }
}

class HintTreeItem extends vscode.TreeItem {
  public constructor(
    label: string,
    description: string,
    commandId: string,
    iconName: string,
    contextValue: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `hint-${label}`;
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(iconName);
    this.contextValue = contextValue;
    this.command = { command: commandId, title: label };
  }
}

function statusLabel(state: string): string {
  const labels: Record<string, string> = {
    idle: 'Hazır',
    needsBucket: 'Proje',
    connecting: 'Bağlanıyor',
    connected: 'Canlı',
    reconnecting: 'Tekrar',
    error: 'Hata',
  };

  return labels[state] ?? 'Durum';
}

function statusIcon(state: string): string {
  const icons: Record<string, string> = {
    idle: 'circle-large-outline',
    needsBucket: 'folder-library',
    connecting: 'sync~spin',
    connected: 'plug',
    reconnecting: 'sync~spin',
    error: 'warning',
  };

  return icons[state] ?? 'circle-large-outline';
}

function statusColor(state: string): vscode.ThemeColor | undefined {
  if (state === 'connected') {
    return new vscode.ThemeColor('testing.iconPassed');
  }

  if (state === 'error') {
    return new vscode.ThemeColor('problemsErrorIcon.foreground');
  }

  return undefined;
}

function activityLabel(type: string): string {
  const labels: Record<string, string> = {
    added: 'eklendi',
    removed: 'silindi',
    completed: 'tamamlandı',
    reopened: 'yeniden açıldı',
    updated: 'güncellendi',
  };

  return labels[type] ?? 'güncellendi';
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
