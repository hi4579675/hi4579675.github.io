---
title: "리액션 카운트의 동시성 문제, 어떻게 풀까?"
date: 2026-04-07
tags:
  - Spring Boot
  - 동시성
  - JPA
excerpt: KKiri 프로젝트의 이모지 리액션 시스템을 구현하면서 마주친 동시성 문제와, 세 가지 해결 전략(비관적 락, 낙관적 락, 비동기 순차 처리)을 비교한 내용을 정리한다.
category: architecture
---

> KKiri 프로젝트의 이모지 리액션 시스템을 구현하면서 마주친 동시성 문제와,
> 세 가지 해결 전략(비관적 락, 낙관적 락, 비동기 순차 처리)을 비교한 내용을 정리한다.

---

## 리액션 시스템 스펙

KKiri는 게시글에 이모지로 반응할 수 있는 기능을 제공한다.

- 지원 이모지: `❤️` `😂` `😮` `😢` `🔥` `✅` `👍`
- 같은 이모지는 유저당 1개만 허용 (중복 불가)
- 다른 이모지는 동시에 여러 개 가능 (`👍`도 하고 `❤️`도 할 수 있음)
- 응답 예시: `👍 12` / `❤️ 5` / `😂 3` — 이모지 타입별 개별 카운팅

중복을 막기 위해 테이블에 유니크 제약을 걸었다.

```java
@Table(
    name = "reactions",
    uniqueConstraints = @UniqueConstraint(
        columnNames = {"post_id", "user_id", "emoji_type"}
    )
)
public class Reaction { ... }
```

`(post_id, user_id, emoji_type)` 조합이 유일하므로, 같은 유저가 같은 이모지를 두 번 누르는 건 DB 레벨에서 차단된다.

---

## 현재 구현: 즉석 집계

처음에는 별도의 카운트 테이블 없이, 조회 시점에 `reactions` 테이블에서 직접 집계했다.

```java
// ReactionService.java
public List<ReactionSummaryResponse> getReactions(Long userId, Long postId) {
    List<Reaction> allReactions = reactionRepository.findByPostId(postId);

    Map<String, Long> counts = allReactions.stream()
        .collect(Collectors.groupingBy(Reaction::getEmojiType, Collectors.counting()));

    Set<String> myEmojiTypes = reactionRepository
        .findByPostIdAndUserId(postId, userId)
        .stream()
        .map(Reaction::getEmojiType)
        .collect(Collectors.toSet());

    return counts.entrySet().stream()
        .map(e -> new ReactionSummaryResponse(e.getKey(), e.getValue(), myEmojiTypes.contains(e.getKey())))
        .toList();
}
```

이 방식은 동시성 문제가 없다. 카운트를 "저장"하지 않으므로 수정 충돌 자체가 발생하지 않는다.

하지만 트래픽이 늘수록 매 조회마다 전체 `reactions`를 풀스캔하는 비용이 커진다.
카운트를 별도로 저장해두고 빠르게 읽는 구조가 필요해진다.

---

## 카운트 테이블을 도입하면 생기는 문제

`reaction_counts` 테이블을 만들어 `(post_id, emoji_type)` 단위로 카운트를 저장한다고 하자.

```sql
CREATE TABLE reaction_counts (
    id         BIGINT PRIMARY KEY AUTO_INCREMENT,
    post_id    BIGINT      NOT NULL,
    emoji_type VARCHAR(10) NOT NULL,
    count      BIGINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uq_post_emoji (post_id, emoji_type)
);
```

리액션 추가 흐름은 다음과 같다.

1. `reactions` 테이블에 INSERT
2. `reaction_counts` 테이블의 count + 1

여기서 문제가 생긴다. 서로 다른 두 유저가 동시에 👍를 누르는 상황을 생각해보자.

```
초기 상태: count = 1

트랜잭션 A        데이터베이스        트랜잭션 B

SELECT count      ──────────────▶
◀──────────────   count = 1
                                    SELECT count      ──────────────▶
                                    ◀──────────────   count = 1

UPDATE count = 2  ──────────────▶
                  count = 2
COMMIT

                                    UPDATE count = 2  ──────────────▶
                                    COMMIT
                  count = 2  ← 2개 요청이 왔지만 count는 여전히 2
```

2개의 요청이 정상적으로 처리됐지만 카운트는 1만 증가했다.

트랜잭션을 쓴다고 해서 이 문제가 해결되지 않는다.
트랜잭션은 **원자적 실행**을 보장하지, **직렬 실행**을 보장하지 않기 때문이다.

---

## 해결 전략 세 가지

### 1. 비관적 락 (Pessimistic Lock)

> "충돌이 발생할 것을 가정하고, 미리 레코드를 잠근다."

트랜잭션이 시작될 때 `SELECT ... FOR UPDATE`로 해당 레코드에 배타 락을 건다.
다른 트랜잭션은 락이 해제될 때까지 대기한다.

#### PESSIMISTIC_READ vs PESSIMISTIC_WRITE

JPA의 비관적 락에는 두 종류가 있다.

| | PESSIMISTIC_READ | PESSIMISTIC_WRITE |
|--|--|--|
| 실제 SQL | `SELECT ... LOCK IN SHARE MODE` | `SELECT ... FOR UPDATE` |
| 다른 트랜잭션 읽기 | 가능 | 불가 (블로킹) |
| 다른 트랜잭션 쓰기 | 불가 (블로킹) | 불가 (블로킹) |
| 용도 | 읽는 동안 수정 방지 | 수정할 것을 보장 |

카운터를 증가시키는 목적이므로 반드시 `PESSIMISTIC_WRITE`를 써야 한다.
`PESSIMISTIC_READ`를 쓰면 두 트랜잭션이 동시에 공유 락을 잡고 서로 업데이트를 기다리는 **데드락**이 발생할 수 있다.

#### 구현 코드

```java
// ReactionCountRepository.java
public interface ReactionCountRepository extends JpaRepository<ReactionCount, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "3000"))
    @Query("SELECT rc FROM ReactionCount rc WHERE rc.postId = :postId AND rc.emojiType = :emojiType")
    Optional<ReactionCount> findByPostIdAndEmojiTypeWithLock(Long postId, String emojiType);
}
```

`@QueryHint`로 락 타임아웃을 설정해두는 게 좋다.
락 대기 중 서버 장애가 나거나 처리가 지연되면 다른 요청들이 무한정 대기할 수 있기 때문이다.
3000ms 이상 기다려도 락을 못 얻으면 예외를 던지도록 한다.

```java
// ReactionService.java
@Transactional
public void addReaction(Long userId, Long postId, String emojiType) {
    // reactions 테이블 처리 (유니크 제약으로 중복 방지)

    ReactionCount reactionCount = reactionCountRepository
        .findByPostIdAndEmojiTypeWithLock(postId, emojiType)
        .orElseGet(() -> ReactionCount.of(postId, emojiType));

    reactionCount.increment();
    reactionCountRepository.save(reactionCount);
}
```

#### 실제 실행 흐름

```
트랜잭션 A        데이터베이스        트랜잭션 B

SELECT FOR UPDATE ──────────────▶
◀──────────────   count = 1, 락 보유
                                    SELECT FOR UPDATE  (블로킹 - 대기)
count = 2 갱신
COMMIT, 락 해제   count = 2

                                    락 획득
                                    ◀──────────────   count = 2
                                    count = 3 갱신
                                    COMMIT
                  count = 3 ✅
```

#### 주의: 레코드가 없을 때 문제

`orElseGet(() -> ReactionCount.of(postId, emojiType))`은 카운트 레코드가 없을 때 새로 만드는 코드다.

문제는 `SELECT ... FOR UPDATE`는 **존재하는 레코드에만 락을 걸 수 있다**는 점이다.
레코드가 없으면 락 없이 둘 다 통과하고, 둘 다 INSERT를 시도하다가 유니크 제약 위반이 발생한다.

```
트랜잭션 A        데이터베이스        트랜잭션 B

SELECT FOR UPDATE → 없음 (락 없이 통과)
                                    SELECT FOR UPDATE → 없음 (락 없이 통과)
INSERT count=1    ──────────────▶   INSERT count=1    ──────────────▶
                  ← 성공               ← 유니크 제약 위반!
```

이를 방지하는 가장 간단한 방법은 **게시글 생성 시 모든 이모지 타입의 카운트 레코드를 미리 0으로 초기화**하는 것이다.

```java
// 게시글 생성 시
public void createPost(...) {
    Post post = postRepository.save(Post.of(...));

    // 모든 이모지 타입 카운트 레코드 미리 생성
    List<ReactionCount> initialCounts = EmojiType.values().stream()
            .map(emoji -> ReactionCount.of(post.getId(), emoji.name(), 0L))
            .toList();
    reactionCountRepository.saveAll(initialCounts);
}
```

이렇게 하면 `SELECT ... FOR UPDATE` 시점에 항상 레코드가 존재하므로 락이 정상적으로 동작한다.

**장점:** 구현이 단순하다. 충돌이 나도 재시도 로직 없이 DB가 알아서 직렬화한다.

**단점:** 락을 보유하는 동안 다른 요청이 블로킹된다. 트래픽이 몰리면 대기 큐가 쌓인다.

---

#### 참고: DB 단에서 원자적으로 처리하는 방법

비관적 락 없이 `UPDATE` 한 줄로도 동시성을 해결할 수 있다.

```sql
UPDATE reaction_counts
SET count = count + 1
WHERE post_id = ? AND emoji_type = ?
```

DB가 `count = count + 1`을 원자적으로 처리해주기 때문에 SELECT → UPDATE 두 단계 없이도 경합이 발생하지 않는다.

JPA에서는 `@Modifying` + `@Query`로 쓸 수 있다.

```java
@Modifying
@Query("UPDATE ReactionCount rc SET rc.count = rc.count + 1 " +
       "WHERE rc.postId = :postId AND rc.emojiType = :emojiType")
int incrementCount(Long postId, String emojiType);
```

단, 이 방식은 JPA의 1차 캐시(영속성 컨텍스트)를 우회하는 벌크 연산이라 같은 트랜잭션 내에서 엔티티를 다시 조회해야 최신 값을 볼 수 있다.
또한 레코드가 없으면 갱신 행이 0이 되어 무시되므로, 역시 레코드 사전 초기화가 필요하다.

---

### 2. 낙관적 락 (Optimistic Lock)

> "충돌이 드물 것을 가정하고, 커밋 시점에 충돌을 감지한다."

레코드에 `version` 컬럼을 추가한다. 업데이트 시 `WHERE version = 읽었던_버전`을 조건으로 걸어,
그 사이 다른 트랜잭션이 수정했다면 갱신 행이 0이 되어 충돌을 감지한다.

#### 구현 코드

```java
// ReactionCount.java
@Entity
public class ReactionCount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long postId;
    private String emojiType;
    private long count;

    @Version
    private Long version;  // JPA가 자동으로 version 조건 추가
}
```

`@Version`을 선언하면 JPA가 UPDATE 시 자동으로 version 조건을 추가한다.

```sql
-- JPA가 실제로 실행하는 SQL
UPDATE reaction_counts
SET count = ?, version = 2      -- version을 자동으로 +1
WHERE id = ? AND version = 1    -- 읽었던 version을 조건으로
```

갱신된 행이 0이면 JPA는 `OptimisticLockException`을 던진다.

#### 실제 실행 흐름

```
트랜잭션 A        데이터베이스        트랜잭션 B

SELECT            ──────────────▶
◀──────────────   count=1, version=1
                                    SELECT            ──────────────▶
                                    ◀──────────────   count=1, version=1

UPDATE WHERE      ──────────────▶
version=1
◀──────────────   count=2, version=2 (성공)
COMMIT

                                    UPDATE WHERE version=1 ──────────▶
                                    ◀──────────────   갱신 0건
                                    → OptimisticLockException
                                    rollback
```

#### 예외 계층 구조

Spring Data JPA는 `OptimisticLockException`을 `ObjectOptimisticLockingFailureException`으로 변환해서 던진다.

```
jakarta.persistence.OptimisticLockException          (JPA 표준)
    ↓ Spring이 변환
org.springframework.orm.ObjectOptimisticLockingFailureException
    ↑ spring-retry의 @Retryable에서 잡을 타입
```

`@Retryable`을 쓸 때 어떤 예외를 잡을지 명확히 지정해야 한다.

#### 재시도 구현 — @Transactional과 함께 쓸 때 주의점

`@Retryable`과 `@Transactional`을 **같은 메서드에 동시에** 선언하면 AOP 적용 순서 문제가 생긴다.

```java
// ❌ 잘못된 방식
@Retryable(retryFor = ObjectOptimisticLockingFailureException.class, maxAttempts = 3)
@Transactional  // @Transactional이 @Retryable 안쪽에서 동작하면 재시도가 의미 없을 수 있음
public void addReaction(Long userId, Long postId, String emojiType) {
    // ...
}
```

`@Retryable`이 재시도를 하려면 트랜잭션이 완전히 롤백된 후 새 트랜잭션으로 다시 시작해야 한다.
두 어노테이션이 같은 메서드에 있으면 이 순서가 보장되지 않을 수 있다.

```java
// ✅ 올바른 방식 — 메서드 분리
@Service
@RequiredArgsConstructor
public class ReactionFacade {

    private final ReactionService reactionService;

    // @Retryable은 트랜잭션 바깥에서 동작 (트랜잭션 없음)
    @Retryable(
        retryFor = ObjectOptimisticLockingFailureException.class,
        maxAttempts = 3,
        backoff = @Backoff(delay = 50)
    )
    public void addReactionWithRetry(Long userId, Long postId, String emojiType) {
        reactionService.addReaction(userId, postId, emojiType);  // @Transactional 메서드 호출
    }
    // 재시도 3회 모두 실패 시 @Recover로 처리하거나 예외 전파
}

@Service
public class ReactionService {

    @Transactional  // 트랜잭션은 여기서만
    public void addReaction(Long userId, Long postId, String emojiType) {
        // ...
    }
}
```

이렇게 분리하면 `addReaction()`이 예외를 던지고 트랜잭션이 롤백된 후,
`addReactionWithRetry()`가 새 트랜잭션으로 다시 호출한다.

**장점:** 락을 잡지 않으므로 읽기 성능에 영향을 주지 않는다. 충돌이 드문 상황에서 유리하다.

**단점:** 충돌 발생 시 재시도 로직을 직접 구현해야 한다. 충돌이 잦은 환경에서는 재시도 비용이 오히려 커진다.

---

### 3. 비동기 순차 처리

> "즉시 처리하지 않고, 대기열에 쌓아 순차적으로 처리한다."

요청을 큐(Kafka, Redis Queue 등)에 넣고, 게시글별로 단일 스레드가 순차적으로 처리한다.
게시글 단위로 직렬화되므로 동시성 문제 자체가 사라진다.

```
요청 A ──┐
요청 B ──┼──▶  [Queue]  ──▶  단일 스레드  ──▶  A 처리 → B 처리 → C 처리
요청 C ──┘                   (게시글별)
```

**장점:** 락으로 인한 블로킹이 없다. 대용량 트래픽에서 처리량이 가장 높다.

**단점:**
- 비동기 처리 인프라(Kafka 등) 구축 비용이 크다
- 즉시 결과를 응답할 수 없으므로, 클라이언트 측에서 낙관적 UI 업데이트 등 추가 처리가 필요하다
- 대기열의 exactly-once 처리 보장이 어렵다

---

## KKiri에서 선택한 방법

KKiri는 소규모 친구 그룹 앱이다. 게시글 하나에 수십 명이 동시에 리액션을 누르는 상황은 현실적으로 거의 발생하지 않는다.

| | 비관적 락 | 낙관적 락 | 비동기 순차 처리 |
|--|--|--|--|
| 구현 복잡도 | 낮음 | 중간 (재시도 로직) | 높음 (인프라 필요) |
| 충돌 처리 | DB가 직렬화 | 앱에서 재시도/실패 | 구조적으로 없음 |
| 블로킹 | 있음 | 없음 | 없음 |
| KKiri 트래픽에서 | 락 경합 거의 없음 | 충돌 거의 없음 | 과도한 비용 |

비동기 순차 처리는 구축 비용 대비 KKiri의 트래픽 규모에서 얻는 이득이 없으므로 제외했다.

비관적 락 vs 낙관적 락에서는 **비관적 락**을 선택했다.

- KKiri의 트래픽 특성상 단일 레코드에 대한 락 경합이 거의 없을 것으로 판단했다.
- 낙관적 락은 충돌이 잦은 환경에서 재시도 비용을 줄이는 게 목적인데, 충돌이 드문 환경에서 재시도 로직까지 구현하는 건 불필요한 복잡도다.
- 비관적 락으로 구현이 단순하고, 데이터 일관성 보장도 명확하다.

트래픽이 유의미하게 높아지는 시점이 온다면 낙관적 락이나 Redis의 `INCR`(atomic increment)으로 전환을 고려할 것이다.

---

## 마치며

트랜잭션을 쓴다고 동시성 문제가 해결되지는 않는다.
트랜잭션은 **원자성(Atomicity)**을 보장하지, **직렬성(Serializability)**을 보장하지 않기 때문이다.

동시 쓰기가 발생하는 카운트 관리에서는 반드시 별도의 동시성 제어 전략이 필요하다.
그리고 그 전략은 "가장 강력한 것"이 아니라, 서비스의 트래픽 특성과 구현 비용을 고려한 선택이어야 한다.
