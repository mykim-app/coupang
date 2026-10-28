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

## 2단계. Supabase Secrets(비밀값) 등록
1. supabase.com 로그인 → 프로젝트(`vewmmndhipvazzmttzzr`) 선택
2. 왼쪽 메뉴 **Edge Functions** → 하위 메뉴 **Secrets**
3. **Name** / **Value** 칸에 아래 값을 하나씩 넣고 **Save**(또는 Add another 후 한꺼번에 Save)

| Name (그대로 입력) | Value | 시점 |
|---|---|---|
| CRON_SECRET | 자동 조회용 암호. 영문+숫자 20자 정도 임의로 (예: `cpAuto2026xQ7mP4rT9`) | 지금 |
| PIN_PEPPER | 숫자 4자리 암호화용 임의 문자열. **한 번 정하면 바꾸지 말 것**(바꾸면 기존 사용자 로그인 불가) | 지금 |
| GMAIL_USER | 1단계 Gmail 주소 | 지금 |
| GMAIL_APP_PASSWORD | 1단계 16자리(띄어쓰기 없이) | 지금 |
| SITE_URL | 5단계에서 생기는 GitHub Pages 주소 | 5단계 후 |
| COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY | 쿠팡 파트너스 키 | API 발급 후 |

CRON_SECRET 값은 4단계에서 한 번 더 쓰므로 메모장에 적어 두십시오. 이전 시험판의 ADMIN_PASSWORD·RESEND_API_KEY·ALERT_EMAIL은 지워도 됩니다.

## 3단계. 함수 만들기
1. 왼쪽 메뉴 **Edge Functions** → **Deploy a new function** → **Via Editor**
2. 함수 이름을 정확히 `coupang-price` 로 입력(이름이 다르면 화면이 함수를 찾지 못함)
3. 편집기의 예시 코드를 모두 지우고 `index.ts` 내용 전체를 붙여 넣기 → 아래 **Deploy function** → 성공 메시지 확인(10~30초)
4. 함수 목록에서 `coupang-price` 클릭 → 설정 화면에서 **JWT 검증**(Enforce JWT Verification / Verify JWT) 항목을 **끄기** → 저장
   - 이 화면은 비밀번호 대신 이메일+4자리로 보호하므로 끕니다. 끄지 않으면 화면에서 "응답 오류 (401)"이 납니다.
5. 나중에 코드를 고칠 때는 함수 클릭 → Code에서 붙여 넣기 → **Deploy updates**

## 4단계. 표 만들기와 자동 조회 예약
1. 왼쪽 메뉴 **SQL Editor** → **New query**(+)
2. `setup.sql` 내용 전체 붙여 넣기
3. 맨 아래의 `여기에_CRON_SECRET` 글자만 2단계 CRON_SECRET 값으로 바꾸기 (따옴표는 그대로)
4. 오른쪽 아래 **Run** → "Success" 확인. 파괴적 작업 경고 창이 뜨면 이전 시험판 표 삭제 때문이므로 **Run this query** 선택
5. 확인: 왼쪽 **Table Editor**에 `cp_users`, `cp_products`, `cp_prices`, `cp_subs` 등이 보이면 정상

## 5단계. 화면 올리기(GitHub Pages)
1. github.com 로그인 → 오른쪽 위 **+** → **New repository** → 이름 `coupang-alert`, **Public** 선택 → **Create repository**
2. 새 저장소 화면에서 **uploading an existing file** 링크(또는 Add file → Upload files) → `index.html`, `README.md` 끌어다 놓기 → **Commit changes**
   - `index.ts`, `setup.sql`은 Supabase에 이미 넣었으므로 올리지 않아도 됩니다(보관용으로 올려도 무방, 비밀값은 들어 있지 않음)
3. 저장소 **Settings** → 왼쪽 **Pages** → Branch를 `main`, 폴더 `/(root)` → **Save**
4. 1~2분 뒤 같은 화면 위쪽에 `https://(GitHub아이디).github.io/coupang-alert/` 주소가 나타남
5. 이 주소를 2단계 **SITE_URL** Secret에 추가(메일의 "가격 그래프 보기" 링크용)

## 6단계. 동작 확인
| 확인 | 방법 | 정상 결과 |
|---|---|---|
| 로그인 | Pages 주소 접속 → 이메일 + 숫자 4자리 → 들어가기 | "처음 오셨습니다" 안내 후 빈 목록 |
| 등록·메일 | 상품번호 + 검색어 입력 → 등록 | "등록했습니다" + 등록 확인 메일 수신 |
| 자동 조회 | SQL Editor에서 `select * from cron.job_run_details order by start_time desc limit 5;` 실행 | status가 succeeded |

API 키 발급 전에는 등록 시 "가격은 키 등록 후 자동 조회됩니다"가 정상입니다. 메일이 오지 않으면 화면의 "등록 메일 발송 실패: …" 문구를 알려 주십시오.

## 자동 조회 방식과 한도
| 항목 | 기본값 | 바꾸려면(Secrets) |
|---|---|---|
| 자동 조회 주기 | 매시 5분 | setup.sql 예약 시간 |
| 1회 조회 상품 수 | 15개(오래된 순) | BATCH_PER_RUN |
| 같은 상품 재조회 간격 | 3시간 | STALE_HOURS |
| 쿠팡 호출 시간당 상한 | 20회 | HOURLY_LIMIT |
| 1인당 등록 상한 | 10개 | MAX_PER_USER |

- 쿠팡 파트너스 공식 문서 기준 검색 API는 **분당 최대 50회**이며, 한도에 도달하면 **24시간 사용 제한**, 비정상적 과다 호출도 제한 대상입니다. 여유를 두어 시간당 20회로 막아 두었습니다(필요 시 HOURLY_LIMIT로 조정).
- 이 기준이면 하루 최대 약 360회 조회, 상품이 45개 이하일 때 각 상품을 약 3시간마다 확인합니다. 그보다 많으면 확인 간격이 길어집니다.
- 여러 사람이 같은 상품을 등록하면 한 번만 조회합니다.

## 확인 필요
- Supabase 함수에서 Gmail(465 포트) 발송이 실제로 되는지는 배포 후 첫 등록 메일로 확인하십시오. 안 되면 오류 문구가 화면에 표시됩니다.
- 공식 문서 예시에서 API의 productId와 상품 주소 번호가 서로 달라, 결과 링크 속 주소 번호(pageKey)로 먼저 맞추도록 했습니다. 키 발급 후 첫 등록에서 "상위 10개 중에 없음"이 계속 뜨면 알려 주십시오.
