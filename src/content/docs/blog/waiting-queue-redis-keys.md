---
title: "대기열 시스템의 Redis 키 5개, 각자 왜 존재하는가"
date: 2026-04-05
tags:
  - Redis
  - 동시성
  - 시스템 설계
excerpt: KBO 야구 티켓팅 대기열을 Redis 키 5개로 설계한 과정. Sorted Set으로 줄을 세우고, 커서로 중복 없이 호출하고, 양방향 토큰 매핑으로 입장을 관리하는 구조를 처음부터 끝까지 따라간다.
category: ticketing
---

> KBO 야구 티켓팅 대기열을 Redis 키 5개로 설계한 과정을 기록한다.
> 각 키가 왜 존재해야 하는지, 하나를 빼면 무엇이 깨지는지를 중심으로 정리한다.

---

## 들어가며: 왜 대기열이 필요한가

한화 신구장 약 2만 석. 인기 매치 오픈 시각에 5만 명이 동시에 접속한다. 좌석보다 사람이 2.5배 많다.

이 5만 명을 전부 좌석 선택 페이지로 보내면 어떻게 될까?

- 좌석 점유 API에 초당 수만 건의 요청이 몰린다
- Redis Lua 스크립트가 아무리 빨라도, MySQL까지 가는 요청이 급증하면 **DB 커넥션 풀이 터진다**
- 결국 아무도 티켓을 못 산다

대기열의 역할은 단순하다. **5만 명을 줄 세우고, 시스템이 감당할 수 있는 속도로 조금씩 입장시키는 것.** 수도꼭지를 조절하는 밸브와 같다.

> **DB 커넥션 풀(Connection Pool)이란?**
> 애플리케이션이 데이터베이스에 연결할 때마다 새 연결을 만들면 느리다. 그래서 미리 일정 수의 연결을 만들어 놓고 재사용하는데, 이 연결 모음을 커넥션 풀이라 한다. 풀의 크기(보통 수십~수백 개)를 넘는 요청이 동시에 들어오면 "풀이 터졌다"고 표현한다. 대기 중인 요청이 타임아웃되며 서비스 전체가 먹통이 된다.

---

## 전체 흐름 먼저 보기

티켓팅의 전체 파이프라인을 먼저 짚자.

```
대기열 진입 → 순번 호출 → 좌석 점유 → 예매 생성 → 결제 → 좌석 확정
```

| 단계 | 조건 | 결과 |
|---|---|---|
| 대기열 통과 | 순번이 호출되어야 | 진입 토큰 획득 |
| 좌석 점유 | 진입 토큰이 있어야 | 7분짜리 임시 점유 |
| 예매 생성 | 좌석을 점유한 상태여야 | Reservation 레코드 |
| 결제 요청 | 예매가 존재해야 | Payment 처리 |
| 좌석 확정 | 결제가 성공해야 | 영구 확정 (MySQL) |

각 단계는 이전 단계의 결과물이 있어야만 진입할 수 있다. 대기열은 이 파이프라인의 **첫 번째 관문**이다.

---

## 모듈 구조

```
waiting/
├── api/
│   ├── WaitingController.java
│   └── dto/
│       ├── WaitingEnterResponse.java
│       └── WaitingStatusResponse.java
├── domain/
│   ├── WaitingService.java          ← 대기열 진입 + 순번 조회
│   ├── AdmissionService.java        ← 진입 토큰 발급(Worker) + 검증(seat 모듈)
│   └── exception/
│       ├── AlreadyInQueueException.java
│       ├── QueueNotEnteredException.java
│       └── AdmissionTokenExpiredException.java
└── infrastructure/
    ├── RedisWaitingRepository.java   ← waiting:queue / waiting:user 키 담당
    ├── RedisAdmissionRepository.java ← admission:token / admission:user 키 담당
    └── AdmissionWorker.java          ← 주기적으로 순번 호출하는 워커
```

도메인 레이어에 두 서비스가 있다.

- **WaitingService** — 사용자 입장에서의 대기열. "줄 서기"와 "내 순번 확인"을 처리한다.
- **AdmissionService** — 시스템 입장에서의 입장 관리. Worker가 호출해서 토큰을 발급하고, seat 모듈이 호출해서 토큰을 검증한다.

> **도메인 레이어 / 인프라 레이어란?**
> 계층형 아키텍처(Layered Architecture)에서 비즈니스 로직을 담는 층을 도메인 레이어, Redis나 DB 같은 외부 기술과의 연결을 담는 층을 인프라 레이어라 한다. WaitingService는 "대기열에 넣어라"라는 비즈니스 규칙만 알고, 그것이 Redis로 구현되는지 MySQL로 구현되는지는 모른다. 이 분리 덕분에 저장소를 바꿔도 비즈니스 로직은 영향을 받지 않는다.

인프라 레이어의 두 Repository는 각각 담당하는 Redis 키가 다르다. 이 분리가 왜 필요한지는 키를 하나씩 살펴보면 자연스럽게 드러난다.

---

## 키 5개 전체 지도

```
waiting:queue:{gameId}              → Sorted Set   (줄 그 자체)
waiting:user:{gameId}:{userId}      → Hash          (사용자 메타데이터)
waiting:cursor:{gameId}             → String         (어디까지 호출했는지 책갈피)
admission:token:{token}             → String + TTL  (진입 토큰)
admission:user:{gameId}:{userId}    → String + TTL  (토큰 역참조)
```

키 이름의 prefix가 두 가지인 것에 주목하자. `waiting:*`은 대기열 자체의 상태, `admission:*`은 입장 허가의 상태다. 이 prefix 경계가 그대로 Repository 분리의 기준이 된다.

> **Sorted Set, Hash, String, TTL이 뭔가요?**
> Redis는 다양한 자료구조를 제공한다. Sorted Set은 점수(score) 기준으로 자동 정렬되는 집합, Hash는 필드-값 쌍의 모음, String은 가장 기본적인 키-값 저장이다. TTL(Time To Live)은 키의 만료 시간으로, 설정한 시간이 지나면 자동으로 삭제된다. 자세한 내용은 [Redis 자료구조 깊이 보기](/blog/redis-data-structures)에서 다룬다.

---

## ① `waiting:queue:{gameId}` — Sorted Set

> "5만 명을 어떤 순서로 세울 것인가?"

가장 먼저 필요한 것은 줄 자체다. 먼저 온 사람이 먼저 들어가야 공평하니까, 도착 시각 순으로 정렬해야 한다. 그리고 이 줄에서 두 가지 연산이 빨라야 한다:

1. **"내가 몇 번째야?"** — 사용자가 대기 페이지에서 보는 것
2. **"앞에서 1,000명 누구야?"** — Worker가 입장시킬 사람을 뽑는 것

Redis Sorted Set이 정확히 이 두 가지를 `O(log N)`에 해준다.

> **O(log N)이란?**
> 알고리즘의 시간 복잡도를 나타내는 표기법이다. 데이터가 5만 개일 때 `O(N)`은 최대 5만 번 연산하지만, `O(log N)`은 약 17번이면 된다. Sorted Set은 내부적으로 skiplist라는 구조를 사용해서 이 속도를 달성한다.

```
ZADD waiting:queue:game42 1734567890123 user_777
                          ↑ score        ↑ member
                          도착 시각(ms)   사용자 ID
```

- `ZRANK waiting:queue:game42 user_777` → 0-based 순위 즉시 반환 ("23번째")
- `ZRANGE waiting:queue:game42 0 999` → 앞에서 1,000명 즉시 추출

### 왜 Sorted Set인가

다른 자료구조를 검토했다.

| 자료구조 | "내 순번" 조회 | "앞에서 N명 뽑기" | 새로고침 안전성 |
|---|---|---|---|
| **List (LPUSH/RPUSH)** | O(N) — 전체 순회 | O(N) — LRANGE | 중복 삽입 방지 불가 |
| **Stream** | 순번 개념 없음 | O(1)이지만 순번과 무관 | ID 관리 복잡 |
| **Sorted Set** | O(log N) — ZRANK | O(log N + M) — ZRANGE | **ZADD NX** 한 방 |

List는 5만 명일 때 순번 조회가 `O(50,000)`이다. 매 폴링마다 이 비용을 내면 Redis가 죽는다. Stream은 메시지 큐에 가까워서 "N번째 사람이 누구인가"를 묻는 대기열과 맞지 않는다.

### ZADD NX — 새로고침 안전성의 핵심

사용자가 대기 페이지에서 새로고침을 누른다. 브라우저가 대기열 진입 API를 다시 호출한다. 이때 `ZADD`를 그냥 쓰면?

```
# 10:00:00에 줄 섬 → 23번째
ZADD waiting:queue:game42 1734567890000 user_777

# 10:01:30에 새로고침 → score가 덮어써짐
ZADD waiting:queue:game42 1734567890090 user_777
# → user_777의 순번이 뒤로 밀림!
```

`NX` 옵션은 **member가 이미 존재하면 score를 덮어쓰지 않는다.**

```
ZADD NX waiting:queue:game42 1734567890090 user_777
# → 이미 존재하므로 무시됨. 원래 score(순번) 유지.
```

> **NX = Not eXists.** "존재하지 않을 때만 실행하라"는 뜻이다. Redis의 여러 명령에서 공통으로 쓰이는 옵션으로, `SET NX`, `ZADD NX`, `SETNX` 등이 모두 같은 원리다.

이 `NX` 두 글자가 빠지면 "새로고침하면 순번이 뒤로 밀린다"는 대기열의 대표적인 버그가 박힌다. 사소한 옵션 하나가 사용자 경험 전체를 좌우한다.

---

## ② `waiting:user:{gameId}:{userId}` — Hash

> "순번 말고도 보여줄 게 더 있다."

사용자가 대기 페이지에서 "내 상태 어때?"라고 물어볼 때, 단순히 "23번째"만 보여줄 수는 없다.

- 언제 줄 섰는지 (`entered_at`)
- 지금 상태가 뭔지 (`WAITING` / `ADMITTED` / `EXPIRED`)
- 입장 허가를 받았다면 언제 받았는지 (`admitted_at`)

Sorted Set에는 score(시각) 하나밖에 넣을 수 없다. member 옆에 부가 정보를 매달 방법이 없다. 그래서 사용자별 **"상세 카드"** 를 따로 둔다.

```
HSET waiting:user:game42:user_777
     entered_at   1734567890123
     status       WAITING
     admitted_at  ""
```

### 역할 분리

- **Sorted Set** = "줄 자체" — 순서 매기기 전용
- **Hash** = "각 사용자의 상세 카드" — 상태 조회 전용

상태 조회 API가 호출되면 두 키를 조합한다:

```
1. ZRANK waiting:queue:game42 user_777       → 23 (순번)
2. HGETALL waiting:user:game42:user_777      → {status: WAITING, entered_at: ...}
3. 둘을 합쳐서 응답: "23번째 대기 중, 5분 전부터 대기"
```

### 왜 Sorted Set 하나로 안 되는가

"Sorted Set의 member에 상태를 같이 넣으면 되지 않나?"라는 생각이 들 수 있다. 예를 들어 member를 `"user_777:WAITING"`으로 만드는 방법.

문제는 **상태가 바뀔 때** 생긴다. `WAITING` → `ADMITTED`로 변경하려면:

1. `ZREM waiting:queue:game42 "user_777:WAITING"` — 기존 member 삭제
2. `ZADD waiting:queue:game42 <score> "user_777:ADMITTED"` — 새 member 추가

이 두 연산 사이에 score(순번)가 달라질 수 있다. 삭제 후 다시 넣으면 순번이 바뀔 위험이 있고, 원래 score를 기억해뒀다가 다시 넣더라도 **원자적이지 않다.**

> **원자적(Atomic)이란?**
> "전부 성공하거나 전부 실패하거나" 둘 중 하나만 되는 것이다. 위 예시에서 ZREM은 성공했는데 ZADD가 실패하면 사용자가 큐에서 사라진다. 원자적이지 않은 연산은 중간 상태가 노출되어 데이터 정합성이 깨질 수 있다.

**책임을 나누면 안전하다.** Sorted Set은 순번만 책임지고, Hash는 상태만 책임진다. 각자의 데이터를 독립적으로 업데이트할 수 있다.

---

## ③ `waiting:cursor:{gameId}` — String

> "어디까지 호출했는지 기억하는 책갈피."

Admission Worker는 주기적으로 (예: 1초마다) 대기열 앞쪽에서 N명을 뽑아 진입 토큰을 발급한다.

> **Worker란?**
> 사용자의 요청과 별개로 백그라운드에서 주기적으로 실행되는 작업을 말한다. 여기서는 Spring의 `@Scheduled` 등으로 구현한다. 사용자가 API를 호출하지 않아도 Worker가 알아서 1초마다 대기열을 확인하고 입장시킨다.

### 문제: 같은 사람에게 토큰을 반복 발급

순진한 구현을 생각해보자.

```
매 실행마다: ZRANGE waiting:queue:game42 0 999 → 앞에서 1,000명 추출

1초차: user_1 ~ user_1000 → 토큰 발급
2초차: user_1 ~ user_1000 → 아직 큐에 있으니까 또 추출됨 → 중복 발급!
```

Sorted Set에서 추출한 사용자가 아직 큐에 남아있으면, 다음 실행에서 또 뽑힌다.

### 해결 방법 A: 처리한 사용자를 큐에서 삭제

```
ZRANGE ... → user_1 ~ user_1000 추출
ZREM waiting:queue:game42 user_1 user_2 ... user_1000  → 큐에서 삭제
```

동작은 하지만 단점이 있다:

- 사용자가 입장 직전에 새로고침하면 "어? 나 큐에 없네?" — 혼란
- 사후에 "이 사용자가 몇 번째였는지" 조회 불가 — 디버깅 어려움
- 큐에서 사라진 사용자의 순번 조회 API가 404를 반환 — UX 불편

### 해결 방법 B: 큐는 그대로, 책갈피만 이동 (커서 패턴)

큐를 손대지 않고, **"어디까지 처리했는지"를 별도로 기록**한다.

```
SET waiting:cursor:game42 0          # 초기: 0번째부터

1초차: cursor=0    → ZRANGE queue 0 999    → 0~999 처리 → cursor=1000
2초차: cursor=1000 → ZRANGE queue 1000 1999 → 1000~1999 처리 → cursor=2000
3초차: cursor=2000 → ZRANGE queue 2000 2999 → 2000~2999 처리 → cursor=3000
```

**책 읽기 비유**가 정확하다. 책(큐)은 그대로 두고 읽은 페이지 번호(커서)만 기록한다. 책장을 찢어내지 않으니까:

- 사용자 순번 조회가 언제든 가능하다
- 디버깅 시 "N번째에 누가 있었는지" 사후 추적이 가능하다
- Worker가 충돌해서 재시작해도, 커서 위치부터 이어갈 수 있다

### Worker의 한 사이클

```
1. cursor = GET waiting:cursor:game42
2. users  = ZRANGE waiting:queue:game42 cursor cursor+batchSize-1
3. users 각각에 대해 토큰 발급 (④, ⑤번 키 사용)
4. SET waiting:cursor:game42 cursor+batchSize
```

> **batchSize는 어떻게 정하나?**
> 시스템이 감당할 수 있는 동시 입장자 수에 따라 조절한다. 밸브의 개방량을 조절하는 것과 같다. 좌석 점유 API의 처리량이 초당 500건이면, Worker도 초당 500명 이하로 입장시켜야 한다. 이걸 넘기면 대기열은 통과시켰는데 좌석 API가 터지는 병목 이동(Bottleneck Shifting) 현상이 발생한다.

---

## ④ `admission:token:{token}` — String + TTL

> "대기열 통과를 증명하는 입장권."

Worker가 "user_777 입장 OK"라고 결정했다. 그런데 user_777은 아직 대기 페이지에 있다. 실제 좌석 선택 페이지로 어떻게 보낼까?

**입장권(토큰)을 발급한다.** 사용자는 이 토큰을 들고 좌석 선택 페이지에 진입하고, 좌석 점유 API는 요청 헤더의 토큰을 검증해서 통과시킨다.

```
SET admission:token:abc-xyz-123 "game42:user_777" EX 900
    ↑                           ↑                     ↑
    랜덤 UUID 토큰              누구의 입장권인지       900초(15분) 후 자동 만료
```

> **UUID(Universally Unique Identifier)란?**
> `550e8400-e29b-41d4-a716-446655440000` 같은 형태의 랜덤 문자열이다. 충돌 확률이 사실상 0에 가까워서 "전 세계에서 유일한 식별자"로 사용된다. 토큰을 UUID로 만들면 다른 사람의 토큰을 예측하거나 위조하는 것이 불가능하다.

### 토큰 검증 흐름

좌석 점유 API에서:

```
GET admission:token:abc-xyz-123

→ "game42:user_777"   → 유효한 토큰. gameId와 userId 일치 확인 후 통과.
→ (nil)               → 만료됐거나 존재하지 않는 토큰. 401 Unauthorized.
```

> **(nil)은 Redis에서 "값이 없음"을 나타내는 표현이다.** 키가 존재하지 않거나, TTL이 만료되어 자동 삭제된 경우에 반환된다.

### 왜 TTL이 15분인가

사용자가 입장 허가를 받은 뒤 좌석을 고르고 점유하기까지의 시간을 고려해야 한다.

- **너무 짧으면**: 좌석 배치도를 보면서 고민하다가 토큰이 만료된다. "들어왔는데 아무것도 못 하고 쫓겨남" — 최악의 UX
- **너무 길면**: 토큰만 받아놓고 아무것도 안 하는 유령 사용자가 늘어난다. 뒤에 줄 선 사람이 못 들어온다

15분은 "좌석 배치도 조회 + 비교 + 선택 + 점유 시도"를 충분히 할 수 있으면서, 유령 사용자의 체류 시간을 제한하는 값이다. 이 값은 부하 테스트 결과에 따라 조정될 수 있다.

### 토큰 TTL과 좌석 점유 TTL은 다르다

혼동하기 쉬운 부분이다.

| 키 | 의미 | TTL | 시점 |
|---|---|---|---|
| `admission:token` | 대기열 통과 증명. 좌석 선택 페이지 진입 권한 | 15분 | 입장 허가 시 시작 |
| `seat:hold` | 좌석 임시 점유. 결제 전까지 다른 사람이 못 가져감 | 7분 | 좌석 점유 시 시작 |

```
시간 ──────────────────────────────────────────────▶

[입장 허가] ─── admission:token (15분) ──────────── [만료]
                │
                ├── 좌석 배치도 조회, 비교, 선택
                │
                [좌석 점유] ─── seat:hold (7분) ─── [만료]
                                │
                                ├── 예매 생성, 결제
                                │
                                [결제 완료] → 영구 확정
```

토큰 TTL(15분)은 좌석 점유 TTL(7분)보다 길어야 한다. 좌석을 점유하기도 전에 토큰이 만료되면 안 되기 때문이다.

---

## ⑤ `admission:user:{gameId}:{userId}` — String + TTL

> "이 사용자가 이미 토큰을 받았는지 한 번에 확인하는 역방향 인덱스."

④번 키(`admission:token:{token}`)는 **토큰 → 사용자** 방향의 매핑이다. "이 토큰 누구 꺼야?"에는 답할 수 있다.

하지만 반대 질문은 어떨까? **"이 사용자가 이미 토큰을 가지고 있나?"**

④번 키만으로 이걸 알려면 모든 토큰 키를 스캔해야 한다. 5만 명에게 토큰이 발급된 상태라면 5만 개를 뒤져야 한다. 이건 불가능하다.

> **역방향 인덱스(Reverse Index)란?**
> 데이터베이스에서 검색 속도를 높이기 위해 "반대 방향"의 매핑을 추가로 저장하는 기법이다. 책의 색인(index)이 "키워드 → 페이지 번호"라면, 역방향 인덱스는 "페이지 번호 → 키워드"에 해당한다. 여기서는 "토큰 → 사용자"에 더해 "사용자 → 토큰" 매핑을 추가한 것이다.

```
SET admission:user:game42:user_777 "abc-xyz-123" EX 900
    ↑                               ↑                ↑
    사용자 식별                      그가 받은 토큰    토큰과 동일한 TTL
```

### 중복 발급 방지

Worker가 토큰을 발급하기 전에 이 키를 먼저 확인한다:

```
GET admission:user:game42:user_777

→ (nil)            → 아직 토큰 없음. 새로 발급 OK.
→ "abc-xyz-123"    → 이미 발급됨. 중복 발급 차단.
```

더 안전하게는 `SETNX` (Set if Not eXists)를 쓴다. 동시에 두 Worker 인스턴스가 같은 사용자에게 토큰을 발급하려 해도, `SETNX`는 한쪽만 성공시킨다.

```
SETNX admission:user:game42:user_777 "new-token-456"

→ 1 (성공) → 새 토큰 발급 진행
→ 0 (실패) → 이미 다른 토큰 존재. 발급 중단.
```

> **왜 GET으로 확인하지 않고 SETNX를 쓰나?**
> GET으로 먼저 확인하고 없으면 SET하는 방식은 두 명령 사이에 다른 Worker가 끼어들 수 있다 (이것을 **경쟁 조건(Race Condition)** 이라 한다). SETNX는 "확인 + 저장"을 하나의 원자적 연산으로 수행하므로 경쟁 조건이 발생하지 않는다.

### 양방향 매핑 정리

```
                 발급 시 두 키를 동시에 생성
                 ┌─────────────────────────────────┐
                 │                                 │
                 ▼                                 ▼
   admission:token:{token}          admission:user:{gameId}:{userId}
   "game42:user_777"                "abc-xyz-123"
   TTL: 900s                        TTL: 900s

   → 토큰으로 사용자 조회           → 사용자로 토큰 조회
   → 좌석 점유 시 검증용            → 중복 발급 방지용
```

두 키의 TTL을 동일하게(15분) 설정하면 자연스럽게 같이 만료된다. 어느 한쪽만 남는 불일치가 발생하지 않는다.

---

## 한 사이클의 전체 흐름

키 5개가 어떻게 맞물려 돌아가는지, 사용자 user_777의 시점에서 처음부터 끝까지 따라가 보자.

### Step 1. 대기열 진입

user_777이 대기 페이지에 접속한다. 프론트엔드가 대기열 진입 API를 호출한다.

```
POST /api/waiting/game42/enter
Authorization: Bearer <JWT>
```

서버에서 일어나는 일:

```
① ZADD NX waiting:queue:game42 1734567890123 user_777
   → NX 덕분에 이미 줄 서 있으면 무시됨. 새로고침 안전.
   → 반환값 1이면 새로 추가됨, 0이면 이미 있었음.

② HSET waiting:user:game42:user_777
        entered_at   1734567890123
        status       WAITING
        admitted_at  ""
   → 사용자의 상세 카드 생성.
```

**사용되는 키**: `waiting:queue`, `waiting:user`

### Step 2. 순번 조회 (폴링)

user_777이 대기 페이지에서 3초마다 자기 순번을 확인한다.

> **폴링(Polling)이란?**
> 클라이언트가 서버에 주기적으로 "변화 있어?" 하고 물어보는 방식이다. WebSocket처럼 서버가 능동적으로 알려주는 방식(Push)도 있지만, 대기열처럼 많은 사용자가 동시에 접속하는 경우 폴링이 서버 부담을 예측 가능하게 만들어준다.

```
GET /api/waiting/game42/status
Authorization: Bearer <JWT>
```

서버에서 일어나는 일:

```
① ZRANK waiting:queue:game42 user_777
   → 23 (0-based, 즉 앞에 23명)

② HGETALL waiting:user:game42:user_777
   → { status: "WAITING", entered_at: "1734567890123", admitted_at: "" }

③ ZCARD waiting:queue:game42
   → 48,721 (전체 대기자 수)
```

응답:

```json
{
  "rank": 24,
  "totalWaiting": 48721,
  "status": "WAITING",
  "enteredAt": "2026-04-13T18:00:00"
}
```

**사용되는 키**: `waiting:queue`, `waiting:user`

### Step 3. Worker가 순번 호출

Admission Worker가 1초마다 실행된다. 이번 실행에서 커서가 0이고 batchSize가 1,000이라고 하자.

```
① GET waiting:cursor:game42
   → 0 (처음이니까)

② ZRANGE waiting:queue:game42 0 999
   → [user_1, user_2, ..., user_777, ..., user_1000]
   → user_777이 23번째에 포함됨!

③ 각 사용자에 대해:
   ┌─────────────────────────────────────────────────────────────┐
   │ SETNX admission:user:game42:user_777 "abc-xyz-123" EX 900  │
   │ → 1 (성공, 아직 토큰 없었음)                                 │
   │                                                             │
   │ SET admission:token:abc-xyz-123 "game42:user_777" EX 900    │
   │ → 토큰 → 사용자 매핑 저장                                    │
   │                                                             │
   │ HSET waiting:user:game42:user_777                           │
   │      status      ADMITTED                                   │
   │      admitted_at  1734567920000                              │
   │ → 상태를 ADMITTED로 변경                                      │
   └─────────────────────────────────────────────────────────────┘

④ SET waiting:cursor:game42 1000
   → 책갈피를 1000으로 이동. 다음 실행은 1000번부터.
```

**사용되는 키**: 키 5개 전부 — `waiting:cursor`, `waiting:queue`, `admission:user`, `admission:token`, `waiting:user`

이 하나의 Worker 사이클에서 키 5개가 전부 등장한다.

### Step 4. 순번 조회 → 입장 가능 확인

user_777의 다음 폴링:

```
① ZRANK waiting:queue:game42 user_777 → 23 (변하지 않음)
② HGETALL waiting:user:game42:user_777
   → { status: "ADMITTED", entered_at: "...", admitted_at: "..." }
```

status가 `ADMITTED`이므로 프론트엔드는 사용자에게 **"입장 가능"** 화면을 보여준다.

```json
{
  "rank": 24,
  "totalWaiting": 48721,
  "status": "ADMITTED",
  "admissionToken": "abc-xyz-123"
}
```

### Step 5. 좌석 점유 시도

user_777이 토큰을 들고 좌석 점유 API를 호출한다.

```
POST /api/seats/game42/12345/hold
Authorization: Bearer <JWT>
X-Admission-Token: abc-xyz-123
```

seat 모듈에서 토큰 검증:

```
GET admission:token:abc-xyz-123
→ "game42:user_777"
→ gameId와 userId가 요청과 일치 → 통과
```

검증을 통과하면 좌석 점유 Lua 스크립트가 실행된다.

**사용되는 키**: `admission:token`

> 좌석 점유 시스템의 Redis 키(`seat:hold`, `seat:user_holds`)는 별도 글에서 다룬다.

---

## 키 간 관계 요약

```
┌────────────────────────────────────────────────────────────────────────┐
│                         RedisWaitingRepository                        │
│                                                                       │
│   waiting:queue:{gameId}         waiting:user:{gameId}:{userId}       │
│   ┌──────────────────┐          ┌─────────────────────────────┐      │
│   │  Sorted Set      │          │  Hash                       │      │
│   │                  │          │  entered_at: ...             │      │
│   │  user_1  → 100ms │          │  status: WAITING → ADMITTED │      │
│   │  user_2  → 101ms │──────────│  admitted_at: ...           │      │
│   │  ...             │  순번 +  │                             │      │
│   │  user_777→ 123ms │  상태    └─────────────────────────────┘      │
│   │  ...             │  조합                                         │
│   └──────────────────┘                                               │
│            ↑                                                          │
│            │ ZRANGE (커서 기반)                                        │
│   waiting:cursor:{gameId}                                             │
│   ┌──────────────────┐                                               │
│   │  String: "1000"  │ ← Worker가 매 사이클마다 업데이트               │
│   └──────────────────┘                                               │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                       RedisAdmissionRepository                        │
│                                                                       │
│   admission:token:{token}        admission:user:{gameId}:{userId}    │
│   ┌──────────────────┐          ┌──────────────────────────┐         │
│   │  String + TTL    │          │  String + TTL            │         │
│   │                  │◄────────►│                          │         │
│   │  "game42:user_777│  양방향  │  "abc-xyz-123"           │         │
│   │  TTL: 900s       │  매핑    │  TTL: 900s               │         │
│   └──────────────────┘          └──────────────────────────┘         │
│   → 좌석 점유 시 검증용          → 중복 발급 방지용                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 엣지 케이스와 방어

키 설계가 끝이 아니다. 실제 운영에서 마주칠 수 있는 엣지 케이스를 정리한다.

> **엣지 케이스(Edge Case)란?**
> 정상적인 흐름이 아닌, 경계 조건이나 예외 상황을 말한다. "사용자가 정상적으로 대기 → 입장 → 점유"하는 건 해피 패스(Happy Path)이고, "Worker가 중간에 죽으면?", "토큰이 만료되면?"같은 것이 엣지 케이스다. 실서비스에서는 엣지 케이스가 장애의 대부분을 차지한다.

### 1. Worker 장애 후 재시작

Worker가 커서를 1,000으로 업데이트하기 전에 죽으면? 다음 실행에서 커서가 0인 채로 다시 0~999를 처리한다.

이때 이미 토큰을 받은 사용자에게 중복 발급이 시도되지만, `admission:user` 키의 `SETNX`가 이를 막는다.

```
Worker 재시작 → cursor=0 → 0~999 다시 처리
├── user_1: SETNX → 0 (실패, 이미 토큰 있음) → 건너뜀
├── user_2: SETNX → 0 (실패) → 건너뜀
├── ...
└── 결과: 중복 발급 없이 안전하게 복구됨
```

이처럼 같은 연산을 여러 번 실행해도 결과가 달라지지 않는 성질을 **멱등성(Idempotency)** 이라 한다. `SETNX`가 이 멱등성을 보장해준다.

### 2. 토큰 만료 후 재진입

15분이 지나 토큰이 만료됐다. 사용자는 좌석을 잡지 못했다. 이 사용자를 어떻게 처리할까?

- `admission:token`과 `admission:user`는 TTL에 의해 **자동 삭제**된다
- `waiting:user`의 status는 스케줄러가 주기적으로 `ADMITTED` → `EXPIRED`로 변경한다
- 사용자가 다시 줄을 서려면 새로운 대기열 진입이 필요하다

### 3. 동시에 같은 사용자가 여러 기기에서 접속

user_777이 폰과 PC에서 동시에 대기열에 진입한다.

- `ZADD NX`에 의해 첫 번째 요청만 큐에 들어간다. 두 번째는 무시된다
- `waiting:user` Hash도 첫 번째 요청에서 생성된다
- 토큰 발급도 `SETNX`로 하나만 생성된다

**결과**: 기기가 여러 대여도 한 사용자는 하나의 순번, 하나의 토큰만 갖는다.

### 4. 대기열이 비었는데 Worker가 계속 돌 때

커서가 큐 크기를 넘어서면 `ZRANGE`가 빈 배열을 반환한다. Worker는 아무 일도 하지 않고 다음 사이클을 기다린다. 새 사용자가 줄을 서면 커서 위치에서 다시 처리가 시작된다.

### 5. TTL 불일치 가능성

④번과 ⑤번 키를 동시에 만드는데, 두 `SET` 명령 사이에 미세한 시간차가 있다. 예를 들어 `admission:token`을 만든 직후 서버가 1초간 GC(Garbage Collection) 멈춤을 겪으면, `admission:user`의 TTL이 1초 짧아진다.

실무에서는 이 차이가 문제가 되는 경우가 드물지만, 완벽한 동기화가 필요하다면 **Lua 스크립트**로 두 키를 원자적으로 생성할 수 있다.

```lua
-- 두 키를 하나의 원자적 연산으로 생성
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])  -- admission:token
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])  -- admission:user
return 1
```

> **Lua 스크립트란?**
> Redis 서버 내부에서 실행되는 스크립트다. 여러 Redis 명령을 하나의 원자적 단위로 묶어서 실행할 수 있다. 네트워크 왕복 없이 서버 내에서 바로 실행되므로 빠르고, 중간에 다른 명령이 끼어들 수 없어 안전하다.

---

## 마치며

대기열 시스템의 키 5개는 각각 명확한 하나의 책임을 갖는다.

| 키 | 한 줄 요약 | 없으면 뭐가 깨지나 |
|---|---|---|
| `waiting:queue` | 줄 자체. 순서를 매긴다. | 선착순 자체가 불가능 |
| `waiting:user` | 사용자의 상세 카드. 상태를 추적한다. | "대기 중/입장 가능" 구분 불가 |
| `waiting:cursor` | 책갈피. Worker가 어디까지 처리했는지 기억한다. | 같은 사람에게 반복 처리 |
| `admission:token` | 입장권. 토큰으로 사용자를 조회한다. | 아무나 좌석 페이지 진입 가능 |
| `admission:user` | 역참조. 사용자로 토큰을 조회한다. | 한 사람에게 토큰 중복 발급 |

5개가 많아 보일 수 있지만, 하나라도 빼면 문제가 생긴다. 각 키는 **"없으면 뭐가 깨지는가"** 로 존재 이유를 증명할 수 있다.

이 키들이 좌석 점유 시스템의 Redis 키와 어떻게 연결되는지, 그리고 이 대기열을 우회하려는 시도를 어떻게 막는지는 [대기열을 우회하려는 8가지 시도와 Redis로 막는 법](/blog/waiting-queue-bypass)에서 다룬다.
