(function () {
    'use strict';

    class ApiError extends Error {
        constructor(message, status, details) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.details = details;
        }
    }

    const configuredBase = String(window.APP_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
    const localBase = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port && location.port !== '8787'
        ? 'http://localhost:8787'
        : '';
    const baseUrl = configuredBase || localBase;

    async function request(path, options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set('Accept', 'application/json');
        if (options.body !== undefined) headers.set('Content-Type', 'application/json');

        let response;
        try {
            response = await fetch(`${baseUrl}${path}`, {
                method: options.method || 'GET',
                headers,
                credentials: 'include',
                cache: 'no-store',
                body: options.body === undefined ? undefined : JSON.stringify(options.body)
            });
        } catch (error) {
            throw new ApiError('无法连接公共数据服务，请检查网络后重试。', 0, { cause: error.message });
        }

        if (response.status === 304) {
            return { notModified: true, etag: response.headers.get('ETag') };
        }

        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json')
            ? await response.json()
            : { error: await response.text() };

        if (!response.ok) {
            throw new ApiError(payload.error || `请求失败（${response.status}）`, response.status, payload);
        }

        return {
            ...payload,
            etag: response.headers.get('ETag') || payload.etag || null
        };
    }

    function requestId() {
        return crypto.randomUUID();
    }

    window.ApiClient = Object.freeze({
        ApiError,
        baseUrl,
        requestId,
        snapshot: etag => request('/api/snapshot', { headers: etag ? { 'If-None-Match': etag } : {} }),
        version: etag => request('/api/version', { headers: etag ? { 'If-None-Match': etag } : {} }),
        createProject: (project, idempotencyKey = requestId()) => request('/api/projects', {
            method: 'POST', body: { project, requestId: idempotencyKey }
        }),
        updateProject: (id, project, version, idempotencyKey = requestId()) => request(`/api/projects/${encodeURIComponent(id)}`, {
            method: 'PUT', body: { project, version, requestId: idempotencyKey }
        }),
        deleteProject: (id, version, idempotencyKey = requestId()) => request(`/api/projects/${encodeURIComponent(id)}`, {
            method: 'DELETE', body: { version, requestId: idempotencyKey }
        }),
        createCategory: (name, idempotencyKey = requestId()) => request('/api/categories', {
            method: 'POST', body: { name, requestId: idempotencyKey }
        }),
        deactivateCategory: (id, version, idempotencyKey = requestId()) => request(`/api/categories/${encodeURIComponent(id)}`, {
            method: 'DELETE', body: { version, requestId: idempotencyKey }
        }),
        createMethod: (name, idempotencyKey = requestId()) => request('/api/methods', {
            method: 'POST', body: { name, requestId: idempotencyKey }
        }),
        deactivateMethod: (id, version, idempotencyKey = requestId()) => request(`/api/methods/${encodeURIComponent(id)}`, {
            method: 'DELETE', body: { version, requestId: idempotencyKey }
        }),
        createColumn: (name, idempotencyKey = requestId()) => request('/api/columns', {
            method: 'POST', body: { name, requestId: idempotencyKey }
        }),
        updateColumn: (id, name, version, idempotencyKey = requestId()) => request(`/api/columns/${encodeURIComponent(id)}`, {
            method: 'PUT', body: { name, version, requestId: idempotencyKey }
        }),
        auditLogs: (limit = 100, cursor = 0) => request(`/api/audit-logs?limit=${limit}&cursor=${cursor}`),
        importLegacy: (backup, idempotencyKey = requestId()) => request('/api/admin/import', {
            method: 'POST', body: { ...backup, requestId: idempotencyKey }
        })
    });
})();
