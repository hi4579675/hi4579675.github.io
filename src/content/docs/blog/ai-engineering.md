---
title: AI 엔지니어링이란 무엇인가 — 모델을 만드는 게 아니라 다루는 기술
date: 2026-03-17
tags:
  - AI Engineering
  - LLM
  - Fine-tuning
  - Prompt Engineering
excerpt: ML 엔지니어링과 AI 엔지니어링은 무엇이 다른가. 프롬프트 엔지니어링, RAG, 파인튜닝, 추론 최적화, 평가까지 — 파운데이션 모델 시대의 AI 시스템 성능을 결정하는 기술들을 정리합니다.
category: ai
---

AI 엔지니어링이라는 말이 등장한 건 아주 최근입니다. 그리고 그 배경에는 하나의 키워드가 있습니다. **규모(Scale)**.

2020년 GPT-3가 1750억 개의 파라미터로 등장했을 때, 세상이 달라졌습니다. 특정 태스크를 위해 모델을 처음부터 학습시키는 게 아니라, 이미 방대한 데이터로 학습된 모델을 가져다 쓰는 시대가 열렸습니다. 모델 자체의 진입 장벽이 낮아졌고, AI를 활용한 제품을 만드는 방식이 근본적으로 바뀌었습니다.

---

## ML 엔지니어링 vs AI 엔지니어링

둘의 차이를 한 문장으로 정리하면 이렇습니다.

> ML 엔지니어링은 **모델을 만든다**. AI 엔지니어링은 **모델을 다룬다**.

전통적인 ML 엔지니어링의 핵심은 모델 그 자체였습니다. 데이터 수집, 피처 엔지니어링, 모델 아키텍처 설계, 학습 루프 구현, 하이퍼파라미터 튜닝. 좋은 모델을 만들어내는 것이 전부였습니다.

파운데이션 모델 시대의 AI 엔지니어링은 다릅니다. GPT, Claude, Gemini, LLaMA처럼 수천억 파라미터로 이미 학습된 모델이 존재합니다. 이 모델들은 API 하나로 접근할 수 있습니다. 이제 문제는 **이 모델을 어떻게 조정하고 평가해서 원하는 시스템을 만드느냐**입니다.

AI 엔지니어링의 핵심 관심사:

- 어떤 컨텍스트를 어떻게 모델에게 전달할 것인가 (프롬프트, RAG)
- 모델의 행동을 어떻게 원하는 방향으로 조정할 것인가 (파인튜닝)
- 학습 데이터를 어떻게 구성할 것인가 (데이터셋 엔지니어링)
- 시스템을 어떻게 평가하고 개선할 것인가 (평가)
- 어떻게 빠르고 싸게 추론할 것인가 (추론 최적화)

---

## 1. 프롬프트 엔지니어링

가장 먼저, 그리고 가장 빠르게 시도할 수 있는 방법입니다. 모델의 파라미터를 건드리지 않고 입력만 바꿔 출력을 제어합니다.

### Few-Shot Prompting

모델에게 예시를 보여주는 방법입니다. 예시 없이 질문하는 Zero-Shot과 달리, Few-Shot은 입력-출력 패턴을 몇 개 제시해 모델이 그 형식을 따르도록 합니다.

```
# Zero-shot
리뷰: "배송이 너무 느렸어요."
감성:

# Few-shot
리뷰: "제품이 마음에 들어요." → 긍정
리뷰: "품질이 나빴습니다." → 부정
리뷰: "배송이 너무 느렸어요." → ?
```

### Chain-of-Thought (CoT)

2022년 Google Brain의 Wei et al.이 발표한 방법으로, 모델이 중간 추론 단계를 명시적으로 거치도록 유도합니다. 복잡한 수학 문제나 논리 추론에서 성능이 크게 향상됩니다.

```
# 일반 프롬프트
Q: 철수는 사과 5개를 가지고 있었다. 3개를 먹고 2개를 샀다. 몇 개인가?
A: 4개

# Chain-of-Thought
Q: 철수는 사과 5개를 가지고 있었다. 3개를 먹고 2개를 샀다. 몇 개인가?
A: 처음에 5개가 있었습니다.
   3개를 먹으면 5 - 3 = 2개가 남습니다.
   2개를 사면 2 + 2 = 4개입니다.
   따라서 답은 4개입니다.
```

*"Let's think step by step"* 한 문장만 추가해도 Zero-Shot CoT로 작동한다는 것도 같은 연구에서 밝혀졌습니다.

### Structured Output

모델의 출력을 JSON 같은 구조화된 형식으로 강제합니다. OpenAI의 Function Calling, JSON Mode, 최근의 Structured Outputs API가 이에 해당합니다.

```python
from openai import OpenAI
from pydantic import BaseModel

class ReviewAnalysis(BaseModel):
    sentiment: str       # "positive" | "negative" | "neutral"
    score: int           # 1-5
    key_issues: list[str]

client = OpenAI()
response = client.beta.chat.completions.parse(
    model="gpt-4o",
    messages=[{"role": "user", "content": f"리뷰를 분석하세요: {review}"}],
    response_format=ReviewAnalysis,
)
result = response.choices[0].message.parsed
```

프롬프트 엔지니어링의 한계는 **모델의 지식 자체를 바꾸지 않는다**는 점입니다. 모델이 모르는 정보는 아무리 프롬프트를 바꿔도 정확하게 답할 수 없습니다. 이걸 해결하는 게 RAG입니다.

---

## 2. RAG (Retrieval-Augmented Generation)

모델의 파라미터에 없는 지식을 외부에서 가져다 컨텍스트로 주입하는 방법입니다. 프롬프트 엔지니어링의 연장선이지만, 검색 시스템이 개입한다는 점에서 별도의 엔지니어링 영역이 됩니다.

기본 파이프라인:
```
문서 → 청킹 → 임베딩 → 벡터 DB 저장
질문 → 임베딩 → 유사 청크 검색 → LLM 컨텍스트로 주입 → 답변 생성
```

RAG가 효과적인 이유는 LLM의 두 가지 근본적인 한계를 해결하기 때문입니다.

1. **지식 컷오프** — 학습 이후의 정보를 모른다
2. **할루시네이션** — 모르는 내용을 그럴듯하게 지어낸다

외부 문서를 검색해 컨텍스트로 제공하면 모델은 "아는 척"을 할 필요가 없어집니다. 답의 근거가 명확해지고, 출처 추적도 가능해집니다.

성능을 결정하는 핵심 요소는 **검색 품질**입니다. 아무리 LLM이 좋아도 잘못된 청크가 전달되면 답변 품질은 떨어집니다. 청킹 전략, 임베딩 모델 선택, 하이브리드 검색, 리랭킹 등이 여기서 중요해집니다.

---

## 3. 에이전트와 도구 사용

단일 LLM 호출로 해결할 수 없는 태스크를 위해, 모델이 **스스로 판단해서 도구를 호출**하고 결과를 다시 처리하는 구조입니다.

### ReAct 패턴

Reason(추론) + Act(행동)의 반복입니다. 모델이 "지금 무엇을 해야 하는가"를 추론하고, 도구를 호출하고, 결과를 보고 다시 추론합니다.

```
Thought: 오늘 서울 날씨를 알아야 한다.
Action: search("서울 오늘 날씨")
Observation: 맑음, 최고기온 22도
Thought: 날씨 정보를 얻었다. 이제 답변할 수 있다.
Answer: 오늘 서울은 맑고 최고기온 22도입니다.
```

### Function Calling

OpenAI, Anthropic 등의 API가 공식 지원하는 도구 호출 방식입니다. 모델이 언제 어떤 함수를 호출할지 결정하고, 파라미터를 추출해 반환합니다.

```python
tools = [
    {
        "name": "get_weather",
        "description": "특정 도시의 현재 날씨를 조회합니다",
        "input_schema": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "도시 이름"},
            },
            "required": ["city"],
        },
    }
]

response = anthropic.messages.create(
    model="claude-opus-4-6",
    tools=tools,
    messages=[{"role": "user", "content": "서울 날씨 알려줘"}],
)

# 모델이 tool_use block을 반환하면 실제 함수 호출
if response.stop_reason == "tool_use":
    tool_call = response.content[0]
    result = get_weather(tool_call.input["city"])
    # 결과를 다시 모델에게 전달
```

에이전트의 복잡도가 올라가면 **다중 에이전트** 구조가 등장합니다. 오케스트레이터 에이전트가 하위 전문 에이전트들에게 작업을 위임하는 방식입니다. LangGraph, AutoGen 같은 프레임워크가 이 흐름을 관리합니다.

---

## 4. 파인튜닝

프롬프트 엔지니어링과 RAG로 해결되지 않는 경우가 있습니다.

- 특정 도메인의 전문 용어와 표현 방식을 모델이 익혀야 할 때
- 출력 형식이나 말투를 일관되게 고정해야 할 때
- 보안상 매 요청마다 긴 시스템 프롬프트를 전달하기 어려울 때

이때 파인튜닝을 고려합니다. 모델의 파라미터 일부를 추가 학습으로 업데이트합니다.

### LoRA (Low-Rank Adaptation)

2021년 Microsoft Research의 Hu et al.이 제안한 방법입니다. 전체 파라미터를 업데이트하는 Full Fine-tuning은 비용이 너무 큽니다. LoRA는 원본 가중치 행렬을 고정하고, **낮은 랭크의 행렬 분해**로 변화량만 학습합니다.

원본 가중치 행렬 W (d×d)를 직접 업데이트하는 대신:

```
W' = W + ΔW = W + BA
```

여기서 B는 d×r, A는 r×d 행렬이고 r은 매우 작은 값(보통 4~64)입니다. 전체 파라미터 수의 0.1~1% 수준만 학습하면서도 Full Fine-tuning에 준하는 성능을 냅니다.

```python
from peft import LoraConfig, get_peft_model

config = LoraConfig(
    r=16,                    # 랭크
    lora_alpha=32,           # 스케일링 파라미터
    target_modules=["q_proj", "v_proj"],  # 적용할 레이어
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

model = get_peft_model(base_model, config)
model.print_trainable_parameters()
# trainable params: 4,194,304 || all params: 6,742,609,920 || trainable%: 0.06%
```

### QLoRA

2023년 Dettmers et al.이 제안한 방법으로, LoRA에 4비트 양자화를 결합합니다. 70B 파라미터 모델도 단일 소비자용 GPU(48GB VRAM)에서 파인튜닝할 수 있게 됐습니다.

핵심 아이디어:
1. 베이스 모델을 **NF4(4-bit NormalFloat)** 로 양자화해 메모리 사용량 대폭 감소
2. LoRA 어댑터는 **BF16** 정밀도로 유지
3. 역전파 시에만 어댑터 파라미터를 고정밀도로 복원 (Double Quantization)

```python
from transformers import BitsAndBytesConfig

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_use_double_quant=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
)

model = AutoModelForCausalLM.from_pretrained(
    model_id,
    quantization_config=bnb_config,
    device_map="auto",
)
```

### RLHF와 DPO

ChatGPT가 왜 단순히 다음 토큰을 예측하는 모델보다 훨씬 유용하게 느껴지는가. 그 답이 **RLHF(Reinforcement Learning from Human Feedback)** 입니다.

RLHF 3단계:
1. **SFT(Supervised Fine-Tuning)** — 고품질 데이터로 기본 지시 따르기 학습
2. **Reward Model 학습** — 사람이 두 응답 중 더 좋은 것을 선택한 데이터로 보상 모델 훈련
3. **PPO 강화학습** — 보상 모델의 점수를 최대화하는 방향으로 언어 모델 파인튜닝

RLHF는 강력하지만 복잡합니다. 두 개의 모델(언어 모델 + 보상 모델)을 동시에 메모리에 올려야 하고, PPO 학습이 불안정하기 쉽습니다.

**DPO(Direct Preference Optimization)** 는 2023년 Rafailov et al.이 제안한 단순화된 대안입니다. 보상 모델 없이 선호 데이터에서 직접 정책을 학습합니다. 수학적으로 RLHF와 동등한 최적해를 가지면서도 일반적인 지도학습처럼 간단하게 구현됩니다.

```python
from trl import DPOTrainer

# 선호 데이터: {"prompt": ..., "chosen": ..., "rejected": ...}
trainer = DPOTrainer(
    model=model,
    ref_model=ref_model,  # 원본 모델 (KL divergence 제약용)
    beta=0.1,             # 원본에서 얼마나 벗어날 수 있는지 제어
    train_dataset=dataset,
    tokenizer=tokenizer,
)
trainer.train()
```

---

## 5. 데이터셋 엔지니어링

파인튜닝에서 **데이터 품질**은 모델 선택보다 중요한 경우가 많습니다. 나쁜 데이터로 좋은 모델을 파인튜닝하면 나쁜 모델이 됩니다.

### 인스트럭션 튜닝 데이터

```json
{
  "instruction": "다음 계약서에서 임차인에게 불리한 조항을 찾아주세요.",
  "input": "제 5조: 임차인은 임대인의 사전 동의 없이...",
  "output": "다음 조항들이 임차인에게 불리할 수 있습니다:\n1. 제5조..."
}
```

데이터 구성 시 고려할 것들:
- **다양성** — 비슷한 패턴의 데이터 수천 개보다 다양한 패턴 수백 개가 낫습니다
- **일관성** — 같은 종류의 질문에 스타일이 일관된 답변이어야 합니다
- **난이도 분포** — 쉬운 것만 있으면 어려운 케이스에 일반화되지 않습니다

### 합성 데이터 생성

더 강력한 모델(GPT-4, Claude Opus)로 약한 모델을 파인튜닝할 학습 데이터를 생성합니다. Alpaca, Orca, WizardLM 등 많은 오픈소스 파인튜닝 데이터셋이 이 방식으로 만들어졌습니다.

```python
# 강력한 모델로 파인튜닝 데이터 생성
def generate_training_pair(topic: str, teacher_model) -> dict:
    instruction = teacher_model.generate(
        f"'{topic}'에 대한 어려운 질문을 하나 만들어주세요."
    )
    answer = teacher_model.generate(
        f"다음 질문에 상세히 답하세요: {instruction}"
    )
    return {"instruction": instruction, "output": answer}
```

주의할 점은 합성 데이터의 **편향이 그대로 전이**된다는 것입니다. Teacher 모델이 틀리는 영역은 Student 모델도 틀리게 됩니다.

---

## 6. 추론 최적화

파인튜닝된 좋은 모델이 있어도, 응답 지연이 5초라면 서비스할 수 없습니다. 추론 속도와 비용을 줄이는 것이 추론 최적화의 목표입니다.

### 양자화 (Quantization)

모델 파라미터의 수치 정밀도를 낮춥니다. FP32 → FP16 → INT8 → INT4 순으로 메모리와 속도가 개선됩니다.

- **GPTQ** — Post-Training Quantization. 소규모 보정 데이터셋으로 INT4 양자화 시 정확도 손실을 최소화합니다
- **AWQ(Activation-aware Weight Quantization)** — 활성화 값 분포를 고려해 중요한 가중치를 보호하며 양자화합니다. GPTQ보다 속도가 빠르고 품질도 유사합니다

```python
from awq import AutoAWQForCausalLM

# AWQ 양자화 적용
model = AutoAWQForCausalLM.from_pretrained(model_path)
model.quantize(tokenizer, quant_config={"zero_point": True, "q_group_size": 128, "w_bit": 4})
```

### KV Cache

Transformer의 Self-Attention은 이전 토큰들의 Key, Value 행렬을 매번 재계산하지 않도록 캐시합니다. 생성 속도를 크게 높이지만 **메모리를 많이 씁니다**. 시퀀스 길이가 길어질수록 KV Cache 크기가 선형으로 증가합니다.

**PagedAttention** (vLLM이 도입)은 이 문제를 OS의 가상 메모리 페이징에서 영감받아 해결합니다. KV Cache를 고정 크기 블록으로 관리해 단편화를 줄이고, 여러 요청 간 메모리를 효율적으로 공유합니다.

```python
from vllm import LLM, SamplingParams

llm = LLM(model="meta-llama/Llama-3-8B-Instruct")
outputs = llm.generate(prompts, SamplingParams(temperature=0.7, max_tokens=512))
```

### Speculative Decoding

LLM의 토큰 생성은 순차적입니다. 한 번에 하나씩 생성하기 때문에 병렬화가 어렵습니다.

Speculative Decoding은 이 병목을 우회합니다.
1. 작고 빠른 **Draft 모델**이 여러 토큰을 한 번에 예측
2. 큰 **Target 모델**이 Draft의 예측을 한 번의 Forward Pass로 병렬 검증
3. 일치하면 수락, 불일치 시점부터 Target 모델의 토큰으로 교체

Target 모델의 출력 품질은 유지하면서 추론 속도를 2~3배 높일 수 있습니다. 두 모델의 출력 분포가 비슷할수록 Draft 수락률이 높아지므로, 같은 계열의 작은 모델을 Draft로 쓰는 것이 일반적입니다.

---

## 7. 평가 (Evaluation)

좋은 시스템을 만들려면 무엇이 좋은지 측정할 수 있어야 합니다. LLM 기반 시스템의 평가는 전통 ML보다 훨씬 어렵습니다. 정답이 하나가 아니기 때문입니다.

### LLM-as-Judge

더 강력한 LLM을 평가자로 사용합니다. 사람 평가와 상관관계가 높으면서 비용과 속도를 크게 줄일 수 있습니다.

```python
eval_prompt = """
다음 기준으로 AI 답변을 평가하세요:
- 정확성 (1-5): 사실적으로 올바른가
- 완결성 (1-5): 질문을 충분히 다루는가
- 간결성 (1-5): 불필요한 내용 없이 간결한가

질문: {question}
답변: {answer}

JSON 형식으로 점수와 이유를 반환하세요.
"""

evaluation = judge_llm.invoke(eval_prompt.format(
    question=question,
    answer=answer,
))
```

주의할 점은 LLM-as-Judge가 **자기 자신과 같은 계열의 모델에게 높은 점수**를 주는 편향이 있다는 것입니다. 중요한 평가라면 여러 모델을 교차 평가하거나 사람 평가와 병행하는 게 좋습니다.

### RAGAS

RAG 시스템 특화 평가 프레임워크입니다. 4가지 지표를 자동으로 계산합니다.

| 지표 | 측정 대상 |
|------|----------|
| **Faithfulness** | 답변이 검색된 컨텍스트에 근거하는가 (할루시네이션 탐지) |
| **Answer Relevancy** | 답변이 질문과 관련 있는가 |
| **Context Precision** | 검색된 컨텍스트 중 실제 사용된 비율 |
| **Context Recall** | 올바른 답변에 필요한 정보가 컨텍스트에 있는가 |

```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_precision, context_recall

result = evaluate(
    dataset=eval_dataset,   # question, answer, contexts, ground_truth
    metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
)
print(result)
# {'faithfulness': 0.82, 'answer_relevancy': 0.91, ...}
```

---

## 전체 그림

AI 엔지니어링의 각 기법들은 독립적이지 않습니다. 현실의 시스템은 이것들이 조합된 형태입니다.

```
[사용자 입력]
     ↓
[프롬프트 엔지니어링] — 시스템 프롬프트, CoT 유도
     ↓
[RAG] — 관련 문서 검색 및 컨텍스트 주입
     ↓
[파인튜닝된 모델] — 도메인 특화 응답 생성
     ↓
[추론 최적화] — 양자화, KV Cache, Speculative Decoding
     ↓
[평가 루프] — LLM-as-Judge, RAGAS로 지속적 모니터링
```

ML 엔지니어링이 "좋은 모델을 만드는 기술"이었다면, AI 엔지니어링은 **"좋은 모델을 가지고 좋은 시스템을 만드는 기술"** 입니다. 모델의 역량을 최대한 끌어내고, 부족한 부분을 외부 지식과 도구로 보완하고, 전체 시스템의 품질을 지속적으로 측정하고 개선하는 것. 그것이 AI 엔지니어링의 본질입니다.

파운데이션 모델의 진입 장벽은 계속 낮아지고 있습니다. 앞으로의 경쟁력은 "어떤 모델을 쓰느냐"보다 **"모델을 어떻게 다루느냐"** 에서 갈릴 것입니다.
