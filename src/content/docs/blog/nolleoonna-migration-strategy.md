---
title: "Python 파이프라인과 Spring 백엔드가 같은 DB를 쓸 때, 마이그레이션은 어디서 관리하나"
date: 2026-05-07
tags:
  - 시스템 설계
  - PostgreSQL
  - 데이터 파이프라인
  - Spring Boot
  - Python
excerpt: 놀러온나는 Python 데이터 파이프라인과 Spring Boot 백엔드가 같은 PostgreSQL을 공유한다. Hibernate `ddl-auto=update`와 Alembic이 충돌하는 멀티스택 환경에서, Alembic 단독 운영을 선택한 근거 셋과 그것을 안전하게 굴리기 위한 보조 장치 6개를 정리한다.
category: nolleo-onna
---

> **TL;DR**
> - 놀러온나는 Python 데이터 파이프라인 + Spring Boot 백엔드가 같은 PostgreSQL을 공유
> - 마이그레이션을 양쪽에서 관리하면 Hibernate `ddl-auto=update`와 Alembic이 충돌
> - **결정: Alembic 단독 운영, Spring은 `ddl-auto=validate`로 강제**
> - 이유 셋: 양방향 FK가 많음 / 무게중심이 파이썬에 있음 / 마이그레이션과 백필이 결합돼야 함

---

## 1. 상황 — 멀티스택 + 단일 DB

놀러온나는 두 언어가 같은 DB를 본다.

```
┌─ Python 파이프라인 ─┐         ┌─ Spring Boot ─┐
│  TourAPI 수집       │         │  인증/추천     │
│  LLM 가공           │  ──→    │  사용자 CRUD  │
│  마스터 데이터 적재 │         │  검색          │
└─────────┬───────────┘         └──────┬────────┘
          │                             │
          └────── PostgreSQL 16 ────────┘
                  (단일 클러스터)
```

마이그레이션 도구 후보 두 개:

| 도구 | 언어 | 백필 |
|---|---|---|
| Alembic | Python | Python 함수 (op.execute로 SQL + 일반 코드) |
| Flyway | Java | SQL only |

**한쪽이 다른 쪽 영역까지 관리해야 한다.** Hibernate가 `ddl-auto=update`로 자동 변경하는 동시에 Alembic이 마이그레이션 적용하면 100% 충돌. Spring 측에서 자동 DDL을 끄고 도구 하나로 통일해야 한다.

문제는 **어느 쪽에 통일할 것인가**다.

---

## 2. 왜 Alembic 단독인가 — 근거 셋

### 2-1. 양방향 FK가 너무 많음

ERD를 펼쳐보면 Spring 도메인 ↔ 파이썬 도메인 사이에 FK가 양방향으로 흐른다.

| FK | 방향 |
|---|---|
| `BOOKMARKS.spot_content_id → SPOTS_CORE` | Spring → 파이썬 |
| `GENERATED_COURSE_ITEMS.spot_content_id → SPOTS_CORE` | Spring → 파이썬 |
| `SYNC_LOGS.triggered_by → USERS` | 파이썬 → Spring |
| `BUSINESS_HOURS_REVIEW_QUEUE.reviewed_by → USERS` | 파이썬 → Spring |
| `HANKKUT.author_user_id → USERS` | 파이썬 → Spring |
| `GOOD_PRICE_PRICE_OBSERVATIONS.submitter_user_id → USERS` | 파이썬 → Spring |

두 도구로 가르면 **배포 순서 강제 조율 + deferred FK + nullable 후속 부착**이 매번 발생한다.
한쪽 PR이 머지될 때마다 반대쪽 마이그레이션을 동기화해야 한다.
사람 두세 명짜리 팀이 감당할 운영 비용이 아니다.

### 2-2. 무게중심이 파이썬에 있음

operation.md §6의 R/W 매트릭스를 보면, Spring이 진짜로 단독 R/W인 테이블은 다음 정도다.

```
USERS · BOOKMARKS · BOOKMARK_COLLECTIONS · GENERATED_COURSES · GENERATED_COURSE_ITEMS
COURSE_DECISIONS · USER_REVIEWS · VISIT_HISTORY · NOTIFICATIONS
```

그것도 거의 다 SPOTS/EVENTS 마스터 데이터를 **참조**하는 구조다.
마스터 데이터의 owner가 DDL owner인 게 자연스럽다.

### 2-3. 마이그레이션 ↔ 백필 결합

스키마를 바꿀 때 데이터 변환이 같이 가야 하는 경우가 많다.

예: `SPOT_DETAILS.business_hours` JSONB 컬럼 신설 + 기존 자유 텍스트를 LLM으로 정규화 백필.

```python
# Alembic — 한 마이그레이션 안에서 스키마 변경 + 파이썬 함수로 백필
def upgrade():
    op.add_column("spot_details",
        sa.Column("business_hours", postgresql.JSONB))

    # 같은 트랜잭션에서 파이썬 백필 함수 호출
    conn = op.get_bind()
    rows = conn.execute(text("SELECT content_id, intro FROM spot_details ..."))
    for row in rows:
        normalized = call_llm_normalizer(row.intro)
        conn.execute(text("UPDATE spot_details SET business_hours = :v ..."),
                     {"v": json.dumps(normalized), "id": row.content_id})
```

Flyway는 SQL only라 LLM 호출 같은 외부 의존이 들어가는 순간 **별도 잡으로 분리**해야 한다. 마이그레이션과 백필 체인이 끊긴다.

→ 백필이 외부 시스템(LLM/임베딩/지오코딩)을 부르는 본 프로젝트에선 **Alembic의 Python 통합이 결정적 장점**이다.

---

## 3. Alembic 단독을 잘 쓰기 위한 보조 장치 6개

### A. Spring 측 Hibernate 설정 강제

```yaml
# application.yml
spring:
  jpa:
    hibernate:
      ddl-auto: validate     # never: create / update / create-drop
```

- `validate`: entity와 DB 컬럼 불일치 시 **부팅 실패**
- `none`도 허용 (검증조차 안 함)
- `update`/`create`/`create-drop`은 **금지** — Alembic과 충돌의 근원

### B. 마이그레이션 파일명에 owner prefix

도메인별 owner를 파일명에 박아 PR 리뷰 시 누구 책임인지 즉시 보이게:

```
alembic/versions/
├── 0010_user_create_users.py              # Spring 도메인 (PR은 파이썬 레포)
├── 0011_user_create_user_embeddings.py
├── 0020_bookmark_create_bookmarks.py      # Spring 도메인
├── 0030_event_create_events_core.py       # 파이썬 도메인
└── 0099_spots_external_fks.py             # 양 도메인 FK 부착
```

### C. Spring 팀 워크플로우 — PR 묶기

- Spring 개발자가 entity 컬럼 추가 → 파이썬 레포에 alembic 마이그레이션 PR
- 두 PR(파이썬 마이그레이션 + Spring entity)을 **같은 release로 묶어** 배포
- 별도 머지 시 entity ↔ DB drift 즉시 발생

### D. CI 강제

```yaml
- name: alembic upgrade
  run: alembic upgrade head           # 빈 DB에 head까지 적용 검증
- name: alembic downgrade
  run: alembic downgrade base         # 역방향도 안전한지
- name: spring boot validate
  run: ./gradlew bootRun --validate   # entity ↔ DB 일치 검증
```

세 단계 모두 통과해야 머지 가능. 둘 중 하나만 깨져도 production 사고 직결.

### E. Production downgrade 차단

운영은 **forward only**. `downgrade()` 함수는 작성하되 dev/staging 검증용으로만.

이유: production에서 downgrade는 데이터 손실 + 다른 마이그레이션과의 의존성 깨짐 위험이 너무 크다. 롤백이 필요하면 **새 마이그레이션을 forward로** 작성하는 게 안전하다.

### F. DB 권한 분리 — Alembic 단독 ≠ 단일 DB 사용자

DDL은 Alembic 한 곳이지만, **런타임 권한은 Spring/파이썬을 별도 DB user로 분리**.

```sql
-- 파이썬 파이프라인 user — 마스터 데이터 RW
GRANT INSERT, UPDATE, DELETE, SELECT ON
  spots_core, spot_details, ..., sync_logs
TO pipeline_user;
GRANT SELECT ON
  users, bookmarks, ...           -- 사용자 데이터 읽기만
TO pipeline_user;

-- Spring user — 사용자 데이터 RW
GRANT INSERT, UPDATE, DELETE, SELECT ON
  users, bookmarks, generated_courses, ...
TO app_user;
GRANT SELECT ON
  spots_core, spot_details, ...   -- 마스터 데이터 읽기만
TO app_user;
```

운영 중 의도치 않은 cross-domain 쓰기를 DB 레벨에서 차단.

---

## 4. 언제 Flyway 분리를 다시 고려해야 하는가

지금은 아니지만 미래에 다음이 생기면 재검토:

| 트리거 | 의미 |
|---|---|
| Spring 팀이 별도 조직/별도 DBA로 분리 | 책임자가 다르면 도구도 다른 게 자연스러움 |
| 도메인이 별도 스키마/별도 DB로 물리 분리 | 예: `data` schema vs `app` schema, 또는 사용자 데이터를 별도 클러스터로 |
| 마이그레이션 충돌 빈도 ≥ 주 1회 | 단일 도구의 병목이 임계값 넘는 시점 |

이 셋 다 해당 안 되면 **단독 유지가 정답**.

---

## 5. 적용 결과 — FK 처리 단순화

이 결정 덕분에 외부 FK 부착이 깔끔해졌다.

```
0001_spots_core_tables           ── 파이썬 도메인
0002_spots_peripheral_tables     ── 파이썬 도메인
0003_spots_indexes
0004_spots_updated_at_triggers
0005_create_sync_logs            ── 운영 인프라
0010_user_create_users           ── Spring 도메인 (예정)
0011_user_create_user_embeddings ── 양쪽 (예정)
0099_spots_external_fks          ── 외부 FK 부착 (master 도착 후)
```

`SYNC_LOGS.triggered_by → USERS` 같은 cross-domain FK는
USERS 마이그레이션 적재 후 **같은 체인 다음 revision**에서 부착. (현재 `0099_spots_external_fks` 패턴 그대로)

`BUSINESS_HOURS_REVIEW_QUEUE.reviewed_by → USERS`도 같은 묶음.

→ 양방향 FK가 많아도 **체인 하나**라 PR 관계가 단순.

---

## 6. 결론

| 결정 | 내용 |
|---|---|
| 마이그레이션 도구 | **Alembic 단독** |
| Spring 자동 DDL | `ddl-auto: validate` 강제 |
| DDL owner | 파이썬 (마스터 데이터 SoT) |
| 백필 위치 | Alembic Python 함수 (외부 시스템 호출 포함 가능) |
| 권한 분리 | Spring/파이썬 별도 user (DDL과 별개) |

**"같은 DB를 쓰는 두 언어 스택"** 문제는 마이그레이션 도구 선택부터 시작한다.
도구를 가르면 운영 비용이 선형으로 늘고, 통일하면 한쪽이 다른 쪽 코드까지 본다.

Alembic 단독은 **백필이 외부 시스템에 의존하는 경우** 결정적 장점이 있다.
이 프로젝트는 LLM/임베딩/지오코딩이 백필에 들어가서 그 장점을 정확히 산다.

> ERD를 잘 그렸느냐의 척도는 컬럼 수가 아니라
> **"누가 언제 어떻게 바꿀 수 있는가"**가 명확한지에 달려 있다.
