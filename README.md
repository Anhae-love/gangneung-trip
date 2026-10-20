# 강릉 여행 계획 (AWS 버전)

Claude 아티팩트로 만든 공유 여행 계획표를 AWS에서 돌아가는 웹사이트로 옮긴 프로젝트예요.
링크를 아는 사람은 **로그인 없이** 장소를 보고, 추가하고, 고칠 수 있어요.

```
frontend/        정적 웹페이지 (Amplify Hosting으로 배포)
  index.html     계획표 화면 (리스트 + 지도)
  config.js      API 주소 설정  ← 배포 후 한 번 수정
backend/         API (AWS SAM: HTTP API + Lambda + DynamoDB)
  template.yaml
  src/index.mjs
seed/data.json   아티팩트에 있던 일정 19곳 (옮겨 넣기용)
scripts/seed.mjs seed 데이터를 API에 넣는 스크립트
amplify.yml      Amplify Hosting 설정 (frontend 폴더를 그대로 배포)
```

## 준비물

- AWS 계정, AWS CLI (`aws configure`로 로그인), AWS SAM CLI
- Node.js 20 이상
- GitHub 계정

## 1. 백엔드 배포

```bash
cd backend
sam build
sam deploy --guided
```

`--guided`에서 물어보는 값:

| 항목 | 추천 값 |
|---|---|
| Stack Name | `gangneung-trip` |
| AWS Region | `ap-northeast-2` (서울) |
| EditKey | 비워 두면 누구나 편집. 값을 넣으면 처음 편집할 때 그 코드를 물어봐요 |
| BedrockModelId | 처음엔 비워 두세요 (AI 기능 꺼짐). 아래 "AI 기능 켜기" 참고 |
| AllowedOrigin | 처음엔 `*` |
| 나머지 | 기본값(Y)으로 진행 |

끝나면 출력에 `ApiUrl`이 나와요. 예: `https://abcd1234.execute-api.ap-northeast-2.amazonaws.com`

## 2. API 주소 넣기

`frontend/config.js`의 `apiUrl`을 위에서 받은 `ApiUrl`로 바꿔요.

## 3. 기존 일정 옮기기

```bash
node scripts/seed.mjs <ApiUrl> [편집코드]
```

여러 번 실행해도 같은 장소가 두 번 들어가지 않아요.

## 4. GitHub에 올리기

```bash
git init
git add .
git commit -m "강릉 여행 계획"
git branch -M main
git remote add origin https://github.com/<내 아이디>/gangneung-trip.git
git push -u origin main
```

## 5. 웹사이트 배포 (Amplify Hosting)

1. AWS 콘솔 → **AWS Amplify** → 새 앱 만들기 → **GitHub** 선택 후 연결
2. 저장소 `gangneung-trip`, 브랜치 `main` 선택
3. 빌드 설정은 저장소의 `amplify.yml`을 자동으로 읽어요. 그대로 저장하고 배포
4. 몇 분 뒤 `https://main.xxxx.amplifyapp.com` 같은 주소가 나와요. 이 주소를 단톡방에 공유하면 돼요

이후로는 `git push`만 하면 사이트가 자동으로 다시 배포돼요.

(선택) 다른 사이트에서 API를 못 쓰게 하려면 `AllowedOrigin`을 위 Amplify 주소로 바꿔서 다시 배포하세요.

```bash
cd backend && sam deploy --parameter-overrides AllowedOrigin=https://main.xxxx.amplifyapp.com
```

## AI 기능 켜기 (선택)

'Claude에게 정보 받기'와 '위치 찾기'는 Amazon Bedrock의 Claude를 써요. 꺼 두면 두 버튼이 화면에서 사라지고 나머지는 그대로 동작해요.

1. AWS 콘솔 → **Amazon Bedrock** → 모델 액세스에서 Anthropic Claude 모델 사용을 신청해요
2. 쓸 모델의 **모델 ID 또는 추론 프로필 ID**를 콘솔에서 그대로 복사해요 (빠르고 저렴한 Haiku 계열 추천)
3. 다시 배포해요

```bash
cd backend && sam deploy --parameter-overrides BedrockModelId=<복사한 ID> EditKey=<편집코드>
```

> ⚠️ AI 기능은 호출할 때마다 요금이 나와요. 사이트 주소를 아는 누구나 누를 수 있으니 AI를 켤 때는 **EditKey를 꼭 설정**하세요. API에는 초당 요청 수 제한도 걸어 뒀어요.

## 원래 아티팩트와 다른 점

- 로그인이나 초대 없이 주소만 알면 누구나 편집 (EditKey를 설정하면 코드를 아는 사람만)
- 다른 사람이 바꾼 내용은 4초마다 자동으로 받아와요 (`config.js`의 `pollMs`)
- '○○님이 추가' 표시는 없어요 (로그인이 없어서)

## 비용

몇 명이 쓰는 여행 계획 정도면 Lambda, DynamoDB(온디맨드), API Gateway, Amplify 모두 사용량이 아주 적어서 거의 들지 않아요. Bedrock(AI)만 호출 수만큼 따로 과금돼요. 여행이 끝나면 `sam delete`와 Amplify 앱 삭제로 정리하세요.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/state` | 일정과 장소 전체, AI 사용 여부 |
| POST | `/places` | 장소 추가 |
| PATCH | `/places/{id}` | 장소 일부 수정 |
| DELETE | `/places/{id}` | 장소 삭제 |
| PUT | `/trip` | 출발일, 일정 일수 저장 |
| POST | `/ai` | `{ prompt }` → Bedrock Claude 답변 `{ text }` |

EditKey를 설정하면 GET을 뺀 요청에 `x-edit-key` 헤더가 필요해요.
