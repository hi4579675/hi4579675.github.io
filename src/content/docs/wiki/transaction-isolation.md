---
title: 트랜잭션 격리 수준
category: database
description: READ UNCOMMITTED ~ SERIALIZABLE 4단계와 각 단계에서 막히는 이상 현상(dirty/non-repeatable/phantom read).
---

격리 수준은 동시에 실행되는 트랜잭션이 서로를 **얼마나 볼 수 있는지**를 정한다. 낮을수록 동시성↑·일관성↓, 높을수록 그 반대.

## 4단계

| 수준 | dirty read | non-repeatable read | phantom read |
|---|---|---|---|
| READ UNCOMMITTED | O | O | O |
| READ COMMITTED | X | O | O |
| REPEATABLE READ | X | X | O* |
| SERIALIZABLE | X | X | X |

## 이상 현상

- **Dirty read** — 커밋 안 된 변경을 읽음.
- **Non-repeatable read** — 같은 행을 두 번 읽었는데 값이 다름(중간에 다른 트랜잭션이 수정·커밋).
- **Phantom read** — 같은 조건으로 두 번 조회했는데 행 수가 달라짐(삽입·삭제).

## 참고

- MySQL InnoDB 기본값은 **REPEATABLE READ**, 대부분의 다른 DB는 **READ COMMITTED**.
- InnoDB는 MVCC + 갭 락으로 REPEATABLE READ에서도 팬텀을 상당 부분 막는다(표의 `O*`).
