import type { TableRecord } from './tables'

/**
 * 포켓몬 TCG 정보 스키마 → rockury 설계(Design) 데이터.
 *
 * 원본: oh-my-pokemon/docs/pokemon-schema-design.yaml (PostgreSQL 통합 설계뷰, 7 레이어).
 * 이 모듈은 그 YAML 을 rockury 도메인 모델(Design + TableRecord[])로 옮긴 정적 데이터다.
 * seed.ts 와 같은 관례: columns/constraints 는 렌더러 Column/Constraint 와 동일 구조의 순수 객체.
 *
 * 앱 상시 흐름에 자동 로드되지 않는다 — scripts/loadPokemonDesign.mjs 가 앱 로컬 DB 에
 * "추가 삽입"할 때만 쓰인다(기존 설계는 건드리지 않음). 방언은 postgresql 고정.
 *
 * 빌더(tbl/col)는 순수 함수라 pokemonDesign.test.ts 가 출력 정합성(FK 대상 존재·id 유일 등)을 검증한다.
 */

const DESIGN_ID = 'pokemon-tcg'

export const POKEMON_DESIGN = {
  id: DESIGN_ID,
  name: 'pokemon-tcg',
  description: '포켓몬 TCG 카드 정보 스키마 — 소스 원형→정규화→열람 (7 레이어)',
  dialect: 'postgresql'
} as const

// ── 도메인 타입(렌더러 Column/Constraint 와 구조 동일) ──────────────────────
type FkAction = 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'NO ACTION'
type ConstraintKind = 'pk' | 'uk' | 'fk' | 'check' | 'idx'

interface Col {
  id: string
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  comment: string
}
interface ColRef {
  columnId: string
  direction?: 'ASC' | 'DESC'
}
interface Constraint {
  id: string
  kind: ConstraintKind
  name: string
  columns: ColRef[]
  refTable?: string
  refColumns?: string[]
  onDelete?: FkAction
  onUpdate?: FkAction
  expression?: string
}

/** 컬럼 명세 — YAML 한 줄에 대응. 기본 NOT NULL(nullable 미지정 시 false), 단일 pk/uk/fk 슈가 포함. */
interface ColSpec {
  name: string
  type: string
  /** YAML `null: true` → true. 미지정이면 NOT NULL. */
  nullable?: boolean
  /** postgres 기본값 식 그대로(예: 'now()', 'false', "'{}'", "'full'"). 없으면 null. */
  default?: string
  comment: string
  /** 단일 컬럼 PK. */
  pk?: boolean
  /** 컬럼 단위 UNIQUE. */
  unique?: boolean
  /** 단일 컬럼 FK 슈가. */
  ref?: { table: string; column: string; onDelete: FkAction }
}

/** 추가 제약 — 복합 unique / index. 컬럼은 이름으로 참조(빌더가 id 로 해소). */
interface ExtraSpec {
  kind: 'uk' | 'idx'
  name: string
  /** 컬럼 이름들. 방향이 필요하면 [name, 'DESC']. */
  columns: Array<string | [string, 'ASC' | 'DESC']>
}

/** 테이블 하나를 TableRecord 로 조립한다. 컬럼 id = `<table>.<col>`(전역 유일), 테이블 id = `pkm_<table>`. */
function tbl(name: string, comment: string, cols: ColSpec[], extras: ExtraSpec[] = []): TableRecord {
  const cid = (c: string): string => `${name}.${c}`
  const columns: Col[] = cols.map((c) => ({
    id: cid(c.name),
    name: c.name,
    type: c.type,
    nullable: c.nullable ?? false,
    defaultValue: c.default ?? null,
    comment: c.comment
  }))

  const constraints: Constraint[] = []

  // 단일 컬럼 PK (YAML 은 모두 단일 id PK)
  const pkCols = cols.filter((c) => c.pk)
  if (pkCols.length > 0) {
    constraints.push({
      id: `${name}.pk`,
      kind: 'pk',
      name: `pk_${name}`,
      columns: pkCols.map((c) => ({ columnId: cid(c.name) }))
    })
  }

  // 컬럼 단위 UNIQUE
  cols
    .filter((c) => c.unique)
    .forEach((c) =>
      constraints.push({
        id: `${name}.uq_${c.name}`,
        kind: 'uk',
        name: `uq_${name}_${c.name}`,
        columns: [{ columnId: cid(c.name) }]
      })
    )

  // 컬럼 단위 FK
  cols
    .filter((c): c is ColSpec & { ref: NonNullable<ColSpec['ref']> } => c.ref != null)
    .forEach((c) =>
      constraints.push({
        id: `${name}.fk_${c.name}`,
        kind: 'fk',
        name: `fk_${name}_${c.name}`,
        columns: [{ columnId: cid(c.name) }],
        refTable: c.ref.table,
        refColumns: [c.ref.column],
        onDelete: c.ref.onDelete
      })
    )

  // 추가 제약(복합 uk / idx)
  extras.forEach((e, i) =>
    constraints.push({
      id: `${name}.${e.kind}_${i + 1}`,
      kind: e.kind,
      name: e.name,
      columns: e.columns.map((x) =>
        Array.isArray(x) ? { columnId: cid(x[0]), direction: x[1] } : { columnId: cid(x) }
      )
    })
  )

  return { id: `pkm_${name}`, designId: DESIGN_ID, name, comment, columns, constraints }
}

const TS = (comment: string): ColSpec => ({ name: 'created_at', type: 'timestamptz', default: 'now()', comment })
const UP = (comment = '수정 시각'): ColSpec => ({ name: 'updated_at', type: 'timestamptz', default: 'now()', comment })

// ════════════════════════════════════════════════════════════════════════════
export const POKEMON_TABLES: TableRecord[] = [
  // ═══ 레이어 1: RAW LANDING ═════════════════════════════════════════════════
  tbl(
    'source_sets',
    '소스별 세트/확장팩 목록 원형 (레이어1 RAW)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'source', type: 'text', comment: '수집 provider source_id (예: official:kr)' },
      { name: 'source_set_code', type: 'text', comment: '소스별 세트/상품 코드' },
      { name: 'payload', type: 'jsonb', default: "'{}'", comment: '세트 목록 원문(원형 보존)' },
      { name: 'fetched_at', type: 'timestamptz', default: 'now()', comment: '수집 시각' }
    ],
    [{ kind: 'uk', name: 'uq_source_sets', columns: ['source', 'source_set_code'] }]
  ),

  tbl(
    'source_cards',
    '소스별 카드 원형 = 재파싱의 원천 (레이어1 RAW)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'source', type: 'text', comment: '수집 provider source_id' },
      { name: 'source_card_id', type: 'text', comment: '소스 원 카드 ID' },
      { name: 'card_id', type: 'bigint', nullable: true, ref: { table: 'cards', column: 'id', onDelete: 'SET NULL' }, comment: '정규화 카드 링크(여러 소스가 공유=크로스소스)' },
      { name: 'source_set_code', type: 'text', nullable: true, comment: '소속 세트 코드(소스 기준)' },
      { name: 'source_url', type: 'text', nullable: true, comment: '소스 상세페이지 URL' },
      { name: 'list_payload', type: 'jsonb', default: "'{}'", comment: '목록 API/HTML 원문' },
      { name: 'detail_parsed', type: 'jsonb', nullable: true, comment: '상세에서 뽑은 정규화-직전 dict' },
      { name: 'image_s3key', type: 'text', nullable: true, comment: '이미지 오브젝트 키' },
      { name: 'image_url', type: 'text', nullable: true, comment: '원본 이미지 URL' },
      { name: 'list_fetched_at', type: 'timestamptz', nullable: true, comment: '목록 수집 시각' },
      { name: 'detail_fetched_at', type: 'timestamptz', nullable: true, comment: '상세 수집 시각' },
      { name: 'image_fetched_at', type: 'timestamptz', nullable: true, comment: '이미지 수집 시각' },
      TS('생성 시각'),
      UP()
    ],
    [
      { kind: 'uk', name: 'uq_source_cards', columns: ['source', 'source_card_id'] },
      { kind: 'idx', name: 'idx_source_cards_source', columns: ['source'] },
      { kind: 'idx', name: 'idx_source_cards_source_set', columns: ['source', 'source_set_code'] },
      { kind: 'idx', name: 'idx_source_cards_card', columns: ['card_id'] }
    ]
  ),

  // ═══ 레이어 2: NORMALIZED (열람 대상) ══════════════════════════════════════
  tbl(
    'card_sets',
    '세트 = 정체성 1행 + 텍스트 (레이어2)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'set_key', type: 'text', unique: true, comment: '{edition_region}:{set_code} (예: korea:sv3)' },
      { name: 'edition_region', type: 'text', comment: '발매판 (enum: korea|japan|usa)' },
      { name: 'set_code', type: 'text', comment: '소스 세트코드 정규화(소문자)' },
      { name: 'name', type: 'text', nullable: true, comment: '세트명(원어)' },
      { name: 'description', type: 'text', nullable: true, comment: '세트 설명' },
      { name: 'series', type: 'text', nullable: true, comment: '시리즈' },
      { name: 'total', type: 'integer', nullable: true, comment: '세트 총 카드 수' },
      { name: 'release_date', type: 'date', nullable: true, comment: '발매일' },
      { name: 'image_s3key', type: 'text', nullable: true, comment: '세트 심볼 오브젝트 키' },
      TS('생성 시각'),
      UP()
    ],
    [{ kind: 'idx', name: 'idx_card_sets_edition', columns: ['edition_region'] }]
  ),

  tbl(
    'cards',
    '카드 = 정체성 + 배틀 스탯 + 원어 텍스트 (레이어2)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'card_key', type: 'text', unique: true, comment: '{set_key}:{collector_number} (예: korea:sv3:013)' },
      { name: 'set_key', type: 'text', nullable: true, ref: { table: 'card_sets', column: 'set_key', onDelete: 'SET NULL' }, comment: '소속 세트(느슨 조인, 세트 미상 허용)' },
      { name: 'edition_region', type: 'text', comment: '발매판(정체성 축)' },
      { name: 'supertype', type: 'text', nullable: true, comment: '카드 종류 (pokemon|trainer|energy)' },
      { name: 'subtype', type: 'text', nullable: true, comment: '세부 분류(ex/V/GX 등)' },
      { name: 'name', type: 'text', nullable: true, comment: '표시명(원어, canonical/검색)' },
      { name: 'stage', type: 'text', nullable: true, comment: '진화 단계(원어 그대로)' },
      { name: 'clean_name', type: 'text', nullable: true, comment: '검색용 정규화 이름' },
      { name: 'hp', type: 'integer', nullable: true, comment: 'HP' },
      { name: 'types', type: 'text[]', nullable: true, comment: '포켓몬 타입(복수 가능, enum energy_type)' },
      { name: 'national_dex_no', type: 'integer', nullable: true, comment: '전국도감 번호(pokedex_species 조인 키)' },
      { name: 'abilities', type: 'jsonb', nullable: true, comment: '특성 목록 [{name,text}]' },
      { name: 'attacks', type: 'jsonb', nullable: true, comment: '기술 목록 [{name,cost[],damage,text}]' },
      { name: 'weakness_type', type: 'text', nullable: true, comment: '약점 타입' },
      { name: 'weakness_mod', type: 'text', nullable: true, comment: '약점 배율(예: ×2)' },
      { name: 'resistance_type', type: 'text', nullable: true, comment: '저항력 타입' },
      { name: 'resistance_mod', type: 'text', nullable: true, comment: '저항력 값(예: -30)' },
      { name: 'retreat_cost', type: 'integer', nullable: true, comment: '후퇴 비용(0~5)' },
      { name: 'rules_text', type: 'text', nullable: true, comment: '룰박스/트레이너/에너지 효과문' },
      { name: 'illustrator', type: 'text', nullable: true, comment: '일러스트레이터' },
      { name: 'collector_number', type: 'text', nullable: true, comment: '세트 내 번호(정렬/키용)' },
      { name: 'full_collection_number', type: 'text', nullable: true, comment: '인쇄된 번호 문자열 그대로(예: 013/108)' },
      { name: 'rarity', type: 'text', nullable: true, comment: '발매판별 레어도 코드(통일 안 함)' },
      { name: 'flavor_text', type: 'text', nullable: true, comment: '도감 이야기글(카드 하단 설명)' },
      { name: 'image_s3key', type: 'text', nullable: true, comment: '오브젝트 스토리지 키' },
      { name: 'match_fingerprint', type: 'text', nullable: true, comment: '언어 독립 구조 지문 해시(크로스 발매판 매칭 후보 키)' },
      { name: 'verified', type: 'boolean', default: 'false', comment: '관리자 검수 확정 여부' },
      TS('생성 시각'),
      UP()
    ],
    [
      { kind: 'idx', name: 'idx_cards_set', columns: ['set_key'] },
      { kind: 'idx', name: 'idx_cards_edition', columns: ['edition_region'] },
      { kind: 'idx', name: 'idx_cards_name', columns: ['name'] },
      { kind: 'idx', name: 'idx_cards_clean_name', columns: ['clean_name'] },
      { kind: 'idx', name: 'idx_cards_fingerprint', columns: ['match_fingerprint'] }
    ]
  ),

  // ═══ 레이어 3: 인쇄 변형(홀로그램) ═════════════════════════════════════════
  tbl(
    'card_variants',
    '카드별 홀로 변형 (외부 API 수집, 1:N) (레이어3)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'card_id', type: 'bigint', ref: { table: 'cards', column: 'id', onDelete: 'CASCADE' }, comment: '대상 카드' },
      { name: 'printing_variant', type: 'text', comment: '존재 가능한 인쇄 변형(예: master_ball)' },
      TS('생성 시각')
    ],
    [
      { kind: 'uk', name: 'uq_card_variants', columns: ['card_id', 'printing_variant'] },
      { kind: 'idx', name: 'idx_card_variants_card', columns: ['card_id'] }
    ]
  ),

  // ═══ 레이어 4: POKÉDEX (종 축) ═════════════════════════════════════════════
  tbl(
    'source_pokedex',
    '도감 원본 랜딩 (재정규화용) (레이어4 RAW)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'source', type: 'text', comment: '도감 소스(예: dex:kr)' },
      { name: 'source_dex_id', type: 'text', comment: '소스별 식별자' },
      { name: 'national_dex_no', type: 'integer', nullable: true, comment: '전국도감 번호' },
      { name: 'payload', type: 'jsonb', nullable: true, comment: '도감 원문(원형 보존)' },
      { name: 'source_url', type: 'text', nullable: true, comment: '소스 상세페이지 URL' },
      { name: 'image_url', type: 'text', nullable: true, comment: '종 대표 이미지 URL' },
      { name: 'fetched_at', type: 'timestamptz', default: 'now()', comment: '수집 시각' },
      UP()
    ],
    [
      { kind: 'uk', name: 'uq_source_pokedex', columns: ['source', 'source_dex_id'] },
      { kind: 'idx', name: 'idx_source_pokedex_dex', columns: ['national_dex_no'] }
    ]
  ),

  tbl(
    'pokedex_species',
    '종 언어불변 정체성 + 게임데이터 (레이어4)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'national_dex_no', type: 'integer', unique: true, comment: '전국도감 번호(종 유니크 키)' },
      { name: 'height_m', type: 'numeric', nullable: true, comment: '키(미터, canonical)' },
      { name: 'weight_kg', type: 'numeric', nullable: true, comment: '몸무게(kg, canonical)' },
      { name: 'types', type: 'text[]', nullable: true, comment: '게임 18타입(영어). 카드 energy_type 와 별개' },
      { name: 'gender_rate', type: 'smallint', nullable: true, comment: '성비(PokéAPI): -1 무성·0 수컷만·8 암컷만·1~7 암컷n/8' },
      { name: 'weaknesses', type: 'jsonb', nullable: true, comment: '게임 타입상성 약점(배율 포함)' },
      { name: 'evo_chain_id', type: 'integer', nullable: true, comment: '진화 체인 id' },
      { name: 'evo_stage', type: 'smallint', nullable: true, comment: '체인 내 단계(0=기본)' },
      { name: 'evolves_from', type: 'integer', nullable: true, comment: '진화 전 종 national_dex_no' },
      { name: 'stat_hp', type: 'smallint', nullable: true, comment: '종족값 HP' },
      { name: 'stat_attack', type: 'smallint', nullable: true, comment: '종족값 공격' },
      { name: 'stat_defense', type: 'smallint', nullable: true, comment: '종족값 방어' },
      { name: 'stat_sp_attack', type: 'smallint', nullable: true, comment: '종족값 특수공격' },
      { name: 'stat_sp_defense', type: 'smallint', nullable: true, comment: '종족값 특수방어' },
      { name: 'stat_speed', type: 'smallint', nullable: true, comment: '종족값 스피드' },
      { name: 'image_s3key', type: 'text', nullable: true, comment: '이미지 오브젝트 키' },
      TS('생성 시각'),
      UP()
    ],
    [{ kind: 'idx', name: 'idx_pokedex_species_evo', columns: ['evo_chain_id'] }]
  ),

  tbl(
    'pokedex_abilities',
    '종당 여러 특성 (레이어4)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'species_id', type: 'bigint', ref: { table: 'pokedex_species', column: 'id', onDelete: 'CASCADE' }, comment: '대상 종' },
      { name: 'slug', type: 'text', comment: 'PokéAPI ability name' },
      { name: 'slot', type: 'smallint', nullable: true, comment: '특성 슬롯 번호' },
      UP()
    ],
    [
      { kind: 'uk', name: 'uq_pokedex_abilities', columns: ['species_id', 'slug'] },
      { kind: 'idx', name: 'idx_pokedex_abilities_species', columns: ['species_id'] }
    ]
  ),

  tbl(
    'pokedex_ability_texts',
    '특성 언어별 행 (레이어4)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'ability_id', type: 'bigint', ref: { table: 'pokedex_abilities', column: 'id', onDelete: 'CASCADE' }, comment: '대상 특성' },
      { name: 'language', type: 'text', comment: '텍스트 언어 (ko|ja|en)' },
      { name: 'name', type: 'text', nullable: true, comment: '특성명' },
      { name: 'description', type: 'text', nullable: true, comment: '효과문' },
      UP()
    ],
    [
      { kind: 'uk', name: 'uq_pokedex_ability_texts', columns: ['ability_id', 'language'] },
      { kind: 'idx', name: 'idx_pokedex_ability_texts_ability', columns: ['ability_id'] }
    ]
  ),

  tbl(
    'pokedex_texts',
    '종 언어별 행 (이름/분류/도감설명) (레이어4)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'species_id', type: 'bigint', ref: { table: 'pokedex_species', column: 'id', onDelete: 'CASCADE' }, comment: '대상 종' },
      { name: 'language', type: 'text', comment: '텍스트 언어 (ko|ja|en)' },
      { name: 'name', type: 'text', nullable: true, comment: '언어별 종 이름' },
      { name: 'genus', type: 'text', nullable: true, comment: '분류(예: 화염포켓몬)' },
      { name: 'flavors', type: 'jsonb', nullable: true, comment: '도감설명(버전별)' },
      UP()
    ],
    [
      { kind: 'uk', name: 'uq_pokedex_texts', columns: ['species_id', 'language'] },
      { kind: 'idx', name: 'idx_pokedex_texts_species', columns: ['species_id'] }
    ]
  ),

  // ═══ 레이어 5: 크로스 발매판 매칭 ══════════════════════════════════════════
  tbl(
    'set_families',
    '크로스 발매판 세트 대응(릴리스 웨이브) (레이어5)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'slug', type: 'text', unique: true, comment: 'family 식별 슬러그(예: sv3-obsidian-flames)' },
      { name: 'name', type: 'text', nullable: true, comment: '표시명' },
      TS('생성 시각')
    ]
  ),

  tbl(
    'set_family_members',
    'family ↔ card_sets N:M (레이어5)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'family_id', type: 'bigint', ref: { table: 'set_families', column: 'id', onDelete: 'CASCADE' }, comment: '소속 family' },
      { name: 'set_key', type: 'text', ref: { table: 'card_sets', column: 'set_key', onDelete: 'CASCADE' }, comment: '구성 세트' },
      { name: 'coverage', type: 'text', default: "'full'", comment: 'full=1:1 | partial=합본의 일부' }
    ],
    [
      { kind: 'uk', name: 'uq_set_family_members', columns: ['family_id', 'set_key'] },
      { kind: 'idx', name: 'idx_set_family_members_set', columns: ['set_key'] }
    ]
  ),

  tbl(
    'card_matches',
    '매칭 파이프라인 출력(pairwise) (레이어5)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'card_id_a', type: 'bigint', ref: { table: 'cards', column: 'id', onDelete: 'CASCADE' }, comment: '쌍의 id 작은 쪽(a<b 정렬 저장)' },
      { name: 'card_id_b', type: 'bigint', ref: { table: 'cards', column: 'id', onDelete: 'CASCADE' }, comment: '쌍의 id 큰 쪽' },
      { name: 'match_method', type: 'text', comment: 'collector_number | fingerprint | manual' },
      { name: 'score', type: 'numeric', comment: '매칭 확신도 0~1' },
      { name: 'verified', type: 'boolean', default: 'false', comment: '관리자 검수 확정 여부' },
      TS('생성 시각'),
      UP()
    ],
    [
      { kind: 'uk', name: 'uq_card_matches', columns: ['card_id_a', 'card_id_b'] },
      { kind: 'idx', name: 'idx_card_matches_a', columns: ['card_id_a'] },
      { kind: 'idx', name: 'idx_card_matches_b', columns: ['card_id_b'] }
    ]
  ),

  // ═══ 레이어 6: 언어팩 (카드 번역 오버레이) ═════════════════════════════════
  tbl(
    'card_texts',
    '카드별·언어별 번역 행 (카드 원어와 다른 언어만) (레이어6)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'card_id', type: 'bigint', ref: { table: 'cards', column: 'id', onDelete: 'CASCADE' }, comment: '대상 카드' },
      { name: 'language', type: 'text', comment: '번역 언어(카드 원어 ≠ language 인 행만)' },
      { name: 'name', type: 'text', nullable: true, comment: '번역 카드명' },
      { name: 'rules_text', type: 'text', nullable: true, comment: '룰박스/효과문 번역' },
      { name: 'flavor_text', type: 'text', nullable: true, comment: '도감 이야기글 번역' },
      { name: 'abilities', type: 'jsonb', nullable: true, comment: '특성 번역(cards.abilities 와 동형)' },
      { name: 'attacks', type: 'jsonb', nullable: true, comment: '기술 번역(cards.attacks 와 동형)' },
      { name: 'origin', type: 'text', comment: 'counterpart | human | machine' },
      { name: 'counterpart_card_id', type: 'bigint', nullable: true, ref: { table: 'cards', column: 'id', onDelete: 'SET NULL' }, comment: 'origin=counterpart 일 때 출처 카드' },
      { name: 'verified', type: 'boolean', default: 'false', comment: '관리자 검수 확정 여부' },
      TS('생성 시각'),
      UP()
    ],
    [
      { kind: 'uk', name: 'uq_card_texts', columns: ['card_id', 'language'] },
      { kind: 'idx', name: 'idx_card_texts_card', columns: ['card_id'] }
    ]
  ),

  // ═══ 레이어 7: 시세 (플랫폼 × 등급 × 변형) ═════════════════════════════════
  tbl(
    'source_prices',
    '플랫폼별 상품 원형 (레이어7 RAW)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'source', type: 'text', comment: '가격 플랫폼(예: pricecharting)' },
      { name: 'source_product_id', type: 'text', comment: '플랫폼 상품 ID' },
      { name: 'card_id', type: 'bigint', nullable: true, ref: { table: 'cards', column: 'id', onDelete: 'SET NULL' }, comment: '매칭된 정규화 카드' },
      { name: 'printing_variant', type: 'text', nullable: true, comment: '플랫폼이 변형별 상품을 나눌 때' },
      { name: 'payload', type: 'jsonb', default: "'{}'", comment: '응답 원문(원형 보존, 최소단위 정수 그대로)' },
      { name: 'fetched_at', type: 'timestamptz', default: 'now()', comment: '수집 시각' }
    ],
    [
      { kind: 'uk', name: 'uq_source_prices', columns: ['source', 'source_product_id'] },
      { kind: 'idx', name: 'idx_source_prices_card', columns: ['card_id'] }
    ]
  ),

  tbl(
    'card_prices',
    '정규화 시세 스냅샷 (append-only) (레이어7)',
    [
      { name: 'id', type: 'bigserial', pk: true, comment: '기본키' },
      { name: 'card_id', type: 'bigint', ref: { table: 'cards', column: 'id', onDelete: 'CASCADE' }, comment: '대상 카드' },
      { name: 'printing_variant', type: 'text', nullable: true, comment: 'card_variants 와 같은 축. null=변형 구분 없음' },
      { name: 'source', type: 'text', comment: '가격 플랫폼' },
      { name: 'grading_company', type: 'text', nullable: true, comment: '등급 단체. null=단체 없는 일반 등급·무등급' },
      { name: 'grade', type: 'text', nullable: true, comment: '등급값(단체별 스케일 그대로). null=무등급' },
      { name: 'price', type: 'integer', comment: '통화 최소단위 정수(850000 펜니=$8,500.00)' },
      { name: 'currency', type: 'text', comment: 'ISO 4217' },
      { name: 'observed_at', type: 'timestamptz', comment: '시세 관측 시각' },
      TS('생성 시각')
    ],
    [
      { kind: 'uk', name: 'uq_card_prices', columns: ['card_id', 'printing_variant', 'source', 'grading_company', 'grade', 'observed_at'] },
      { kind: 'idx', name: 'idx_card_prices_card', columns: ['card_id', 'source', 'observed_at'] }
    ]
  )
]
