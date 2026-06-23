---
title: SecurityFilterChain과 FilterChainProxy
category: spring
description: Spring Security의 요청 처리 핵심 단위인 SecurityFilterChain(2-메서드 인터페이스)과, 체인들을 순회하는 단일 진입점 FilterChainProxy. @Order로 보안 정책을 물리적으로 분리하는 법.
---

`SecurityFilterChain`은 Spring Security 전체 동작의 핵심 단위다. 인터페이스 자체는 메서드 **딱 2개**로 단순하지만 의미가 크다.

```java
public interface SecurityFilterChain {

    // ① 이 요청, 내가 처리할까?
    boolean matches(HttpServletRequest request);

    // ② 처리한다면, 이 필터들을 순서대로 태운다
    List<Filter> getFilters();
}
```

- **`matches(request)`** — 들어온 HTTP 요청을 보고 "이 체인이 이 요청을 담당하는가?"를 `true`/`false`로 답한다. 보통 URL 패턴으로 매칭.
- **`getFilters()`** — 담당한다면, 그 요청에 순서대로 적용할 필터 목록을 반환한다. 인증·인가·CSRF·CORS 등 각각이 하나의 `Filter`.

이 단순한 인터페이스 하나가 **"어떤 요청을 / 어떤 보안 필터들로 처리할지"를 정의하는 단위**다.

## 전체 그림: FilterChainProxy

요청이 들어오면 흐름은 이렇다.

```text
HTTP 요청
   ↓
FilterChainProxy  (Spring Security의 단일 진입점, 서블릿 필터 1개)
   ↓  등록된 SecurityFilterChain들을 "위에서부터" 순회
   ├─ chain1.matches(req)? → true면 chain1.getFilters() 실행하고 끝
   ├─ chain2.matches(req)?
   └─ ...
```

**핵심 규칙: 첫 번째로 `matches`가 `true`인 체인 하나만 실행되고 나머지는 무시된다.** 그래서 체인의 순서(`@Order`)가 중요하다. 더 좁고 특수한 체인이 먼저 와야 넓은 체인이 가로채지 못한다.

## 정책을 물리적으로 분리하는 도구

체인이 여러 개라는 건, 요청 그룹마다 **완전히 다른 보안 정책**을 줄 수 있다는 뜻이다. IdP를 만들 때 **인증 서버(AS)용 정책**과 **일반 앱용 정책**을 분리하는 데 이걸 쓴다.

```java
// 인증 서버 전용 필터체인 — 표준 OAuth/OIDC 엔드포인트만 매칭
@Bean                 // 이 메서드의 반환값(SecurityFilterChain)을 컨테이너에 등록 = 위 인터페이스의 구현체
@Order(1)             // FilterChainProxy가 순회할 때 가장 먼저 검사 → OAuth 경로를 앱 체인이 가로채지 못하게
public SecurityFilterChain authorizationServerSecurityFilterChain(HttpSecurity http) throws Exception {

    // Spring AS가 제공하는 설정 도우미. 표준 엔드포인트 정의 + 그걸 처리할 필터들이 들어있다.
    OAuth2AuthorizationServerConfigurer authorizationServer =
            OAuth2AuthorizationServerConfigurer.authorizationServer();

    http
        // ★ matches()의 실체. getEndpointsMatcher()는 "AS 표준 엔드포인트 URL들"에만
        //   매칭되는 RequestMatcher를 돌려준다. 즉 이 체인은 /oauth2/**, /.well-known/** 같은
        //   요청만 담당하고, 나머지는 통째로 다음(앱) 체인에 넘긴다 — "필터체인 물리 분리"
        .securityMatcher(authorizationServer.getEndpointsMatcher())
        // authorizationServer 설정을 이 체인에 장착. 기본은 OAuth2만 켜지는데 .oidc()로 OIDC도 활성화
        .with(authorizationServer, server -> server.oidc(Customizer.withDefaults()))
        // AS 엔드포인트는 인증된 요청만 허용
        .authorizeHttpRequests(auth -> auth.anyRequest().authenticated());

    return http.build();
    // 조립 완료 → matches(securityMatcher) + getFilters(쌓은 설정)를 가진 SecurityFilterChain 객체 생성.
    // 이게 빈으로 등록되어 FilterChainProxy에 들어간다.
}
```

`http.build()`가 만들어내는 게 결국 앞에서 본 그 2-메서드 인터페이스의 구현체다 — `matches`는 `securityMatcher`가, `getFilters`는 여태 쌓은 설정이 채운다.

> AS 체인(`@Order(1)`)을 따로 두면 **나머지 일반 요청을 받을 앱 체인(`@Order(2)`)도 반드시 정의**해야 한다. AS 체인은 `securityMatcher`로 OAuth 경로만 잡으므로, 그 밖의 요청을 받을 체인이 없으면 컨텍스트가 불완전해진다.

## 정리

- `SecurityFilterChain` = `matches`(담당 여부) + `getFilters`(적용할 필터들), 2개짜리 인터페이스.
- `FilterChainProxy`가 등록된 체인들을 위에서부터 순회하고, **처음 matches된 하나만** 실행한다 → `@Order`가 곧 정책 우선순위.
- 체인을 나눠 등록하면 "OAuth 엔드포인트용 정책"과 "앱용 정책"을 물리적으로 분리할 수 있다.
- 관련: [Spring Authorization Server 핵심 빈 해부](/wiki/spring-authorization-server-beans/), [스프링 빈과 의존성 주입](/wiki/spring-bean-di/)
