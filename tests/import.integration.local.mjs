import assert from 'node:assert/strict';

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:8788';

async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    return { response, payload: await response.json() };
}

const requestId = crypto.randomUUID();
const backup = {
    projects: [{
        id: 1,
        category: '旧数据类别',
        dept: '迁移测试部',
        name: '旧数据导入测试项目',
        method: '旧数据方式',
        handler: '迁移测试',
        status: '待处理',
        progress: '从 localStorage 导入',
        remark: '-'
    }],
    categories: ['旧数据类别', '旧数据类别'],
    methods: ['旧数据方式', '旧数据方式']
};

let result = await api('/api/admin/import', { method: 'POST', body: { ...backup, requestId } });
assert.equal(result.response.status, 201, JSON.stringify(result.payload));

result = await api('/api/admin/import', { method: 'POST', body: { ...backup, requestId } });
assert.equal(result.response.status, 200, JSON.stringify(result.payload));

const duplicateImport = await api('/api/admin/import', {
    method: 'POST', body: { ...backup, requestId: crypto.randomUUID() }
});
assert.equal(duplicateImport.response.status, 409, JSON.stringify(duplicateImport.payload));

const snapshot = await api('/api/snapshot');
assert.equal(snapshot.payload.projects.length, 1);
assert.equal(snapshot.payload.categories.filter(item => item.is_active).length, 1);
assert.equal(snapshot.payload.methods.filter(item => item.is_active).length, 1);
assert.equal(snapshot.payload.projects[0].name, '旧数据导入测试项目');

const logs = await api('/api/audit-logs?limit=20&cursor=0');
assert.equal(logs.payload.logs.filter(log => log.action === 'import').length, 1);

console.log(JSON.stringify({
    ok: true,
    importedProjects: snapshot.payload.projects.length,
    importLoggedOnce: true,
    duplicateImportBlocked: true
}, null, 2));
