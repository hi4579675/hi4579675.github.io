---
title: "외부 관광 API를 서비스 데이터로 바꾸는 파이프라인 설계 — 놀러온나"
date: 2026-05-07
tags:
  - 시스템 설계
  - LLM
  - PostgreSQL
  - Python
  - 데이터 파이프라인
excerpt: 한국관광공사 TourAPI를 부산 여행 서비스 '놀러온나'에 붙이며 만든 데이터 파이프라인 설계 기록. 수집/서비스 분리, 30+ 테이블, 7가지 설계 패턴, 4단계 비용 통제까지 — ETL이 아닌 '신뢰 가능한 상태 머신'을 만든 과정.
category: nolleo-onna
---

> **TL;DR**
> - 한국관광공사 TourAPI를 부산 여행 서비스 **놀러온나**에 붙이며 만든 데이터 파이프라인 설계 기록
> - 핵심 결정: 수집/서비스 분리 · 30+ 테이블 · 7가지 설계 패턴 · 4단계 비용 통제 · 2트랙 테스트
> - 본질은 ETL이 아니라 **신뢰 가능한 상태 머신**

---

## 0. 환경

| 항목 | 값 |
|---|---|
| 수집 대상 | TourAPI(관광지/문화/음식/행사/코스), 착한가격업소, 카카오 지오코딩, 기상청 |
| 규모 | 부산 ~7,000 스팟 + ~600 가성비 매장 |
| 제약 | TourAPI 일일 quota **1,000콜** |
| DB | PostgreSQL 16 + PostGIS + pgvector + pg_trgm |
| 언어 | Python 3.11 (asyncio + httpx + psycopg 3.x + Pydantic) + Alembic |
| 테이블 | 30+ 정규화 테이블, 12개 도메인 |
| 코드 | [github.com/nolleo-onna/nolleo-onna-pipeline](https://github.com/nolleo-onna/nolleo-onna-pipeline) |
| 문서 | docs/erd.md, docs/operation.md, docs/adr/ |

---

## 1. 왜 파이프라인을 분리했나

> **결정**: 수집/서비스 분리. 서비스가 외부 API 상태를 모르게.

외부 API를 요청 시점에 직접 붙이면 다음이 사용자에게 그대로 전이된다.

| 외부 API 문제 | 사용자 영향 |
|---|---|
| latency 변동 큼 (직접 운영 중 체감) | 사용자 응답시간 직결 |
| 일일 quota 1,000콜 | 트래픽 급증 시 즉시 고갈 → 서비스 다운 |
| 응답 포맷 변경 | 실시간 장애 |
| 비즈니스 규칙(영업중/혼잡) | 매 요청 재계산 |

```
┌─ 외부 API ──────────────────────────────┐
│  TourAPI · 착한가격 · 카카오 · 기상청    │
└──────────────┬──────────────────────────┘
               │ (배치 / cron)
               ▼
┌─ Python 파이프라인 ─────────────────────┐
│  수집 → 정제 → LLM 가공 → 적재          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─ PostgreSQL (마스터 SoT) ───────────────┐
│  PostGIS + pgvector + pg_trgm            │
└──────────────┬──────────────────────────┘
               │ (읽기 전용)
               ▼
┌─ Spring Boot 백엔드 ────────────────────┐
│  인증 / 추천 / 검색 / 사용자 데이터 CRUD │
└─────────────────────────────────────────┘
```

→ TourAPI가 5분 다운돼도 사용자엔 영향 X.

---

## 2. 데이터 모델 — 30+ 테이블, 7가지 설계 패턴

> **결정**: 도메인 12개로 묶고, 모든 도메인이 공유하는 패턴 7개를 명문화.

### 도메인 12개

| 도메인 | 책임 |
|---|---|
| 사용자 / 북마크/리뷰 / 코스 / 한끗 | 사용자 활동 + 콘텐츠 |
| **스팟·행사·공식코스 (마스터)** | TourAPI 정제 결과 |
| 착한가격 + 매칭 큐 + 가격 이력 | 부산 가성비 매장 |
| 검수 큐 (LLM 신뢰도) | LLM 할루시네이션 방어 |
| 태그 / 코드·날씨 마스터 | 통제어휘, 지역, 날씨 |
| **운영 (SYNC_LOGS)** | 파이프라인 추적 |

### 스팟 도메인 7테이블 (예시)

```
┌─ SPOTS_CORE ──────────┐  ←──→ ┌─ SPOT_DETAILS ────┐
│ Hot, 슬림 컬럼        │  1:1  │ Cold, 무거운 텍스트│
│ map_x/y → geog        │       │ overview_hash      │
│ popularity, trend     │       │ business_hours JSONB│
└──┬────────────────────┘       └────────────────────┘
   ├──1:1── SPOT_EMBEDDINGS         (vector(1536), HNSW)
   ├──1:1── SPOTS_RAW_SNAPSHOTS     (외부 API 원본 JSONB)
   ├──1:N── SPOT_IMAGES             (갤러리)
   ├──N:M── SPOT_TAGS               (분위기 태그)
   └──1:N── SPOT_CONGESTION_FORECAST(30일 혼잡도 예측)
```

### 7가지 설계 패턴

#### ① Hot/Cold 1:1 분리

`SPOTS_CORE`(슬림) ↔ `SPOT_DETAILS`(무거운 텍스트).
지도 뷰포트 쿼리가 `overview` 같은 긴 텍스트를 안 읽도록.

→ 핫패스에서 무거운 텍스트 컬럼 미참조.

#### ② RAW → 정제 → 임베딩 3층

```
SPOTS_RAW_SNAPSHOTS    (외부 API 원본 보관)
        ↓
SPOTS_CORE / DETAILS   (정제 정규화)
        ↓
SPOT_EMBEDDINGS        (vector(1536), HNSW)
```

파싱 버그 발견 시 RAW로 **재파싱 → 재적재** 가능. 외부 API 재호출 불필요.

#### ③ 변경 감지 해시 — LLM 비용 90%+ 절감

```python
def compute_overview_hash(overview: str | None) -> str | None:
    if not overview or not overview.strip():
        return None
    return hashlib.sha256(overview.strip().encode("utf-8")).hexdigest()
```

| 시나리오 | 월 LLM 비용 |
|---|---|
| 매번 7,000건 재처리 | ~$135 |
| 변경분만 처리 | **~$15** |

#### ④ 신뢰도 큐 패턴 (LLM 할루시네이션 방어)

LLM이 만드는 영업시간 정규화 결과는 그대로 못 믿는다. 다층 임계값:

```
LLM 영업시간 정규화 결과
├── confidence ≥ 0.85 + 룰 검증 통과   → 자동 적용 (큐 미진입)
├── 0.7 ~ 0.85                         → 큐잉 + 24h SLA
└── < 0.7 또는 룰 검증 실패              → 큐잉 + UI "확인 필요"
```

모든 LLM 산출물에 `model_name / model_version / prompt_version / source_text_hash` 추적.
모델 갱신 후 정답 셋 100건 회귀 → 일치율 ≥95%일 때만 배포.

#### ⑤ PostGIS Generated Column

map_x/map_y만 채우면 geog는 자동 계산. 앱이 잊을 수 없게 DB가 강제.

```sql
geog geography(POINT, 4326) GENERATED ALWAYS AS (
  CASE WHEN map_x IS NOT NULL AND map_y IS NOT NULL
       THEN ST_SetSRID(ST_MakePoint(map_x, map_y), 4326)::geography
       ELSE NULL END
) STORED,

CONSTRAINT chk_map_x_range CHECK (map_x BETWEEN -180 AND 180),
CONSTRAINT chk_map_y_range CHECK (map_y BETWEEN -90 AND 90)
```

#### ⑥ Soft Delete vs Hard Delete vs is_active

| 패턴 | 사용 | 이유 |
|---|---|---|
| `deleted_at` | USERS, GENERATED_COURSES, USER_REVIEWS | 30일 유예 |
| Hard Delete | BOOKMARKS, NOTIFICATIONS | 이력 가치 낮음 |
| **`is_active` 플래그** | **SPOTS_CORE 등 마스터** | 외부 API 사라져도 보관 (북마크 보호) |

#### ⑦ 시간대 정책 — TIMESTAMPTZ 강제

- DB 서버 UTC, 모든 시각 컬럼 **TIMESTAMPTZ** (timestamp without tz **금지**)
- `business_hours` JSONB 시간 문자열은 KST 기준 (`"09:00"`)
- 비교 시 `AT TIME ZONE 'Asia/Seoul'` 명시

마이그레이션 적용 후 검증 SQL — 0 row여야 통과:

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'timestamp without time zone';
```

---

## 3. 쓰기 전략 — 테이블별 불변 계약

> **결정**: UPSERT / REPLACE / APPEND 3종으로 분류, 코드 레벨에서 못 박음.

운영 사고의 가장 큰 원인이 **"테이블마다 쓰기 의미가 뒤섞일 때"**다. 그래서 일찍 분류했다.

### UPSERT (동일 ID면 갱신)

```
SPOTS_CORE / SPOT_DETAILS / SPOT_EMBEDDINGS / SPOTS_RAW_SNAPSHOTS
GOOD_PRICE_SHOPS / TAGS / USERS
```

```sql
INSERT INTO spots_core (content_id, title, ...) VALUES (...)
ON CONFLICT (content_id) DO UPDATE SET
    title          = EXCLUDED.title,
    synced_at      = EXCLUDED.synced_at,
    is_active      = TRUE,        -- 재등장 시 재활성화
    inactive_since = NULL
```

캐시 컬럼(`overview_summary`, `popularity_score` 등)은 안 건드림. 다른 잡 소유.

### REPLACE (DELETE + INSERT, 부모 단위 통째 교체)

```
SPOT_IMAGES                       (갤러리 통째 교체)
SPOT_TAGS WHERE source='llm'      (LLM 재추출만, manual 보존)
HANKKUT_SPOTS / TAGS / EVENTS     (N:M join)
```

⚠️ **반드시 단일 트랜잭션**. 분리 트랜잭션이면 그 사이 Spring이 SELECT해서 "이미지 없음" 깜빡임 보임:

```python
# ✅ 단일 트랜잭션 — 외부에 깜빡임 노출 X
async with conn.transaction():
    await conn.execute("DELETE FROM spot_images WHERE content_id = %s", (cid,))
    await conn.cursor().executemany(
        "INSERT INTO spot_images (content_id, origin_img_url, ...) "
        "VALUES (%s, %s, ...)",
        rows,
    )
```

`SPOT_TAGS`의 `source='llm'`만 교체는 PK에 `source` 포함시켜 자연 해결:

```sql
PRIMARY KEY (content_id, tag_id, source)
-- DELETE WHERE source='llm' 만 돌리면 manual 행은 그대로 남음
```

### APPEND ONLY (이력/시계열, INSERT만)

```
USER_REVIEWS · NOTIFICATIONS · GENERATED_COURSES · COURSE_DECISIONS
BUSINESS_HOURS_REVIEW_QUEUE · GOOD_PRICE_MATCH_QUEUE · GOOD_PRICE_PRICE_OBSERVATIONS
SYNC_LOGS · BOOKMARKS
```

→ "어떤 테이블은 최신, 어떤 테이블은 이력"이 코드에서 항상 명확.

---

## 4. 비용 통제 설계 — 1,000콜로 7,000 스팟 적재

> **결정**: 4단계 방어로 quota 부족 환경에서도 매일 진척.

부산 7,000 × 4 endpoint = 28,000콜. 단순 계산 28일 부트스트랩.

### Layer 1. 변경분만 detail fetch

list 응답의 `modifiedtime`을 DB의 `source_modified_time`과 비교.
같으면 detail 4건 호출 자체를 skip.

```python
list_modified = parse_tourapi_timestamp(list_item["modifiedtime"])
db_modified = await repo.get_source_modified_time(content_id)
if db_modified and list_modified and db_modified >= list_modified:
    ctx.metadata["skip_unchanged_count"] += 1
    return  # detail 4콜 절약
```

### Layer 2. 워터마크 조기 종료 (bootstrap 후)

`arrange=C`(수정일 역순) + 페이지 전부 unchanged면 break.
**부트스트랩 끝난 뒤에만** 활성화.

### Layer 3. 일일 예산 하드가드

```python
api_budget_limit = 900   # 1000 quota 중 100 버퍼

if ctx.api_calls_used >= api_budget_limit:
    _mark_budget_stop(ctx, ...)   # 다음 실행 cursor 저장
    return True
```

### Layer 4. 타입별 예산 분할 + 타입별 cursor

전부 `contentTypeId=12`에 quota 다 태우면 14·39는 영원히 못 들어옴.

```python
TYPE_BUDGET_WEIGHTS = {"12": 0.5, "14": 0.25, "39": 0.25}
# 12: 450콜, 14: 225콜, 39: 225콜
next_cursor_by_type = {
    "12": {"page": 5, "content_id": "...", "modifiedtime": "..."},
    "14": {"page": 2, "content_id": "...", "modifiedtime": "..."},
    "39": {"page": 3, "content_id": "...", "modifiedtime": "..."},
}
```

다음 실행은 타입별로 자기 자리에서 재개.

### 채택 안 한 것

- **블랙리스트 (실패 응답 24h 캐시)**: TourAPI의 영구 망가진 데이터 거의 없음. TTL + 별도 저장소 인프라 정당화 안 됨
- **시작 타입 라운드로빈**: 타입별 예산 분할 + cursor가 있으면 시작 순서 무관

---

## 5. 운영성 설계 — 설명 가능한 실패

> **결정**: SYNC_LOGS를 기능보다 먼저. 모든 잡이 자동 INSERT/UPDATE.

```
SYNC_LOGS
├── job_name           (예: tourapi_spots_sync, embedding_full_recompute)
├── run_type           (scheduled / manual / triggered / regression)
├── status             (running / success / failed / partial / cancelled)
├── started_at, ended_at, duration_seconds
├── api_calls_used, records_fetched / upserted / failed
├── error_message
└── metadata JSONB     (cursor, model 버전, 회귀율 등)
```

`async with sync_log_run(...)` 컨텍스트 매니저로 자동 INSERT/UPDATE.

```python
async with sync_log_run("tourapi_spots_sync") as ctx:
    ctx.metadata.setdefault("budget_by_type", {...})
    ctx.metadata.setdefault("next_cursor_by_type", {})
    # 본 작업
    ctx.records_fetched += 1
    ...
# 정상 종료 → status='success' 자동 마감
# 예외     → status='failed' + error_message 기록 후 재발생
```

부수효과:
- 좀비 잡 timeout (24h running → failed 자동 전환 cron)
- success 1년 후 cron hard delete, failed 영구 보관

### 비활성 처리 4중 안전 가드 [^adr-0003]

[^adr-0003]: ADR 0003 — 비활성 처리 정책. [docs/adr/0003-spots-deactivation-safety-guards.md](https://github.com/nolleo-onna/nolleo-onna-pipeline/blob/main/docs/adr/0003-spots-deactivation-safety-guards.md)

외부 API에서 사라진 데이터를 `is_active=false`로 내리는 건 필요하다.
그런데 **부분 적재 / quota 컷 / 부분 장애** 상황에선 "안 들어온 데이터"가 단순히 "API에서 사라진 데이터"가 아니다.

```
is_active=false 실행 가능 조건 — 모두 통과해야 함
├── ① bootstrap_complete == True
│      (부트스트랩 안 끝났으면 누락분이 정상)
├── ② stopped_by_budget == False
│      (이번 회차가 quota 컷으로 중단됐으면 안 본 게 아님)
├── ③ failure_rate < threshold
│      (이번 회차 실패율 높으면 외부 API 장애 의심 → 보류)
└── ④ deactivation_ratio < threshold
       (dry-run 결과 너무 많이 비활성화 예정이면 멈춤 — 사고 방지)
```

추가 보호:
- `synced_at < sync_started_at` 컷오프 (이번 회차 갱신분 제외)
- `source_tour_api = TRUE` 필터 (수기 입력 데이터 보호)
- 비활성 SQL 실패는 **흡수**하고 잡 성공 유지 (부수 작업 격리)

이 구조 덕분에 "비활성 정책"이 기능이 아니라 **운영 안전장치**가 됐다.

---

## 6. LLM 매칭 설계 — 회색지대만 GPT에게

> **결정**: 룰 점수 자동 처리 + 회색지대만 LLM. 모든 쌍을 LLM에 던지지 않음.

GOOD_PRICE_SHOPS ↔ SPOTS_CORE 매칭(같은 가게가 양쪽에 있는지)에 LLM을 붙였다.

### 2단계 흐름

```
1단계: 룰 점수
- 필터: 같은 시군구 + 카테고리 호환 + 거리 ≤ 200m
- 가중치: 전화 0.5 / 이름 0.3 (Jaro-Winkler) / 주소 0.15 / 거리 0.05
- 임계값:
    ≥ 0.85       → 자동 approved + SPOTS_CORE 연결 (LLM 미경유)
    0.65 ~ 0.85  → 회색지대 → 2단계
    < 0.65       → MATCH_QUEUE 미진입 (separate)

2단계: 회색지대만 LLM (Batch)
- 입력: 룰 점수 0.65~0.85 후보 + overview/주소/카테고리
- LLM confidence + 룰 검증 통과 시 자동 적용
- 그 외 큐잉 → 관리자 검수
- 추적 필드 필수: model_name, model_version, prompt_version, source_text_hash
```

### 비용 시뮬레이션

| 단계 | LLM 호출 |
|---|---|
| 모든 쌍 LLM | 600 × 7,000 ≈ 4.2M (비용 폭발) |
| 1단계 룰 필터 후 | ~수백 쌍 |
| 회색지대만 | ~50~200 쌍/회 |

→ 부산 ~600 착한가격업소 × 일 1회 cron 기준, **월 LLM 비용 추정치 한 자릿수 달러 수준** (회색지대 50~200쌍 × gpt-4o-mini 입력 ~500토큰 기준).

### 배운 것

LLM 매칭에서 가장 중요한 건 "LLM이 잘 푸는 케이스"가 아니라
**"LLM에게 안 가도 되는 케이스를 거르는 것"**.
룰이 잘 짜이면 LLM 비중은 5% 이하로 떨어진다.

---

## 7. 테스트 설계 — 2트랙 분리

> **결정**: 단위 테스트(빠름) + 통합 테스트(정확) 분리.

| 트랙 | 도구 | 시간 | 검증 |
|---|---|---|---|
| **A. 단위** | mock | ~30초 | 가드 분기, edge case, 예외 흡수, 해시 함수 |
| **B. 통합** | testcontainers | ~5분 | SQL 정확성, alembic, partial UK, generated column, TIMESTAMPTZ |

CI에서 PR마다 A는 30초, B는 5분.
빠른 피드백 + 신뢰성 둘 다.

---

## 8. 안 한 것 / 미룬 것

> 운영 글에서 가장 정직한 부분. **"왜 안 했는가"가 더 많은 정보를 준다.**

| 항목 | 안 한 이유 |
|---|---|
| VPC 분리 / Bastion | 사용자 데이터 들어오면 도입. 지금 단계엔 과한 인프라 |
| CDC 양방향 동기화 | 마스터 데이터 단방향(파이썬 → Spring 읽기) 구조라 불필요 |
| Airflow / Dagster | 잡 수 적어서 APScheduler + cron으로 충분. 잡 30개 넘어가면 검토 |
| Redis 영업중 캐시 | PostgreSQL stored function `is_open_now()`로 대체 (p95 < 1ms) |
| 블랙리스트 캐시 | 영구 망가진 contentId 거의 없어 비용 정당화 안 됨 |
| 외부 FK 자동 검증 | LDONG/LCLS/TAGS 마스터가 SPOTS 다 끝난 뒤 별도 도메인. 그 전엔 컬럼만 두고 FK는 후속 마이그레이션에 |

---

## 9. 배운 점 4가지

1. **스키마보다 운영 규칙을 먼저 문서화** — 컬럼명 정하기 전에 UPSERT/REPLACE 정책부터
2. **적재 방식은 테이블별 불변 계약** — 한번 정한 정책은 운영 중 변경 X
3. **위험 로직은 ADR로 의사결정 기록** — 6개월 뒤 "왜 이렇게 했지?" 안 묻기 위해
4. **관측성을 기능보다 먼저** — 첫 sync 전에 SYNC_LOGS 마이그레이션부터

---

데이터를 모으는 것과 서비스가 믿고 쓰는 것은 완전히 다른 문제다.
파이프라인의 본질은 ETL이 아니라 **신뢰 가능한 상태 머신**에 가깝다.

> 트러블슈팅 / 디버깅 사례는 별도 글로 정리합니다.
