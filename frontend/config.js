// 배포 후 `sam deploy` 출력의 ApiUrl 값을 넣으세요. 끝에 / 는 빼도 돼요.
window.APP_CONFIG = {
  apiUrl: "https://xxxxxxxxxx.execute-api.ap-northeast-2.amazonaws.com",
  pollMs: 4000 // 다른 사람이 바꾼 내용을 몇 ms마다 받아올지
};
