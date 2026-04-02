---
title: RAG 성능을 끌어올리는 7가지 방법
date: 2026-04-02
tags:
  - RAG
  - LangChain
  - Pinecone
  - LLM
excerpt: 청킹 전략부터 리랭킹, 하이브리드 검색까지. RAG 파이프라인에서 실제로 효과 있었던 성능 개선 기법들을 정리했습니다.
category: performance
---

RAG를 처음 구현했을 때는 단순하게 생각했습니다. 문서를 자르고, 벡터로 만들고, 유사한 걸 꺼내서 LLM에게 넘기면 되는 거 아닌가? 실제로 해보면 생각보다 답이 엉망인 경우가 많습니다. 검색은 됐는데 맥락이 끊기거나, 분명히 문서에 있는 내용인데 못 찾거나.

이 글은 RAG 파이프라인을 개선하면서 실제로 효과가 있었던 방법들을 정리한 것입니다.

---

## 1. 청킹 전략을 바꿔라

가장 먼저 손대야 할 부분입니다. 기본적인 `RecursiveCharacterTextSplitter`로 일정 크기로 자르는 방식은 문장이나 문단 중간에서 잘릴 수 있습니다. 의미 단위가 끊기면 검색 품질이 떨어질 수밖에 없습니다.

**개선 방법: Semantic Chunking**

문장 임베딩 유사도를 기준으로 의미가 전환되는 지점에서 청크를 나눕니다.

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

splitter = SemanticChunker(
    OpenAIEmbeddings(),
    breakpoint_threshold_type="percentile",
    breakpoint_threshold_amount=90,
)
chunks = splitter.split_text(document)
```

코드처럼 구조가 있는 문서라면 **AST 기반 청킹**이 더 효과적입니다. 함수나 클래스 단위로 자르면 검색 정확도가 눈에 띄게 올라갑니다.

---

## 2. 작은 청크로 검색하고, 큰 청크로 답변하라

청크가 작을수록 검색 정밀도는 높아지지만 LLM에게 전달되는 컨텍스트가 부족해집니다. 반대로 청크가 크면 검색 정밀도가 떨어집니다.

**Parent Document Retriever**로 두 마리 토끼를 잡을 수 있습니다.

- 작은 청크(child)로 임베딩하고 검색
- 검색된 child가 속한 큰 청크(parent)를 LLM에게 전달

```python
from langchain.retrievers import ParentDocumentRetriever
from langchain.storage import InMemoryStore

retriever = ParentDocumentRetriever(
    vectorstore=vectorstore,
    docstore=InMemoryStore(),
    child_splitter=child_splitter,   # 작은 단위 (검색용)
    parent_splitter=parent_splitter, # 큰 단위 (컨텍스트용)
)
```

---

## 3. 하이브리드 검색: 벡터 + 키워드

벡터 유사도 검색은 의미적으로 유사한 문장을 잘 찾지만, 특정 변수명·함수명·오류 코드 같은 **정확한 키워드**를 찾는 데는 약합니다. BM25 같은 키워드 검색과 결합하면 커버리지가 넓어집니다.

```python
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

bm25 = BM25Retriever.from_documents(docs)
bm25.k = 5

ensemble = EnsembleRetriever(
    retrievers=[bm25, vectorstore.as_retriever(search_kwargs={"k": 5})],
    weights=[0.4, 0.6],
)
```

가중치는 도메인에 따라 튜닝이 필요합니다. 코드베이스처럼 정확한 용어가 중요한 경우 BM25 비중을 높이는 게 효과적이었습니다.

---

## 4. Query Decomposition으로 복잡한 질문 쪼개기

*"이 PR에서 성능 문제와 보안 취약점이 있어?"* 같은 복합 질문은 하나의 쿼리로 검색하면 어느 쪽도 제대로 못 찾습니다.

LLM으로 질문을 서브 쿼리로 분해한 뒤 각각 검색하고 결과를 합치는 방식이 효과적입니다.

```python
from langchain.retrievers.multi_query import MultiQueryRetriever

retriever = MultiQueryRetriever.from_llm(
    retriever=vectorstore.as_retriever(),
    llm=llm,
)
# LLM이 원본 쿼리에서 여러 관점의 서브쿼리를 자동 생성
```

또는 직접 분해 프롬프트를 작성해서 버그 관점 / 컨벤션 관점 / 성능 관점으로 나눠 검색하는 방식도 쓸 수 있습니다.

---

## 5. Cross-Encoder 리랭킹으로 노이즈 제거

벡터 검색으로 상위 20개를 뽑아도 실제로 관련 있는 건 3~5개인 경우가 많습니다. Cross-Encoder는 질문과 청크를 함께 입력받아 관련도를 더 정밀하게 재평가합니다. 느리지만 top-k에만 적용하면 속도 부담이 크지 않습니다.

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import CrossEncoderReranker
from langchain_community.cross_encoders import HuggingFaceCrossEncoder

model = HuggingFaceCrossEncoder(model_name="BAAI/bge-reranker-base")
compressor = CrossEncoderReranker(model=model, top_n=5)

compression_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=ensemble_retriever,
)
```

리랭킹 후 top-5만 LLM에게 전달하면 컨텍스트 품질이 올라가고 토큰 비용도 줄어듭니다.

---

## 6. 메타데이터 필터링으로 검색 범위 좁히기

전체 벡터DB에서 검색하지 말고, 메타데이터로 필터를 걸어서 관련 문서만 후보로 만드세요. 파일 경로, 언어, 카테고리 같은 메타데이터를 인덱싱할 때 같이 저장해두면 됩니다.

```python
vectorstore.similarity_search(
    query=query,
    k=10,
    filter={"language": "python", "file_type": "source"},
)
```

검색 대상이 줄어드니 정밀도도 올라가고 응답 속도도 빨라집니다.

---

## 7. 캐싱으로 동일 쿼리 비용 0으로 만들기

같은 질문이 반복된다면 임베딩과 LLM 호출을 캐싱하는 것만으로도 비용과 레이턴시를 크게 줄일 수 있습니다.

```python
from langchain.globals import set_llm_cache
from langchain_community.cache import RedisSemanticCache

set_llm_cache(
    RedisSemanticCache(
        redis_url="redis://localhost:6379",
        embedding=OpenAIEmbeddings(),
        score_threshold=0.95,  # 유사도 95% 이상이면 캐시 히트
    )
)
```

Semantic Cache는 완전히 동일한 문장이 아니어도 의미가 비슷하면 캐시를 반환합니다. 반복성이 높은 서비스에서 특히 효과적입니다.

---

## 정리

| 문제 | 해결책 |
|------|--------|
| 청크 중간에서 의미가 끊김 | Semantic / AST 기반 청킹 |
| 검색은 됐는데 컨텍스트가 부족 | Parent Document Retriever |
| 정확한 키워드를 못 찾음 | 하이브리드 검색 (BM25 + Vector) |
| 복합 질문에 답변 품질 저하 | Query Decomposition |
| 관련 없는 청크가 LLM에 전달됨 | Cross-Encoder 리랭킹 |
| 전체 DB에서 노이즈 검색 | 메타데이터 필터링 |
| 동일 쿼리 반복 비용 | Semantic Cache |

하나씩 적용하면서 eval 지표(정밀도, 재현율, 답변 정확도)를 측정해가며 튜닝하는 게 가장 효과적입니다. 한 번에 다 바꾸면 어느 게 효과가 있었는지 알 수가 없습니다.
