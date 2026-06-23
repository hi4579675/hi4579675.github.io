---
title: Spring Authorization Server 핵심 빈 해부
category: spring
description: AS를 부팅·발급 가능하게 만드는 빈들 — OAuth2AuthorizationServerConfigurer(컨트롤 타워), AuthorizationServerSettings(issuer), RegisteredClientRepository(클라이언트 명부), JwtAuthenticationConverter(권한 매핑)를 하나씩 뜯어본다.
---

[SecurityFilterChain](/wiki/spring-security-filter-chain/)에서 본 AS 필터체인은 4줄짜리지만, 그게 부팅하고 토큰을 발급하려면 반드시 있어야 하는 빈들이 있다. 이 글은 그 빈들을 하나씩 본다.

먼저 **부팅·발급에 관여하는 빈 목록**:

| 빈 | 역할 |
|---|---|
| `jwkSource` | 공개키를 JWKS로 노출 → 각 앱이 토큰 검증에 사용 ([JWT·JWK·JWKS](/wiki/jwt-jwk-jwks/)) |
| `jwtDecoder` | 들어온 JWT를 영속 키로 서명 검증 + `iss`/`exp`/`nbf` 검증 ([JWT·JWK·JWKS](/wiki/jwt-jwk-jwks/)) |
| `jwtAuthenticationConverter` | 검증된 JWT → 스프링 권한 객체로 변환 (아래) |
| `authorizationServerSettings` | `issuer` URI 설정 — 발급 토큰의 `iss`이자 리소스 서버가 신뢰할 발급자 (아래) |
| `registeredClientRepository` | OAuth 클라이언트 등록. **없으면 AS가 부팅조차 안 됨** (아래) |

`jwkSource`·`jwtDecoder`는 [JWT·JWK·JWKS](/wiki/jwt-jwk-jwks/)에서 다뤘다. 여기서는 나머지와, 이 모든 걸 조립하는 컨트롤 타워를 본다.

## OAuth2AuthorizationServerConfigurer — 컨트롤 타워

`OAuth2AuthorizationServerConfigurer`는 Spring AS의 **OAuth2/OIDC 엔드포인트 8~9종 + URL 매처 + 각 필터 + CSRF 예외 + JWKS 노출**을 통째로 조립해 `HttpSecurity`에 꽂아주는 단일 설정 모듈이다. 람다 DSL(`http.with(...)`) 안에서 인증 서버 구축에 필요한 모든 걸 총괄하는 컨트롤 타워.

`AbstractHttpConfigurer`를 상속받아 필터 체인 안에 인증 서버 전용 필터들을 주입하고, 내부적으로 하위 설정 클래스들(`configurers`)을 `LinkedHashMap`으로 관리하며 각 엔드포인트에 맞는 필터·검증 로직을 조립한다.

### 내부가 관리하는 하위 엔드포인트 (`createConfigurers()`)

| 하위 Configurer | 엔드포인트 |
|---|---|
| `OAuth2ClientAuthenticationConfigurer` | 클라이언트 인증 (Client ID/Secret 검증) |
| `OAuth2AuthorizationEndpointConfigurer` | 인가 요청 `/oauth2/authorize` |
| `OAuth2TokenEndpointConfigurer` | 토큰 발급 `/oauth2/token` |
| `OAuth2TokenIntrospectionEndpointConfigurer` | 토큰 검사 `/oauth2/introspect` |
| `OAuth2TokenRevocationEndpointConfigurer` | 토큰 폐기 `/oauth2/revoke` |
| `OAuth2DeviceAuthorizationEndpointConfigurer` | 디바이스 코드 흐름 |
| `OAuth2AuthorizationServerMetadataEndpointConfigurer` | 서버 메타데이터 `/.well-known/oauth-authorization-server` |

### 핵심 생명주기 메서드 둘

**① `init(HttpSecurity)` — 초기화 단계**

- **OIDC 처리**: `oidc()`가 켜져 있으면 세션 추적용 `SessionRegistry`를 초기화한다. **꺼져 있는데** 사용자가 `scope=openid`를 요청하면, 그 요청을 거절하는 Validator를 강제 주입해 보안 사고를 예방한다.
- **RequestMatcher 통합**: 하위 컴포넌트들의 URI + JWK Set URI를 모두 모아 하나의 `endpointsMatcher`로 통합한다. → 이게 [SecurityFilterChain](/wiki/spring-security-filter-chain/)에서 본 `getEndpointsMatcher()`의 재료.
- **CSRF 우회**: 토큰·인트로스펙션·폐기 같은 API 성격 엔드포인트는 인증 실패 시 `401`을 반환하도록 설정하고, AS 엔드포인트들에 대해 **CSRF 보호를 자동 제외**한다(상태 없는 API 요청이라 CSRF 대상이 아님).

**② `configure(HttpSecurity)` — 필터 등록 단계**

- `AuthorizationServerContextFilter` 등록 — issuer 주소·설정 정보 등 인증 서버 컨텍스트를 ThreadLocal에 바인딩.
- `NimbusJwkSetEndpointFilter` 등록 — 외부 리소스 서버가 공개키를 받아갈 수 있게 JWK Set 엔드포인트 필터 등록.

### 공유 객체(Shared Objects)

여러 컴포넌트가 공유하는 핵심 객체들을 `setSharedObject(...)`로 등록하는 메서드도 제공한다: `registeredClientRepository`(클라이언트 명부), `authorizationService`(발급된 인가 정보 상태), `authorizationConsentService`(동의 내역), `tokenGenerator`(Access/Refresh/ID 토큰 생성 엔진).

## AuthorizationServerSettings — issuer 설정표

AS의 **전역 설정**(issuer + 모든 엔드포인트 경로)을 담은 객체다.

```java
@Bean
public AuthorizationServerSettings authorizationServerSettings(@Value("${app.issuer}") String issuer) {
    return AuthorizationServerSettings.builder().issuer(issuer).build();
}
```

- `issuer` = `app.issuer` = **이 IdP의 발급자 신원 URL**. 발급 토큰의 `iss` 클레임이자, `.well-known/openid-configuration`에 공개되고, 리소스 서버가 신뢰 기준으로 삼는 **단일 앵커**다.
- 엔드포인트 경로(`/oauth2/token`, `/oauth2/jwks`, `/connect/register` 등)도 여기 담기지만, 우리는 표준 기본값을 그대로 쓴다. 바꾸려면 `.tokenEndpoint("/custom/token")`처럼 덮어쓸 수 있다.

엄격한 유효성 검증도 한다 — `issuer` URL에 쿼리(`?`)나 프래그먼트(`#`)가 있으면 구동 단계에서 예외를 던진다(RFC 8414 §2 준수).

```java
if (issuerUri.getQuery() != null || issuerUri.getFragment() != null) {
    throw new IllegalArgumentException("issuer cannot contain query or fragment component");
}
```

> 이 빈이 없으면 여러 내부 컴포넌트(`AuthorizationServerContextFilter`, 메타데이터 엔드포인트)가 issuer·경로를 조회하지 못해 **컨텍스트 로딩이 실패**한다. `RegisteredClientRepository`와 함께 AS 부팅 필수 빈이다.

| 항목 | 내용 |
|---|---|
| 정체 | AS 전역 설정 (issuer + 모든 엔드포인트 경로) |
| 핵심 값 | `issuer` = `app.issuer` = 이 IdP의 발급자 신원 URL |
| 왜 중요 | 발급(`iss`)·공개(openid-config)·검증(리소스 서버)의 **단일 기준점** |

## RegisteredClientRepository — 클라이언트 명부 (회원 아님)

"누가(어떤 **앱**이) 이 IdP에 토큰을 요청할 수 있는가"를 정의하는 **클라이언트 화이트리스트**다. **사용자 계정이 아니라 앱 등록**이라는 점이 중요하다 — "내 모바일 앱", "파트너사 연동", "서비스 A→B 호출" 각각이 하나의 클라이언트.

| 항목 | 내용 |
|---|---|
| 정체 | OAuth 클라이언트(앱) 등록 명부 (회원 아님) |
| 필수성 | **AS 부팅 필수 빈** — 없으면 컨텍스트 로딩 실패 |
| dev 예시 | 클라이언트 1개, `client_credentials`, 평문 시크릿, 인메모리 |
| prod 전환 | `{bcrypt}` 시크릿 + `JdbcRegisteredClientRepository` |

하이브리드 구조(자사 로그인은 커스텀 발급, AS는 JWKS·서비스간 호출만)에서는 이 명부가 **부팅·JWKS 유지를 위한 최소 등록**에 가깝다. 멀티앱 생태계가 커지면 각 앱의 신뢰·스코프·콜백을 관리하는 핵심 테이블이 된다.

## JwtAuthenticationConverter — JWT를 인증 객체로

[JWT·JWK·JWKS](/wiki/jwt-jwk-jwks/)의 `NimbusJwtDecoder`가 **"토큰이 진짜냐?"** 였다면, `JwtAuthenticationConverter`는 **"이 토큰의 주인이 누구고 무슨 권한을 갖냐?"** 를 뽑아 스프링 시큐리티가 이해하는 `Authentication` 객체로 바꾼다.

```java
@Bean
JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtGrantedAuthoritiesConverter ga = new JwtGrantedAuthoritiesConverter();
    ga.setAuthoritiesClaimName("authorities");  // ① 어느 클레임에서 권한을 읽을지
    ga.setAuthorityPrefix("");                   // ② 권한 앞에 prefix 안 붙임

    JwtAuthenticationConverter conv = new JwtAuthenticationConverter();
    conv.setJwtGrantedAuthoritiesConverter(ga);  // ③ 위 권한 변환기 장착
    conv.setPrincipalClaimName("sub");           // ④ principal(=누구)은 sub 클레임
    return conv;
}
```

| 설정 | 효과 | 이유 |
|---|---|---|
| `authoritiesClaimName = "authorities"` | 표준 `scope` 대신 커스텀 클레임에서 권한을 읽음 | 멀티앱 스코프(`repair:user`)를 한 클레임에 담음 |
| `authorityPrefix = ""` | 기본값 `SCOPE_`를 안 붙임 | authority가 `service_cd:role`과 1:1로 일치 |
| `principalClaimName = "sub"` | 주체 = userId | 신원은 `user_id`로 식별 |

기본값을 쓰면 `scope` 클레임에서 읽고 권한 앞에 `SCOPE_`가 붙어 `SCOPE_repair:user`가 된다. 우리는 커스텀 `authorities` 클레임 + prefix 없이 `repair:user` 그대로 쓰려고 둘 다 바꾼다.

> 토큰은 이렇게 생겼다: `{ "sub": "10293", "authorities": ["repair:user", "repair:partner"], ... }`

### authorities는 누가 채우나

이 컨버터는 토큰에 **이미 박힌** `authorities`를 읽어 복원할 뿐이다. 채우는 쪽은 토큰을 발급하는 `JwtTokenProvider`이고, 그 재료는 DB에서 온다.

```text
DB: mb_user_role (service_cd=repair, role_cd=user)
   ↓ AuthService가 조회 → ["repair:user"] 조립
JwtTokenProvider.issueAccessToken(..., authorities=["repair:user"]) ← 클레임에 박음
   ↓ RS256 서명된 JWT
클라이언트 → 리소스 서버 → JwtAuthenticationConverter가 다시 권한으로 복원
```

> **Access 토큰에만 권한을 싣고 Refresh 토큰엔 싣지 않는다.** Refresh는 오래 살아서, 권한을 박아두면 권한이 회수돼도 옛 권한이 박제된다. 그래서 Refresh엔 `sub`+`sid`만 담고, 권한은 Access를 새로 발급할 때마다 최신값으로 채운다. 서명은 `RS256` **하나만** 허용해 `alg: none`/`HS256` 바꿔치기(alg confusion) 공격을 막는다.

## 정리

- `OAuth2AuthorizationServerConfigurer` = 엔드포인트·필터·CSRF 예외·JWKS 노출을 통째로 조립하는 컨트롤 타워.
- `AuthorizationServerSettings` = `issuer`(발급·검증의 단일 앵커) + 엔드포인트 경로. 부팅 필수.
- `RegisteredClientRepository` = 토큰을 요청할 수 있는 **앱**의 화이트리스트(회원 아님). 부팅 필수.
- `JwtAuthenticationConverter` = 검증된 JWT에서 `sub`(주체)·`authorities`(권한)를 뽑아 인증 객체로. 멀티앱 스코프 권한을 스프링 보안에 연결하는 접착제.
- 관련: [SecurityFilterChain과 FilterChainProxy](/wiki/spring-security-filter-chain/), [JWT·JWK·JWKS](/wiki/jwt-jwk-jwks/)
