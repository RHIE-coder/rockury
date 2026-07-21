-- =============================================================================
-- PostgreSQL Test Database Init Script
-- Target: Docker PostgreSQL (port 15432, user=test, password=test, db=testdb)
-- Purpose: Comprehensive coverage of all PostgreSQL design elements
-- =============================================================================

BEGIN;

-- 재현성: 인코딩/타임존 고정 (컨테이너 기본값과 무관하게 결정적 결과 보장).
SET client_encoding = 'UTF8';
SET timezone = 'UTC';

-- =============================================================================
-- 0. EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- 1. CUSTOM TYPES
-- =============================================================================

-- Enum types
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE TYPE payment_status AS ENUM ('pending', 'authorized', 'captured', 'failed', 'refunded');
CREATE TYPE payment_method AS ENUM ('credit_card', 'debit_card', 'bank_transfer', 'paypal', 'crypto');
CREATE TYPE notification_type AS ENUM ('order', 'payment', 'system', 'promotion', 'alert');
CREATE TYPE trigger_action AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- Composite type
CREATE TYPE address AS (
    street      VARCHAR(255),
    city        VARCHAR(100),
    state       VARCHAR(100),
    postal_code VARCHAR(20),
    country     VARCHAR(100)
);

-- Domain types
CREATE DOMAIN email_address AS VARCHAR(255)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE DOMAIN positive_integer AS INT
    CHECK (VALUE > 0);

-- =============================================================================
-- 2. SEQUENCES
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS image_sort_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS audit_seq START WITH 1 INCREMENT BY 1;

-- =============================================================================
-- 3. TABLES (28 tables in FK-dependency topological order)
-- =============================================================================

-- --------------------------------------------------------------------------
-- 3.1 roles
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE roles IS 'Application roles for RBAC';
COMMENT ON COLUMN roles.name IS 'Unique role identifier (admin, manager, user, readonly)';

-- --------------------------------------------------------------------------
-- 3.2 users
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    full_name     VARCHAR(201) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    email         email_address NOT NULL UNIQUE,
    age           INT CHECK (age >= 0 AND age <= 200),
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS 'Core user accounts table';
COMMENT ON COLUMN users.full_name IS 'Generated column: first_name || last_name';
COMMENT ON COLUMN users.email IS 'Uses email_address domain type with regex validation';

-- --------------------------------------------------------------------------
-- 3.3 user_profiles (1:1 with users)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    bio         TEXT,
    avatar_url  VARCHAR(500),
    preferences JSONB NOT NULL DEFAULT '{}',
    address     address,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_profiles IS '1:1 extension of users with profile data and JSONB preferences';

-- --------------------------------------------------------------------------
-- 3.4 user_roles (M:N join)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

COMMENT ON TABLE user_roles IS 'Many-to-many join between users and roles';

-- --------------------------------------------------------------------------
-- 3.5 organizations (self-referencing hierarchy)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(200) NOT NULL,
    parent_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE organizations IS 'Hierarchical organization structure with self-referencing FK';

-- --------------------------------------------------------------------------
-- 3.6 org_members
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_members (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    role      VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE org_members IS 'Organization membership with role-based access';

-- --------------------------------------------------------------------------
-- 3.7 categories (self-referencing tree)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(100) NOT NULL UNIQUE,
    slug       VARCHAR(100) NOT NULL UNIQUE,
    parent_id  UUID REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE,
    depth      INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE categories IS 'Product category tree with depth tracking';

-- --------------------------------------------------------------------------
-- 3.8 tags
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- 3.9 products
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE,
    price       NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE products IS 'Product catalog with JSONB metadata and category FK (SET NULL/CASCADE)';

-- --------------------------------------------------------------------------
-- 3.10 product_variants
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    sku             VARCHAR(100) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    price_override  NUMERIC(12, 2),
    stock_quantity  INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, sku)
);

COMMENT ON TABLE product_variants IS 'SKU-level variants with composite unique constraint';

-- --------------------------------------------------------------------------
-- 3.11 product_images
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_images (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    url        VARCHAR(500) NOT NULL,
    alt_text   VARCHAR(300),
    sort_order INT NOT NULL DEFAULT nextval('image_sort_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN product_images.sort_order IS 'Uses image_sort_seq sequence for default ordering';

-- --------------------------------------------------------------------------
-- 3.12 product_tags (M:N join)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_tags (
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (product_id, tag_id)
);

-- --------------------------------------------------------------------------
-- 3.13 orders (partitioned by created_at)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id               UUID NOT NULL DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    status           order_status NOT NULL DEFAULT 'pending',
    total_amount     NUMERIC(12, 2),
    shipping_address address,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE orders IS 'Orders partitioned by created_at (RANGE). PK includes partition key.';

-- Partitions for orders
CREATE TABLE IF NOT EXISTS orders_2025_h1 PARTITION OF orders
    FOR VALUES FROM ('2025-01-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS orders_2025_h2 PARTITION OF orders
    FOR VALUES FROM ('2025-07-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS orders_2026_h1 PARTITION OF orders
    FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS orders_default PARTITION OF orders DEFAULT;

-- --------------------------------------------------------------------------
-- 3.14 order_items
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id           UUID NOT NULL,
    order_created_at   TIMESTAMPTZ NOT NULL,
    product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    quantity           positive_integer NOT NULL,
    unit_price         NUMERIC(12, 2) NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (order_id, order_created_at) REFERENCES orders(id, created_at) ON DELETE CASCADE ON UPDATE CASCADE
);

COMMENT ON TABLE order_items IS 'Line items referencing partitioned orders via composite FK';

-- --------------------------------------------------------------------------
-- 3.15 payments
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id       UUID NOT NULL,
    order_created_at TIMESTAMPTZ NOT NULL,
    method         payment_method NOT NULL,
    status         payment_status NOT NULL DEFAULT 'pending',
    amount         NUMERIC(12, 2) NOT NULL,
    transaction_id VARCHAR(200),
    paid_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (order_id, order_created_at) REFERENCES orders(id, created_at) ON DELETE RESTRICT ON UPDATE RESTRICT
);

COMMENT ON TABLE payments IS 'Payment records with RESTRICT/RESTRICT FK to orders';

-- --------------------------------------------------------------------------
-- 3.16 shipping_addresses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipping_addresses (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    label      VARCHAR(100),
    address    address NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE shipping_addresses IS 'User shipping addresses with CASCADE/NO ACTION FK';

-- --------------------------------------------------------------------------
-- 3.17 warehouses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(200) NOT NULL UNIQUE,
    location   POINT,
    address    address,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN warehouses.location IS 'GiST-indexable POINT type for geospatial queries';

-- --------------------------------------------------------------------------
-- 3.18 inventory
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE ON UPDATE CASCADE,
    warehouse_id       UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    quantity           INT NOT NULL CHECK (quantity >= 0),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_variant_id, warehouse_id)
);

COMMENT ON TABLE inventory IS 'Stock levels per variant per warehouse';

-- --------------------------------------------------------------------------
-- 3.19 inventory_log (partitioned by changed_at)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_log (
    id           UUID NOT NULL DEFAULT uuid_generate_v4(),
    inventory_id UUID NOT NULL,
    old_quantity INT,
    new_quantity INT,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, changed_at)
) PARTITION BY RANGE (changed_at);

COMMENT ON TABLE inventory_log IS 'Inventory change audit trail, partitioned by changed_at';

-- Partitions for inventory_log
CREATE TABLE IF NOT EXISTS inventory_log_2025_h1 PARTITION OF inventory_log
    FOR VALUES FROM ('2025-01-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS inventory_log_2025_h2 PARTITION OF inventory_log
    FOR VALUES FROM ('2025-07-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS inventory_log_2026_h1 PARTITION OF inventory_log
    FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS inventory_log_default PARTITION OF inventory_log DEFAULT;

-- Note: inventory_log.inventory_id FK cannot reference inventory directly
-- because inventory_log is partitioned and FK from partitioned tables require
-- the partition key in the FK. We rely on application-level integrity here.

-- --------------------------------------------------------------------------
-- 3.20 posts
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    title        VARCHAR(300) NOT NULL,
    body         TEXT,
    is_published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- 3.21 comments (self-referencing for nesting)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id           UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    parent_comment_id UUID REFERENCES comments(id) ON DELETE SET NULL ON UPDATE NO ACTION,
    body              TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE comments IS 'Nested comments with CASCADE/NO ACTION to posts, SET NULL/NO ACTION to self';

-- --------------------------------------------------------------------------
-- 3.22 notifications (partitioned by created_at)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id         UUID NOT NULL DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES users(id) ON DELETE SET DEFAULT ON UPDATE CASCADE,
    type       notification_type NOT NULL,
    title      VARCHAR(300) NOT NULL,
    message    TEXT,
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE notifications IS 'User notifications partitioned by created_at. FK uses SET DEFAULT to system user.';

-- Partitions for notifications
CREATE TABLE IF NOT EXISTS notifications_2025_h1 PARTITION OF notifications
    FOR VALUES FROM ('2025-01-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS notifications_2025_h2 PARTITION OF notifications
    FOR VALUES FROM ('2025-07-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS notifications_2026_h1 PARTITION OF notifications
    FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS notifications_default PARTITION OF notifications DEFAULT;

-- --------------------------------------------------------------------------
-- 3.23 audit_logs (partitioned by performed_at)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id           UUID NOT NULL DEFAULT uuid_generate_v4(),
    table_name   VARCHAR(100) NOT NULL,
    action       VARCHAR(10) NOT NULL,
    record_id    UUID,
    old_data     JSONB,
    new_data     JSONB,
    performed_by UUID,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, performed_at)
) PARTITION BY RANGE (performed_at);

COMMENT ON TABLE audit_logs IS 'Generic audit trail, partitioned by performed_at';

-- Partitions for audit_logs
CREATE TABLE IF NOT EXISTS audit_logs_2025_h1 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-01-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS audit_logs_2025_h2 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-07-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_h1 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs DEFAULT;

-- --------------------------------------------------------------------------
-- 3.24 settings
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key         VARCHAR(200) NOT NULL UNIQUE,
    value       TEXT,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- 3.25 scheduled_jobs
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name   VARCHAR(200) NOT NULL,
    schedule   VARCHAR(100) NOT NULL,
    definition TEXT,
    status     VARCHAR(20) NOT NULL CHECK (status IN ('enabled', 'disabled')),
    start_time TIMESTAMPTZ,
    end_time   TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- 3.26 api_keys
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    key_value  VARCHAR(255) NOT NULL UNIQUE,
    name       VARCHAR(200) NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- 3.27 file_uploads
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_uploads (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    filename     VARCHAR(500) NOT NULL,
    mime_type    VARCHAR(100) NOT NULL,
    size_bytes   BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- 3.28 migrations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migrations (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version    VARCHAR(50) NOT NULL UNIQUE,
    name       VARCHAR(300) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- 3.29 Demo: LIST partition example
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_sales (
    id        UUID NOT NULL DEFAULT uuid_generate_v4(),
    region    VARCHAR(20) NOT NULL,
    amount    NUMERIC(12, 2),
    sold_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, region)
) PARTITION BY LIST (region);

CREATE TABLE IF NOT EXISTS region_sales_asia PARTITION OF region_sales
    FOR VALUES IN ('KR', 'JP', 'CN', 'SG');
CREATE TABLE IF NOT EXISTS region_sales_europe PARTITION OF region_sales
    FOR VALUES IN ('DE', 'FR', 'GB', 'NL');
CREATE TABLE IF NOT EXISTS region_sales_americas PARTITION OF region_sales
    FOR VALUES IN ('US', 'CA', 'BR', 'MX');
CREATE TABLE IF NOT EXISTS region_sales_default PARTITION OF region_sales DEFAULT;

COMMENT ON TABLE region_sales IS 'Demo: LIST partitioning by region code';

-- --------------------------------------------------------------------------
-- 3.30 Demo: HASH partition example
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_logs (
    id         UUID NOT NULL DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    event      VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, session_id)
) PARTITION BY HASH (session_id);

CREATE TABLE IF NOT EXISTS session_logs_p0 PARTITION OF session_logs
    FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE IF NOT EXISTS session_logs_p1 PARTITION OF session_logs
    FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE IF NOT EXISTS session_logs_p2 PARTITION OF session_logs
    FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE IF NOT EXISTS session_logs_p3 PARTITION OF session_logs
    FOR VALUES WITH (MODULUS 4, REMAINDER 3);

COMMENT ON TABLE session_logs IS 'Demo: HASH partitioning by session_id with 4 partitions';

-- =============================================================================
-- 4. INDEXES
-- =============================================================================

-- B-Tree: standard lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);

-- Hash: equality-only lookup
CREATE INDEX IF NOT EXISTS idx_api_keys_key_value_hash ON api_keys USING HASH (key_value);

-- GIN: JSONB containment/key-exists queries
CREATE INDEX IF NOT EXISTS idx_products_metadata_gin ON products USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_user_profiles_preferences_gin ON user_profiles USING GIN (preferences);
CREATE INDEX IF NOT EXISTS idx_audit_logs_old_data_gin ON audit_logs USING GIN (old_data);
CREATE INDEX IF NOT EXISTS idx_audit_logs_new_data_gin ON audit_logs USING GIN (new_data);

-- GIN: pg_trgm trigram for LIKE/ILIKE searches
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);

-- GiST: geometric/spatial queries on POINT
CREATE INDEX IF NOT EXISTS idx_warehouses_location_gist ON warehouses USING GiST (location);

-- Partial index: only active products
CREATE INDEX IF NOT EXISTS idx_products_active ON products (name) WHERE is_active = true;

-- Expression index: case-insensitive search
CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (LOWER(email::text));

-- Covering index (INCLUDE): avoid heap lookup for common queries
CREATE INDEX IF NOT EXISTS idx_orders_status_include ON orders (status) INCLUDE (total_amount, user_id);

-- Composite index
CREATE INDEX IF NOT EXISTS idx_order_items_order_variant ON order_items (order_id, product_variant_id);

-- Unique expression index
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_lower_key ON settings (LOWER(key));

-- =============================================================================
-- 5. VIEWS
-- =============================================================================

-- Regular view: user summary
CREATE OR REPLACE VIEW v_user_summary AS
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

COMMENT ON VIEW v_user_summary IS 'Aggregated user stats: orders, spending, posts';

-- Updatable view with CHECK OPTION
CREATE OR REPLACE VIEW v_active_products AS
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
WHERE is_active = true
WITH CHECK OPTION;

COMMENT ON VIEW v_active_products IS 'Updatable view: only active products, WITH CHECK OPTION prevents deactivation via view';

-- Materialized view: product statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_product_stats AS
SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.price,
    c.name AS category_name,
    COUNT(DISTINCT pv.id) AS variant_count,
    COALESCE(SUM(pv.stock_quantity), 0) AS total_stock,
    COUNT(DISTINCT oi.id) AS times_ordered,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_revenue
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN product_variants pv ON pv.product_id = p.id
LEFT JOIN order_items oi ON oi.product_variant_id = pv.id
GROUP BY p.id, p.name, p.price, c.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_product_stats_id ON mv_product_stats (product_id);

COMMENT ON MATERIALIZED VIEW mv_product_stats IS 'Pre-computed product stats. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_stats';

-- =============================================================================
-- 6. FUNCTIONS & PROCEDURES
-- =============================================================================

-- Scalar SQL function: calculate order total from items
CREATE OR REPLACE FUNCTION fn_calc_order_total(p_order_id UUID)
RETURNS NUMERIC(12, 2)
LANGUAGE SQL
STABLE
AS $$
    SELECT COALESCE(SUM(quantity * unit_price), 0)
    FROM order_items
    WHERE order_id = p_order_id;
$$;

COMMENT ON FUNCTION fn_calc_order_total IS 'Returns sum of (quantity * unit_price) for a given order';

-- Table-returning recursive function: category tree
CREATE OR REPLACE FUNCTION fn_get_category_tree(p_root_id UUID DEFAULT NULL)
RETURNS TABLE (
    id        UUID,
    name      VARCHAR(100),
    slug      VARCHAR(100),
    parent_id UUID,
    depth     INT,
    path      TEXT
)
LANGUAGE SQL
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT
            c.id,
            c.name,
            c.slug,
            c.parent_id,
            c.depth,
            c.name::TEXT AS path
        FROM categories c
        WHERE (p_root_id IS NULL AND c.parent_id IS NULL)
           OR c.id = p_root_id

        UNION ALL

        SELECT
            ch.id,
            ch.name,
            ch.slug,
            ch.parent_id,
            ch.depth,
            tree.path || ' > ' || ch.name
        FROM categories ch
        INNER JOIN tree ON tree.id = ch.parent_id
    )
    SELECT * FROM tree ORDER BY path;
$$;

-- Slug generator function
CREATE OR REPLACE FUNCTION fn_generate_slug(p_text TEXT)
RETURNS TEXT
LANGUAGE PLPGSQL
IMMUTABLE
AS $$
BEGIN
    RETURN LOWER(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                TRIM(p_text),
                '[^a-zA-Z0-9\s-]', '', 'g'
            ),
            '\s+', '-', 'g'
        )
    );
END;
$$;

COMMENT ON FUNCTION fn_generate_slug IS 'Converts text to URL-friendly slug: lowercase, alphanumeric, hyphens';

-- Procedure: cleanup expired notifications (with default param)
CREATE OR REPLACE PROCEDURE proc_cleanup_expired_notifications(
    p_older_than INTERVAL DEFAULT INTERVAL '90 days'
)
LANGUAGE PLPGSQL
AS $$
BEGIN
    DELETE FROM notifications
    WHERE is_read = true
      AND created_at < NOW() - p_older_than;
END;
$$;

COMMENT ON PROCEDURE proc_cleanup_expired_notifications IS 'Deletes read notifications older than given interval (default 90 days)';

-- Procedure: recalculate inventory (INOUT param)
CREATE OR REPLACE PROCEDURE proc_recalc_inventory(
    p_product_variant_id UUID,
    INOUT p_total_quantity INT DEFAULT 0
)
LANGUAGE PLPGSQL
AS $$
BEGIN
    SELECT COALESCE(SUM(quantity), 0)
    INTO p_total_quantity
    FROM inventory
    WHERE product_variant_id = p_product_variant_id;
END;
$$;

COMMENT ON PROCEDURE proc_recalc_inventory IS 'Sums inventory across all warehouses for a variant, returns via INOUT param';

-- =============================================================================
-- 7. TRIGGERS
-- =============================================================================

-- Trigger function: auto-set updated_at
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Apply updated_at trigger to multiple tables
CREATE OR REPLACE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_comments_updated_at
    BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Trigger function: audit log for orders (AFTER INSERT/UPDATE/DELETE)
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (table_name, action, record_id, old_data, new_data, performed_at)
        VALUES (TG_TABLE_NAME, TG_OP, OLD.id, to_jsonb(OLD), NULL, NOW());
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (table_name, action, record_id, old_data, new_data, performed_at)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, to_jsonb(OLD), to_jsonb(NEW), NOW());
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (table_name, action, record_id, old_data, new_data, performed_at)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, NULL, to_jsonb(NEW), NOW());
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

-- Apply to each orders partition (triggers must be on partitions, not parent)
CREATE OR REPLACE TRIGGER trg_orders_2025_h1_audit
    AFTER INSERT OR UPDATE OR DELETE ON orders_2025_h1
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE TRIGGER trg_orders_2025_h2_audit
    AFTER INSERT OR UPDATE OR DELETE ON orders_2025_h2
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE TRIGGER trg_orders_2026_h1_audit
    AFTER INSERT OR UPDATE OR DELETE ON orders_2026_h1
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE TRIGGER trg_orders_default_audit
    AFTER INSERT OR UPDATE OR DELETE ON orders_default
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Trigger function: inventory change log (AFTER UPDATE OF quantity with WHEN condition)
CREATE OR REPLACE FUNCTION fn_inventory_log()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
    INSERT INTO inventory_log (inventory_id, old_quantity, new_quantity, changed_at)
    VALUES (NEW.id, OLD.quantity, NEW.quantity, NOW());
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_inventory_quantity_change
    AFTER UPDATE OF quantity ON inventory
    FOR EACH ROW
    WHEN (OLD.quantity IS DISTINCT FROM NEW.quantity)
    EXECUTE FUNCTION fn_inventory_log();

-- =============================================================================
-- 8. PARTITIONING
-- (Already defined inline with tables above: orders, inventory_log,
--  notifications, audit_logs = RANGE; region_sales = LIST; session_logs = HASH)
-- =============================================================================

-- =============================================================================
-- 9. SECURITY (Roles, Grants, RLS)
-- =============================================================================

-- Create roles (IF NOT EXISTS not supported for CREATE ROLE, use DO block)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_admin') THEN
        CREATE ROLE app_admin WITH LOGIN PASSWORD 'admin_pass';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_readonly') THEN
        CREATE ROLE app_readonly WITH LOGIN PASSWORD 'readonly_pass';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD 'user_pass';
    END IF;
END;
$$;

-- Schema grants
GRANT USAGE ON SCHEMA public TO app_admin, app_readonly, app_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_admin, app_user;

-- RLS on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_admin_policy ON audit_logs
    FOR ALL
    TO app_admin
    USING (true)
    WITH CHECK (true);

CREATE POLICY audit_logs_user_policy ON audit_logs
    FOR SELECT
    TO app_user
    USING (performed_by = current_setting('app.current_user_id', true)::UUID);

COMMENT ON POLICY audit_logs_admin_policy ON audit_logs IS 'Admins have full access to all audit logs';
COMMENT ON POLICY audit_logs_user_policy ON audit_logs IS 'Users can only see their own audit logs';

-- RLS on org_members
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_members_admin_policy ON org_members
    FOR ALL
    TO app_admin
    USING (true)
    WITH CHECK (true);

CREATE POLICY org_members_user_policy ON org_members
    FOR SELECT
    TO app_user
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- =============================================================================
-- 10. SEED DATA (~150 rows)
-- =============================================================================

-- Fixed UUIDs for referential integrity
-- System user
-- Users: u01..u09
-- Roles: r01..r04
-- Orgs: org01..org05
-- Categories: cat01..cat08
-- Tags: tag01..tag06
-- Products: prod01..prod15
-- Variants: var01..var25
-- Orders: ord01..ord20

-- --------------------------------------------------------------------------
-- 10.1 Roles (4 rows)
-- --------------------------------------------------------------------------
INSERT INTO roles (id, name, description) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'admin',    'Full system access'),
    ('a0000000-0000-0000-0000-000000000002', 'manager',  'Team and content management'),
    ('a0000000-0000-0000-0000-000000000003', 'user',     'Standard user access'),
    ('a0000000-0000-0000-0000-000000000004', 'readonly', 'Read-only access');

-- --------------------------------------------------------------------------
-- 10.2 Users (10 rows, including system user)
-- --------------------------------------------------------------------------
INSERT INTO users (id, first_name, last_name, email, age, password_hash, is_active, created_at) VALUES
    ('00000000-0000-0000-0000-000000000000', 'System',  'User',     'system@testdb.local',    0,   crypt('system', gen_salt('bf')),  true,  '2024-01-01 00:00:00+00'),
    ('b0000000-0000-0000-0000-000000000001', 'Alice',   'Johnson',  'alice@example.com',      30,  crypt('pass123', gen_salt('bf')), true,  '2025-01-10 08:00:00+00'),
    ('b0000000-0000-0000-0000-000000000002', 'Bob',     'Smith',    'bob@example.com',        25,  crypt('pass123', gen_salt('bf')), true,  '2025-01-15 09:00:00+00'),
    ('b0000000-0000-0000-0000-000000000003', 'Charlie', 'Brown',    'charlie@example.com',    35,  crypt('pass123', gen_salt('bf')), true,  '2025-02-01 10:00:00+00'),
    ('b0000000-0000-0000-0000-000000000004', 'Diana',   'Prince',   'diana@example.com',      28,  crypt('pass123', gen_salt('bf')), true,  '2025-02-10 11:00:00+00'),
    ('b0000000-0000-0000-0000-000000000005', 'Eve',     'Williams', 'eve@example.com',        32,  crypt('pass123', gen_salt('bf')), false, '2025-03-01 12:00:00+00'),
    ('b0000000-0000-0000-0000-000000000006', 'Frank',   'Miller',   'frank@example.com',      40,  crypt('pass123', gen_salt('bf')), true,  '2025-03-15 13:00:00+00'),
    ('b0000000-0000-0000-0000-000000000007', 'Grace',   'Lee',      'grace@example.com',      27,  crypt('pass123', gen_salt('bf')), true,  '2025-04-01 14:00:00+00'),
    ('b0000000-0000-0000-0000-000000000008', 'Henry',   'Kim',      'henry@example.com',      45,  crypt('pass123', gen_salt('bf')), true,  '2025-04-15 15:00:00+00'),
    ('b0000000-0000-0000-0000-000000000009', 'Iris',    'Chen',     'iris@example.com',       22,  crypt('pass123', gen_salt('bf')), true,  '2025-05-01 16:00:00+00');

-- --------------------------------------------------------------------------
-- 10.3 User Profiles (10 rows with varied JSONB)
-- --------------------------------------------------------------------------
INSERT INTO user_profiles (id, user_id, bio, avatar_url, preferences, address) VALUES
    (uuid_generate_v4(), '00000000-0000-0000-0000-000000000000', 'System account',           NULL,                                   '{"theme": "dark", "lang": "en"}',                                          ROW('1 System St', 'Cloud', 'NA', '00000', 'US')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'Software engineer at NYC', 'https://cdn.test.com/avatars/alice.jpg', '{"theme": "light", "lang": "en", "notifications": true}',                  ROW('123 Main St', 'New York', 'NY', '10001', 'US')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000002', 'Designer from London',     'https://cdn.test.com/avatars/bob.jpg',   '{"theme": "dark", "lang": "en", "notifications": false}',                  ROW('45 Oxford Rd', 'London', 'England', 'W1D 1BS', 'GB')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000003', 'Product manager',          'https://cdn.test.com/avatars/charlie.jpg','{"theme": "auto", "lang": "ko", "timezone": "Asia/Seoul"}',                ROW('789 Gangnam-daero', 'Seoul', 'Seoul', '06053', 'KR')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000004', 'Data scientist',           NULL,                                   '{"theme": "dark", "lang": "en", "dashboard_layout": "grid"}',              ROW('321 Tech Blvd', 'San Francisco', 'CA', '94105', 'US')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000005', 'Inactive user',            NULL,                                   '{}',                                                                        ROW('555 Elm St', 'Chicago', 'IL', '60601', 'US')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000006', 'Operations lead',          'https://cdn.test.com/avatars/frank.jpg', '{"theme": "light", "lang": "de", "currency": "EUR"}',                     ROW('88 Berliner Str', 'Berlin', 'Berlin', '10115', 'DE')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000007', 'Frontend developer',       'https://cdn.test.com/avatars/grace.jpg', '{"theme": "dark", "lang": "ja", "editor": "vim"}',                        ROW('12 Shibuya', 'Tokyo', 'Tokyo', '150-0002', 'JP')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000008', 'CTO at startup',           'https://cdn.test.com/avatars/henry.jpg', '{"theme": "light", "lang": "ko", "notifications": true, "beta": true}',   ROW('456 Teheran-ro', 'Seoul', 'Seoul', '06159', 'KR')::address),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000009', 'Junior developer',         NULL,                                   '{"theme": "auto", "lang": "zh", "onboarding_complete": false}',            ROW('99 Nanjing Rd', 'Shanghai', 'Shanghai', '200001', 'CN')::address);

-- --------------------------------------------------------------------------
-- 10.4 User Roles mappings
-- --------------------------------------------------------------------------
INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2025-01-10 08:00:00+00'),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', '2025-01-15 09:00:00+00'),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', '2025-02-01 10:00:00+00'),
    ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', '2025-02-10 11:00:00+00'),
    ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', '2025-03-01 12:00:00+00'),
    ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', '2025-03-15 13:00:00+00'),
    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', '2025-04-01 14:00:00+00'),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', '2025-04-15 15:00:00+00'),
    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000004', '2025-05-01 16:00:00+00');

-- --------------------------------------------------------------------------
-- 10.5 Organizations (5 rows: 2 parents + 3 children)
-- --------------------------------------------------------------------------
INSERT INTO organizations (id, name, parent_org_id, created_at) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Rockury Corp',          NULL,                                     '2025-01-01 00:00:00+00'),
    ('c0000000-0000-0000-0000-000000000002', 'Acme Holdings',         NULL,                                     '2025-01-01 00:00:00+00'),
    ('c0000000-0000-0000-0000-000000000003', 'Rockury Engineering',   'c0000000-0000-0000-0000-000000000001',   '2025-02-01 00:00:00+00'),
    ('c0000000-0000-0000-0000-000000000004', 'Rockury Marketing',     'c0000000-0000-0000-0000-000000000001',   '2025-02-01 00:00:00+00'),
    ('c0000000-0000-0000-0000-000000000005', 'Acme Research',         'c0000000-0000-0000-0000-000000000002',   '2025-03-01 00:00:00+00');

-- --------------------------------------------------------------------------
-- 10.6 Org Members
-- --------------------------------------------------------------------------
INSERT INTO org_members (id, org_id, user_id, role, joined_at) VALUES
    (uuid_generate_v4(), 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'admin',  '2025-01-10 08:00:00+00'),
    (uuid_generate_v4(), 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'member', '2025-01-15 09:00:00+00'),
    (uuid_generate_v4(), 'c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'admin',  '2025-02-01 10:00:00+00'),
    (uuid_generate_v4(), 'c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004', 'member', '2025-02-10 11:00:00+00'),
    (uuid_generate_v4(), 'c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000006', 'admin',  '2025-03-15 13:00:00+00'),
    (uuid_generate_v4(), 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000008', 'admin',  '2025-04-15 15:00:00+00'),
    (uuid_generate_v4(), 'c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000007', 'viewer', '2025-04-01 14:00:00+00');

-- --------------------------------------------------------------------------
-- 10.7 Categories (8 rows, 3 levels deep)
-- --------------------------------------------------------------------------
INSERT INTO categories (id, name, slug, parent_id, depth) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'Electronics',       'electronics',        NULL,                                     0),
    ('d0000000-0000-0000-0000-000000000002', 'Clothing',          'clothing',           NULL,                                     0),
    ('d0000000-0000-0000-0000-000000000003', 'Books',             'books',              NULL,                                     0),
    ('d0000000-0000-0000-0000-000000000004', 'Smartphones',       'smartphones',        'd0000000-0000-0000-0000-000000000001',   1),
    ('d0000000-0000-0000-0000-000000000005', 'Laptops',           'laptops',            'd0000000-0000-0000-0000-000000000001',   1),
    ('d0000000-0000-0000-0000-000000000006', 'Men',               'men',                'd0000000-0000-0000-0000-000000000002',   1),
    ('d0000000-0000-0000-0000-000000000007', 'Android Phones',    'android-phones',     'd0000000-0000-0000-0000-000000000004',   2),
    ('d0000000-0000-0000-0000-000000000008', 'Gaming Laptops',    'gaming-laptops',     'd0000000-0000-0000-0000-000000000005',   2);

-- --------------------------------------------------------------------------
-- 10.8 Tags (6 rows)
-- --------------------------------------------------------------------------
INSERT INTO tags (id, name) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'new-arrival'),
    ('e0000000-0000-0000-0000-000000000002', 'best-seller'),
    ('e0000000-0000-0000-0000-000000000003', 'sale'),
    ('e0000000-0000-0000-0000-000000000004', 'limited-edition'),
    ('e0000000-0000-0000-0000-000000000005', 'eco-friendly'),
    ('e0000000-0000-0000-0000-000000000006', 'premium');

-- --------------------------------------------------------------------------
-- 10.9 Products (15 rows with varied JSONB metadata)
-- --------------------------------------------------------------------------
INSERT INTO products (id, name, description, category_id, price, is_active, metadata, created_at) VALUES
    ('f0000000-0000-0000-0000-000000000001', 'Galaxy S25',         'Latest Samsung flagship',            'd0000000-0000-0000-0000-000000000004', 999.99,  true,  '{"weight": "0.187kg", "color": "black", "storage": ["128GB", "256GB"]}',          '2025-01-20 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000002', 'iPhone 16 Pro',      'Apple premium smartphone',           'd0000000-0000-0000-0000-000000000004', 1199.99, true,  '{"weight": "0.199kg", "color": "titanium", "storage": ["256GB", "512GB", "1TB"]}','2025-01-25 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000003', 'Pixel 9',            'Google AI-powered phone',            'd0000000-0000-0000-0000-000000000007', 899.00,  true,  '{"weight": "0.198kg", "color": "obsidian", "ai_features": true}',                '2025-02-01 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000004', 'MacBook Pro 16',     'M4 Pro chip laptop',                 'd0000000-0000-0000-0000-000000000005', 2499.00, true,  '{"weight": "2.14kg", "color": "space-black", "ram": ["18GB", "36GB"]}',          '2025-02-10 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000005', 'ThinkPad X1 Carbon', 'Lenovo business ultrabook',          'd0000000-0000-0000-0000-000000000005', 1849.00, true,  '{"weight": "1.12kg", "color": "black", "screen": "14 inch"}',                    '2025-02-15 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000006', 'ROG Strix G16',      'ASUS gaming laptop',                 'd0000000-0000-0000-0000-000000000008', 1599.00, true,  '{"weight": "2.5kg", "color": "eclipse-gray", "gpu": "RTX 4070"}',               '2025-03-01 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000007', 'Classic Oxford Shirt','Premium cotton dress shirt',          'd0000000-0000-0000-0000-000000000006', 79.99,   true,  '{"material": "100% cotton", "fit": "regular", "care": "machine wash"}',          '2025-03-05 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000008', 'Slim Fit Chinos',    'Stretch cotton chinos',              'd0000000-0000-0000-0000-000000000006', 59.99,   true,  '{"material": "98% cotton 2% elastane", "fit": "slim"}',                          '2025-03-10 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000009', 'Wool Blazer',        'Italian wool blend blazer',          'd0000000-0000-0000-0000-000000000006', 299.99,  true,  '{"material": "wool blend", "color": "navy", "lining": "full"}',                  '2025-03-15 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000010', 'Clean Code',         'Robert C. Martin',                   'd0000000-0000-0000-0000-000000000003', 39.99,   true,  '{"isbn": "978-0132350884", "pages": 464, "format": "hardcover"}',                '2025-03-20 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000011', 'DDIA',               'Designing Data-Intensive Applications','d0000000-0000-0000-0000-000000000003', 44.99,   true,  '{"isbn": "978-1449373320", "pages": 616, "format": "paperback"}',                '2025-03-25 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000012', 'Wireless Earbuds',   'Active noise cancellation',          'd0000000-0000-0000-0000-000000000001', 149.99,  true,  '{"weight": "0.005kg", "battery": "8h", "bluetooth": "5.3"}',                     '2025-04-01 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000013', 'USB-C Hub',          '7-in-1 adapter',                     'd0000000-0000-0000-0000-000000000001', 49.99,   true,  '{"ports": ["HDMI", "USB-A x3", "SD", "microSD", "USB-C PD"], "weight": "0.08kg"}','2025-04-05 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000014', 'Mechanical Keyboard','Cherry MX switches',                  'd0000000-0000-0000-0000-000000000001', 129.99,  false, '{"switches": "Cherry MX Brown", "layout": "TKL", "backlight": "RGB"}',           '2025-04-10 00:00:00+00'),
    ('f0000000-0000-0000-0000-000000000015', 'Ergonomic Mouse',    'Vertical design for comfort',        'd0000000-0000-0000-0000-000000000001', 69.99,   true,  '{"dpi": 4000, "buttons": 6, "wireless": true, "weight": "0.12kg"}',              '2025-04-15 00:00:00+00');

-- --------------------------------------------------------------------------
-- 10.10 Product Variants (25 rows)
-- --------------------------------------------------------------------------
INSERT INTO product_variants (id, product_id, sku, name, price_override, stock_quantity, created_at) VALUES
    ('10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'GS25-128-BLK',  'Galaxy S25 128GB Black',       NULL,    50, '2025-01-20 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'GS25-256-BLK',  'Galaxy S25 256GB Black',       1099.99, 30, '2025-01-20 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000002', 'IP16P-256-TI',  'iPhone 16 Pro 256GB Titanium', NULL,    40, '2025-01-25 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000002', 'IP16P-512-TI',  'iPhone 16 Pro 512GB Titanium', 1399.99, 20, '2025-01-25 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000003', 'PX9-128-OBS',   'Pixel 9 128GB Obsidian',       NULL,    35, '2025-02-01 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000004', 'MBP16-M4P-18',  'MacBook Pro 16 M4 Pro 18GB',   NULL,    15, '2025-02-10 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000004', 'MBP16-M4P-36',  'MacBook Pro 16 M4 Pro 36GB',   2999.00, 10, '2025-02-10 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000005', 'TPX1C-16-BLK',  'ThinkPad X1 Carbon 16GB',      NULL,    25, '2025-02-15 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000006', 'ROG-G16-4070',  'ROG Strix G16 RTX 4070',       NULL,    20, '2025-03-01 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000007', 'OXF-S-WHT',     'Oxford Shirt S White',         NULL,    100,'2025-03-05 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000007', 'OXF-M-WHT',     'Oxford Shirt M White',         NULL,    80, '2025-03-05 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000012', 'f0000000-0000-0000-0000-000000000007', 'OXF-L-BLU',     'Oxford Shirt L Blue',          84.99,   60, '2025-03-05 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000013', 'f0000000-0000-0000-0000-000000000008', 'CHI-30-KHK',    'Chinos 30 Khaki',              NULL,    70, '2025-03-10 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000014', 'f0000000-0000-0000-0000-000000000008', 'CHI-32-NVY',    'Chinos 32 Navy',               NULL,    55, '2025-03-10 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000015', 'f0000000-0000-0000-0000-000000000009', 'BLZ-M-NVY',     'Blazer M Navy',                NULL,    30, '2025-03-15 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000016', 'f0000000-0000-0000-0000-000000000009', 'BLZ-L-NVY',     'Blazer L Navy',                NULL,    25, '2025-03-15 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000017', 'f0000000-0000-0000-0000-000000000010', 'CC-HC-EN',      'Clean Code Hardcover EN',      NULL,    200,'2025-03-20 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000018', 'f0000000-0000-0000-0000-000000000011', 'DDIA-PB-EN',    'DDIA Paperback EN',            NULL,    150,'2025-03-25 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000019', 'f0000000-0000-0000-0000-000000000012', 'WEB-BLK',       'Wireless Earbuds Black',       NULL,    90, '2025-04-01 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000020', 'f0000000-0000-0000-0000-000000000012', 'WEB-WHT',       'Wireless Earbuds White',       NULL,    85, '2025-04-01 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000013', 'USBC-HUB-GRY',  'USB-C Hub Gray',               NULL,    120,'2025-04-05 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000022', 'f0000000-0000-0000-0000-000000000014', 'KB-TKL-BRN',    'Keyboard TKL Brown',           NULL,    40, '2025-04-10 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000023', 'f0000000-0000-0000-0000-000000000014', 'KB-TKL-RED',    'Keyboard TKL Red',             NULL,    35, '2025-04-10 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000024', 'f0000000-0000-0000-0000-000000000015', 'MOUSE-ERG-BLK', 'Ergonomic Mouse Black',        NULL,    75, '2025-04-15 00:00:00+00'),
    ('10000000-0000-0000-0000-000000000025', 'f0000000-0000-0000-0000-000000000015', 'MOUSE-ERG-WHT', 'Ergonomic Mouse White',        74.99,   60, '2025-04-15 00:00:00+00');

-- --------------------------------------------------------------------------
-- 10.11 Product Images (using image_sort_seq via default)
-- --------------------------------------------------------------------------
INSERT INTO product_images (id, product_id, url, alt_text) VALUES
    (uuid_generate_v4(), 'f0000000-0000-0000-0000-000000000001', 'https://cdn.test.com/products/gs25-front.jpg',  'Galaxy S25 front view'),
    (uuid_generate_v4(), 'f0000000-0000-0000-0000-000000000001', 'https://cdn.test.com/products/gs25-back.jpg',   'Galaxy S25 back view'),
    (uuid_generate_v4(), 'f0000000-0000-0000-0000-000000000002', 'https://cdn.test.com/products/ip16p-front.jpg', 'iPhone 16 Pro front'),
    (uuid_generate_v4(), 'f0000000-0000-0000-0000-000000000004', 'https://cdn.test.com/products/mbp16-open.jpg',  'MacBook Pro 16 open'),
    (uuid_generate_v4(), 'f0000000-0000-0000-0000-000000000006', 'https://cdn.test.com/products/rog-top.jpg',     'ROG Strix top view'),
    (uuid_generate_v4(), 'f0000000-0000-0000-0000-000000000007', 'https://cdn.test.com/products/oxford.jpg',      'Classic Oxford Shirt'),
    (uuid_generate_v4(), 'f0000000-0000-0000-0000-000000000010', 'https://cdn.test.com/products/clean-code.jpg',  'Clean Code cover'),
    (uuid_generate_v4(), 'f0000000-0000-0000-0000-000000000012', 'https://cdn.test.com/products/earbuds.jpg',     'Wireless Earbuds');

-- --------------------------------------------------------------------------
-- 10.12 Product Tags (M:N mappings)
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
-- 10.13 Orders (20 rows, spread across 2025-2026 for partition testing)
-- --------------------------------------------------------------------------
INSERT INTO orders (id, user_id, status, total_amount, shipping_address, notes, created_at) VALUES
    ('20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'delivered',  1099.99, ROW('123 Main St','New York','NY','10001','US')::address,        'Gift wrap please',       '2025-01-25 10:00:00+00'),
    ('20000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'delivered',  1199.99, ROW('45 Oxford Rd','London','England','W1D 1BS','GB')::address,  NULL,                     '2025-02-10 11:00:00+00'),
    ('20000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'delivered',  2499.00, ROW('123 Main St','New York','NY','10001','US')::address,        'Express shipping',       '2025-02-20 14:00:00+00'),
    ('20000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'shipped',    899.00,  ROW('789 Gangnam-daero','Seoul','Seoul','06053','KR')::address,  NULL,                     '2025-03-05 09:00:00+00'),
    ('20000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'confirmed',  159.98,  ROW('321 Tech Blvd','San Francisco','CA','94105','US')::address, NULL,                     '2025-03-15 16:00:00+00'),
    ('20000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'processing', 339.98,  ROW('123 Main St','New York','NY','10001','US')::address,        'Two items',              '2025-04-01 08:00:00+00'),
    ('20000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000006', 'pending',    79.99,   ROW('88 Berliner Str','Berlin','Berlin','10115','DE')::address,  NULL,                     '2025-04-15 12:00:00+00'),
    ('20000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000007', 'cancelled',  59.99,   ROW('12 Shibuya','Tokyo','Tokyo','150-0002','JP')::address,      'Changed my mind',        '2025-05-01 10:00:00+00'),
    ('20000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000008', 'delivered',  2999.00, ROW('456 Teheran-ro','Seoul','Seoul','06159','KR')::address,     NULL,                     '2025-05-15 14:00:00+00'),
    ('20000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000009', 'refunded',   39.99,   ROW('99 Nanjing Rd','Shanghai','Shanghai','200001','CN')::address,'Defective item',        '2025-06-01 09:00:00+00'),
    ('20000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'delivered',  149.99,  ROW('45 Oxford Rd','London','England','W1D 1BS','GB')::address,  NULL,                     '2025-07-10 11:00:00+00'),
    ('20000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000003', 'shipped',    259.98,  ROW('789 Gangnam-daero','Seoul','Seoul','06053','KR')::address,  NULL,                     '2025-08-05 09:00:00+00'),
    ('20000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000004', 'processing', 1599.00, ROW('321 Tech Blvd','San Francisco','CA','94105','US')::address, 'Need by Friday',         '2025-09-15 16:00:00+00'),
    ('20000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000001', 'confirmed',  44.99,   ROW('123 Main St','New York','NY','10001','US')::address,        NULL,                     '2025-10-01 08:00:00+00'),
    ('20000000-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-000000000006', 'pending',    199.98,  ROW('88 Berliner Str','Berlin','Berlin','10115','DE')::address,  NULL,                     '2025-11-15 12:00:00+00'),
    ('20000000-0000-0000-0000-000000000016', 'b0000000-0000-0000-0000-000000000007', 'delivered',  49.99,   ROW('12 Shibuya','Tokyo','Tokyo','150-0002','JP')::address,      NULL,                     '2025-12-01 10:00:00+00'),
    ('20000000-0000-0000-0000-000000000017', 'b0000000-0000-0000-0000-000000000008', 'pending',    129.99,  ROW('456 Teheran-ro','Seoul','Seoul','06159','KR')::address,     NULL,                     '2026-01-10 14:00:00+00'),
    ('20000000-0000-0000-0000-000000000018', 'b0000000-0000-0000-0000-000000000002', 'confirmed',  84.98,   ROW('45 Oxford Rd','London','England','W1D 1BS','GB')::address,  'Birthday gift',          '2026-02-14 11:00:00+00'),
    ('20000000-0000-0000-0000-000000000019', 'b0000000-0000-0000-0000-000000000009', 'processing', 1849.00, ROW('99 Nanjing Rd','Shanghai','Shanghai','200001','CN')::address,NULL,                    '2026-03-01 09:00:00+00'),
    ('20000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000004', 'shipped',    69.99,   ROW('321 Tech Blvd','San Francisco','CA','94105','US')::address, NULL,                     '2026-04-10 16:00:00+00');

-- --------------------------------------------------------------------------
-- 10.14 Order Items (40 rows)
-- --------------------------------------------------------------------------
INSERT INTO order_items (id, order_id, order_created_at, product_variant_id, quantity, unit_price) VALUES
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000001', '2025-01-25 10:00:00+00', '10000000-0000-0000-0000-000000000002', 1, 1099.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000002', '2025-02-10 11:00:00+00', '10000000-0000-0000-0000-000000000003', 1, 1199.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000003', '2025-02-20 14:00:00+00', '10000000-0000-0000-0000-000000000006', 1, 2499.00),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000004', '2025-03-05 09:00:00+00', '10000000-0000-0000-0000-000000000005', 1, 899.00),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000005', '2025-03-15 16:00:00+00', '10000000-0000-0000-0000-000000000010', 1, 79.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000005', '2025-03-15 16:00:00+00', '10000000-0000-0000-0000-000000000011', 1, 79.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000006', '2025-04-01 08:00:00+00', '10000000-0000-0000-0000-000000000015', 1, 299.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000006', '2025-04-01 08:00:00+00', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000007', '2025-04-15 12:00:00+00', '10000000-0000-0000-0000-000000000010', 1, 79.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000008', '2025-05-01 10:00:00+00', '10000000-0000-0000-0000-000000000013', 1, 59.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000009', '2025-05-15 14:00:00+00', '10000000-0000-0000-0000-000000000007', 1, 2999.00),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000010', '2025-06-01 09:00:00+00', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000011', '2025-07-10 11:00:00+00', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000012', '2025-08-05 09:00:00+00', '10000000-0000-0000-0000-000000000013', 2, 59.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000012', '2025-08-05 09:00:00+00', '10000000-0000-0000-0000-000000000014', 1, 59.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000012', '2025-08-05 09:00:00+00', '10000000-0000-0000-0000-000000000012', 1, 84.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000013', '2025-09-15 16:00:00+00', '10000000-0000-0000-0000-000000000009', 1, 1599.00),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000014', '2025-10-01 08:00:00+00', '10000000-0000-0000-0000-000000000018', 1, 44.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000015', '2025-11-15 12:00:00+00', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000015', '2025-11-15 12:00:00+00', '10000000-0000-0000-0000-000000000021', 1, 49.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000016', '2025-12-01 10:00:00+00', '10000000-0000-0000-0000-000000000021', 1, 49.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000017', '2026-01-10 14:00:00+00', '10000000-0000-0000-0000-000000000022', 1, 129.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000018', '2026-02-14 11:00:00+00', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000018', '2026-02-14 11:00:00+00', '10000000-0000-0000-0000-000000000018', 1, 44.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000019', '2026-03-01 09:00:00+00', '10000000-0000-0000-0000-000000000008', 1, 1849.00),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000020', '2026-04-10 16:00:00+00', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000001', '2025-01-25 10:00:00+00', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000002', '2025-02-10 11:00:00+00', '10000000-0000-0000-0000-000000000021', 2, 49.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000003', '2025-02-20 14:00:00+00', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000004', '2025-03-05 09:00:00+00', '10000000-0000-0000-0000-000000000017', 2, 39.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000005', '2025-03-15 16:00:00+00', '10000000-0000-0000-0000-000000000013', 1, 59.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000009', '2025-05-15 14:00:00+00', '10000000-0000-0000-0000-000000000020', 2, 149.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000011', '2025-07-10 11:00:00+00', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000013', '2025-09-15 16:00:00+00', '10000000-0000-0000-0000-000000000022', 1, 129.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000014', '2025-10-01 08:00:00+00', '10000000-0000-0000-0000-000000000010', 2, 79.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000016', '2025-12-01 10:00:00+00', '10000000-0000-0000-0000-000000000025', 1, 74.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000017', '2026-01-10 14:00:00+00', '10000000-0000-0000-0000-000000000023', 1, 129.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000019', '2026-03-01 09:00:00+00', '10000000-0000-0000-0000-000000000015', 1, 299.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000020', '2026-04-10 16:00:00+00', '10000000-0000-0000-0000-000000000020', 1, 149.99),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000010', '2025-06-01 09:00:00+00', '10000000-0000-0000-0000-000000000001', 1, 999.99);

-- --------------------------------------------------------------------------
-- 10.15 Payments (20 rows, all payment_status values covered)
-- --------------------------------------------------------------------------
INSERT INTO payments (id, order_id, order_created_at, method, status, amount, transaction_id, paid_at) VALUES
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000001', '2025-01-25 10:00:00+00', 'credit_card',   'captured',    1099.99, 'txn_001_cc', '2025-01-25 10:05:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000002', '2025-02-10 11:00:00+00', 'debit_card',    'captured',    1199.99, 'txn_002_dc', '2025-02-10 11:03:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000003', '2025-02-20 14:00:00+00', 'credit_card',   'captured',    2499.00, 'txn_003_cc', '2025-02-20 14:02:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000004', '2025-03-05 09:00:00+00', 'paypal',        'captured',    899.00,  'txn_004_pp', '2025-03-05 09:10:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000005', '2025-03-15 16:00:00+00', 'credit_card',   'authorized',  159.98,  'txn_005_cc', NULL),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000006', '2025-04-01 08:00:00+00', 'bank_transfer', 'pending',     339.98,  NULL,         NULL),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000007', '2025-04-15 12:00:00+00', 'credit_card',   'pending',     79.99,   NULL,         NULL),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000008', '2025-05-01 10:00:00+00', 'debit_card',    'refunded',    59.99,   'txn_008_dc', '2025-05-01 10:02:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000009', '2025-05-15 14:00:00+00', 'crypto',        'captured',    2999.00, 'txn_009_cr', '2025-05-15 14:15:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000010', '2025-06-01 09:00:00+00', 'credit_card',   'refunded',    39.99,   'txn_010_cc', '2025-06-01 09:05:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000011', '2025-07-10 11:00:00+00', 'paypal',        'captured',    149.99,  'txn_011_pp', '2025-07-10 11:08:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000012', '2025-08-05 09:00:00+00', 'credit_card',   'captured',    259.98,  'txn_012_cc', '2025-08-05 09:04:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000013', '2025-09-15 16:00:00+00', 'bank_transfer', 'authorized',  1599.00, 'txn_013_bt', NULL),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000014', '2025-10-01 08:00:00+00', 'credit_card',   'captured',    44.99,   'txn_014_cc', '2025-10-01 08:03:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000015', '2025-11-15 12:00:00+00', 'debit_card',    'pending',     199.98,  NULL,         NULL),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000016', '2025-12-01 10:00:00+00', 'credit_card',   'captured',    49.99,   'txn_016_cc', '2025-12-01 10:01:00+00'),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000017', '2026-01-10 14:00:00+00', 'paypal',        'pending',     129.99,  NULL,         NULL),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000018', '2026-02-14 11:00:00+00', 'credit_card',   'failed',      84.98,   'txn_018_cc', NULL),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000019', '2026-03-01 09:00:00+00', 'bank_transfer', 'authorized',  1849.00, 'txn_019_bt', NULL),
    (uuid_generate_v4(), '20000000-0000-0000-0000-000000000020', '2026-04-10 16:00:00+00', 'crypto',        'captured',    69.99,   'txn_020_cr', '2026-04-10 16:20:00+00');

-- --------------------------------------------------------------------------
-- 10.16 Shipping Addresses
-- --------------------------------------------------------------------------
INSERT INTO shipping_addresses (id, user_id, label, address, is_default) VALUES
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'Home',   ROW('123 Main St','New York','NY','10001','US')::address,            true),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'Office', ROW('456 Broadway','New York','NY','10012','US')::address,            false),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000002', 'Home',   ROW('45 Oxford Rd','London','England','W1D 1BS','GB')::address,      true),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000003', 'Home',   ROW('789 Gangnam-daero','Seoul','Seoul','06053','KR')::address,      true),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000004', 'Home',   ROW('321 Tech Blvd','San Francisco','CA','94105','US')::address,     true),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000006', 'Home',   ROW('88 Berliner Str','Berlin','Berlin','10115','DE')::address,      true);

-- --------------------------------------------------------------------------
-- 10.17 Warehouses (3 rows with POINT location)
-- --------------------------------------------------------------------------
INSERT INTO warehouses (id, name, location, address, is_active) VALUES
    ('30000000-0000-0000-0000-000000000001', 'US East Warehouse',   POINT(-74.006, 40.7128),  ROW('100 Warehouse Dr','Newark','NJ','07102','US')::address,    true),
    ('30000000-0000-0000-0000-000000000002', 'EU Central Warehouse', POINT(13.405, 52.52),     ROW('50 Lager Str','Berlin','Berlin','10115','DE')::address,    true),
    ('30000000-0000-0000-0000-000000000003', 'Asia Pacific Warehouse',POINT(126.978, 37.5665), ROW('200 Changgo-ro','Seoul','Seoul','04527','KR')::address,   true);

-- --------------------------------------------------------------------------
-- 10.18 Inventory
-- --------------------------------------------------------------------------
INSERT INTO inventory (id, product_variant_id, warehouse_id, quantity) VALUES
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 20),
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 30),
    ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 15),
    ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 25),
    ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 15),
    ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', 10),
    ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', 5),
    ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000002', 50),
    ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000017', '30000000-0000-0000-0000-000000000001', 100),
    ('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000019', '30000000-0000-0000-0000-000000000001', 45),
    ('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000019', '30000000-0000-0000-0000-000000000003', 45),
    ('40000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000024', '30000000-0000-0000-0000-000000000001', 40);

-- --------------------------------------------------------------------------
-- 10.19 Inventory Log (manual seed; trigger will also produce rows)
-- --------------------------------------------------------------------------
INSERT INTO inventory_log (id, inventory_id, old_quantity, new_quantity, changed_at) VALUES
    (uuid_generate_v4(), '40000000-0000-0000-0000-000000000001', 25, 20, '2025-02-01 10:00:00+00'),
    (uuid_generate_v4(), '40000000-0000-0000-0000-000000000004', 30, 25, '2025-03-01 11:00:00+00'),
    (uuid_generate_v4(), '40000000-0000-0000-0000-000000000009', 105, 100, '2025-04-01 12:00:00+00'),
    (uuid_generate_v4(), '40000000-0000-0000-0000-000000000010', 50, 45, '2025-07-15 13:00:00+00');

-- --------------------------------------------------------------------------
-- 10.20 Posts (10 rows)
-- --------------------------------------------------------------------------
INSERT INTO posts (id, user_id, title, body, is_published, published_at, created_at) VALUES
    ('50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Getting Started with PostgreSQL',    'PostgreSQL is an advanced open-source relational database...', true,  '2025-02-01 10:00:00+00', '2025-02-01 09:00:00+00'),
    ('50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Advanced Indexing Strategies',       'Choosing the right index type can dramatically improve...', true,  '2025-03-01 10:00:00+00', '2025-03-01 09:00:00+00'),
    ('50000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'UI Design Principles',               'Good design is invisible. Here are my top principles...', true,  '2025-03-15 12:00:00+00', '2025-03-15 11:00:00+00'),
    ('50000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'Product Management 101',             'The role of a PM is to discover the right product...', true,  '2025-04-01 08:00:00+00', '2025-04-01 07:00:00+00'),
    ('50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'Data Science in Production',         'Moving from notebooks to production pipelines requires...', true,  '2025-04-15 14:00:00+00', '2025-04-15 13:00:00+00'),
    ('50000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000007', 'React Performance Tips',             'Memoization, lazy loading, and virtual scrolling...', true,  '2025-05-01 10:00:00+00', '2025-05-01 09:00:00+00'),
    ('50000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000008', 'Startup Engineering Culture',        'Building a strong engineering culture from day one...', true,  '2025-05-15 16:00:00+00', '2025-05-15 15:00:00+00'),
    ('50000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000009', 'My First Month as a Developer',      'Reflections on joining a startup as a junior...', true,  '2025-06-01 10:00:00+00', '2025-06-01 09:00:00+00'),
    ('50000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'Partitioning in PostgreSQL',         'When your tables grow large, partitioning helps...', false, NULL,                     '2025-06-15 09:00:00+00'),
    ('50000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000006', 'Operations Playbook',                'Incident response, on-call rotations, and SLOs...', false, NULL,                     '2025-07-01 09:00:00+00');

-- --------------------------------------------------------------------------
-- 10.21 Comments (15 rows, nested 2-3 levels)
-- --------------------------------------------------------------------------
INSERT INTO comments (id, post_id, user_id, parent_comment_id, body, created_at) VALUES
    -- Top-level comments
    ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', NULL,                                     'Great introduction! Very helpful for beginners.',            '2025-02-02 10:00:00+00'),
    ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', NULL,                                     'Could you cover materialized views next?',                   '2025-02-03 11:00:00+00'),
    ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', NULL,                                     'The GIN index section was especially useful.',               '2025-03-02 12:00:00+00'),
    ('60000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', NULL,                                     'Love the minimalist approach discussed here.',               '2025-03-16 14:00:00+00'),
    ('60000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000007', NULL,                                     'This matches my experience as a PM perfectly.',              '2025-04-02 09:00:00+00'),
    ('60000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000008', NULL,                                     'We had similar challenges deploying ML models.',             '2025-04-16 15:00:00+00'),
    ('60000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', NULL,                                     'React.memo saved us significant re-renders.',                '2025-05-02 11:00:00+00'),
    ('60000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', NULL,                                     'Culture is indeed the hardest part to get right.',           '2025-05-16 17:00:00+00'),
    -- Level 2 replies
    ('60000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Thanks! I have a follow-up post planned.',                   '2025-02-02 14:00:00+00'),
    ('60000000-0000-0000-0000-000000000010', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'Yes, see my new post on partitioning!',                       '2025-02-04 10:00:00+00'),
    ('60000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', 'GIN is perfect for JSONB. I will do a deep dive.',           '2025-03-03 08:00:00+00'),
    ('60000000-0000-0000-0000-000000000012', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000006', 'Feature stores helped us a lot with that.',                   '2025-04-17 10:00:00+00'),
    -- Level 3 replies
    ('60000000-0000-0000-0000-000000000013', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000009', 'Looking forward to it!',                                      '2025-02-02 16:00:00+00'),
    ('60000000-0000-0000-0000-000000000014', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000011', 'Would love a comparison with pg_trgm indexes too.',          '2025-03-03 12:00:00+00'),
    ('60000000-0000-0000-0000-000000000015', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000012', 'Which feature store did you go with?',                        '2025-04-17 14:00:00+00');

-- --------------------------------------------------------------------------
-- 10.22 Notifications (spread across partitions)
-- --------------------------------------------------------------------------
INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at) VALUES
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'order',     'Order Confirmed',          'Your order #001 has been confirmed.',              true,  '2025-01-25 10:10:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'payment',   'Payment Received',         'Payment of $1099.99 has been captured.',            true,  '2025-01-25 10:15:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000002', 'order',     'Order Shipped',            'Your order #002 is on the way.',                   true,  '2025-02-12 09:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000003', 'system',    'Welcome',                  'Welcome to the platform, Charlie!',                true,  '2025-02-01 10:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000004', 'promotion', 'Spring Sale',              'Get 20% off on all electronics.',                  false, '2025-03-20 08:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000006', 'alert',     'Low Stock Alert',          'Product ROG Strix G16 is running low.',            false, '2025-04-01 07:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000007', 'order',     'Order Cancelled',          'Your order #008 has been cancelled.',               true,  '2025-05-01 11:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000008', 'payment',   'Refund Processed',         'Your refund of $39.99 has been issued.',            true,  '2025-06-05 10:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'system',    'Password Changed',         'Your password was changed successfully.',           true,  '2025-08-01 09:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000009', 'promotion', 'Holiday Deals',            'Check out our holiday specials!',                   false, '2025-12-15 08:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000002', 'order',     'Order Delivered',          'Your order #018 has been delivered.',               false, '2026-02-20 14:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000004', 'alert',     'Account Activity',         'New login from a new device detected.',             false, '2026-03-05 16:00:00+00');

-- --------------------------------------------------------------------------
-- 10.23 Settings (5 key-value pairs)
-- --------------------------------------------------------------------------
INSERT INTO settings (id, key, value, description) VALUES
    (uuid_generate_v4(), 'site_name',            'Rockury MVP',     'Public-facing site name'),
    (uuid_generate_v4(), 'max_upload_size_mb',   '50',              'Maximum file upload size in megabytes'),
    (uuid_generate_v4(), 'default_currency',     'USD',             'Default currency for pricing'),
    (uuid_generate_v4(), 'maintenance_mode',     'false',           'Enable/disable maintenance mode'),
    (uuid_generate_v4(), 'session_timeout_mins',  '30',             'Session timeout in minutes');

-- --------------------------------------------------------------------------
-- 10.24 API Keys
-- --------------------------------------------------------------------------
INSERT INTO api_keys (id, user_id, key_value, name, is_active, expires_at) VALUES
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'rky_live_ak_001_alice_2025', 'Alice Production Key',  true,  '2026-01-10 00:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'rky_test_ak_002_alice_2025', 'Alice Test Key',        true,  '2025-12-31 23:59:59+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000008', 'rky_live_ak_003_henry_2025', 'Henry Production Key',  true,  '2026-06-30 00:00:00+00'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000005', 'rky_live_ak_004_eve_expired','Eve Expired Key',       false, '2025-06-01 00:00:00+00');

-- --------------------------------------------------------------------------
-- 10.25 File Uploads
-- --------------------------------------------------------------------------
INSERT INTO file_uploads (id, user_id, filename, mime_type, size_bytes, storage_path) VALUES
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000001', 'profile-photo.jpg',      'image/jpeg',           245000,  '/uploads/users/b001/profile-photo.jpg'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000002', 'design-mockup.png',      'image/png',            1520000, '/uploads/users/b002/design-mockup.png'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000003', 'quarterly-report.pdf',   'application/pdf',      890000,  '/uploads/users/b003/quarterly-report.pdf'),
    (uuid_generate_v4(), 'b0000000-0000-0000-0000-000000000008', 'architecture-diagram.svg','image/svg+xml',        125000,  '/uploads/users/b008/architecture-diagram.svg');

-- --------------------------------------------------------------------------
-- 10.26 Migrations (3 version records)
-- --------------------------------------------------------------------------
INSERT INTO migrations (id, version, name, applied_at) VALUES
    (uuid_generate_v4(), '001', 'initial_schema',          '2025-01-01 00:00:00+00'),
    (uuid_generate_v4(), '002', 'add_partitioning',        '2025-02-01 00:00:00+00'),
    (uuid_generate_v4(), '003', 'add_rls_and_security',    '2025-03-01 00:00:00+00');

-- =============================================================================
-- Refresh materialized view after seed data
-- =============================================================================
REFRESH MATERIALIZED VIEW mv_product_stats;

COMMIT;
