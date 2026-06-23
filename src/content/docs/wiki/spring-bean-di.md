---
title: 스프링 빈과 의존성 주입
category: spring
description: IoC 컨테이너가 객체(빈)를 만들어 관리하고, 필요한 의존성을 대신 넣어주는(DI) 원리.
---

> 📚 [스프링 인증, 어떻게 굴러가나](/wiki/spring-auth-track/) 시리즈 **①편** (객체). 모든 빈의 바닥 → 다음은 요청을 거르는 [필터체인](/wiki/spring-security-filter-chain/).

## IoC

객체의 생성·생명주기 제어를 개발자가 아니라 **컨테이너(IoC)** 가 가져간다. 스프링이 관리하는 객체를 **빈(Bean)** 이라 부른다.

## DI (의존성 주입)

객체가 필요한 의존성을 **직접 `new` 하지 않고 외부에서 받는다**. 결합도가 낮아지고 테스트(목 주입)가 쉬워진다.

```java
@Service
public class OrderService {
    private final PaymentClient paymentClient;
    // 생성자 주입 — 권장
    public OrderService(PaymentClient paymentClient) {
        this.paymentClient = paymentClient;
    }
}
```

## 주입 방식

- **생성자 주입(권장)** — 불변(final) 보장, 순환 참조를 컴파일·기동 시점에 발견, 테스트 용이.
- 필드 주입(`@Autowired` 필드) — 간편하지만 테스트·불변에 불리.

## 빈 스코프

기본은 **싱글톤**(컨테이너당 1개). 그래서 빈은 **무상태(stateless)** 로 설계해야 동시성 문제가 없다.
