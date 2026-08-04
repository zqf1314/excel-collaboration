PRAGMA foreign_keys = ON;

CREATE TABLE app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    dataset_version INTEGER NOT NULL DEFAULT 0 CHECK (dataset_version >= 0),
    updated_at TEXT NOT NULL
);

INSERT INTO app_state (id, dataset_version, updated_at)
VALUES (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    last_request_id TEXT NOT NULL
);

CREATE TABLE procurement_methods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    last_request_id TEXT NOT NULL
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    category TEXT NOT NULL,
    dept TEXT NOT NULL,
    name TEXT NOT NULL,
    method TEXT NOT NULL,
    handler TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '-',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    last_request_id TEXT NOT NULL
);

CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'category', 'method', 'system')),
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

CREATE INDEX idx_projects_category ON projects(category);
CREATE INDEX idx_projects_dept ON projects(dept);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_handler ON projects(handler);
CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX idx_projects_sort_order ON projects(sort_order ASC);
CREATE INDEX idx_projects_last_request ON projects(last_request_id);
CREATE INDEX idx_categories_active_name ON categories(is_active, name);
CREATE INDEX idx_methods_active_name ON procurement_methods(is_active, name);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC, id DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, id DESC);
