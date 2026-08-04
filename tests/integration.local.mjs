import assert from 'node:assert/strict';

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:8787';

async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined
    });
    const payload = response.status === 304 ? null : await response.json();
    return { response, payload };
}

const suffix = Date.now().toString(36);
const categoryName = `集成测试类别-${suffix}`;
const methodName = `集成测试方式-${suffix}`;
const categoryRequestId = crypto.randomUUID();
const methodRequestId = crypto.randomUUID();

let result = await api('/api/categories', { method: 'POST', body: { name: categoryName, requestId: categoryRequestId } });
assert.equal(result.response.status, 201, JSON.stringify(result.payload));
const category = result.payload.entity;

result = await api('/api/methods', { method: 'POST', body: { name: methodName, requestId: methodRequestId } });
assert.equal(result.response.status, 201, JSON.stringify(result.payload));
const methodRecord = result.payload.entity;

const projectRequestId = crypto.randomUUID();
const projectInput = {
    category: categoryName,
    dept: '集成测试部',
    name: `并发控制测试项目-${suffix}`,
    method: methodName,
    handler: '自动测试',
    status: '测试中',
    progress: '版本一',
    remark: '-'
};
result = await api('/api/projects', { method: 'POST', body: { project: projectInput, requestId: projectRequestId } });
assert.equal(result.response.status, 201, JSON.stringify(result.payload));
const created = result.payload.entity;
assert.equal(created.version, 1);

const replay = await api('/api/projects', { method: 'POST', body: { project: projectInput, requestId: projectRequestId } });
assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
assert.equal(replay.payload.entity.id, created.id);

const updateRequestId = crypto.randomUUID();
const updatedInput = { ...projectInput, progress: '版本二' };
result = await api(`/api/projects/${created.id}`, {
    method: 'PUT', body: { project: updatedInput, version: 1, requestId: updateRequestId }
});
assert.equal(result.response.status, 200, JSON.stringify(result.payload));
const updated = result.payload.entity;
assert.equal(updated.version, 2);
assert.equal(updated.progress, '版本二');

const staleUpdate = await api(`/api/projects/${created.id}`, {
    method: 'PUT', body: { project: { ...projectInput, progress: '不应覆盖' }, version: 1, requestId: crypto.randomUUID() }
});
assert.equal(staleUpdate.response.status, 409, JSON.stringify(staleUpdate.payload));
assert.equal(staleUpdate.payload.latest.version, 2);
assert.equal(staleUpdate.payload.latest.progress, '版本二');

const snapshot = await api('/api/snapshot');
assert.equal(snapshot.response.status, 200);
assert.ok(snapshot.payload.projects.some(item => item.id === created.id && item.progress === '版本二'));
const etag = snapshot.response.headers.get('etag');
const unchanged = await api('/api/version', { headers: { 'If-None-Match': etag } });
assert.equal(unchanged.response.status, 304);

const logs = await api('/api/audit-logs?limit=200&cursor=0');
assert.equal(logs.response.status, 200, JSON.stringify(logs.payload));
assert.ok(logs.payload.logs.some(log => log.request_id === projectRequestId && log.action === 'create'));
assert.ok(logs.payload.logs.some(log => log.request_id === updateRequestId && log.action === 'update' && log.before_json && log.after_json));

result = await api(`/api/projects/${created.id}`, {
    method: 'DELETE', body: { version: updated.version, requestId: crypto.randomUUID() }
});
assert.equal(result.response.status, 200, JSON.stringify(result.payload));

await api(`/api/categories/${category.id}`, {
    method: 'DELETE', body: { version: category.version, requestId: crypto.randomUUID() }
});
await api(`/api/methods/${methodRecord.id}`, {
    method: 'DELETE', body: { version: methodRecord.version, requestId: crypto.randomUUID() }
});

console.log(JSON.stringify({
    ok: true,
    createdProject: created.id,
    conflictProtectedVersion: staleUpdate.payload.latest.version,
    audited: true,
    finalRevision: result.payload.revision
}, null, 2));
