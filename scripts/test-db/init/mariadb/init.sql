-- =============================================================================
-- MariaDB Test Database Init Script
-- Target: Docker MariaDB 10.6+ (port 13307, user=test, password=test, db=testdb)
-- Purpose: Comprehensive coverage of all MariaDB design elements
-- =============================================================================

-- =============================================================================
-- 0. SETTINGS
-- =============================================================================
SET GLOBAL event_scheduler = ON;
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- =============================================================================
-- 0.5 SEQUENCES (MariaDB 10.3+ feature)
-- =============================================================================
CREATE SEQUENCE image_sort_seq START WITH 1 INCREMENT BY 10;
CREATE SEQUENCE audit_seq START WITH 1 INCREMENT BY 1 NOCYCLE;

-- =============================================================================
-- 1. TABLES (28 tables in FK-dependency topological order)
-- =============================================================================
-- Notes:
-- - CHAR(36) for UUID columns; UUID() for defaults where possible
-- - ENGINE=InnoDB for all tables
-- - Column-level ENUM/SET instead of CREATE TYPE
-- - No composite types (address stored as separate columns or JSON)
-- - No domain types (validation via CHECK constraints)
-- - Partitioned tables (orders, inventory_log, notifications, audit_logs)
--   cannot have FK constraints in MariaDB. Referential integrity is handled
--   at application level for those tables.
-- - InnoDB does NOT support SET DEFAULT referential action.
--   We use a BEFORE DELETE trigger workaround for notifications.
-- - MariaDB sequences used for product_images sort_order
-- - System versioning used on audit_logs (MariaDB-specific)

-- --------------------------------------------------------------------------
-- 1.1 roles
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          CHAR(36) NOT NULL DEFAULT (UUID()),
    name        VARCHAR(50) NOT NULL,
    description TEXT,
    created_at  DATETIME NOT NULL DEFAULT NOW(),
    updated_at  DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB COMMENT='Application roles for RBAC';

-- --------------------------------------------------------------------------
-- 1.2 users
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            CHAR(36) NOT NULL DEFAULT (UUID()),
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    full_name     VARCHAR(200) AS (CONCAT(first_name, ' ', last_name)) STORED,
    email         VARCHAR(255) NOT NULL,
    age           INT CHECK (age >= 0 AND age <= 200),
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    DATETIME NOT NULL DEFAULT NOW(),
    updated_at    DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    CONSTRAINT chk_users_email CHECK (email REGEXP '^[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}$')
) ENGINE=InnoDB COMMENT='Core user accounts table';

-- --------------------------------------------------------------------------
-- 1.3 user_profiles (1:1 with users)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
    id          CHAR(36) NOT NULL DEFAULT (UUID()),
    user_id     CHAR(36) NOT NULL,
    bio         TEXT,
    avatar_url  VARCHAR(500),
    preferences JSON NOT NULL DEFAULT (JSON_OBJECT()),
    -- Address fields (no composite type in MariaDB)
    addr_street      VARCHAR(255),
    addr_city        VARCHAR(100),
    addr_state       VARCHAR(100),
    addr_postal_code VARCHAR(20),
    addr_country     VARCHAR(100),
    created_at  DATETIME NOT NULL DEFAULT NOW(),
    updated_at  DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_profiles_user_id (user_id),
    CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='1:1 extension of users with profile data and JSON preferences';

-- --------------------------------------------------------------------------
-- 1.4 user_roles (M:N join)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
    user_id     CHAR(36) NOT NULL,
    role_id     CHAR(36) NOT NULL,
    assigned_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Many-to-many join between users and roles';

-- --------------------------------------------------------------------------
-- 1.5 organizations (self-referencing hierarchy)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id            CHAR(36) NOT NULL DEFAULT (UUID()),
    name          VARCHAR(200) NOT NULL,
    parent_org_id CHAR(36),
    created_at    DATETIME NOT NULL DEFAULT NOW(),
    updated_at    DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_organizations_parent FOREIGN KEY (parent_org_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Hierarchical organization structure with self-referencing FK';

-- --------------------------------------------------------------------------
-- 1.6 org_members
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_members (
    id        CHAR(36) NOT NULL DEFAULT (UUID()),
    org_id    CHAR(36) NOT NULL,
    user_id   CHAR(36) NOT NULL,
    role      VARCHAR(20) NOT NULL,
    joined_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT chk_org_members_role CHECK (role IN ('admin', 'member', 'viewer')),
    CONSTRAINT fk_org_members_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_org_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Organization membership with role-based access';

-- --------------------------------------------------------------------------
-- 1.7 categories (self-referencing tree)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    name       VARCHAR(100) NOT NULL,
    slug       VARCHAR(100) NOT NULL,
    parent_id  CHAR(36),
    depth      INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_categories_name (name),
    UNIQUE KEY uq_categories_slug (slug),
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Product category tree with depth tracking';

-- --------------------------------------------------------------------------
-- 1.8 tags
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    name       VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_tags_name (name)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------
-- 1.9 products
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id          CHAR(36) NOT NULL DEFAULT (UUID()),
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    category_id CHAR(36),
    price       DECIMAL(12, 2) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    metadata    JSON,
    created_at  DATETIME NOT NULL DEFAULT NOW(),
    updated_at  DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT chk_products_price CHECK (price >= 0),
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Product catalog with JSON metadata and category FK (SET NULL/CASCADE)';

-- --------------------------------------------------------------------------
-- 1.10 product_variants
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
    id              CHAR(36) NOT NULL DEFAULT (UUID()),
    product_id      CHAR(36) NOT NULL,
    sku             VARCHAR(100) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    price_override  DECIMAL(12, 2),
    stock_quantity  INT NOT NULL DEFAULT 0,
    created_at      DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_product_variants_product_sku (product_id, sku),
    CONSTRAINT fk_product_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='SKU-level variants with composite unique constraint';

-- --------------------------------------------------------------------------
-- 1.11 product_images (uses SEQUENCE for sort_order)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_images (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    product_id CHAR(36) NOT NULL,
    url        VARCHAR(500) NOT NULL,
    alt_text   VARCHAR(300),
    sort_order INT NOT NULL DEFAULT (NEXT VALUE FOR image_sort_seq),
    created_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_product_images_sort (sort_order),
    CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Product images with sequence-based sort_order (MariaDB SEQUENCE)';

-- --------------------------------------------------------------------------
-- 1.12 product_tags (M:N join)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_tags (
    product_id CHAR(36) NOT NULL,
    tag_id     CHAR(36) NOT NULL,
    PRIMARY KEY (product_id, tag_id),
    CONSTRAINT fk_product_tags_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_product_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------
-- 1.13 orders (partitioned by created_at)
-- NOTE: MariaDB partitioned tables cannot have FK constraints.
-- Referential integrity for user_id is handled at application level.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id               CHAR(36) NOT NULL DEFAULT (UUID()),
    user_id          CHAR(36) NOT NULL COMMENT 'References users(id) - FK omitted due to partitioning limitation',
    status           ENUM('pending','confirmed','processing','shipped','delivered','cancelled','refunded') NOT NULL DEFAULT 'pending',
    total_amount     DECIMAL(12, 2),
    -- Shipping address fields (no composite type in MariaDB)
    ship_street      VARCHAR(255),
    ship_city        VARCHAR(100),
    ship_state       VARCHAR(100),
    ship_postal_code VARCHAR(20),
    ship_country     VARCHAR(100),
    notes            TEXT,
    created_at       DATETIME NOT NULL DEFAULT NOW(),
    updated_at       DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) ENGINE=InnoDB COMMENT='Orders partitioned by created_at (RANGE). FK to users omitted due to MariaDB partition limitation.'
PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p2025h1 VALUES LESS THAN (TO_DAYS('2025-07-01')),
    PARTITION p2025h2 VALUES LESS THAN (TO_DAYS('2026-01-01')),
    PARTITION p2026h1 VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p_max VALUES LESS THAN MAXVALUE
);

-- --------------------------------------------------------------------------
-- 1.14 order_items
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id                 CHAR(36) NOT NULL DEFAULT (UUID()),
    order_id           CHAR(36) NOT NULL,
    order_created_at   DATETIME NOT NULL,
    product_variant_id CHAR(36) NOT NULL,
    quantity           INT NOT NULL,
    unit_price         DECIMAL(12, 2) NOT NULL,
    created_at         DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT fk_order_items_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT ON UPDATE CASCADE
    -- FK to orders(id, created_at) omitted because orders is partitioned
) ENGINE=InnoDB COMMENT='Line items. FK to partitioned orders omitted; refs product_variants with RESTRICT/CASCADE.';

-- --------------------------------------------------------------------------
-- 1.15 payments
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id               CHAR(36) NOT NULL DEFAULT (UUID()),
    order_id         CHAR(36) NOT NULL,
    order_created_at DATETIME NOT NULL,
    method           ENUM('credit_card','debit_card','bank_transfer','paypal','crypto') NOT NULL,
    status           ENUM('pending','authorized','captured','failed','refunded') NOT NULL DEFAULT 'pending',
    amount           DECIMAL(12, 2) NOT NULL,
    transaction_id   VARCHAR(200),
    paid_at          DATETIME,
    created_at       DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
    -- FK to orders omitted because orders is partitioned
) ENGINE=InnoDB COMMENT='Payment records. FK to partitioned orders omitted.';

-- --------------------------------------------------------------------------
-- 1.16 shipping_addresses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipping_addresses (
    id               CHAR(36) NOT NULL DEFAULT (UUID()),
    user_id          CHAR(36) NOT NULL,
    label            VARCHAR(100),
    addr_street      VARCHAR(255) NOT NULL,
    addr_city        VARCHAR(100) NOT NULL,
    addr_state       VARCHAR(100) NOT NULL,
    addr_postal_code VARCHAR(20) NOT NULL,
    addr_country     VARCHAR(100) NOT NULL,
    is_default       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_shipping_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB COMMENT='User shipping addresses with CASCADE/NO ACTION FK';

-- --------------------------------------------------------------------------
-- 1.17 warehouses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    name       VARCHAR(200) NOT NULL,
    location   POINT NOT NULL,
    addr_street      VARCHAR(255),
    addr_city        VARCHAR(100),
    addr_state       VARCHAR(100),
    addr_postal_code VARCHAR(20),
    addr_country     VARCHAR(100),
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_warehouses_name (name),
    SPATIAL INDEX idx_warehouses_location (location)
) ENGINE=InnoDB COMMENT='Warehouses with SPATIAL INDEX on POINT location';

-- --------------------------------------------------------------------------
-- 1.18 inventory
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
    id                 CHAR(36) NOT NULL DEFAULT (UUID()),
    product_variant_id CHAR(36) NOT NULL,
    warehouse_id       CHAR(36) NOT NULL,
    quantity           INT NOT NULL,
    updated_at         DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_variant_warehouse (product_variant_id, warehouse_id),
    CONSTRAINT chk_inventory_quantity CHECK (quantity >= 0),
    CONSTRAINT fk_inventory_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_inventory_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Stock levels per variant per warehouse';

-- --------------------------------------------------------------------------
-- 1.19 inventory_log (partitioned by changed_at)
-- NOTE: FK omitted due to partitioning limitation.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_log (
    id           CHAR(36) NOT NULL DEFAULT (UUID()),
    inventory_id CHAR(36) NOT NULL COMMENT 'References inventory(id) - FK omitted due to partitioning',
    old_quantity INT,
    new_quantity INT,
    changed_at   DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, changed_at)
) ENGINE=InnoDB COMMENT='Inventory change audit trail, partitioned by changed_at. FK omitted due to MariaDB partition limitation.'
PARTITION BY RANGE (TO_DAYS(changed_at)) (
    PARTITION p2025h1 VALUES LESS THAN (TO_DAYS('2025-07-01')),
    PARTITION p2025h2 VALUES LESS THAN (TO_DAYS('2026-01-01')),
    PARTITION p2026h1 VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p_max VALUES LESS THAN MAXVALUE
);

-- --------------------------------------------------------------------------
-- 1.20 posts
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
    id           CHAR(36) NOT NULL DEFAULT (UUID()),
    user_id      CHAR(36) NOT NULL,
    title        VARCHAR(300) NOT NULL,
    body         TEXT,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    published_at DATETIME,
    created_at   DATETIME NOT NULL DEFAULT NOW(),
    updated_at   DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------
-- 1.21 comments (self-referencing for nesting)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
    id                CHAR(36) NOT NULL DEFAULT (UUID()),
    post_id           CHAR(36) NOT NULL,
    user_id           CHAR(36) NOT NULL,
    parent_comment_id CHAR(36),
    body              TEXT NOT NULL,
    created_at        DATETIME NOT NULL DEFAULT NOW(),
    updated_at        DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_comments_parent FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB COMMENT='Nested comments with CASCADE/NO ACTION to posts, SET NULL/NO ACTION to self';

-- --------------------------------------------------------------------------
-- 1.22 notifications (partitioned by created_at)
-- NOTE: FK omitted due to partitioning limitation.
-- InnoDB does NOT support SET DEFAULT. We use a BEFORE DELETE trigger on users
-- to set notifications.user_id to the system user UUID as a workaround.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    user_id    CHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' COMMENT 'References users(id) - FK omitted; SET DEFAULT emulated via trigger',
    type       ENUM('order','payment','system','promotion','alert') NOT NULL,
    title      VARCHAR(300) NOT NULL,
    message    TEXT,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) ENGINE=InnoDB COMMENT='User notifications partitioned by created_at. SET DEFAULT emulated via trigger on users.'
PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p2025h1 VALUES LESS THAN (TO_DAYS('2025-07-01')),
    PARTITION p2025h2 VALUES LESS THAN (TO_DAYS('2026-01-01')),
    PARTITION p2026h1 VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p_max VALUES LESS THAN MAXVALUE
);

-- --------------------------------------------------------------------------
-- 1.23 audit_logs (partitioned by performed_at, WITH SYSTEM VERSIONING)
-- MariaDB-specific: system versioning provides automatic row history tracking
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id           CHAR(36) NOT NULL DEFAULT (UUID()),
    seq_no       BIGINT NOT NULL DEFAULT (NEXT VALUE FOR audit_seq),
    table_name   VARCHAR(100) NOT NULL,
    action       VARCHAR(10) NOT NULL,
    record_id    CHAR(36),
    old_data     JSON,
    new_data     JSON,
    performed_by CHAR(36),
    performed_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, performed_at)
) ENGINE=InnoDB COMMENT='Generic audit trail, partitioned by performed_at, with MariaDB system versioning and sequence'
PARTITION BY RANGE (TO_DAYS(performed_at)) (
    PARTITION p2025h1 VALUES LESS THAN (TO_DAYS('2025-07-01')),
    PARTITION p2025h2 VALUES LESS THAN (TO_DAYS('2026-01-01')),
    PARTITION p2026h1 VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p_max VALUES LESS THAN MAXVALUE
);

-- --------------------------------------------------------------------------
-- 1.24 settings
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    id          CHAR(36) NOT NULL DEFAULT (UUID()),
    `key`       VARCHAR(200) NOT NULL,
    value       TEXT,
    description TEXT,
    created_at  DATETIME NOT NULL DEFAULT NOW(),
    updated_at  DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_settings_key (`key`)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------
-- 1.25 scheduled_jobs
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    job_name   VARCHAR(200) NOT NULL,
    schedule   VARCHAR(100) NOT NULL,
    definition TEXT,
    status     ENUM('enabled','disabled') NOT NULL,
    start_time DATETIME,
    end_time   DATETIME,
    created_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------
-- 1.26 api_keys
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    user_id    CHAR(36) NOT NULL,
    key_value  VARCHAR(255) NOT NULL,
    name       VARCHAR(200) NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_api_keys_key_value (key_value),
    CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------
-- 1.27 file_uploads
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_uploads (
    id           CHAR(36) NOT NULL DEFAULT (UUID()),
    user_id      CHAR(36) NOT NULL,
    filename     VARCHAR(500) NOT NULL,
    mime_type    VARCHAR(100) NOT NULL,
    size_bytes   BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_file_uploads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------
-- 1.28 migrations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migrations (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    version    VARCHAR(50) NOT NULL,
    name       VARCHAR(300) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_migrations_version (version)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------
-- 1.29 Demo: region_sales (LIST partition)
-- MariaDB supports LIST partitioning but only on INT columns or expressions.
-- We use a region_code INT mapping instead of VARCHAR LIST.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_sales (
    id          CHAR(36) NOT NULL DEFAULT (UUID()),
    region      VARCHAR(20) NOT NULL,
    region_code TINYINT NOT NULL COMMENT 'Partition key: 1=Asia, 2=Europe, 3=Americas, 0=Other',
    amount      DECIMAL(12, 2),
    sold_at     DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, region_code)
) ENGINE=InnoDB COMMENT='Demo: LIST partitioning by region_code'
PARTITION BY LIST (region_code) (
    PARTITION p_asia     VALUES IN (1),
    PARTITION p_europe   VALUES IN (2),
    PARTITION p_americas VALUES IN (3),
    PARTITION p_other    VALUES IN (0)
);

-- --------------------------------------------------------------------------
-- 1.30 Demo: session_logs (KEY/HASH partition)
-- MariaDB KEY partitioning works similarly to MySQL.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_logs (
    id         CHAR(36) NOT NULL DEFAULT (UUID()),
    session_id CHAR(36) NOT NULL,
    event      VARCHAR(100),
    created_at DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, session_id)
) ENGINE=InnoDB COMMENT='Demo: KEY partitioning by session_id with 4 partitions'
PARTITION BY KEY (session_id)
PARTITIONS 4;

-- =============================================================================
-- 2. INDEXES
-- =============================================================================

-- B-Tree: standard lookup
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_orders_user_id ON orders (user_id);
CREATE INDEX idx_products_category_id ON products (category_id);

-- Hash: equality-only lookup (InnoDB uses BTREE adapter)
CREATE INDEX idx_api_keys_key_value ON api_keys (key_value);

-- JSON indexes: MariaDB uses generated columns + regular indexes (no functional index syntax)
ALTER TABLE products ADD COLUMN metadata_weight VARCHAR(50) AS (JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.weight'))) VIRTUAL;
CREATE INDEX idx_products_metadata_weight ON products (metadata_weight);
ALTER TABLE user_profiles ADD COLUMN pref_theme VARCHAR(20) AS (JSON_UNQUOTE(JSON_EXTRACT(preferences, '$.theme'))) VIRTUAL;
CREATE INDEX idx_user_profiles_pref_theme ON user_profiles (pref_theme);

-- Fulltext: text search on products
CREATE FULLTEXT INDEX idx_products_fulltext ON products (name, description);

-- Composite index
CREATE INDEX idx_order_items_order_variant ON order_items (order_id, product_variant_id);

-- Index on payments for order lookup
CREATE INDEX idx_payments_order ON payments (order_id, order_created_at);

-- Index on posts
CREATE INDEX idx_posts_user_id ON posts (user_id);

-- Index on comments
CREATE INDEX idx_comments_post_id ON comments (post_id);

-- Unique index on settings key (case-sensitive in MariaDB by default; collation handles case)
-- Already covered by uq_settings_key

-- =============================================================================
-- 3. VIEWS (using CREATE OR REPLACE - MariaDB native support)
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
WHERE is_active = TRUE
WITH CHECK OPTION;

-- Note: MariaDB does not support materialized views.
-- Use a regular table + event to simulate mv_product_stats if needed.

-- =============================================================================
-- 4. FUNCTIONS & PROCEDURES (using CREATE OR REPLACE - MariaDB native support)
-- =============================================================================

DELIMITER //

-- Scalar function: calculate order total from items
CREATE OR REPLACE FUNCTION fn_calc_order_total(p_order_id CHAR(36))
RETURNS DECIMAL(12, 2)
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(12, 2);
    SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_total
    FROM order_items
    WHERE order_id = p_order_id;
    RETURN v_total;
END //

-- Slug generator function
CREATE OR REPLACE FUNCTION fn_generate_slug(p_text TEXT)
RETURNS TEXT
DETERMINISTIC
NO SQL
BEGIN
    DECLARE v_slug TEXT;
    SET v_slug = LOWER(TRIM(p_text));
    -- Remove non-alphanumeric except spaces and hyphens
    SET v_slug = REGEXP_REPLACE(v_slug, '[^a-z0-9 \\-]', '');
    -- Replace spaces with hyphens
    SET v_slug = REGEXP_REPLACE(v_slug, '\\s+', '-');
    RETURN v_slug;
END //

-- Procedure: cleanup expired notifications (with default param emulated)
CREATE OR REPLACE PROCEDURE proc_cleanup_expired_notifications(IN p_older_than_days INT)
BEGIN
    IF p_older_than_days IS NULL THEN
        SET p_older_than_days = 90;
    END IF;
    DELETE FROM notifications
    WHERE is_read = TRUE
      AND created_at < DATE_SUB(NOW(), INTERVAL p_older_than_days DAY);
END //

-- Procedure: recalculate inventory (OUT param)
CREATE OR REPLACE PROCEDURE proc_recalc_inventory(
    IN p_product_variant_id CHAR(36),
    OUT p_total_quantity INT
)
BEGIN
    SELECT COALESCE(SUM(quantity), 0)
    INTO p_total_quantity
    FROM inventory
    WHERE product_variant_id = p_product_variant_id;
END //

DELIMITER ;

-- =============================================================================
-- 5. TRIGGERS (using CREATE OR REPLACE - MariaDB native support)
-- =============================================================================

DELIMITER //

-- Trigger: auto-set updated_at on users
CREATE OR REPLACE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

-- Trigger: auto-set updated_at on user_profiles
CREATE OR REPLACE TRIGGER trg_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

-- Trigger: auto-set updated_at on products
CREATE OR REPLACE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

-- Trigger: auto-set updated_at on posts
CREATE OR REPLACE TRIGGER trg_posts_updated_at
BEFORE UPDATE ON posts
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

-- Trigger: auto-set updated_at on comments
CREATE OR REPLACE TRIGGER trg_comments_updated_at
BEFORE UPDATE ON comments
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

-- Trigger: auto-set updated_at on settings
CREATE OR REPLACE TRIGGER trg_settings_updated_at
BEFORE UPDATE ON settings
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

-- Trigger: auto-set updated_at on organizations
CREATE OR REPLACE TRIGGER trg_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

-- Trigger: auto-set updated_at on roles
CREATE OR REPLACE TRIGGER trg_roles_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END //

-- Trigger: audit log for orders (AFTER INSERT)
CREATE OR REPLACE TRIGGER trg_orders_audit_insert
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
    INSERT INTO audit_logs (table_name, action, record_id, old_data, new_data, performed_at)
    VALUES ('orders', 'INSERT', NEW.id, NULL, JSON_OBJECT(
        'id', NEW.id,
        'user_id', NEW.user_id,
        'status', NEW.status,
        'total_amount', NEW.total_amount,
        'created_at', NEW.created_at
    ), NOW());
END //

-- Trigger: audit log for orders (AFTER UPDATE)
CREATE OR REPLACE TRIGGER trg_orders_audit_update
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    INSERT INTO audit_logs (table_name, action, record_id, old_data, new_data, performed_at)
    VALUES ('orders', 'UPDATE', NEW.id, JSON_OBJECT(
        'id', OLD.id,
        'user_id', OLD.user_id,
        'status', OLD.status,
        'total_amount', OLD.total_amount
    ), JSON_OBJECT(
        'id', NEW.id,
        'user_id', NEW.user_id,
        'status', NEW.status,
        'total_amount', NEW.total_amount
    ), NOW());
END //

-- Trigger: audit log for orders (AFTER DELETE)
CREATE OR REPLACE TRIGGER trg_orders_audit_delete
AFTER DELETE ON orders
FOR EACH ROW
BEGIN
    INSERT INTO audit_logs (table_name, action, record_id, old_data, new_data, performed_at)
    VALUES ('orders', 'DELETE', OLD.id, JSON_OBJECT(
        'id', OLD.id,
        'user_id', OLD.user_id,
        'status', OLD.status,
        'total_amount', OLD.total_amount
    ), NULL, NOW());
END //

-- Trigger: inventory change log (AFTER UPDATE)
CREATE OR REPLACE TRIGGER trg_inventory_quantity_change
AFTER UPDATE ON inventory
FOR EACH ROW
BEGIN
    IF OLD.quantity <> NEW.quantity THEN
        INSERT INTO inventory_log (inventory_id, old_quantity, new_quantity, changed_at)
        VALUES (NEW.id, OLD.quantity, NEW.quantity, NOW());
    END IF;
END //

-- Trigger: emulate SET DEFAULT for notifications when a user is deleted.
-- Before deleting a user, reassign their notifications to the system user.
CREATE OR REPLACE TRIGGER trg_users_before_delete_set_default_notifications
BEFORE DELETE ON users
FOR EACH ROW
BEGIN
    UPDATE notifications
    SET user_id = '00000000-0000-0000-0000-000000000000'
    WHERE user_id = OLD.id;
END //

DELIMITER ;

-- =============================================================================
-- 6. EVENTS
-- =============================================================================

-- Event: cleanup old read notifications daily
CREATE EVENT IF NOT EXISTS evt_cleanup_notifications
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
DO
    DELETE FROM notifications
    WHERE is_read = TRUE
      AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- Event: refresh stats hourly (placeholder - logs a message since no materialized views)
CREATE EVENT IF NOT EXISTS evt_refresh_stats
ON SCHEDULE EVERY 1 HOUR
STARTS CURRENT_TIMESTAMP
DO
    INSERT INTO audit_logs (table_name, action, record_id, old_data, new_data, performed_at)
    VALUES ('_system', 'REFRESH', NULL, NULL, JSON_OBJECT('event', 'evt_refresh_stats', 'note', 'Stats refresh placeholder'), NOW());

-- =============================================================================
-- 7. SECURITY (CREATE USER, GRANT)
-- =============================================================================

-- Create users (IF NOT EXISTS supported in MariaDB)
CREATE USER IF NOT EXISTS 'app_admin'@'%' IDENTIFIED BY 'admin_pass';
CREATE USER IF NOT EXISTS 'app_readonly'@'%' IDENTIFIED BY 'readonly_pass';
CREATE USER IF NOT EXISTS 'app_user'@'%' IDENTIFIED BY 'user_pass';

-- Grants
GRANT ALL PRIVILEGES ON testdb.* TO 'app_admin'@'%';
GRANT SELECT ON testdb.* TO 'app_readonly'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON testdb.* TO 'app_user'@'%';

FLUSH PRIVILEGES;

-- Note: MariaDB does not support Row-Level Security (RLS).
-- Application-level authorization should be used instead.

-- =============================================================================
-- 8. SEED DATA (~150 rows)
-- =============================================================================

-- --------------------------------------------------------------------------
-- 8.1 Roles (4 rows)
-- --------------------------------------------------------------------------
INSERT INTO roles (id, name, description) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'admin',    'Full system access'),
    ('a0000000-0000-0000-0000-000000000002', 'manager',  'Team and content management'),
    ('a0000000-0000-0000-0000-000000000003', 'user',     'Standard user access'),
    ('a0000000-0000-0000-0000-000000000004', 'readonly', 'Read-only access');

-- --------------------------------------------------------------------------
-- 8.2 Users (10 rows, including system user)
-- Note: MariaDB does not have pgcrypto. Using SHA2 for password hashing in test.
-- In production, use application-level bcrypt/argon2.
-- --------------------------------------------------------------------------
INSERT INTO users (id, first_name, last_name, email, age, password_hash, is_active, created_at) VALUES
    ('00000000-0000-0000-0000-000000000000', 'System',  'User',     'system@testdb.local',    0,   SHA2('system',  256), TRUE,  '2024-01-01 00:00:00'),
    ('b0000000-0000-0000-0000-000000000001', 'Alice',   'Johnson',  'alice@example.com',      30,  SHA2('pass123', 256), TRUE,  '2025-01-10 08:00:00'),
    ('b0000000-0000-0000-0000-000000000002', 'Bob',     'Smith',    'bob@example.com',        25,  SHA2('pass123', 256), TRUE,  '2025-01-15 09:00:00'),
    ('b0000000-0000-0000-0000-000000000003', 'Charlie', 'Brown',    'charlie@example.com',    35,  SHA2('pass123', 256), TRUE,  '2025-02-01 10:00:00'),
    ('b0000000-0000-0000-0000-000000000004', 'Diana',   'Prince',   'diana@example.com',      28,  SHA2('pass123', 256), TRUE,  '2025-02-10 11:00:00'),
    ('b0000000-0000-0000-0000-000000000005', 'Eve',     'Williams', 'eve@example.com',        32,  SHA2('pass123', 256), FALSE, '2025-03-01 12:00:00'),
    ('b0000000-0000-0000-0000-000000000006', 'Frank',   'Miller',   'frank@example.com',      40,  SHA2('pass123', 256), TRUE,  '2025-03-15 13:00:00'),
    ('b0000000-0000-0000-0000-000000000007', 'Grace',   'Lee',      'grace@example.com',      27,  SHA2('pass123', 256), TRUE,  '2025-04-01 14:00:00'),
    ('b0000000-0000-0000-0000-000000000008', 'Henry',   'Kim',      'henry@example.com',      45,  SHA2('pass123', 256), TRUE,  '2025-04-15 15:00:00'),
    ('b0000000-0000-0000-0000-000000000009', 'Iris',    'Chen',     'iris@example.com',       22,  SHA2('pass123', 256), TRUE,  '2025-05-01 16:00:00');

-- --------------------------------------------------------------------------
-- 8.3 User Profiles (10 rows with varied JSON)
-- --------------------------------------------------------------------------
INSERT INTO user_profiles (user_id, bio, avatar_url, preferences, addr_street, addr_city, addr_state, addr_postal_code, addr_country) VALUES
    ('00000000-0000-0000-0000-000000000000', 'System account',           NULL,                                    '{"theme": "dark", "lang": "en"}',                                          '1 System St',        'Cloud',          'NA',         '00000',    'US'),
    ('b0000000-0000-0000-0000-000000000001', 'Software engineer at NYC', 'https://cdn.test.com/avatars/alice.jpg', '{"theme": "light", "lang": "en", "notifications": true}',                  '123 Main St',        'New York',       'NY',         '10001',    'US'),
    ('b0000000-0000-0000-0000-000000000002', 'Designer from London',     'https://cdn.test.com/avatars/bob.jpg',   '{"theme": "dark", "lang": "en", "notifications": false}',                  '45 Oxford Rd',       'London',         'England',    'W1D 1BS',  'GB'),
    ('b0000000-0000-0000-0000-000000000003', 'Product manager',          'https://cdn.test.com/avatars/charlie.jpg','{"theme": "auto", "lang": "ko", "timezone": "Asia/Seoul"}',                '789 Gangnam-daero',  'Seoul',          'Seoul',      '06053',    'KR'),
    ('b0000000-0000-0000-0000-000000000004', 'Data scientist',           NULL,                                    '{"theme": "dark", "lang": "en", "dashboard_layout": "grid"}',              '321 Tech Blvd',      'San Francisco',  'CA',         '94105',    'US'),
    ('b0000000-0000-0000-0000-000000000005', 'Inactive user',            NULL,                                    '{}',                                                                        '555 Elm St',         'Chicago',        'IL',         '60601',    'US'),
    ('b0000000-0000-0000-0000-000000000006', 'Operations lead',          'https://cdn.test.com/avatars/frank.jpg', '{"theme": "light", "lang": "de", "currency": "EUR"}',                     '88 Berliner Str',    'Berlin',         'Berlin',     '10115',    'DE'),
    ('b0000000-0000-0000-0000-000000000007', 'Frontend developer',       'https://cdn.test.com/avatars/grace.jpg', '{"theme": "dark", "lang": "ja", "editor": "vim"}',                        '12 Shibuya',         'Tokyo',          'Tokyo',      '150-0002', 'JP'),
    ('b0000000-0000-0000-0000-000000000008', 'CTO at startup',           'https://cdn.test.com/avatars/henry.jpg', '{"theme": "light", "lang": "ko", "notifications": true, "beta": true}',   '456 Teheran-ro',     'Seoul',          'Seoul',      '06159',    'KR'),
    ('b0000000-0000-0000-0000-000000000009', 'Junior developer',         NULL,                                    '{"theme": "auto", "lang": "zh", "onboarding_complete": false}',            '99 Nanjing Rd',      'Shanghai',       'Shanghai',   '200001',   'CN');

-- --------------------------------------------------------------------------
-- 8.4 User Roles mappings
-- --------------------------------------------------------------------------
INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '2025-01-10 08:00:00'),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', '2025-01-15 09:00:00'),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', '2025-02-01 10:00:00'),
    ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', '2025-02-10 11:00:00'),
    ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', '2025-03-01 12:00:00'),
    ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', '2025-03-15 13:00:00'),
    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', '2025-04-01 14:00:00'),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', '2025-04-15 15:00:00'),
    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000004', '2025-05-01 16:00:00');

-- --------------------------------------------------------------------------
-- 8.5 Organizations (5 rows: 2 parents + 3 children)
-- --------------------------------------------------------------------------
INSERT INTO organizations (id, name, parent_org_id, created_at) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Rockury Corp',          NULL,                                     '2025-01-01 00:00:00'),
    ('c0000000-0000-0000-0000-000000000002', 'Acme Holdings',         NULL,                                     '2025-01-01 00:00:00'),
    ('c0000000-0000-0000-0000-000000000003', 'Rockury Engineering',   'c0000000-0000-0000-0000-000000000001',   '2025-02-01 00:00:00'),
    ('c0000000-0000-0000-0000-000000000004', 'Rockury Marketing',     'c0000000-0000-0000-0000-000000000001',   '2025-02-01 00:00:00'),
    ('c0000000-0000-0000-0000-000000000005', 'Acme Research',         'c0000000-0000-0000-0000-000000000002',   '2025-03-01 00:00:00');

-- --------------------------------------------------------------------------
-- 8.6 Org Members
-- --------------------------------------------------------------------------
INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'admin',  '2025-01-10 08:00:00'),
    ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'member', '2025-01-15 09:00:00'),
    ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'admin',  '2025-02-01 10:00:00'),
    ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004', 'member', '2025-02-10 11:00:00'),
    ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000006', 'admin',  '2025-03-15 13:00:00'),
    ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000008', 'admin',  '2025-04-15 15:00:00'),
    ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000007', 'viewer', '2025-04-01 14:00:00');

-- --------------------------------------------------------------------------
-- 8.7 Categories (8 rows, 3 levels deep)
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
-- 8.8 Tags (6 rows)
-- --------------------------------------------------------------------------
INSERT INTO tags (id, name) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'new-arrival'),
    ('e0000000-0000-0000-0000-000000000002', 'best-seller'),
    ('e0000000-0000-0000-0000-000000000003', 'sale'),
    ('e0000000-0000-0000-0000-000000000004', 'limited-edition'),
    ('e0000000-0000-0000-0000-000000000005', 'eco-friendly'),
    ('e0000000-0000-0000-0000-000000000006', 'premium');

-- --------------------------------------------------------------------------
-- 8.9 Products (15 rows with varied JSON metadata)
-- --------------------------------------------------------------------------
INSERT INTO products (id, name, description, category_id, price, is_active, metadata, created_at) VALUES
    ('f0000000-0000-0000-0000-000000000001', 'Galaxy S25',         'Latest Samsung flagship',             'd0000000-0000-0000-0000-000000000004', 999.99,  TRUE,  '{"weight": "0.187kg", "color": "black", "storage": ["128GB", "256GB"]}',          '2025-01-20 00:00:00'),
    ('f0000000-0000-0000-0000-000000000002', 'iPhone 16 Pro',      'Apple premium smartphone',            'd0000000-0000-0000-0000-000000000004', 1199.99, TRUE,  '{"weight": "0.199kg", "color": "titanium", "storage": ["256GB", "512GB", "1TB"]}','2025-01-25 00:00:00'),
    ('f0000000-0000-0000-0000-000000000003', 'Pixel 9',            'Google AI-powered phone',             'd0000000-0000-0000-0000-000000000007', 899.00,  TRUE,  '{"weight": "0.198kg", "color": "obsidian", "ai_features": true}',                '2025-02-01 00:00:00'),
    ('f0000000-0000-0000-0000-000000000004', 'MacBook Pro 16',     'M4 Pro chip laptop',                  'd0000000-0000-0000-0000-000000000005', 2499.00, TRUE,  '{"weight": "2.14kg", "color": "space-black", "ram": ["18GB", "36GB"]}',          '2025-02-10 00:00:00'),
    ('f0000000-0000-0000-0000-000000000005', 'ThinkPad X1 Carbon', 'Lenovo business ultrabook',           'd0000000-0000-0000-0000-000000000005', 1849.00, TRUE,  '{"weight": "1.12kg", "color": "black", "screen": "14 inch"}',                    '2025-02-15 00:00:00'),
    ('f0000000-0000-0000-0000-000000000006', 'ROG Strix G16',      'ASUS gaming laptop',                  'd0000000-0000-0000-0000-000000000008', 1599.00, TRUE,  '{"weight": "2.5kg", "color": "eclipse-gray", "gpu": "RTX 4070"}',               '2025-03-01 00:00:00'),
    ('f0000000-0000-0000-0000-000000000007', 'Classic Oxford Shirt','Premium cotton dress shirt',           'd0000000-0000-0000-0000-000000000006', 79.99,   TRUE,  '{"material": "100% cotton", "fit": "regular", "care": "machine wash"}',          '2025-03-05 00:00:00'),
    ('f0000000-0000-0000-0000-000000000008', 'Slim Fit Chinos',    'Stretch cotton chinos',               'd0000000-0000-0000-0000-000000000006', 59.99,   TRUE,  '{"material": "98% cotton 2% elastane", "fit": "slim"}',                          '2025-03-10 00:00:00'),
    ('f0000000-0000-0000-0000-000000000009', 'Wool Blazer',        'Italian wool blend blazer',           'd0000000-0000-0000-0000-000000000006', 299.99,  TRUE,  '{"material": "wool blend", "color": "navy", "lining": "full"}',                  '2025-03-15 00:00:00'),
    ('f0000000-0000-0000-0000-000000000010', 'Clean Code',         'Robert C. Martin',                    'd0000000-0000-0000-0000-000000000003', 39.99,   TRUE,  '{"isbn": "978-0132350884", "pages": 464, "format": "hardcover"}',                '2025-03-20 00:00:00'),
    ('f0000000-0000-0000-0000-000000000011', 'DDIA',               'Designing Data-Intensive Applications','d0000000-0000-0000-0000-000000000003', 44.99,   TRUE,  '{"isbn": "978-1449373320", "pages": 616, "format": "paperback"}',                '2025-03-25 00:00:00'),
    ('f0000000-0000-0000-0000-000000000012', 'Wireless Earbuds',   'Active noise cancellation',           'd0000000-0000-0000-0000-000000000001', 149.99,  TRUE,  '{"weight": "0.005kg", "battery": "8h", "bluetooth": "5.3"}',                     '2025-04-01 00:00:00'),
    ('f0000000-0000-0000-0000-000000000013', 'USB-C Hub',          '7-in-1 adapter',                      'd0000000-0000-0000-0000-000000000001', 49.99,   TRUE,  '{"ports": ["HDMI", "USB-A x3", "SD", "microSD", "USB-C PD"], "weight": "0.08kg"}','2025-04-05 00:00:00'),
    ('f0000000-0000-0000-0000-000000000014', 'Mechanical Keyboard','Cherry MX switches',                   'd0000000-0000-0000-0000-000000000001', 129.99,  FALSE, '{"switches": "Cherry MX Brown", "layout": "TKL", "backlight": "RGB"}',           '2025-04-10 00:00:00'),
    ('f0000000-0000-0000-0000-000000000015', 'Ergonomic Mouse',    'Vertical design for comfort',         'd0000000-0000-0000-0000-000000000001', 69.99,   TRUE,  '{"dpi": 4000, "buttons": 6, "wireless": true, "weight": "0.12kg"}',              '2025-04-15 00:00:00');

-- --------------------------------------------------------------------------
-- 8.10 Product Variants (25 rows)
-- --------------------------------------------------------------------------
INSERT INTO product_variants (id, product_id, sku, name, price_override, stock_quantity, created_at) VALUES
    ('10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'GS25-128-BLK',  'Galaxy S25 128GB Black',       NULL,    50, '2025-01-20 00:00:00'),
    ('10000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'GS25-256-BLK',  'Galaxy S25 256GB Black',       1099.99, 30, '2025-01-20 00:00:00'),
    ('10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000002', 'IP16P-256-TI',  'iPhone 16 Pro 256GB Titanium', NULL,    40, '2025-01-25 00:00:00'),
    ('10000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000002', 'IP16P-512-TI',  'iPhone 16 Pro 512GB Titanium', 1399.99, 20, '2025-01-25 00:00:00'),
    ('10000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000003', 'PX9-128-OBS',   'Pixel 9 128GB Obsidian',       NULL,    35, '2025-02-01 00:00:00'),
    ('10000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000004', 'MBP16-M4P-18',  'MacBook Pro 16 M4 Pro 18GB',   NULL,    15, '2025-02-10 00:00:00'),
    ('10000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000004', 'MBP16-M4P-36',  'MacBook Pro 16 M4 Pro 36GB',   2999.00, 10, '2025-02-10 00:00:00'),
    ('10000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000005', 'TPX1C-16-BLK',  'ThinkPad X1 Carbon 16GB',      NULL,    25, '2025-02-15 00:00:00'),
    ('10000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000006', 'ROG-G16-4070',  'ROG Strix G16 RTX 4070',       NULL,    20, '2025-03-01 00:00:00'),
    ('10000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000007', 'OXF-S-WHT',     'Oxford Shirt S White',         NULL,    100,'2025-03-05 00:00:00'),
    ('10000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000007', 'OXF-M-WHT',     'Oxford Shirt M White',         NULL,    80, '2025-03-05 00:00:00'),
    ('10000000-0000-0000-0000-000000000012', 'f0000000-0000-0000-0000-000000000007', 'OXF-L-BLU',     'Oxford Shirt L Blue',          84.99,   60, '2025-03-05 00:00:00'),
    ('10000000-0000-0000-0000-000000000013', 'f0000000-0000-0000-0000-000000000008', 'CHI-30-KHK',    'Chinos 30 Khaki',              NULL,    70, '2025-03-10 00:00:00'),
    ('10000000-0000-0000-0000-000000000014', 'f0000000-0000-0000-0000-000000000008', 'CHI-32-NVY',    'Chinos 32 Navy',               NULL,    55, '2025-03-10 00:00:00'),
    ('10000000-0000-0000-0000-000000000015', 'f0000000-0000-0000-0000-000000000009', 'BLZ-M-NVY',     'Blazer M Navy',                NULL,    30, '2025-03-15 00:00:00'),
    ('10000000-0000-0000-0000-000000000016', 'f0000000-0000-0000-0000-000000000009', 'BLZ-L-NVY',     'Blazer L Navy',                NULL,    25, '2025-03-15 00:00:00'),
    ('10000000-0000-0000-0000-000000000017', 'f0000000-0000-0000-0000-000000000010', 'CC-HC-EN',      'Clean Code Hardcover EN',      NULL,    200,'2025-03-20 00:00:00'),
    ('10000000-0000-0000-0000-000000000018', 'f0000000-0000-0000-0000-000000000011', 'DDIA-PB-EN',    'DDIA Paperback EN',            NULL,    150,'2025-03-25 00:00:00'),
    ('10000000-0000-0000-0000-000000000019', 'f0000000-0000-0000-0000-000000000012', 'WEB-BLK',       'Wireless Earbuds Black',       NULL,    90, '2025-04-01 00:00:00'),
    ('10000000-0000-0000-0000-000000000020', 'f0000000-0000-0000-0000-000000000012', 'WEB-WHT',       'Wireless Earbuds White',       NULL,    85, '2025-04-01 00:00:00'),
    ('10000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000013', 'USBC-HUB-GRY',  'USB-C Hub Gray',               NULL,    120,'2025-04-05 00:00:00'),
    ('10000000-0000-0000-0000-000000000022', 'f0000000-0000-0000-0000-000000000014', 'KB-TKL-BRN',    'Keyboard TKL Brown',           NULL,    40, '2025-04-10 00:00:00'),
    ('10000000-0000-0000-0000-000000000023', 'f0000000-0000-0000-0000-000000000014', 'KB-TKL-RED',    'Keyboard TKL Red',             NULL,    35, '2025-04-10 00:00:00'),
    ('10000000-0000-0000-0000-000000000024', 'f0000000-0000-0000-0000-000000000015', 'MOUSE-ERG-BLK', 'Ergonomic Mouse Black',        NULL,    75, '2025-04-15 00:00:00'),
    ('10000000-0000-0000-0000-000000000025', 'f0000000-0000-0000-0000-000000000015', 'MOUSE-ERG-WHT', 'Ergonomic Mouse White',        74.99,   60, '2025-04-15 00:00:00');

-- --------------------------------------------------------------------------
-- 8.11 Product Images (sort_order via SEQUENCE - values assigned by default)
-- --------------------------------------------------------------------------
INSERT INTO product_images (product_id, url, alt_text) VALUES
    ('f0000000-0000-0000-0000-000000000001', 'https://cdn.test.com/products/gs25-front.jpg',  'Galaxy S25 front view'),
    ('f0000000-0000-0000-0000-000000000001', 'https://cdn.test.com/products/gs25-back.jpg',   'Galaxy S25 back view'),
    ('f0000000-0000-0000-0000-000000000002', 'https://cdn.test.com/products/ip16p-front.jpg', 'iPhone 16 Pro front'),
    ('f0000000-0000-0000-0000-000000000004', 'https://cdn.test.com/products/mbp16-open.jpg',  'MacBook Pro 16 open'),
    ('f0000000-0000-0000-0000-000000000006', 'https://cdn.test.com/products/rog-top.jpg',     'ROG Strix top view'),
    ('f0000000-0000-0000-0000-000000000007', 'https://cdn.test.com/products/oxford.jpg',      'Classic Oxford Shirt'),
    ('f0000000-0000-0000-0000-000000000010', 'https://cdn.test.com/products/clean-code.jpg',  'Clean Code cover'),
    ('f0000000-0000-0000-0000-000000000012', 'https://cdn.test.com/products/earbuds.jpg',     'Wireless Earbuds');

-- --------------------------------------------------------------------------
-- 8.12 Product Tags (M:N mappings)
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
-- 8.13 Orders (20 rows, spread across 2025-2026 for partition testing)
-- --------------------------------------------------------------------------
INSERT INTO orders (id, user_id, status, total_amount, ship_street, ship_city, ship_state, ship_postal_code, ship_country, notes, created_at) VALUES
    ('20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'delivered',  1099.99, '123 Main St',       'New York',      'NY',       '10001',   'US', 'Gift wrap please',       '2025-01-25 10:00:00'),
    ('20000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'delivered',  1199.99, '45 Oxford Rd',      'London',        'England',  'W1D 1BS', 'GB', NULL,                     '2025-02-10 11:00:00'),
    ('20000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'delivered',  2499.00, '123 Main St',       'New York',      'NY',       '10001',   'US', 'Express shipping',       '2025-02-20 14:00:00'),
    ('20000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'shipped',    899.00,  '789 Gangnam-daero', 'Seoul',         'Seoul',    '06053',   'KR', NULL,                     '2025-03-05 09:00:00'),
    ('20000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'confirmed',  159.98,  '321 Tech Blvd',     'San Francisco', 'CA',       '94105',   'US', NULL,                     '2025-03-15 16:00:00'),
    ('20000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'processing', 339.98,  '123 Main St',       'New York',      'NY',       '10001',   'US', 'Two items',              '2025-04-01 08:00:00'),
    ('20000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000006', 'pending',    79.99,   '88 Berliner Str',   'Berlin',        'Berlin',   '10115',   'DE', NULL,                     '2025-04-15 12:00:00'),
    ('20000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000007', 'cancelled',  59.99,   '12 Shibuya',        'Tokyo',         'Tokyo',    '150-0002','JP', 'Changed my mind',        '2025-05-01 10:00:00'),
    ('20000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000008', 'delivered',  2999.00, '456 Teheran-ro',    'Seoul',         'Seoul',    '06159',   'KR', NULL,                     '2025-05-15 14:00:00'),
    ('20000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000009', 'refunded',   39.99,   '99 Nanjing Rd',     'Shanghai',      'Shanghai', '200001',  'CN', 'Defective item',         '2025-06-01 09:00:00'),
    ('20000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'delivered',  149.99,  '45 Oxford Rd',      'London',        'England',  'W1D 1BS', 'GB', NULL,                     '2025-07-10 11:00:00'),
    ('20000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000003', 'shipped',    259.98,  '789 Gangnam-daero', 'Seoul',         'Seoul',    '06053',   'KR', NULL,                     '2025-08-05 09:00:00'),
    ('20000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000004', 'processing', 1599.00, '321 Tech Blvd',     'San Francisco', 'CA',       '94105',   'US', 'Need by Friday',         '2025-09-15 16:00:00'),
    ('20000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000001', 'confirmed',  44.99,   '123 Main St',       'New York',      'NY',       '10001',   'US', NULL,                     '2025-10-01 08:00:00'),
    ('20000000-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-000000000006', 'pending',    199.98,  '88 Berliner Str',   'Berlin',        'Berlin',   '10115',   'DE', NULL,                     '2025-11-15 12:00:00'),
    ('20000000-0000-0000-0000-000000000016', 'b0000000-0000-0000-0000-000000000007', 'delivered',  49.99,   '12 Shibuya',        'Tokyo',         'Tokyo',    '150-0002','JP', NULL,                     '2025-12-01 10:00:00'),
    ('20000000-0000-0000-0000-000000000017', 'b0000000-0000-0000-0000-000000000008', 'pending',    129.99,  '456 Teheran-ro',    'Seoul',         'Seoul',    '06159',   'KR', NULL,                     '2026-01-10 14:00:00'),
    ('20000000-0000-0000-0000-000000000018', 'b0000000-0000-0000-0000-000000000002', 'confirmed',  84.98,   '45 Oxford Rd',      'London',        'England',  'W1D 1BS', 'GB', 'Birthday gift',          '2026-02-14 11:00:00'),
    ('20000000-0000-0000-0000-000000000019', 'b0000000-0000-0000-0000-000000000009', 'processing', 1849.00, '99 Nanjing Rd',     'Shanghai',      'Shanghai', '200001',  'CN', NULL,                     '2026-03-01 09:00:00'),
    ('20000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000004', 'shipped',    69.99,   '321 Tech Blvd',     'San Francisco', 'CA',       '94105',   'US', NULL,                     '2026-04-10 16:00:00');

-- --------------------------------------------------------------------------
-- 8.14 Order Items (40 rows)
-- --------------------------------------------------------------------------
INSERT INTO order_items (order_id, order_created_at, product_variant_id, quantity, unit_price) VALUES
    ('20000000-0000-0000-0000-000000000001', '2025-01-25 10:00:00', '10000000-0000-0000-0000-000000000002', 1, 1099.99),
    ('20000000-0000-0000-0000-000000000002', '2025-02-10 11:00:00', '10000000-0000-0000-0000-000000000003', 1, 1199.99),
    ('20000000-0000-0000-0000-000000000003', '2025-02-20 14:00:00', '10000000-0000-0000-0000-000000000006', 1, 2499.00),
    ('20000000-0000-0000-0000-000000000004', '2025-03-05 09:00:00', '10000000-0000-0000-0000-000000000005', 1, 899.00),
    ('20000000-0000-0000-0000-000000000005', '2025-03-15 16:00:00', '10000000-0000-0000-0000-000000000010', 1, 79.99),
    ('20000000-0000-0000-0000-000000000005', '2025-03-15 16:00:00', '10000000-0000-0000-0000-000000000011', 1, 79.99),
    ('20000000-0000-0000-0000-000000000006', '2025-04-01 08:00:00', '10000000-0000-0000-0000-000000000015', 1, 299.99),
    ('20000000-0000-0000-0000-000000000006', '2025-04-01 08:00:00', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    ('20000000-0000-0000-0000-000000000007', '2025-04-15 12:00:00', '10000000-0000-0000-0000-000000000010', 1, 79.99),
    ('20000000-0000-0000-0000-000000000008', '2025-05-01 10:00:00', '10000000-0000-0000-0000-000000000013', 1, 59.99),
    ('20000000-0000-0000-0000-000000000009', '2025-05-15 14:00:00', '10000000-0000-0000-0000-000000000007', 1, 2999.00),
    ('20000000-0000-0000-0000-000000000010', '2025-06-01 09:00:00', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    ('20000000-0000-0000-0000-000000000011', '2025-07-10 11:00:00', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    ('20000000-0000-0000-0000-000000000012', '2025-08-05 09:00:00', '10000000-0000-0000-0000-000000000013', 2, 59.99),
    ('20000000-0000-0000-0000-000000000012', '2025-08-05 09:00:00', '10000000-0000-0000-0000-000000000014', 1, 59.99),
    ('20000000-0000-0000-0000-000000000012', '2025-08-05 09:00:00', '10000000-0000-0000-0000-000000000012', 1, 84.99),
    ('20000000-0000-0000-0000-000000000013', '2025-09-15 16:00:00', '10000000-0000-0000-0000-000000000009', 1, 1599.00),
    ('20000000-0000-0000-0000-000000000014', '2025-10-01 08:00:00', '10000000-0000-0000-0000-000000000018', 1, 44.99),
    ('20000000-0000-0000-0000-000000000015', '2025-11-15 12:00:00', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    ('20000000-0000-0000-0000-000000000015', '2025-11-15 12:00:00', '10000000-0000-0000-0000-000000000021', 1, 49.99),
    ('20000000-0000-0000-0000-000000000016', '2025-12-01 10:00:00', '10000000-0000-0000-0000-000000000021', 1, 49.99),
    ('20000000-0000-0000-0000-000000000017', '2026-01-10 14:00:00', '10000000-0000-0000-0000-000000000022', 1, 129.99),
    ('20000000-0000-0000-0000-000000000018', '2026-02-14 11:00:00', '10000000-0000-0000-0000-000000000017', 1, 39.99),
    ('20000000-0000-0000-0000-000000000018', '2026-02-14 11:00:00', '10000000-0000-0000-0000-000000000018', 1, 44.99),
    ('20000000-0000-0000-0000-000000000019', '2026-03-01 09:00:00', '10000000-0000-0000-0000-000000000008', 1, 1849.00),
    ('20000000-0000-0000-0000-000000000020', '2026-04-10 16:00:00', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    ('20000000-0000-0000-0000-000000000001', '2025-01-25 10:00:00', '10000000-0000-0000-0000-000000000019', 1, 149.99),
    ('20000000-0000-0000-0000-000000000002', '2025-02-10 11:00:00', '10000000-0000-0000-0000-000000000021', 2, 49.99),
    ('20000000-0000-0000-0000-000000000003', '2025-02-20 14:00:00', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    ('20000000-0000-0000-0000-000000000004', '2025-03-05 09:00:00', '10000000-0000-0000-0000-000000000017', 2, 39.99),
    ('20000000-0000-0000-0000-000000000005', '2025-03-15 16:00:00', '10000000-0000-0000-0000-000000000013', 1, 59.99),
    ('20000000-0000-0000-0000-000000000009', '2025-05-15 14:00:00', '10000000-0000-0000-0000-000000000020', 2, 149.99),
    ('20000000-0000-0000-0000-000000000011', '2025-07-10 11:00:00', '10000000-0000-0000-0000-000000000024', 1, 69.99),
    ('20000000-0000-0000-0000-000000000013', '2025-09-15 16:00:00', '10000000-0000-0000-0000-000000000022', 1, 129.99),
    ('20000000-0000-0000-0000-000000000014', '2025-10-01 08:00:00', '10000000-0000-0000-0000-000000000010', 2, 79.99),
    ('20000000-0000-0000-0000-000000000016', '2025-12-01 10:00:00', '10000000-0000-0000-0000-000000000025', 1, 74.99),
    ('20000000-0000-0000-0000-000000000017', '2026-01-10 14:00:00', '10000000-0000-0000-0000-000000000023', 1, 129.99),
    ('20000000-0000-0000-0000-000000000019', '2026-03-01 09:00:00', '10000000-0000-0000-0000-000000000015', 1, 299.99),
    ('20000000-0000-0000-0000-000000000020', '2026-04-10 16:00:00', '10000000-0000-0000-0000-000000000020', 1, 149.99),
    ('20000000-0000-0000-0000-000000000010', '2025-06-01 09:00:00', '10000000-0000-0000-0000-000000000001', 1, 999.99);

-- --------------------------------------------------------------------------
-- 8.15 Payments (20 rows, all payment statuses covered)
-- --------------------------------------------------------------------------
INSERT INTO payments (order_id, order_created_at, method, status, amount, transaction_id, paid_at) VALUES
    ('20000000-0000-0000-0000-000000000001', '2025-01-25 10:00:00', 'credit_card',   'captured',    1099.99, 'txn_001_cc', '2025-01-25 10:05:00'),
    ('20000000-0000-0000-0000-000000000002', '2025-02-10 11:00:00', 'debit_card',    'captured',    1199.99, 'txn_002_dc', '2025-02-10 11:03:00'),
    ('20000000-0000-0000-0000-000000000003', '2025-02-20 14:00:00', 'credit_card',   'captured',    2499.00, 'txn_003_cc', '2025-02-20 14:02:00'),
    ('20000000-0000-0000-0000-000000000004', '2025-03-05 09:00:00', 'paypal',        'captured',    899.00,  'txn_004_pp', '2025-03-05 09:10:00'),
    ('20000000-0000-0000-0000-000000000005', '2025-03-15 16:00:00', 'credit_card',   'authorized',  159.98,  'txn_005_cc', NULL),
    ('20000000-0000-0000-0000-000000000006', '2025-04-01 08:00:00', 'bank_transfer', 'pending',     339.98,  NULL,         NULL),
    ('20000000-0000-0000-0000-000000000007', '2025-04-15 12:00:00', 'credit_card',   'pending',     79.99,   NULL,         NULL),
    ('20000000-0000-0000-0000-000000000008', '2025-05-01 10:00:00', 'debit_card',    'refunded',    59.99,   'txn_008_dc', '2025-05-01 10:02:00'),
    ('20000000-0000-0000-0000-000000000009', '2025-05-15 14:00:00', 'crypto',        'captured',    2999.00, 'txn_009_cr', '2025-05-15 14:15:00'),
    ('20000000-0000-0000-0000-000000000010', '2025-06-01 09:00:00', 'credit_card',   'refunded',    39.99,   'txn_010_cc', '2025-06-01 09:05:00'),
    ('20000000-0000-0000-0000-000000000011', '2025-07-10 11:00:00', 'paypal',        'captured',    149.99,  'txn_011_pp', '2025-07-10 11:08:00'),
    ('20000000-0000-0000-0000-000000000012', '2025-08-05 09:00:00', 'credit_card',   'captured',    259.98,  'txn_012_cc', '2025-08-05 09:04:00'),
    ('20000000-0000-0000-0000-000000000013', '2025-09-15 16:00:00', 'bank_transfer', 'authorized',  1599.00, 'txn_013_bt', NULL),
    ('20000000-0000-0000-0000-000000000014', '2025-10-01 08:00:00', 'credit_card',   'captured',    44.99,   'txn_014_cc', '2025-10-01 08:03:00'),
    ('20000000-0000-0000-0000-000000000015', '2025-11-15 12:00:00', 'debit_card',    'pending',     199.98,  NULL,         NULL),
    ('20000000-0000-0000-0000-000000000016', '2025-12-01 10:00:00', 'credit_card',   'captured',    49.99,   'txn_016_cc', '2025-12-01 10:01:00'),
    ('20000000-0000-0000-0000-000000000017', '2026-01-10 14:00:00', 'paypal',        'pending',     129.99,  NULL,         NULL),
    ('20000000-0000-0000-0000-000000000018', '2026-02-14 11:00:00', 'credit_card',   'failed',      84.98,   'txn_018_cc', NULL),
    ('20000000-0000-0000-0000-000000000019', '2026-03-01 09:00:00', 'bank_transfer', 'authorized',  1849.00, 'txn_019_bt', NULL),
    ('20000000-0000-0000-0000-000000000020', '2026-04-10 16:00:00', 'crypto',        'captured',    69.99,   'txn_020_cr', '2026-04-10 16:20:00');

-- --------------------------------------------------------------------------
-- 8.16 Shipping Addresses
-- --------------------------------------------------------------------------
INSERT INTO shipping_addresses (user_id, label, addr_street, addr_city, addr_state, addr_postal_code, addr_country, is_default) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'Home',   '123 Main St',       'New York',      'NY',       '10001',   'US', TRUE),
    ('b0000000-0000-0000-0000-000000000001', 'Office', '456 Broadway',      'New York',      'NY',       '10012',   'US', FALSE),
    ('b0000000-0000-0000-0000-000000000002', 'Home',   '45 Oxford Rd',      'London',        'England',  'W1D 1BS', 'UK', TRUE),
    ('b0000000-0000-0000-0000-000000000003', 'Home',   '789 Gangnam-daero', 'Seoul',         'Seoul',    '06053',   'KR', TRUE),
    ('b0000000-0000-0000-0000-000000000004', 'Home',   '321 Tech Blvd',     'San Francisco', 'CA',       '94105',   'US', TRUE),
    ('b0000000-0000-0000-0000-000000000006', 'Home',   '88 Berliner Str',   'Berlin',        'Berlin',   '10115',   'DE', TRUE);

-- --------------------------------------------------------------------------
-- 8.17 Warehouses (3 rows with POINT location)
-- --------------------------------------------------------------------------
INSERT INTO warehouses (id, name, location, addr_street, addr_city, addr_state, addr_postal_code, addr_country, is_active) VALUES
    ('30000000-0000-0000-0000-000000000001', 'US East Warehouse',      ST_GeomFromText('POINT(-74.006 40.7128)'),  '100 Warehouse Dr', 'Newark', 'NJ',     '07102', 'US', TRUE),
    ('30000000-0000-0000-0000-000000000002', 'EU Central Warehouse',   ST_GeomFromText('POINT(13.405 52.52)'),     '50 Lager Str',     'Berlin', 'Berlin', '10115', 'DE', TRUE),
    ('30000000-0000-0000-0000-000000000003', 'Asia Pacific Warehouse', ST_GeomFromText('POINT(126.978 37.5665)'),  '200 Changgo-ro',   'Seoul',  'Seoul',  '04527', 'KR', TRUE);

-- --------------------------------------------------------------------------
-- 8.18 Inventory
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
-- 8.19 Inventory Log (manual seed; trigger will also produce rows)
-- --------------------------------------------------------------------------
INSERT INTO inventory_log (inventory_id, old_quantity, new_quantity, changed_at) VALUES
    ('40000000-0000-0000-0000-000000000001', 25, 20, '2025-02-01 10:00:00'),
    ('40000000-0000-0000-0000-000000000004', 30, 25, '2025-03-01 11:00:00'),
    ('40000000-0000-0000-0000-000000000009', 105, 100, '2025-04-01 12:00:00'),
    ('40000000-0000-0000-0000-000000000010', 50, 45, '2025-07-15 13:00:00');

-- --------------------------------------------------------------------------
-- 8.20 Posts (10 rows)
-- --------------------------------------------------------------------------
INSERT INTO posts (id, user_id, title, body, is_published, published_at, created_at) VALUES
    ('50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Getting Started with PostgreSQL',    'PostgreSQL is an advanced open-source relational database...', TRUE,  '2025-02-01 10:00:00', '2025-02-01 09:00:00'),
    ('50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Advanced Indexing Strategies',       'Choosing the right index type can dramatically improve...', TRUE,  '2025-03-01 10:00:00', '2025-03-01 09:00:00'),
    ('50000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'UI Design Principles',               'Good design is invisible. Here are my top principles...', TRUE,  '2025-03-15 12:00:00', '2025-03-15 11:00:00'),
    ('50000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'Product Management 101',             'The role of a PM is to discover the right product...', TRUE,  '2025-04-01 08:00:00', '2025-04-01 07:00:00'),
    ('50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'Data Science in Production',         'Moving from notebooks to production pipelines requires...', TRUE,  '2025-04-15 14:00:00', '2025-04-15 13:00:00'),
    ('50000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000007', 'React Performance Tips',             'Memoization, lazy loading, and virtual scrolling...', TRUE,  '2025-05-01 10:00:00', '2025-05-01 09:00:00'),
    ('50000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000008', 'Startup Engineering Culture',        'Building a strong engineering culture from day one...', TRUE,  '2025-05-15 16:00:00', '2025-05-15 15:00:00'),
    ('50000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000009', 'My First Month as a Developer',      'Reflections on joining a startup as a junior...', TRUE,  '2025-06-01 10:00:00', '2025-06-01 09:00:00'),
    ('50000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'Partitioning in PostgreSQL',         'When your tables grow large, partitioning helps...', FALSE, NULL,                  '2025-06-15 09:00:00'),
    ('50000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000006', 'Operations Playbook',                'Incident response, on-call rotations, and SLOs...', FALSE, NULL,                  '2025-07-01 09:00:00');

-- --------------------------------------------------------------------------
-- 8.21 Comments (15 rows, nested 2-3 levels)
-- --------------------------------------------------------------------------
INSERT INTO comments (id, post_id, user_id, parent_comment_id, body, created_at) VALUES
    -- Top-level comments
    ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', NULL,                                     'Great introduction! Very helpful for beginners.',            '2025-02-02 10:00:00'),
    ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', NULL,                                     'Could you cover materialized views next?',                   '2025-02-03 11:00:00'),
    ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', NULL,                                     'The GIN index section was especially useful.',               '2025-03-02 12:00:00'),
    ('60000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', NULL,                                     'Love the minimalist approach discussed here.',               '2025-03-16 14:00:00'),
    ('60000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000007', NULL,                                     'This matches my experience as a PM perfectly.',              '2025-04-02 09:00:00'),
    ('60000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000008', NULL,                                     'We had similar challenges deploying ML models.',             '2025-04-16 15:00:00'),
    ('60000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', NULL,                                     'React.memo saved us significant re-renders.',                '2025-05-02 11:00:00'),
    ('60000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', NULL,                                     'Culture is indeed the hardest part to get right.',           '2025-05-16 17:00:00'),
    -- Level 2 replies
    ('60000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Thanks! I have a follow-up post planned.',                   '2025-02-02 14:00:00'),
    ('60000000-0000-0000-0000-000000000010', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'Yes, see my new post on partitioning!',                       '2025-02-04 10:00:00'),
    ('60000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', 'GIN is perfect for JSONB. I will do a deep dive.',           '2025-03-03 08:00:00'),
    ('60000000-0000-0000-0000-000000000012', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000006', 'Feature stores helped us a lot with that.',                   '2025-04-17 10:00:00'),
    -- Level 3 replies
    ('60000000-0000-0000-0000-000000000013', '50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000009', 'Looking forward to it!',                                      '2025-02-02 16:00:00'),
    ('60000000-0000-0000-0000-000000000014', '50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000011', 'Would love a comparison with pg_trgm indexes too.',          '2025-03-03 12:00:00'),
    ('60000000-0000-0000-0000-000000000015', '50000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000012', 'Which feature store did you go with?',                        '2025-04-17 14:00:00');

-- --------------------------------------------------------------------------
-- 8.22 Notifications (spread across partitions)
-- --------------------------------------------------------------------------
INSERT INTO notifications (user_id, type, title, message, is_read, created_at) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'order',     'Order Confirmed',          'Your order #001 has been confirmed.',              TRUE,  '2025-01-25 10:10:00'),
    ('b0000000-0000-0000-0000-000000000001', 'payment',   'Payment Received',         'Payment of $1099.99 has been captured.',            TRUE,  '2025-01-25 10:15:00'),
    ('b0000000-0000-0000-0000-000000000002', 'order',     'Order Shipped',            'Your order #002 is on the way.',                   TRUE,  '2025-02-12 09:00:00'),
    ('b0000000-0000-0000-0000-000000000003', 'system',    'Welcome',                  'Welcome to the platform, Charlie!',                TRUE,  '2025-02-01 10:00:00'),
    ('b0000000-0000-0000-0000-000000000004', 'promotion', 'Spring Sale',              'Get 20% off on all electronics.',                  FALSE, '2025-03-20 08:00:00'),
    ('b0000000-0000-0000-0000-000000000006', 'alert',     'Low Stock Alert',          'Product ROG Strix G16 is running low.',            FALSE, '2025-04-01 07:00:00'),
    ('b0000000-0000-0000-0000-000000000007', 'order',     'Order Cancelled',          'Your order #008 has been cancelled.',               TRUE,  '2025-05-01 11:00:00'),
    ('b0000000-0000-0000-0000-000000000008', 'payment',   'Refund Processed',         'Your refund of $39.99 has been issued.',            TRUE,  '2025-06-05 10:00:00'),
    ('b0000000-0000-0000-0000-000000000001', 'system',    'Password Changed',         'Your password was changed successfully.',           TRUE,  '2025-08-01 09:00:00'),
    ('b0000000-0000-0000-0000-000000000009', 'promotion', 'Holiday Deals',            'Check out our holiday specials!',                   FALSE, '2025-12-15 08:00:00'),
    ('b0000000-0000-0000-0000-000000000002', 'order',     'Order Delivered',          'Your order #018 has been delivered.',               FALSE, '2026-02-20 14:00:00'),
    ('b0000000-0000-0000-0000-000000000004', 'alert',     'Account Activity',         'New login from a new device detected.',             FALSE, '2026-03-05 16:00:00');

-- --------------------------------------------------------------------------
-- 8.23 Settings (5 key-value pairs)
-- --------------------------------------------------------------------------
INSERT INTO settings (`key`, value, description) VALUES
    ('site_name',            'Rockury MVP',     'Public-facing site name'),
    ('max_upload_size_mb',   '50',              'Maximum file upload size in megabytes'),
    ('default_currency',     'USD',             'Default currency for pricing'),
    ('maintenance_mode',     'false',           'Enable/disable maintenance mode'),
    ('session_timeout_mins', '30',              'Session timeout in minutes');

-- --------------------------------------------------------------------------
-- 8.24 API Keys
-- --------------------------------------------------------------------------
INSERT INTO api_keys (user_id, key_value, name, is_active, expires_at) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'rky_live_ak_001_alice_2025', 'Alice Production Key',  TRUE,  '2026-01-10 00:00:00'),
    ('b0000000-0000-0000-0000-000000000001', 'rky_test_ak_002_alice_2025', 'Alice Test Key',        TRUE,  '2025-12-31 23:59:59'),
    ('b0000000-0000-0000-0000-000000000008', 'rky_live_ak_003_henry_2025', 'Henry Production Key',  TRUE,  '2026-06-30 00:00:00'),
    ('b0000000-0000-0000-0000-000000000005', 'rky_live_ak_004_eve_expired','Eve Expired Key',       FALSE, '2025-06-01 00:00:00');

-- --------------------------------------------------------------------------
-- 8.25 File Uploads
-- --------------------------------------------------------------------------
INSERT INTO file_uploads (user_id, filename, mime_type, size_bytes, storage_path) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'profile-photo.jpg',       'image/jpeg',           245000,  '/uploads/users/b001/profile-photo.jpg'),
    ('b0000000-0000-0000-0000-000000000002', 'design-mockup.png',       'image/png',            1520000, '/uploads/users/b002/design-mockup.png'),
    ('b0000000-0000-0000-0000-000000000003', 'quarterly-report.pdf',    'application/pdf',      890000,  '/uploads/users/b003/quarterly-report.pdf'),
    ('b0000000-0000-0000-0000-000000000008', 'architecture-diagram.svg','image/svg+xml',        125000,  '/uploads/users/b008/architecture-diagram.svg');

-- --------------------------------------------------------------------------
-- 8.26 Migrations (3 version records)
-- --------------------------------------------------------------------------
INSERT INTO migrations (version, name, applied_at) VALUES
    ('001', 'initial_schema',          '2025-01-01 00:00:00'),
    ('002', 'add_partitioning',        '2025-02-01 00:00:00'),
    ('003', 'add_security',            '2025-03-01 00:00:00');

-- --------------------------------------------------------------------------
-- 8.27 Scheduled Jobs (2 rows matching events)
-- --------------------------------------------------------------------------
INSERT INTO scheduled_jobs (job_name, schedule, definition, status, start_time) VALUES
    ('cleanup_notifications', 'EVERY 1 DAY',  'DELETE FROM notifications WHERE is_read = TRUE AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)', 'enabled', NOW()),
    ('refresh_stats',         'EVERY 1 HOUR', 'Insert audit_logs placeholder for stats refresh',                                                   'enabled', NOW());
