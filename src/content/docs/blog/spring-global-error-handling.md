---
title: "Spring Boot 전역 에러 핸들링 구조 설계기 — 왜 이렇게 만들었는가"
date: 2026-04-03
tags:
  - Spring Boot
excerpt: 끼리(KKiri) 프로젝트에서 전역 에러 핸들링 구조를 설계한 과정을 기록합니다. 단순히 "이렇게 구현했다"가 아니라 왜 이 구조를 선택했는지에 집중합니다.
category: develops
---

> 개인 프로젝트 **끼리(KKiri)** 를 개발하면서 전역 에러 핸들링 구조를 설계한 과정을 기록합니다.
> 단순히 "이렇게 구현했다"가 아니라 **왜 이 구조를 선택했는지** 에 집중해서 작성했습니다.

---

## 들어가며

API를 개발하다 보면 에러 처리는 항상 따라오는 숙제다.
처음엔 간단해 보이지만, 서비스가 커질수록 각 Controller마다 try-catch가 반복되고
응답 포맷이 제각각이 되어 버리는 경험을 한 번쯤 해봤을 것이다.

이 글은 다음 세 가지 고민에서 시작했다.

1. **성공/실패 응답 포맷을 어떻게 통일할까?**
2. **에러 코드를 어떤 구조로 관리할까?**
3. **확장을 고려한 설계가 가능한가?**

---

## 전체 구조 한눈에 보기

```
BaseCode (interface)          BaseErrorCode (interface)
      ↑                              ↑
SuccessCode (enum)            ErrorCode (enum)
      ↓                              ↓
                    ApiResponse<T>
                         ↓
              GlobalExceptionHandler
                         ↑
                   CustomException
```

각 레이어가 인터페이스 타입만 바라보도록 설계했다.
구체적인 `ErrorCode` 가 추가되더라도 핸들러는 수정할 필요가 없다.

---

## 1. 응답 포맷 통일 — ApiResponse

가장 먼저 한 일은 성공과 실패 응답 포맷을 통일하는 것이었다.

### 왜 통일이 필요한가?

통일되지 않은 응답은 클라이언트(앱)에 부담을 준다.

```json
// API마다 포맷이 다르면
{ "user": { ... } }           // 어떤 API
{ "data": { ... } }           // 다른 API
{ "result": "ok" }            // 또 다른 API
```

클라이언트가 API마다 다른 파싱 로직을 작성해야 한다.

### 설계 결정 — ApiResponse\<T\>

```java
public record ApiResponse<T>(
        boolean success,
        String code,
        String message,
        T data
) { }
```

모든 응답은 이 포맷으로 통일한다.

```json
// 성공
{
  "success": true,
  "code": "LOGIN_SUCCESS",
  "message": "로그인에 성공했습니다.",
  "data": { "accessToken": "..." }
}

// 실패
{
  "success": false,
  "code": "USER_NOT_FOUND",
  "message": "유저를 찾을 수 없습니다.",
  "data": null
}
```

클라이언트는 `success` 하나만 보고 분기하면 된다.

### 고민 — 에러 응답에 ApiResponse\<?\> 를 쓸까?

처음엔 이렇게 쓰려 했다.

```java
public ResponseEntity<ApiResponse<?>> handleCustomException(CustomException e) { ... }
```

그런데 `<?>` 는 "뭔가 있긴 한데 뭔지 모른다"는 의미라 의도가 불명확하다.
에러 응답은 `data` 가 없으므로 `ApiResponse<Void>` 가 더 명확하다.

```java
// 채택
public ResponseEntity<ApiResponse<Void>> handleCustomException(CustomException e) { ... }
```

---

## 2. 공통 응답 DTO — ResponseDto

`ErrorCode` 와 `SuccessCode` 가 반환하는 공통 응답 객체다.

```java
@Getter
@Builder
public class ResponseDto {
    private final HttpStatus httpStatus;
    private final String code;
    private final String message;
    private final boolean isSuccess; // 성공이면 true, 실패면 false
}
```

`ApiResponse` 와의 차이점: `ResponseDto` 는 **HTTP 상태 코드와 성공 여부를 함께 담는 내부 전달 객체**다.
`ApiResponse` 는 클라이언트에게 실제로 전달되는 응답 바디다.

흐름은 이렇다.

```
ErrorCode.getReasonHttpStatus() → ResponseDto 반환
    → ApiResponse.onFailure(ResponseDto) → ResponseEntity 생성
        → 클라이언트에게 전달
```

---

## 3. 에러 코드 관리 — BaseErrorCode 인터페이스

### 단순하게 갈 수도 있었다

```java
public enum ErrorCode {
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "유저를 찾을 수 없습니다."),
    GROUP_NOT_FOUND(HttpStatus.NOT_FOUND, "그룹을 찾을 수 없습니다."),
    // ...
}
```

이 방식은 간단하지만 문제가 있다.
도메인이 늘어날수록 **하나의 파일에 모든 에러가 쌓인다.**
팀 프로젝트에선 파일 충돌도 난다.

### 설계 결정 — 인터페이스 기반 구조

```java
public interface BaseErrorCode {
    ResponseDto getReasonHttpStatus();
}
```

`BaseErrorCode` 인터페이스를 만들고 `ErrorCode` 가 이를 구현한다.

```java
public enum ErrorCode implements BaseErrorCode {
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "유저를 찾을 수 없습니다."),
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "잘못된 요청입니다."),
    INTERNAL_SERVER_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "서버 오류가 발생했습니다."),
    // ...

    private final HttpStatus status;
    private final String message;

    @Override
    public ResponseDto getReasonHttpStatus() {
        return ResponseDto.builder()
                .httpStatus(status)
                .code(name())
                .message(message)
                .isSuccess(false)
                .build();
    }
}
```

`GlobalExceptionHandler` 와 `ApiResponse` 는 구체적인 `ErrorCode` 대신
**`BaseErrorCode` 인터페이스 타입만 받는다.**

```java
// 인터페이스 타입만 받으므로 어떤 ErrorCode든 처리 가능
public static <T> ResponseEntity<ApiResponse<T>> onFailure(BaseErrorCode errorCode) { ... }
```

### 확장 시나리오

DDD 구조에서는 도메인별로 이렇게 분리된다.

```java
// user 도메인
public enum UserErrorCode implements BaseErrorCode { ... }

// group 도메인
public enum GroupErrorCode implements BaseErrorCode { ... }

// post 도메인
public enum PostErrorCode implements BaseErrorCode { ... }
```

던지는 방식은 항상 동일하다.

```java
throw new CustomException(UserErrorCode.USER_NOT_FOUND);
throw new CustomException(GroupErrorCode.GROUP_FULL);
```

`GlobalExceptionHandler` 는 `BaseErrorCode` 인터페이스만 바라보기 때문에
새 도메인 에러 코드가 추가돼도 핸들러를 수정할 필요가 없다.

---

## 4. CustomException — 비즈니스 예외의 단일 창구

Service 계층에서 비즈니스 예외를 던질 때 사용하는 클래스다.

```java
public class CustomException extends RuntimeException {

    private final BaseErrorCode baseErrorCode;

    public CustomException(BaseErrorCode baseErrorCode) {
        // RuntimeException의 message도 채워줌
        // → 로그에서 e.getMessage()로 바로 확인 가능
        super(baseErrorCode.getReasonHttpStatus().getMessage());
        this.baseErrorCode = baseErrorCode;
    }
}
```

`super()`에 메시지를 넘기는 이유: `GlobalExceptionHandler` 에서 `e.getMessage()` 로 바로 꺼낼 수 있어야 하기 때문이다.

처음엔 이렇게 했다가 실수를 했다. (삽질 기록에서 다룬다)

---

## 5. SuccessCode — 성공 응답도 코드로 관리

`BaseCode` 인터페이스를 `BaseErrorCode` 와 대칭으로 만들었다.

```java
public interface BaseCode {
    ResponseDto getReasonHttpStatus();
}
```

```java
public enum SuccessCode implements BaseCode {

    // Auth
    LOGIN_SUCCESS(HttpStatus.OK, "로그인에 성공했습니다."),
    TOKEN_REFRESHED(HttpStatus.OK, "토큰이 갱신되었습니다."),

    // Group
    GROUP_CREATED(HttpStatus.CREATED, "그룹이 생성되었습니다."),
    GROUP_JOINED(HttpStatus.OK, "그룹에 합류했습니다."),

    // Post
    POST_CREATED(HttpStatus.CREATED, "포스트가 업로드되었습니다."),
    // ...

    @Override
    public ResponseDto getReasonHttpStatus() {
        return ResponseDto.builder()
                .httpStatus(status)
                .code(name())
                .message(message)
                .isSuccess(true)
                .build();
    }
}
```

### 왜 SuccessCode가 필요한가?

성공 응답을 `code: "SUCCESS"` 로 고정하면 클라이언트가 **어떤 API에 대한 응답인지 구분하기 어렵다.**

```json
// code가 항상 "SUCCESS"라면
{ "success": true, "code": "SUCCESS", "data": { ... } }
```

`SuccessCode` 를 쓰면 응답만 봐도 어떤 동작이 완료됐는지 알 수 있다.

```json
{ "success": true, "code": "GROUP_CREATED", "message": "그룹이 생성되었습니다.", "data": { ... } }
```

Controller에서는 이렇게 사용한다.

```java
return ApiResponse.onSuccess(SuccessCode.LOGIN_SUCCESS, tokenResponse);
```

---

## 6. GlobalExceptionHandler — 중앙 에러 처리

모든 예외를 한 곳에서 처리한다.

```java
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * [비즈니스 커스텀 예외 처리]
     * Service 계층에서 throw new CustomException(ErrorCode.XXX) 시 호출됨.
     */
    @ExceptionHandler(CustomException.class)
    public ResponseEntity<ApiResponse<Void>> handleCustomException(CustomException e) {
        log.error("[CustomException] code={}, message={}",
                e.getBaseErrorCode().getReasonHttpStatus().getCode(),
                e.getMessage());
        return ApiResponse.onFailure(e.getBaseErrorCode());
    }

    /**
     * [@Valid 검증 실패 처리]
     * Request DTO의 @Valid 검증 실패 시 호출됨.
     * 여러 필드 에러 중 첫 번째 메시지만 반환.
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidException(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().get(0).getDefaultMessage();
        log.error("[ValidationException] message={}", message);
        return ApiResponse.onFailure(ErrorCode.INVALID_REQUEST, message);
    }

    /**
     * [예상치 못한 서버 에러 처리]
     * 위에서 잡히지 않은 모든 예외의 최종 처리.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleException(Exception e) {
        log.error("[UnhandledException] message={}", e.getMessage(), e);
        return ApiResponse.onFailure(ErrorCode.INTERNAL_SERVER_ERROR);
    }
}
```

### Validation 메시지 처리

`@Valid` 검증 실패 시 동적 메시지를 사용해야 한다.

```java
// DTO
@NotBlank(message = "닉네임을 입력해주세요.")
private String nickname;
```

`getDefaultMessage()` 로 꺼낸 뒤 `onFailure` 오버로드에 넘긴다.

```java
// 오버로드 2개로 분리
ApiResponse.onFailure(BaseErrorCode errorCode)              // 일반 에러 — 코드에 정의된 메시지 사용
ApiResponse.onFailure(BaseErrorCode errorCode, String msg)  // 커스텀 메시지 — Validation 등에서 사용
```

---

## 7. 삽질 기록

### toString() vs getMessage()

`CustomException` 을 처음 이렇게 작성했다.

```java
public CustomException(BaseErrorCode baseErrorCode) {
    super(baseErrorCode.getReasonHttpStatus().toString()); // ❌ 잘못됨
    this.baseErrorCode = baseErrorCode;
}
```

`toString()` 은 객체 전체를 문자열로 변환하기 때문에 로그에 이렇게 찍혔다.

```
ResponseDto(httpStatus=NOT_FOUND, code=USER_NOT_FOUND, message=유저를 찾을 수 없습니다., isSuccess=false)
```

`getMessage()` 로 수정하니 메시지만 깔끔하게 출력됐다.

```java
super(baseErrorCode.getReasonHttpStatus().getMessage()); // ✅ 수정
```

### Validation에서 e.getMessage() 를 넘긴 실수

```java
String message = e.getBindingResult().getFieldErrors().get(0).getDefaultMessage();
return ApiResponse.onFailure(ErrorCode.INVALID_REQUEST, e.getMessage()); // ❌ 잘못됨
```

`message` 변수를 뽑아놓고 정작 `e.getMessage()` 를 넘겼다.
`e.getMessage()` 는 Spring 내부 메시지라 클라이언트에게 그대로 노출하면 안 된다.

```java
return ApiResponse.onFailure(ErrorCode.INVALID_REQUEST, message); // ✅ 수정
```

### ErrorCode에 implements 누락

```java
public enum ErrorCode { ... } // ❌ BaseErrorCode 구현 안 됨
```

`getReasonHttpStatus()` 가 없으니 `ApiResponse.onFailure()` 에 `ErrorCode` 를 넘길 수 없었다.
`implements BaseErrorCode` 추가 후 메서드를 구현해서 해결했다.

---

## 마무리

이 구조를 한 줄로 요약하면 이렇다.

> **`CustomException` 하나만 알면 어디서든 에러를 던질 수 있고,
> `GlobalExceptionHandler` 가 모든 에러를 잡아 일관된 포맷으로 응답한다.**

DDD 구조에서 도메인별로 에러 코드가 분리되어 있어도
`GlobalExceptionHandler` 는 `BaseErrorCode` 인터페이스만 바라보기 때문에 변경이 없다.
새 도메인이 추가될 때 `implements BaseErrorCode` 한 줄로 자연스럽게 편입된다.

좋은 설계는 미래의 변경 비용을 줄이는 것이라고 생각한다.
