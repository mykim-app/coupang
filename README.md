# 쿠팡 가격 알림 v2 — 설치 안내 (웹 화면만 사용)

## 사용 방식
- 이메일 + 숫자 4자리로 들어갑니다. 처음 쓰는 이메일이면 그때 입력한 숫자가 등록됩니다(5회 틀리면 10분 잠금).
- 쿠팡 상품번호(또는 상품 주소)와 검색어를 등록하면 조회 후 **등록 확인 메일**을 보냅니다.
- 이후 **가격이 바뀔 때마다** 그 상품을 등록한 모든 사람에게 메일을 보냅니다(오르면 ▲, 내리면 ▼, 역대 최저 표시).
- 상품마다 가격 변동 그래프(계단형)를 보여 줍니다.

## 구성
| 파일 | 넣는 곳 | 역할 |
|---|---|---|
| index.html | GitHub 저장소 → Pages | 화면 |
| index.ts | Supabase > Edge Functions > `coupang-price` | 로그인·등록·조회·메일 |
| setup.sql | Supabase > SQL Editor | 표 생성 + 매시 자동 조회 예약 |

## 1단계. Gmail 앱 비밀번호 만들기
1. 알림을 보낼 Gmail 계정 → Google 계정 관리 > **보안** > 2단계 인증 켜기
2. 보안 화면에서 **앱 비밀번호** 검색 → 이름(예: 쿠팡알림) 입력 → 16자리 비밀번호 복사
> 여러 사람에게 메일을 보내야 하므로 Gmail로 바꿨습니다. Resend는 도메인 인증 전에는 가입자 본인에게만 보낼 수 있습니다.

## 2단계. Supabase Secrets 등록
Edge Functions > **Secrets** 에서 추가합니다.

| 이름 | 값 | 시점 |
|---|---|---|
| CRON_SECRET | 자동 조회용 암호(직접 정함) | 지금 |
| PIN_PEPPER | 아무 긴 문자열(직접 정함, **한 번 정하면 바꾸지 말 것**) | 지금 |
| GMAIL_USER | 보내는 Gmail 주소 | 지금 |
| GMAIL_APP_PASSWORD | 1단계 16자리 앱 비밀번호 | 지금 |
| SITE_URL | GitHub Pages 주소(메일의 "그래프 보기" 링크) | 5단계 후 |
| COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY | 쿠팡 파트너스 키 | **API 발급 후** |

이전 시험판의 ADMIN_PASSWORD·RESEND_API_KEY·ALERT_EMAIL은 더 이상 쓰지 않으므로 지워도 됩니다.

## 3단계. 함수 교체
1. Edge Functions > `coupang-price`(없으면 **Deploy a new function > Via Editor**로 같은 이름 생성)
2. `index.ts` 전체 붙여 넣기 → **Deploy**
3. 함수 Settings에서 **Verify JWT 끄기** 유지

## 4단계. 표 만들기
SQL Editor > New query → `setup.sql` 붙여 넣기 → 맨 아래 `여기에_CRON_SECRET` 을 2단계 값으로 바꾸고 **Run**
(맨 위에서 이전 시험판 표를 지우고 새로 만듭니다)

## 5단계. 화면 올리기
GitHub 저장소에 `index.html` 업로드 → Settings > Pages → `main`/`(root)` → Save → 주소로 접속

## 자동 조회 방식과 한도
| 항목 | 기본값 | 바꾸려면(Secrets) |
|---|---|---|
| 자동 조회 주기 | 매시 5분 | setup.sql 예약 시간 |
| 1회 조회 상품 수 | 15개(오래된 순) | BATCH_PER_RUN |
| 같은 상품 재조회 간격 | 3시간 | STALE_HOURS |
| 쿠팡 호출 시간당 상한 | 20회 | HOURLY_LIMIT |
| 1인당 등록 상한 | 10개 | MAX_PER_USER |

- 쿠팡 파트너스 문서에는 검색 API 분당 50회라는 기준과 함께, **1시간 30회 이상 호출 시 24시간 정지·3회 정지 시 계정 정지** 경고가 있어 시간당 20회로 막았습니다.
- 이 기준이면 하루 최대 약 360회 조회, 상품이 45개 이하일 때 각 상품을 약 3시간마다 확인합니다. 그보다 많으면 확인 간격이 길어집니다.
- 여러 사람이 같은 상품을 등록하면 한 번만 조회합니다.

## 확인 필요
- Supabase 함수에서 Gmail(465 포트) 발송이 실제로 되는지는 배포 후 첫 등록 메일로 확인하십시오. 안 되면 오류 문구가 화면에 표시됩니다.
- 상품 주소의 번호와 쿠팡 API의 상품번호가 같은지는 API 키 발급 후 첫 등록에서 확인됩니다. "상위 10개 중에 없음"이 계속 뜨면 알려 주십시오.
