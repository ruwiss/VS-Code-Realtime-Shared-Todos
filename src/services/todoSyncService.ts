import * as vscode from 'vscode';
import { BUCKETS_ROOT_PATH, DATABASE_URL } from '../constants';
import { getConfig } from '../config';
import {
  BucketSummary,
  ConnectionStatus,
  FirebaseStreamEvent,
  GitNoteConfig,
  LastActivity,
  TodoChange,
  TodoChangeType,
  TodoItem,
} from '../models';
import { TodoStore } from '../state/todoStore';
import { sanitizeBucketName } from '../utils/bucketName';
import { AppStorage } from './appStorage';
import {
  createLastActivityPayload,
  createReplaceTodoPayload,
  createTodoPayload,
  FirebaseRestClient,
  generatePushId,
} from './firebaseRestClient';
import { NotificationService } from './notificationService';

interface PendingMutation {
  id: string;
  type: TodoChangeType;
  expiresAt: number;
}

const RECONNECT_DELAY = 3000;
const PENDING_TTL = 10_000;

export class TodoSyncService implements vscode.Disposable {
  private readonly statusEmitter = new vscode.EventEmitter<ConnectionStatus>();
  private readonly bucketEmitter = new vscode.EventEmitter<string>();
  private readonly store = new TodoStore();
  private readonly notifications: NotificationService;
  private readonly disposables: vscode.Disposable[] = [
    this.statusEmitter,
    this.bucketEmitter,
  ];
  private readonly pendingMutations: PendingMutation[] = [];

  private config: GitNoteConfig = getConfig();
  private client?: FirebaseRestClient;
  private streamDisposable?: vscode.Disposable;
  private reconnectTimer?: NodeJS.Timeout;
  private connectionVersion = 0;
  private currentBucket = '';
  private status: ConnectionStatus = {
    state: 'idle',
    message: 'Hazır',
  };

  public constructor(
    private readonly storage: AppStorage,
    soundsDirectory: string,
  ) {
    this.notifications = new NotificationService(soundsDirectory);
  }

  public readonly onDidChangeTodos = this.store.onDidChange;
  public readonly onDidChangeStatus = this.statusEmitter.event;
  public readonly onDidChangeBucket = this.bucketEmitter.event;

  public getTodos(): TodoItem[] {
    return this.store.getTodos();
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public getLastActivity(): LastActivity | undefined {
    return this.store.getLastActivity();
  }

  public getCurrentBucket(): string {
    return this.currentBucket;
  }

  public async start(): Promise<void> {
    await this.restart();
  }

  public async restart(): Promise<void> {
    this.connectionVersion += 1;
    this.clearConnection();
    this.clearPendingMutations();
    this.config = getConfig();

    const databaseUrl = DATABASE_URL;

    try {
      const buckets = await this.listBuckets(databaseUrl);
      const bucketId = await this.resolveCurrentBucket(buckets);

      if (!bucketId) {
        this.client = undefined;
        this.currentBucket = '';
        this.store.setSnapshot({});
        this.emitBucket();
        this.updateStatus('needsBucket', 'Önce bir proje seç veya oluştur');
        return;
      }

      this.currentBucket = bucketId;
      this.emitBucket();
      this.client = new FirebaseRestClient(databaseUrl, buildBucketPath(bucketId));
      await this.connect('connecting');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      this.client = undefined;
      this.store.setSnapshot({});
      this.updateStatus('error', `Veritabanı okunamadı: ${message}`);
    }
  }

  public async listBuckets(databaseUrl = DATABASE_URL): Promise<BucketSummary[]> {
    const client = new FirebaseRestClient(databaseUrl, BUCKETS_ROOT_PATH);
    const raw = await client.getRoot();
    return toBucketSummaries(raw);
  }

  public async createBucket(name: string): Promise<string> {
    const bucketId = sanitizeBucketName(name);

    if (!bucketId) {
      throw new Error('Geçerli bir proje adı gir.');
    }

    const databaseUrl = DATABASE_URL;
    const existing = await this.listBuckets(databaseUrl);

    if (existing.some((bucket) => bucket.id === bucketId)) {
      await this.selectBucket(bucketId);
      return bucketId;
    }

    const client = new FirebaseRestClient(databaseUrl, buildBucketPath(bucketId));
    const timestamp = Date.now();

    await client.patchRoot({
      __meta: {
        name: bucketId,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    await this.selectBucket(bucketId);
    return bucketId;
  }

  public async selectBucket(bucketId: string): Promise<void> {
    const normalized = sanitizeBucketName(bucketId);

    if (!normalized) {
      throw new Error('Geçerli bir proje seç.');
    }

    await this.storage.setCurrentBucket(normalized);
    this.currentBucket = normalized;
    this.emitBucket();
    await this.restart();
  }

  public async addTodo(text: string): Promise<void> {
    const client = this.requireClient();
    const trimmed = text.trim();

    if (!trimmed) {
      throw new Error('Todo metni boş olamaz.');
    }

    const id = generatePushId();
    const activity = createLastActivityPayload('added', this.config.deviceName, id, trimmed);

    await client.createTodoWithActivity(
      id,
      createTodoPayload(trimmed, this.config.deviceName),
      activity,
    );

    this.trackPending(id, 'added');
  }

  public async updateTodoText(id: string, text: string): Promise<void> {
    const client = this.requireClient();
    const todo = this.requireTodo(id);
    const trimmed = text.trim();

    if (!trimmed) {
      throw new Error('Todo metni boş olamaz.');
    }

    const activity = createLastActivityPayload('updated', this.config.deviceName, id, trimmed);

    await client.replaceTodoWithActivity(
      id,
      createReplaceTodoPayload(todo, this.config.deviceName, { text: trimmed }),
      activity,
    );

    this.trackPending(id, 'updated');
  }

  public async toggleTodo(id: string, completed: boolean): Promise<void> {
    const client = this.requireClient();
    const todo = this.requireTodo(id);
    const activityType = completed ? 'completed' : 'reopened';

    const activity = createLastActivityPayload(activityType, this.config.deviceName, id, todo.text);

    await client.replaceTodoWithActivity(
      id,
      createReplaceTodoPayload(todo, this.config.deviceName, { completed }),
      activity,
    );

    this.trackPending(id, activityType);
  }

  public async deleteTodo(id: string): Promise<void> {
    const client = this.requireClient();
    const todo = this.requireTodo(id);

    const activity = createLastActivityPayload('removed', this.config.deviceName, id, todo.text);

    await client.deleteTodoWithActivity(id, activity);
    this.trackPending(id, 'removed');
  }

  public dispose(): void {
    this.connectionVersion += 1;
    this.clearConnection();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async resolveCurrentBucket(buckets: BucketSummary[]): Promise<string> {
    const storedBucket = this.storage.getCurrentBucket();

    if (storedBucket && buckets.some((bucket) => bucket.id === storedBucket)) {
      return storedBucket;
    }

    const firstBucket = buckets[0]?.id ?? '';

    if (!firstBucket) {
      await this.storage.clearCurrentBucket();
      return '';
    }

    await this.storage.setCurrentBucket(firstBucket);
    return firstBucket;
  }

  private async connect(state: 'connecting' | 'reconnecting'): Promise<void> {
    if (!this.client) {
      return;
    }

    const version = this.connectionVersion;
    this.updateStatus(
      state,
      state === 'connecting' ? 'Firebase bağlanıyor...' : 'Yeniden bağlanıyor...',
    );

    try {
      const snapshot = await this.client.getRoot();

      if (version !== this.connectionVersion) {
        return;
      }

      this.store.setSnapshot(snapshot);
      this.updateStatus('connected', 'Bağlı ve senkron');
      this.openStream(version);
    } catch (error) {
      this.handleConnectionFailure(error, version);
    }
  }

  private openStream(version: number): void {
    if (!this.client) {
      return;
    }

    this.streamDisposable = this.client.stream({
      onEvent: (event) => {
        void this.handleStreamEvent(event, version);
      },
      onError: (error) => {
        this.handleConnectionFailure(error, version);
      },
      onClose: () => {
        this.scheduleReconnect('Bağlantı kapandı, tekrar deneniyor...', version);
      },
    });
  }

  private async handleStreamEvent(
    event: FirebaseStreamEvent,
    version: number,
  ): Promise<void> {
    if (version !== this.connectionVersion) {
      return;
    }

    if (event.event === 'keep-alive') {
      this.updateStatus('connected', 'Bağlı ve senkron');
      return;
    }

    if (event.event === 'cancel' || event.event === 'auth_revoked') {
      this.updateStatus('error', 'Firebase akışı iptal edildi');
      this.scheduleReconnect('Akış kesildi, tekrar bağlanılıyor...', version);
      return;
    }

    const changes = this.store.applyStreamEvent(event);
    this.updateStatus('connected', 'Bağlı ve senkron');
    await this.notifyForChanges(changes);
  }

  private async notifyForChanges(changes: TodoChange[]): Promise<void> {
    if (!this.config.notifyOnOwnChanges) {
      for (const change of changes) {
        this.consumePending(change);
      }
    }

    await this.notifications.notify(changes, this.config.soundEnabled);
  }

  private handleConnectionFailure(error: unknown, version: number): void {
    if (version !== this.connectionVersion) {
      return;
    }

    const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
    this.updateStatus('error', `Bağlantı hatası: ${message}`);
    this.scheduleReconnect('Bağlantı koptu, tekrar bağlanılıyor...', version);
  }

  private scheduleReconnect(message: string, version: number): void {
    if (version !== this.connectionVersion || this.reconnectTimer || !this.client) {
      return;
    }

    this.updateStatus('reconnecting', message);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;

      if (version !== this.connectionVersion) {
        return;
      }

      void this.connect('reconnecting');
    }, RECONNECT_DELAY);
  }

  private updateStatus(state: ConnectionStatus['state'], message: string): void {
    this.status = { state, message };
    this.statusEmitter.fire(this.status);
  }

  private emitBucket(): void {
    this.bucketEmitter.fire(this.currentBucket);
  }

  private requireClient(): FirebaseRestClient {
    if (!this.client) {
      throw new Error('Önce veritabanını ve projeyi hazırla.');
    }

    return this.client;
  }

  private requireTodo(id: string): TodoItem {
    const todo = this.store.getTodo(id);

    if (!todo) {
      throw new Error('Todo bulunamadı.');
    }

    return todo;
  }

  private trackPending(id: string, type: TodoChangeType): void {
    this.cleanupPending();
    this.pendingMutations.push({ id, type, expiresAt: Date.now() + PENDING_TTL });
  }

  private consumePending(change: TodoChange): boolean {
    this.cleanupPending();
    const id = change.after?.id ?? change.before?.id;

    if (!id) {
      return false;
    }

    const index = this.pendingMutations.findIndex((entry) => {
      return entry.id === id && entry.type === change.type;
    });

    if (index < 0) {
      return false;
    }

    this.pendingMutations.splice(index, 1);
    return true;
  }

  private cleanupPending(): void {
    const now = Date.now();
    const active = this.pendingMutations.filter((entry) => entry.expiresAt > now);
    this.pendingMutations.splice(0, this.pendingMutations.length, ...active);
  }

  private clearPendingMutations(): void {
    this.pendingMutations.splice(0, this.pendingMutations.length);
  }

  private clearConnection(): void {
    this.streamDisposable?.dispose();
    this.streamDisposable = undefined;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

function buildBucketPath(bucketId: string): string {
  return `${BUCKETS_ROOT_PATH}/${bucketId}`;
}

function toBucketSummaries(raw: unknown): BucketSummary[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  return Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([id, value]) => toBucketSummary(id, value as Record<string, unknown>))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

function toBucketSummary(id: string, raw: Record<string, unknown>): BucketSummary {
  const meta = readMeta(raw);
  const lastActivity = readLastActivity(meta.lastActivity);
  const updatedAt = readNumber(meta.updatedAt, lastActivity?.timestamp ?? readNumber(meta.createdAt, 0));

  return {
    id,
    todoCount: Object.keys(raw).filter((key) => key !== '__meta').length,
    updatedAt,
    lastActivity,
  };
}

function readMeta(raw: Record<string, unknown>): Record<string, unknown> {
  const meta = raw.__meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function readLastActivity(raw: unknown): LastActivity | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  return {
    type: readChangeType((raw as Record<string, unknown>).type),
    todoId: readString((raw as Record<string, unknown>).todoId, ''),
    todoText: readString((raw as Record<string, unknown>).todoText, 'Todo'),
    deviceName: readString((raw as Record<string, unknown>).deviceName, 'cihaz'),
    timestamp: readNumber((raw as Record<string, unknown>).timestamp, 0),
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readChangeType(value: unknown): TodoChangeType {
  return ['added', 'removed', 'completed', 'reopened', 'updated'].includes(String(value))
    ? (value as TodoChangeType)
    : 'updated';
}
