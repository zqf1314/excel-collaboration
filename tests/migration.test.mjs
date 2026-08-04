import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrationDirectory = new URL('../migrations/', import.meta.url);
const migrationSql = readdirSync(migrationDirectory)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'))
    .join('\n');

test('D1 初始迁移可由 SQLite 完整执行', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(migrationSql);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
    assert.deepEqual(tables.map(row => row.name), [
        'app_state', 'audit_logs', 'categories', 'column_definitions',
        'procurement_methods', 'project_custom_values', 'projects'
    ]);
    const state = db.prepare('SELECT dataset_version FROM app_state WHERE id = 1').get();
    assert.equal(state.dataset_version, 0);
    const columns = db.prepare('SELECT field_key, name FROM column_definitions ORDER BY sort_order').all();
    assert.equal(columns.length, 8);
    assert.deepEqual({ ...columns[0] }, { field_key: 'category', name: '采购类别' });
    db.close();
});

test('数据库约束阻止非法版本和重复请求日志', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(migrationSql);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO audit_logs (
        request_id, entity_type, entity_id, action, actor_email, before_json, after_json,
        entity_version, dataset_version, created_at
    ) VALUES (?, 'system', 'test', 'import', 'test@example.com', NULL, '{}', NULL, 1, ?)`)
        .run('123e4567-e89b-42d3-a456-426614174000', now);
    assert.throws(() => db.prepare(`INSERT INTO audit_logs (
        request_id, entity_type, entity_id, action, actor_email, before_json, after_json,
        entity_version, dataset_version, created_at
    ) VALUES (?, 'system', 'test-2', 'import', 'test@example.com', NULL, '{}', NULL, 1, ?)`)
        .run('123e4567-e89b-42d3-a456-426614174000', now));
    db.prepare(`INSERT INTO audit_logs (
        request_id, entity_type, entity_id, action, actor_email, before_json, after_json,
        entity_version, dataset_version, created_at
    ) VALUES (?, 'column', 'column-test', 'create', 'test@example.com', NULL, '{}', 1, 2, ?)`)
        .run('223e4567-e89b-42d3-a456-426614174000', now);
    db.close();
});
