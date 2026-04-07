---
title: "Redis, 어디에 쓰이나"
date: 2026-04-07
tags:
  - Redis
  - Spring Boot
  - 캐싱
excerpt: 캐싱, 토큰 저장, 카운터, 랭킹, 분산 락, Rate Limiting까지 — Redis가 어떤 문제를 해결하는지 사용 사례 중심으로 정리한다.
category: architecture
---

> 캐싱, 토큰 저장, 카운터, 랭킹, 분산 락, Rate Limiting까지 —
> Redis가 어떤 문제를 해결하는지 사용 사례 중심으로 정리한다.

---

## Redis가 뭔지, 왜 쓰는가

Redis는 **인메모리 키-값 저장소**다. 데이터를 디스크가 아닌 메모리에 저장하기 때문에 읽기/쓰기 속도가 압도적으로 빠르다.

```
MySQL (디스크 기반)  →  수 ms ~ 수십 ms
Redis (메모리 기반)  →  수십 μs (마이크로초)
```

### 왜 빠른가

두 가지 이유다.

**1. 메모리 기반**
디스크 I/O가 없다. 메모리 접근 속도는 디스크보다 수천 배 빠르다.

**2. 단일 스레드로 명령 처리**
Redis는 명령을 단일 스레드로 순서대로 처리한다. 멀티스레드 환경에서 발생하는 락 경합이 없고, 모든 명령이 원자적으로 실행된다.

```
클라이언트 A  ─┐
클라이언트 B  ─┼──▶  [이벤트 루프]  ──▶  A 처리 → B 처리 → C 처리 (순서 보장)
클라이언트 C  ─┘
```

이 특성이 INCR 같은 카운터 연산에서 동시성 문제 없이 안전하게 동작할 수 있는 이유다.

### 영속성은?

메모리 기반이라 서버가 꺼지면 데이터가 사라진다는 걱정을 할 수 있다.
Redis는 두 가지 영속성 옵션을 제공한다.

- **RDB (Snapshot)**: 주기적으로 메모리 전체를 디스크에 스냅샷으로 저장
- **AOF (Append Only File)**: 모든 쓰기 명령을 로그로 기록

단, Redis를 캐시 용도로만 쓸 때는 영속성 옵션 없이 쓰는 경우도 많다. 어차피 원본 데이터는 DB에 있으니까.

### Spring에서 Redis 연결

```gradle
// build.gradle
implementation 'org.springframework.boot:spring-boot-starter-data-redis'
```

```yaml
# application.yml
spring:
  data:
    redis:
      host: localhost
      port: 6379
```

기본적으로 `StringRedisTemplate` (문자열 전용) 또는 `RedisTemplate<String, Object>` (직렬화 설정 포함)을 주입받아 사용한다.

---

## 1. 캐싱 — DB 부하 줄이기

### 왜 캐싱을 쓰나

자주 조회되고 잘 바뀌지 않는 데이터를 매번 DB에서 가져오면 불필요한 쿼리가 반복된다.
Redis에 결과를 저장해두고 같은 요청이 오면 DB 대신 Redis에서 바로 반환한다.

```
캐시 히트: 요청 → Redis → 응답  (DB 조회 없음)
캐시 미스: 요청 → Redis (없음) → DB → Redis 저장 → 응답
```

### Spring @Cacheable 설정

```gradle
implementation 'org.springframework.boot:spring-boot-starter-cache'
```

```java
// CacheConfig.java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(10))  // 기본 TTL 10분
                .serializeValuesWith(
                    RedisSerializationContext.SerializationPair.fromSerializer(
                        new GenericJackson2JsonRedisSerializer()
                    )
                );

        return RedisCacheManager.builder(connectionFactory)
                .cacheDefaults(config)
                .build();
    }
}
```

### 사용 예시

```java
// PostService.java
@Cacheable(value = "posts", key = "#postId")
public PostResponse getPost(Long postId) {
    // 캐시에 없을 때만 실행됨
    return postRepository.findById(postId)
            .map(PostResponse::from)
            .orElseThrow(() -> new CustomException(ErrorCode.POST_NOT_FOUND));
}

@CacheEvict(value = "posts", key = "#postId")
public void updatePost(Long postId, UpdatePostRequest request) {
    // 업데이트 후 캐시 삭제 → 다음 조회 시 DB에서 새로 가져옴
    Post post = postRepository.findById(postId)
            .orElseThrow(() -> new CustomException(ErrorCode.POST_NOT_FOUND));
    post.update(request);
}

@CachePut(value = "posts", key = "#postId")
public PostResponse refreshCache(Long postId) {
    // 항상 DB에서 가져오고, 결과를 캐시에 덮어씀
    return postRepository.findById(postId)
            .map(PostResponse::from)
            .orElseThrow();
}
```

| 어노테이션 | 동작 |
|--|--|
| `@Cacheable` | 캐시 있으면 반환, 없으면 메서드 실행 후 저장 |
| `@CacheEvict` | 캐시 삭제 |
| `@CachePut` | 항상 메서드 실행, 결과를 캐시에 저장/갱신 |

### 주의할 점 — 캐시 무효화

캐시의 가장 어려운 문제는 "언제 지울 것인가"다.

DB 데이터가 바뀌었는데 캐시가 남아있으면 **오래된 데이터(Stale Data)**를 반환하게 된다.
`@CacheEvict`를 업데이트/삭제 로직에 반드시 추가해야 한다.

그래서 **TTL(만료 시간)을 항상 설정**하는 게 중요하다. 최악의 경우에도 TTL이 지나면 자동으로 갱신되니까.

---

## 2. 토큰 저장 / 블랙리스트 — JWT 인증

JWT 인증 구현 시 Redis를 두 가지 용도로 쓴다.

### Refresh Token 저장

로그인 시 발급한 Refresh Token을 Redis에 저장한다.

```
key:   "refresh:{userId}"
value: "eyJhbGci..."  (Refresh Token)
TTL:   7일
```

재발급 요청이 오면 Redis에 저장된 값과 비교해서 탈취 여부를 감지한다.
로그아웃 시 `DEL`로 삭제하면 Refresh Token이 무효화된다.

```java
// 로그인 시
redisTemplate.opsForValue().set(
    "refresh:" + userId,
    refreshToken,
    7, TimeUnit.DAYS
);

// 재발급 시 비교
String stored = redisTemplate.opsForValue().get("refresh:" + userId);
if (!stored.equals(requestRefreshToken)) {
    throw new CustomException(ErrorCode.TOKEN_INVALID);
}

// 로그아웃 시
redisTemplate.delete("refresh:" + userId);
```

### Access Token 블랙리스트

JWT는 서버가 상태를 갖지 않아서, 로그아웃해도 Access Token 자체는 만료 전까지 유효하다.
로그아웃한 토큰을 블랙리스트에 올려서 사용을 차단한다.

```
key:   "blacklist:{accessToken}"
value: "logout"
TTL:   Access Token 남은 만료 시간
```

```java
// 로그아웃 시
long remainingMs = jwtProvider.getExpiration(accessToken) - System.currentTimeMillis();
redisTemplate.opsForValue().set(
    "blacklist:" + accessToken,
    "logout",
    remainingMs, TimeUnit.MILLISECONDS
);

// JwtAuthenticationFilter에서 매 요청마다 체크
Boolean isBlacklisted = redisTemplate.hasKey("blacklist:" + token);
if (Boolean.TRUE.equals(isBlacklisted)) {
    throw new CustomException(ErrorCode.TOKEN_INVALID);
}
```

TTL을 Access Token 남은 만료 시간으로 설정하는 게 중요하다.
토큰이 만료되면 어차피 검증 실패하니 블랙리스트에 남겨둘 필요가 없다.
Redis 메모리를 불필요하게 잡아먹지 않도록.

---

## 3. 카운터 — 조회수, 좋아요 수

### 왜 Redis로 카운터를 관리하나

DB에서 `UPDATE count = count + 1`을 매 요청마다 날리면 쓰기 부하가 커진다.
Redis의 `INCR` 명령은 단일 원자 명령으로 카운터를 증가시켜 동시성 문제도 없고 빠르다.

```
INCR post:view:123   → 1
INCR post:view:123   → 2
INCR post:view:123   → 3
```

### Spring 코드

```java
// 조회수 증가
public Long incrementViewCount(Long postId) {
    return redisTemplate.opsForValue().increment("post:view:" + postId);
}

// 조회수 조회
public Long getViewCount(Long postId) {
    String value = redisTemplate.opsForValue().get("post:view:" + postId);
    return value != null ? Long.parseLong(value) : 0L;
}
```

### Write-Behind 패턴

Redis에서 카운터를 관리하고, DB는 주기적으로 동기화하는 패턴이다.
매 요청마다 DB를 치지 않으므로 부하가 크게 줄어든다.

```java
// 매 요청: Redis에만 반영 (빠름)
redisTemplate.opsForValue().increment("post:view:" + postId);

// 스케줄러: 주기적으로 DB에 반영
@Scheduled(fixedDelay = 60000)  // 1분마다
public void syncViewCountsToDB() {
    Set<String> keys = redisTemplate.keys("post:view:*");
    for (String key : keys) {
        Long postId = Long.parseLong(key.replace("post:view:", ""));
        Long count = Long.parseLong(redisTemplate.opsForValue().get(key));
        postRepository.updateViewCount(postId, count);
    }
}
```

단점: Redis 장애 시 DB에 반영되지 않은 카운트가 유실될 수 있다.
카운트 정확도가 중요한 서비스(결제, 재고)에서는 쓰지 않는다.
조회수처럼 약간의 오차가 허용되는 경우에 적합하다.

---

## 4. 랭킹 — Sorted Set

### Sorted Set이란

Redis의 Sorted Set은 `(score, member)` 쌍으로 데이터를 저장한다.
score 기준으로 자동 정렬되며, 랭킹 조회에 최적화되어 있다.

```
ZADD ranking 1500 "userA"
ZADD ranking 2300 "userB"
ZADD ranking 800  "userC"

→ 자동 정렬: userC(800) < userA(1500) < userB(2300)
```

### 주요 명령어

| 명령어 | 설명 |
|--|--|
| `ZADD key score member` | 추가/갱신 |
| `ZINCRBY key increment member` | score 증가 |
| `ZREVRANK key member` | 높은 score 기준 순위 (0부터 시작) |
| `ZREVRANGE key 0 9` | 상위 10개 조회 (내림차순) |
| `ZSCORE key member` | 특정 멤버 score 조회 |

### 게시글 좋아요 랭킹 예시

```java
private static final String RANKING_KEY = "post:ranking";

// 좋아요 누를 때 score 증가
public void likePost(Long postId) {
    redisTemplate.opsForZSet().incrementScore(RANKING_KEY, postId.toString(), 1);
}

// 좋아요 취소 시 score 감소
public void unlikePost(Long postId) {
    redisTemplate.opsForZSet().incrementScore(RANKING_KEY, postId.toString(), -1);
}

// 상위 10개 게시글 조회
public List<Long> getTopPosts() {
    Set<String> result = redisTemplate.opsForZSet()
            .reverseRange(RANKING_KEY, 0, 9);  // 0~9 = 상위 10개
    return result.stream()
            .map(Long::parseLong)
            .toList();
}

// 특정 게시글 순위 조회 (1위부터 시작하도록 +1)
public Long getPostRank(Long postId) {
    Long rank = redisTemplate.opsForZSet()
            .reverseRank(RANKING_KEY, postId.toString());
    return rank != null ? rank + 1 : null;
}
```

### 왜 DB로 랭킹을 구현하기 어려운가

```sql
-- 매 조회마다 전체 정렬
SELECT post_id, COUNT(*) as like_count
FROM likes
GROUP BY post_id
ORDER BY like_count DESC
LIMIT 10;
```

데이터가 많아질수록 이 쿼리는 점점 느려진다.
Sorted Set은 데이터 추가 시 자동으로 정렬 상태를 유지하므로, 조회는 항상 `O(log N)`이다.

---

## 5. 분산 락 — Redisson

### 왜 분산 락이 필요한가

DB의 비관적 락은 DB 트랜잭션 안에서만 동작한다.
트랜잭션 밖에서 동시성을 제어해야 하는 경우, 또는 외부 API 호출처럼 DB와 무관한 작업에서 중복 실행을 막아야 할 때 분산 락이 필요하다.

예시:
- 선착순 쿠폰 발급 (발급 수량 초과 방지)
- 외부 결제 API 중복 호출 방지
- 특정 유저의 요청을 한 번에 하나만 처리

### SETNX 원리

분산 락의 원리는 `SETNX` (SET if Not eXists) 명령이다.

```
SETNX lock:coupon:123 "locked"  → 1 (락 획득 성공)
SETNX lock:coupon:123 "locked"  → 0 (이미 존재 → 락 획득 실패)
```

락을 획득한 프로세스만 작업을 수행하고, 완료 후 `DEL`로 락을 해제한다.

다만 직접 구현하면 락 해제 실패(서버 크래시) 시 데드락이 발생할 수 있어서, 실무에서는 **Redisson** 라이브러리를 쓴다.

### Redisson 설정

```gradle
implementation 'org.redisson:redisson-spring-boot-starter:3.27.2'
```

```yaml
# application.yml
spring:
  data:
    redis:
      host: localhost
      port: 6379
```

```java
// RedissonConfig.java
@Configuration
public class RedissonConfig {

    @Value("${spring.data.redis.host}")
    private String host;

    @Value("${spring.data.redis.port}")
    private int port;

    @Bean
    public RedissonClient redissonClient() {
        Config config = new Config();
        config.useSingleServer()
              .setAddress("redis://" + host + ":" + port);
        return Redisson.create(config);
    }
}
```

### 선착순 쿠폰 발급 예시

```java
@Service
@RequiredArgsConstructor
public class CouponService {

    private final RedissonClient redissonClient;
    private final CouponRepository couponRepository;

    public void issueCoupon(Long userId, Long couponId) {
        RLock lock = redissonClient.getLock("lock:coupon:" + couponId);

        boolean acquired = false;
        try {
            // 최대 3초 대기, 락 점유 시간 최대 5초
            acquired = lock.tryLock(3, 5, TimeUnit.SECONDS);
            if (!acquired) {
                throw new CustomException(ErrorCode.COUPON_LOCK_FAIL);
            }

            // 락 획득 후 수량 확인 및 발급
            Coupon coupon = couponRepository.findById(couponId)
                    .orElseThrow(() -> new CustomException(ErrorCode.COUPON_NOT_FOUND));

            if (coupon.isExhausted()) {
                throw new CustomException(ErrorCode.COUPON_EXHAUSTED);
            }

            coupon.issue(userId);
            couponRepository.save(coupon);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            if (acquired && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

`tryLock(waitTime, leaseTime, unit)`:
- `waitTime`: 락 획득을 기다리는 최대 시간
- `leaseTime`: 락을 점유할 수 있는 최대 시간 (이 시간이 지나면 자동 해제 → 데드락 방지)

---

## 6. Rate Limiting — API 호출 횟수 제한

### 왜 필요한가

같은 유저가 짧은 시간에 API를 수백 번 호출하는 상황을 막아야 할 때 쓴다.
로그인 시도 횟수 제한, API 남용 방지 등에 활용된다.

### Fixed Window 방식

가장 단순한 구현이다. "1분 단위로 N번까지만 허용"하는 방식.

```
key: "rate:{userId}:{현재_분}"
→ 같은 분(minute)이면 같은 키를 씀
→ 분이 바뀌면 키가 달라지므로 자동으로 카운트 초기화
```

```java
@Service
@RequiredArgsConstructor
public class RateLimitService {

    private final StringRedisTemplate redisTemplate;
    private static final int MAX_REQUESTS = 30;  // 분당 30회

    public void checkRateLimit(Long userId) {
        long currentMinute = System.currentTimeMillis() / 60000;
        String key = "rate:" + userId + ":" + currentMinute;

        Long count = redisTemplate.opsForValue().increment(key);

        // 첫 요청일 때 TTL 설정 (키가 새로 생성된 경우)
        if (count == 1) {
            redisTemplate.expire(key, 60, TimeUnit.SECONDS);
        }

        if (count > MAX_REQUESTS) {
            throw new CustomException(ErrorCode.TOO_MANY_REQUESTS);
        }
    }
}
```

```java
// 컨트롤러 또는 인터셉터에서 호출
@PostMapping("/comments")
public ResponseEntity<?> createComment(
        @LoginUser Long userId,
        @RequestBody CreateCommentRequest request) {

    rateLimitService.checkRateLimit(userId);  // 제한 초과 시 예외
    // ...
}
```

### Fixed Window의 한계

분 경계에서 최대 2배의 요청이 통과될 수 있다.

```
00:59 → 30번 요청 (허용)
01:00 → 30번 요청 (새 분 → 허용)
→ 1초 사이에 60번 요청이 들어온 것
```

이를 해결하려면 Sliding Window 방식(Sorted Set 활용)이 필요하지만,
구현이 복잡해지므로 대부분의 경우 Fixed Window로 시작한다.

---

## 정리

| 용도 | 자료구조 | 핵심 명령 |
|--|--|--|
| 캐싱 | String | `GET` / `SET` + TTL |
| 토큰 저장 | String | `SET` + TTL / `DEL` |
| 블랙리스트 | String | `SET` + TTL / `EXISTS` |
| 카운터 | String | `INCR` / `INCRBY` |
| 랭킹 | Sorted Set | `ZADD` / `ZINCRBY` / `ZREVRANGE` |
| 분산 락 | String | `SETNX` (Redisson이 내부적으로 처리) |
| Rate Limiting | String | `INCR` + `EXPIRE` |

공통적으로 **TTL 설정은 필수**다. Redis는 메모리 기반이라 데이터가 쌓이면 메모리 부족이 발생한다. 더 이상 필요 없는 데이터는 TTL로 자동 삭제되도록 설계해야 한다.
