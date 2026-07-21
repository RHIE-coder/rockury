import type { TableRecord } from './tables'

/**
 * 첫 실행 시드 — commerce-core (MySQL) 예제 테이블.
 * 렌더러의 목데이터를 대체하는 저장소의 초기 데이터. columns/constraints 는
 * 렌더러 도메인 타입(Column/Constraint)과 동일 구조의 순수 객체다.
 */
export const SEED_TABLES: TableRecord[] = [
  {
    id: 'orders',
    designId: 'commerce-core',
    name: 'orders',
    comment: '주문 원장',
    columns: [
      { id: 'o1', name: 'id', type: 'BIGINT UNSIGNED', nullable: false, defaultValue: 'AUTO_INCREMENT', comment: '주문 PK' },
      { id: 'o2', name: 'order_number', type: 'VARCHAR(32)', nullable: false, defaultValue: null, comment: '주문 번호(외부 노출용)' },
      { id: 'o3', name: 'user_id', type: 'BIGINT UNSIGNED', nullable: false, defaultValue: null, comment: '주문자 → users.id' },
      { id: 'o4', name: 'status', type: "ENUM('pending','confirmed','shipped','delivered','cancelled')", nullable: false, defaultValue: "'pending'", comment: '주문 상태' },
      { id: 'o5', name: 'total_amount', type: 'DECIMAL(12,2)', nullable: false, defaultValue: '0.00', comment: '합계 금액(>= 0)' },
      { id: 'o6', name: 'currency', type: 'CHAR(3)', nullable: false, defaultValue: "'KRW'", comment: '통화 코드 ISO-4217' },
      { id: 'o7', name: 'shipping_address', type: 'JSON', nullable: true, defaultValue: null, comment: '배송지 스냅샷' },
      { id: 'o8', name: 'memo', type: 'TEXT', nullable: true, defaultValue: null, comment: 'STG 핫픽스 흡수', drift: { version: 'v0.3.14' } },
      { id: 'o9', name: 'ordered_at', type: 'DATETIME', nullable: false, defaultValue: 'CURRENT_TIMESTAMP', comment: '주문 시각' },
      { id: 'o10', name: 'updated_at', type: 'DATETIME', nullable: true, defaultValue: 'CURRENT_TIMESTAMP', comment: '갱신 시각' }
    ],
    constraints: [
      { id: 'oc1', kind: 'pk', name: 'pk_orders', columns: [{ columnId: 'o1' }] },
      { id: 'oc2', kind: 'uk', name: 'uq_orders_number', columns: [{ columnId: 'o2' }] },
      { id: 'oc3', kind: 'fk', name: 'fk_orders_user', columns: [{ columnId: 'o3' }], refTable: 'users', refColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
      { id: 'oc4', kind: 'check', name: 'chk_orders_total', columns: [], expression: 'total_amount >= 0' },
      { id: 'oc5', kind: 'idx', name: 'idx_orders_user_created', columns: [{ columnId: 'o3' }, { columnId: 'o9', direction: 'DESC' }] }
    ]
  },
  {
    id: 'users',
    designId: 'commerce-core',
    name: 'users',
    comment: '회원',
    columns: [
      { id: 'u1', name: 'id', type: 'BIGINT UNSIGNED', nullable: false, defaultValue: 'AUTO_INCREMENT', comment: '회원 PK' },
      { id: 'u2', name: 'email', type: 'VARCHAR(255)', nullable: false, defaultValue: null, comment: '로그인 이메일' },
      { id: 'u3', name: 'display_name', type: 'VARCHAR(80)', nullable: false, defaultValue: null, comment: '표시 이름' },
      { id: 'u4', name: 'created_at', type: 'DATETIME', nullable: false, defaultValue: 'CURRENT_TIMESTAMP', comment: '가입 시각' }
    ],
    constraints: [
      { id: 'uc1', kind: 'pk', name: 'pk_users', columns: [{ columnId: 'u1' }] },
      { id: 'uc2', kind: 'uk', name: 'uq_users_email', columns: [{ columnId: 'u2' }] },
      { id: 'uc3', kind: 'idx', name: 'idx_users_created', columns: [{ columnId: 'u4' }] }
    ]
  },
  {
    id: 'products',
    designId: 'commerce-core',
    name: 'products',
    comment: '상품',
    columns: [
      { id: 'p1', name: 'id', type: 'BIGINT UNSIGNED', nullable: false, defaultValue: 'AUTO_INCREMENT', comment: '상품 PK' },
      { id: 'p2', name: 'sku', type: 'VARCHAR(48)', nullable: false, defaultValue: null, comment: 'SKU' },
      { id: 'p3', name: 'name', type: 'VARCHAR(200)', nullable: false, defaultValue: null, comment: '상품명' },
      { id: 'p4', name: 'price', type: 'DECIMAL(12,2)', nullable: false, defaultValue: '0.00', comment: '판매가' },
      { id: 'p5', name: 'category_id', type: 'BIGINT UNSIGNED', nullable: true, defaultValue: null, comment: '분류 → categories.id' }
    ],
    constraints: [
      { id: 'pc1', kind: 'pk', name: 'pk_products', columns: [{ columnId: 'p1' }] },
      { id: 'pc2', kind: 'uk', name: 'uq_products_sku', columns: [{ columnId: 'p2' }] },
      { id: 'pc3', kind: 'fk', name: 'fk_products_category', columns: [{ columnId: 'p5' }], refTable: 'categories', refColumns: ['id'], onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      { id: 'pc4', kind: 'idx', name: 'idx_products_category', columns: [{ columnId: 'p5' }] }
    ]
  },
  {
    id: 'categories',
    designId: 'commerce-core',
    name: 'categories',
    comment: '상품 분류',
    columns: [
      { id: 'c1', name: 'id', type: 'BIGINT UNSIGNED', nullable: false, defaultValue: 'AUTO_INCREMENT', comment: '분류 PK' },
      { id: 'c2', name: 'name', type: 'VARCHAR(100)', nullable: false, defaultValue: null, comment: '분류명' },
      { id: 'c3', name: 'parent_id', type: 'BIGINT UNSIGNED', nullable: true, defaultValue: null, comment: '상위 분류(self ref)' }
    ],
    constraints: [
      { id: 'cc1', kind: 'pk', name: 'pk_categories', columns: [{ columnId: 'c1' }] },
      { id: 'cc2', kind: 'uk', name: 'uq_categories_name', columns: [{ columnId: 'c2' }] },
      { id: 'cc3', kind: 'fk', name: 'fk_categories_parent', columns: [{ columnId: 'c3' }], refTable: 'categories', refColumns: ['id'], onDelete: 'SET NULL', onUpdate: 'CASCADE' }
    ]
  }
]

/**
 * 첫 실행 시드 버전 이력 — IA §3 서사와 일치.
 *  - v0.3.13: Stage 최초 반영 상태(memo 이전)
 *  - v0.3.14: 운영 핫픽스 드리프트(memo) 흡수 → 현재 작업 상태(SEED_TABLES)와 동일
 * memo 컬럼의 drift 배지(v0.3.14)가 실제 버전 레코드와 아귀가 맞도록 한다.
 */
export interface VersionSeed {
  number: string
  note: string
  snapshot: { tables: TableRecord[] }
  createdAt: string
}

/** v0.3.13 = 현재에서 orders.memo(드리프트 흡수 컬럼)를 뺀 상태. */
const TABLES_BEFORE_MEMO: TableRecord[] = SEED_TABLES.map((t) =>
  t.id === 'orders'
    ? { ...t, columns: t.columns.filter((c) => (c as { id: string }).id !== 'o8') }
    : t
)

export const SEED_VERSIONS: VersionSeed[] = [
  {
    number: 'v0.3.13',
    note: 'Stage 최초 반영',
    snapshot: { tables: TABLES_BEFORE_MEMO },
    createdAt: '2026-07-10T09:00:00.000Z'
  },
  {
    number: 'v0.3.14',
    note: 'STG 핫픽스 드리프트 흡수 (orders.memo)',
    snapshot: { tables: SEED_TABLES },
    createdAt: '2026-07-16T14:30:00.000Z'
  }
]
