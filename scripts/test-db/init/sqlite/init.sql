-- =============================================================================
-- SQLite Test Database Init Script
-- Target: SQLite 3.31+ (for generated columns)
-- Purpose: Comprehensive coverage of SQLite design elements
-- Adapted from PostgreSQL init.sql (~23 tables, views, triggers, indexes)
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- =============================================================================
-- 1. TABLES (23 tables in FK-dependency topological order)
-- =============================================================================

-- --------------------------------------------------------------------------
-- 1.1 roles
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.2 users (with generated column full_name)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    full_name     TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    email         TEXT NOT NULL UNIQUE,
    age           INTEGER CHECK (age >= 0 AND age <= 200),
    password_hash TEXT NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.3 user_profiles (1:1 with users, JSON preferences)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    bio         TEXT,
    avatar_url  TEXT,
    preferences TEXT NOT NULL DEFAULT '{}',
    street      TEXT,
    city        TEXT,
    state       TEXT,
    postal_code TEXT,
    country     TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.4 user_roles (M:N join, composite PK)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, role_id)
);

-- --------------------------------------------------------------------------
-- 1.5 organizations (self-referencing hierarchy)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    parent_org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.6 org_members
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_members (
    id        TEXT PRIMARY KEY,
    org_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.7 categories (self-referencing tree, 3 levels)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    slug       TEXT NOT NULL UNIQUE,
    parent_id  TEXT REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE,
    depth      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.8 tags
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.9 products (with JSON metadata)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE,
    price       REAL NOT NULL CHECK (price >= 0),
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    metadata    TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.10 product_variants (composite unique constraint)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
    id              TEXT PRIMARY KEY,
    product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    sku             TEXT NOT NULL,
    name            TEXT NOT NULL,
    price_override  REAL,
    stock_quantity  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (product_id, sku)
);

-- --------------------------------------------------------------------------
-- 1.11 product_images
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_images (
    id         TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    url        TEXT NOT NULL,
    alt_text   TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.12 product_tags (M:N join)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_tags (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (product_id, tag_id)
);

-- --------------------------------------------------------------------------
-- 1.13 orders (no partitioning in SQLite; enum via CHECK)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
    total_amount     REAL,
    shipping_street  TEXT,
    shipping_city    TEXT,
    shipping_state   TEXT,
    shipping_postal  TEXT,
    shipping_country TEXT,
    notes            TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.14 order_items (CHECK quantity > 0)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id                 TEXT PRIMARY KEY,
    order_id           TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
    product_variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    quantity           INTEGER NOT NULL CHECK (quantity > 0),
    unit_price         REAL NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.15 payments (enum via CHECK for method and status)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id             TEXT PRIMARY KEY,
    order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    method         TEXT NOT NULL CHECK (method IN ('credit_card', 'debit_card', 'bank_transfer', 'paypal', 'crypto')),
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'refunded')),
    amount         REAL NOT NULL,
    transaction_id TEXT,
    paid_at        TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.16 shipping_addresses (CASCADE / NO ACTION FK)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipping_addresses (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    label       TEXT,
    street      TEXT NOT NULL,
    city        TEXT NOT NULL,
    state       TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country     TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.17 inventory (no warehouse FK since we skip warehouses)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
    id                 TEXT PRIMARY KEY,
    product_variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE ON UPDATE CASCADE,
    warehouse_name     TEXT NOT NULL,
    quantity           INTEGER NOT NULL CHECK (quantity >= 0),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (product_variant_id, warehouse_name)
);

-- --------------------------------------------------------------------------
-- 1.18 posts
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    title        TEXT NOT NULL,
    body         TEXT,
    is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
    published_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.19 comments (self-referencing parent_comment_id)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
    id                TEXT PRIMARY KEY,
    post_id           TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    parent_comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL ON UPDATE NO ACTION,
    body              TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.20 notifications (SET DEFAULT FK to system user)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES users(id) ON DELETE SET DEFAULT ON UPDATE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('order', 'payment', 'system', 'promotion', 'alert')),
    title      TEXT NOT NULL,
    message    TEXT,
    is_read    INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.21 settings (key-value store)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    id          TEXT PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    value       TEXT,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.22 api_keys
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    key_value  TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- 1.23 migrations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migrations (
    id         TEXT PRIMARY KEY,
    version    TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- =============================================================================
-- 2. INDEXES
-- =============================================================================

-- B-Tree indexes on FK columns
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id);
CREATE INDEX IF NOT EXISTS idx_organizations_parent_org_id ON organizations (parent_org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON org_members (org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members (user_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_tags_tag_id ON product_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_variant_id ON order_items (product_variant_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_addresses_user_id ON shipping_addresses (user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product_variant_id ON inventory (product_variant_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments (post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments (user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_comment_id ON comments (parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);

-- Common query indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (is_read);
CREATE INDEX IF NOT EXISTS idx_posts_is_published ON posts (is_published);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_value ON api_keys (key_value);

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_order_items_order_variant ON order_items (order_id, product_variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_variant_warehouse ON inventory (product_variant_id, warehouse_name);
CREATE INDEX IF NOT EXISTS idx_comments_post_parent ON comments (post_id, parent_comment_id);

-- Unique expression index (case-insensitive key lookup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_lower_key ON settings (lower(key));

-- Partial index: only active products
CREATE INDEX IF NOT EXISTS idx_products_active ON products (name) WHERE is_active = 1;

-- Expression index: case-insensitive email
CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (lower(email));

-- =============================================================================
-- 3. VIEWS
-- =============================================================================

-- Regular view: user summary
CREATE VIEW IF NOT EXISTS v_user_summary AS
SELECT
    u.id,
    u.full_name,
    u.email,
    u.is_active,
    u.created_at,
    COUNT(DISTINCT o.id) AS total_orders,
    COALESCE(SUM(o.total_amount), 0) AS total_spent,
    COUNT(DISTINCT p.id) AS total_posts
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
LEFT JOIN posts p ON p.user_id = u.id
GROUP BY u.id, u.full_name, u.email, u.is_active, u.created_at;

-- Regular view: active products (no WITH CHECK OPTION in SQLite)
CREATE VIEW IF NOT EXISTS v_active_products AS
SELECT
    id,
    name,
    description,
    category_id,
    price,
    is_active,
    metadata,
    created_at,
    updated_at
FROM products
WHERE is_active = 1;

-- =============================================================================
-- 4. TRIGGERS (AFTER UPDATE for updated_at)
-- =============================================================================

-- SQLite triggers use UPDATE statements (no NEW assignment outside of triggers on views)

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
    AFTER UPDATE ON users
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_user_profiles_updated_at
    AFTER UPDATE ON user_profiles
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE user_profiles SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_organizations_updated_at
    AFTER UPDATE ON organizations
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE organizations SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_products_updated_at
    AFTER UPDATE ON products
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_updated_at
    AFTER UPDATE ON orders
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_posts_updated_at
    AFTER UPDATE ON posts
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE posts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_comments_updated_at
    AFTER UPDATE ON comments
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE comments SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_settings_updated_at
    AFTER UPDATE ON settings
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_roles_updated_at
    AFTER UPDATE ON roles
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE roles SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_updated_at
    AFTER UPDATE ON inventory
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE inventory SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

-- =============================================================================
-- 5. SEED DATA
-- =============================================================================

-- --------------------------------------------------------------------------
-- 5.1 Roles (4 rows)
-- --------------------------------------------------------------------------
INSERT INTO roles (id, name, description) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'admin',    'Full system access'),
    ('a0000000-0000-0000-0000-000000000002', 'manager',  'Team and content management'),
    ('a0000000-0000-0000-0000-000000000003', 'user',     'Standard user access'),
    ('a0000000-0000-0000-0000-000000000004', 'readonly', 'Read-only access');

-- --------------------------------------------------------------------------
-- 5.2 Users (10 rows, including system user)
-- --------------------------------------------------------------------------
INSERT INTO users (id, first_name, last_name, email, age, password_hash, is_active, created_at) VALUES
    ('00000000-0000-0000-0000-000000000000', 'System',  'User',     'system@testdb.local',    0,   '$2b$10$placeholder_system_hash',  1, '2024-01-01T00:00:00Z'),
    ('b0000000-0000-0000-0000-000000000001', 'Alice',   'Johnson',  'alice@example.com',      30,  '$2b$10$placeholder_pass123_hash', 1, '2025-01-10T08:00:00Z'),
    ('b0000000-0000-0000-0000-000000000002', 'Bob',     'Smith',    'bob@example.com',        25,  '$2b$10$placeholder_pass123_hash', 1, '2025-01-15T09:00:00Z'),
    ('b0000000-0000-0000-0000-000000000003', 'Charlie', 'Brown',    'charlie@example.com',    35,  '$2b$10$placeholder_pass123_hash', 1, '2025-02-01T10:00:00Z'),
    ('b0000000-0000-0000-0000-000000000004', 'Diana',   'Prince',   'diana@example.com',      28,  '$2b$10$placeholder_pass123_hash', 1, '2025-02-10T11:00:00Z'),
    ('b0000000-0000-0000-0000-000000000005', 'Eve',     'Williams', 'eve@example.com',        32,  '$2b$10$placeholder_pass123_hash', 0, '2025-03-01T12:00:00Z'),
    ('b0000000-0000-0000-0000-000000000006', 'Frank',   'Miller',   'frank@example.com',      40,  '$2b$10$placeholder_pass123_hash', 1, '2025-03-15T13:00:00Z'),
    ('b0000000-0000-0000-0000-000000000007', 'Grace',   'Lee',      'grace@example.com',      27,  '$2b$10$placeholder_pass123_hash', 1, '2025-04-01T14:00:00Z'),
    ('b0000000-0000-0000-0000-000000000008', 'Henry',   'Kim',      'henry@example.com',      45,  '$2b$10$placeholder_pass123_hash', 1, '2025-04-15T15:00:00Z'),
    ('b0000000-0000-0000-0000-000000000009', 'Iris',    'Chen',     'iris@example.com',       22,  '$2b$10$placeholder_pass123_hash', 1, '2025-05-01T16:00:00Z');

-- --------------------------------------------------------------------------
-- 5.3 User Profiles (10 rows with JSON preferences)
-- --------------------------------------------------------------------------
INSERT INTO user_profiles (id, user_id, bio, avatar_url, preferences, street, city, state, postal_code, country) VALUES
    ('aa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'System account',           NULL,                                    '{"theme": "dark", "lang": "en"}',                                          '1 System St',        'Cloud',         'NA',        '00000',    'US'),
    ('aa000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Software engineer at NYC', 'https://cdn.test.com/avatars/alice.jpg',  '{"theme": "light", "lang": "en", "notifications": true}',                  '123 Main St',        'New York',      'NY',        '10001',    'US'),
    ('aa000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'Designer from London',     'https://cdn.test.com/avatars/bob.jpg',    '{"theme": "dark", "lang": "en", "notifications": false}',                  '45 Oxford Rd',       'London',        'England',   'W1D 1BS',  'GB'),
    ('aa000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'Product manager',          'https://cdn.test.com/avatars/charlie.jpg', '{"theme": "auto", "lang": "ko", "timezone": "Asia/Seoul"}',               '789 Gangnam-daero',  'Seoul',         'Seoul',     '06053',    'KR'),
    ('aa000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'Data scientist',           NULL,                                    '{"theme": "dark", "lang": "en", "dashboard_layout": "grid"}',              '321 Tech Blvd',      'San Francisco', 'CA',        '94105',    'US'),
    ('aa000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000005', 'Inactive user',            NULL,                                    '{}',                                                                        '555 Elm St',         'Chicago',       'IL',        '60601',    'US'),
    ('aa000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000006', 'Operations lead',          'https://cdn.test.com/avatars/frank.jpg',  '{"theme": "light", "lang": "de", "currency": "EUR"}',                     '88 Berliner Str',    'Berlin',        'Berlin',    '10115',    'DE'),
    ('aa000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000007', 'Frontend developer',       'https://cdn.test.com/avatars/grace.jpg',  '{"theme": "dark", "lang": "ja", "editor": "vim"}',                        '12 Shibuya',         'Tokyo',         'Tokyo',     '150-0002', 'JP'),
    ('aa000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000008', 'CTO at startup',           'https://cdn.test.com/avatars/henry.jpg',  '{"theme": "light", "lang": "ko", "notifications": true, "beta": true}',   '456 Teheran-ro',     'Seoul',         'Seoul',     '06159',    'KR'),
    ('aa000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000009', 'Junior developer',         NULL,                                    '{"theme": "auto", "lang": "zh", "onboarding_complete": false}',            '99 Nanjing Rd',      'Shanghai',      'Shanghai',  '200001',   'CN');

-- --------------------------------------------------------------------------
-- 5.4 User Roles mappings (9 rows)
-- --------------------------------------------------------------------------
INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2025-01-10T08:00:00Z'),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', '2025-01-15T09:00:00Z'),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', '2025-02-01T10:00:00Z'),
    ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', '2025-02-10T11:00:00Z'),
    ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', '2025-03-01T12:00:00Z'),
    ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', '2025-03-15T13:00:00Z'),
    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', '2025-04-01T14:00:00Z'),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', '2025-04-15T15:00:00Z'),
    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000004', '2025-05-01T16:00:00Z');

-- --------------------------------------------------------------------------
-- 5.5 Organizations (5 rows: 2 parents + 3 children)
-- --------------------------------------------------------------------------
INSERT INTO organizations (id, name, parent_org_id, created_at) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Rockury Corp',        NULL,                                   '2025-01-01T00:00:00Z'),
    ('c0000000-0000-0000-0000-000000000002', 'Acme Holdings',       NULL,                                   '2025-01-01T00:00:00Z'),
    ('c0000000-0000-0000-0000-000000000003', 'Rockury Engineering', 'c0000000-0000-0000-0000-000000000001', '2025-02-01T00:00:00Z'),
    ('c0000000-0000-0000-0000-000000000004', 'Rockury Marketing',   'c0000000-0000-0000-0000-000000000001', '2025-02-01T00:00:00Z'),
    ('c0000000-0000-0000-0000-000000000005', 'Acme Research',       'c0000000-0000-0000-0000-000000000002', '2025-03-01T00:00:00Z');

-- --------------------------------------------------------------------------
-- 5.6 Org Members (7 rows)
-- --------------------------------------------------------------------------
INSERT INTO org_members (id, org_id, user_id, role, joined_at) VALUES
    ('bb000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'admin',  '2025-01-10T08:00:00Z'),
    ('bb000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'member', '2025-01-15T09:00:00Z'),
    ('bb000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'admin',  '2025-02-01T10:00:00Z'),
    ('bb000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004', 'member', '2025-02-10T11:00:00Z'),
    ('bb000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000006', 'admin',  '2025-03-15T13:00:00Z'),
    ('bb000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000008', 'admin',  '2025-04-15T15:00:00Z'),
    ('bb000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000007', 'viewer', '2025-04-01T14:00:00Z');

-- --------------------------------------------------------------------------
-- 5.7 Categories (8 rows, 3 levels deep)
-- --------------------------------------------------------------------------
INSERT INTO categories (id, name, slug, parent_id, depth) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'Electronics',    'electronics',    NULL,                                   0),
    ('d0000000-0000-0000-0000-000000000002', 'Clothing',       'clothing',       NULL,                                   0),
    ('d0000000-0000-0000-0000-000000000003', 'Books',          'books',          NULL,                                   0),
    ('d0000000-0000-0000-0000-000000000004', 'Smartphones',    'smartphones',    'd0000000-0000-0000-0000-000000000001', 1),
    ('d0000000-0000-0000-0000-000000000005', 'Laptops',        'laptops',        'd0000000-0000-0000-0000-000000000001', 1),
    ('d0000000-0000-0000-0000-000000000006', 'Men',            'men',            'd0000000-0000-0000-0000-000000000002', 1),
    ('d0000000-0000-0000-0000-000000000007', 'Android Phones', 'android-phones', 'd0000000-0000-0000-0000-000000000004', 2),
    ('d0000000-0000-0000-0000-000000000008', 'Gaming Laptops', 'gaming-laptops', 'd0000000-0000-0000-0000-000000000005', 2);

-- --------------------------------------------------------------------------
-- 5.8 Tags (6 rows)
-- --------------------------------------------------------------------------
INSERT INTO tags (id, name) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'new-arrival'),
    ('e0000000-0000-0000-0000-000000000002', 'best-seller'),
    ('e0000000-0000-0000-0000-000000000003', 'sale'),
    ('e0000000-0000-0000-0000-000000000004', 'limited-edition'),
    ('e0000000-0000-0000-0000-000000000005', 'eco-friendly'),
    ('e0000000-0000-0000-0000-000000000006', 'premium');

-- --------------------------------------------------------------------------
-- 5.9 Products (15 rows with JSON metadata)
-- --------------------------------------------------------------------------
INSERT INTO products (id, name, description, category_id, price, is_active, metadata, created_at) VALUES
    ('f0000000-0000-0000-0000-000000000001', 'Galaxy S25',         'Latest Samsung flagship',             'd0000000-0000-0000-0000-000000000004', 999.99,  1, '{"weight": "0.187kg", "color": "black", "storage": ["128GB", "256GB"]}',           '2025-01-20T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000002', 'iPhone 16 Pro',      'Apple premium smartphone',            'd0000000-0000-0000-0000-000000000004', 1199.99, 1, '{"weight": "0.199kg", "color": "titanium", "storage": ["256GB", "512GB", "1TB"]}', '2025-01-25T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000003', 'Pixel 9',            'Google AI-powered phone',             'd0000000-0000-0000-0000-000000000007', 899.00,  1, '{"weight": "0.198kg", "color": "obsidian", "ai_features": true}',                  '2025-02-01T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000004', 'MacBook Pro 16',     'M4 Pro chip laptop',                  'd0000000-0000-0000-0000-000000000005', 2499.00, 1, '{"weight": "2.14kg", "color": "space-black", "ram": ["18GB", "36GB"]}',            '2025-02-10T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000005', 'ThinkPad X1 Carbon', 'Lenovo business ultrabook',           'd0000000-0000-0000-0000-000000000005', 1849.00, 1, '{"weight": "1.12kg", "color": "black", "screen": "14 inch"}',                      '2025-02-15T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000006', 'ROG Strix G16',      'ASUS gaming laptop',                  'd0000000-0000-0000-0000-000000000008', 1599.00, 1, '{"weight": "2.5kg", "color": "eclipse-gray", "gpu": "RTX 4070"}',                  '2025-03-01T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000007', 'Classic Oxford Shirt','Premium cotton dress shirt',          'd0000000-0000-0000-0000-000000000006', 79.99,   1, '{"material": "100% cotton", "fit": "regular", "care": "machine wash"}',            '2025-03-05T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000008', 'Slim Fit Chinos',    'Stretch cotton chinos',               'd0000000-0000-0000-0000-000000000006', 59.99,   1, '{"material": "98% cotton 2% elastane", "fit": "slim"}',                            '2025-03-10T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000009', 'Wool Blazer',        'Italian wool blend blazer',           'd0000000-0000-0000-0000-000000000006', 299.99,  1, '{"material": "wool blend", "color": "navy", "lining": "full"}',                    '2025-03-15T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000010', 'Clean Code',         'Robert C. Martin',                    'd0000000-0000-0000-0000-000000000003', 39.99,   1, '{"isbn": "978-0132350884", "pages": 464, "format": "hardcover"}',                  '2025-03-20T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000011', 'DDIA',               'Designing Data-Intensive Applications','d0000000-0000-0000-0000-000000000003', 44.99,   1, '{"isbn": "978-1449373320", "pages": 616, "format": "paperback"}',                  '2025-03-25T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000012', 'Wireless Earbuds',   'Active noise cancellation',           'd0000000-0000-0000-0000-000000000001', 149.99,  1, '{"weight": "0.005kg", "battery": "8h", "bluetooth": "5.3"}',                       '2025-04-01T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000013', 'USB-C Hub',          '7-in-1 adapter',                      'd0000000-0000-0000-0000-000000000001', 49.99,   1, '{"ports": ["HDMI", "USB-A x3", "SD", "microSD", "USB-C PD"], "weight": "0.08kg"}', '2025-04-05T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000014', 'Mechanical Keyboard','Cherry MX switches',                  'd0000000-0000-0000-0000-000000000001', 129.99,  0, '{"switches": "Cherry MX Brown", "layout": "TKL", "backlight": "RGB"}',             '2025-04-10T00:00:00Z'),
    ('f0000000-0000-0000-0000-000000000015', 'Ergonomic Mouse',    'Vertical design for comfort',         'd0000000-0000-0000-0000-000000000001', 69.99,   1, '{"dpi": 4000, "buttons": 6, "wireless": true, "weight": "0.12kg"}',                '2025-04-15T00:00:00Z');

-- --------------------------------------------------------------------------
-- 5.10 Product Variants (25 rows)
-- --------------------------------------------------------------------------
INSERT INTO product_variants (id, product_id, sku, name, price_override, stock_quantity, created_at) VALUES
    ('10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'GS25-128-BLK',  'Galaxy S25 128GB Black',       NULL,    50,  '2025-01-20T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'GS25-256-BLK',  'Galaxy S25 256GB Black',       1099.99, 30,  '2025-01-20T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000002', 'IP16P-256-TI',  'iPhone 16 Pro 256GB Titanium', NULL,    40,  '2025-01-25T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000002', 'IP16P-512-TI',  'iPhone 16 Pro 512GB Titanium', 1399.99, 20,  '2025-01-25T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000003', 'PX9-128-OBS',   'Pixel 9 128GB Obsidian',       NULL,    35,  '2025-02-01T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000004', 'MBP16-M4P-18',  'MacBook Pro 16 M4 Pro 18GB',   NULL,    15,  '2025-02-10T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000004', 'MBP16-M4P-36',  'MacBook Pro 16 M4 Pro 36GB',   2999.00, 10,  '2025-02-10T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000005', 'TPX1C-16-BLK',  'ThinkPad X1 Carbon 16GB',      NULL,    25,  '2025-02-15T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000006', 'ROG-G16-4070',  'ROG Strix G16 RTX 4070',       NULL,    20,  '2025-03-01T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000007', 'OXF-S-WHT',     'Oxford Shirt S White',         NULL,    100, '2025-03-05T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000007', 'OXF-M-WHT',     'Oxford Shirt M White',         NULL,    80,  '2025-03-05T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000012', 'f0000000-0000-0000-0000-000000000007', 'OXF-L-BLU',     'Oxford Shirt L Blue',          84.99,   60,  '2025-03-05T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000013', 'f0000000-0000-0000-0000-000000000008', 'CHI-30-KHK',    'Chinos 30 Khaki',              NULL,    70,  '2025-03-10T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000014', 'f0000000-0000-0000-0000-000000000008', 'CHI-32-NVY',    'Chinos 32 Navy',               NULL,    55,  '2025-03-10T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000015', 'f0000000-0000-0000-0000-000000000009', 'BLZ-M-NVY',     'Blazer M Navy',                NULL,    30,  '2025-03-15T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000016', 'f0000000-0000-0000-0000-000000000009', 'BLZ-L-NVY',     'Blazer L Navy',                NULL,    25,  '2025-03-15T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000017', 'f0000000-0000-0000-0000-000000000010', 'CC-HC-EN',      'Clean Code Hardcover EN',      NULL,    200, '2025-03-20T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000018', 'f0000000-0000-0000-0000-000000000011', 'DDIA-PB-EN',    'DDIA Paperback EN',            NULL,    150, '2025-03-25T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000019', 'f0000000-0000-0000-0000-000000000012', 'WEB-BLK',       'Wireless Earbuds Black',       NULL,    90,  '2025-04-01T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000020', 'f0000000-0000-0000-0000-000000000012', 'WEB-WHT',       'Wireless Earbuds White',       NULL,    85,  '2025-04-01T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000013', 'USBC-HUB-GRY',  'USB-C Hub Gray',               NULL,    120, '2025-04-05T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000022', 'f0000000-0000-0000-0000-000000000014', 'KB-TKL-BRN',    'Keyboard TKL Brown',           NULL,    40,  '2025-04-10T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000023', 'f0000000-0000-0000-0000-000000000014', 'KB-TKL-RED',    'Keyboard TKL Red',             NULL,    35,  '2025-04-10T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000024', 'f0000000-0000-0000-0000-000000000015', 'MOUSE-ERG-BLK', 'Ergonomic Mouse Black',        NULL,    75,  '2025-04-15T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000025', 'f0000000-0000-0000-0000-000000000015', 'MOUSE-ERG-WHT', 'Ergonomic Mouse White',        74.99,   60,  '2025-04-15T00:00:00Z');

-- --------------------------------------------------------------------------
-- 5.11 Product Images (8 rows)
-- --------------------------------------------------------------------------
INSERT INTO product_images (id, product_id, url, alt_text, sort_order) VALUES
    ('cc000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'https://cdn.test.com/products/gs25-front.jpg',  'Galaxy S25 front view',  1),
    ('cc000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'https://cdn.test.com/products/gs25-back.jpg',   'Galaxy S25 back view',   2),
    ('cc000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000002', 'https://cdn.test.com/products/ip16p-front.jpg', 'iPhone 16 Pro front',    1),
    ('cc000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000004', 'https://cdn.test.com/products/mbp16-open.jpg',  'MacBook Pro 16 open',    1),
    ('cc000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000006', 'https://cdn.test.com/products/rog-top.jpg',     'ROG Strix top view',     1),
    ('cc000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000007', 'https://cdn.test.com/products/oxford.jpg',      'Classic Oxford Shirt',   1),
    ('cc000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000010', 'https://cdn.test.com/products/clean-code.jpg',  'Clean Code cover',       1),
    ('cc000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000012', 'https://cdn.test.com/products/earbuds.jpg',     'Wireless Earbuds',       1);

-- --------------------------------------------------------------------------
-- 5.12 Product Tags (M:N mappings, 15 rows)
-- --------------------------------------------------------------------------
INSERT INTO product_tags (product_id, tag_id) VALUES
    ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001'),
    ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006'),
    ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001'),
    ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002'),
    ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000006'),
    ('f0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001'),
    ('f0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000002'),
    ('f0000000-0000-0000-0000-000000000007', 'e0000000-0000-0000-0000-000000000005'),
    ('f0000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-000000000004'),
    ('f0000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-000000000006'),
    ('f0000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-000000000002'),
    ('f0000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-000000000002'),
    ('f0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000003'),
    ('f0000000-0000-0000-0000-000000000014', 'e0000000-0000-0000-0000-000000000003'),
    ('f0000000-0000-0000-0000-000000000015', 'e0000000-0000-0000-0000-000000000005');

-- --------------------------------------------------------------------------
-- 5.13 Orders (20 rows)
-- --------------------------------------------------------------------------
INSERT INTO orders (id, user_id, status, total_amount, shipping_street, shipping_city, shipping_state, shipping_postal, shipping_country, notes, created_at) VALUES
    ('20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'delivered',  1099.99, '123 Main St',       'New York',      'NY',       '10001',  'US', 'Gift wrap please',  '2025-01-25T10:00:00Z'),
    ('20000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'delivered',  1199.99, '45 Oxford Rd',      'London',        'England',  'W1D 1BS','GB', NULL,                '2025-02-10T11:00:00Z'),
    ('20000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'delivered',  2499.00, '123 Main St',       'New York',      'NY',       '10001',  'US', 'Express shipping',  '2025-02-20T14:00:00Z'),
    ('20000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'shipped',    899.00,  '789 Gangnam-daero', 'Seoul',         'Seoul',    '06053',  'KR', NULL,                '2025-03-05T09:00:00Z'),
    ('20000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'confirmed',  159.98,  '321 Tech Blvd',     'San Francisco', 'CA',       '94105',  'US', NULL,                '2025-03-15T16:00:00Z'),
    ('20000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'processing', 339.98,  '123 Main St',       'New York',      'NY',       '10001',  'US', 'Two items',         '2025-04-01T08:00:00Z'),
    ('20000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000006', 'pending',    79.99,   '88 Berliner Str',   'Berlin',        'Berlin',   '10115',  'DE', NULL,                '2025-04-15T12:00:00Z'),
    ('20000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000007', 'cancelled',  59.99,   '12 Shibuya',        'Tokyo',         'Tokyo',    '150-0002','JP','Changed my mind',   '2025-05-01T10:00:00Z'),
    ('20000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000008', 'delivered',  2999.00, '456 Teheran-ro',    'Seoul',         'Seoul',    '06159',  'KR', NULL,                '2025-05-15T14:00:00Z'),
    ('20000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000009', 'refunded',   39.99,   '99 Nanjing Rd',     'Shanghai',      'Shanghai', '200001', 'CN', 'Defective item',    '2025-06-01T09:00:00Z'),
    ('20000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'delivered',  149.99,  '45 Oxford Rd',      'London',        'England',  'W1D 1BS','GB', NULL,                '2025-07-10T11:00:00Z'),
    ('20000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000003', 'shipped',    259.98,  '789 Gangnam-daero', 'Seoul',         'Seoul',    '06053',  'KR', NULL,                '2025-08-05T09:00:00Z'),
    ('20000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000004', 'processing', 1599.00, '321 Tech Blvd',     'San Francisco', 'CA',       '94105',  'US', 'Need by Friday',    '2025-09-15T16:00:00Z'),
    ('20000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000001', 'confirmed',  44.99,   '123 Main St',       'New York',      'NY',       '10001',  'US', NULL,                '2025-10-01T08:00:00Z'),
    ('20000000-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-000000000006', 'pending',    199.98,  '88 Berliner Str',   'Berlin',        'Berlin',   '10115',  'DE', NULL,                '2025-11-15T12:00:00Z'),
    ('20000000-0000-0000-0000-000000000016', 'b0000000-0000-0000-0000-000000000007', 'delivered',  49.99,   '12 Shibuya',        'Tokyo',         'Tokyo',    '150-0002','JP',NULL,                '2025-12-01T10:00:00Z'),
    ('20000000-0000-0000-0000-000000000017', 'b0000000-0000-0000-0000-000000000008', 'pending',    129.99,  '456 Teheran-ro',    'Seoul',         'Seoul',    '06159',  'KR', NULL,                '2026-01-10T14:00:00Z'),
    ('20000000-0000-0000-0000-000000000018', 'b0000000-0000-0000-0000-000000000002', 'confirmed',  84.98,   '45 Oxford Rd',      'London',        'England',  'W1D 1BS','GB', 'Birthday gift',     '2026-02-14T11:00:00Z'),
    ('20000000-0000-0000-0000-000000000019', 'b0000000-0000-0000-0000-000000000009', 'processing', 1849.00, '99 Nanjing Rd',     'Shanghai',      'Shanghai', '200001', 'CN', NULL,                '2026-03-01T09:00:00Z'),
    ('20000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000004', 'shipped',    69.99,   '321 Tech Blvd',     'San Francisco', 'CA',       '94105',  'US', NULL,                '2026-04-10T16:00:00Z');

-- --------------------------------------------------------------------------
-- 5.14 Order Items (40 rows)
-- --------------------------------------------------------------------------
INSERT INTO order_items (id, order_id, product_variant_id, quantity, unit_price) VALUES
    ('dd000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 1, 1099.99),
    ('dd000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 1, 1199.99),
    ('dd000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006', 1, 2499.00),
    ('dd000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000005', 1, 899.00),
    ('dd000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000010', 1, 79.99),
    ('dd000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000011', 1, 79.99),
    ('dd000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000015', 1, 299.99),
    ('dd000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    ('dd000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000010', 1, 79.99),
    ('dd000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000013', 1, 59.99),
    ('dd000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000007', 1, 2999.00),
    ('dd000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    ('dd000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    ('dd000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000013', 2, 59.99),
    ('dd000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000014', 1, 59.99),
    ('dd000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000012', 1, 84.99),
    ('dd000000-0000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000009', 1, 1599.00),
    ('dd000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000018', 1, 44.99),
    ('dd000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    ('dd000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000021', 1, 49.99),
    ('dd000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000021', 1, 49.99),
    ('dd000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000022', 1, 129.99),
    ('dd000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    ('dd000000-0000-0000-0000-000000000024', '20000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000018', 1, 44.99),
    ('dd000000-0000-0000-0000-000000000025', '20000000-0000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000008', 1, 1849.00),
    ('dd000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    ('dd000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    ('dd000000-0000-0000-0000-000000000028', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000021', 2, 49.99),
    ('dd000000-0000-0000-0000-000000000029', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    ('dd000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000017', 2, 39.99),
    ('dd000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000013', 1, 59.99),
    ('dd000000-0000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000020', 2, 149.99),
    ('dd000000-0000-0000-0000-000000000033', '20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    ('dd000000-0000-0000-0000-000000000034', '20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000022', 1, 129.99),
    ('dd000000-0000-0000-0000-000000000035', '20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000010', 2, 79.99),
    ('dd000000-0000-0000-0000-000000000036', '20000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000025', 1, 74.99),
    ('dd000000-0000-0000-0000-000000000037', '20000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000023', 1, 129.99),
    ('dd000000-0000-0000-0000-000000000038', '20000000-0000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000015', 1, 299.99),
    ('dd000000-0000-0000-0000-000000000039', '20000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000020', 1, 149.99),
    ('dd000000-0000-0000-0000-000000000040', '20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 1, 999.99);

-- --------------------------------------------------------------------------
-- 5.15 Payments (20 rows)
-- --------------------------------------------------------------------------
INSERT INTO payments (id, order_id, method, status, amount, transaction_id, paid_at) VALUES
    ('ee000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'credit_card',   'captured',   1099.99, 'txn_001_cc', '2025-01-25T10:05:00Z'),
    ('ee000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'debit_card',    'captured',   1199.99, 'txn_002_dc', '2025-02-10T11:03:00Z'),
    ('ee000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'credit_card',   'captured',   2499.00, 'txn_003_cc', '2025-02-20T14:02:00Z'),
    ('ee000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'paypal',        'captured',   899.00,  'txn_004_pp', '2025-03-05T09:10:00Z'),
    ('ee000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'credit_card',   'authorized', 159.98,  'txn_005_cc', NULL),
    ('ee000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', 'bank_transfer', 'pending',    339.98,  NULL,         NULL),
    ('ee000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', 'credit_card',   'pending',    79.99,   NULL,         NULL),
    ('ee000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000008', 'debit_card',    'refunded',   59.99,   'txn_008_dc', '2025-05-01T10:02:00Z'),
    ('ee000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009', 'crypto',        'captured',   2999.00, 'txn_009_cr', '2025-05-15T14:15:00Z'),
    ('ee000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000010', 'credit_card',   'refunded',   39.99,   'txn_010_cc', '2025-06-01T09:05:00Z'),
    ('ee000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', 'paypal',        'captured',   149.99,  'txn_011_pp', '2025-07-10T11:08:00Z'),
    ('ee000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000012', 'credit_card',   'captured',   259.98,  'txn_012_cc', '2025-08-05T09:04:00Z'),
    ('ee000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000013', 'bank_transfer', 'authorized', 1599.00, 'txn_013_bt', NULL),
    ('ee000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000014', 'credit_card',   'captured',   44.99,   'txn_014_cc', '2025-10-01T08:03:00Z'),
    ('ee000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000015', 'debit_card',    'pending',    199.98,  NULL,         NULL),
    ('ee000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000016', 'credit_card',   'captured',   49.99,   'txn_016_cc', '2025-12-01T10:01:00Z'),
    ('ee000000-0000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000017', 'paypal',        'pending',    129.99,  NULL,         NULL),
    ('ee000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000018', 'credit_card',   'failed',     84.98,   'txn_018_cc', NULL),
    ('ee000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000019', 'bank_transfer', 'authorized', 1849.00, 'txn_019_bt', NULL),
    ('ee000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000020', 'crypto',        'captured',   69.99,   'txn_020_cr', '2026-04-10T16:20:00Z');

-- --------------------------------------------------------------------------
-- 5.16 Shipping Addresses (6 rows)
-- --------------------------------------------------------------------------
INSERT INTO shipping_addresses (id, user_id, label, street, city, state, postal_code, country, is_default) VALUES
    ('ff000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Home',   '123 Main St',       'New York',      'NY',      '10001',  'US', 1),
    ('ff000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Office', '456 Broadway',      'New York',      'NY',      '10012',  'US', 0),
    ('ff000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'Home',   '45 Oxford Rd',      'London',        'England', 'W1D 1BS','GB', 1),
    ('ff000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'Home',   '789 Gangnam-daero', 'Seoul',         'Seoul',   '06053',  'KR', 1),
    ('ff000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'Home',   '321 Tech Blvd',     'San Francisco', 'CA',      '94105',  'US', 1),
    ('ff000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000006', 'Home',   '88 Berliner Str',   'Berlin',        'Berlin',  '10115',  'DE', 1);

-- --------------------------------------------------------------------------
-- 5.17 Inventory (12 rows, using warehouse_name instead of warehouse FK)
-- --------------------------------------------------------------------------
INSERT INTO inventory (id, product_variant_id, warehouse_name, quantity) VALUES
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'US East Warehouse',      20),
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Asia Pacific Warehouse', 30),
    ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'US East Warehouse',      15),
    ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'US East Warehouse',      25),
    ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003', 'EU Central Warehouse',   15),
    ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'US East Warehouse',      10),
    ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000007', 'US East Warehouse',      5),
    ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000010', 'EU Central Warehouse',   50),
    ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000017', 'US East Warehouse',      100),
    ('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000019', 'US East Warehouse',      45),
    ('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000019', 'Asia Pacific Warehouse', 45),
    ('40000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000024', 'US East Warehouse',      40);

-- --------------------------------------------------------------------------
-- 5.18 Posts (10 rows)
-- --------------------------------------------------------------------------
INSERT INTO posts (id, user_id, title, body, is_published, published_at, created_at) VALUES
    ('50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Getting Started with PostgreSQL',    'PostgreSQL is an advanced open-source relational database...', 1, '2025-02-01T10:00:00Z', '2025-02-01T09:00:00Z'),
    ('50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Advanced Indexing Strategies',       'Choosing the right index type can dramatically improve...',    1, '2025-03-01T10:00:00Z', '2025-03-01T09:00:00Z'),
    ('50000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'UI Design Principles',               'Good design is invisible. Here are my top principles...',      1, '2025-03-15T12:00:00Z', '2025-03-15T11:00:00Z'),
    ('50000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'Product Management 101',             'The role of a PM is to discover the right product...',         1, '2025-04-01T08:00:00Z', '2025-04-01T07:00:00Z'),
    ('50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'Data Science in Production',         'Moving from notebooks to production pipelines requires...',    1, '2025-04-15T14:00:00Z', '2025-04-15T13:00:00Z'),
    ('50000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000007', 'React Performance Tips',             'Memoization, lazy loading, and virtual scrolling...',          1, '2025-05-01T10:00:00Z', '2025-05-01T09:00:00Z'),
    ('50000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000008', 'Startup Engineering Culture',        'Building a strong engineering culture from day one...',        1, '2025-05-15T16:00:00Z', '2025-05-15T15:00:00Z'),
    ('50000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000009', 'My First Month as a Developer',      'Reflections on joining a startup as a junior...',              1, '2025-06-01T10:00:00Z', '2025-06-01T09:00:00Z'),
    ('50000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'Partitioning in PostgreSQL',         'When your tables grow large, partitioning helps...',           0, NULL,                   '2025-06-15T09:00:00Z'),
    ('50000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000006', 'Operations Playbook',                'Incident response, on-call rotations, and SLOs...',            0, NULL,                   '2025-07-01T09:00:00Z');

-- --------------------------------------------------------------------------
-- 5.19 Comments (15 rows, nested 2-3 levels)
-- --------------------------------------------------------------------------
INSERT INTO comments (id, post_id, user_id, parent_comment_id, body, created_at) VALUES
    -- Top-level comments
    ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', NULL,                                   'Great introduction! Very helpful for beginners.',           '2025-02-02T10:00:00Z'),
    ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', NULL,                                   'Could you cover materialized views next?',                  '2025-02-03T11:00:00Z'),
    ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', NULL,                                   'The GIN index section was especially useful.',              '2025-03-02T12:00:00Z'),
    ('60000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', NULL,                                   'Love the minimalist approach discussed here.',              '2025-03-16T14:00:00Z'),
    ('60000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000007', NULL,                                   'This matches my experience as a PM perfectly.',             '2025-04-02T09:00:00Z'),
    ('60000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000008', NULL,                                   'We had similar challenges deploying ML models.',            '2025-04-16T15:00:00Z'),
    ('60000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', NULL,                                   'React.memo saved us significant re-renders.',               '2025-05-02T11:00:00Z'),
    ('60000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', NULL,                                   'Culture is indeed the hardest part to get right.',          '2025-05-16T17:00:00Z'),
    -- Level 2 replies
    ('60000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Thanks! I have a follow-up post planned.',                  '2025-02-02T14:00:00Z'),
    ('60000000-0000-0000-0000-000000000010', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'Yes, see my new post on partitioning!',                      '2025-02-04T10:00:00Z'),
    ('60000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', 'GIN is perfect for JSONB. I will do a deep dive.',          '2025-03-03T08:00:00Z'),
    ('60000000-0000-0000-0000-000000000012', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000006', 'Feature stores helped us a lot with that.',                  '2025-04-17T10:00:00Z'),
    -- Level 3 replies
    ('60000000-0000-0000-0000-000000000013', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000009', 'Looking forward to it!',                                     '2025-02-02T16:00:00Z'),
    ('60000000-0000-0000-0000-000000000014', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000011', 'Would love a comparison with pg_trgm indexes too.',         '2025-03-03T12:00:00Z'),
    ('60000000-0000-0000-0000-000000000015', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000012', 'Which feature store did you go with?',                       '2025-04-17T14:00:00Z');

-- --------------------------------------------------------------------------
-- 5.20 Notifications (12 rows)
-- --------------------------------------------------------------------------
INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at) VALUES
    ('70000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'order',     'Order Confirmed',     'Your order #001 has been confirmed.',         1, '2025-01-25T10:10:00Z'),
    ('70000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'payment',   'Payment Received',    'Payment of $1099.99 has been captured.',       1, '2025-01-25T10:15:00Z'),
    ('70000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'order',     'Order Shipped',       'Your order #002 is on the way.',               1, '2025-02-12T09:00:00Z'),
    ('70000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'system',    'Welcome',             'Welcome to the platform, Charlie!',            1, '2025-02-01T10:00:00Z'),
    ('70000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'promotion', 'Spring Sale',         'Get 20% off on all electronics.',              0, '2025-03-20T08:00:00Z'),
    ('70000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000006', 'alert',     'Low Stock Alert',     'Product ROG Strix G16 is running low.',        0, '2025-04-01T07:00:00Z'),
    ('70000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000007', 'order',     'Order Cancelled',     'Your order #008 has been cancelled.',          1, '2025-05-01T11:00:00Z'),
    ('70000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000008', 'payment',   'Refund Processed',    'Your refund of $39.99 has been issued.',       1, '2025-06-05T10:00:00Z'),
    ('70000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'system',    'Password Changed',    'Your password was changed successfully.',      1, '2025-08-01T09:00:00Z'),
    ('70000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000009', 'promotion', 'Holiday Deals',       'Check out our holiday specials!',              0, '2025-12-15T08:00:00Z'),
    ('70000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'order',     'Order Delivered',     'Your order #018 has been delivered.',          0, '2026-02-20T14:00:00Z'),
    ('70000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000004', 'alert',     'Account Activity',    'New login from a new device detected.',        0, '2026-03-05T16:00:00Z');

-- --------------------------------------------------------------------------
-- 5.21 Settings (5 key-value pairs)
-- --------------------------------------------------------------------------
INSERT INTO settings (id, key, value, description) VALUES
    ('80000000-0000-0000-0000-000000000001', 'site_name',            'Rockury MVP',  'Public-facing site name'),
    ('80000000-0000-0000-0000-000000000002', 'max_upload_size_mb',   '50',           'Maximum file upload size in megabytes'),
    ('80000000-0000-0000-0000-000000000003', 'default_currency',     'USD',          'Default currency for pricing'),
    ('80000000-0000-0000-0000-000000000004', 'maintenance_mode',     'false',        'Enable/disable maintenance mode'),
    ('80000000-0000-0000-0000-000000000005', 'session_timeout_mins', '30',           'Session timeout in minutes');

-- --------------------------------------------------------------------------
-- 5.22 API Keys (4 rows)
-- --------------------------------------------------------------------------
INSERT INTO api_keys (id, user_id, key_value, name, is_active, expires_at) VALUES
    ('90000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'rky_live_ak_001_alice_2025', 'Alice Production Key', 1, '2026-01-10T00:00:00Z'),
    ('90000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'rky_test_ak_002_alice_2025', 'Alice Test Key',       1, '2025-12-31T23:59:59Z'),
    ('90000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000008', 'rky_live_ak_003_henry_2025', 'Henry Production Key', 1, '2026-06-30T00:00:00Z'),
    ('90000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000005', 'rky_live_ak_004_eve_expired','Eve Expired Key',      0, '2025-06-01T00:00:00Z');

-- --------------------------------------------------------------------------
-- 5.23 Migrations (3 version records)
-- --------------------------------------------------------------------------
INSERT INTO migrations (id, version, name, applied_at) VALUES
    ('a1000000-0000-0000-0000-000000000001', '001', 'initial_schema',       '2025-01-01T00:00:00Z'),
    ('a1000000-0000-0000-0000-000000000002', '002', 'add_indexes',          '2025-02-01T00:00:00Z'),
    ('a1000000-0000-0000-0000-000000000003', '003', 'add_triggers_views',   '2025-03-01T00:00:00Z');
