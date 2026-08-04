import assert from 'node:assert/strict';
import test from 'node:test';
import {
    HttpError,
    anonymousAccessEnabled,
    csvSet,
    etagFor,
    validateCustomValues,
    validateEntityId,
    validateProject,
    validateRequestId,
    validateVersion
} from '../worker/src/index.js';

const validProject = {
    category: '非招标采购',
    dept: '财务部',
    name: '测试项目',
    method: '询比/比选',
    handler: '测试用户',
    status: '采购准备中',
    progress: '正在准备',
    remark: ''
};

test('项目校验会修剪空格并补齐备注', () => {
    const result = validateProject({ ...validProject, name: '  测试项目  ' });
    assert.equal(result.name, '测试项目');
    assert.equal(result.remark, '-');
    assert.deepEqual(Object.keys(result), ['category', 'dept', 'name', 'method', 'handler', 'status', 'progress', 'remark']);
});

test('项目必填字段和长度由 Worker 统一拦截', () => {
    assert.throws(() => validateProject({ ...validProject, name: '' }), error => error instanceof HttpError && error.status === 422);
    assert.throws(() => validateProject({ ...validProject, progress: 'x'.repeat(2001) }), error => error instanceof HttpError && error.status === 422);
});

test('自定义列只接受当前存在的列 ID，并统一限制内容长度', () => {
    assert.deepEqual(validateCustomValues({ col_a: '  内容  ', col_b: '' }, ['col_a', 'col_b']), {
        col_a: '内容',
        col_b: ''
    });
    assert.equal(validateCustomValues(undefined, ['col_a']), null);
    assert.throws(() => validateCustomValues({ missing: '内容' }, ['col_a']), HttpError);
    assert.throws(() => validateCustomValues({ col_a: 'x'.repeat(2001) }, ['col_a']), HttpError);
});

test('版本、请求 ID 和实体 ID 校验严格', () => {
    assert.equal(validateVersion('3'), 3);
    assert.throws(() => validateVersion(0), HttpError);
    assert.equal(validateRequestId('123e4567-e89b-42d3-a456-426614174000'), '123e4567-e89b-42d3-a456-426614174000');
    assert.throws(() => validateRequestId('not-a-uuid'), HttpError);
    assert.equal(validateEntityId('p_123e4567-e89b-42d3-a456-426614174000'), 'p_123e4567-e89b-42d3-a456-426614174000');
    assert.throws(() => validateEntityId('../secret'), HttpError);
});

test('角色邮箱配置和 ETag 生成稳定', () => {
    assert.deepEqual([...csvSet(' A@EXAMPLE.COM, b@example.com ,,')], ['a@example.com', 'b@example.com']);
    assert.equal(etagFor(12), '"data-12"');
});

test('匿名模式默认开启且只接受明确的 true 或 false', () => {
    assert.equal(anonymousAccessEnabled(), true);
    assert.equal(anonymousAccessEnabled({}), true);
    assert.equal(anonymousAccessEnabled({ ALLOW_ANONYMOUS: 'true' }), true);
    assert.equal(anonymousAccessEnabled({ ALLOW_ANONYMOUS: 'FALSE' }), false);
    assert.throws(() => anonymousAccessEnabled({ ALLOW_ANONYMOUS: 'yes' }), HttpError);
});
