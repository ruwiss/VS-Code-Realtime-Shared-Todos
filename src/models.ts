export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TodoRecord {
  text?: unknown;
  completed?: unknown;
  author?: unknown;
  updatedBy?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type TodoChangeType =
  | 'added'
  | 'removed'
  | 'completed'
  | 'reopened'
  | 'updated';

export interface BucketSummary {
  id: string;
  todoCount: number;
  updatedAt: number;
  lastActivity?: LastActivity;
}

export interface LastActivity {
  type: TodoChangeType;
  todoId: string;
  todoText: string;
  deviceName: string;
  timestamp: number;
}

export interface LastActivityRecord {
  type?: unknown;
  todoId?: unknown;
  todoText?: unknown;
  deviceName?: unknown;
  timestamp?: unknown;
}

export interface TodoChange {
  type: TodoChangeType;
  before?: TodoItem;
  after?: TodoItem;
}

export type ConnectionState =
  | 'idle'
  | 'needsBucket'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  message: string;
}

export interface GitNoteConfig {
  deviceName: string;
  soundEnabled: boolean;
  notifyOnOwnChanges: boolean;
}

export interface FirebaseStreamEvent {
  event: 'put' | 'patch' | 'keep-alive' | 'cancel' | 'auth_revoked';
  path?: string;
  data?: unknown;
}
