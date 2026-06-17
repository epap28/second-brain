const configuredApiBaseUrl = window.SECOND_BRAIN_API_BASE_URL || '';
const isLocalOrigin = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
const API_BASE_URL = (isLocalOrigin ? '' : configuredApiBaseUrl).replace(/\/$/, '');
const PASSWORD_STORAGE_KEY = 'second-brain-api-password';

const state = {
  currentCategoryId: null,
  currentNote: null,
  saveTimeout: null,
  aiComments: [],
  latestAiComments: [],
  dismissedNotifications: new Set(),
  isRequestingAi: false,
  aiSettings: null,
  rootCategoryId: null,
  apiPassword: readStoredApiPassword(),
};

document.addEventListener('DOMContentLoaded', async () => {
  await initializeApp();
  setupEventListeners();
});

async function initializeApp() {
  await loadAiSettings();
  const response = await apiFetch('/api/root');
  if (!response.ok) {
    alert('Unable to load Second Brain data.');
    return;
  }
  const { rootCategory } = await response.json();
  state.rootCategoryId = rootCategory.id;
  state.currentCategoryId = rootCategory.id;
  document.body.dataset.view = 'home';
  await loadCategory(rootCategory.id);
}

function setupEventListeners() {
  document.getElementById('search-form').addEventListener('submit', handleSearchSubmit);
  document.getElementById('add-category-btn').addEventListener('click', () => openCategoryModal('create'));
  document
    .getElementById('home-add-category-btn')
    .addEventListener('click', () => openCategoryModal('create'));
  document.getElementById('edit-category-btn').addEventListener('click', () => openCategoryModal('edit'));
  document.getElementById('delete-category-btn').addEventListener('click', handleDeleteCategory);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-form').addEventListener('submit', handleModalSubmit);
  document.getElementById('export-data-btn').addEventListener('click', handleExport);
  document.getElementById('import-file').addEventListener('change', handleImport);
  document.getElementById('note-editor').addEventListener('input', handleEditorInput);
  document.getElementById('insert-divider-btn').addEventListener('click', insertDivider);
  document.getElementById('ai-request-btn').addEventListener('click', requestAiComment);
}

async function loadCategory(categoryId, options = {}) {
  const response = await apiFetch(`/api/category/${categoryId}`);
  if (!response.ok) {
    alert('Failed to load category');
    return;
  }

  const { category, children, notes } = await response.json();
  state.currentCategoryId = category.id;

  renderCategory(category, children);
  applyLayoutForCategory(category);

  const isHome = isHomeCategory(category);

  if (isHome) {
    state.currentNote = null;
    clearNoteSection();
    state.aiComments = [];
    renderAiComments();
  } else {
    const availableNotes = await ensureNoteExists(notes);
    if (options.noteId) {
      const matching = availableNotes.find((note) => note.id === options.noteId);
      if (matching) {
        state.currentNote = matching;
      }
    }
    renderNote();
    await refreshAiComments();
    focusEditor();
  }

  await refreshLatestAiComments();
  await renderBreadcrumb(category.id);
}

async function loadAiSettings() {
  try {
    const response = await apiFetch('/api/ai-settings');
    if (!response.ok) {
      throw new Error('Failed to load AI settings');
    }
    const { ai } = await response.json();
    state.aiSettings = ai;
  } catch (error) {
    console.warn(error.message || 'AI settings unavailable');
  }
}

async function renderBreadcrumb(categoryId) {
  const response = await apiFetch(`/api/breadcrumb/${categoryId}`);
  const { breadcrumb } = await response.json();
  const container = document.getElementById('breadcrumb');
  container.innerHTML = '';

  breadcrumb.forEach((crumb, index) => {
    const button = document.createElement('button');
    button.className = 'breadcrumb-item';
    button.textContent = crumb.name;
    button.addEventListener('click', () => loadCategory(crumb.id));
    container.appendChild(button);

    if (index < breadcrumb.length - 1) {
      const separator = document.createElement('span');
      separator.textContent = '›';
      container.appendChild(separator);
    }
  });
}

function renderCategory(category, children) {
  document.getElementById('category-title').textContent = category.name;
  document.getElementById('category-description').textContent = category.description || '';

  const section = document.getElementById('children-section');
  const list = document.getElementById('children-list');
  const heading = document.getElementById('children-heading');
  list.innerHTML = '';

  if (!children || children.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  if (heading) {
    heading.textContent = isHomeCategory(category) ? 'Categories' : 'Subcategories';
  }
  children.forEach((child) => {
    const li = document.createElement('li');
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-item-row';

    const button = document.createElement('button');
    button.className = 'tree-item';
    button.textContent = child.name;
    button.addEventListener('click', () => loadCategory(child.id));

    wrapper.appendChild(button);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'tree-item-delete';
    deleteBtn.setAttribute('aria-label', `Delete ${child.name}`);
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await handleDeleteSubcategory(child.id, child.name);
    });

    wrapper.appendChild(deleteBtn);
    li.appendChild(wrapper);
    list.appendChild(li);
  });
}

async function handleDeleteSubcategory(categoryId, categoryName = '') {
  if (!categoryId) {
    return;
  }

  const label = categoryName ? `"${categoryName}"` : 'this subcategory';
  if (!confirm(`Delete ${label} and all of its contents?`)) {
    return;
  }

  try {
    await apiFetch(`/api/category/${categoryId}`, { method: 'DELETE' });
    await loadCategory(state.currentCategoryId);
  } catch (error) {
    alert('Failed to delete subcategory');
  }
}

function isHomeCategory(category) {
  return category.id === state.rootCategoryId;
}

function applyLayoutForCategory(category) {
  const isHome = isHomeCategory(category);
  document.body.dataset.view = isHome ? 'home' : 'category';

  const sectionLabel = document.querySelector('.category-panel .section-label');
  if (sectionLabel) {
    sectionLabel.textContent = isHome ? 'Home' : 'Current category';
  }

  const heading = document.getElementById('category-heading');
  if (heading) {
    heading.classList.toggle('hidden', isHome);
  }

  const homeAddButton = document.getElementById('home-add-category-btn');
  if (homeAddButton) {
    homeAddButton.classList.toggle('hidden', !isHome);
  }

  const categoryPanel = document.getElementById('category-panel');
  if (categoryPanel) {
    categoryPanel.classList.toggle('home-state', isHome);
  }

  const editButton = document.getElementById('edit-category-btn');
  const deleteButton = document.getElementById('delete-category-btn');
  if (editButton) {
    editButton.classList.toggle('hidden', isHome);
  }
  if (deleteButton) {
    deleteButton.classList.toggle('hidden', isHome);
  }

  const notesSection = document.getElementById('notes-section');
  if (notesSection) {
    notesSection.hidden = isHome;
  }

  const aiPanel = document.getElementById('ai-feedback-panel');
  if (aiPanel) {
    aiPanel.hidden = isHome;
  }

  const aiCommentActions = document.getElementById('ai-comment-actions');
  if (aiCommentActions) {
    if (isHome) {
      aiCommentActions.classList.add('hidden');
    } else {
      aiCommentActions.classList.remove('hidden');
    }
  }
}

function renderNote() {
  const editor = document.getElementById('note-editor');

  if (!state.currentNote) {
    editor.value = '';
    editor.disabled = true;
    return;
  }

  editor.disabled = false;
  editor.value = state.currentNote.content || '';
  setAutosaveStatus('Saved');
  renderAiComments();
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  const query = document.getElementById('search-input').value.trim();
  const mode = document.getElementById('search-mode').value;
  const container = document.getElementById('search-results');

  container.innerHTML = '';
  if (!query) {
    return;
  }

  const response = await apiFetch(`/api/search?q=${encodeURIComponent(query)}&mode=${mode}`);
  const { results } = await response.json();

  if (!results || results.length === 0) {
    container.textContent = 'No results found';
    return;
  }

  if (mode === 'category') {
    results.forEach((category) => {
      const button = document.createElement('button');
      button.className = 'search-result';
      button.textContent = category.name;
      button.addEventListener('click', async () => {
        await loadCategory(category.id);
        container.innerHTML = '';
      });
      container.appendChild(button);
    });
  } else {
    results.forEach(({ category, notes }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'search-match';

      const heading = document.createElement('button');
      heading.className = 'search-result';
      heading.textContent = category.name;
      heading.addEventListener('click', async () => {
        await loadCategory(category.id);
        container.innerHTML = '';
      });

      wrapper.appendChild(heading);

      if (notes && notes.length) {
        const list = document.createElement('ul');
        notes.forEach((note) => {
          const li = document.createElement('li');
          li.textContent = extractNoteSnippet(note.content, note.title);
          list.appendChild(li);
        });
        wrapper.appendChild(list);
      }

      container.appendChild(wrapper);
    });
  }
}

async function ensureNoteExists(notes = []) {
  if (notes && notes.length > 0) {
    const sorted = [...notes].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    state.currentNote = sorted[0];
    return sorted;
  }

  const response = await apiFetch('/api/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      categoryId: state.currentCategoryId,
      title: '',
      content: '',
    }),
  });

  const { note } = await response.json();
  state.currentNote = note;
  return [note];
}

function handleEditorInput(event) {
  if (!state.currentNote) {
    return;
  }

  state.currentNote.content = event.target.value;
  setAutosaveStatus('Saving…');

  if (state.saveTimeout) {
    clearTimeout(state.saveTimeout);
  }

  state.saveTimeout = setTimeout(saveCurrentNote, 500);
}

async function saveCurrentNote() {
  if (!state.currentNote) {
    return;
  }

  await apiFetch(`/api/note/${state.currentNote.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: state.currentNote.content, title: state.currentNote.title || '' }),
  });

  setAutosaveStatus('Saved');
}

function insertDivider() {
  const editor = document.getElementById('note-editor');
  if (editor.disabled) {
    return;
  }

  const divider = '\n\n---\n\n';
  const { selectionStart, selectionEnd, value } = editor;
  const newValue = `${value.slice(0, selectionStart)}${divider}${value.slice(selectionEnd)}`;
  editor.value = newValue;
  editor.dispatchEvent(new Event('input'));
  const cursor = selectionStart + divider.length;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(cursor, cursor);
}

function extractNoteSnippet(content = '', title = '') {
  const primary = (content && content.trim()) || (title && title.trim()) || '';
  if (!primary) {
    return '(empty note)';
  }

  const firstLine = primary.split(/\r?\n/)[0];
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

function focusEditor() {
  const editor = document.getElementById('note-editor');
  if (!editor.disabled) {
    editor.focus({ preventScroll: true });
  }
}

function clearNoteSection() {
  const editor = document.getElementById('note-editor');
  if (editor) {
    editor.value = '';
    editor.disabled = true;
  }
  setAutosaveStatus('');
}

function setAutosaveStatus(text) {
  document.getElementById('autosave-status').textContent = text;
}

async function openCategoryModal(mode) {
  const modal = document.getElementById('modal');
  const titleEl = document.getElementById('modal-title');
  const input = document.getElementById('modal-input');
  const textareaGroup = document.getElementById('modal-textarea-group');
  const textarea = document.getElementById('modal-textarea');

  modal.dataset.mode = mode;
  modal.dataset.categoryId = state.currentCategoryId;
  modal.dataset.commentId = '';
  modal.hidden = false;

  textareaGroup.hidden = mode !== 'edit';

  if (mode === 'create') {
    titleEl.textContent = 'Create subcategory';
    input.value = '';
    textarea.value = '';
  } else if (mode === 'edit') {
    titleEl.textContent = 'Edit category';
    const response = await apiFetch(`/api/category/${state.currentCategoryId}`);
    const { category } = await response.json();
    input.value = category.name;
    textarea.value = category.description || '';
  }

  input.focus();
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.hidden = true;
  modal.dataset.mode = '';
  modal.dataset.categoryId = '';
  modal.dataset.commentId = '';

  document.getElementById('modal-input').value = '';
  document.getElementById('modal-input').placeholder = '';
  document.getElementById('modal-textarea').value = '';
  document.getElementById('modal-textarea-group').hidden = true;
}

async function handleModalSubmit(event) {
  event.preventDefault();
  const modal = document.getElementById('modal');
  const mode = modal.dataset.mode;
  const input = document.getElementById('modal-input');
  const textarea = document.getElementById('modal-textarea');

  try {
    if (mode === 'ai-edit') {
      const commentId = modal.dataset.commentId;
      const response = await apiFetch(`/api/ai-comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: input.value || 'mistral:7b', content: textarea.value }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error || 'Failed to update AI comment');
      }

      const { comment } = await response.json();
      state.aiComments = state.aiComments.map((existing) => (existing.id === comment.id ? comment : existing));
      renderAiComments();
      await refreshLatestAiComments();
      closeModal();
      return;
    }

    if (mode === 'create') {
      await apiFetch('/api/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: state.currentCategoryId,
          name: input.value,
          description: textarea.value,
        }),
      });
    } else if (mode === 'edit') {
      await apiFetch(`/api/category/${state.currentCategoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.value, description: textarea.value }),
      });
    }

    closeModal();
    await loadCategory(state.currentCategoryId);
  } catch (error) {
    alert(error.message || 'Action failed');
  }
}

async function handleDeleteCategory() {
  if (!state.currentCategoryId) {
    return;
  }

  if (!confirm('Delete this category and all its contents?')) {
    return;
  }

  try {
    await apiFetch(`/api/category/${state.currentCategoryId}`, { method: 'DELETE' });
    const response = await apiFetch('/api/root');
    const { rootCategory } = await response.json();
    await loadCategory(rootCategory.id);
  } catch (error) {
    alert('Failed to delete category');
  }
}

async function handleExport() {
  const response = await apiFetch('/api/export');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'second-brain-export.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function handleImport(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const text = await file.text();
  await apiFetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: text }),
  });

  await initializeApp();
}

async function refreshAiComments() {
  if (!state.currentNote) {
    state.aiComments = [];
    renderAiComments();
    return;
  }

  if (!state.currentNote.content || !state.currentNote.content.trim()) {
    state.aiComments = [];
    renderAiComments({ hideActions: true });
    return;
  }

  const response = await apiFetch(`/api/ai-comments/note/${state.currentNote.id}`);
  if (!response.ok) {
    console.warn('Failed to load AI comments');
    return;
  }

  const { comments } = await response.json();
  state.aiComments = comments || [];
  renderAiComments();
}

async function refreshLatestAiComments() {
  const response = await apiFetch('/api/ai-comments/latest/5');
  if (!response.ok) {
    console.warn('Failed to load AI notifications');
    return;
  }

  const { comments } = await response.json();
  state.latestAiComments = comments || [];
  state.dismissedNotifications = new Set(
    (comments || [])
      .filter((comment) => comment.dismissed)
      .map((comment) => comment.id)
  );
  renderLatestAiComments();
}

function renderAiComments(options = {}) {
  const container = document.getElementById('ai-comments');
  const requestBtn = document.getElementById('ai-request-btn');
  const actions = document.getElementById('ai-comment-actions');
  const aiEnabled = state.aiSettings?.enabled !== false;

  container.innerHTML = '';

  if (!state.currentNote || !state.currentNote.content || !state.currentNote.content.trim()) {
    actions.classList.add('hidden');
    return;
  }

  actions.classList.toggle('hidden', Boolean(options.hideActions) || !aiEnabled);
  requestBtn.disabled = state.isRequestingAi;
  requestBtn.textContent = state.isRequestingAi ? 'Requesting…' : 'Request AI feedback';

  if (!state.aiComments.length) {
    if (aiEnabled && !options.hideActions) {
      actions.classList.remove('hidden');
    } else if (!aiEnabled) {
      container.textContent = 'AI feedback is disabled for this deployment.';
    }
    return;
  }

  state.aiComments.forEach((comment) => {
    const article = document.createElement('article');
    article.className = 'ai-comment card';

    const header = document.createElement('header');
    header.className = 'ai-comment-header';

    const model = document.createElement('span');
    model.className = 'ai-comment-model';
    model.textContent = formatAiCommentLabel(comment);

    const time = document.createElement('time');
    time.className = 'ai-comment-timestamp';
    time.dateTime = comment.updatedAt || comment.createdAt;
    time.textContent = new Date(comment.updatedAt || comment.createdAt).toLocaleString();

    const actionsGroup = document.createElement('div');
    actionsGroup.className = 'ai-comment-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openAiEditModal(comment));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => handleDeleteAiComment(comment.id));

    actionsGroup.append(editBtn, deleteBtn);
    header.append(model, time, actionsGroup);

    const content = document.createElement('div');
    content.className = 'ai-comment-content';
    content.textContent = comment.content || '(empty)';

    article.append(header, content);
    container.appendChild(article);
  });
}

function renderLatestAiComments() {
  const list = document.getElementById('ai-notifications');
  list.innerHTML = '';

  if (!state.latestAiComments.length) {
    const li = document.createElement('li');
    li.textContent = 'No AI suggestions yet.';
    list.appendChild(li);
    return;
  }

  state.latestAiComments.forEach((comment) => {
    if (state.dismissedNotifications.has(comment.id)) {
      return;
    }
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'notification-link';
    button.textContent = extractNoteSnippet(comment.content);
    button.addEventListener('click', async () => {
      await loadCategory(comment.categoryId, { noteId: comment.noteId });
      await refreshAiComments();
      document.getElementById('note-editor').scrollIntoView({ behavior: 'smooth' });
    });

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'notification-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss notification');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', async (event) => {
      event.stopPropagation();
      await dismissNotification(comment.id);
      li.remove();
    });

    li.append(button, dismiss);
    list.appendChild(li);
  });
}

async function dismissNotification(commentId) {
  try {
    state.dismissedNotifications.add(commentId);
    await apiFetch(`/api/ai-comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    });
    await refreshLatestAiComments();
  } catch (error) {
    console.warn('Failed to dismiss notification', error);
  }
}

async function requestAiComment() {
  if (!state.currentNote || state.isRequestingAi) {
    return;
  }
  if (state.aiSettings?.enabled === false) {
    alert('AI feedback is disabled for this deployment.');
    return;
  }

  state.isRequestingAi = true;
  renderAiComments();

  try {
    const response = await apiFetch('/api/ai-comments/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: state.currentNote.id }),
    });

    if (!response.ok) {
      const { error } = await response.json();
      throw new Error(error || 'AI request failed');
    }

    const { comment } = await response.json();
    state.aiComments = [comment];
    renderAiComments();
    await refreshAiComments();
    await refreshLatestAiComments();
    setAutosaveStatus('Saved');
  } catch (error) {
    alert(error.message || 'AI request failed');
  } finally {
    state.isRequestingAi = false;
    renderAiComments();
  }
}

function openAiEditModal(comment) {
  const modal = document.getElementById('modal');
  modal.dataset.mode = 'ai-edit';
  modal.dataset.commentId = comment.id;
  modal.hidden = false;

  document.getElementById('modal-title').textContent = 'Edit AI comment';
  document.getElementById('modal-input').value = comment.model || '';
  document.getElementById('modal-input').placeholder = 'Model name';
  document.getElementById('modal-textarea-group').hidden = false;
  document.getElementById('modal-textarea').value = comment.content || '';
  document.getElementById('modal-input').focus();
}

async function handleDeleteAiComment(commentId) {
  if (!confirm('Delete this AI comment?')) {
    return;
  }

  await apiFetch(`/api/ai-comments/${commentId}`, { method: 'DELETE' });
  state.aiComments = state.aiComments.filter((comment) => comment.id !== commentId);
  renderAiComments();
  await refreshLatestAiComments();
}

function formatAiCommentLabel(comment) {
  const model = comment.model || state.aiSettings?.model || 'AI comment';
  if (!comment.metadata || !comment.metadata.prompt) {
    return model;
  }
  return `${model} (review)`;
}

function readStoredApiPassword() {
  try {
    return localStorage.getItem(PASSWORD_STORAGE_KEY) || '';
  } catch (error) {
    return '';
  }
}

function storeApiPassword(password) {
  state.apiPassword = password;
  try {
    localStorage.setItem(PASSWORD_STORAGE_KEY, password);
  } catch (error) {
    // Ignore storage errors; the in-memory password still works for this tab.
  }
}

async function apiFetch(path, options = {}, retrying = false) {
  const headers = new Headers(options.headers || {});
  if (state.apiPassword) {
    headers.set('X-Second-Brain-Password', state.apiPassword);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status !== 401 || retrying) {
    return response;
  }

  const password = prompt('Mot de passe Second Brain');
  if (password === null) {
    return response;
  }

  storeApiPassword(password.trim());
  return apiFetch(path, options, true);
}
