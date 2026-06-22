---
title: 가비지 컬렉션 (GC)
category: java
description: 더 이상 참조되지 않는 객체를 자동 회수하는 JVM 메커니즘. 세대별 GC와 Stop-the-world.
---

GC는 Heap에서 **더 이상 참조되지 않는 객체**를 찾아 메모리를 자동 회수한다. 개발자가 직접 free 하지 않아도 되는 이유.

## 도달 가능성 (Reachability)

GC Root(스택의 지역 변수, static 필드 등)에서 **참조로 도달 가능한지**로 생존을 판단. 도달 불가 객체가 회수 대상.

## 세대별 GC

대부분의 객체는 금방 죽는다는 가설(weak generational hypothesis)에 기반:

- **Young** (Eden + Survivor) — 새 객체. Minor GC가 자주, 빠르게.
- **Old** — 오래 살아남은 객체. Major(Full) GC는 드물지만 비쌈.

## Stop-the-world

GC가 도는 동안 애플리케이션 스레드가 멈추는 구간. 이 시간을 줄이는 게 GC 튜닝의 핵심.

> G1, ZGC, Shenandoah 등은 STW를 짧게 유지하려는 수집기. 처리량 vs 지연 사이의 선택이다.
