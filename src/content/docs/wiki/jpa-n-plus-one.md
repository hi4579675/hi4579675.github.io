---
title: N+1 문제
category: spring
description: 연관 엔티티를 지연 로딩할 때 쿼리가 1 + N번 나가는 문제와 해결책(fetch join, batch size, EntityGraph).
---

## 무엇인가

목록 조회 쿼리 1번 + 각 엔티티의 연관 객체를 채우려는 쿼리 N번이 추가로 나가는 현상. 컬렉션·연관 관계를 **지연 로딩(LAZY)** 으로 둔 채 루프에서 접근하면 발생한다.

```java
List<Order> orders = orderRepository.findAll(); // 쿼리 1번
for (Order o : orders) {
    o.getMember().getName();  // Order 수만큼 추가 쿼리 N번
}
```

## 왜 생기나

JPA는 연관 엔티티를 실제로 **사용하는 시점**에 프록시를 초기화한다. 즉시 로딩(EAGER)으로 바꿔도 쿼리 횟수는 그대로라 근본 해결이 아니다.

## 해결

- **fetch join** — `join fetch`로 연관 엔티티를 한 번에 조회.
- **`@BatchSize` / `default_batch_fetch_size`** — N번을 `IN` 절로 묶어 1~몇 번으로.
- **`@EntityGraph`** — 어노테이션으로 fetch 대상 지정.

> 컬렉션 fetch join은 페이징과 함께 쓰면 메모리에서 페이징되니, 이럴 땐 batch size가 더 안전하다.
