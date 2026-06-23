---
title: "스프링 인증, 어떻게 굴러가나: 빈에서 토큰까지 (시리즈 안내)"
category: spring
description: "흩어진 스프링 인증 글들을 한 흐름으로 읽는 길잡이. 스프링이 객체를 다루는 법(빈·DI)에서 출발해, 요청을 거르는 필터체인, 토큰을 발급하는 Authorization Server, 그리고 받은 토큰을 검증하는 단계까지 — 어떤 순서로 읽으면 좋은지 정리한 입구 글."
---

스프링으로 로그인/인증을 붙이다 보면 빈, 필터체인, Authorization Server, JWT 같은 게 한꺼번에 쏟아집니다. 따로 보면 막막한데, 사실 이 글들은 **요청 한 건이 인증되기까지 거치는 층**을 아래에서 위로 쌓은 순서예요. 이 페이지는 그 순서대로 읽도록 안내하는 입구입니다.

큰 줄기는 이렇습니다.

> **객체를 만든다 → 요청을 거른다 → 토큰을 발급한다 → 토큰을 검증한다.**

아래 세 층(빈·필터체인)이 떠받치고, 그 위에서 인증 서버가 토큰을 찍어내고, 마지막에 그 토큰을 검증합니다. 한 층씩 올라가며 봅니다.

---

## 읽는 순서

| 순서 | 글 | 한 줄 | 층 |
|---|---|---|---|
| ① | [스프링 빈과 의존성 주입](/wiki/spring-bean-di/) | 컨테이너가 객체를 만들고 의존성을 넣어준다 | **객체** |
| ② | [SecurityFilterChain과 FilterChainProxy](/wiki/spring-security-filter-chain/) | 들어온 요청을 필터들이 순서대로 거른다 | **요청** |
| ③ | [Authorization Server 핵심 빈 해부](/wiki/spring-authorization-server-beans/) | 토큰을 발급하려면 어떤 빈들이 필요한가 | **발급** |
| ④ | [JWT·JWK·JWKS와 토큰 검증](/wiki/jwt-jwk-jwks/) | 발급된 토큰을 서명·클레임으로 검증한다 | **검증** |

각 단계가 다음 단계의 바닥이 됩니다. ①의 빈/DI를 알아야 ②·③의 빈들이 "어떻게 만들어져 끼워지는지" 보이고, ③의 발급을 알아야 ④의 검증이 *무엇을 검증하는지* 이어집니다.

---

## 층별로 무슨 일이 일어나나

### ① 객체를 만든다 — [빈과 의존성 주입](/wiki/spring-bean-di/)

스프링의 모든 건 **컨테이너가 만든 빈**으로 시작합니다. 필터체인도, 인증 서버의 설정도 전부 빈이에요. 객체의 생성과 연결을 컨테이너에 맡기는 IoC/DI가 아래 모든 층의 바닥입니다.

→ 질문: **"이 객체들은 누가 만들어서 어떻게 연결되나?"**

### ② 요청을 거른다 — [필터체인](/wiki/spring-security-filter-chain/)

들어온 HTTP 요청은 `FilterChainProxy`라는 단일 진입점을 지나 `SecurityFilterChain`을 순회합니다. 인증·인가 정책이 여기서 필터 단위로 물리적으로 분리돼요.

→ 질문: **"이 요청을 어떤 필터가, 어떤 순서로 처리하나?"**

### ③ 토큰을 발급한다 — [Authorization Server 빈](/wiki/spring-authorization-server-beans/)

②의 필터체인 위에서 Authorization Server가 동작합니다. 부팅하고 토큰을 발급하려면 `OAuth2AuthorizationServerConfigurer`, `AuthorizationServerSettings`, `RegisteredClientRepository` 같은 빈들이 반드시 있어야 해요. 그 빈들을 하나씩 뜯어봅니다.

→ 질문: **"토큰을 찍어내려면 무엇이 갖춰져 있어야 하나?"**

### ④ 토큰을 검증한다 — [JWT·JWK·JWKS](/wiki/jwt-jwk-jwks/)

③이 발급한 JWT를, 받는 쪽은 서명과 클레임으로 검증합니다. 키를 JSON으로 표현한 JWK/JWKS, 키를 조달하는 `JWKSource`, 검증을 수행하는 `NimbusJwtDecoder`까지 — 토큰이 진짜인지 확인하는 마지막 층입니다.

→ 질문: **"받은 토큰이 위변조 없이 우리에게 발급된 게 맞나?"**

---

## 한눈에

```text
④  검증   받은 JWT가 진짜인가          (JWK/JWKS · NimbusJwtDecoder)
        ▲
③  발급   토큰을 찍어내는 빈들          (AS Configurer · RegisteredClient ...)
        ▲
②  요청   요청을 거르는 파이프라인       (FilterChainProxy · SecurityFilterChain)
        ▲
①  객체   모든 빈의 바닥               (IoC · DI)
```

①부터 쌓아 올리며 읽는 걸 권하지만, 지금 막힌 층이 어디냐에 따라 바로 들어와도 됩니다. 각 글 맨 위에 시리즈 내 위치를 적어뒀어요.
