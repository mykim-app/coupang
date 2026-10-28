-- 이미 setup.sql을 실행한 경우: 이 한 줄만 SQL Editor에서 실행 (기존 데이터 유지)
alter table cp_products add column if not exists partner_url text;
