---
title: Redis 분산락으로 결제 동시성 문제 해결하기
date: 2026-03-25
tags:
  - Redis
  - Spring Boot
  - 분산락
excerpt: 멀티 인스턴스 환경에서 동일 요청이 중복 처리되는 문제를 발견. Redisson을 활용한 분산락 적용 과정과 타임아웃 전략을 정리했습니다.
category: troubleshooting
---

멀티 인스턴스 환경에서 동일 요청이 중복 처리되는 문제를 발견. Redisson을 활용한 분산락 적용 과정과 타임아웃 전략을 정리했습니다.
