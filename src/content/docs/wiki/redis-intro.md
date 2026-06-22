---
title: Redis란
category: redis
description: 인메모리 Key-Value 저장소 Redis의 정의와 "왜 빠른가", 핵심 특징, 그리고 캐시를 넘어선 쓰임새 개요.
---

**Redis(Remote Dictionary Server)** 는 메모리에 데이터를 두는 **인메모리 Key-Value 저장소**다. 단순 캐시를 넘어 자료구조 서버·메시지 브로커로도 쓰인다.

## 왜 빠른가

- **In-memory** — 디스크가 아닌 RAM에서 읽고 쓴다. 디스크 I/O가 없어 마이크로초 단위 응답.
- **싱글 스레드** — 명령을 한 줄로 처리해 **락 경합·컨텍스트 스위칭이 없다**. 그래서 원자적 연산이 단순하고 빠르다. (I/O는 멀티플렉싱으로 처리)
- **효율적 자료구조** — 값마다 용도에 맞는 내부 인코딩을 골라 메모리·연산을 최적화. → [Redis 자료구조](/wiki/redis-data-structures/)

## 핵심 특징

- **다양한 자료구조** — String·List·Hash·Set·Sorted Set·Stream 등을 서버에서 직접 조작.
- **TTL** — 키에 만료 시간을 줘 자동 삭제(캐시·세션에 유용).
- **원자적 연산** — `INCR`, `SETNX` 등 단일 명령이 원자적 → 카운터·분산 락의 기반.
- **영속화 옵션** — 인메모리지만 디스크에 남길 수 있다. → [Redis 영속화](/wiki/redis-persistence/)

## 어디에 쓰나 (개요)

캐싱, 세션·토큰 저장, 카운터, 랭킹, 분산 락, Rate Limiting, Pub/Sub 등. 구체적인 사례는 [Redis 활용 사례](/wiki/redis-use-cases/), MSA에서의 역할은 [MSA와 Redis](/wiki/redis-msa/) 참고.

> "DB 앞단의 빠른 캐시"가 가장 흔한 출발점이지만, Redis의 진짜 가치는 **서버에서 자료구조를 원자적으로 다룬다**는 데 있다.
