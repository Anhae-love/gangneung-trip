// 아티팩트에서 옮겨온 일정(seed/data.json)을 새 API에 넣습니다.
// 사용법: node scripts/seed.mjs https://xxxx.execute-api.ap-northeast-2.amazonaws.com [편집코드]
import { readFile } from "node:fs/promises";

const [, , apiArg, key] = process.argv;
if (!apiArg) {
  console.error("API 주소를 넣어 주세요. 예: node scripts/seed.mjs https://xxxx.execute-api.ap-northeast-2.amazonaws.com");
  process.exit(1);
}
const API = apiArg.replace(/\/+$/, "");
const headers = { "content-type": "application/json", ...(key ? { "x-edit-key": key } : {}) };
const data = JSON.parse(await readFile(new URL("../seed/data.json", import.meta.url), "utf8"));

const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};

await call("PUT", "/trip", data.trip);
const existing = new Set((await (await fetch(API + "/state")).json()).places.map((p) => p.id));
let added = 0;
for (const p of data.places) {
  if (existing.has(p.id)) continue; // 이미 있으면 건너뜀 (여러 번 실행해도 안전)
  await call("POST", "/places", p);
  added++;
}
console.log(`일정 설정 완료, 장소 ${added}곳 추가 (건너뜀 ${data.places.length - added}곳)`);
