PRAGMA defer_foreign_keys = true;

CREATE TABLE column_definitions (
    id TEXT PRIMARY KEY,
    field_key TEXT UNIQUE,
    column_type TEXT NOT NULL CHECK (column_type IN ('fixed', 'custom')),
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sort_order INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    last_request_id TEXT NOT NULL,
    CHECK (
        (column_type = 'fixed' AND field_key IS NOT NULL)
        OR (column_type = 'custom' AND field_key IS NULL)
    )
);

INSERT INTO column_definitions (
    id, field_key, column_type, name, sort_order, version,
    created_at, created_by, updated_at, updated_by, last_request_id
)
VALUES
    ('fixed_category', 'category', 'fixed', '采购类别', 10, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', 'migration-0002'),
    ('fixed_dept', 'dept', 'fixed', '需求部门', 20, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', 'migration-0002'),
    ('fixed_name', 'name', 'fixed', '项目名称', 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', 'migration-0002'),
    ('fixed_method', 'method', 'fixed', '采购方式', 40, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', 'migration-0002'),
    ('fixed_handler', 'handler', 'fixed', '经办人', 50, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', 'migration-0002'),
    ('fixed_status', 'status', 'fixed', '采购阶段/状态', 60, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', 'migration-0002'),
    ('fixed_progress', 'progress', 'fixed', '最新进展及关键节点说明', 70, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', 'migration-0002'),
    ('fixed_remark', 'remark', 'fixed', '预算/备注说明', 80, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system@localhost.invalid', 'migration-0002');

CREATE TABLE project_custom_values (
    project_id TEXT NOT NULL,
    column_id TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '' CHECK (length(value) <= 2000),
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    PRIMARY KEY (project_id, column_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (column_id) REFERENCES column_definitions(id) ON DELETE CASCADE
);

CREATE INDEX idx_column_definitions_order ON column_definitions(sort_order ASC);
CREATE INDEX idx_project_custom_values_column ON project_custom_values(column_id, project_id);

CREATE TABLE audit_logs_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'category', 'method', 'column', 'system')),
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'deactivate', 'reactivate', 'import')),
    actor_email TEXT NOT NULL,
    actor_name TEXT,
    before_json TEXT,
    after_json TEXT,
    entity_version INTEGER,
    dataset_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

INSERT INTO audit_logs_v2 (
    id, request_id, entity_type, entity_id, action, actor_email, actor_name,
    before_json, after_json, entity_version, dataset_version, created_at
)
SELECT
    id, request_id, entity_type, entity_id, action, actor_email, actor_name,
    before_json, after_json, entity_version, dataset_version, created_at
FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_v2 RENAME TO audit_logs;

CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC, id DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, id DESC);
