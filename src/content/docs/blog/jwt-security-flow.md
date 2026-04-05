---
title: "JWT + Spring Security 인증 흐름 완전 정리"
date: 2026-04-05
tags:
  - Spring Boot
  - JWT
excerpt: JwtProvider, JwtAuthenticationFilter, SecurityConfig가 실제 요청에서 어떤 순서로 동작하는지 흐름 중심으로 정리합니다.
category: develops
---

> 코드는 짰는데 요청이 들어왔을 때 어떤 순서로 뭐가 실행되는지 머릿속에 그림이 안 그려지는 분들을 위한 글입니다.

---

## 0. Spring Security는 어떻게 동작하나

Spring Security를 쓰면 HTTP 요청이 컨트롤러에 닿기 전에 **필터 체인**을 통과한다. 이 구조를 먼저 이해해야 JWT 코드가 보인다.

```
HTTP Request
    ↓
DelegatingFilterProxy  (서블릿 컨테이너 영역)
    ↓
FilterChainProxy       (Spring Security 진입점)
    ↓
SecurityFilterChain    (실제 필터들이 순서대로 실행)
    ├── JwtExceptionFilter
    ├── JwtAuthenticationFilter
    ├── UsernamePasswordAuthenticationFilter
    └── ... (이후 Security 기본 필터들)
    ↓
DispatcherServlet → Controller
```

**DelegatingFilterProxy**: 서블릿 컨테이너(Tomcat)의 필터 체인에 등록되는 얇은 래퍼. Spring ApplicationContext에 있는 `FilterChainProxy`에 처리를 위임한다.

**FilterChainProxy**: Spring Security의 진짜 진입점. 요청 URL에 맞는 `SecurityFilterChain`을 선택해서 실행한다.

**SecurityFilterChain**: 개발자가 `SecurityConfig`에서 직접 구성하는 필터 목록. 어떤 경로가 인증이 필요한지, 어떤 필터를 어떤 순서로 실행할지 여기서 결정한다.

### SecurityContextHolder

인증 결과를 저장하는 공간이다. ThreadLocal 기반이라 같은 스레드 내 어디서든 꺼낼 수 있다.

```
SecurityContextHolder
    └── SecurityContext
            └── Authentication
                    ├── principal   ← 누구인지 (userId, UserDetails 등)
                    ├── credentials ← 비밀번호 (인증 후 보통 null로 클리어)
                    └── authorities ← 권한 목록 (ROLE_USER 등)
```

컨트롤러에서 `@AuthenticationPrincipal`로 꺼내는 값이 바로 이 `principal`이다.

---

## 1. 등장인물

| 클래스 | 역할 |
|--------|------|
| `SecurityConfig` | 어떤 경로가 인증 필요한지, 필터를 어디에 끼울지 설정 |
| `JwtExceptionFilter` | Filter에서 발생한 `CustomException`을 잡아 ApiResponse로 변환 |
| `JwtAuthenticationFilter` | 매 요청마다 실행. 토큰 꺼내서 검증하고 SecurityContext에 저장 |
| `JwtProvider` | 토큰 생성 / 검증 / 파싱 담당. 순수 유틸 역할 |

---

## 2. JWT 구조 이해

JWT는 `.`으로 구분된 세 파트다.

```
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMzYwMH0.abc123signature
└──────────┘└─────────────────────────────────────┘└────────┘
       Header                                     Payload                                Signature
```

**Header** (Base64 디코딩하면):
```json
{ "alg": "HS256" }
```

**Payload** (Base64 디코딩하면):
```json
{
  "sub": "123",           // subject = userId (우리가 넣는 값)
  "iat": 1700000000,      // issued at
  "exp": 1700003600       // expiration
}
```

**Signature** (검증용):
```
HMAC_SHA256(base64(header) + "." + base64(payload), secretKey)
```

서버만 `secretKey`를 알기 때문에 클라이언트가 payload를 수정하면 서명이 맞지 않아 검증 실패한다.
payload는 Base64라 **누구나 디코딩 가능**하다. 비밀번호 같은 민감 정보를 넣으면 안 된다.

---

## 3. 구현 방식 두 가지 비교

JWT 인증 필터를 구현하는 방식이 크게 두 가지 있다. 어떤 값을 `principal`로 저장하느냐의 차이다.

---

### Method A: UserDetailsService 기반 (실무 표준)

Spring Security가 원래 의도한 방식이다.

#### 필요한 구현체 1 — `UserDetails`

Spring Security가 인증 객체로 사용하는 인터페이스. 직접 구현해야 한다.

```java
// UserDetails를 구현한 커스텀 클래스
@Getter
public class CustomUserDetails implements UserDetails {

    private final Long userId;
    private final String email;
    private final String password;
    private final Collection<? extends GrantedAuthority> authorities;

    public CustomUserDetails(Member member) {
        this.userId = member.getId();
        this.email = member.getEmail();
        this.password = member.getPassword();
        // ROLE_USER 권한 부여
        this.authorities = List.of(new SimpleGrantedAuthority("ROLE_" + member.getRole().name()));
    }

    @Override
    public String getUsername() { return email; }

    @Override
    public boolean isAccountNonExpired() { return true; }

    @Override
    public boolean isAccountNonLocked() { return true; }

    @Override
    public boolean isCredentialsNonExpired() { return true; }

    @Override
    public boolean isEnabled() { return true; }
}
```

#### 필요한 구현체 2 — `UserDetailsService`

`loadUserByUsername()`은 Spring Security가 인증할 때 호출하는 메서드다.
JWT 방식에서는 **필터가 직접 이 메서드를 호출**한다.

```java
@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final MemberRepository memberRepository;

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        Member member = memberRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("유저를 찾을 수 없습니다: " + email));
        return new CustomUserDetails(member);
    }
}
```

#### JwtAuthenticationFilter (Method A)

```java
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtProvider jwtProvider;
    private final CustomUserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String token = jwtProvider.resolveToken(request.getHeader("Authorization"));

        if (token != null && jwtProvider.validateToken(token)) {
            // 토큰에서 email 추출 → DB 조회 → UserDetails 생성
            String email = jwtProvider.getEmailFromToken(token);
            UserDetails userDetails = userDetailsService.loadUserByUsername(email);  // ← 매 요청 DB 조회

            Authentication auth = new UsernamePasswordAuthenticationToken(
                userDetails,                    // principal = UserDetails 객체 전체
                null,
                userDetails.getAuthorities()    // 권한 정보도 함께 저장
            );
            SecurityContextHolder.getContext().setAuthentication(auth);
        }

        filterChain.doFilter(request, response);
    }
}
```

#### 컨트롤러에서 꺼내는 방법

```java
@GetMapping("/groups")
public ResponseEntity<?> getGroups(
        @AuthenticationPrincipal CustomUserDetails userDetails) {

    Long userId = userDetails.getUserId();
    String email = userDetails.getUsername();
    // 권한 분기도 가능
    boolean isAdmin = userDetails.getAuthorities().stream()
            .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));

    return ResponseEntity.ok(...);
}
```

**principal이 `UserDetails` 객체 전체**이므로 userId, email, 권한 등 모든 정보를 컨트롤러에서 바로 꺼낼 수 있다.

---

### Method B: userId(PK) 기반 (현재 프로젝트 방식)

UserDetails 구현체 없이, userId만 principal로 저장하는 방식이다.

#### JwtAuthenticationFilter (Method B)

```java
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtProvider jwtProvider;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String token = jwtProvider.resolveToken(request.getHeader("Authorization"));

        if (token != null && jwtProvider.validateToken(token)) {
            Long userId = jwtProvider.getUserIdFromToken(token);  // DB 조회 없음

            Authentication auth = new UsernamePasswordAuthenticationToken(
                userId,       // principal = Long
                null,
                emptyList()   // 권한 없음
            );
            SecurityContextHolder.getContext().setAuthentication(auth);
        }

        filterChain.doFilter(request, response);
    }
}
```

#### 컨트롤러에서 꺼내는 방법

```java
@GetMapping("/groups")
public ResponseEntity<?> getGroups(@LoginUser Long userId) {
    // userId만 있음. email이나 권한 정보는 없음.
    // 필요하면 서비스에서 DB 조회해야 함.
    return ResponseEntity.ok(...);
}
```

---

### 두 방식 비교

| | Method A (UserDetailsService) | Method B (userId, 현재) |
|--|--|--|
| principal | `UserDetails` 객체 | `Long` |
| 매 요청 DB 조회 | **있음** | **없음** |
| 권한 분기 (ROLE) | 자연스럽게 지원 | 추가 구현 필요 |
| OAuth2 확장 | 자연스러움 | 별도 처리 필요 |
| 실무 일반성 | 표준 패턴 | 프로젝트마다 다름 |
| 코드 복잡도 | UserDetails 구현 필요 | 단순 |

**언제 Method A를 선택하나:**
- ROLE_ADMIN, ROLE_USER 같은 권한 분기가 있을 때
- OAuth2 소셜 로그인 연동 예정일 때
- 팀 프로젝트에서 Spring Security 표준 패턴을 따를 때

**언제 Method B를 선택하나:**
- 권한 분기 없이 로그인 여부만 체크할 때
- 성능이 중요하고 매 요청 DB 조회를 줄이고 싶을 때
- 소규모 프로젝트에서 단순하게 가고 싶을 때

현재 프로젝트는 권한 분기 없이 로그인 여부만 확인하면 되므로 Method B를 사용한다.

---

## 4. 로그인 흐름 — 토큰이 만들어지기까지

```
클라이언트
  └── POST /api/v1/auth/login  { email, password }
        ↓ (permitAll → 필터 인증 검사 생략)
  AuthController.login()
        ↓
  AuthService.login()
    └── memberRepository.findByEmail(email) → 유저 조회
    └── passwordEncoder.matches(password, encoded) → 비밀번호 검증
        ↓
  JwtProvider.createAccessToken(userId)
    └── createToken(userId, ACCESS_TOKEN_TIME)
          └── Jwts.builder()
                .subject(String.valueOf(userId))  // PK를 불변 식별자로 사용
                .issuedAt(now)
                .expiration(now + 1시간)
                .signWith(key)                    // HS256 서명
                .compact()
    → 순수 토큰 문자열 반환 (Bearer 미포함)
        ↓
  JwtProvider.createRefreshToken(userId)
    → 동일 구조, 만료만 7일
        ↓
  Redis에 저장: key = "refresh:{userId}", value = refreshToken, TTL = 7일
  (로그아웃 시 삭제, 재발급 시 비교)
        ↓
클라이언트 응답:
{
  "success": true,
  "code": "LOGIN_SUCCESS",
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci..."
  }
}
```

**왜 `userId`(PK)를 subject로?**
username(이메일)을 넣으면 이메일 변경 시 기존 토큰이 다른 사람 것처럼 인식될 수 있다.
PK는 불변값이라 안전하다.

**왜 Bearer를 토큰에 안 붙이나?**
생성 시 붙이면 Redis 저장, 블랙리스트 키로 쓸 때마다 `substring(7)`을 반복해야 한다.
Bearer를 붙이고 떼는 역할은 Filter에서만 담당한다. (관심사 분리)

---

## 5. 인증된 API 요청 흐름 — 토큰을 들고 왔을 때

```
클라이언트
  └── GET /api/v1/groups
      Authorization: Bearer eyJhbGci...
        ↓
┌─────────────────────────────────────────────────┐
│            Spring Security Filter Chain          │
│                                                 │
│  [1] JwtExceptionFilter                         │ ← 가장 바깥
│      └── try { chain.doFilter() }               │
│                                                 │
│  [2] JwtAuthenticationFilter.doFilterInternal() │
│                                                 │
│      ① request.getHeader("Authorization")       │
│         → "Bearer eyJhbGci..."                  │
│                                                 │
│      ② jwtProvider.resolveToken(bearerToken)    │
│         → "Bearer " 제거 → 순수 토큰 문자열     │
│         → null이면 chain.doFilter() 통과         │
│                                                 │
│      ③ jwtProvider.validateToken(token)         │
│         → Jwts.parser()                         │
│             .verifyWith(key)                    │
│             .parseSignedClaims(token)           │
│         → 성공: 계속 진행                        │
│         → 만료: throw CustomException(TOKEN_EXPIRED)   │
│         → 변조: throw CustomException(TOKEN_INVALID)   │
│                                                 │
│      ④ (블랙리스트 확인 — 로그아웃 토큰 차단)    │
│         redisTemplate.hasKey("blacklist:" + token)     │
│         → true면 throw CustomException(TOKEN_INVALID)  │
│                                                 │
│      ⑤ jwtProvider.getUserInfoFromToken(token)  │
│         → Claims 추출                           │
│         → claims.getSubject() → "123" → 123L   │
│                                                 │
│      ⑥ UsernamePasswordAuthenticationToken      │
│         (principal=userId, credentials=null,    │
│          authorities=emptyList())               │
│         → SecurityContextHolder에 저장          │
│         → DB 조회 없이 userId만으로 인증 완료   │
└─────────────────────────────────────────────────┘
        ↓
  GroupController.getGroups(
      @LoginUser Long userId  ← SecurityContext에서 꺼냄
  )
        ↓
  응답 반환
```

### @LoginUser 컨트롤러 사용 예시

```java
@GetMapping("/groups")
public ResponseEntity<ApiResponse<List<GroupResponse>>> getGroups(
        @LoginUser Long userId) {

    // LoginUserArgumentResolver가 SecurityContext에서 userId를 꺼내서 주입
    List<GroupResponse> groups = groupService.getGroups(userId);
    return ResponseEntity.ok(ApiResponse.onSuccess(SuccessCode.GROUP_LIST_SUCCESS, groups));
}
```

principal로 `userId`를 바로 꺼낼 수 있는 이유:

```java
// JwtAuthenticationFilter에서 이렇게 저장했기 때문
new UsernamePasswordAuthenticationToken(
    userId,           // ← principal. LoginUserArgumentResolver가 이걸 꺼냄
    null,             // credentials (비밀번호 등 — JWT 방식에서는 불필요)
    emptyList()       // authorities (권한 목록 — 현재 미사용)
)
```

> **왜 `@AuthenticationPrincipal` 대신 `@LoginUser`를 직접 만들었나?**
> Spring Security의 `@AuthenticationPrincipal`은 `UserDetails` 기반으로 설계되어 있어서 principal이 `Long`일 때 오동작할 수 있다. 커스텀 `ArgumentResolver`를 직접 구현하면 타입 캐스팅을 명확하게 제어할 수 있다. 자세한 내용은 아래 섹션 참고.

---

## 6. @LoginUser — 커스텀 ArgumentResolver

### 왜 만들었나

Spring Security의 `@AuthenticationPrincipal`은 내부적으로 `UserDetails`를 꺼내도록 설계되어 있다.
현재 프로젝트는 principal을 `UserDetails`가 아닌 `Long`(userId)으로 저장하기 때문에 `@AuthenticationPrincipal`을 그대로 쓰면 타입 불일치로 오동작할 수 있다.

`HandlerMethodArgumentResolver`를 직접 구현해서 해결한다.

---

### 구현 코드

**`@LoginUser` 어노테이션**

```java
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface LoginUser {
}
```

**`LoginUserArgumentResolver`**

```java
@Component
public class LoginUserArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        // @LoginUser가 붙어 있고, 타입이 Long인 파라미터만 담당
        return parameter.hasParameterAnnotation(LoginUser.class)
                && parameter.getParameterType().equals(Long.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter,
                                  ModelAndViewContainer mavContainer,
                                  NativeWebRequest webRequest,
                                  WebDataBinderFactory binderFactory) throws Exception {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return (Long) authentication.getPrincipal();
    }
}
```

**`WebMvcConfig`에 등록**

```java
@Configuration
@RequiredArgsConstructor
public class WebMvcConfig implements WebMvcConfigurer {

    private final LoginUserArgumentResolver loginUserArgumentResolver;

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(loginUserArgumentResolver);
    }
}
```

---

### 동작 흐름

```
컨트롤러 파라미터 @LoginUser Long userId
    ↓
Spring이 HandlerMethodArgumentResolver 목록 순회
    ↓
LoginUserArgumentResolver.supportsParameter()
    → @LoginUser 붙어있고 타입이 Long? → true
    ↓
LoginUserArgumentResolver.resolveArgument()
    → SecurityContextHolder에서 Authentication 꺼내기
    → (Long) authentication.getPrincipal()  ← JwtFilter가 저장한 userId
    ↓
컨트롤러에 userId 주입 완료
```

---

### @AuthenticationPrincipal vs @LoginUser

| | `@AuthenticationPrincipal` | `@LoginUser` (커스텀) |
|--|--|--|
| principal 타입 | `UserDetails` 기반 | `Long` 명시적 캐스팅 |
| Spring Security 의존 | 컨트롤러까지 침투 | Resolver에만 존재 |
| 커스텀 로직 | 불가 | 가능 (null 체크 등) |

---

## 7. 토큰이 없는 요청 흐름

### permitAll 경로 (로그인, 회원가입 등)

```
클라이언트
  └── POST /api/v1/auth/login  (토큰 없음)
        ↓
  JwtAuthenticationFilter
    └── resolveToken() → null
    └── chain.doFilter() 바로 통과 → 인증 없이 진입
        ↓
  AuthController.login()
```

### 인증 필요 경로인데 토큰이 없는 경우

```
클라이언트
  └── GET /api/v1/groups  (토큰 없음)
        ↓
  JwtAuthenticationFilter
    └── resolveToken() → null
    └── chain.doFilter() 통과 (필터는 그냥 넘김)
        ↓
  SecurityConfig의 authorizeHttpRequests
    └── anyRequest().authenticated() → 인증 안 됨 → 401 반환
```

토큰이 없으면 필터가 그냥 통과시키고,
**인증이 필요한지 여부는 SecurityConfig의 `authorizeHttpRequests`가 결정**한다.

---

## 8. 토큰 에러 흐름 — JwtExceptionFilter가 왜 필요한가

```
JwtAuthenticationFilter
  └── validateToken()
        └── throw new CustomException(TOKEN_EXPIRED)
              ↓
        ??? 누가 잡나 ???
```

`@RestControllerAdvice`(`GlobalExceptionHandler`)는 **DispatcherServlet 이후**에서만 동작한다.
Filter는 DispatcherServlet **앞**에서 실행되므로 `CustomException`이 터져도 GlobalExceptionHandler가 잡지 못한다.
잡지 못하면 Spring 기본 에러 응답이 나간다.

```json
// GlobalExceptionHandler 없이 Filter에서 예외 터지면
{
  "timestamp": "2026-04-01T12:00:00",
  "status": 401,
  "error": "Unauthorized",
  "path": "/api/v1/groups"
}
```

`ApiResponse` 포맷이 아니라 클라이언트가 파싱하기 어렵다.

**해결: `JwtExceptionFilter`를 `JwtAuthenticationFilter` 앞에 배치**

```java
@Component
public class JwtExceptionFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            filterChain.doFilter(request, response);  // JwtAuthenticationFilter 실행
        } catch (CustomException e) {
            // Filter에서 터진 CustomException을 여기서 잡아 직접 응답 작성
            setErrorResponse(response, e.getBaseErrorCode());
        }
    }

    private void setErrorResponse(HttpServletResponse response, BaseErrorCode errorCode) throws IOException {
        ResponseDto reason = errorCode.getReasonHttpStatus();
        response.setStatus(reason.getHttpStatus().value());
        response.setContentType("application/json;charset=UTF-8");

        ApiResponse<Void> apiResponse = ApiResponse.onFailure(errorCode);
        response.getWriter().write(new ObjectMapper().writeValueAsString(apiResponse));
    }
}
```

```
// SecurityConfig 필터 등록 순서
JwtExceptionFilter          ← 가장 바깥 (CustomException을 try-catch로 감쌈)
    └── JwtAuthenticationFilter  ← 안쪽 (예외를 던지는 곳)
```

```java
// SecurityConfig에 등록
.addFilterBefore(new JwtAuthenticationFilter(jwtProvider), UsernamePasswordAuthenticationFilter.class)
.addFilterBefore(jwtExceptionFilter, JwtAuthenticationFilter.class)
```

이제 `JwtAuthenticationFilter`에서 `CustomException`이 터지면:

```
throw CustomException(TOKEN_EXPIRED)
    ↓
JwtExceptionFilter의 catch (CustomException e)
    ↓
response에 직접 ApiResponse 포맷으로 작성
    ↓
클라이언트:
{
  "success": false,
  "code": "TOKEN_EXPIRED",
  "message": "토큰이 만료되었습니다.",
  "data": null
}
```

---

## 9. Refresh Token 재발급 흐름

Access Token이 만료됐을 때 Refresh Token으로 새 Access Token을 발급받는 흐름이다.

```
클라이언트
  └── POST /api/v1/auth/reissue
      Authorization: Bearer 만료된_accessToken
      Body: { "refreshToken": "eyJhbGci..." }
        ↓ (permitAll 경로)
  AuthController.reissue()
        ↓
  AuthService.reissue(refreshToken)
    ├── jwtProvider.validateToken(refreshToken)  → 유효성 검증
    ├── claims.getSubject() → userId 추출
    ├── Redis.get("refresh:{userId}") → 저장된 refreshToken 조회
    │     └── 불일치 시 → CustomException(TOKEN_INVALID)  (탈취 의심)
    ├── jwtProvider.createAccessToken(userId)    → 새 Access Token 발급
    └── (선택) Refresh Token도 재발급 후 Redis 갱신  ← Refresh Token Rotation
        ↓
클라이언트:
{
  "success": true,
  "code": "TOKEN_REISSUED",
  "data": { "accessToken": "eyJhbGci...새토큰" }
}
```

**Refresh Token Rotation이란?**
재발급 시 Refresh Token도 새로 만들어서 기존 것을 무효화한다.
Refresh Token이 탈취됐더라도 한 번 사용되면 다음 요청부터 막을 수 있다.

---

## 10. 로그아웃 흐름 — Redis 블랙리스트

```
클라이언트
  └── POST /api/v1/auth/logout
      Authorization: Bearer eyJhbGci...
        ↓
  JwtAuthenticationFilter → 정상 인증 완료
        ↓
  AuthController.logout(@LoginUser Long userId, bearerToken)
        ↓
  AuthService.logout(userId, accessToken)
    ├── Redis.delete("refresh:{userId}")         → Refresh Token 삭제
    │     (이제 Refresh Token으로 재발급 불가)
    └── 남은 Access Token 만료 전까지 사용 가능 문제 해결:
        Redis.set("blacklist:{accessToken}", "logout", TTL = 남은만료시간)
        (jwtProvider.getExpiration(accessToken)으로 TTL 계산)
        ↓
  이후 동일 Access Token으로 요청 시:
  JwtAuthenticationFilter
    └── ④ redisTemplate.hasKey("blacklist:{token}")
          → true → throw CustomException(TOKEN_INVALID) → 401
```

**왜 블랙리스트가 필요한가?**
JWT는 서버가 상태를 갖지 않는다. 로그아웃해도 토큰 자체는 만료 전까지 유효하다.
Refresh Token만 삭제하면 재발급은 막히지만, 기존 Access Token(1시간)은 그대로 쓸 수 있다.
블랙리스트에 올려야 완전히 차단된다.

---

## 11. SecurityConfig 전체 구조

```java
@Configuration
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtProvider jwtProvider;       // final 필수
    private final JwtExceptionFilter jwtExceptionFilter;  // @Component라 주입 가능
```

> **주의:** `private JwtProvider jwtProvider`처럼 `final`을 빠뜨리면
> `@RequiredArgsConstructor`가 생성자 주입을 만들지 않아 `jwtProvider`가 `null`이 됩니다.
> Filter 실행 시 NPE가 터집니다.

```
SecurityConfig가 설정하는 것:

1. CSRF 비활성화
   → JWT는 stateless. 세션 쿠키 기반 CSRF 공격이 성립 안 함.

2. Session STATELESS
   → 서버가 세션을 만들지 않음. 매 요청을 토큰으로만 판단.

3. permitAll 경로
   → /api/v1/auth/** (로그인, 회원가입, 재발급)
   → /api/v1/health

4. 필터 등록 순서
   JwtExceptionFilter
       → JwtAuthenticationFilter
           → UsernamePasswordAuthenticationFilter
               → ... (이후 Spring Security 기본 필터들)
```

**왜 `JwtAuthenticationFilter`를 `@Bean`이 아닌 `new`로 생성하나?**

`OncePerRequestFilter`를 상속한 클래스를 `@Bean`으로 등록하면 Spring Boot가 자동으로 기본 서블릿 필터 체인에도 등록한다. 결과적으로 필터가 **두 번** 실행된다. `new`로 직접 생성해서 `addFilterBefore()`에만 등록하면 중복 실행을 막을 수 있다.

`JwtExceptionFilter`는 `@Component`로 등록했으므로 `SecurityConfig`에서 주입받아 사용한다. 이 경우 `FilterRegistrationBean`으로 기본 등록을 비활성화해야 중복 실행을 막을 수 있다.

```java
@Bean
public FilterRegistrationBean<JwtExceptionFilter> jwtExceptionFilterRegistration(
        JwtExceptionFilter filter) {
    FilterRegistrationBean<JwtExceptionFilter> bean = new FilterRegistrationBean<>(filter);
    bean.setEnabled(false);  // 기본 서블릿 필터 체인 등록 비활성화
    return bean;
}
```

---

## 12. @PostConstruct가 필요한 이유

```java
@PostConstruct
public void init() {
    byte[] keyBytes = Decoders.BASE64.decode(secretKey);
    key = Keys.hmacShaKeyFor(keyBytes);
}
```

```
Spring 빈 생성 순서:

① JwtProvider 객체 생성 (생성자 호출)
   → 이 시점에 secretKey = null
   → 생성자에서 key를 만들면 NPE

② @Value 주입
   → secretKey = "base64인코딩된값" (application.yml에서)

③ @PostConstruct 실행       ← key를 만드는 안전한 시점
   → BASE64 디코딩 → hmacShaKeyFor() → SecretKey 생성 완료
```

---

## 13. OncePerRequestFilter를 선택한 이유

`JwtAuthenticationFilter`는 `OncePerRequestFilter`를 상속한다.

일반 `Filter` 또는 `GenericFilterBean`은 서블릿 forward/include 시 **같은 요청에서 여러 번 호출될 수 있다.**
`OncePerRequestFilter`는 한 요청당 **정확히 한 번**만 실행되도록 보장한다.
JWT 검증을 두 번 하는 낭비와 SecurityContext 중복 설정을 방지할 수 있다.

---

## 14. 전체 컴포넌트 관계

```
application.yml
  └── jwt.secret / access-expiration / refresh-expiration
        ↓ @Value
  JwtProvider (@Component)
    ├── createAccessToken()      ← AuthService
    ├── createRefreshToken()     ← AuthService
    ├── validateToken()          ← JwtAuthenticationFilter
    ├── getUserInfoFromToken()   ← JwtAuthenticationFilter
    ├── resolveToken()           ← JwtAuthenticationFilter
    └── getExpiration()          ← AuthService (블랙리스트 TTL 계산)

  JwtExceptionFilter (@Component)
    └── Filter에서 발생한 CustomException → ApiResponse 포맷으로 응답

  JwtAuthenticationFilter (new로 생성)
    └── validateToken → getUserInfoFromToken → SecurityContextHolder 저장

  SecurityConfig
    ├── JwtExceptionFilter → JwtAuthenticationFilter → UPAF 순서 등록
    └── permitAll / anyRequest().authenticated() 설정

  Redis
    ├── key: "refresh:{userId}" → Refresh Token 저장
    └── key: "blacklist:{accessToken}" → 로그아웃된 Access Token
```

---

## 흐름 요약

| 상황 | 동작 |
|------|------|
| 토큰 없음 + permitAll 경로 | 필터 통과 → 컨트롤러 진입 |
| 토큰 없음 + 인증 필요 경로 | 필터 통과 → Security가 **401** 반환 |
| 토큰 유효 | SecurityContext에 userId 저장 → `@LoginUser`로 꺼냄 |
| 토큰 만료 | `TOKEN_EXPIRED` → JwtExceptionFilter → **401** ApiResponse |
| 토큰 변조 | `TOKEN_INVALID` → JwtExceptionFilter → **401** ApiResponse |
| 블랙리스트 토큰 (로그아웃) | `TOKEN_INVALID` → JwtExceptionFilter → **401** ApiResponse |
| Refresh Token 재발급 | validateToken → Redis 비교 → 새 AccessToken 발급 |
