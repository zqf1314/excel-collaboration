const PROJECT_FIELDS = ['category', 'dept', 'name', 'method', 'handler', 'status', 'progress', 'remark'];
const PROJECT_LIMITS = {
    category: 100,
    dept: 100,
    name: 300,
    method: 100,
    handler: 100,
    status: 120,
    progress: 2000,
    remark: 2000
};
const COLUMN_NAME_LIMIT = 60;
const CUSTOM_VALUE_LIMIT = 2000;
const MAX_CUSTOM_COLUMNS = 30;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
    constructor(status, message, details = {}) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

function csvSet(value) {
    return new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
}

function cleanText(value, field, maxLength, { optional = false } = {}) {
    const text = String(value ?? '').trim();
    if (!optional && !text) throw new HttpError(422, `${field}不能为空`);
    if (text.length > maxLength) throw new HttpError(422, `${field}不能超过 ${maxLength} 个字符`);
    return text;
}

function validateRequestId(value) {
    const requestId = String(value || '').trim();
    if (!REQUEST_ID_PATTERN.test(requestId)) throw new HttpError(422, 'requestId 格式无效');
    return requestId;
}

function validateEntityId(value) {
    const id = String(value || '').trim();
    if (!ENTITY_ID_PATTERN.test(id)) throw new HttpError(422, '记录 ID 格式无效');
    return id;
}

function validateVersion(value) {
    const version = Number(value);
    if (!Number.isInteger(version) || version < 1) throw new HttpError(422, '数据版本无效');
    return version;
}

function validateProject(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(422, '项目数据格式无效');
    const project = {};
    for (const field of PROJECT_FIELDS) {
        project[field] = cleanText(input[field], field, PROJECT_LIMITS[field], { optional: field === 'remark' });
    }
    if (!project.remark) project.remark = '-';
    return project;
}

function validateCustomValues(input, allowedColumnIds) {
    if (input === undefined) return null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new HttpError(422, '自定义列数据格式无效');
    }
    const allowed = new Set(allowedColumnIds);
    const values = {};
    for (const [columnId, rawValue] of Object.entries(input)) {
        if (!ENTITY_ID_PATTERN.test(columnId) || !allowed.has(columnId)) {
            throw new HttpError(422, '包含不存在的自定义列，请刷新页面后重试');
        }
        values[columnId] = cleanText(rawValue, '自定义列内容', CUSTOM_VALUE_LIMIT, { optional: true });
    }
    return values;
}

function projectJsonSql(alias = 'projects') {
    return `json_object(
        'id', ${alias}.id,
        'category', ${alias}.category,
        'dept', ${alias}.dept,
        'name', ${alias}.name,
        'method', ${alias}.method,
        'handler', ${alias}.handler,
        'status', ${alias}.status,
        'progress', ${alias}.progress,
        'remark', ${alias}.remark,
        'version', ${alias}.version,
        'created_at', ${alias}.created_at,
        'created_by', ${alias}.created_by,
        'updated_at', ${alias}.updated_at,
        'updated_by', ${alias}.updated_by,
        'customValues', json(COALESCE((
            SELECT json_group_object(project_custom_values.column_id, project_custom_values.value)
            FROM project_custom_values
            WHERE project_custom_values.project_id = ${alias}.id
        ), '{}'))
    )`;
}

function lookupJsonSql(table) {
    return `json_object(
        'id', ${table}.id,
        'name', ${table}.name,
        'is_active', ${table}.is_active,
        'version', ${table}.version,
        'created_at', ${table}.created_at,
        'created_by', ${table}.created_by,
        'updated_at', ${table}.updated_at,
        'updated_by', ${table}.updated_by
    )`;
}

function columnJsonSql(alias = 'column_definitions') {
    return `json_object(
        'id', ${alias}.id,
        'field_key', ${alias}.field_key,
        'column_type', ${alias}.column_type,
        'name', ${alias}.name,
        'sort_order', ${alias}.sort_order,
        'version', ${alias}.version,
        'created_at', ${alias}.created_at,
        'created_by', ${alias}.created_by,
        'updated_at', ${alias}.updated_at,
        'updated_by', ${alias}.updated_by
    )`;
}

function normalizeOrigin(value) {
    return String(value || '').trim().replace(/\/$/, '');
}

function allowedOrigin(request, env) {
    const origin = normalizeOrigin(request.headers.get('Origin'));
    if (!origin) return '';
    if (origin === new URL(request.url).origin) return origin;
    const allowed = new Set(String(env.ALLOWED_ORIGINS || '').split(',').map(normalizeOrigin).filter(Boolean));
    return allowed.has(origin) ? origin : null;
}

function corsHeaders(origin) {
    const headers = new Headers({
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,If-None-Match',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    });
    if (origin) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Credentials', 'true');
    }
    return headers;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
    const headers = new Headers(extraHeaders);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(payload), { status, headers });
}

function withCors(response, origin) {
    const headers = new Headers(response.headers);
    for (const [key, value] of corsHeaders(origin)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readJson(request) {
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > 1_000_000) throw new HttpError(413, '请求内容过大');
    let body;
    try {
        body = await request.json();
    } catch {
        throw new HttpError(400, '请求 JSON 格式无效');
    }
    return body;
}

function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(normalized);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJwtPart(value) {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function verifyAccessJwt(token, env) {
    const teamDomain = String(env.TEAM_DOMAIN || env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const audience = String(env.POLICY_AUD || env.ACCESS_AUD || '').trim();
    if (!teamDomain || !audience) throw new HttpError(503, 'Cloudflare Access 尚未配置');

    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new HttpError(401, '登录令牌格式无效');
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJwtPart(encodedHeader);
    const payload = decodeJwtPart(encodedPayload);
    if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, '登录令牌算法无效');

    const certResponse = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
        cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (!certResponse.ok) throw new HttpError(503, '无法读取 Cloudflare Access 公钥');
    const certs = await certResponse.json();
    const jwk = (certs.keys || []).find(key => key.kid === header.kid);
    if (!jwk) throw new HttpError(401, '登录令牌签名密钥无效');

    const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
    );
    const validSignature = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        decodeBase64Url(encodedSignature),
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );
    if (!validSignature) throw new HttpError(401, '登录令牌签名无效');

    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const expectedIssuer = `https://${teamDomain}`;
    if (!audiences.includes(audience)
        || payload.iss?.replace(/\/$/, '') !== expectedIssuer
        || !Number.isFinite(payload.exp)
        || payload.exp <= now
        || (payload.nbf && payload.nbf > now)) {
        throw new HttpError(401, '登录令牌已失效或不属于当前应用');
    }
    if (!EMAIL_PATTERN.test(payload.email || '')) throw new HttpError(401, '登录令牌中缺少有效邮箱');
    return { email: payload.email.toLowerCase(), name: payload.name || payload.email };
}

function anonymousAccessEnabled(env = {}) {
    const value = String(env.ALLOW_ANONYMOUS ?? '').trim().toLowerCase();
    if (!value || value === 'true') return true;
    if (value === 'false') return false;
    throw new HttpError(503, 'ALLOW_ANONYMOUS 只能填写 true 或 false');
}

async function getActor(request, env) {
    if (anonymousAccessEnabled(env)) {
        return {
            email: 'public-mode@localhost.invalid',
            name: '公开协作模式',
            role: 'admin'
        };
    }
    const identity = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), env);
    const admins = csvSet(env.ADMIN_EMAILS);
    const readOnly = csvSet(env.READ_ONLY_EMAILS);
    const role = admins.has(identity.email)
        ? 'admin'
        : readOnly.has(identity.email) ? 'viewer' : 'editor';
    return { ...identity, role };
}

function requireEditor(actor) {
    if (!['editor', 'admin'].includes(actor.role)) throw new HttpError(403, '当前账号只有查看权限');
}

function requireAdmin(actor) {
    if (actor.role !== 'admin') throw new HttpError(403, '该操作仅限管理员');
}

function etagFor(version) {
    return `"data-${Number(version)}"`;
}

async function getState(db) {
    const row = await db.prepare('SELECT dataset_version, updated_at FROM app_state WHERE id = 1').first();
    if (!row) throw new HttpError(500, '数据库尚未初始化');
    return { version: Number(row.dataset_version), updatedAt: row.updated_at };
}

async function getProject(db, id) {
    const project = await db.prepare(`SELECT id, category, dept, name, method, handler, status, progress, remark,
        version, created_at, created_by, updated_at, updated_by
        FROM projects WHERE id = ?`).bind(id).first();
    if (!project) return null;
    const values = await db.prepare(`SELECT column_id, value FROM project_custom_values
        WHERE project_id = ?`).bind(id).all();
    project.customValues = Object.fromEntries(values.results.map(item => [item.column_id, item.value]));
    return project;
}

async function getColumn(db, id) {
    return db.prepare(`SELECT id, field_key, column_type, name, sort_order, version,
        created_at, created_by, updated_at, updated_by
        FROM column_definitions WHERE id = ?`).bind(id).first();
}

async function validateProjectCustomValues(db, input) {
    if (input === undefined) return null;
    const result = await db.prepare(`SELECT id FROM column_definitions
        WHERE column_type = 'custom' ORDER BY sort_order ASC`).all();
    return validateCustomValues(input, result.results.map(item => item.id));
}

async function getAuditByRequest(db, requestId) {
    return db.prepare('SELECT entity_type, entity_id, action, dataset_version FROM audit_logs WHERE request_id = ?')
        .bind(requestId).first();
}

async function idempotentResponse(db, requestId) {
    const audit = await getAuditByRequest(db, requestId);
    if (!audit) return null;
    const state = await getState(db);
    let entity = null;
    if (audit.entity_type === 'project') entity = await getProject(db, audit.entity_id);
    if (audit.entity_type === 'category') entity = await db.prepare('SELECT * FROM categories WHERE id = ?').bind(audit.entity_id).first();
    if (audit.entity_type === 'method') entity = await db.prepare('SELECT * FROM procurement_methods WHERE id = ?').bind(audit.entity_id).first();
    if (audit.entity_type === 'column') entity = await getColumn(db, audit.entity_id);
    return { ok: true, idempotent: true, entity, action: audit.action, revision: state.version };
}

async function ensureActiveLookup(db, table, name, currentName = null) {
    if (name === currentName) return;
    const row = await db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND is_active = 1`).bind(name).first();
    if (!row) throw new HttpError(422, table === 'categories' ? '所选采购类别不存在或已停用' : '所选采购方式不存在或已停用');
}

function mutationResponse(entity, revision, status = 200) {
    return jsonResponse({ ok: true, entity, revision: Number(revision) }, status, { ETag: etagFor(revision) });
}

async function handleSnapshot(request, env, actor) {
    const [projectResult, categoryResult, methodResult, columnResult, valueResult, stateResult] = await env.DB.batch([
        env.DB.prepare(`SELECT id, category, dept, name, method, handler, status, progress, remark,
            version, created_at, created_by, updated_at, updated_by
            FROM projects ORDER BY sort_order ASC, created_at ASC`),
        env.DB.prepare(`SELECT id, name, is_active, version, created_at, created_by, updated_at, updated_by
            FROM categories ORDER BY is_active DESC, name COLLATE NOCASE ASC`),
        env.DB.prepare(`SELECT id, name, is_active, version, created_at, created_by, updated_at, updated_by
            FROM procurement_methods ORDER BY is_active DESC, name COLLATE NOCASE ASC`),
        env.DB.prepare(`SELECT id, field_key, column_type, name, sort_order, version,
            created_at, created_by, updated_at, updated_by
            FROM column_definitions ORDER BY sort_order ASC, created_at ASC`),
        env.DB.prepare(`SELECT project_id, column_id, value FROM project_custom_values
            ORDER BY project_id ASC, column_id ASC`),
        env.DB.prepare('SELECT dataset_version, updated_at FROM app_state WHERE id = 1')
    ]);
    const state = stateResult.results[0];
    const etag = etagFor(state.dataset_version);
    if (request.headers.get('If-None-Match') === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
    }
    const valuesByProject = {};
    for (const value of valueResult.results) {
        (valuesByProject[value.project_id] ||= {})[value.column_id] = value.value;
    }
    const snapshotProjects = projectResult.results.map(project => ({
        ...project,
        customValues: valuesByProject[project.id] || {}
    }));
    return jsonResponse({
        revision: Number(state.dataset_version),
        updatedAt: state.updated_at,
        projects: snapshotProjects,
        categories: categoryResult.results,
        methods: methodResult.results,
        columns: columnResult.results,
        actor,
        permissions: { canEdit: actor.role !== 'viewer', canAdmin: actor.role === 'admin' }
    }, 200, { ETag: etag });
}

async function handleVersion(request, env) {
    const state = await getState(env.DB);
    const etag = etagFor(state.version);
    if (request.headers.get('If-None-Match') === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
    }
    return jsonResponse({ revision: state.version, updatedAt: state.updatedAt }, 200, { ETag: etag });
}

async function handleCreateProject(request, env, actor) {
    requireEditor(actor);
    const body = await readJson(request);
    const requestId = validateRequestId(body.requestId);
    const duplicate = await idempotentResponse(env.DB, requestId);
    if (duplicate) return mutationResponse(duplicate.entity, duplicate.revision, 200);
    const project = validateProject(body.project);
    const customValues = (await validateProjectCustomValues(env.DB, body.project?.customValues)) || {};
    await ensureActiveLookup(env.DB, 'categories', project.category);
    await ensureActiveLookup(env.DB, 'procurement_methods', project.method);

    const id = `p_${requestId}`;
    const now = new Date().toISOString();
    let results;
    try {
        const statements = [
            env.DB.prepare(`INSERT INTO projects (
                id, sort_order, category, dept, name, method, handler, status, progress, remark,
                version, created_at, created_by, updated_at, updated_by, last_request_id
            ) VALUES (?, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM projects), ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
                .bind(id, project.category, project.dept, project.name, project.method, project.handler, project.status,
                    project.progress, project.remark, now, actor.email, now, actor.email, requestId),
            ...Object.entries(customValues).filter(([, value]) => value).map(([columnId, value]) =>
                env.DB.prepare(`INSERT INTO project_custom_values (
                    project_id, column_id, value, updated_at, updated_by
                ) VALUES (?, ?, ?, ?, ?)`)
                    .bind(id, columnId, value, now, actor.email)),
            env.DB.prepare(`UPDATE app_state SET dataset_version = dataset_version + 1, updated_at = ?
                WHERE id = 1 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND last_request_id = ?)`)
                .bind(now, id, requestId),
            env.DB.prepare(`INSERT INTO audit_logs (
                request_id, entity_type, entity_id, action, actor_email, actor_name,
                before_json, after_json, entity_version, dataset_version, created_at
            ) SELECT ?, 'project', id, 'create', ?, ?, NULL, ${projectJsonSql('projects')}, version,
                (SELECT dataset_version FROM app_state WHERE id = 1), ?
                FROM projects WHERE id = ? AND last_request_id = ?`)
                .bind(requestId, actor.email, actor.name, now, id, requestId),
            env.DB.prepare('SELECT dataset_version FROM app_state WHERE id = 1')
        ];
        results = await env.DB.batch(statements);
    } catch (error) {
        const replay = await idempotentResponse(env.DB, requestId);
        if (replay) return mutationResponse(replay.entity, replay.revision, 200);
        throw error;
    }
    return mutationResponse(await getProject(env.DB, id), results.at(-1).results[0].dataset_version, 201);
}

async function handleUpdateProject(request, env, actor, id) {
    requireEditor(actor);
    const body = await readJson(request);
    const requestId = validateRequestId(body.requestId);
    const duplicate = await idempotentResponse(env.DB, requestId);
    if (duplicate) return mutationResponse(duplicate.entity, duplicate.revision);
    const expectedVersion = validateVersion(body.version);
    const project = validateProject(body.project);
    const customValues = await validateProjectCustomValues(env.DB, body.project?.customValues);
    const current = await getProject(env.DB, id);
    if (!current) throw new HttpError(404, '项目不存在或已删除');
    if (Number(current.version) !== expectedVersion) throw new HttpError(409, '该项目已被其他同事修改', { latest: current });
    await ensureActiveLookup(env.DB, 'categories', project.category, current.category);
    await ensureActiveLookup(env.DB, 'procurement_methods', project.method, current.method);

    const now = new Date().toISOString();
    let results;
    try {
        const statements = [
            env.DB.prepare(`INSERT INTO audit_logs (
                request_id, entity_type, entity_id, action, actor_email, actor_name,
                before_json, after_json, entity_version, dataset_version, created_at
            ) SELECT ?, 'project', id, 'update', ?, ?, ${projectJsonSql('projects')}, NULL,
                version, 0, ? FROM projects WHERE id = ? AND version = ?`)
                .bind(requestId, actor.email, actor.name, now, id, expectedVersion),
            env.DB.prepare(`UPDATE projects SET category = ?, dept = ?, name = ?, method = ?, handler = ?,
                status = ?, progress = ?, remark = ?, version = version + 1, updated_at = ?, updated_by = ?, last_request_id = ?
                WHERE id = ? AND version = ?`)
                .bind(project.category, project.dept, project.name, project.method, project.handler, project.status,
                    project.progress, project.remark, now, actor.email, requestId, id, expectedVersion),
            ...(customValues === null ? [] : [
                env.DB.prepare('DELETE FROM project_custom_values WHERE project_id = ?').bind(id),
                ...Object.entries(customValues).filter(([, value]) => value).map(([columnId, value]) =>
                    env.DB.prepare(`INSERT INTO project_custom_values (
                        project_id, column_id, value, updated_at, updated_by
                    ) VALUES (?, ?, ?, ?, ?)`)
                        .bind(id, columnId, value, now, actor.email))
            ]),
            env.DB.prepare(`UPDATE app_state SET dataset_version = dataset_version + 1, updated_at = ?
                WHERE id = 1 AND EXISTS (SELECT 1 FROM audit_logs WHERE request_id = ?)`)
                .bind(now, requestId),
            env.DB.prepare(`UPDATE audit_logs SET
                after_json = (SELECT ${projectJsonSql('projects')} FROM projects WHERE id = ? AND last_request_id = ?),
                entity_version = (SELECT version FROM projects WHERE id = ? AND last_request_id = ?),
                dataset_version = (SELECT dataset_version FROM app_state WHERE id = 1)
                WHERE request_id = ?`)
                .bind(id, requestId, id, requestId, requestId),
            env.DB.prepare('SELECT dataset_version FROM app_state WHERE id = 1')
        ];
        results = await env.DB.batch(statements);
    } catch (error) {
        const replay = await idempotentResponse(env.DB, requestId);
        if (replay) return mutationResponse(replay.entity, replay.revision);
        throw error;
    }

    if (Number(results[1].meta.changes) === 0) {
        const latest = await getProject(env.DB, id);
        throw new HttpError(409, '该项目已被其他同事修改', { latest });
    }
    return mutationResponse(await getProject(env.DB, id), results.at(-1).results[0].dataset_version);
}

async function handleDeleteProject(request, env, actor, id) {
    requireEditor(actor);
    const body = await readJson(request);
    const requestId = validateRequestId(body.requestId);
    const duplicate = await idempotentResponse(env.DB, requestId);
    if (duplicate) return mutationResponse(null, duplicate.revision);
    const expectedVersion = validateVersion(body.version);
    const current = await getProject(env.DB, id);
    if (!current) throw new HttpError(404, '项目不存在或已删除');
    if (Number(current.version) !== expectedVersion) throw new HttpError(409, '该项目已被其他同事修改', { latest: current });
    const now = new Date().toISOString();
    let results;
    try {
        results = await env.DB.batch([
            env.DB.prepare(`INSERT INTO audit_logs (
                request_id, entity_type, entity_id, action, actor_email, actor_name,
                before_json, after_json, entity_version, dataset_version, created_at
            ) SELECT ?, 'project', id, 'delete', ?, ?, ${projectJsonSql('projects')}, NULL,
                version, 0, ? FROM projects WHERE id = ? AND version = ?`)
                .bind(requestId, actor.email, actor.name, now, id, expectedVersion),
            env.DB.prepare('DELETE FROM projects WHERE id = ? AND version = ?').bind(id, expectedVersion),
            env.DB.prepare(`UPDATE app_state SET dataset_version = dataset_version + 1, updated_at = ?
                WHERE id = 1 AND EXISTS (SELECT 1 FROM audit_logs WHERE request_id = ?)`)
                .bind(now, requestId),
            env.DB.prepare(`UPDATE audit_logs SET dataset_version = (SELECT dataset_version FROM app_state WHERE id = 1)
                WHERE request_id = ?`).bind(requestId),
            env.DB.prepare('SELECT dataset_version FROM app_state WHERE id = 1')
        ]);
    } catch (error) {
        const replay = await idempotentResponse(env.DB, requestId);
        if (replay) return mutationResponse(null, replay.revision);
        throw error;
    }
    if (Number(results[1].meta.changes) === 0) {
        const latest = await getProject(env.DB, id);
        throw new HttpError(409, '该项目已被其他同事修改', { latest });
    }
    return mutationResponse(null, results[4].results[0].dataset_version);
}

async function createLookup(request, env, actor, type) {
    requireEditor(actor);
    const table = type === 'category' ? 'categories' : 'procurement_methods';
    const label = type === 'category' ? '采购类别' : '采购方式';
    const body = await readJson(request);
    const requestId = validateRequestId(body.requestId);
    const duplicate = await idempotentResponse(env.DB, requestId);
    if (duplicate) return mutationResponse(duplicate.entity, duplicate.revision);
    const name = cleanText(body.name, label, 100);
    const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE name = ? COLLATE NOCASE`).bind(name).first();
    if (existing?.is_active) throw new HttpError(409, `${label}已存在`);
    const now = new Date().toISOString();
    const id = existing?.id || `${type === 'category' ? 'c' : 'm'}_${requestId}`;
    const action = existing ? 'reactivate' : 'create';
    const jsonSql = lookupJsonSql(table);
    let results;

    try {
        const statements = existing ? [
            env.DB.prepare(`INSERT INTO audit_logs (
                request_id, entity_type, entity_id, action, actor_email, actor_name,
                before_json, after_json, entity_version, dataset_version, created_at
            ) SELECT ?, ?, id, 'reactivate', ?, ?, ${jsonSql}, NULL, version, 0, ?
                FROM ${table} WHERE id = ? AND version = ? AND is_active = 0`)
                .bind(requestId, type, actor.email, actor.name, now, id, Number(existing.version)),
            env.DB.prepare(`UPDATE ${table} SET is_active = 1, version = version + 1,
                updated_at = ?, updated_by = ?, last_request_id = ?
                WHERE id = ? AND version = ? AND is_active = 0`)
                .bind(now, actor.email, requestId, id, Number(existing.version))
        ] : [
            env.DB.prepare(`INSERT INTO ${table} (
                id, name, is_active, version, created_at, created_by, updated_at, updated_by, last_request_id
            ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`)
                .bind(id, name, now, actor.email, now, actor.email, requestId),
            env.DB.prepare(`INSERT INTO audit_logs (
                request_id, entity_type, entity_id, action, actor_email, actor_name,
                before_json, after_json, entity_version, dataset_version, created_at
            ) SELECT ?, ?, id, 'create', ?, ?, NULL, ${jsonSql}, version, 0, ?
                FROM ${table} WHERE id = ? AND last_request_id = ?`)
                .bind(requestId, type, actor.email, actor.name, now, id, requestId)
        ];

        statements.push(
            env.DB.prepare(`UPDATE app_state SET dataset_version = dataset_version + 1, updated_at = ?
                WHERE id = 1 AND EXISTS (SELECT 1 FROM audit_logs WHERE request_id = ?)`)
                .bind(now, requestId),
            env.DB.prepare(`UPDATE audit_logs SET
                after_json = (SELECT ${jsonSql} FROM ${table} WHERE id = ?),
                entity_version = (SELECT version FROM ${table} WHERE id = ?),
                dataset_version = (SELECT dataset_version FROM app_state WHERE id = 1)
                WHERE request_id = ?`).bind(id, id, requestId),
            env.DB.prepare(`SELECT id, name, is_active, version, created_at, created_by, updated_at, updated_by
                FROM ${table} WHERE id = ?`).bind(id),
            env.DB.prepare('SELECT dataset_version FROM app_state WHERE id = 1')
        );
        results = await env.DB.batch(statements);
    } catch (error) {
        const replay = await idempotentResponse(env.DB, requestId);
        if (replay) return mutationResponse(replay.entity, replay.revision);
        if (String(error.message).toLowerCase().includes('unique')) throw new HttpError(409, `${label}已存在`);
        throw error;
    }
    const entityResult = results[results.length - 2];
    const stateResult = results[results.length - 1];
    if (!entityResult.results[0]) throw new HttpError(409, `${label}已被其他同事修改`);
    return mutationResponse(entityResult.results[0], stateResult.results[0].dataset_version, action === 'create' ? 201 : 200);
}

async function deactivateLookup(request, env, actor, type, id) {
    requireEditor(actor);
    const table = type === 'category' ? 'categories' : 'procurement_methods';
    const label = type === 'category' ? '采购类别' : '采购方式';
    const body = await readJson(request);
    const requestId = validateRequestId(body.requestId);
    const duplicate = await idempotentResponse(env.DB, requestId);
    if (duplicate) return mutationResponse(duplicate.entity, duplicate.revision);
    const expectedVersion = validateVersion(body.version);
    const current = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
    if (!current || !current.is_active) throw new HttpError(404, `${label}不存在或已停用`);
    if (Number(current.version) !== expectedVersion) throw new HttpError(409, `${label}已被其他同事修改`, { latest: current });
    const now = new Date().toISOString();
    const jsonSql = lookupJsonSql(table);
    const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO audit_logs (
            request_id, entity_type, entity_id, action, actor_email, actor_name,
            before_json, after_json, entity_version, dataset_version, created_at
        ) SELECT ?, ?, id, 'deactivate', ?, ?, ${jsonSql}, NULL, version, 0, ?
            FROM ${table} WHERE id = ? AND version = ? AND is_active = 1
            AND (SELECT COUNT(*) FROM ${table} WHERE is_active = 1) > 1`)
            .bind(requestId, type, actor.email, actor.name, now, id, expectedVersion),
        env.DB.prepare(`UPDATE ${table} SET is_active = 0, version = version + 1,
            updated_at = ?, updated_by = ?, last_request_id = ?
            WHERE id = ? AND version = ? AND is_active = 1
            AND (SELECT COUNT(*) FROM ${table} WHERE is_active = 1) > 1`)
            .bind(now, actor.email, requestId, id, expectedVersion),
        env.DB.prepare(`UPDATE app_state SET dataset_version = dataset_version + 1, updated_at = ?
            WHERE id = 1 AND EXISTS (SELECT 1 FROM audit_logs WHERE request_id = ?)`)
            .bind(now, requestId),
        env.DB.prepare(`UPDATE audit_logs SET
            after_json = (SELECT ${jsonSql} FROM ${table} WHERE id = ?),
            entity_version = (SELECT version FROM ${table} WHERE id = ?),
            dataset_version = (SELECT dataset_version FROM app_state WHERE id = 1)
            WHERE request_id = ?`).bind(id, id, requestId),
        env.DB.prepare(`SELECT id, name, is_active, version, created_at, created_by, updated_at, updated_by
            FROM ${table} WHERE id = ?`).bind(id),
        env.DB.prepare('SELECT dataset_version FROM app_state WHERE id = 1')
    ]);
    if (Number(results[1].meta.changes) === 0) {
        const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE is_active = 1`).first();
        if (Number(count.count) <= 1) throw new HttpError(422, `至少保留一个${label}`);
        const latest = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
        throw new HttpError(409, `${label}已被其他同事修改`, { latest });
    }
    return mutationResponse(results[4].results[0], results[5].results[0].dataset_version);
}

async function handleCreateColumn(request, env, actor) {
    requireAdmin(actor);
    const body = await readJson(request);
    const requestId = validateRequestId(body.requestId);
    const duplicate = await idempotentResponse(env.DB, requestId);
    if (duplicate) return mutationResponse(duplicate.entity, duplicate.revision);
    const name = cleanText(body.name, '列名称', COLUMN_NAME_LIMIT);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM column_definitions
        WHERE column_type = 'custom'`).first();
    if (Number(count.count) >= MAX_CUSTOM_COLUMNS) {
        throw new HttpError(422, `最多可新增 ${MAX_CUSTOM_COLUMNS} 个自定义列`);
    }

    const id = `col_${requestId}`;
    const now = new Date().toISOString();
    let results;
    try {
        results = await env.DB.batch([
            env.DB.prepare(`INSERT INTO column_definitions (
                id, field_key, column_type, name, sort_order, version,
                created_at, created_by, updated_at, updated_by, last_request_id
            ) SELECT ?, NULL, 'custom', ?,
                (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM column_definitions),
                1, ?, ?, ?, ?, ?
                WHERE (SELECT COUNT(*) FROM column_definitions WHERE column_type = 'custom') < ?`)
                .bind(id, name, now, actor.email, now, actor.email, requestId, MAX_CUSTOM_COLUMNS),
            env.DB.prepare(`INSERT INTO audit_logs (
                request_id, entity_type, entity_id, action, actor_email, actor_name,
                before_json, after_json, entity_version, dataset_version, created_at
            ) SELECT ?, 'column', id, 'create', ?, ?, NULL, ${columnJsonSql()}, version, 0, ?
                FROM column_definitions WHERE id = ? AND last_request_id = ?`)
                .bind(requestId, actor.email, actor.name, now, id, requestId),
            env.DB.prepare(`UPDATE app_state SET dataset_version = dataset_version + 1, updated_at = ?
                WHERE id = 1 AND EXISTS (SELECT 1 FROM audit_logs WHERE request_id = ?)`)
                .bind(now, requestId),
            env.DB.prepare(`UPDATE audit_logs SET dataset_version = (SELECT dataset_version FROM app_state WHERE id = 1)
                WHERE request_id = ?`).bind(requestId),
            env.DB.prepare(`SELECT id, field_key, column_type, name, sort_order, version,
                created_at, created_by, updated_at, updated_by
                FROM column_definitions WHERE id = ?`).bind(id),
            env.DB.prepare('SELECT dataset_version FROM app_state WHERE id = 1')
        ]);
    } catch (error) {
        const replay = await idempotentResponse(env.DB, requestId);
        if (replay) return mutationResponse(replay.entity, replay.revision);
        if (String(error.message).toLowerCase().includes('unique')) throw new HttpError(409, '列名称已存在');
        throw error;
    }
    if (Number(results[0].meta.changes) === 0) {
        throw new HttpError(422, `最多可新增 ${MAX_CUSTOM_COLUMNS} 个自定义列`);
    }
    return mutationResponse(results[4].results[0], results[5].results[0].dataset_version, 201);
}

async function handleUpdateColumn(request, env, actor, id) {
    requireAdmin(actor);
    const body = await readJson(request);
    const requestId = validateRequestId(body.requestId);
    const duplicate = await idempotentResponse(env.DB, requestId);
    if (duplicate) return mutationResponse(duplicate.entity, duplicate.revision);
    const expectedVersion = validateVersion(body.version);
    const name = cleanText(body.name, '列名称', COLUMN_NAME_LIMIT);
    const current = await getColumn(env.DB, id);
    if (!current) throw new HttpError(404, '表格列不存在');
    if (Number(current.version) !== expectedVersion) {
        throw new HttpError(409, '该列已被其他同事修改', { latest: current });
    }

    const now = new Date().toISOString();
    let results;
    try {
        results = await env.DB.batch([
            env.DB.prepare(`INSERT INTO audit_logs (
                request_id, entity_type, entity_id, action, actor_email, actor_name,
                before_json, after_json, entity_version, dataset_version, created_at
            ) SELECT ?, 'column', id, 'update', ?, ?, ${columnJsonSql()}, NULL, version, 0, ?
                FROM column_definitions WHERE id = ? AND version = ?`)
                .bind(requestId, actor.email, actor.name, now, id, expectedVersion),
            env.DB.prepare(`UPDATE column_definitions SET name = ?, version = version + 1,
                updated_at = ?, updated_by = ?, last_request_id = ?
                WHERE id = ? AND version = ?`)
                .bind(name, now, actor.email, requestId, id, expectedVersion),
            env.DB.prepare(`UPDATE app_state SET dataset_version = dataset_version + 1, updated_at = ?
                WHERE id = 1 AND EXISTS (SELECT 1 FROM audit_logs WHERE request_id = ?)`)
                .bind(now, requestId),
            env.DB.prepare(`UPDATE audit_logs SET
                after_json = (SELECT ${columnJsonSql()} FROM column_definitions WHERE id = ?),
                entity_version = (SELECT version FROM column_definitions WHERE id = ?),
                dataset_version = (SELECT dataset_version FROM app_state WHERE id = 1)
                WHERE request_id = ?`).bind(id, id, requestId),
            env.DB.prepare(`SELECT id, field_key, column_type, name, sort_order, version,
                created_at, created_by, updated_at, updated_by
                FROM column_definitions WHERE id = ?`).bind(id),
            env.DB.prepare('SELECT dataset_version FROM app_state WHERE id = 1')
        ]);
    } catch (error) {
        const replay = await idempotentResponse(env.DB, requestId);
        if (replay) return mutationResponse(replay.entity, replay.revision);
        if (String(error.message).toLowerCase().includes('unique')) throw new HttpError(409, '列名称已存在');
        throw error;
    }
    if (Number(results[1].meta.changes) === 0) {
        throw new HttpError(409, '该列已被其他同事修改', { latest: await getColumn(env.DB, id) });
    }
    return mutationResponse(results[4].results[0], results[5].results[0].dataset_version);
}

async function handleAuditLogs(url, env, actor) {
    requireAdmin(actor);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200);
    const cursor = Math.max(Number(url.searchParams.get('cursor')) || 0, 0);
    const baseSql = `SELECT id, request_id, entity_type, entity_id, action,
        actor_email, actor_name, before_json, after_json, entity_version, dataset_version, created_at
        FROM audit_logs`;
    const result = cursor > 0
        ? await env.DB.prepare(`${baseSql} WHERE id < ? ORDER BY id DESC LIMIT ?`).bind(cursor, limit).all()
        : await env.DB.prepare(`${baseSql} ORDER BY id DESC LIMIT ?`).bind(limit).all();
    return jsonResponse({ logs: result.results, nextCursor: result.results.at(-1)?.id || null });
}

function uniqueLegacyId(rawId, index, used) {
    const base = `legacy_${String(rawId ?? index + 1).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70)}`;
    let id = base;
    let suffix = 1;
    while (used.has(id)) id = `${base}_${suffix++}`;
    used.add(id);
    return id;
}

async function handleLegacyImport(request, env, actor) {
    requireAdmin(actor);
    const body = await readJson(request);
    const requestId = validateRequestId(body.requestId);
    const duplicate = await idempotentResponse(env.DB, requestId);
    if (duplicate) {
        const state = await getState(env.DB);
        return mutationResponse(null, state.version);
    }
    if (!Array.isArray(body.projects) || body.projects.length > 200) throw new HttpError(422, '旧项目数据必须为不超过 200 条的数组');
    const currentCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM projects').first();
    if (Number(currentCount.count) > 0) throw new HttpError(409, '公共数据库已有项目，已阻止重复导入');

    const validatedProjects = body.projects.map(validateProject);
    const categoryNames = new Map();
    const methodNames = new Map();
    const addUniqueName = (target, value, label) => {
        const name = cleanText(value, label, 100);
        if (!target.has(name.toLocaleLowerCase())) target.set(name.toLocaleLowerCase(), name);
    };
    (Array.isArray(body.categories) ? body.categories : []).forEach(value => addUniqueName(categoryNames, value, '采购类别'));
    (Array.isArray(body.methods) ? body.methods : []).forEach(value => addUniqueName(methodNames, value, '采购方式'));
    validatedProjects.forEach(project => {
        addUniqueName(categoryNames, project.category, '采购类别');
        addUniqueName(methodNames, project.method, '采购方式');
    });
    if (!categoryNames.size || !methodNames.size) throw new HttpError(422, '旧数据缺少采购类别或采购方式');

    const now = new Date().toISOString();
    const usedIds = new Set();
    const statements = [];
    [...categoryNames.values()].forEach((name, index) => {
        statements.push(env.DB.prepare(`INSERT INTO categories (
            id, name, is_active, version, created_at, created_by, updated_at, updated_by, last_request_id
        ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET is_active = 1, updated_at = excluded.updated_at,
            updated_by = excluded.updated_by, last_request_id = excluded.last_request_id`)
            .bind(`legacy_category_${index + 1}`, name, now, actor.email, now, actor.email, requestId));
    });
    [...methodNames.values()].forEach((name, index) => {
        statements.push(env.DB.prepare(`INSERT INTO procurement_methods (
            id, name, is_active, version, created_at, created_by, updated_at, updated_by, last_request_id
        ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET is_active = 1, updated_at = excluded.updated_at,
            updated_by = excluded.updated_by, last_request_id = excluded.last_request_id`)
            .bind(`legacy_method_${index + 1}`, name, now, actor.email, now, actor.email, requestId));
    });
    validatedProjects.forEach((project, index) => {
        const id = uniqueLegacyId(body.projects[index]?.id, index, usedIds);
        statements.push(env.DB.prepare(`INSERT INTO projects (
            id, sort_order, category, dept, name, method, handler, status, progress, remark,
            version, created_at, created_by, updated_at, updated_by, last_request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
            .bind(id, index, project.category, project.dept, project.name, project.method, project.handler,
                project.status, project.progress, project.remark, now, actor.email, now, actor.email, requestId));
    });
    statements.push(
        env.DB.prepare('UPDATE app_state SET dataset_version = dataset_version + 1, updated_at = ? WHERE id = 1').bind(now),
        env.DB.prepare(`INSERT INTO audit_logs (
            request_id, entity_type, entity_id, action, actor_email, actor_name,
            before_json, after_json, entity_version, dataset_version, created_at
        ) VALUES (?, 'system', 'legacy-import', 'import', ?, ?, NULL, ?, NULL,
            (SELECT dataset_version FROM app_state WHERE id = 1), ?)`)
            .bind(requestId, actor.email, actor.name, JSON.stringify({ projectCount: validatedProjects.length, categoryCount: categoryNames.size, methodCount: methodNames.size }), now),
        env.DB.prepare('SELECT dataset_version FROM app_state WHERE id = 1')
    );

    let results;
    try {
        results = await env.DB.batch(statements);
    } catch (error) {
        const replay = await idempotentResponse(env.DB, requestId);
        if (!replay) throw error;
        const state = await getState(env.DB);
        return mutationResponse(null, state.version);
    }
    return mutationResponse(null, results.at(-1).results[0].dataset_version, 201);
}

async function routeRequest(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
        return jsonResponse({ ok: true, service: 'procurement-tracker-api' });
    }
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, '接口不存在');
    const actor = await getActor(request, env);

    if (request.method === 'GET' && url.pathname === '/api/snapshot') return handleSnapshot(request, env, actor);
    if (request.method === 'GET' && url.pathname === '/api/version') return handleVersion(request, env);
    if (request.method === 'GET' && url.pathname === '/api/audit-logs') return handleAuditLogs(url, env, actor);
    if (request.method === 'POST' && url.pathname === '/api/projects') return handleCreateProject(request, env, actor);
    if (request.method === 'POST' && url.pathname === '/api/categories') return createLookup(request, env, actor, 'category');
    if (request.method === 'POST' && url.pathname === '/api/methods') return createLookup(request, env, actor, 'method');
    if (request.method === 'POST' && url.pathname === '/api/columns') return handleCreateColumn(request, env, actor);
    if (request.method === 'POST' && url.pathname === '/api/admin/import') return handleLegacyImport(request, env, actor);

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
        const id = validateEntityId(decodeURIComponent(projectMatch[1]));
        if (request.method === 'PUT') return handleUpdateProject(request, env, actor, id);
        if (request.method === 'DELETE') return handleDeleteProject(request, env, actor, id);
    }
    const categoryMatch = url.pathname.match(/^\/api\/categories\/([^/]+)$/);
    if (categoryMatch && request.method === 'DELETE') {
        return deactivateLookup(request, env, actor, 'category', validateEntityId(decodeURIComponent(categoryMatch[1])));
    }
    const methodMatch = url.pathname.match(/^\/api\/methods\/([^/]+)$/);
    if (methodMatch && request.method === 'DELETE') {
        return deactivateLookup(request, env, actor, 'method', validateEntityId(decodeURIComponent(methodMatch[1])));
    }
    const columnMatch = url.pathname.match(/^\/api\/columns\/([^/]+)$/);
    if (columnMatch && request.method === 'PUT') {
        return handleUpdateColumn(request, env, actor, validateEntityId(decodeURIComponent(columnMatch[1])));
    }
    throw new HttpError(404, '接口不存在');
}

export default {
    async fetch(request, env) {
        const origin = allowedOrigin(request, env);
        if (origin === null) return withCors(jsonResponse({ error: '该来源不允许访问接口' }, 403), '');
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
        try {
            return withCors(await routeRequest(request, env), origin);
        } catch (error) {
            if (error instanceof HttpError) {
                return withCors(jsonResponse({ error: error.message, ...error.details }, error.status), origin);
            }
            console.error('Unhandled API error', error);
            const message = String(error?.message || '');
            const databaseNotReady = /no such table|d1_error/i.test(message)
                && /app_state|projects|categories|audit_logs|column_definitions|project_custom_values/i.test(message);
            return withCors(jsonResponse({
                error: databaseNotReady ? '数据库尚未执行迁移' : '服务器暂时无法完成请求'
            }, databaseNotReady ? 503 : 500), origin);
        }
    }
};

export {
    HttpError,
    anonymousAccessEnabled,
    cleanText,
    csvSet,
    etagFor,
    validateEntityId,
    validateCustomValues,
    validateProject,
    validateRequestId,
    validateVersion
};
