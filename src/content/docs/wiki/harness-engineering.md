---
title: "하네스 엔지니어링 — 똑똑한 에이전트가 아니라, 올바르게 행동할 수밖에 없는 환경"
category: ai
description: "AI 코딩이 프롬프트에서 컨텍스트, 에이전트로 진화하면서 새로운 병목이 생겼다. 컨벤션을 무시하고 같은 실수를 반복하는 에이전트를 '더 똑똑하게' 만드는 대신, 어길 수 없는 환경을 설계하는 기술 — 하네스 엔지니어링. 지시 문서·아키텍처 제약·피드백 루프·지식 저장소의 4요소와 드리프트 방지까지."
---

처음엔 프롬프트였습니다.

```bash
"이 함수 고쳐줘."
```

그다음은 컨텍스트였습니다. 파일 몇 개를 붙여넣고, 배경을 설명하고, 원하는 방향을 안내했더니 결과가 눈에 띄게 좋아졌습니다.

그리고 지금은 에이전트입니다. AI가 **직접** 파일을 읽고, 코드를 쓰고, 테스트를 돌리고, PR까지 올립니다. 사람이 일일이 지시하지 않아도 됩니다.

그런데 문제가 생겼습니다.

에이전트는 강력하지만 — 팀의 컨벤션을 무시하고, 없던 파일을 만들고, 이미 결정한 아키텍처를 뒤집어 놓습니다. 에이전트를 탓할 수도 없습니다. **우리가 규칙을 알려준 적이 없으니까요.**

이 문제를 다루는 개념이 **하네스 엔지니어링(Harness Engineering)** 입니다. 하네스는 에이전트를 더 똑똑하게 만드는 기술이 아닙니다. 에이전트가 **올바르게 행동할 수밖에 없는 환경**을 설계하는 기술입니다. 말 위에 안장과 고삐를 얹어 그 힘을 원하는 방향으로 이끄는 것처럼요.

---

## AI 코딩의 세 시대

### 1. 프롬프트 시대

```bash
"이 함수 버그 고쳐줘."
```

입력 하나, 출력 하나. AI는 질문에 답하는 도구였습니다. 대화가 끝나면 AI는 아무것도 기억하지 못합니다. 새 창을 열면 맥락을 매번 처음부터 다시 설명해야 했습니다.

이때의 병목은 **개발자의 설명 능력**이었습니다.

### 2. 컨텍스트 시대

```bash
[파일 3개 첨부] + "이 구조에서 인증 모듈 추가해줘."
```

파일과 배경을 함께 주면서 결과물의 질이 올라갔습니다. 하지만 이 컨텍스트는 **세션이 끝나면 사라집니다.** 다음 대화에서 또 설명해야 합니다.

이때의 병목은 **매번 컨텍스트를 준비하는 비용**입니다.

### 3. 에이전트 시대

```bash
"인증 모듈 추가하고, 테스트 작성한 다음, PR 올려줘."
```

에이전트는 스스로 파일을 탐색하고, 코드를 작성하고, 테스트를 실행합니다. 사람의 개입 없이 작업을 끝까지 완료합니다.

이제 병목은 **에이전트가 올바른 방향으로 일하게 만드는 능력**으로 옮겨갑니다.

> 프롬프트와 컨텍스트는 **입력을 개선**하는 방식입니다.
> 하네스는 **환경을 설계**하는 방식입니다.

에이전트에게 매번 규칙을 설명하는 대신, 규칙을 **어길 수 없는 환경**을 만드는 것. 에이전트가 일하는 무대 자체를 바꾸는 것. 그게 하네스입니다.

---

## 에이전트는 왜 사고를 칠까

에이전트는 강력하지만, 방치하면 다음과 같은 일이 반복됩니다.

| # | 문제 | 이유 |
|---|------|------|
| 1 | **코드 스타일 불일치** | 팀의 네이밍·파일 구조 규칙을 모른다 |
| 2 | **구조 무시** | 정해진 레이어를 건너뛰고, 경계를 무시한 의존성을 만든다. 당장은 동작하지만 나중에 고치기 어려운 코드가 된다 |
| 3 | **같은 실수 반복** | 규칙을 문서화하지 않는 한 매번 반복된다 |
| 4 | **파일 누적** | 필요하다고 판단하면 파일을 계속 만들어낸다 |
| 5 | **컨텍스트 불안** | 처리 가능한 정보량의 한계에 가까워졌다고 느끼면, 실제로 여유가 남아 있어도 작업을 제대로 마무리하지 않고 "완료" 처리한다 |

원인은 하나로 모입니다.

> 에이전트는 **지시받은 것만** 안다. 말하지 않은 규칙은 존재하지 않는 것과 같다.

개발자가 암묵적으로 알고 있는 설계 의도, 과거의 실패 경험 — 이런 맥락이 에이전트에겐 없습니다.

그래서 보통 이렇게 대응합니다.

1. **재입력** — 매번 규칙을 다시 설명한다 (피곤하고, 빠뜨린다)
2. **사후 수정** — 결과를 사람이 고친다 (자동화의 이점이 사라진다)
3. **하네스 설계** — 규칙을 구조와 파일로 **영구화**한다

세 번째가 하네스 엔지니어링입니다.

> 우리가 해야 할 일은 에이전트의 **능력을 제한**하는 게 아니라, 그 능력이 **올바른 방향으로 발휘되도록 구조를 갖추는** 것입니다.
> 잘 설계된 조직에서는 새로 합류한 사람도 자연스럽게 올바른 방식으로 일하게 되는 것처럼요.

---

## 어디서부터 하네스가 필요해지는가 — Hashimoto의 6단계

Terraform·Vault를 만든 Mitchell Hashimoto는 자신의 AI 도입 경험을 6단계로 정리했습니다. 단계가 올라갈수록 AI의 자율성이 커지고, 개발자에게 요구되는 것도 달라집니다.

| 단계 | 이름 | 무엇을 하나 |
|------|------|-------------|
| 1 | **자동완성** | IDE에서 코드 한 줄을 제안받는다. AI가 '도구'로 느껴진다 |
| 2 | **코드 생성** | "이 함수 만들어줘"처럼 명시적으로 요청하고, 결과를 검토해 붙여넣는다 |
| 3 | **인터랙티브 편집** | 파일을 열어두고 AI와 대화하며 함께 고친다. 컨텍스트가 생겨 결과 질이 올라간다 |
| 4 | **단일 에이전트** | AI가 스스로 파일을 읽고, 코드를 쓰고, 테스트를 돌린다. 사람은 결과만 확인한다 |
| 5 | **병렬 에이전트** | 여러 에이전트가 동시에 다른 작업을 처리한다. 빨라지지만 일관성 관리가 어려워진다 |
| 6 | **자율 에이전트 시스템** | 이슈를 읽고, 코드를 쓰고, PR을 올리는 전 과정을 자율 수행한다. 개발자는 방향을 정하고 결과를 검토한다 |

### 단계별 병목

| 단계 | 핵심 변화 | 새로운 병목 |
|------|-----------|-------------|
| 1–2 | AI가 제안, 사람이 판단 | 프롬프트 작성 능력 |
| 3 | 맥락을 가진 대화 | 컨텍스트 준비 비용 |
| 4 | AI가 스스로 실행 | **에이전트 방향 설정** |
| 5–6 | 자율·병렬 처리 | **일관성, 재발 방지 구조** |

### 하네스가 필요해지는 지점

문제는 **4단계부터** 시작됩니다. 에이전트가 스스로 판단하고 실행하는 순간, 개발자의 암묵적 규칙은 더 이상 전달되지 않습니다.

Hashimoto의 핵심 통찰이 여기서 나옵니다.

> *"에이전트가 실수했을 때, 나는 그 실수를 고치는 데서 멈추지 않는다. 그 실수가 **구조적으로 재발 불가능**하도록 만든다."*

실수를 고치는 건 1회성 해결입니다. 구조를 바꿔 지속적으로 해결되게 하는 것 — 그게 하네스입니다. 4단계 이상에서 하네스 없이 에이전트를 운용하는 건, **안전망 없이 줄타기를 하는 것**과 같습니다.

---

## 하네스의 4가지 구성 요소

하네스는 네 가지 요소로 이루어집니다. 각각 따로도 효과가 있지만, 넷이 함께 작동할 때 비로소 온전한 하네스가 됩니다.

```text
프로젝트 루트/
│
├── AGENTS.md          ← ① 지시 문서
├── .eslintrc          ← ② 아키텍처 제약
│
├── tests/             ← ③ 피드백 루프
│   └── ...
│
└── docs/              ← ④ 지식 저장소
    ├── decisions/
    └── conventions/
```

| 요소 | 역할 | 한 줄 |
|------|------|-------|
| ① 지시 문서 | 에이전트에게 규칙을 전달 | "**어떻게** 할지" 안다 |
| ② 아키텍처 제약 | 잘못된 코드를 구조적으로 차단 | 잘못된 방향으로 가면 **막힌다** |
| ③ 피드백 루프 | 행동을 실시간으로 교정 | 결과가 맞는지 즉시 **확인한다** |
| ④ 지식 저장소 | 결정과 맥락을 축적 | **왜** 이렇게 하는지 안다 |

네 요소가 모두 갖춰졌을 때, 에이전트는 새 세션에서도 사람의 규칙과 맥락 안에서 일합니다.

> **하네스가 아닌 것** — 프롬프트 엔지니어링, 코딩 컨벤션 '문서', CI/CD 파이프라인. 이들은 하네스의 재료일 수는 있어도, 그 자체로 하네스는 아닙니다. 하네스는 이 재료들을 **에이전트가 어길 수 없게 엮은 시스템**입니다.

---

## ① 지시 문서

에이전트가 작업을 시작하기 전에 읽는 매뉴얼입니다. `AGENTS.md`, `CLAUDE.md` 같은 파일이 여기 해당합니다. 파일 이름만 다를 뿐 작성 원칙은 같습니다.

- 코드 스타일, 네이밍 규칙
- 절대 건드리면 안 되는 파일·디렉토리
- PR 작성 방식, 커밋 메시지 형식

사람을 위한 README처럼, **에이전트를 위한 행동 지침**입니다.

### 좋은 지시 문서의 조건

| 조건 | 설명 |
|------|------|
| 목차형 구조 | 필요한 섹션을 빠르게 찾을 수 있어야 한다 |
| 구체적인 규칙 | "좋은 코드를 써라"보다 "함수는 단일 책임을 가진다"가 낫다 |
| 금지 사항 명시 | 하면 안 되는 것을 명확히 적는다 |
| 짧고 명확하게 | 길수록 에이전트가 중요한 규칙을 놓친다 |

### 예시 — AGENTS.md

```markdown
## 디렉토리 구조
src/
├── api/        # 라우터만. 비즈니스 로직 금지
├── services/   # 비즈니스 로직
├── models/     # DB 모델
└── utils/      # 순수 함수만

## 코드 규칙
- 함수명: snake_case / 클래스명: PascalCase
- 한 함수는 하나의 역할만 수행한다
- 타입 힌트 필수

## 절대 금지
- `src/core/` 파일 수정 금지 (레거시, 건드리면 장애)
- `print()` 사용 금지 → `logger.info()` 사용
- 직접 DB 쿼리 금지 → 반드시 서비스 레이어 경유

## PR 규칙
- 커밋 메시지: `feat:`, `fix:`, `refactor:` 접두사 사용
- PR 하나에 하나의 변경만
- 테스트 없는 PR은 올리지 않는다

## 테스트
- 위치: `tests/` 디렉토리 / 실행: `pytest tests/`
- 새 기능에는 반드시 테스트 추가
```

### 디렉토리별 지시 문서

프로젝트가 커지면 루트의 `AGENTS.md` 하나로는 부족합니다. 각 디렉토리에 별도 파일을 둘 수 있습니다.

```text
프로젝트 루트/
├── AGENTS.md              ← 전체 규칙
├── src/
│   ├── api/
│   │   └── AGENTS.md      ← API 레이어 전용 규칙
│   └── services/
│       └── AGENTS.md      ← 서비스 레이어 전용 규칙
└── tests/
    └── AGENTS.md          ← 테스트 작성 규칙
```

```markdown
# src/api/AGENTS.md
## 이 디렉토리의 역할
라우터 정의만 담당합니다.

## 규칙
- 비즈니스 로직은 services/로 위임할 것
- 응답 형식은 항상 `ResponseModel`을 사용할 것
- 인증이 필요한 엔드포인트는 `@require_auth` 데코레이터 필수
```

### 흔한 실수 — 너무 추상적인 규칙

```markdown
# ❌ 추상적
- 읽기 좋은 코드를 작성한다
- 좋은 네이밍을 사용한다

# ✅ 구체적
- 변수명은 역할을 명확히 드러낸다 (e.g. `user_id`, not `id`)
- 불리언 변수는 `is_`, `has_` 접두사를 사용한다
```

---

## ② 아키텍처 제약

지시 문서는 "읽어주길" 기대하지만, 아키텍처 제약은 **읽지 않아도 막습니다.** 코드가 저장되거나 병합되기 전에 자동으로 검사하는 장치입니다.

| 방식 | 설명 | 예시 |
|------|------|------|
| 정적 분석 | 코드 저장 시 자동 검사 | 린터, 타입 검사 |
| 구조적 제약 | 디렉토리·파일 구조로 경계 설정 | import 규칙, 경로 제한 |

> 에이전트가 규칙을 몰라도, 잘못된 코드는 통과하지 못합니다.

### 린터 — Python (ruff)

`ruff`는 Python에서 가장 빠른 린터입니다. 설정 파일 하나로 에이전트가 생성하는 코드 품질을 일관되게 유지할 수 있습니다.

```toml
# pyproject.toml
[tool.ruff]
line-length = 88
target-version = "py311"

[tool.ruff.lint]
select = [
    "E",   # pycodestyle
    "F",   # pyflakes (미사용 변수 등)
    "I",   # isort (import 정렬)
    "N",   # 네이밍 규칙
]

# 상대 import 금지 (절대 import만 허용)
[tool.ruff.lint.flake8-tidy-imports]
ban-relative-imports = "all"
```

### 린터 — JavaScript / TypeScript (ESLint)

```json
// .eslintrc.json
{
  "rules": {
    "no-console": "error",
    "no-unused-vars": "error",
    "prefer-const": "error"
  },
  "settings": {
    "import/no-restricted-paths": {
      "zones": [
        {
          "target": "./src/api",
          "from": "./src/models",
          "message": "api 레이어에서 models 직접 참조 금지. services를 경유하세요."
        }
      ]
    }
  }
}
```

### 레이어 간 import 제약

가장 흔한 구조 문제는 레이어를 건너뛰는 import입니다. `import-linter`(Python)나 `eslint-plugin-import`(JS)로 구조적으로 차단합니다.

```ini
# .importlinter (Python)
[importlinter]
root_package = src

[importlinter:contract:레이어 규칙]
name = 레이어 간 의존성 규칙
type = layers
layers =
    src.api
    src.services
    src.models
# api → services → models 방향만 허용
# models에서 api를 참조하면 자동으로 오류
```

### pre-commit 훅 — 저장소에 들어오기 전에 차단

에이전트가 커밋을 시도하는 순간 검사를 실행합니다.

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.0
    hooks:
      - id: ruff          # 린트 검사
      - id: ruff-format   # 자동 포맷
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.9.0
    hooks:
      - id: mypy          # 타입 검사
```

```bash
# 최초 1회 설치
pip install pre-commit
pre-commit install
```

설치 후에는 검사를 통과하지 못한 코드가 자동으로 차단됩니다.

### 원칙 — 문서와 제약은 일치해야 한다

> **규칙은 문서보다 코드로 강제할 때 더 잘 지켜진다.**

지시 문서의 규칙과 린터 설정은 반드시 맞아야 합니다. 문서엔 `print()` 금지라고 써놓고 린터가 허용한다면, 에이전트는 결국 `print()`를 씁니다. 그러니 문서에도 검사 사실을 명시하세요.

```markdown
# AGENTS.md
## 자동 검사
- 커밋 전 `pre-commit` 자동 실행
- `ruff`, `mypy` 검사 통과 필수
- 검사 실패 시 커밋 불가
```

---

## ③ 피드백 루프

에이전트는 결과에 대한 피드백을 받아야 방향을 교정할 수 있습니다. Martin Fowler는 이 피드백을 **가이드(Guide)** 와 **센서(Sensor)** 로 나눕니다.

| 구분 | 역할 | 시점 | 예시 |
|------|------|------|------|
| 가이드 | 올바른 방향을 **미리** 안내 | 작업 전·중 | 예제 코드, 테스트 케이스 |
| 센서 | 잘못된 결과를 **감지** | 작업 후 | CI 실패, 린터 경고, 테스트 실패 |

가이드는 실수를 **예방**하고, 센서는 실수를 **포착**합니다. 둘 다 있어야 온전한 루프가 됩니다.

### 가이드 — 예제 코드로 방향 제시

에이전트는 설명보다 예시에서 더 많이 배웁니다. 지시 문서에 올바른 패턴을 직접 넣어두세요.

```python
# AGENTS.md 안의 예시

# ✅ 올바른 패턴
@router.get("/users/{user_id}")
async def get_user(user_id: int, service: UserService = Depends()):
    return await service.get_user(user_id)

# ❌ 금지 패턴: 서비스 레이어 없이 직접 DB 접근
@router.get("/users/{user_id}")
async def get_user(user_id: int, db: Session = Depends()):
    return db.query(User).filter(User.id == user_id).first()
```

### 가이드 — 테스트로 기대 동작 명시

테스트는 가장 강력한 가이드입니다. 에이전트는 테스트를 통과하는 코드를 쓰려고 하기 때문에, 구현 전에 테스트를 먼저 깔아두면 방향이 잡힙니다.

```python
# tests/test_user_service.py
def test_get_user_returns_none_when_not_found():
    service = UserService()
    assert service.get_user(user_id=999) is None

def test_get_user_raises_error_when_id_negative():
    service = UserService()
    with pytest.raises(ValueError):
        service.get_user(user_id=-1)
```

### 센서 — CI 파이프라인

가장 강력한 센서입니다.

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: 린트 검사
        run: ruff check .
      - name: 타입 검사
        run: mypy src/
      - name: 테스트 실행
        run: pytest tests/ -v
      - name: 커버리지 확인 (80% 미만이면 실패)
        run: pytest --cov=src --cov-fail-under=80
```

CI가 실패하면 에이전트는 스스로 원인을 파악하고 수정을 시도합니다. **피드백이 명확할수록 수정도 정확해집니다.**

### 센서 메시지는 구체적으로

```python
# ❌ 모호한 오류
raise ValueError("잘못된 입력")

# ✅ 구체적 오류: 무엇을 고쳐야 할지 즉시 안다
raise ValueError(f"user_id는 양의 정수여야 합니다. 전달된 값: {user_id}")
```

### 전체 흐름

```text
에이전트 작업 시작
      ↓
[가이드] AGENTS.md 예시 참고 → 올바른 방향으로 코드 작성
      ↓
[센서] pre-commit 린터 → 형식 오류 즉시 차단
      ↓
[센서] CI 테스트 → 로직 오류 감지
      ↓
실패 시: 에이전트가 오류 메시지를 읽고 스스로 수정
통과 시: PR 생성
```

> 피드백은 빠를수록 좋습니다. 잘못된 방향으로 100줄을 쓴 뒤 알게 되는 것보다, 10줄 시점에 아는 게 훨씬 낫습니다.

---

## ④ 지식 저장소

에이전트는 매 세션 **백지에서 시작**합니다. 팀이 왜 이 구조를 택했는지, 어떤 방법을 시도했다 포기했는지 알 수 없습니다. 지식 저장소는 그 공백을 채우는 장치입니다.

| 종류 | 내용 | 예시 |
|------|------|------|
| 결정 기록 | 왜 이 방식을 선택했는가 | "Redis 대신 PostgreSQL을 캐시로 쓰는 이유" |
| 실패 기록 | 시도했다 포기한 방법 | "Celery 도입 실패 — 운영 복잡도 과다" |
| 도메인 지식 | 비즈니스 규칙·용어 | "주문 상태 전이 규칙" |

특히 **실패 기록**이 중요합니다. 에이전트는 이미 실패한 방법을 모르면 같은 시도를 반복합니다.

### 디렉토리 구조

```text
docs/
├── decisions/          # 기술 결정 기록 (ADR)
│   ├── 001-database.md
│   └── 003-caching.md
├── conventions/        # 코딩 규칙 상세
│   ├── naming.md
│   └── testing.md
├── domain/             # 비즈니스 도메인 지식
│   ├── glossary.md
│   └── workflows.md
└── failures/           # 실패 기록
    ├── 001-celery.md
    └── 002-graphql.md
```

### 결정 기록 (ADR) 작성법

ADR(Architecture Decision Record)은 기술 결정을 기록하는 표준 형식입니다.

```markdown
# 003. 캐싱 전략: Redis 대신 PostgreSQL 사용

## 상태
확정 (2025-11-01)

## 배경
세션 데이터 캐싱을 위해 별도 캐시 레이어가 필요했다.

## 결정
Redis를 추가하지 않고 PostgreSQL의 UNLOGGED TABLE을 캐시로 사용한다.

## 이유
- 현재 트래픽 규모에서 Redis의 성능 이점이 미미함
- 인프라 복잡도 최소화가 우선
- PostgreSQL만으로 운영 가능한 단순한 구조 유지

## 포기한 대안
- Redis: 운영 부담 대비 이점 없음
- Memcached: 팀 내 운영 경험 부족

## 결과
이 결정을 번복하려면 먼저 팀 논의 필요.
에이전트는 캐싱 작업 시 Redis 도입을 제안하지 않는다.
```

### 실패 기록 작성법

```markdown
# 001. Celery 도입 실패

## 시도한 날짜
2025-09-15

## 시도한 이유
비동기 작업 처리를 위해 Celery + Redis 도입을 시도했다.

## 실패 원인
- 로컬 개발 환경 설정이 복잡해져 온보딩 비용 증가
- 작업 실패 시 디버깅이 어려움
- 현재 비동기 작업 규모가 Celery를 정당화하지 못함

## 현재 대안
FastAPI의 BackgroundTasks로 충분히 처리 가능.

## 에이전트 지침
비동기 처리는 BackgroundTasks를 사용할 것.
Celery 도입은 제안하지 않는다.
```

### AGENTS.md와 연결하기

지식 저장소는 `AGENTS.md`에서 참조해야 에이전트가 실제로 읽습니다.

```markdown
# AGENTS.md
## 참고 문서 (작업 전 반드시 확인)
- 기술 결정: `docs/decisions/` — 왜 이 구조인지
- 실패 기록: `docs/failures/` — 시도하면 안 되는 방법
- 용어 사전: `docs/domain/glossary.md` — 도메인 용어의 정확한 의미
```

---

## 하네스도 흐트러진다 — 드리프트와 가비지 컬렉션

하네스를 잘 구축해도 시간이 지나면 흐트러집니다. 에이전트가 임시 파일을 남기고, 안 쓰는 코드가 쌓이고, 지시 문서와 실제 코드가 어긋나기 시작합니다. 이 현상을 **드리프트(drift)** 라고 합니다.

| 유형 | 증상 | 예시 |
|------|------|------|
| 코드 드리프트 | 안 쓰는 코드 누적 | 미사용 함수, 죽은 import |
| 문서 드리프트 | 코드와 문서가 어긋남 | AGENTS.md 규칙이 실제와 다름 |
| 구조 드리프트 | 디렉토리 규칙 붕괴 | 임시 파일, 규칙 밖 경로 |

**가비지 컬렉션**은 이 드리프트를 자동으로 감지하고 정리하는 장치입니다.

### 미사용 코드 감지

```bash
# Python — vulture
pip install vulture
vulture src/
# src/utils/helpers.py:24: unused function 'format_legacy_date' (80%)
# src/models/user.py:87:  unused variable 'temp_cache' (100%)

# TypeScript — ts-prune
npx ts-prune src/
```

### 문서 드리프트 감지

`AGENTS.md`가 언급하는 파일이 실제로 존재하는지 주기적으로 확인합니다.

```python
# scripts/check_docs_drift.py
import re
from pathlib import Path

def check_drift():
    agents_md = Path("AGENTS.md").read_text()
    mentioned = re.findall(r'`([\w/]+\.\w+)`', agents_md)
    missing = [f for f in mentioned if not Path(f).exists()]
    if missing:
        print("AGENTS.md에 언급됐지만 없는 파일:", *missing, sep="\n  - ")
        return False
    print("문서 드리프트 없음")
    return True
```

### 구조 드리프트 감지

허용되지 않는 경로에 파일이 생겼는지 확인합니다.

```python
# scripts/check_structure.py
from pathlib import Path

FORBIDDEN = ["temp_*.py", "*_new.py", "*_old.py", "*_backup.*", "*_fix.*"]

def check_structure():
    violations = [f for p in FORBIDDEN for f in Path("src/").rglob(p)]
    if violations:
        print("구조 규칙 위반:", *violations, sep="\n  - ")
        return False
    print("구조 드리프트 없음")
    return True
```

### 정기 실행 자동화

가비지 컬렉션을 CI에 넣어 주기적으로 돌립니다.

```yaml
# .github/workflows/housekeeping.yml
name: 하네스 상태 점검
on:
  schedule:
    - cron: '0 9 * * 1'   # 매주 월요일 오전 9시
  workflow_dispatch:        # 수동 실행도 가능
jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: vulture src/
      - run: python scripts/check_docs_drift.py
      - run: python scripts/check_structure.py
```

### 정리 규칙도 문서로

```markdown
# AGENTS.md
## 정리 규칙
- 임시 파일은 작업 완료 즉시 삭제한다
- `temp_`, `_new`, `_old`, `_backup` 이름의 파일을 만들지 않는다
- 사용하지 않는 import는 즉시 제거한다
- 디버그용 코드는 PR 전에 삭제한다
```

---

## 정리

AI 코딩은 프롬프트 → 컨텍스트 → 에이전트로 진화했고, 그때마다 병목이 바뀌었습니다. 에이전트 시대의 병목은 "AI를 더 똑똑하게 만드는 것"이 아니라 **"AI가 올바르게 일하게 만드는 것"** 입니다.

하네스 엔지니어링은 그 답을, 능력 제한이 아니라 **환경 설계**에서 찾습니다.

```text
지시 문서   →  에이전트가 "어떻게 할지" 안다
아키텍처 제약 →  잘못된 방향으로 가면 막힌다
피드백 루프  →  결과가 맞는지 즉시 확인한다
지식 저장소  →  왜 이렇게 하는지 이유를 안다
가비지 컬렉션 →  시간이 지나도 무너지지 않는다
```

좋은 하네스는, 에이전트가 특별히 신경 쓰지 않아도 올바른 결과를 냅니다. 잘 설계된 조직에서 새로 온 사람도 자연스럽게 올바르게 일하게 되는 것처럼요. 말의 힘을 억누르는 게 아니라, 원하는 방향으로 이끄는 고삐 — 그게 하네스입니다.
