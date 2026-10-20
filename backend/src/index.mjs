// 강릉 여행 계획 API
// GET    /state        -> { trip, places, ai, needKey }
// POST   /places       -> 장소 추가 (body: 장소 필드, 선택적으로 id)
// PATCH  /places/{id}  -> 장소 필드 일부 수정
// DELETE /places/{id}  -> 장소 삭제
// PUT    /trip         -> { days, start } 저장
// POST   /ai           -> { prompt } 를 Bedrock 의 Claude 에 보내고 { text } 반환
import { randomBytes, timingSafeEqual } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const TABLE = process.env.TABLE_NAME;
const EDIT_KEY = process.env.EDIT_KEY || "";
const MODEL_ID = process.env.MODEL_ID || "";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const bedrock = MODEL_ID ? new BedrockRuntimeClient({}) : null;

const TRIP_ID = "meta:trip";
const PLACE_PREFIX = "p:";
const MAX_PLACES = 300;

// 저장을 허용하는 필드와 검사 규칙
const STR = (max) => (v) => (typeof v === "string" ? v.slice(0, max) : undefined);
const NUM = (min, max) => (v) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const BOOL = (v) => (typeof v === "boolean" ? v : undefined);
const FIELDS = {
  name: STR(60),
  cat: (v) => (["관광", "맛집", "카페", "숙소", "기타"].includes(v) ? v : "기타"),
  day: NUM(0, 10),
  time: (v) => (typeof v === "string" && /^(\d{2}:\d{2})?$/.test(v) ? v : undefined),
  memo: STR(300),
  lat: NUM(33, 39),
  lng: NUM(124, 132),
  pinned: BOOL,
  cand: BOOL,
  approx: (v) => (v === false || v === "area" || v === "guess" ? v : undefined),
  by: STR(60),
  createdAt: NUM(0, 1e14),
  info: (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const out = {};
    for (const k of ["summary", "area", "hours", "cost", "stay", "tip"]) if (typeof v[k] === "string" && v[k].trim()) out[k] = v[k].slice(0, 500);
    if (typeof v.at === "number") out.at = v.at;
    return out;
  },
};
function clean(body, { partial }) {
  const out = {};
  for (const [k, check] of Object.entries(FIELDS)) {
    if (!(k in body)) continue;
    const v = check(body[k]);
    if (v !== undefined) out[k] = v;
  }
  if (!partial) {
    if (!out.name || !out.name.trim()) throw httpError(400, "장소 이름이 필요해요.");
    out.cat ??= "기타";
    out.day ??= 0;
    out.time ??= "";
    out.memo ??= "";
    out.createdAt ??= Date.now();
  }
  return out;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(body),
});
function keyOk(event) {
  if (!EDIT_KEY) return true;
  const got = Buffer.from(String(event.headers?.["x-edit-key"] || ""));
  const want = Buffer.from(EDIT_KEY);
  return got.length === want.length && timingSafeEqual(got, want);
}
function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (raw.length > 20000) throw httpError(413, "요청이 너무 커요.");
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
    return v;
  } catch {
    throw httpError(400, "JSON 형식이 아니에요.");
  }
}

async function scanAll() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function getState() {
  const items = await scanAll();
  const tripItem = items.find((i) => i.id === TRIP_ID);
  const places = items
    .filter((i) => i.id.startsWith(PLACE_PREFIX))
    .map(({ id, ...rest }) => ({ id: id.slice(PLACE_PREFIX.length), ...rest }));
  return {
    trip: tripItem ? { days: tripItem.days, start: tripItem.start || "" } : { days: 2, start: "" },
    places,
    ai: !!MODEL_ID,
    needKey: !!EDIT_KEY,
  };
}

async function addPlace(body) {
  const data = clean(body, { partial: false });
  const count = (await scanAll()).filter((i) => i.id.startsWith(PLACE_PREFIX)).length;
  if (count >= MAX_PLACES) throw httpError(409, "장소가 너무 많아요. 안 쓰는 장소를 지워 주세요.");
  const id = typeof body.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(body.id) ? body.id : randomBytes(10).toString("hex");
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { id: PLACE_PREFIX + id, ...data } }));
  return { id };
}

async function editPlace(id, body) {
  const data = clean(body, { partial: true });
  const keys = Object.keys(data);
  if (!keys.length) return { ok: true };
  const names = {}, values = {};
  const sets = keys.map((k, i) => {
    names["#k" + i] = k;
    values[":v" + i] = data[k];
    return `#k${i} = :v${i}`;
  });
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { id: PLACE_PREFIX + id },
      UpdateExpression: "SET " + sets.join(", "),
      ConditionExpression: "attribute_exists(id)",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") throw httpError(404, "이미 삭제된 장소예요.");
    throw e;
  }
  return { ok: true };
}

async function setTrip(body) {
  const days = Math.max(1, Math.min(10, Math.round(Number(body.days) || 2)));
  const start = typeof body.start === "string" && /^(\d{4}-\d{2}-\d{2})?$/.test(body.start) ? body.start : "";
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { id: TRIP_ID, days, start } }));
  return { days, start };
}

async function askClaude(body) {
  if (!bedrock) throw httpError(501, "AI 기능이 꺼져 있어요.");
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 4000) : "";
  if (!prompt.trim()) throw httpError(400, "질문이 비어 있어요.");
  const r = await bedrock.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: "너는 한국 여행 일정 도우미야. 요청한 JSON 형식으로만 답해. 모르는 정보는 지어내지 마." }],
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 800, temperature: 0.2 },
  }));
  const text = (r.output?.message?.content || []).map((c) => c.text || "").join("").trim();
  if (!text) throw httpError(502, "답을 받지 못했어요.");
  return { text };
}

export const handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath || "";
    const id = event.pathParameters?.id;
    if (id && !/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw httpError(400, "잘못된 장소 ID예요.");

    if (method === "GET" && path === "/state") return json(200, await getState());

    if (!keyOk(event)) return json(403, { error: "편집 코드가 맞지 않아요.", code: "bad_key" });

    if (method === "POST" && path === "/places") return json(201, await addPlace(parseBody(event)));
    if (method === "PATCH" && id) return json(200, await editPlace(id, parseBody(event)));
    if (method === "DELETE" && id) {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id: PLACE_PREFIX + id } }));
      return json(200, { ok: true });
    }
    if (method === "PUT" && path === "/trip") return json(200, await setTrip(parseBody(event)));
    if (method === "POST" && path === "/ai") return json(200, await askClaude(parseBody(event)));
    return json(404, { error: "없는 주소예요." });
  } catch (e) {
    if (e.status) return json(e.status, { error: e.message });
    if (e.name === "ThrottlingException") return json(429, { error: "요청이 많아요. 잠시 후 다시 시도해 주세요." });
    console.error(e);
    return json(500, { error: "서버 오류가 났어요." });
  }
};
