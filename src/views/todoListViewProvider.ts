import * as vscode from 'vscode';
import { TodoSyncService } from '../services/todoSyncService';

export class TodoListViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'gitNote.todoListView';

  private readonly disposables: vscode.Disposable[] = [];
  private view?: vscode.WebviewView;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly syncService: TodoSyncService,
  ) {
    this.disposables.push(
      this.syncService.onDidChangeTodos(() => this.postState()),
      this.syncService.onDidChangeStatus(() => this.postState()),
      this.syncService.onDidChangeBucket(() => this.postState()),
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });

    this.postState();
  }

  public dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async handleMessage(message: { type?: string; payload?: any }): Promise<void> {
    if (message.type === 'ready') {
      this.postState();
      return;
    }

    if (message.type === 'toggleTodo') {
      await this.run(() => this.syncService.toggleTodo(message.payload.id, !!message.payload.completed));
      return;
    }

    if (message.type === 'deleteTodo') {
      const todo = this.syncService.getTodos().find((item) => item.id === message.payload?.id);
      const answer = await vscode.window.showWarningMessage(
        todo ? `"${todo.text}" silinsin mi?` : 'Todo silinsin mi?',
        { modal: true },
        'Sil',
      );

      if (answer !== 'Sil') {
        return;
      }

      await this.run(() => this.syncService.deleteTodo(message.payload.id));
      return;
    }

    if (message.type === 'editTodo') {
      const todo = this.syncService.getTodos().find((item) => item.id === message.payload?.id);

      if (!todo) {
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: 'Todo metnini güncelle',
        value: todo.text,
        ignoreFocusOut: true,
      });

      if (!text) {
        return;
      }

      await this.run(() => this.syncService.updateTodoText(todo.id, text));
      return;
    }

    if (message.type === 'openProjects') {
      await vscode.commands.executeCommand('gitNote.openProjects');
    }
  }

  private async run(action: () => Thenable<void> | Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bir hata oluştu';
      void vscode.window.showErrorMessage(message);
      this.postMessage({ type: 'error', payload: { message } });
    }
  }

  private postState(): void {
    this.postMessage({
      type: 'hydrate',
      payload: {
        todos: this.syncService.getTodos(),
        status: this.syncService.getStatus(),
        currentBucket: this.syncService.getCurrentBucket(),
        hasBucket: Boolean(this.syncService.getCurrentBucket()),
      },
    });
  }

  private postMessage(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css'));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'codicons', 'codicon.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'));

    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${codiconUri}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Todo Listesi</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function createNonce(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
