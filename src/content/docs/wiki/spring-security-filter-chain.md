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

> `FilterChainProxy` 자신은 서블릿 컨테이너(Tomcat) 입장에선 **필터 하나**다. 컨테이너의 필터 목록에는 `DelegatingFilterProxy`라는 얇은 래퍼가 등록되고, 그게 스프링 컨텍스트의 `FilterChainProxy`(빈 이름 `springSecurityFilterChain`)에 처리를 위임한다. 즉 `서블릿 필터 → DelegatingFilterProxy → FilterChainProxy → (선택된) SecurityFilterChain` 순.

## getFilters()엔 뭐가 들었나 — 대표 필터 순서

`getFilters()`가 돌려주는 건 "보안 관심사별 필터들"이고, **순서 자체가 보안 로직**이다. 인증이 인가보다 먼저 와야 하고, 예외 변환이 그 둘을 감싸야 한다. 기본 체인의 대표적인 순서(일부):

```text
SecurityContextHolderFilter   // 저장된 인증을 SecurityContext에 복원
   ↓
CsrfFilter                    // CSRF 토큰 검사 (상태 기반 폼/세션)
   ↓
인증 필터들                    // UsernamePasswordAuthenticationFilter / BearerTokenAuthenticationFilter 등
   ↓
ExceptionTranslationFilter    // 아래에서 터진 인증/인가 예외를 잡아
   ↓                          //  → 401(AuthenticationEntryPoint) 또는 403으로 변환
AuthorizationFilter           // "이 요청에 이 권한 있나?" 최종 인가 (anyRequest().authenticated() 등)
   ↓
DispatcherServlet → Controller
```

여기서 **`ExceptionTranslationFilter`의 `AuthenticationEntryPoint`** 가 "미인증이면 무엇을 할지"를 결정한다 — 브라우저 흐름이면 `LoginUrlAuthenticationEntryPoint`로 로그인 폼에 리다이렉트, API면 `HttpStatusEntryPoint`로 그냥 `401`. 체인마다 이 정책이 다를 수 있다는 게 분리의 핵심 이유 중 하나다.

## securityMatcher vs requestMatchers — 자주 헷갈리는 둘

이름이 비슷해서 섞이는데, 사는 층이 다르다.

| | 무엇 | 인터페이스로 치면 |
|---|---|---|
| **`http.securityMatcher(...)`** | "이 **체인**이 이 요청을 담당하는가" — 체인 선택 | `SecurityFilterChain.matches()` |
| **`authorizeHttpRequests(a -> a.requestMatchers(...))`** | 담당이 정해진 뒤, "이 **URL**엔 어떤 권한이 필요한가" — 체인 *내부*의 인가 규칙 | `AuthorizationFilter`가 사용 |

`securityMatcher`로 못 걸러진 요청은 이 체인에 **아예 안 들어온다**. 반대로 `requestMatchers`는 이미 이 체인에 들어온 요청을 URL별로 분류할 뿐이다. "체인은 맞는데 특정 경로만 permitAll" 하려면 `requestMatchers`, "이 경로 그룹은 통째로 다른 정책" 하려면 별도 체인 + `securityMatcher`.

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

> ⚠️ AS 체인(`@Order(1)`)을 따로 두면 **나머지 일반 요청을 받을 앱 체인(`@Order(2)`)도 반드시 정의**해야 한다. 이 체인은 `securityMatcher`로 OAuth 경로만 잡으므로, 그 밖의 요청은 **어느 체인에도 안 걸린다.** 매칭되는 체인이 없으면 `FilterChainProxy`는 그 요청에 **보안 필터를 하나도 적용하지 않고** 다음 서블릿 필터로 흘려보낸다 — 즉 그 엔드포인트가 의도치 않게 **무방비로 노출**된다. (스프링 부트는 사용자가 체인을 *하나도* 정의하지 않을 때만 기본 체인을 깔아준다. 하나라도 정의하는 순간 catch-all은 내 책임이다.)

```java
@Bean @Order(2)   // catch-all: 위 AS 체인이 안 잡은 나머지 전부
SecurityFilterChain appChain(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(a -> a
        .requestMatchers("/.well-known/**", "/oauth2/jwks").permitAll()
        .anyRequest().authenticated());
    return http.build();
}
```

## 정리

- `SecurityFilterChain` = `matches`(담당 여부) + `getFilters`(적용할 필터들), 2개짜리 인터페이스.
- `FilterChainProxy`가 등록된 체인들을 위에서부터 순회하고, **처음 matches된 하나만** 실행한다 → `@Order`가 곧 정책 우선순위.
- `getFilters()`의 순서 자체가 보안 로직: 컨텍스트 복원 → CSRF → 인증 → 예외 변환 → 인가.
- `securityMatcher`(체인 선택)와 `requestMatchers`(체인 내부 URL 인가)는 다른 층이다.
- 체인을 나눠 등록하면 정책을 물리적으로 분리할 수 있지만, **어느 체인에도 안 걸리는 요청은 무방비로 통과**하므로 catch-all 체인을 반드시 둔다.
- 관련: [Spring Authorization Server 핵심 빈 해부](/wiki/spring-authorization-server-beans/), [스프링 빈과 의존성 주입](/wiki/spring-bean-di/)
