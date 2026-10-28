# 쿠팡 가격 알림 — 설치 안내 (웹 화면만 사용)

## 구성
| 파일 | 넣는 곳 | 역할 |
|---|---|---|
| index.html | GitHub 저장소(예: `coupang-alert`) → Pages | 화면 |
| index.ts | Supabase > Edge Functions > 함수 이름 `coupang-price` | 쿠팡 조회·저장·메일 발송 |
| setup.sql | Supabase > SQL Editor | 표 생성 + 하루 3회(09·15·21시) 자동 조회 예약 |

## 1단계. 메일 준비 (Resend, 무료)
1. resend.com 가입 → **API Keys > Create API Key** → 키 복사
2. 별도 도메인 없이 쓰면 **가입한 본인 메일 주소로만** 받을 수 있습니다 (개인 알림 용도로는 충분합니다).

## 2단계. Supabase Secrets 등록
Supabase > **Edge Functions > Secrets** (또는 Project Settings > Edge Functions) 에서 아래 값을 추가합니다.

| 이름 | 값 | 지금 넣을지 |
|---|---|---|
| ADMIN_PASSWORD | 화면 로그인 비밀번호(직접 정함) | 지금 |
| CRON_SECRET | 자동 조회용 암호(직접 정함, 비밀번호와 다르게) | 지금 |
| RESEND_API_KEY | 1단계에서 복사한 키 | 지금 |
| ALERT_EMAIL | Resend 가입 메일 주소 | 지금 |
| COUPANG_ACCESS_KEY | 쿠팡 파트너스 Access Key | **API 발급 후** |
| COUPANG_SECRET_KEY | 쿠팡 파트너스 Secret Key | **API 발급 후** |

## 3단계. 함수 만들기
1. **Edge Functions > Deploy a new function > Via Editor**
2. 함수 이름 `coupang-price` 입력 → `index.ts` 내용 전체 붙여 넣기 → **Deploy**
3. 함수 **Settings**에서 **Verify JWT(JWT 검증)** 를 **끄기** → 저장
   (화면은 관리자 비밀번호로 보호하므로 키를 화면에 넣지 않는 방식입니다)

## 4단계. 표·자동 조회 만들기
1. **SQL Editor > New query** → `setup.sql` 전체 붙여 넣기
2. 맨 아래 `여기에_CRON_SECRET` 을 2단계 CRON_SECRET 값으로 바꾼 뒤 **Run**

## 5단계. 화면 올리기
1. GitHub에서 새 저장소 → **Add file > Upload files** 로 `index.html` 업로드
2. **Settings > Pages** → Branch `main` / `(root)` 선택 → Save
3. 표시된 주소로 접속 → ADMIN_PASSWORD로 로그인 → **테스트 메일** 버튼으로 메일 수신 확인

## API 키 발급 전·후 동작
| 구분 | 발급 전 | 발급 후(Secrets 2개만 추가) |
|---|---|---|
| 상품 등록 | [직접 등록] 탭: 쿠팡 상품 주소 + 상품명 | [쿠팡에서 검색] 탭에서 골라 등록 |
| 가격 기록 | [가격 직접 입력] 버튼(테스트용) | 하루 3회 자동 기록 |
| 메일 알림 | 직접 입력한 가격으로도 동작 | 자동 기록 시 동작 |

## 알림 기준
- **역대 최저가 갱신**: 새 가격이 지금까지 최저가보다 낮을 때 (첫 기록은 알림 없음)
- **목표가 도달**: 목표가를 정한 경우, 목표가 위에 있다가 이하로 내려온 순간 1회

## 주의 사항
- 쿠팡 파트너스 API 호출 제한은 자료마다 다릅니다(시간당 30회 초과 시 24시간 정지라는 자료, 분당 50~100회라는 자료). **확인 필요** — 안전하게 함수에서 시간당 20회로 막아 두었고, 상품 1개당 1회 호출하므로 **추적 상품은 15개 이내**를 권장합니다.
- 자동 조회는 등록 때의 검색어로 상위 10개를 받아 **같은 상품번호**를 찾습니다. 상품 카드에 "검색 결과에 없음"이 뜨면 [설정]에서 검색어를 더 구체적으로 바꾸십시오.
- [직접 등록]의 주소 속 상품번호가 API의 상품번호와 같은지는 **확인 필요** 합니다. 키 발급 후 자동 조회에서 계속 "없음"이 뜨면 [쿠팡에서 검색] 탭으로 다시 등록하십시오.
