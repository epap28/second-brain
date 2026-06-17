const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadData, saveData, exportData, importData } = require('./persistence');
const { generateNoteFeedback } = require('./ai/ollamaClient');
const { createSearchService } = require('./search/searchService');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'docs');
const API_PASSWORD = process.env.SECOND_BRAIN_PASSWORD || '';
const AI_ENABLED = process.env.AI_ENABLED !== 'false';
const DEFAULT_ALLOWED_ORIGINS = ['https://epap28.github.io', 'http://localhost:3000'];
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : DEFAULT_ALLOWED_ORIGINS
  )
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.split('/').filter(Boolean);
  const method = req.method.toUpperCase();

  applyCorsHeaders(req, res);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (segments[0] === 'api') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
      await handleApiRequest(req, res, url, segments);
    } else {
      await serveStaticFile(res, url.pathname);
    }
  } catch (error) {
    console.error('Server error:', error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Second Brain server running at http://localhost:${PORT}`);
});

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Second-Brain-Password');
}

function isAuthorized(req) {
  if (!API_PASSWORD) {
    return true;
  }
  return req.headers['x-second-brain-password'] === API_PASSWORD;
}

async function handleApiRequest(req, res, url, segments) {
  const method = req.method.toUpperCase();
  const resource = segments[1];

  if (resource === 'root' && method === 'GET') {
    const model = loadData();
    const root = model.categories.find((category) => category.parentId === null);
    return sendJson(res, 200, { rootCategory: root });
  }

  if (resource === 'tree' && method === 'GET') {
    const model = loadData();
    return sendJson(res, 200, { categories: model.categories, notes: model.notes });
  }

  if (resource === 'category') {
    return handleCategoryRoutes(req, res, segments.slice(2), method);
  }

  if (resource === 'note') {
    return handleNoteRoutes(req, res, segments.slice(2), method);
  }

  if (resource === 'ai-comments') {
    return handleAiCommentRoutes(req, res, segments.slice(2), method);
  }

  if (resource === 'ai-settings') {
    return handleAiSettingsRoute(res, method);
  }

  if (resource === 'breadcrumb' && method === 'GET') {
    const categoryId = segments[2];
    const model = loadData();
    const breadcrumb = model.getBreadcrumb(categoryId);
    return sendJson(res, 200, { breadcrumb });
  }

  if (resource === 'search' && method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const mode = url.searchParams.get('mode') || 'category';
    const model = loadData();
    const search = createSearchService(model);

    if (mode === 'content') {
      const results = search.searchContent(query);
      return sendJson(res, 200, { mode, query, results });
    }

    const categories = search.searchCategories(query);
    return sendJson(res, 200, { mode: 'category', query, results: categories });
  }

  if (resource === 'export' && method === 'GET') {
    const payload = exportData();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="second-brain-export.json"',
    });
    return res.end(payload);
  }

  if (resource === 'import' && method === 'POST') {
    const body = await readRequestBody(req);
    const { data } = JSON.parse(body || '{}');
    const model = importData(data);
    return sendJson(res, 200, { message: 'Import successful', summary: model.serialize() });
  }

  return sendJson(res, 404, { error: 'API route not found' });
}

async function handleCategoryRoutes(req, res, pathSegments, method) {
  const model = loadData();

  if (method === 'GET') {
    const [categoryId] = pathSegments;
    if (!categoryId) {
      return sendJson(res, 400, { error: 'Category ID is required' });
    }
    const category = model.getCategoryById(categoryId);
    if (!category) {
      return sendJson(res, 404, { error: 'Category not found' });
    }
    const children = model.getCategoryChildren(categoryId);
    const childHasNotes = new Set(
      model.notes
        .filter((note) => note.content && note.content.trim())
        .map((note) => note.categoryId)
    );
    const augmentedChildren = children.map((child) => ({
      ...child,
      hasContent: childHasNotes.has(child.id),
    }));
    const notes = model.getNotesForCategory(categoryId);
    return sendJson(res, 200, { category, children: augmentedChildren, notes });
  }

  if (method === 'POST' && pathSegments.length === 0) {
    const body = await readJsonBody(req);
    const newCategory = model.createCategory(body);
    saveData(model);
    return sendJson(res, 201, { category: newCategory });
  }

  const [categoryId] = pathSegments;
  if (!categoryId) {
    return sendJson(res, 400, { error: 'Category ID is required' });
  }

  if (method === 'PATCH') {
    const body = await readJsonBody(req);
    let updated;
    if (body.newParentId !== undefined) {
      updated = model.moveCategory(categoryId, body.newParentId);
    }
    if (body.name !== undefined) {
      updated = model.renameCategory(categoryId, body.name);
    }
    if (body.description !== undefined) {
      updated = model.updateCategoryDescription(categoryId, body.description);
    }
    saveData(model);
    return sendJson(res, 200, { category: updated || model.getCategoryById(categoryId) });
  }

  if (method === 'DELETE') {
    const result = model.deleteCategory(categoryId);
    saveData(model);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 405, { error: 'Method not allowed for category' });
}

async function handleNoteRoutes(req, res, pathSegments, method) {
  const model = loadData();

  if (method === 'POST' && pathSegments.length === 0) {
    const body = await readJsonBody(req);
    const note = model.createNote(body);
    saveData(model);
    return sendJson(res, 201, { note });
  }

  const [noteId] = pathSegments;
  if (!noteId) {
    return sendJson(res, 400, { error: 'Note ID is required' });
  }

  if (method === 'PATCH') {
    const body = await readJsonBody(req);
    const note = model.updateNote(noteId, body);
    saveData(model);
    return sendJson(res, 200, { note });
  }

  return sendJson(res, 405, { error: 'Method not allowed for note' });
}

async function handleAiCommentRoutes(req, res, pathSegments, method) {
  const model = loadData();

  if (method === 'GET') {
    const [scope, id] = pathSegments;
    if (scope === 'note' && id) {
      return sendJson(res, 200, { comments: model.getAiCommentsForNote(id) });
    }
    if (scope === 'category' && id) {
      return sendJson(res, 200, { comments: model.getAiCommentsForCategory(id) });
    }
    if (scope === 'latest') {
      const limit = Number(id) || 5;
      return sendJson(res, 200, { comments: model.getLatestAiComments(limit) });
    }
    return sendJson(res, 400, { error: 'Invalid AI comment query' });
  }

  if (method === 'POST' && pathSegments[0] === 'generate') {
    if (!AI_ENABLED) {
      return sendJson(res, 503, { error: 'AI feedback is disabled for this deployment' });
    }

    const body = await readJsonBody(req);
    const { noteId } = body || {};
    if (!noteId) {
      return sendJson(res, 400, { error: 'noteId is required' });
    }

    const note = model.getNoteById(noteId);
    if (!note) {
      return sendJson(res, 404, { error: 'Note not found' });
    }
    const category = model.getCategoryById(note.categoryId);

    try {
      const aiResult = await generateNoteFeedback({ category, note });
      const comment = model.createAiComment({
        noteId: note.id,
        categoryId: category?.id || note.categoryId,
        content: aiResult.text,
        model: aiResult.model,
        metadata: aiResult.metadata,
      });
      saveData(model);
      return sendJson(res, 201, { comment });
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }
  }

  if (method === 'PATCH') {
    const [commentId] = pathSegments;
    if (!commentId) {
      return sendJson(res, 400, { error: 'AI comment ID is required' });
    }
    const body = await readJsonBody(req);
    const comment = model.updateAiComment(commentId, body || {});
    saveData(model);
    return sendJson(res, 200, { comment });
  }

  if (method === 'DELETE') {
    const [commentId] = pathSegments;
    if (!commentId) {
      return sendJson(res, 400, { error: 'AI comment ID is required' });
    }
    const result = model.deleteAiComment(commentId);
    saveData(model);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 405, { error: 'Method not allowed for AI comments' });
}

function handleAiSettingsRoute(res, method) {
  if (method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed for AI settings' });
  }

  const status = {
    enabled: AI_ENABLED,
    model: process.env.OLLAMA_MODEL || 'mistral:7b',
    endpoint: process.env.OLLAMA_URL || 'http://localhost:11434',
    streaming: false,
  };

  return sendJson(res, 200, { ai: status });
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  if (!body) {
    return {};
  }
  return JSON.parse(body);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function serveStaticFile(res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, decodeURIComponent(filePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    const ext = path.extname(filePath);
    const mimeType = getMimeType(ext);
    res.writeHead(200, { 'Content-Type': mimeType });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function getMimeType(ext) {
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}
