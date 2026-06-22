---
title: JVM 메모리 구조
category: java
description: JVM이 런타임에 메모리를 나누는 방식 — Method Area, Heap, Stack, PC Register, Native Method Stack.
---

JVM은 프로그램 실행 시 운영체제로부터 받은 메모리를 **용도별 영역**으로 나눠 관리한다. 크게 모든 스레드가 공유하는 영역과 스레드마다 따로 갖는 영역으로 갈린다.

## 공유 영역 (모든 스레드)

- **Method Area (Metaspace)** — 클래스 메타데이터, static 변수, 상수 풀. Java 8부터 PermGen → Metaspace(네이티브 메모리)로 이동.
- **Heap** — `new`로 만든 객체와 배열이 사는 곳. GC의 주 대상. Young(Eden/Survivor) · Old 영역으로 세대 구분.

## 스레드별 영역

- **Stack** — 메서드 호출마다 쌓이는 프레임(지역 변수, 매개변수, 연산 중간값). 메서드가 끝나면 프레임 pop.
- **PC Register** — 현재 실행 중인 명령의 주소.
- **Native Method Stack** — JNI 등 네이티브 코드 실행용 스택.

## 핵심

> 객체 자체는 **Heap**에, 그 객체를 가리키는 참조 변수는 **Stack**에 있다.

`StackOverflowError`는 Stack(재귀 등), `OutOfMemoryError`는 보통 Heap·Metaspace 고갈에서 난다.
