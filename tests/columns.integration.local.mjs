import assert from 'node:assert/strict';

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:8787';

async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    return { response, payload: await response.json() };
}

const suffix = Date.now().toString(36);
let result = await api('/api/snapshot');
assert.equal(result.response.status, 200, JSON.stringify(result.payload));
assert.equal(result.payload.columns.filter(column => column.column_type === 'fixed').length, 8);

const fixedCategory = result.payload.columns.find(column => column.field_key === 'category');
result = await api(`/api/columns/${fixedCategory.id}`, {
    method: 'PUT',
    body: { name: '采购类别（测试）', version: fixedCategory.version, requestId: crypto.randomUUID() }
});
assert.equal(result.response.status, 200, JSON.stringify(result.payload));
assert.equal(result.payload.entity.name, '采购类别（测试）');
result = await api(`/api/columns/${fixedCategory.id}`, {
    method: 'PUT',
    body: { name: '采购类别', version: result.payload.entity.version, requestId: crypto.randomUUID() }
});
assert.equal(result.response.status, 200, JSON.stringify(result.payload));

const createColumnRequestId = crypto.randomUUID();
result = await api('/api/columns', {
    method: 'POST', body: { name: `合同编号-${suffix}`, requestId: createColumnRequestId }
});
assert.equal(result.response.status, 201, JSON.stringify(result.payload));
const column = result.payload.entity;

const replay = await api('/api/columns', {
    method: 'POST', body: { name: `合同编号-${suffix}`, requestId: createColumnRequestId }
});
assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
assert.equal(replay.payload.entity.id, column.id);

result = await api(`/api/columns/${column.id}`, {
    method: 'PUT', body: { name: `合同编码-${suffix}`, version: 1, requestId: crypto.randomUUID() }
});
assert.equal(result.response.status, 200, JSON.stringify(result.payload));
const renamedColumn = result.payload.entity;
assert.equal(renamedColumn.version, 2);

const staleColumnUpdate = await api(`/api/columns/${column.id}`, {
    method: 'PUT', body: { name: '不应覆盖', version: 1, requestId: crypto.randomUUID() }
});
assert.equal(staleColumnUpdate.response.status, 409, JSON.stringify(staleColumnUpdate.payload));
assert.equal(staleColumnUpdate.payload.latest.name, `合同编码-${suffix}`);

const categoryName = `列测试类别-${suffix}`;
const methodName = `列测试方式-${suffix}`;
result = await api('/api/categories', { method: 'POST', body: { name: categoryName, requestId: crypto.randomUUID() } });
assert.equal(result.response.status, 201, JSON.stringify(result.payload));
const category = result.payload.entity;
result = await api('/api/methods', { method: 'POST', body: { name: methodName, requestId: crypto.randomUUID() } });
assert.equal(result.response.status, 201, JSON.stringify(result.payload));
const methodRecord = result.payload.entity;

const projectInput = {
    category: categoryName,
    dept: '列功能测试部',
    name: `自定义列测试项目-${suffix}`,
    method: methodName,
    handler: '自动测试',
    status: '测试中',
    progress: '验证新增列',
    remark: '-',
    customValues: { [column.id]: 'HT-001' }
};
const projectRequestId = crypto.randomUUID();
result = await api('/api/projects', { method: 'POST', body: { project: projectInput, requestId: projectRequestId } });
assert.equal(result.response.status, 201, JSON.stringify(result.payload));
const project = result.payload.entity;
assert.equal(project.customValues[column.id], 'HT-001');

result = await api(`/api/projects/${project.id}`, {
    method: 'PUT',
    body: {
        project: { ...projectInput, customValues: { [column.id]: 'HT-002' } },
        version: project.version,
        requestId: crypto.randomUUID()
    }
});
assert.equal(result.response.status, 200, JSON.stringify(result.payload));
assert.equal(result.payload.entity.customValues[column.id], 'HT-002');
const updatedProject = result.payload.entity;

const snapshot = await api('/api/snapshot');
assert.equal(snapshot.response.status, 200, JSON.stringify(snapshot.payload));
assert.ok(snapshot.payload.columns.some(item => item.id === column.id && item.name === `合同编码-${suffix}`));
assert.equal(snapshot.payload.projects.find(item => item.id === project.id).customValues[column.id], 'HT-002');

const logs = await api('/api/audit-logs?limit=200&cursor=0');
assert.equal(logs.response.status, 200, JSON.stringify(logs.payload));
assert.ok(logs.payload.logs.some(log => log.entity_type === 'column' && log.entity_id === column.id));
assert.ok(logs.payload.logs.some(log => log.request_id === projectRequestId && log.after_json.includes('HT-001')));

await api(`/api/projects/${project.id}`, {
    method: 'DELETE', body: { version: updatedProject.version, requestId: crypto.randomUUID() }
});
await api(`/api/categories/${category.id}`, {
    method: 'DELETE', body: { version: category.version, requestId: crypto.randomUUID() }
});
await api(`/api/methods/${methodRecord.id}`, {
    method: 'DELETE', body: { version: methodRecord.version, requestId: crypto.randomUUID() }
});

console.log(JSON.stringify({
    ok: true,
    fixedColumnRenamed: true,
    customColumnCreated: column.id,
    projectCustomValueSynced: true,
    staleColumnUpdateBlocked: true
}, null, 2));
