---
title: Redis 활용 사례
category: redis
description: 캐싱·토큰 저장·카운터·랭킹·분산 락·Rate Limiting — Redis가 실무에서 어떤 문제를 푸는지 사례 중심 카탈로그.
---

Redis가 "왜 빠른가/무엇인가"는 [Redis란](/wiki/redis-intro/)에서 다룬다. 여기서는 **어떤 문제에 쓰는지**를 사례별로 짧게 정리한다.

## 1. 캐싱

DB 부하를 줄이는 가장 흔한 용도. 자주 읽고 잘 안 바뀌는 데이터를 Redis에 두고 먼저 조회한다. 읽기/쓰기 패턴(Look-aside 등)과 무효화는 → [캐시 전략](/wiki/cache-strategy/).

## 2. 세션 · 토큰 저장

로그인 세션, JWT **Refresh Token**, 로그아웃된 Access Token **블랙리스트**를 TTL과 함께 저장. 여러 서버가 같은 토큰 상태를 공유한다. → [MSA와 Redis](/wiki/redis-msa/)

## 3. 카운터

조회수·좋아요처럼 **빈번한 증가**는 매번 DB UPDATE하면 부하가 크다. `INCR`은 원자적이라 동시성 안전하게 빠르게 센다. 주기적으로 DB에 반영(write-behind).

## 4. 랭킹

**Sorted Set**으로 점수 기반 정렬을 O(log N)에 유지. 실시간 좋아요·점수 랭킹에 적합. DB의 `ORDER BY ... LIMIT`보다 훨씬 가볍다. → 자료구조 상세는 [Redis 자료구조](/wiki/redis-data-structures/)

## 5. 분산 락

여러 서버가 한 자원에 동시에 접근할 때, `SETNX`(키가 없을 때만 set) 원자성으로 락을 잡는다. 실무에선 **Redisson**으로 만료·재시도·안전 해제를 다룬다. 선착순 쿠폰·재고 차감 같은 경합 제어에 쓰인다.

## 6. Rate Limiting

API 호출 횟수 제한. 키에 `INCR` + TTL로 윈도 단위 카운트.

- **Fixed Window** — 단순하지만 경계에서 순간 2배 허용 문제.
- **Sliding Window / Token Bucket** — 더 매끄럽게 제어.

> 공통점: **빠르고, 원자적이고, TTL로 잘 만료되는** 데이터. 영구 원본은 DB에, 빠르게 변하는 상태는 Redis에 두는 게 기본 분담이다.
