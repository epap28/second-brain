const DEFAULT_ALLOWED_ORIGINS = ['https://epap28.github.io', 'http://localhost:3000'];
const SESSION_DAYS = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (segments[0] !== 'api') {
      return jsonResponse(request, env, 404, { error: 'Not found' });
    }

    try {
      const publicAuthResponse = await handlePublicAuthRoute(request, env, segments, method);
      if (publicAuthResponse) {
        return publicAuthResponse;
      }

      const auth = await authenticateRequest(request, env);
      if (!auth) {
        return jsonResponse(request, env, 401, { error: 'Unauthorized' });
      }

      return await handleApiRequest(request, env, url, segments, auth);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse(request, env, 500, { error: 'Internal server error' });
    }
  },
};

async function handlePublicAuthRoute(request, env, segments, method) {
  if (segments[1] !== 'auth') {
    return null;
  }

  const action = segments[2];

  if (action === 'login' && method === 'POST') {
    return loginUser(request, env);
  }

  if (action === 'register' && method === 'POST') {
    return registerUser(request, env);
  }

  if (action === 'setup' && method === 'POST') {
    return setupFirstAdmin(request, env);
  }

  if (action === 'invite-request' && method === 'POST') {
    return createInviteRequest(request, env);
  }

  return null;
}

async function handleApiRequest(request, env, url, segments, auth) {
  const method = request.method.toUpperCase();
  const resource = segments[1];
  const user = auth.user;

  if (resource === 'root' && method === 'GET') {
    const model = await loadModel(env, user.id);
    const root = model.categories.find((category) => category.parentId === null);
    return jsonResponse(request, env, 200, { rootCategory: root });
  }

  if (resource === 'tree' && method === 'GET') {
    const model = await loadModel(env, user.id);
    return jsonResponse(request, env, 200, { categories: model.categories, notes: model.notes });
  }

  if (resource === 'category') {
    return handleCategoryRoutes(request, env, segments.slice(2), method, user);
  }

  if (resource === 'note') {
    return handleNoteRoutes(request, env, segments.slice(2), method, user);
  }

  if (resource === 'ai-comments') {
    return handleAiCommentRoutes(request, env, segments.slice(2), method, user);
  }

  if (resource === 'ai-settings') {
    return handleAiSettingsRoute(request, env, method);
  }

  if (resource === 'auth') {
    return handleAuthRoutes(request, env, segments.slice(2), method, auth);
  }

  if (resource === 'breadcrumb' && method === 'GET') {
    const categoryId = segments[2];
    const model = await loadModel(env, user.id);
    return jsonResponse(request, env, 200, { breadcrumb: model.getBreadcrumb(categoryId) });
  }

  if (resource === 'search' && method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const mode = url.searchParams.get('mode') || 'category';
    const model = await loadModel(env, user.id);

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
    const model = await loadModel(env, user.id);
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
    const model = await importData(env, user.id, body?.data);
    return jsonResponse(request, env, 200, {
      message: 'Import successful',
      summary: model.serialize(),
    });
  }

  return jsonResponse(request, env, 404, { error: 'API route not found' });
}

async function handleAuthRoutes(request, env, pathSegments, method, auth) {
  if (pathSegments[0] === 'me' && method === 'GET') {
    return jsonResponse(request, env, 200, { user: publicUser(auth.user) });
  }

  if (pathSegments[0] === 'logout' && method === 'POST') {
    await env.DB
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(auth.tokenHash)
      .run();
    return jsonResponse(request, env, 200, { message: 'Logged out' });
  }

  if (!isAdmin(auth.user)) {
    return jsonResponse(request, env, 403, { error: 'Admin access required' });
  }

  if (pathSegments[0] === 'invites' && method === 'POST') {
    return createInviteCode(request, env);
  }

  if (pathSegments[0] === 'invites' && method === 'GET') {
    const rows = await env.DB
      .prepare(
        `SELECT id, code, email, invite_request_id, used_at, created_at
         FROM invite_codes
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .all();
    return jsonResponse(request, env, 200, { invites: rows.results || [] });
  }

  if (pathSegments[0] !== 'invite-requests') {
    return jsonResponse(request, env, 404, { error: 'Auth route not found' });
  }

  if (method === 'GET' && pathSegments.length === 1) {
    const rows = await env.DB
      .prepare(
        `SELECT id, email, message, status, created_at, updated_at
         FROM invite_requests
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .all();
    return jsonResponse(request, env, 200, { requests: rows.results || [] });
  }

  if (method === 'PATCH' && pathSegments[1]) {
    const body = await readJsonBody(request);
    const status = normalizeInviteStatus(body?.status);
    if (!status) {
      return jsonResponse(request, env, 400, { error: 'Invalid invite request status' });
    }

    const updatedAt = new Date().toISOString();
    const result = await env.DB
      .prepare(
        `UPDATE invite_requests
         SET status = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(status, updatedAt, pathSegments[1])
      .run();

    if (!result.meta || result.meta.changes === 0) {
      return jsonResponse(request, env, 404, { error: 'Invite request not found' });
    }

    return jsonResponse(request, env, 200, { id: pathSegments[1], status, updatedAt });
  }

  return jsonResponse(request, env, 405, { error: 'Method not allowed for auth route' });
}

async function setupFirstAdmin(request, env) {
  const existingUsers = await countUsers(env);
  if (existingUsers > 0) {
    return jsonResponse(request, env, 409, { error: 'Setup is already complete' });
  }

  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  const setupToken = typeof body?.setupToken === 'string' ? body.setupToken : '';
  const expectedToken = env.SETUP_TOKEN || env.SECOND_BRAIN_PASSWORD;

  if (!expectedToken || !timingSafeEqual(setupToken, expectedToken)) {
    return jsonResponse(request, env, 401, { error: 'Invalid setup token' });
  }

  if (!email) {
    return jsonResponse(request, env, 400, { error: 'A valid email is required' });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return jsonResponse(request, env, 400, { error: passwordError });
  }

  const user = await createUser(env, { email, password, role: 'admin' });
  const session = await createSession(env, user.id);
  return jsonResponse(request, env, 201, { user: publicUser(user), token: session.token });
}

async function loginUser(request, env) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return jsonResponse(request, env, 400, { error: 'Email and password are required' });
  }

  const user = await env.DB
    .prepare('SELECT id, email, password_hash, password_salt, role, created_at FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    return jsonResponse(request, env, 401, { error: 'Invalid email or password' });
  }

  const session = await createSession(env, user.id);
  return jsonResponse(request, env, 200, { user: publicUser(user), token: session.token });
}

async function registerUser(request, env) {
  const body = await readJsonBody(request);
  const inviteCode = normalizeInviteCode(body?.inviteCode);
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!inviteCode) {
    return jsonResponse(request, env, 400, { error: 'Invitation code is required' });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return jsonResponse(request, env, 400, { error: passwordError });
  }

  const invite = await env.DB
    .prepare(
      `SELECT id, code, email, invite_request_id, used_at
       FROM invite_codes
       WHERE UPPER(code) = ?`
    )
    .bind(inviteCode)
    .first();

  if (!invite || invite.used_at) {
    return jsonResponse(request, env, 400, { error: 'Invalid or already used invitation code' });
  }

  const email = normalizeEmail(invite.email);
  if (!email) {
    return jsonResponse(request, env, 400, { error: 'This invitation code is not linked to an email' });
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return jsonResponse(request, env, 409, { error: 'An account already exists for this email' });
  }

  const role = (await countUsers(env)) === 0 ? 'admin' : 'user';
  const user = await createUser(env, { email, password, role });
  const now = new Date().toISOString();

  await env.DB
    .prepare('UPDATE invite_codes SET used_at = ? WHERE id = ?')
    .bind(now, invite.id)
    .run();

  if (invite.invite_request_id) {
    await env.DB
      .prepare('UPDATE invite_requests SET status = ?, updated_at = ? WHERE id = ?')
      .bind('done', now, invite.invite_request_id)
      .run();
  }

  const session = await createSession(env, user.id);
  return jsonResponse(request, env, 201, { user: publicUser(user), token: session.token });
}

async function createUser(env, { email, password, role }) {
  const passwordRecord = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    email,
    password_hash: passwordRecord.hash,
    password_salt: passwordRecord.salt,
    role,
    created_at: new Date().toISOString(),
  };

  await env.DB
    .prepare(
      `INSERT INTO users (id, email, password_hash, password_salt, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(user.id, user.email, user.password_hash, user.password_salt, user.role, user.created_at)
    .run();

  return user;
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const tokenHash = await hashToken(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await env.DB
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), userId, tokenHash, createdAt.toISOString(), expiresAt.toISOString())
    .run();

  return { token, tokenHash, expiresAt: expiresAt.toISOString() };
}

async function authenticateRequest(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const tokenHash = await hashToken(match[1]);
  const row = await env.DB
    .prepare(
      `SELECT
         sessions.expires_at,
         users.id,
         users.email,
         users.role,
         users.created_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`
    )
    .bind(tokenHash)
    .first();

  if (!row || new Date(row.expires_at) <= new Date()) {
    if (row) {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    }
    return null;
  }

  return {
    tokenHash,
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      created_at: row.created_at,
    },
  };
}

async function createInviteCode(request, env) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const inviteRequestId = typeof body?.inviteRequestId === 'string' ? body.inviteRequestId : '';
  const id = crypto.randomUUID();
  const code = createReadableInviteCode();
  const createdAt = new Date().toISOString();

  await env.DB
    .prepare(
      `INSERT INTO invite_codes (id, code, email, invite_request_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, code, email || null, inviteRequestId || null, createdAt)
    .run();

  if (inviteRequestId) {
    await env.DB
      .prepare(
        `UPDATE invite_requests
         SET status = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind('approved', createdAt, inviteRequestId)
      .run();
  }

  return jsonResponse(request, env, 201, {
    invite: {
      id,
      code,
      email: email || null,
      inviteRequestId: inviteRequestId || null,
      createdAt,
    },
  });
}

async function createInviteRequest(request, env) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body?.email);
  const message = normalizeInviteMessage(body?.message);

  if (!email) {
    return jsonResponse(request, env, 400, { error: 'A valid email is required' });
  }

  const existing = await env.DB
    .prepare('SELECT id FROM invite_requests WHERE email = ? AND status = ?')
    .bind(email, 'pending')
    .first();

  if (existing) {
    return jsonResponse(request, env, 200, {
      message: 'Invite request already pending',
      request: { id: existing.id, email, status: 'pending' },
    });
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO invite_requests (id, email, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, email, message, 'pending', now, now)
    .run();

  return jsonResponse(request, env, 201, {
    message: 'Invite request submitted',
    request: { id, email, status: 'pending' },
  });
}

async function handleCategoryRoutes(request, env, pathSegments, method, user) {
  const model = await loadModel(env, user.id);

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
    await saveModel(env, user.id, model);
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
    await saveModel(env, user.id, model);
    return jsonResponse(request, env, 200, { category: updated || model.getCategoryById(categoryId) });
  }

  if (method === 'DELETE') {
    const result = model.deleteCategory(categoryId);
    await saveModel(env, user.id, model);
    return jsonResponse(request, env, 200, result);
  }

  return jsonResponse(request, env, 405, { error: 'Method not allowed for category' });
}

async function handleNoteRoutes(request, env, pathSegments, method, user) {
  const model = await loadModel(env, user.id);

  if (method === 'POST' && pathSegments.length === 0) {
    const body = await readJsonBody(request);
    const note = model.createNote(body || {});
    await saveModel(env, user.id, model);
    return jsonResponse(request, env, 201, { note });
  }

  const [noteId] = pathSegments;
  if (!noteId) {
    return jsonResponse(request, env, 400, { error: 'Note ID is required' });
  }

  if (method === 'PATCH') {
    const body = await readJsonBody(request);
    const note = model.updateNote(noteId, body || {});
    await saveModel(env, user.id, model);
    return jsonResponse(request, env, 200, { note });
  }

  if (method === 'DELETE') {
    const result = model.deleteNote(noteId);
    await saveModel(env, user.id, model);
    return jsonResponse(request, env, 200, result);
  }

  return jsonResponse(request, env, 405, { error: 'Method not allowed for note' });
}

async function handleAiCommentRoutes(request, env, pathSegments, method, user) {
  const model = await loadModel(env, user.id);

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
    await saveModel(env, user.id, model);
    return jsonResponse(request, env, 200, { comment });
  }

  if (method === 'DELETE') {
    const [commentId] = pathSegments;
    if (!commentId) {
      return jsonResponse(request, env, 400, { error: 'AI comment ID is required' });
    }
    const result = model.deleteAiComment(commentId);
    await saveModel(env, user.id, model);
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

async function loadModel(env, userId) {
  const row = await env.DB
    .prepare('SELECT data FROM user_brain_states WHERE user_id = ?')
    .bind(userId)
    .first();

  if (!row) {
    const existingUserStates = await env.DB.prepare('SELECT COUNT(*) AS count FROM user_brain_states').first();
    if (Number(existingUserStates?.count || 0) === 0) {
      const legacy = await env.DB.prepare('SELECT data FROM brain_state LIMIT 1').first();
      if (legacy?.data) {
        const model = new BrainModel(JSON.parse(legacy.data));
        await saveModel(env, userId, model);
        return model;
      }
    }

    const model = new BrainModel();
    await saveModel(env, userId, model);
    return model;
  }

  return new BrainModel(JSON.parse(row.data));
}

async function saveModel(env, userId, model) {
  await env.DB
    .prepare(
      `INSERT INTO user_brain_states (user_id, data, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .bind(userId, JSON.stringify(model.serialize()), new Date().toISOString())
    .run();
}

async function importData(env, userId, rawJson) {
  if (!rawJson) {
    throw new Error('No data provided');
  }

  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.notes)) {
    throw new Error('Invalid data format');
  }

  const model = new BrainModel(parsed);
  await saveModel(env, userId, model);
  return model;
}

async function countUsers(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  return Number(row?.count || 0);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
  };
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must contain at least 8 characters';
  }
  return '';
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254) {
    return '';
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeInviteCode(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toUpperCase();
}

function normalizeInviteMessage(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, 1000);
}

function normalizeInviteStatus(value) {
  if (!['pending', 'approved', 'rejected', 'done'].includes(value)) {
    return '';
  }
  return value;
}

function createReadableInviteCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .replace(/(.{4})/g, '$1-')
    .replace(/-$/, '')
    .toUpperCase();
}

async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = base64Url(saltBytes);
  const hash = await derivePasswordHash(password, salt);
  return { salt, hash };
}

async function verifyPassword(password, salt, expectedHash) {
  const hash = await derivePasswordHash(password, salt);
  return timingSafeEqual(hash, expectedHash);
}

async function derivePasswordHash(password, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations: 100000,
    },
    key,
    256
  );
  return base64Url(new Uint8Array(bits));
}

async function hashToken(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return base64Url(new Uint8Array(bytes));
}

function randomToken(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
