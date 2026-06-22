---
title: "Redis 자료구조"
category: redis
description: "String, List, Hash, Set, Sorted Set, Stream — Redis가 제공하는 자료구조와 내부 인코딩, 그리고 어떤 상황에 무엇을 고를지 판단 기준."
---

Redis의 진짜 강점은 단순 `GET`/`SET`을 넘어 **서버 사이드에서 자료구조를 직접 조작**한다는 데 있다. DB는 꺼내서 애플리케이션에서 가공하지만, Redis는 **저장과 동시에 정렬·집합 연산·범위 조회**를 처리한다. 그래서 자료구조 선택이 곧 성능·메모리를 가른다.

> 기본기인 "Redis가 왜 빠른가"는 [Redis란](/wiki/redis-intro/), 캐시 패턴은 [캐시 전략](/wiki/cache-strategy/) 참고.

## 1. String — 가장 기본, 가장 많이 쓰는 타입

### 구조

키 하나에 값 하나를 저장한다. 값은 문자열, 숫자, JSON, 바이너리 모두 가능하다.
최대 512MB까지 저장할 수 있지만, 실무에서 큰 값을 넣으면 성능이 떨어진다.

```
SET user:1:name "김철수"
GET user:1:name  → "김철수"

SET counter 0
INCR counter     → 1
INCRBY counter 5 → 6
```

### 내부 인코딩

Redis는 값의 타입에 따라 내부 인코딩을 자동으로 선택한다.

| 조건 | 인코딩 | 설명 |
|--|--|--|
| 정수값 (long 범위) | `int` | 정수 그대로 저장, 메모리 효율적 |
| 44바이트 이하 문자열 | `embstr` | 하나의 메모리 블록에 할당 |
| 44바이트 초과 | `raw` | 별도 메모리 블록에 할당 |

```
SET age 25
OBJECT ENCODING age  → "int"

SET name "hello"
OBJECT ENCODING name → "embstr"
```

`embstr`은 읽기 전용이라 수정(`APPEND` 등) 시 `raw`로 변환된다.

### 언제 쓰나

- 캐싱 (JSON 직렬화해서 저장)
- 카운터 (`INCR`)
- 토큰 저장
- Rate Limiting 카운터
- 단순 키-값 매핑

---

## 2. List — 순서가 있는 목록

### 구조

삽입 순서가 보장되는 양방향 리스트다.
양쪽 끝에서 `O(1)`로 추가/제거할 수 있다.

```
LPUSH queue "task1"        # 왼쪽에 추가
LPUSH queue "task2"
RPUSH queue "task3"        # 오른쪽에 추가

LRANGE queue 0 -1          → ["task2", "task1", "task3"]

RPOP queue                 → "task3"  (오른쪽에서 제거)
LPOP queue                 → "task2"  (왼쪽에서 제거)
```

### 내부 인코딩

| 조건 | 인코딩 | 설명 |
|--|--|--|
| 원소 수 ≤ 128 AND 각 원소 ≤ 64바이트 | `listpack` | 연속 메모리 블록, 메모리 절약 |
| 위 조건 초과 | `quicklist` | listpack 노드들을 연결 리스트로 연결 |

`quicklist`은 Redis 7.0부터 기본이다. 이전에는 `ziplist` + `linkedlist` 조합이었다.

### 언제 쓰나

- 최근 N개 목록 (최근 알림, 최근 로그)
- 간단한 메시지 큐 (`LPUSH` + `RPOP`)
- 타임라인 (최신 게시글 목록)

```java
// 최근 알림 10개 유지
redisTemplate.opsForList().leftPush("notification:" + userId, message);
redisTemplate.opsForList().trim("notification:" + userId, 0, 9);  // 10개만 유지

// 최근 알림 조회
List<String> recent = redisTemplate.opsForList()
        .range("notification:" + userId, 0, 9);
```

### 주의점

`LINDEX`, `LINSERT`처럼 중간 원소에 접근하는 명령은 `O(N)`이다.
List가 길어지면 중간 접근 성능이 떨어지므로, 항상 양 끝에서만 조작하는 패턴이 좋다.

---

## 3. Hash — 필드-값 쌍의 집합

### 구조

하나의 키 안에 여러 필드-값 쌍을 저장한다.
RDB 테이블의 한 행(row)과 유사하다.

```
HSET user:1 name "김철수" age 25 email "cs@example.com"

HGET user:1 name       → "김철수"
HGETALL user:1         → {name: "김철수", age: "25", email: "cs@example.com"}
HINCRBY user:1 age 1   → 26
```

### 내부 인코딩

| 조건 | 인코딩 | 설명 |
|--|--|--|
| 필드 수 ≤ 128 AND 각 값 ≤ 64바이트 | `listpack` | 연속 메모리, 메모리 효율적 |
| 위 조건 초과 | `hashtable` | 해시 테이블, 조회 O(1) |

작은 Hash는 `listpack`으로 저장되어 String 여러 개보다 메모리를 훨씬 적게 쓴다.

### String 여러 개 vs Hash 하나

```
# 방법 1: String 여러 개
SET user:1:name "김철수"
SET user:1:age "25"
SET user:1:email "cs@example.com"
→ 키 3개, 오버헤드 3배

# 방법 2: Hash 하나
HSET user:1 name "김철수" age 25 email "cs@example.com"
→ 키 1개, 메모리 절약
```

관련된 필드를 함께 관리할 때는 Hash가 메모리 효율과 관리 편의성 모두 좋다.

### 언제 쓰나

- 사용자 프로필, 세션 데이터
- 설정 값 그룹
- 객체를 필드 단위로 부분 조회/수정할 때

```java
// 사용자 세션 저장
Map<String, String> session = Map.of(
    "userId", "1",
    "role", "USER",
    "loginAt", Instant.now().toString()
);
redisTemplate.opsForHash().putAll("session:" + sessionId, session);
redisTemplate.expire("session:" + sessionId, 30, TimeUnit.MINUTES);

// 특정 필드만 조회
String role = (String) redisTemplate.opsForHash()
        .get("session:" + sessionId, "role");
```

### 주의점

Hash 안에 필드가 수천 개 이상이면 `HGETALL`이 느려진다.
많은 필드를 가진 Hash는 `HSCAN`으로 순회하는 게 안전하다.

---

## 4. Set — 중복 없는 집합

### 구조

순서 없이 고유한 값들을 저장한다.
**집합 연산** (교집합, 합집합, 차집합)을 서버 사이드에서 바로 수행할 수 있다.

```
SADD tags:post:1 "java" "spring" "redis"
SADD tags:post:2 "java" "docker" "redis"

SMEMBERS tags:post:1      → {"java", "spring", "redis"}
SISMEMBER tags:post:1 "java"  → 1 (존재)

SINTER tags:post:1 tags:post:2    → {"java", "redis"}  (교집합)
SDIFF tags:post:1 tags:post:2     → {"spring"}          (차집합)
SUNION tags:post:1 tags:post:2    → {"java", "spring", "redis", "docker"}
```

### 내부 인코딩

| 조건 | 인코딩 | 설명 |
|--|--|--|
| 원소 수 ≤ 128 AND 모두 정수 | `intset` | 정렬된 정수 배열, 매우 컴팩트 |
| 원소 수 ≤ 128 AND 문자열 포함 | `listpack` | 연속 메모리 블록 |
| 위 조건 초과 | `hashtable` | 해시 테이블 |

### 언제 쓰나

- 좋아요 누른 사용자 목록 (중복 방지)
- 태그 관리, 관심사 교집합
- 이미 처리한 항목 추적 (중복 실행 방지)

```java
// 좋아요 — 유저 중복 방지
String key = "post:like:" + postId;
redisTemplate.opsForSet().add(key, userId.toString());

// 좋아요 취소
redisTemplate.opsForSet().remove(key, userId.toString());

// 좋아요 수
Long count = redisTemplate.opsForSet().size(key);

// 내가 좋아요 눌렀는지
Boolean liked = redisTemplate.opsForSet().isMember(key, userId.toString());
```

### Sorted Set과의 차이

| | Set | Sorted Set |
|--|--|--|
| 순서 | 없음 | score 기준 정렬 |
| 중복 | 불허 | 불허 |
| 용도 | 존재 여부, 집합 연산 | 랭킹, 범위 조회 |

"이 유저가 좋아요를 눌렀는가?" → **Set**
"좋아요가 가장 많은 게시글 10개는?" → **Sorted Set**

---

## 5. Sorted Set — 점수 기반 정렬 집합

### 구조

Set처럼 중복을 허용하지 않지만, 각 멤버에 **score(점수)**가 붙어서 자동 정렬된다.
1편에서 랭킹 구현에 사용한 자료구조다.

```
ZADD leaderboard 1500 "userA"
ZADD leaderboard 2300 "userB"
ZADD leaderboard 800  "userC"

ZREVRANGE leaderboard 0 2 WITHSCORES
→ [("userB", 2300), ("userA", 1500), ("userC", 800)]

ZRANK leaderboard "userA"     → 1  (오름차순 기준)
ZREVRANK leaderboard "userA"  → 1  (내림차순 기준)
```

### 내부 인코딩

| 조건 | 인코딩 | 설명 |
|--|--|--|
| 원소 수 ≤ 128 AND 각 값 ≤ 64바이트 | `listpack` | 연속 메모리 |
| 위 조건 초과 | `skiplist` + `hashtable` | 범위 조회(skiplist) + 단건 조회(hashtable) |

**skiplist**은 Sorted Set의 핵심이다. 균형 트리(B-Tree)와 비슷한 `O(log N)` 성능을 내지만 구현이 단순하다.

```
Level 3:  1 ─────────────────────── 9
Level 2:  1 ──────── 5 ──────────── 9
Level 1:  1 ── 3 ── 5 ── 7 ── 9
```

각 노드가 여러 레벨의 포인터를 가지고 있어서, 높은 레벨에서 빠르게 건너뛴 뒤 낮은 레벨에서 정확한 위치를 찾는다.

### 언제 쓰나

- 랭킹 (좋아요 수, 점수, 매출 순위)
- 지연 작업 큐 (score를 실행 시각 timestamp로 사용)
- 시계열 데이터 범위 조회

```java
// 지연 작업 큐 — score를 실행 시각으로
long executeAt = System.currentTimeMillis() + 60000;  // 1분 후
redisTemplate.opsForZSet().add("delayed:queue", taskId, executeAt);

// 실행할 시간이 된 작업들 조회
long now = System.currentTimeMillis();
Set<String> readyTasks = redisTemplate.opsForZSet()
        .rangeByScore("delayed:queue", 0, now);
```

---

## 6. Stream — 이벤트 로그와 메시지 큐

### 구조

Redis 5.0에서 추가된 자료구조다.
append-only 로그 형태로, Kafka의 토픽과 비슷한 개념이다.

```
XADD events * action "login" userId "1"
→ "1712649600000-0"  (자동 생성 ID: 타임스탬프-시퀀스)

XADD events * action "purchase" userId "1" amount "50000"
→ "1712649600001-0"

XRANGE events - +     → 전체 조회
XLEN events            → 메시지 수
```

### Consumer Group

여러 소비자가 메시지를 나눠서 처리할 수 있다.
같은 그룹 내 소비자끼리는 메시지를 중복 없이 분배받는다.

```
XGROUP CREATE events mygroup $ MKSTREAM

# 소비자 A가 읽음
XREADGROUP GROUP mygroup consumerA COUNT 1 BLOCK 0 STREAMS events >
→ "login" 이벤트

# 소비자 B가 읽음
XREADGROUP GROUP mygroup consumerB COUNT 1 BLOCK 0 STREAMS events >
→ "purchase" 이벤트  (A가 읽은 건 안 옴)

# 처리 완료 확인
XACK events mygroup "1712649600000-0"
```

### Pub/Sub vs Stream

| | Pub/Sub | Stream |
|--|--|--|
| 메시지 보관 | 안 됨 (발행 즉시 전달) | 보관됨 (나중에 읽기 가능) |
| 소비자 오프라인 | 메시지 유실 | 재접속 후 읽기 가능 |
| Consumer Group | 없음 | 있음 |
| 용도 | 실시간 알림, 브로드캐스트 | 이벤트 로그, 작업 큐 |

Pub/Sub은 "지금 연결된 구독자에게 바로 전달"하는 구조라 메시지가 사라진다.
Stream은 메시지가 남아있어서 신뢰성이 필요한 경우에 적합하다.

### 언제 쓰나

- 이벤트 로그 (사용자 활동 기록)
- 가벼운 메시지 큐 (Kafka까지 필요 없을 때)
- 서비스 간 비동기 통신

```java
// 이벤트 발행
Map<String, String> event = Map.of(
    "action", "purchase",
    "userId", userId.toString(),
    "amount", amount.toString()
);
redisTemplate.opsForStream().add("events", event);

// 이벤트 소비 (Spring의 StreamListener)
@Bean
public Subscription subscription(RedisConnectionFactory factory) {
    var options = StreamMessageListenerContainer.StreamMessageListenerContainerOptions
            .builder()
            .pollTimeout(Duration.ofSeconds(1))
            .build();

    var container = StreamMessageListenerContainer.create(factory, options);

    var subscription = container.receiveAutoAck(
            Consumer.from("mygroup", "consumer1"),
            StreamOffset.create("events", ReadOffset.lastConsumed()),
            message -> {
                // 메시지 처리
                Map<String, String> body = message.getValue();
                log.info("action={}, userId={}", body.get("action"), body.get("userId"));
            }
    );

    container.start();
    return subscription;
}
```

---

## 7. 특수 자료구조

자주 쓰이지는 않지만, 특정 문제를 매우 효율적으로 푸는 자료구조들이다.

### HyperLogLog — 고유 개수 추정

정확한 카운트가 아닌 **추정치**를 구한다. 오차율 약 0.81%.
핵심은 메모리다. 원소가 몇 억 개든 **최대 12KB**만 사용한다.

```
PFADD visitors:2024-04-09 "user1" "user2" "user3" "user1"
PFCOUNT visitors:2024-04-09  → 3 (중복 제거된 추정치)
```

| 방법 | 1억 개 유니크 사용자 메모리 |
|--|--|
| Set | ~수 GB |
| HyperLogLog | 12 KB |

**용도**: 일별 방문자 수(UV), 유니크 검색어 수 등 정확도보다 메모리 효율이 중요한 경우.

### Bitmap — 비트 단위 플래그

String 위에 비트 연산을 수행한다. 유저별 출석 체크 같은 ON/OFF 상태 관리에 적합하다.

```
SETBIT attendance:2024-04-09 1001 1   # userId 1001 출석
SETBIT attendance:2024-04-09 1002 1   # userId 1002 출석

GETBIT attendance:2024-04-09 1001     → 1 (출석)
GETBIT attendance:2024-04-09 1003     → 0 (미출석)

BITCOUNT attendance:2024-04-09        → 2 (출석 인원)
```

100만 유저의 출석 여부를 **125KB**로 관리할 수 있다 (1,000,000 bits ÷ 8 = 125KB).

### GEO — 위치 기반 검색

내부적으로 Sorted Set을 사용한다. 좌표를 Geohash로 변환해서 score에 저장한다.

```
GEOADD stores 126.9780 37.5665 "서울시청"
GEOADD stores 127.0276 37.4979 "강남역"

GEODIST stores "서울시청" "강남역" km   → "8.3"

# 서울시청 기준 반경 5km 내 매장
GEOSEARCH stores FROMMEMBER "서울시청" BYRADIUS 5 km ASC
```

**용도**: 근처 매장 찾기, 배달 가능 지역 판단, 위치 기반 추천.

---

## 자료구조 선택 가이드

| 문제 | 자료구조 | 이유 |
|--|--|--|
| 단일 값 저장/조회 | String | 가장 단순하고 범용적 |
| 객체의 필드별 접근 | Hash | 부분 조회/수정 가능, 메모리 효율 |
| 최근 N개 목록 | List | 양 끝 O(1) 조작, LTRIM으로 크기 제한 |
| 중복 검사, 집합 연산 | Set | SISMEMBER O(1), 교집합/차집합 지원 |
| 점수 기반 정렬/랭킹 | Sorted Set | 자동 정렬, 범위 조회 O(log N) |
| 이벤트 로그, 메시지 큐 | Stream | 영속적 메시지, Consumer Group |
| 대량 유니크 카운트 | HyperLogLog | 12KB로 수억 개 추정 |
| ON/OFF 플래그 | Bitmap | 비트 단위 저장, 극한의 메모리 효율 |
| 위치 기반 검색 | GEO | 반경 검색, 거리 계산 내장 |

### 판단 순서

```
1. 단일 값인가?                    → String
2. 필드 여러 개를 묶어야 하나?      → Hash
3. 순서가 중요한가?
   ├─ 점수 기반 정렬?              → Sorted Set
   └─ 삽입 순서?                   → List
4. 중복 없는 집합인가?             → Set
5. 이벤트 스트리밍/메시지 큐?       → Stream
6. 유니크 카운트 (근사치 허용)?     → HyperLogLog
7. ON/OFF 상태 대량 관리?          → Bitmap
8. 위치 기반?                      → GEO
```

---

## OBJECT ENCODING으로 확인하기

자료구조를 선택한 뒤, 실제로 어떤 인코딩이 적용되었는지 확인할 수 있다.

```
SET counter 100
OBJECT ENCODING counter  → "int"

HSET user:1 name "test"
OBJECT ENCODING user:1   → "listpack"

ZADD ranking 100 "a"
OBJECT ENCODING ranking  → "listpack"
```

데이터가 커지면 인코딩이 자동으로 전환된다. `listpack` → `hashtable`/`skiplist` 전환 시점을 알면 메모리 사용량 변화를 예측할 수 있다.

전환 기준은 `redis.conf`에서 조정 가능하다.

```
hash-max-listpack-entries 128    # 필드 수 기준
hash-max-listpack-value 64       # 값 크기 기준 (바이트)
zset-max-listpack-entries 128
zset-max-listpack-value 64
```

---

## 정리

Redis가 단순한 키-값 저장소가 아닌 이유는 **자료구조 때문**이다.

문제에 맞는 자료구조를 선택하면 애플리케이션 코드가 단순해지고, 네트워크 왕복도 줄어든다.
"데이터를 꺼내서 가공"하는 대신 "Redis가 알아서 정렬/카운트/검색"하도록 설계하는 것이 핵심이다.

다음 글에서는 이 자료구조들을 활용한 **캐시 전략** (Cache-Aside, Write-Through, 캐시 스탬피드 등)을 다룬다.
