---
title: "계약지킴이 Phase 0 회고: PoC가 증명해야 했던 것들"
date: 2026-04-01
tags:
  - FastAPI
  - RAG
excerpt: 임대차 계약서 AI 분석 서비스 계약지킴이의 Phase 0 개발 회고. 기술 결정의 이유, 마주친 문제들, 그리고 PoC가 답해야 했던 질문들을 정리했습니다.
category: develops
---

## 왜 만들었나

어머니가 임대차 계약 만료를 앞두고 계셨다. 변호사 검토 비용이 부담돼서 그냥 서명하려고 하셨다.

공인중개사는 계약 성사가 목적이라 임차인 편이 되기 어렵다. 법률 챗봇은 계약서를 직접 읽지 못한다. 계약서를 올리면 "이 조항이 왜 위험한지"를 법령 근거를 들어 설명해주는 서비스가 없었다.

그래서 만들기로 했다. **계약지킴이(Jikimi)** — 계약서를 업로드하면 독소 조항을 즉시 탐지하는 AI 분석 서비스.

---

## Phase 0의 목적: 리스크 먼저 검증한다

전체 시스템을 다 만들고 나서 "OCR이 안 된다"거나 "RAG 품질이 너무 낮다"는 걸 발견하면 늦다. Phase 0의 목표는 단 하나였다.

**"이 서비스의 핵심 리스크 두 가지를 먼저 증명한다."**

1. OCR — pdfplumber로 계약서에서 조항을 제대로 파싱할 수 있는가?
2. RAG — 계약서 조항을 입력하면 관련 법령 조문이 검색되는가?

이 두 가지가 안 되면 뒤가 다 의미없다.

---

## 기술 결정

### FastAPI + Spring Boot 이중 서버

처음부터 AI 파이프라인은 FastAPI, 비즈니스 로직은 Spring Boot로 분리하기로 했다.

**이유:**
- Python AI 생태계(LangChain, pgvector 클라이언트, pdfplumber)는 Java로 대체하기 어렵다
- Spring Boot의 JPA 트랜잭션, 스케줄링(만료일 알림)은 Python보다 Java가 자연스럽다
- 두 기술을 함께 보여줄 수 있다는 점도 현실적으로 고려했다

**트레이드오프:**
이 프로젝트 규모에서 단일 서버 대비 운영 복잡도가 올라간다. JWT secret key 공유, 에러 응답 형식 통일 등 서버 간 계약을 별도로 관리해야 한다. WebClient timeout을 반드시 명시해야 한다 — OCR/LLM 지연 시 Spring Boot 스레드가 블락된다.

### pgvector 선택 (ChromaDB 대신)

벡터 스토어로 ChromaDB 대신 PostgreSQL + pgvector를 선택했다.

**이유:**
- 관계형 데이터(계약 이력, 사용자)와 벡터 데이터(법령 임베딩)를 단일 DB로 관리할 수 있다
- 별도 벡터 DB 프로세스를 운영하지 않아 운영 포인트가 줄어든다
- 이 프로젝트 지식베이스 규모(상가임대차보호법 + 민법)는 pgvector로 충분하다

**트레이드오프:**
ChromaDB 대비 초기 세팅이 다소 복잡하다. HNSW 인덱스를 반드시 설정해야 한다.

```sql
CREATE INDEX ON law_chunks USING hnsw (embedding vector_cosine_ops);
```

이 인덱스 없이 쓰면 순차 탐색(brute-force)이 되어 데이터가 늘어날수록 느려진다.

### 조항 단위 청킹 (fixed-size 청킹 대신)

일반 RAG에서 흔히 쓰는 fixed-size 청킹 대신 계약서 조(Article) 단위로 파싱하기로 했다.

**이유:**
fixed-size 청킹은 `"제11조 (임대료) 월 300만 원..."` 같은 문장을 조항 경계와 무관하게 자른다. 조항이 두 청크에 걸쳐 잘리면 법령 대조 품질이 크게 떨어진다.

조항 단위로 파싱하면 각 조항을 하나의 의미 단위로 법령과 1:1 대조할 수 있다.

**트레이드오프:**
조항이 너무 길면(3~4개 항이 합쳐진 경우) 토큰 초과 가능성이 있다. 조항 내 "항" 단위로 서브청킹하는 fallback 로직이 필요하다.

### Hybrid RAG (BM25 + Vector Search, RRF 병합)

단순 벡터 검색 대신 BM25와 pgvector를 RRF(Reciprocal Rank Fusion)로 병합하는 Hybrid RAG를 선택했다.

**이유:**

| 방식 | 강점 | 약점 |
|------|------|------|
| BM25만 | 조문 번호(`제11조`) 키워드 매칭 | 의미 기반 검색 약함 |
| Vector만 | 의미 유사도 검색 | 정확한 조문 번호 매칭 불안정 |
| Hybrid (RRF) | 두 방식 모두 커버 | 구현 복잡도 소폭 증가 |

법률 고유어(차임, 보증금, 묵시적 갱신 등)는 형태소 분석기(Kiwi) 또는 도메인 사전 등록이 필요할 수 있다. PoC 결과를 보고 판단하기로 했다.

---

## Phase 0에서 만난 문제들

### 1. 법령 참조문이 조항으로 오탐

OCR을 짜고 처음 돌렸을 때 결과가 이상했다. 12개 조항이 있는 계약서인데 21개가 파싱됐다.

**원인:** 본문 중간의 법령 인용문이 실제 조항 번호로 잘못 파싱됐다.

```
"이 계약은 제10조의4제1항에 따라 효력을 가진다."
```

`제10조의4`를 정규식이 잡아서 새 조항으로 처리했다.

**처음 정규식:**
```python
pattern = r'(제\d+조(?:의\d+)?)'
```

본문 어디서나 매칭된다. 법령 참조문과 실제 조항을 구별하지 못한다.

**수정 정규식:**
```python
pattern = r'(?m)^[ \t]*(제\d+조(?:의\d+)?)\s*[（(]'
```

줄 시작(`^`) + 괄호 제목이 바로 뒤따르는 패턴만 실제 조항으로 인식한다. 본문 중간의 법령 참조문은 줄 시작에 위치하지 않으므로 자연스럽게 필터링된다.

결과: 21개 → 12개. 정확히 맞아떨어졌다.

### 2. 페이지 번호가 조항 내용에 삽입

pdfplumber가 PDF 레이아웃을 선형 텍스트로 변환하는 과정에서 `- 1 / 3 -` 같은 페이지 번호가 제8조 본문 중간에 끼어들었다.

```
제8조 (계약 해지)
임대인은 임차인이 - 1 / 3 - 월 이상 차임을 연체하거나...
```

내용이 잘려서 법령 대조 품질에 영향을 준다.

**해결:** 페이지 번호 앞뒤 줄바꿈까지 함께 제거하는 정규식으로 처리했다.

```python
# 단순 제거 — 앞뒤 빈 줄이 남음
text = re.sub(r'-\s*\d+\s*/\s*\d+\s*-', '', text)

# 앞뒤 \n*까지 함께 제거 — 내용이 자연스럽게 이어짐
text = re.sub(r'\n*-\s*\d+\s*/\s*\d+\s*-\n*', '\n', text)
```

### 3. async 함수 내 동기 블로킹

`async def search_legal_context` 안에서 psycopg2(동기 드라이버)와 Gemini 클라이언트(동기)를 직접 호출했다.

```python
# ❌ 이벤트 루프 전체가 블락됨
async def search_legal_context(query: str):
    conn = psycopg2.connect(...)          # 동기 블로킹
    embedding = gemini.embed(query)       # 동기 블로킹
    results = conn.execute(sql)
    return results
```

FastAPI는 async 기반이라 이벤트 루프가 하나다. 동기 I/O가 끼어들면 다른 요청 전체가 멈춘다.

**해결:** 동기 블로킹 로직을 별도 함수로 분리하고 `asyncio.to_thread()`로 위임했다.

```python
def _query_db(embedding: list[float]) -> list[dict]:
    conn = psycopg2.connect(...)
    # ... 동기 DB 쿼리
    return results

def _embed(text: str) -> list[float]:
    return gemini.embed(text)

async def search_legal_context(query: str):
    embedding = await asyncio.to_thread(_embed, query)
    results = await asyncio.to_thread(_query_db, embedding)
    return results
```

asyncpg(비동기 드라이버)로 교체도 검토했다. 하지만 PoC 단계에서 드라이버 교체는 오버엔지니어링이라 판단했다. `asyncio.to_thread`는 스레드 풀에서 동기 함수를 실행해서 이벤트 루프를 블락하지 않으므로 현 단계에서는 충분하다.

---

## Phase 0 결과

RAG 품질 검증 결과:

| 쿼리 | 1위 검색 결과 | 유사도 |
|------|-------------|--------|
| 보증금 반환 의무 | 제5조 보증금의 회수 | 0.747 |
| 계약 갱신 요구권 | 제10조 계약갱신 요구 등 | 0.770 |
| 임대료 인상 한도 | 제11조 차임 등의 증감청구권 | 0.711 |
| 권리금 회수 방해 | 제10조의4 권리금 회수기회 보호 | 0.757 |

4개 쿼리 모두 1위에서 의미적으로 맞는 조문이 검색됐다. PoC 통과.

**남은 이슈:**
- 2, 3위 결과 중 의미적으로 무관한 조문이 섞임 → Hybrid RAG 도입 후 재측정 필요
- `<개정 2020.9.29>` 같은 개정 태그 노이즈가 임베딩 품질에 영향을 줄 수 있음 → 태그 제거 전/후 비교 미완

---

## 다음 단계

Phase 0에서 핵심 리스크 두 가지(OCR 파싱, RAG 품질)는 검증됐다. Phase 1에서는 LLM 연동으로 파이프라인을 완성하고, 실제 계약서로 end-to-end 테스트를 한다.

구체적으로는:

- GPT-4o 프롬프트 설계 — 계약서 조항 + 관련 법령 → 위험도 분석
- `POST /analyze` 엔드포인트 완성
- Hybrid RAG(BM25 + Vector) 도입 후 검색 품질 재측정
- 개정 태그 노이즈 영향 측정

어머니 계약서로 실제로 돌려볼 수 있는 날이 목표다.
