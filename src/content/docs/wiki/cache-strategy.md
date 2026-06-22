---
title: 캐시 전략
category: redis
description: Look-aside·Write-through·Write-back 등 캐시 읽기·쓰기 패턴과 무효화(TTL) 고려사항.
---

캐시는 느린 저장소(DB) 앞에 빠른 저장소(Redis 등)를 둬서 응답을 빠르게 한다. 핵심은 **언제 채우고 언제 비우냐**.

## 읽기 패턴

- **Look-aside (Cache-aside)** — 앱이 캐시를 먼저 조회, 없으면(miss) DB에서 읽어 캐시에 채움. 가장 흔함.

## 쓰기 패턴

- **Write-through** — 쓸 때 캐시와 DB를 함께 갱신. 일관성↑, 쓰기 지연↑.
- **Write-back (Write-behind)** — 캐시에 먼저 쓰고 DB는 나중에 일괄. 빠르지만 유실 위험.

## 무효화 & 문제

- **TTL** 로 만료시켜 stale 데이터를 제한.
- **Cache stampede** — 인기 키가 동시에 만료되면 DB로 요청이 몰림 → TTL 지터, 락, 미리 갱신으로 완화.
- **캐시 일관성** — DB만 바뀌고 캐시가 남는 경우. 보통 갱신 시 캐시를 **삭제(invalidate)** 하는 쪽이 안전.

> "캐시를 갱신할까 삭제할까"는 보통 **삭제**가 답. 갱신은 경쟁 상황에서 stale 값을 남기기 쉽다.
