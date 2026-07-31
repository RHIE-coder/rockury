-- =============================================================================
-- MariaDB 범위(scope) 시연 데이터 — §db-remote.scope
-- Target: Docker MariaDB 11 (port 13307, user=test, password=test)
--
-- MariaDB 도 MySQL 과 같다 — database 와 schema 가 **같은 말**이다. 그리고 PostgreSQL 과 결정적으로 다른 점:
-- **연결 하나로 여러 database 를 넘나든다** — `db1.t JOIN db2.t` 가 되고 InnoDB 는
-- 교차 database FK 도 실제로 건다(실측 확인). 그래서 PostgreSQL 의 schema 와 같은 자리다.
--
-- 무엇을 눈으로 보게 하나:
--   ① **한 서버 · 여러 database** — service1 · service2 · service3
--   ② **교차 database FK** — service2 → service1, service3 → service1
--   ③ **같은 이름 다른 database** — service1.members 와 service2.members 를 둘 다 둔다
--   ④ **범위 밖 참조** — service1·service2 만 켜면 service3 을 가리키는 FK 가 밖으로 남는다
--
-- 파일 이름이 `zz-` 인 이유: docker-entrypoint-initdb.d 는 이름순으로 돌린다(본 시드 뒤).
-- =============================================================================

CREATE DATABASE IF NOT EXISTS service1 CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS service2 CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS service3 CHARACTER SET utf8mb4;

-- -----------------------------------------------------------------------------
-- service1 — 다른 서비스들이 참조하는 쪽
-- -----------------------------------------------------------------------------
CREATE TABLE service1.customers (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='고객 — service2·service3 이 가리킨다';

-- ③ 같은 이름을 두 database 에
CREATE TABLE service1.members (
    id       BIGINT AUTO_INCREMENT PRIMARY KEY,
    nickname VARCHAR(60) NOT NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- service2 — 주문. ② 교차 database FK (service2 → service1)
-- -----------------------------------------------------------------------------
CREATE TABLE service2.orders (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    customer_id BIGINT       NOT NULL,
    amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
    placed_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
        REFERENCES service1.customers(id) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB COMMENT='주문 — 고객은 service1 database 에 있다';

CREATE TABLE service2.members (
    id     BIGINT AUTO_INCREMENT PRIMARY KEY,
    handle VARCHAR(60) NOT NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- service3 — 배송. ④ 범위에서 빼면 service2 의 FK 가 "범위 밖"이 된다
-- -----------------------------------------------------------------------------
CREATE TABLE service3.carriers (
    id   BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE service3.shipments (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id   BIGINT NOT NULL,
    carrier_id BIGINT NOT NULL,
    shipped_at DATETIME NULL,
    CONSTRAINT fk_ship_order   FOREIGN KEY (order_id)   REFERENCES service2.orders(id)    ON DELETE CASCADE,
    CONSTRAINT fk_ship_carrier FOREIGN KEY (carrier_id) REFERENCES service3.carriers(id)  ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='배송 — 주문은 service2, 택배사는 같은 database';

-- service2 → service3 (범위에서 service3 을 빼면 밖으로 남는 참조)
ALTER TABLE service2.orders
    ADD COLUMN preferred_carrier_id BIGINT NULL,
    ADD CONSTRAINT fk_orders_carrier FOREIGN KEY (preferred_carrier_id)
        REFERENCES service3.carriers(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 데이터
-- -----------------------------------------------------------------------------
INSERT INTO service1.customers (email, name) VALUES
    ('alice@example.com', 'Alice'), ('bob@example.com', 'Bob'), ('carol@example.com', 'Carol');
INSERT INTO service1.members (nickname) VALUES ('앨리스'), ('밥');
INSERT INTO service2.members (handle) VALUES ('@alice'), ('@bob');
INSERT INTO service3.carriers (code, name) VALUES ('CJ', 'CJ대한통운'), ('HJ', '한진택배');
INSERT INTO service2.orders (customer_id, amount, preferred_carrier_id) VALUES
    (1, 19900.00, 1), (2, 4900.00, 2), (1, 129000.00, NULL);
INSERT INTO service3.shipments (order_id, carrier_id, shipped_at) VALUES
    (1, 1, NOW()), (2, 2, NULL);

-- 읽기 계정 권한 — 범위 손잡이가 세 database 를 다 볼 수 있어야 한다.
GRANT ALL PRIVILEGES ON service1.* TO 'test'@'%';
GRANT ALL PRIVILEGES ON service2.* TO 'test'@'%';
GRANT ALL PRIVILEGES ON service3.* TO 'test'@'%';
FLUSH PRIVILEGES;
