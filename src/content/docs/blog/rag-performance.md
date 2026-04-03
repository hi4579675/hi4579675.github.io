---
title: RAG 성능을 끌어올리는 고급 기법들
date: 2026-03-23
tags:
  - RAG
  - LangChain
  - Pinecone
  - LLM
excerpt: 청킹·하이브리드 검색·리랭킹부터 RAPTOR, Corrective RAG, Self-RAG, GraphRAG까지. 고급 RAG 아키텍처와 성능 개선 기법을 깊게 파고듭니다.
category: performance
---

RAG를 처음 구현했을 때는 단순하게 생각했습니다. 문서를 자르고, 벡터로 만들고, 유사한 걸 꺼내서 LLM에게 넘기면 되는 거 아닌가? 실제로 해보면 생각보다 답이 엉망인 경우가 많습니다. 검색은 됐는데 맥락이 끊기거나, 분명히 문서에 있는 내용인데 못 찾거나.

이 글은 기본적인 성능 개선 기법부터 최신 고급 RAG 아키텍처까지, 단계별로 정리합니다.

---

## 1. 청킹 전략을 바꿔라

가장 먼저 손대야 할 부분입니다. `RecursiveCharacterTextSplitter`로 일정 크기로 자르는 방식은 문장이나 문단 중간에서 잘릴 수 있습니다. 의미 단위가 끊기면 검색 품질이 떨어질 수밖에 없습니다.

**Semantic Chunking** — 문장 임베딩 유사도를 기준으로 의미가 전환되는 지점에서 청크를 나눕니다.

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

코드 문서라면 **AST 기반 청킹**이 더 효과적입니다. 함수나 클래스 단위로 자르면 검색 정확도가 눈에 띄게 올라갑니다.

---

## 2. Parent Document Retriever

청크가 작을수록 검색 정밀도는 높아지지만 LLM에게 전달되는 컨텍스트가 부족해집니다. 반대로 청크가 크면 검색 정밀도가 떨어집니다. 두 마리 토끼를 동시에 잡는 방법입니다.

- **작은 청크(child)** 로 임베딩하고 검색
- 검색된 child가 속한 **큰 청크(parent)** 를 LLM에게 전달

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

## 3. 하이브리드 검색: 벡터 + BM25

벡터 유사도 검색은 의미적으로 유사한 문장을 잘 찾지만, 특정 변수명·함수명·오류 코드 같은 **정확한 키워드**를 찾는 데는 약합니다. BM25와 결합하면 커버리지가 넓어집니다.

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

## 4. Query Decomposition

*"이 PR에서 성능 문제와 보안 취약점이 있어?"* 같은 복합 질문은 하나의 쿼리로 검색하면 어느 쪽도 제대로 못 찾습니다. LLM으로 질문을 서브 쿼리로 분해한 뒤 각각 검색하고 결과를 합칩니다.

```python
from langchain.retrievers.multi_query import MultiQueryRetriever

retriever = MultiQueryRetriever.from_llm(
    retriever=vectorstore.as_retriever(),
    llm=llm,
)
```

**Step-Back Prompting**을 함께 쓰면 더 효과적입니다. 구체적인 질문을 더 일반적인 개념 질문으로 끌어올려서 먼저 검색한 뒤, 원래 질문에 그 컨텍스트를 더해 답변합니다.

```python
# "FastAPI에서 async def로 DB 쿼리 시 deadlock 발생"
# → Step-back: "Python 비동기 프로그래밍에서 데이터베이스 연결 관리 원칙"
# → 일반 원칙을 검색해 컨텍스트로 추가 후, 구체적 질문에 답변
```

---

## 5. Cross-Encoder 리랭킹

벡터 검색으로 상위 20개를 뽑아도 실제로 관련 있는 건 3~5개인 경우가 많습니다. Cross-Encoder는 질문과 청크를 **함께 입력**받아 관련도를 더 정밀하게 재평가합니다.

Bi-Encoder(벡터 검색)가 각 문서를 독립적으로 임베딩하는 반면, Cross-Encoder는 쿼리-문서 쌍을 동시에 보기 때문에 정밀도가 훨씬 높습니다. 느리지만 top-k에만 적용하면 부담이 크지 않습니다.

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

---

## 6. HyDE (Hypothetical Document Embeddings)

일반적인 RAG는 **질문의 임베딩**으로 문서를 검색합니다. 그런데 질문과 문서는 어휘가 다릅니다. "Redis가 왜 느려?"라는 질문과 "Redis 성능 튜닝 가이드" 문서는 의미상 가깝지만 임베딩 공간에서 멀 수 있습니다.

HyDE는 이 문제를 우회합니다. LLM으로 **가상의 답변 문서**를 먼저 생성한 뒤, 그 가상 문서의 임베딩으로 실제 문서를 검색합니다. 질문보다 실제 문서에 더 가까운 임베딩으로 검색하는 셈입니다.

```python
from langchain.chains import HypotheticalDocumentEmbedder
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

base_embeddings = OpenAIEmbeddings()
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

embeddings = HypotheticalDocumentEmbedder.from_llm(
    llm=llm,
    base_embeddings=base_embeddings,
    custom_instructions="주어진 질문에 대한 기술 문서 형식의 답변을 작성하세요.",
)

# 이후 이 embeddings를 vectorstore에서 사용
result = vectorstore.similarity_search_by_vector(
    embeddings.embed_query(query), k=5
)
```

특히 도메인 특화 문서나 질문과 문서의 어휘 차이가 클 때 효과적입니다.

---

## 7. RAPTOR: 계층적 요약 인덱싱

긴 문서에서 RAG의 근본적인 한계는 **지역 정보만 검색한다**는 점입니다. 여러 챕터에 걸친 고수준 질문 — "이 논문의 핵심 주장은?"이나 "전체 코드베이스의 아키텍처 패턴은?" — 에는 개별 청크 검색이 한계를 드러냅니다.

**RAPTOR(Recursive Abstractive Processing for Tree-Organized Retrieval)** 는 문서를 계층적으로 요약해 트리 구조로 인덱싱합니다.

```
[원본 청크들]
      ↓ 클러스터링 (UMAP + GMM)
[중간 레벨 요약]
      ↓ 다시 클러스터링
[최상위 요약]
```

질문에 따라 적절한 레벨의 노드에서 검색하기 때문에, 세부 정보가 필요한 질문은 하위 청크에서, 고수준 질문은 상위 요약에서 답변할 수 있습니다.

```python
from langchain_community.document_transformers import (
    LongContextReorder
)

# LangChain에서는 트리 구조를 직접 구현하거나
# LlamaIndex의 SummaryIndex를 활용
from llama_index.core import SummaryIndex, VectorStoreIndex
from llama_index.core.retrievers import RouterRetriever

summary_index = SummaryIndex(nodes)
vector_index = VectorStoreIndex(nodes)

# 질문 유형에 따라 적절한 인덱스로 라우팅
retriever = RouterRetriever.from_defaults(
    retrievers=[
        summary_index.as_retriever(),   # 고수준 요약 질문
        vector_index.as_retriever(),    # 세부 정보 질문
    ],
    llm=llm,
    select_multi=True,
)
```

---

## 8. Corrective RAG (CRAG)

기본 RAG는 검색 결과가 나쁠 때도 그냥 LLM에게 넘깁니다. CRAG는 검색된 문서의 **관련도를 자체 평가**하고, 낮으면 웹 검색으로 보완하거나 쿼리를 재작성해 다시 검색합니다.

```
질문 → 검색 → 관련도 평가
  ├─ [관련도 높음] → 그대로 사용
  ├─ [관련도 애매] → 부분 사용 + 웹 검색 보완
  └─ [관련도 낮음] → 쿼리 재작성 → 웹 검색 → 재시도
```

LangGraph로 이 흐름을 구현할 수 있습니다.

```python
from langgraph.graph import StateGraph, END
from langchain_community.tools import TavilySearchResults

web_search = TavilySearchResults(k=3)

def grade_documents(state):
    """검색된 문서의 관련도 평가"""
    question = state["question"]
    documents = state["documents"]

    grader_prompt = f"""
    질문: {question}
    문서: {documents[0].page_content}

    이 문서가 질문과 관련이 있는지 'yes' 또는 'no'로만 답하세요.
    """
    score = llm.invoke(grader_prompt).content.strip().lower()
    return "generate" if score == "yes" else "rewrite"

def rewrite_query(state):
    """더 나은 검색을 위해 쿼리 재작성"""
    question = state["question"]
    rewritten = llm.invoke(
        f"다음 질문을 벡터 검색에 최적화된 형태로 재작성하세요: {question}"
    ).content
    return {"question": rewritten}

# StateGraph로 흐름 연결
workflow = StateGraph(dict)
workflow.add_node("retrieve", retrieve)
workflow.add_node("grade_documents", grade_documents)
workflow.add_node("rewrite", rewrite_query)
workflow.add_node("web_search", lambda s: {"documents": web_search.invoke(s["question"])})
workflow.add_node("generate", generate_answer)

workflow.add_conditional_edges("grade_documents", grade_documents, {
    "generate": "generate",
    "rewrite": "rewrite",
})
```

---

## 9. Self-RAG: 스스로 검색이 필요한지 판단

기본 RAG는 모든 질문에 무조건 검색을 합니다. *"파이썬에서 1+1은?"* 같은 질문에도 검색을 거칩니다. Self-RAG는 LLM이 **검색 필요 여부를 스스로 판단**하고, 생성된 답변이 문서에 근거하는지도 자체 검증합니다.

4가지 특수 토큰으로 과정을 제어합니다.

| 토큰 | 의미 |
|------|------|
| `[Retrieve]` | 검색이 필요한가? |
| `[IsREL]` | 검색 결과가 관련 있는가? |
| `[IsSUP]` | 답변이 문서에 근거하는가? |
| `[IsUSE]` | 답변이 유용한가? |

```python
# Self-RAG는 파인튜닝된 모델을 사용하거나
# 프롬프트 엔지니어링으로 비슷하게 구현 가능

self_rag_prompt = """
당신은 질문에 답변하는 AI입니다.

1. 먼저 이 질문에 외부 문서 검색이 필요한지 판단하세요.
   - 필요: [RETRIEVE]
   - 불필요: [NO_RETRIEVE]

2. 검색이 필요한 경우, 검색 결과를 보고:
   - 관련 있음: [RELEVANT]
   - 관련 없음: [IRRELEVANT]

3. 답변 생성 후 자체 검증:
   - 문서에 근거함: [SUPPORTED]
   - 근거 없음: [NOT_SUPPORTED]

질문: {question}
"""
```

---

## 10. GraphRAG: 관계 기반 검색

일반 RAG는 문서를 독립적인 청크로 취급합니다. 개념 간의 **관계**나 **연결고리**를 파악하지 못합니다. GraphRAG는 문서에서 엔티티와 관계를 추출해 지식 그래프를 구성하고, 그래프 탐색을 통해 검색합니다.

```
[일반 RAG]
질문 → 임베딩 → 유사 청크 반환

[GraphRAG]
질문 → 엔티티 추출 → 그래프 탐색 → 연결된 개념들 수집 → 컨텍스트 구성
```

```python
from langchain_community.graphs import Neo4jGraph
from langchain_experimental.graph_transformers import LLMGraphTransformer

# 문서에서 지식 그래프 구축
graph = Neo4jGraph(url="bolt://localhost:7687", username="neo4j", password="password")
transformer = LLMGraphTransformer(llm=llm)

graph_documents = transformer.convert_to_graph_documents(documents)
graph.add_graph_documents(graph_documents)

# 그래프 기반 검색
from langchain.chains import GraphCypherQAChain

chain = GraphCypherQAChain.from_llm(
    llm=llm,
    graph=graph,
    verbose=True,
    return_intermediate_steps=True,
)

result = chain.invoke({"query": "FastAPI와 LangChain을 함께 쓸 때 주의사항은?"})
```

엔티티 간 복잡한 관계 질문 — *"A 모듈이 B에 영향을 주는 경로는?"* — 에서 벡터 검색 대비 훨씬 우수한 결과를 냅니다.

---

## 11. RAG Fusion: 여러 쿼리 결과를 RRF로 합치기

MultiQuery가 여러 서브쿼리를 생성한다면, RAG Fusion은 거기서 한 발 더 나아가 **Reciprocal Rank Fusion(RRF)** 으로 결과를 합칩니다. 단순히 결과를 합치는 게 아니라, 여러 랭킹에서 일관되게 상위에 오르는 문서에 높은 점수를 줍니다.

```python
from langchain.retrievers import MergerRetriever
from langchain.retrievers.document_compressors import DocumentCompressorPipeline

def reciprocal_rank_fusion(results: list[list], k: int = 60):
    """여러 검색 결과 리스트를 RRF로 합산"""
    scores = {}
    for result_list in results:
        for rank, doc in enumerate(result_list):
            doc_id = doc.page_content
            if doc_id not in scores:
                scores[doc_id] = {"doc": doc, "score": 0}
            scores[doc_id]["score"] += 1 / (k + rank + 1)

    return sorted(scores.values(), key=lambda x: x["score"], reverse=True)

# 여러 쿼리 변형 생성
query_variants = llm.invoke(
    f"다음 질문을 5가지 다른 방식으로 표현하세요:\n{original_query}"
).content.split("\n")

# 각 변형으로 검색
all_results = [retriever.get_relevant_documents(q) for q in query_variants]

# RRF로 합산
fused = reciprocal_rank_fusion(all_results)
```

---

## 정리

| 기법 | 해결하는 문제 | 난이도 |
|------|-------------|--------|
| Semantic Chunking | 의미 단위 절단 | ⭐⭐ |
| Parent Document Retriever | 정밀도 vs 컨텍스트 트레이드오프 | ⭐⭐ |
| 하이브리드 검색 (BM25+Vector) | 키워드 검색 누락 | ⭐⭐ |
| Query Decomposition | 복합 질문 처리 | ⭐⭐ |
| Cross-Encoder 리랭킹 | 검색 노이즈 | ⭐⭐⭐ |
| HyDE | 질문-문서 어휘 불일치 | ⭐⭐⭐ |
| RAPTOR | 고수준/전체 문서 질문 | ⭐⭐⭐⭐ |
| Corrective RAG | 검색 실패 복원력 | ⭐⭐⭐⭐ |
| Self-RAG | 불필요한 검색 제거, 자체 검증 | ⭐⭐⭐⭐ |
| GraphRAG | 개념 간 관계 질문 | ⭐⭐⭐⭐⭐ |
| RAG Fusion (RRF) | 단일 쿼리 편향 | ⭐⭐⭐ |

기본기(1~5)를 먼저 확실히 잡고, 도메인과 질문 유형에 맞는 고급 기법을 선택적으로 도입하는 게 현실적입니다. GraphRAG나 Self-RAG는 구현 비용이 상당하기 때문에 실제 성능 차이를 eval로 검증한 뒤에 도입하는 걸 권장합니다.
