-- =========================================================
-- 쿠팡 가격 알림 - Supabase SQL Editor에 통째로 붙여 넣고 [Run]
-- =========================================================

-- 1) 추적 상품
create table if not exists cp_products (
  product_id   text primary key,          -- 쿠팡 상품번호
  name         text not null,
  keyword      text not null,             -- 자동 조회 때 쓸 검색어
  url          text,
  image        text,
  target_price integer,                   -- 목표가(선택)
  email        text,                      -- 알림 받을 메일(비우면 기본 메일)
  active       boolean not null default true,
  last_price   integer,
  min_price    integer,
  last_checked timestamptz,
  last_status  text,
  created_at   timestamptz not null default now()
);

-- 2) 가격 기록
create table if not exists cp_prices (
  id          bigserial primary key,
  product_id  text not null references cp_products(product_id) on delete cascade,
  price       integer not null,
  source      text not null default 'api',   -- api / manual
  checked_at  timestamptz not null default now()
);
create index if not exists cp_prices_pid_time on cp_prices(product_id, checked_at);

-- 3) 쿠팡 API 호출 기록(호출 제한 초과 방지용)
create table if not exists cp_api_log (
  id        bigserial primary key,
  called_at timestamptz not null default now()
);

-- 4) 외부에서 직접 못 읽게 잠금(함수만 접근)
alter table cp_products enable row level security;
alter table cp_prices   enable row level security;
alter table cp_api_log  enable row level security;

-- 5) 자동 조회 예약: 매일 09시·15시·21시(한국시간)
--    아래 '여기에_CRON_SECRET' 을 Secrets에 넣은 CRON_SECRET 값과 똑같이 바꾼 뒤 실행
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('coupang-price-check')
where exists (select 1 from cron.job where jobname = 'coupang-price-check');

select cron.schedule(
  'coupang-price-check',
  '0 0,6,12 * * *',   -- UTC 기준(= 한국 09·15·21시)
  $$
  select net.http_post(
    url     := 'https://vewmmndhipvazzmttzzr.supabase.co/functions/v1/coupang-price',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"action":"check","token":"여기에_CRON_SECRET"}'::jsonb
  );
  $$
);
