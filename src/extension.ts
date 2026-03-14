import * as vscode from 'vscode';
import { AppStorage } from './services/appStorage';
import { TodoSyncService } from './services/todoSyncService';
import { SidebarViewProvider } from './views/sidebarViewProvider';
import { TodoListViewProvider } from './views/todoListViewProvider';

interface TodoItemLike {
  todo: {
    id: string;
    text: string;
    completed: boolean;
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storage = new AppStorage(context.workspaceState);
  const soundsDirectory = vscode.Uri.joinPath(context.extensionUri, 'media', 'sounds').fsPath;
  const syncService = new TodoSyncService(storage, soundsDirectory);
  const sidebarProvider = new SidebarViewProvider(syncService);
  const todoListProvider = new TodoListViewProvider(context.extensionUri, syncService);

  context.subscriptions.push(syncService, sidebarProvider, todoListProvider);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      SidebarViewProvider.viewType,
      sidebarProvider,
    ),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TodoListViewProvider.viewType,
      todoListProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitNote.addTodo', async () => {
      if (!ensureBucketSelected(syncService)) {
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: `Yeni todo notunu yaz (${syncService.getCurrentBucket()})`,
        placeHolder: 'Örn: Firebase kurallarını güncelle',
        ignoreFocusOut: true,
      });

      if (!text) {
        return;
      }

      await runCommand(() => syncService.addTodo(text));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitNote.refreshTodos', async () => {
      await runCommand(() => syncService.restart());
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitNote.openProjects', async () => {
      await openProjects(syncService);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitNote.createBucket', async () => {
      await createBucket(syncService);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitNote.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'gitNote.notifications');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitNote.toggleTodoItem', async (item?: TodoItemLike) => {
      if (!item) {
        return;
      }

      await runCommand(() => syncService.toggleTodo(item.todo.id, !item.todo.completed));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitNote.editTodoItem', async (item?: TodoItemLike) => {
      if (!item) {
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: 'Todo metnini güncelle',
        value: item.todo.text,
        ignoreFocusOut: true,
      });

      if (!text) {
        return;
      }

      await runCommand(() => syncService.updateTodoText(item.todo.id, text));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitNote.deleteTodoItem', async (item?: TodoItemLike) => {
      if (!item) {
        return;
      }

      const answer = await vscode.window.showWarningMessage(
        `"${item.todo.text}" silinsin mi?`,
        { modal: true },
        'Sil',
      );

      if (answer !== 'Sil') {
        return;
      }

      await runCommand(() => syncService.deleteTodo(item.todo.id));
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('gitNote.notifications')) {
        return;
      }

      await syncService.restart();
    }),
  );

  await syncService.start();
}

export function deactivate(): void {}

async function openProjects(syncService: TodoSyncService): Promise<void> {
  try {
    const buckets = await syncService.listBuckets();
    const currentBucket = syncService.getCurrentBucket();
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: '$(add) Yeni proje oluştur',
          description: 'Yeni bucket oluştur ve aç',
          action: 'create' as const,
        },
        ...buckets.map((bucket) => ({
          label: `$(folder) ${bucket.id}`,
          description: bucket.id === currentBucket ? 'Aktif proje' : '',
          detail: `${bucket.todoCount} todo`,
          action: 'select' as const,
          bucketId: bucket.id,
        })),
      ],
      {
        title: 'Projeler',
        matchOnDetail: true,
        ignoreFocusOut: true,
        placeHolder: 'Bir proje seç veya yeni proje oluştur',
      },
    );

    if (!pick) {
      return;
    }

    if (pick.action === 'create') {
      await createBucket(syncService);
      return;
    }

    await syncService.selectBucket(pick.bucketId);
  } catch (error) {
    showError(error);
  }
}

async function createBucket(syncService: TodoSyncService): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'Yeni proje adı',
    placeHolder: 'Örn: ortak-notlar',
    ignoreFocusOut: true,
  });

  if (!name) {
    return;
  }

  await runCommand(async () => {
    await syncService.createBucket(name);
  });
}

function ensureBucketSelected(syncService: TodoSyncService): boolean {
  if (syncService.getCurrentBucket()) {
    return true;
  }

  void vscode.window.showInformationMessage(
    'Önce bir proje seç veya oluştur.',
    'Projeleri Aç',
  ).then((answer) => {
    if (answer === 'Projeleri Aç') {
      void vscode.commands.executeCommand('gitNote.openProjects');
    }
  });

  return false;
}

async function runCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    showError(error);
  }
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Bir hata oluştu';
  void vscode.window.showErrorMessage(message);
}
