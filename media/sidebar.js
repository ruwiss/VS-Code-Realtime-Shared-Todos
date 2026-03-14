const vscode = acquireVsCodeApi();

const state = {
  todos: [],
  status: { state: 'idle', message: 'Hazır' },
  currentBucket: '',
  hasBucket: false,
  error: '',
};

const app = document.getElementById('app');

window.addEventListener('message', (event) => {
  const message = event.data;

  if (message.type === 'hydrate') {
    Object.assign(state, message.payload, { error: '' });
    render();
  }

  if (message.type === 'error') {
    state.error = message.payload?.message ?? 'Bir hata oluştu';
    render();
  }
});

render();
vscode.postMessage({ type: 'ready' });

function render() {
  app.innerHTML = `
    <div class="shell">
      ${state.error ? `<section class="message error">${escapeHtml(state.error)}</section>` : ''}
      ${renderList()}
    </div>
  `;

  bindEvents();
}

function renderList() {
  if (!state.hasBucket) {
    return `
      <section class="message empty">
        <div class="message-title">Henüz proje seçilmedi</div>
        <button class="link-button" data-action="openProjects">Projeleri Aç</button>
      </section>
    `;
  }

  if (!state.todos.length) {
    return `
      <section class="message empty">
        <div class="message-title">Bu projede todo yok</div>
        <div class="message-body">İlk notu ekleyerek başlayabilirsin.</div>
      </section>
    `;
  }

  return `
    <section class="todo-list" aria-label="Todo listesi">
      ${state.todos.map(renderTodo).join('')}
    </section>
  `;
}

function renderTodo(todo) {
  const updatedAt = new Date(todo.updatedAt).toLocaleString('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return `
    <article class="todo-row ${todo.completed ? 'completed' : ''}">
      <label class="todo-check">
        <input type="checkbox" data-id="${todo.id}" ${todo.completed ? 'checked' : ''} />
        <span></span>
      </label>
      <div class="todo-main">
        <div class="todo-actions">
          <button class="icon-button subtle" data-action="edit" data-id="${todo.id}" title="Düzenle" aria-label="Düzenle">
            <span class="codicon codicon-edit"></span>
          </button>
          <button class="icon-button danger subtle" data-action="delete" data-id="${todo.id}" title="Sil" aria-label="Sil">
            <span class="codicon codicon-trash"></span>
          </button>
        </div>
        <div class="todo-text">${escapeHtml(todo.text)}</div>
        <div class="todo-meta" title="${escapeHtml(`${todo.updatedBy} • ${updatedAt}`)}">
          <span>${escapeHtml(todo.updatedBy)}</span>
          <span>•</span>
          <span>${escapeHtml(updatedAt)}</span>
        </div>
      </div>
    </article>
  `;
}

function bindEvents() {
  app.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      vscode.postMessage({
        type: 'toggleTodo',
        payload: { id: input.dataset.id, completed: input.checked },
      });
    });
  });

  app.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => handleAction(button));
  });
}

function handleAction(element) {
  const action = element.dataset.action;
  const id = element.dataset.id;

  if (action === 'openProjects') {
    vscode.postMessage({ type: 'openProjects' });
  }

  if (action === 'delete' && id) {
    vscode.postMessage({ type: 'deleteTodo', payload: { id } });
  }

  if (action === 'edit' && id) {
    vscode.postMessage({ type: 'editTodo', payload: { id } });
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
