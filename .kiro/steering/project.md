# 프로젝트 안내 (Kiro용)

- 강릉 여행 공유 계획표. 프런트엔드는 빌드 도구 없는 정적 HTML 한 장(`frontend/index.html`), 백엔드는 AWS SAM(`backend/template.yaml`, Node.js 20 Lambda + DynamoDB + HTTP API).
- 배포 순서는 README.md를 따른다: `sam build && sam deploy --guided` → `frontend/config.js`에 ApiUrl → `node scripts/seed.mjs <ApiUrl>` → GitHub push → Amplify Hosting 연결.
- `index.html` 아래쪽의 "서버 연결 (AWS API)" 부분이 API 어댑터다. 화면 코드는 `db`/`sample` 객체만 쓰니, API를 바꿀 때는 어댑터만 고친다.
- 저장 필드는 `backend/src/index.mjs`의 `FIELDS`에서 검사한다. 장소에 새 필드를 추가하면 여기에도 추가해야 저장된다.
- 화면 문구는 한국어, 해요체.
