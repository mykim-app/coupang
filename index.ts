// Supabase Edge Function: coupang-price
// 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 통째로 붙여 넣기
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const env = (k: string) => Deno.env.get(k) ?? "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const ADMIN = env("ADMIN_PASSWORD");
const CRON = env("CRON_SECRET");
const AK = env("COUPANG_ACCESS_KEY");
const SK = env("COUPANG_SECRET_KEY");
const RESEND = env("RESEND_API_KEY");
const MAIL_FROM = env("MAIL_FROM") || "쿠팡가격알림 <onboarding@resend.dev>";
const DEFAULT_TO = env("ALERT_EMAIL");
const HOURLY_LIMIT = Number(env("HOURLY_LIMIT") || 20); // 쿠팡 호출 시간당 상한(안전값)

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const won = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("ko-KR") + "원");

// ---------- 쿠팡 파트너스 API ----------
async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function signedDate() {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
async function callsLastHour() {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from("cp_api_log").select("id", { count: "exact", head: true }).gte("called_at", since);
  return count ?? 0;
}
async function coupangSearch(keyword: string, limit = 10) {
  if (!AK || !SK) throw new Error("쿠팡 API 키가 아직 등록되지 않았습니다.");
  if ((await callsLastHour()) >= HOURLY_LIMIT)
    throw new Error(`쿠팡 API 시간당 호출 상한(${HOURLY_LIMIT}회)에 도달했습니다. 잠시 후 다시 시도하십시오.`);
  await sb.from("cp_api_log").insert({});
  const path = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search";
  const query = `keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
  const dt = signedDate();
  const sig = await hmacHex(SK, dt + "GET" + path + query);
  const r = await fetch(`https://api-gateway.coupang.com${path}?${query}`, {
    headers: {
      Authorization: `CEA algorithm=HmacSHA256, access-key=${AK}, signed-date=${dt}, signature=${sig}`,
      "Content-Type": "application/json;charset=UTF-8",
    },
  });
  const j = await r.json().catch(() => ({}));
  if (String(j.rCode) !== "0") throw new Error(`쿠팡 API 오류: ${j.rMessage || j.message || r.status}`);
  return (j.data?.productData ?? []).map((p: any) => ({
    product_id: String(p.productId),
    name: p.productName,
    price: Number(p.productPrice),
    image: p.productImage,
    url: p.productUrl,
    rocket: !!p.isRocket,
  }));
}

// ---------- 메일 ----------
async function sendMail(to: string, subject: string, html: string) {
  if (!RESEND) throw new Error("RESEND_API_KEY가 등록되지 않았습니다.");
  if (!to) throw new Error("받는 메일 주소가 없습니다(ALERT_EMAIL 또는 상품별 메일).");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
  });
  if (!r.ok) throw new Error(`메일 발송 실패: ${await r.text()}`);
}

// ---------- 가격 기록 + 알림 판단 ----------
async function recordPrice(p: any, price: number, source: "api" | "manual") {
  const prevMin = p.min_price as number | null;
  const prevLast = p.last_price as number | null;
  await sb.from("cp_prices").insert({ product_id: p.product_id, price, source });

  const reasons: string[] = [];
  if (prevMin != null && price < prevMin) reasons.push(`역대 최저가 갱신 (이전 최저 ${won(prevMin)})`);
  if (p.target_price && price <= p.target_price && (prevLast == null || prevLast > p.target_price))
    reasons.push(`목표가 ${won(p.target_price)} 이하 도달`);

  const newMin = prevMin == null ? price : Math.min(prevMin, price);
  let status = "정상";
  if (reasons.length) {
    try {
      await sendMail(p.email || DEFAULT_TO, `[쿠팡 최저가] ${p.name} ${won(price)}`,
        `<div style="font-family:sans-serif;line-height:1.6">
          <h2 style="margin:0 0 8px">${p.name}</h2>
          <p style="font-size:22px;margin:0"><b>${won(price)}</b></p>
          <ul>${reasons.map((x) => `<li>${x}</li>`).join("")}</ul>
          <p>직전 가격: ${won(prevLast)}</p>
          ${p.url ? `<p><a href="${p.url}">쿠팡에서 보기</a></p>` : ""}
          <p style="color:#888;font-size:12px">이 링크는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받을 수 있습니다.</p>
        </div>`);
      status = "알림 발송";
    } catch (e) {
      status = "알림 실패: " + (e as Error).message;
    }
  }
  await sb.from("cp_products").update({
    last_price: price, min_price: newMin, last_checked: new Date().toISOString(), last_status: status,
  }).eq("product_id", p.product_id);
  return { price, reasons, status };
}

async function checkAll() {
  const { data: list } = await sb.from("cp_products").select("*").eq("active", true).order("created_at");
  const results: any[] = [];
  if (!AK || !SK) return { skipped: true, message: "쿠팡 API 키 미등록 — 자동 조회를 건너뜁니다.", results };
  for (const p of list ?? []) {
    try {
      const items = await coupangSearch(p.keyword);
      const hit = items.find((x: any) => x.product_id === p.product_id);
      if (!hit) {
        await sb.from("cp_products").update({ last_checked: new Date().toISOString(),
          last_status: "검색 결과(상위 10개)에 없음 — 검색어 조정 필요" }).eq("product_id", p.product_id);
        results.push({ product_id: p.product_id, status: "미검출" });
      } else {
        if (hit.url || hit.image) await sb.from("cp_products").update({ url: hit.url || p.url, image: hit.image || p.image }).eq("product_id", p.product_id);
        results.push({ product_id: p.product_id, ...(await recordPrice(p, hit.price, "api")) });
      }
    } catch (e) {
      const msg = (e as Error).message;
      results.push({ product_id: p.product_id, status: "오류: " + msg });
      if (msg.includes("상한")) break;
    }
    await sleep(2500);
  }
  return { skipped: false, results };
}

// ---------- 진입점 ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const a = b.action as string;
    if (!ADMIN) return json({ error: "ADMIN_PASSWORD가 설정되지 않았습니다." }, 500);
    const okAdmin = b.token === ADMIN;
    const okCron = a === "check" && CRON && b.token === CRON;
    if (!okAdmin && !okCron) return json({ error: "비밀번호가 올바르지 않습니다." }, 401);

    switch (a) {
      case "ping":
        return json({ ok: true, hasApiKey: !!(AK && SK), hasMail: !!RESEND, defaultEmail: DEFAULT_TO ? DEFAULT_TO.replace(/(.{2}).+(@.+)/, "$1***$2") : "" });
      case "list": {
        const { data, error } = await sb.from("cp_products").select("*").order("created_at");
        if (error) throw error;
        return json({ items: data });
      }
      case "history": {
        const { data, error } = await sb.from("cp_prices").select("price,source,checked_at")
          .eq("product_id", b.product_id).order("checked_at");
        if (error) throw error;
        return json({ items: data });
      }
      case "search":
        return json({ items: await coupangSearch(String(b.keyword || "").trim()) });
      case "add": {
        const p = b.product ?? {};
        if (!p.product_id || !p.name) return json({ error: "상품번호와 상품명은 필수입니다." }, 400);
        const row = {
          product_id: String(p.product_id), name: p.name, keyword: p.keyword || p.name,
          url: p.url || null, image: p.image || null,
          target_price: p.target_price ? Number(p.target_price) : null, email: p.email || null,
        };
        const { error } = await sb.from("cp_products").upsert(row);
        if (error) throw error;
        if (p.price) {
          const { data: cur } = await sb.from("cp_products").select("*").eq("product_id", row.product_id).single();
          await recordPrice(cur, Number(p.price), p.source === "api" ? "api" : "manual");
        }
        return json({ ok: true });
      }
      case "update": {
        const f: any = {};
        for (const k of ["name", "keyword", "email", "active"]) if (k in b) f[k] = b[k] === "" ? null : b[k];
        if ("target_price" in b) f.target_price = b.target_price ? Number(b.target_price) : null;
        const { error } = await sb.from("cp_products").update(f).eq("product_id", b.product_id);
        if (error) throw error;
        return json({ ok: true });
      }
      case "delete": {
        const { error } = await sb.from("cp_products").delete().eq("product_id", b.product_id);
        if (error) throw error;
        return json({ ok: true });
      }
      case "manual": {
        const { data: p, error } = await sb.from("cp_products").select("*").eq("product_id", b.product_id).single();
        if (error) throw error;
        return json(await recordPrice(p, Number(b.price), "manual"));
      }
      case "check":
        return json(await checkAll());
      case "testmail":
        await sendMail(b.email || DEFAULT_TO, "[쿠팡 가격 알림] 테스트 메일", "<p>메일 설정이 정상입니다.</p>");
        return json({ ok: true });
      default:
        return json({ error: "알 수 없는 요청입니다." }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
