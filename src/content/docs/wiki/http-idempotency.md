---
title: HTTP 메서드와 멱등성
category: network
description: GET·POST·PUT·PATCH·DELETE의 안전성(safe)과 멱등성(idempotent) 정리, 그리고 재시도 설계와의 관계.
---

## 안전성 vs 멱등성

- **Safe** — 서버 상태를 바꾸지 않음(읽기 전용).
- **Idempotent** — 같은 요청을 여러 번 보내도 **결과 상태가 동일**. (응답 바디가 같다는 뜻이 아니라, 서버 상태가 같다는 뜻.)

| 메서드 | Safe | Idempotent |
|---|---|---|
| GET | O | O |
| HEAD | O | O |
| PUT | X | O |
| DELETE | X | O |
| POST | X | X |
| PATCH | X | △ (구현에 따라) |

## 왜 중요한가

네트워크는 응답이 유실될 수 있어 **재시도**가 흔하다. 멱등한 메서드는 중복 요청이 와도 안전하다.

> POST는 멱등이 아니라서 중복 결제·중복 생성이 생길 수 있다. 이를 막으려면 **Idempotency-Key** 헤더로 같은 요청을 식별해 한 번만 처리하도록 설계한다.
