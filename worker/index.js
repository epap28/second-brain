const STATE_ID = 'default';
const DEFAULT_ALLOWED_ORIGINS = ['https://epap28.github.io', 'http://localhost:3000'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    if (segments[0] !== 'api') {
      return jsonResponse(request, env, 404, { error: 'Not found' });
    }

    if (!env.SECOND_BRAIN_PASSWORD) {
      return jsonResponse(request, env, 500, { error: 'SECOND_BRAIN_PASSWORD is not configured' });
    }

    if (request.headers.get('X-Second-Brain-Password') !== env.SECOND_BRAIN_PASSWORD) {
      return jsonResponse(request, env, 401, { error: 'Unauthorized' });
    }

    try {
      return await handleApiRequest(request, env, url, segments);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse(request, env, 500, { error: 'Internal server error' });
    }
  },
};

async function handleApiRequest(request, env, url, segments) {
  const method = request.method.toUpperCase();
  const resource = segments[1];

  if (resource === 'root' && method === 'GET') {
    const model = await loadModel(env);
    const root = model.categories.find((category) => category.parentId === null);
    return jsonResponse(request, env, 200, { rootCategory: root });
  }

  if (resource === 'tree' && method === 'GET') {
    const model = await loadModel(env);
    return jsonResponse(request, env, 200, { categories: model.categories, notes: model.notes });
  }

  if (resource === 'category') {
    return handleCategoryRoutes(request, env, segments.slice(2), method);
  }

  if (resource === 'note') {
    return handleNoteRoutes(request, env, segments.slice(2), method);
  }

  if (resource === 'ai-comments') {
    return handleAiCommentRoutes(request, env, segments.slice(2), method);
  }

  if (resource === 'ai-settings') {
    return handleAiSettingsRoute(request, env, method);
  }

  if (resource === 'breadcrumb' && method === 'GET') {
    const categoryId = segments[2];
    const model = await loadModel(env);
    return jsonResponse(request, env, 200, { breadcrumb: model.getBreadcrumb(categoryId) });
  }

  if (resource === 'search' && method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const mode = url.searchParams.get('mode') || 'category';
    const model = await loadModel(env);

    if (mode === 'content') {
      return jsonResponse(request, env, 200, {
        mode,
        query,
        results: model.searchByContent(query),
      });
    }

    return jsonResponse(request, env, 200, {
      mode: 'category',
      query,
      results: model.searchCategoriesByName(query),
    });
  }

  if (resource === 'export' && method === 'GET') {
    const model = await loadModel(env);
    return new Response(JSON.stringify(model.serialize(), null, 2), {
      status: 200,
      headers: {
        ...corsHeaders(request, env),
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="second-brain-export.json"',
      },
    });
  }

  if (resource === 'import' && method === 'POST') {
    const body = await readJsonBody(request);
    const model = await importData(env, body?.data);
    return jsonResponse(request, env, 200, {
      message: 'Import successful',
      summary: model.serialize(),
    });
  }

  return jsonResponse(request, env, 404, { error: 'API route not found' });
}

async function handleCategoryRoutes(request, env, pathSegments, method) {
  const model = await loadModel(env);

  if (method === 'GET') {
    const [categoryId] = pathSegments;
    if (!categoryId) {
      return jsonResponse(request, env, 400, { error: 'Category ID is required' });
    }

    const category = model.getCategoryById(categoryId);
    if (!category) {
      return jsonResponse(request, env, 404, { error: 'Category not found' });
    }

    const childHasNotes = new Set(
      model.notes
        .filter((note) => note.content && note.content.trim())
        .map((note) => note.categoryId)
    );
    const children = model.getCategoryChildren(categoryId).map((child) => ({
      ...child,
      hasContent: childHasNotes.has(child.id),
    }));

    return jsonResponse(request, env, 200, {
      category,
      children,
      notes: model.getNotesForCategory(categoryId),
    });
  }

  if (method === 'POST' && pathSegments.length === 0) {
    const body = await readJsonBody(request);
    const category = model.createCategory(body || {});
    await saveModel(env, model);
    return jsonResponse(request, env, 201, { category });
  }

  const [categoryId] = pathSegments;
  if (!categoryId) {
    return jsonResponse(request, env, 400, { error: 'Category ID is required' });
  }

  if (method === 'PATCH') {
    const body = await readJsonBody(request);
    let updated;
    if (body?.newParentId !== undefined) {
      updated = model.moveCategory(categoryId, body.newParentId);
    }
    if (body?.name !== undefined) {
      updated = model.renameCategory(categoryId, body.name);
    }
    if (body?.description !== undefined) {
      updated = model.updateCategoryDescription(categoryId, body.description);
    }
    await saveModel(env, model);
    return jsonResponse(request, env, 200, { category: updated || model.getCategoryById(categoryId) });
  }

  if (method === 'DELETE') {
    const result = model.deleteCategory(categoryId);
    await saveModel(env, model);
    return jsonResponse(request, env, 200, result);
  }

  return jsonResponse(request, env, 405, { error: 'Method not allowed for category' });
}

async function handleNoteRoutes(request, env, pathSegments, method) {
  const model = await loadModel(env);

  if (method === 'POST' && pathSegments.length === 0) {
    const body = await readJsonBody(request);
    const note = model.createNote(body || {});
    await saveModel(env, model);
    return jsonResponse(request, env, 201, { note });
  }

  const [noteId] = pathSegments;
  if (!noteId) {
    return jsonResponse(request, env, 400, { error: 'Note ID is required' });
  }

  if (method === 'PATCH') {
    const body = await readJsonBody(request);
    const note = model.updateNote(noteId, body || {});
    await saveModel(env, model);
    return jsonResponse(request, env, 200, { note });
  }

  if (method === 'DELETE') {
    const result = model.deleteNote(noteId);
    await saveModel(env, model);
    return jsonResponse(request, env, 200, result);
  }

  return jsonResponse(request, env, 405, { error: 'Method not allowed for note' });
}

async function handleAiCommentRoutes(request, env, pathSegments, method) {
  const model = await loadModel(env);

  if (method === 'GET') {
    const [scope, id] = pathSegments;
    if (scope === 'note' && id) {
      return jsonResponse(request, env, 200, { comments: model.getAiCommentsForNote(id) });
    }
    if (scope === 'category' && id) {
      return jsonResponse(request, env, 200, { comments: model.getAiCommentsForCategory(id) });
    }
    if (scope === 'latest') {
      return jsonResponse(request, env, 200, { comments: model.getLatestAiComments(Number(id) || 5) });
    }
    return jsonResponse(request, env, 400, { error: 'Invalid AI comment query' });
  }

  if (method === 'POST' && pathSegments[0] === 'generate') {
    return jsonResponse(request, env, 503, { error: 'AI feedback is disabled for this deployment' });
  }

  if (method === 'PATCH') {
    const [commentId] = pathSegments;
    if (!commentId) {
      return jsonResponse(request, env, 400, { error: 'AI comment ID is required' });
    }
    const body = await readJsonBody(request);
    const comment = model.updateAiComment(commentId, body || {});
    await saveModel(env, model);
    return jsonResponse(request, env, 200, { comment });
  }

  if (method === 'DELETE') {
    const [commentId] = pathSegments;
    if (!commentId) {
      return jsonResponse(request, env, 400, { error: 'AI comment ID is required' });
    }
    const result = model.deleteAiComment(commentId);
    await saveModel(env, model);
    return jsonResponse(request, env, 200, result);
  }

  return jsonResponse(request, env, 405, { error: 'Method not allowed for AI comments' });
}

function handleAiSettingsRoute(request, env, method) {
  if (method !== 'GET') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed for AI settings' });
  }

  return jsonResponse(request, env, 200, {
    ai: {
      enabled: false,
      model: 'disabled',
      endpoint: 'Cloudflare Worker',
      streaming: false,
    },
  });
}

async function loadModel(env) {
  const row = await env.DB
    .prepare('SELECT data FROM brain_state WHERE id = ?')
    .bind(STATE_ID)
    .first();

  if (!row) {
    const model = new BrainModel();
    await saveModel(env, model);
    return model;
  }

  return new BrainModel(JSON.parse(row.data));
}

async function saveModel(env, model) {
  await env.DB
    .prepare(
      `INSERT INTO brain_state (id, data, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .bind(STATE_ID, JSON.stringify(model.serialize()), new Date().toISOString())
    .run();
}

async function importData(env, rawJson) {
  if (!rawJson) {
    throw new Error('No data provided');
  }

  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.notes)) {
    throw new Error('Invalid data format');
  }

  const model = new BrainModel(parsed);
  await saveModel(env, model);
  return model;
}

async function readJsonBody(request) {
  if (!request.body) {
    return {};
  }
  return request.json();
}

function jsonResponse(request, env, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'application/json',
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set(
    (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );

  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Second-Brain-Password',
  };

  if (origin && allowed.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

class BrainModel {
  constructor(initialData = null) {
    const data = initialData || BrainModel.createEmptyData();
    this.categories = Array.isArray(data.categories) ? data.categories : [];
    this.notes = Array.isArray(data.notes) ? data.notes : [];
    this.aiComments = this.normalizeAiComments(data.aiComments || []);
  }

  static createEmptyData() {
    const rootId = crypto.randomUUID();
    const now = new Date().toISOString();
    return {
      categories: [
        {
          id: rootId,
          name: 'Home',
          description: 'Root of your Second Brain',
          parentId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      notes: [],
      aiComments: [],
    };
  }

  serialize() {
    return {
      categories: this.categories,
      notes: this.notes,
      aiComments: this.aiComments,
    };
  }

  getCategoryById(id) {
    return this.categories.find((category) => category.id === id) || null;
  }

  getNoteById(id) {
    return this.notes.find((note) => note.id === id) || null;
  }

  getAiCommentById(id) {
    return this.aiComments.find((comment) => comment.id === id) || null;
  }

  createCategory({ parentId = null, name, description = '' }) {
    if (!name || typeof name !== 'string') {
      throw new Error('Category name is required.');
    }
    if (parentId !== null && !this.getCategoryById(parentId)) {
      throw new Error('Parent category not found.');
    }

    const now = new Date().toISOString();
    const category = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description,
      parentId,
      createdAt: now,
      updatedAt: now,
    };
    this.categories.push(category);
    return category;
  }

  renameCategory(id, newName) {
    const category = this.getCategoryById(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    if (!newName || typeof newName !== 'string') {
      throw new Error('New name is required.');
    }
    category.name = newName.trim();
    category.updatedAt = new Date().toISOString();
    return category;
  }

  updateCategoryDescription(id, newDescription = '') {
    const category = this.getCategoryById(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    category.description = newDescription;
    category.updatedAt = new Date().toISOString();
    return category;
  }

  deleteCategory(id) {
    const category = this.getCategoryById(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    if (category.parentId === null) {
      throw new Error('Cannot delete root category.');
    }

    const idsToDelete = new Set([id, ...this.getDescendantCategoryIds(id)]);
    this.categories = this.categories.filter((cat) => !idsToDelete.has(cat.id));
    this.notes = this.notes.filter((note) => !idsToDelete.has(note.categoryId));
    this.aiComments = this.aiComments.filter((comment) => !idsToDelete.has(comment.categoryId));
    return { deletedCategoryIds: Array.from(idsToDelete) };
  }

  moveCategory(id, newParentId) {
    const category = this.getCategoryById(id);
    if (!category) {
      throw new Error('Category not found.');
    }
    if (category.parentId === null && newParentId === null) {
      return category;
    }
    if (category.parentId === null && newParentId !== null) {
      throw new Error('Cannot move root category.');
    }
    if (newParentId !== null) {
      const newParent = this.getCategoryById(newParentId);
      if (!newParent) {
        throw new Error('New parent category not found.');
      }
      const descendants = new Set(this.getDescendantCategoryIds(id));
      if (descendants.has(newParentId) || newParentId === id) {
        throw new Error('Cannot move category into one of its descendants.');
      }
    }
    category.parentId = newParentId;
    category.updatedAt = new Date().toISOString();
    return category;
  }

  getDescendantCategoryIds(categoryId) {
    const childMap = this.buildChildMap();
    const descendants = [];
    const stack = [...(childMap.get(categoryId) || [])];
    while (stack.length > 0) {
      const currentId = stack.pop();
      descendants.push(currentId);
      stack.push(...(childMap.get(currentId) || []));
    }
    return descendants;
  }

  buildChildMap() {
    const map = new Map();
    this.categories.forEach((category) => {
      if (!map.has(category.parentId)) {
        map.set(category.parentId, []);
      }
      map.get(category.parentId).push(category.id);
    });
    return map;
  }

  createNote({ categoryId, title = '', content = '' }) {
    if (!this.getCategoryById(categoryId)) {
      throw new Error('Category not found for note.');
    }

    const now = new Date().toISOString();
    const note = {
      id: crypto.randomUUID(),
      categoryId,
      title: (title || '').trim(),
      content,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.push(note);
    return note;
  }

  updateNote(id, { title, content }) {
    const note = this.getNoteById(id);
    if (!note) {
      throw new Error('Note not found.');
    }
    if (title !== undefined) {
      note.title = (title || '').trim();
    }
    if (content !== undefined) {
      note.content = content;
    }
    note.updatedAt = new Date().toISOString();
    return note;
  }

  deleteNote(id) {
    const note = this.getNoteById(id);
    if (!note) {
      throw new Error('Note not found.');
    }
    this.notes = this.notes.filter((item) => item.id !== id);
    this.aiComments = this.aiComments.filter((comment) => comment.noteId !== id);
    return { deletedNoteId: id };
  }

  getCategoryChildren(categoryId) {
    return this.categories.filter((category) => category.parentId === categoryId);
  }

  getNotesForCategory(categoryId) {
    return this.notes.filter((note) => note.categoryId === categoryId);
  }

  getBreadcrumb(categoryId) {
    const breadcrumb = [];
    let current = this.getCategoryById(categoryId);
    while (current) {
      breadcrumb.unshift(current);
      current = current.parentId ? this.getCategoryById(current.parentId) : null;
    }
    return breadcrumb;
  }

  normalizeAiComments(rawComments) {
    const latestByCategory = new Map();
    rawComments.forEach((comment) => {
      const normalized = {
        ...comment,
        dismissed: Boolean(comment.dismissed),
      };
      const existing = latestByCategory.get(normalized.categoryId);
      if (!existing || new Date(normalized.createdAt) > new Date(existing.createdAt)) {
        latestByCategory.set(normalized.categoryId, normalized);
      }
    });
    return Array.from(latestByCategory.values());
  }

  getAiCommentsForNote(noteId) {
    return this.aiComments.filter((comment) => comment.noteId === noteId);
  }

  getAiCommentsForCategory(categoryId) {
    return this.aiComments.filter((comment) => comment.categoryId === categoryId);
  }

  getLatestAiComments(limit = 5) {
    return [...this.aiComments]
      .filter((comment) => !comment.dismissed)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  updateAiComment(id, { content, metadata, dismissed }) {
    const comment = this.getAiCommentById(id);
    if (!comment) {
      throw new Error('AI comment not found.');
    }
    if (content !== undefined) {
      comment.content = content;
    }
    if (metadata !== undefined) {
      comment.metadata = metadata;
    }
    if (dismissed !== undefined) {
      comment.dismissed = Boolean(dismissed);
    }
    comment.updatedAt = new Date().toISOString();
    return comment;
  }

  deleteAiComment(id) {
    const existing = this.getAiCommentById(id);
    if (!existing) {
      throw new Error('AI comment not found.');
    }
    this.aiComments = this.aiComments.filter((comment) => comment.id !== id);
    return { deletedAiCommentId: id };
  }

  searchCategoriesByName(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    return this.categories.filter((category) => category.name.toLowerCase().includes(normalized));
  }

  searchByContent(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const matches = new Map();
    this.notes.forEach((note) => {
      const haystack = `${note.title}\n${note.content}`.toLowerCase();
      if (haystack.includes(normalized)) {
        matches.set(note.categoryId, {
          category: this.getCategoryById(note.categoryId),
          notes: [],
        });
      }
    });

    this.categories.forEach((category) => {
      if ((category.description || '').toLowerCase().includes(normalized)) {
        matches.set(category.id, {
          category,
          notes: matches.get(category.id)?.notes || [],
        });
      }
    });

    this.notes.forEach((note) => {
      const haystack = `${note.title}\n${note.content}`.toLowerCase();
      if (haystack.includes(normalized)) {
        const entry = matches.get(note.categoryId) || {
          category: this.getCategoryById(note.categoryId),
          notes: [],
        };
        entry.notes.push(note);
        matches.set(note.categoryId, entry);
      }
    });

    return Array.from(matches.values());
  }
}
