---
title: "Modular Monolith에서 MSA로: 서비스 성장을 위한 아키텍처 여정"
date: 2026-03-29
tags:
  - MSA
excerpt: 처음부터 MSA로 짜야 하나요? 모놀리식에서 Modular Monolith를 거쳐 MSA로 가는 흐름과, 각 단계가 왜 필요한지를 정리했습니다.
category: architecture
---

> "처음부터 MSA로 짜야 하나요?"

요즘 채용 공고에 MSA가 빠지는 곳이 거의 없습니다. 그래서 새 프로젝트를 시작할 때마다 이 고민을 하게 됩니다.

**"MSA로 처음부터 쪼갤까, 아니면 모놀리식으로 빠르게 만들까?"**

면접관이 "왜 MSA로 했어요?" 라고 물어본다면 "요즘 트렌드라서요"는 답이 되지 않습니다.

이 글은 모놀리식에서 시작해서, Modular Monolith를 거쳐, MSA로 가는 흐름을 정리한 글입니다. 각 단계가 왜 필요한지, 언제 넘어가야 하는지를 이야기합니다.

---

## 1. 세 가지 아키텍처의 차이

### 모놀리식 (Monolith)

모든 기능이 하나의 프로세스에 담긴 구조입니다.

```
[하나의 서버]
├── 유저 관리
├── 주문 처리
├── 결제
├── 알림
└── 통계
```

초기 스타트업 대부분이 여기서 시작합니다. 배포가 단순하고, 로컬 환경 구성이 쉽고, 트랜잭션 관리가 직관적입니다.

문제는 서비스가 커질수록 생깁니다. 코드가 서로 얽혀서 작은 기능 하나 바꿀 때 다른 곳이 깨집니다. 팀이 커지면 같은 코드베이스에서 여러 명이 충돌합니다. 특정 기능만 스케일 아웃하고 싶어도 전체를 늘려야 합니다.

### MSA (Microservice Architecture)

각 기능을 독립된 서비스로 분리한 구조입니다.

```
[user-service] [order-service] [payment-service] [notification-service]
      ↓               ↓                ↓                   ↓
   독립 DB         독립 DB           독립 DB              독립 DB
```

서비스별 독립 배포, 장애 격리, 기술 스택 선택의 자유가 생깁니다.

하지만 분산 시스템의 복잡함이 따라옵니다. 서비스 간 통신, 분산 트랜잭션, 데이터 정합성, 장애 추적까지 — 모놀리식에서는 고민 안 해도 될 것들을 전부 직접 해결해야 합니다.

### Modular Monolith — 그 사이

하나의 프로세스지만 **내부 경계를 명확하게 나눈** 구조입니다.

```
[하나의 서버]
├── user/
│   ├── domain/       ← 외부에서 직접 접근 불가
│   ├── service/      ← 외부에서 직접 접근 불가
│   └── api/          ← 다른 모듈은 이 인터페이스만 사용 가능
├── order/
│   ├── domain/
│   └── api/
└── payment/
```

모듈 간 의존성을 패키지 접근 제어로 강제합니다. `user` 모듈의 내부 구현은 `order` 모듈에서 직접 가져다 쓸 수 없습니다. 반드시 공개된 API(인터페이스)를 통해서만 통신합니다.

이게 왜 중요하냐면 — **나중에 MSA로 분리할 때 경계가 이미 잡혀있기 때문입니다.**

---

## 2. 왜 처음부터 MSA가 위험한가

마틴 파울러는 **MonolithFirst** 패턴에서 이렇게 썼습니다.

> "you shouldn't start a new project with microservices, even if you're sure your application will be big enough to make it worthwhile."
> — Martin Fowler, *MonolithFirst* (martinfowler.com)

이유가 있습니다.

### 도메인을 모르는 상태에서 나눈 경계는 대부분 틀립니다

서비스를 처음 만들 때는 어떤 기능이 얼마나 커질지, 어떤 것들이 함께 바뀌는지 알 수 없습니다. 잘못 나눈 경계는 모놀리식에서는 리팩토링으로 끝나지만, MSA에서는 서비스 재설계가 됩니다.

### 네트워크 비용이 생깁니다

```
모놀리식: 함수 호출   →  나노초 단위
MSA:      HTTP 호출   →  1~5ms (같은 클러스터 내부 기준)
```

3개 서비스를 거치면 3~15ms가 그냥 날아갑니다. 유저가 적은 초기 서비스에서 이 비용을 감당할 이유가 없습니다.

### 분산 트랜잭션이 생깁니다

"주문 생성 + 재고 차감 + 포인트 적립"을 모놀리식에서는 `@Transactional` 하나로 끝납니다.

MSA에서는 Saga 패턴을 써야 합니다. 보상 트랜잭션, 이벤트 중복 처리, 멱등성 보장까지 — 단순한 비즈니스 로직 하나가 분산 시스템 문제가 됩니다.

### 운영 복잡도가 즉시 올라갑니다

서비스 3개만 돼도 "어느 서비스에서 에러가 났지?"를 추적하기 위해 분산 로깅, 분산 추적(Zipkin, Jaeger 등)이 필요합니다. 유저가 100명도 안 되는 서비스에서 이걸 관리하는 건 낭비입니다.

---

## 3. Modular Monolith: 경계를 코드로 강제하기

Modular Monolith의 핵심은 경계를 선언만 하는 게 아니라 **테스트로 강제하는 것**입니다.

### package-private으로 내부 노출 막기

```java
// user/domain/UserEntity.java
// package-private → 외부 모듈에서 import 불가
class UserEntity { ... }

// user/api/UserInfo.java
// public → 외부 모듈에 공개
public record UserInfo(Long id, String name) { }

// user/api/UserModule.java
public interface UserModule {
    UserInfo getUser(Long userId);
}
```

### ArchUnit으로 의존성 규칙을 테스트로 고정

```java
@Test
void order_모듈은_user_내부_구현에_직접_접근하면_안된다() {
    noClasses()
        .that().resideInAPackage("..order..")
        .should().accessClassesThat()
        .resideInAPackage("..user.domain..")
        .check(importedClasses);
}

@Test
void 모든_모듈은_공개_api_인터페이스를_통해서만_통신해야_한다() {
    noClasses()
        .that().resideInAPackage("..order..")
        .should().dependOnClassesThat()
        .resideInAPackage("..user.service..")
        .check(importedClasses);
}
```

이 테스트가 CI에서 돌면 누군가 실수로 경계를 넘는 순간 빌드가 깨집니다. 문서보다 강합니다.

```java
// ❌ 직접 접근 — ArchUnit 테스트에서 실패
UserEntity user = userRepository.findById(userId);
String name = user.getInternalField();

// ✅ 공개 API만 사용
UserInfo user = userModule.getUser(userId);
String name = user.name();
```

**나중에 MSA로 분리할 때 경계가 이미 잡혀있고, 의존성이 명확하기 때문에 추출이 수월해집니다.**

---

## 4. 언제 MSA로 가야 하는가

모든 서비스가 MSA가 필요한 건 아닙니다. 아래 신호가 오면 분리를 고려합니다.

**배포 주기가 다를 때**

결제 서비스는 신중하게 월 1회 배포하는데, 추천 알고리즘은 매일 바꾸고 싶다면 — 같은 코드베이스에 있으면 서로를 방해합니다.

**스케일이 달라야 할 때**

검색 기능은 트래픽이 몰려서 서버 10대가 필요한데, 어드민 기능은 1대로 충분하다면 — 모놀리식에서는 전체를 10대로 늘려야 합니다.

**팀이 독립적으로 일하고 싶을 때**

콘웨이의 법칙(Conway's Law)이 있습니다. **"시스템 구조는 그것을 설계하는 조직의 커뮤니케이션 구조를 닮는다."** 팀이 독립적으로 일하려면 서비스도 독립되어야 합니다.

**기술 스택을 다르게 가져가야 할 때**

AI 파이프라인은 Python이 압도적으로 유리하고, 비즈니스 로직은 Java Spring이 안정적이라면 — 두 언어를 하나의 서비스에 넣을 수는 없습니다.

---

## 5. MSA 전환 전략: Strangler Fig Pattern

모놀리스를 한 번에 MSA로 전환하는 건 현실적으로 불가능합니다. **Strangler Fig Pattern**은 점진적으로 옮기는 전략입니다.

이름은 숙주 나무를 천천히 감아 올라가 결국 대체하는 무화과나무에서 왔습니다. (마틴 파울러가 명명)

```
Step 1: 기존 모놀리스 그대로 운영
[Client] → [Monolith]

Step 2: API Gateway를 앞에 세움
[Client] → [API Gateway] → [Monolith]

Step 3: 분리할 기능을 새 서비스로 추출, Gateway에서 라우팅
[Client] → [API Gateway] → [Monolith]         (나머지 기능)
                        → [payment-service]    (결제만 분리)

Step 4: 점진적으로 모놀리스 기능을 옮김
[Client] → [API Gateway] → [user-service]
                        → [order-service]
                        → [payment-service]
                        (모놀리스 소멸)
```

핵심은 **기존 시스템이 계속 동작하는 상태에서 새 서비스를 붙인다**는 것입니다. 전체를 한 번에 재작성하는 Big Bang 방식은 위험합니다.

---

## 6. MSA에서 꼭 챙겨야 할 것들

### API Gateway

외부 요청이 들어오는 단일 진입점입니다.

```
[Client]
   ↓
[API Gateway]  ← 인증, 라우팅, Rate Limiting, SSL 종료
   ↓          ↓          ↓
[user-svc] [order-svc] [payment-svc]
```

API Gateway가 없으면 클라이언트가 각 서비스의 주소를 직접 알아야 합니다. 서비스가 추가되거나 주소가 바뀔 때마다 클라이언트도 수정해야 합니다.

실무에서는 Spring Cloud Gateway, Kong, AWS API Gateway 등을 사용합니다.

### Database-per-Service

MSA에서 각 서비스는 **자신의 DB만 소유**합니다. 다른 서비스의 DB에 직접 접근하지 않습니다.

```
❌ 공유 DB (MSA의 의미가 없어짐)
[user-svc] ─┐
[order-svc]─┼─→ [공유 DB]
[pay-svc]  ─┘

✅ DB-per-Service
[user-svc]  → [user-db]
[order-svc] → [order-db]
[pay-svc]   → [pay-db]
```

공유 DB를 쓰면 스키마 변경 시 모든 서비스가 영향을 받아 독립 배포가 불가능해집니다.

**trade-off**: 여러 서비스에 걸친 조회(JOIN)가 필요할 때 복잡해집니다. API Composition(각 서비스를 따로 호출해서 애플리케이션에서 합산) 또는 CQRS + 이벤트로 읽기 전용 뷰를 따로 만드는 방식으로 해결합니다.

### Saga 패턴 (분산 트랜잭션)

여러 서비스에 걸친 데이터 변경을 조율하는 패턴입니다. 두 가지 방식이 있습니다.

**Choreography (안무형)**

중앙 조율자 없이 각 서비스가 이벤트를 발행하고 구독합니다.

```
order-svc: OrderCreated 이벤트 발행
    → stock-svc: 재고 차감 후 StockReserved 발행
        → payment-svc: 결제 처리 후 PaymentCompleted 발행
            → order-svc: 주문 확정
```

장점: 서비스 간 결합도가 낮음
단점: 전체 흐름을 한눈에 파악하기 어려움, 서비스가 많아지면 이벤트 추적이 복잡해짐

**Orchestration (오케스트레이션형)**

Saga Orchestrator가 중앙에서 각 서비스에 명령을 내립니다.

```
[Saga Orchestrator]
    → order-svc: 주문 생성 요청
    → stock-svc: 재고 차감 요청
    → payment-svc: 결제 요청
    → order-svc: 주문 확정 요청
```

장점: 전체 흐름이 한 곳에 명시됨, 추적과 디버깅이 쉬움
단점: Orchestrator가 병목이 될 수 있음

**보상 트랜잭션**: 중간에 실패하면 이미 성공한 단계를 되돌립니다.

```
결제 실패 →
    stock-svc: 재고 복구 (보상)
    order-svc: 주문 취소 (보상)
```

### 분산 추적 (Distributed Tracing)

요청 하나가 여러 서비스를 거칠 때 어디서 문제가 생겼는지 추적할 수 있어야 합니다.

```java
// 모든 서비스가 Correlation ID를 헤더로 전파
X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000
```

요청이 들어올 때 ID를 생성하고, 다음 서비스 호출 시 헤더에 담아 전달합니다. 각 서비스는 이 ID를 로그에 남깁니다. Zipkin, Jaeger 같은 도구가 이 ID를 기반으로 전체 요청 경로를 시각화합니다.

### Circuit Breaker

의존하는 서비스가 죽었을 때 장애가 전파되지 않게 막습니다.

```
payment-service 다운
    → order-service가 계속 payment 호출
    → order-service 스레드 고갈
    → order-service도 다운
    → 연쇄 장애
```

Circuit Breaker는 일정 횟수 이상 실패하면 더 이상 호출하지 않고 즉시 폴백 응답을 반환합니다.

```
CLOSED (정상) → 실패율 임계치 초과 → OPEN (차단)
OPEN → 일정 시간 후 → HALF-OPEN (탐색) → 성공 → CLOSED
```

Spring에서는 Resilience4j로 구현합니다.

---

## 7. 실제 전환 여정

### Step 1: 모놀리식으로 빠르게 만든다

도메인을 이해하는 게 먼저입니다. 일단 동작하는 서비스를 만들고, 어떤 기능이 어떻게 쓰이는지 관찰합니다.

### Step 2: 내부를 모듈화한다

동작하는 서비스가 생겼으면 내부를 정리합니다. 패키지를 명확히 나누고, 모듈 간 의존성을 정리하고, 공개 API를 정의합니다. ArchUnit으로 경계를 테스트로 고정합니다.

### Step 3: 병목을 찾는다

실제 트래픽이 생기면 병목이 보입니다. 어떤 기능이 가장 많이 불리는지, 어떤 기능 때문에 배포가 느려지는지, 어떤 팀이 어떤 코드를 주로 건드리는지.

### Step 4: 이유가 생긴 것부터 Strangler Fig로 분리한다

"이 모듈은 배포 주기가 다르다", "이 기능은 스케일이 달라야 한다", "이 팀은 독립적으로 일하고 싶다" — 이유가 생긴 것부터 분리합니다.

이유 없는 분리는 복잡도만 추가합니다.

---

## 마무리

아키텍처는 트레이드오프입니다.

MSA는 분명 강력한 구조지만, 그 복잡함을 감당할 팀과 서비스 규모가 전제됩니다. 유저 100명짜리 서비스에 MSA를 적용하면 운영 복잡도만 올라갑니다.

Modular Monolith로 경계를 잘 잡아두면, 필요한 시점에 Strangler Fig Pattern으로 점진적으로 분리할 수 있습니다. 처음부터 완벽한 MSA를 목표로 하기보다 **지금 팀과 서비스 규모에 맞는 구조를 선택하고, 성장하면서 점진적으로 분리하는 것** — 이게 아키텍처 여정의 핵심인 것 같습니다.
