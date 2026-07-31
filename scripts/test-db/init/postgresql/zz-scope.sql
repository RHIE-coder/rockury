-- =============================================================================
-- PostgreSQL 범위(scope) 시연 데이터 — §db-remote.scope
-- Target: Docker PostgreSQL (port 15432, user=test, password=test)
--
-- 무엇을 눈으로 보게 하나:
--   ① 한 database 안 **여러 스키마** (public · auth · billing)
--   ② **교차 스키마 FK** — public → auth, auth → public 양방향. PostgreSQL 은 실제로 된다.
--   ③ **범위 밖 참조** — public·auth 만 켜면 billing 을 가리키는 FK 가 밖으로 남는다.
--   ④ **같은 이름 다른 스키마** — public.members 와 auth.members 를 일부러 둘 다 둔다.
--      이름으로만 참조를 잇던 코드가 여기서 조용히 틀린다(회귀 확인용 실물).
--   ⑤ **카탈로그 층** — database `analytics` 를 따로 만든다. 범위 손잡이의 database 칸에 뜨고,
--      고르면 그 database 에 붙는 **다른 연결**로 가야 한다는 것을 보이기 위한 것.
--
-- 파일 이름이 `zz-` 인 이유: docker-entrypoint-initdb.d 는 이름순으로 돌린다 —
-- 본 시드(init.sql) 뒤에 와야 그 테이블들을 참조할 수 있다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- auth 스키마 — 계정·세션
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
COMMENT ON SCHEMA auth IS '인증 — 계정과 세션';

CREATE TABLE auth.accounts (
    id          bigserial PRIMARY KEY,
    email       text        NOT NULL UNIQUE,
    display_name text       NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE auth.accounts IS '로그인 계정';

CREATE TABLE auth.sessions (
    id          bigserial PRIMARY KEY,
    account_id  bigint      NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
    user_agent  text        NOT NULL DEFAULT '',
    expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_account_idx ON auth.sessions (account_id);

-- 같은 이름을 두 스키마에 둔다(④) — auth.members
CREATE TABLE auth.members (
    id          bigserial PRIMARY KEY,
    account_id  bigint NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
    role        text   NOT NULL DEFAULT 'member'
);

-- -----------------------------------------------------------------------------
-- billing 스키마 — 범위 밖 참조를 만들기 위한 세 번째 스키마(③)
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS billing;
COMMENT ON SCHEMA billing IS '청구 — 범위 밖 참조 시연용';

CREATE TABLE billing.plans (
    id        bigserial PRIMARY KEY,
    code      text NOT NULL UNIQUE,
    price_cents integer NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- public 쪽 — 교차 스키마 FK 를 양방향으로 만든다(②)
-- -----------------------------------------------------------------------------
CREATE TABLE public.blog_posts (
    id         bigserial PRIMARY KEY,
    -- public → auth (다른 스키마를 가리키는 FK)
    author_id  bigint      NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
    -- public → billing (범위에서 billing 을 빼면 이 참조가 "범위 밖"이 된다)
    plan_id    bigint      REFERENCES billing.plans(id) ON DELETE SET NULL,
    title      text        NOT NULL,
    body       text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.blog_posts IS '글 — 작성자는 auth 스키마에 있다';

-- 같은 이름을 두 스키마에 둔다(④) — public.members
CREATE TABLE public.members (
    id       bigserial PRIMARY KEY,
    nickname text NOT NULL
);

-- auth → public (반대 방향 교차 스키마 FK)
CREATE TABLE auth.audit_events (
    id       bigserial PRIMARY KEY,
    post_id  bigint REFERENCES public.blog_posts(id) ON DELETE SET NULL,
    -- 같은 스키마 안 참조도 섞어 둔다(스키마가 비어 있을 때의 해석 확인용)
    actor_id bigint REFERENCES auth.accounts(id) ON DELETE CASCADE,
    action   text   NOT NULL,
    at       timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 데이터 — 화면에서 행이 보이도록
-- -----------------------------------------------------------------------------
INSERT INTO auth.accounts (email, display_name) VALUES
    ('alice@example.com', 'Alice'),
    ('bob@example.com',   'Bob'),
    ('carol@example.com', 'Carol');

INSERT INTO auth.sessions (account_id, user_agent, expires_at) VALUES
    (1, 'Mozilla/5.0 (Macintosh)', now() + interval '7 days'),
    (2, 'Mozilla/5.0 (Windows)',   now() + interval '1 day');

INSERT INTO auth.members (account_id, role) VALUES (1, 'owner'), (2, 'member');

INSERT INTO billing.plans (code, price_cents) VALUES
    ('free', 0), ('pro', 1900), ('team', 4900);

INSERT INTO public.members (nickname) VALUES ('앨리스'), ('밥');

INSERT INTO public.blog_posts (author_id, plan_id, title, body) VALUES
    (1, 2, '스키마를 나눠 쓰는 이유',   'public 과 auth 를 가르면 권한을 따로 준다.'),
    (2, 1, '교차 스키마 FK 는 된다',    'PostgreSQL 은 같은 database 안이면 자유롭다.'),
    (1, 3, '교차 database 는 안 된다',  'cross-database references are not implemented.');

INSERT INTO auth.audit_events (post_id, actor_id, action) VALUES
    (1, 1, 'post.create'),
    (2, 2, 'post.create'),
    (NULL, 3, 'account.login');

-- 읽기 계정에 권한 — 범위 손잡이가 세 스키마를 다 볼 수 있어야 한다.
GRANT USAGE ON SCHEMA auth, billing TO test;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth, billing TO test;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth, billing TO test;

-- -----------------------------------------------------------------------------
-- ⑤ 카탈로그(database) 층 — 별도 database.
-- PostgreSQL 은 **한 연결이 database 하나에 묶인다.** 그래서 여기 테이블은 testdb 연결로는
-- 절대 안 보이고(교차 database 질의가 아예 없다 — 실측 오류코드 0A000
-- "cross-database references are not implemented"), 범위 손잡이의 database 칸에서 고르면
-- 그 database 에 붙는 **다른 연결**로 가야 한다.
-- CREATE DATABASE 는 트랜잭션 안에서 못 돈다 — 이 파일이 BEGIN 을 안 쓰는 이유다.
-- -----------------------------------------------------------------------------
CREATE DATABASE analytics OWNER test;

\connect analytics

CREATE TABLE public.daily_rollup (
    id        bigserial PRIMARY KEY,
    day       date   NOT NULL UNIQUE,
    -- 일부러 FK 를 안 건다: testdb 의 blog_posts 를 가리키고 싶어도 **못 건다**.
    -- 교차 database 참조가 PostgreSQL 엔 없다 — 그 사실 자체가 이 표의 시연 내용이다.
    post_id   bigint NOT NULL,
    views     integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.daily_rollup IS 'post_id 는 testdb.public.blog_posts 를 가리키지만 FK 를 걸 수 없다(교차 database 불가)';

INSERT INTO public.daily_rollup (day, post_id, views) VALUES
    (CURRENT_DATE - 2, 1, 120),
    (CURRENT_DATE - 1, 2, 340),
    (CURRENT_DATE,     3,  87);

GRANT ALL ON ALL TABLES IN SCHEMA public TO test;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO test;
