-- =========================================================
-- 쿠팡 가격 알림 v2 (이메일 + 4자리 숫자 방식)
-- Supabase > SQL Editor 에 통째로 붙여 넣고 [Run]
-- =========================================================

-- 0) 이전 시험판(관리자 비밀번호 방식) 표가 있으면 정리
drop table if exists cp_prices   cascade;
drop table if exists cp_products cascade;
drop table if exists cp_api_log  cascade;

-- 1) 사용자: 이메일 + 4자리 숫자(암호화 저장)
create table if not exists cp_users (
  email        text primary key,
  pin_hash     text not null,
  fail_count   integer not null default 0,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);

-- 2) 로그인 유지용 세션(30일)
create table if not exists cp_sessions (
  token      text primary key,
  email      text not null references cp_users(email) on delete cascade,
  expires_at timestamptz not null
);

-- 3) 상품(여러 사람이 같은 상품을 등록해도 한 번만 조회)
create table if not exists cp_products (
  product_id   text primary key,
  name         text not null,
  keyword      text not null,
  url          text,
  image        text,
  last_price   integer,
  min_price    integer,
  max_price    integer,
  last_checked timestamptz,
  last_status  text,
  created_at   timestamptz not null default now()
);

-- 4) 가격 기록(가격이 바뀔 때만 1줄 저장)
create table if not exists cp_prices (
  id          bigserial primary key,
  product_id  text not null references cp_products(product_id) on delete cascade,
  price       integer not null,
  checked_at  timestamptz not null default now()
);
create index if not exists cp_prices_pid_time on cp_prices(product_id, checked_at);

-- 5) 사람별 등록 상품
create table if not exists cp_subs (
  email      text not null references cp_users(email) on delete cascade,
  product_id text not null references cp_products(product_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (email, product_id)
);

-- 6) 쿠팡 API 호출 기록(시간당 상한 관리)
create table if not exists cp_api_log (
  id        bigserial primary key,
  called_at timestamptz not null default now()
);

-- 7) 외부 직접 접근 차단(함수만 접근)
alter table cp_users    enable row level security;
alter table cp_sessions enable row level security;
alter table cp_products enable row level security;
alter table cp_prices   enable row level security;
alter table cp_subs     enable row level security;
alter table cp_api_log  enable row level security;

-- 8) 자동 조회: 매시 5분마다 실행(오래된 상품부터 정해진 개수만 조회)
--    '여기에_CRON_SECRET' 을 Secrets의 CRON_SECRET 값으로 바꾼 뒤 실행
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('coupang-price-check')
where exists (select 1 from cron.job where jobname = 'coupang-price-check');

select cron.schedule(
  'coupang-price-check',
  '5 * * * *',
  $$
  select net.http_post(
    url     := 'https://vewmmndhipvazzmttzzr.supabase.co/functions/v1/coupang-price',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"action":"cron","token":"여기에_CRON_SECRET"}'::jsonb
  );
  $$
);
