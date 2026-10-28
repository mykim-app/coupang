// Supabase Edge Function: coupang-price (v2 — 이메일 + 4자리 숫자)
// 대시보드 > Edge Functions > coupang-price > Code 에 통째로 붙여 넣고 Deploy
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const env = (k: string) => Deno.env.get(k) ?? "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

const CRON = env("CRON_SECRET");
const PEPPER = env("PIN_PEPPER");
const AK = env("COUPANG_ACCESS_KEY"), SK = env("COUPANG_SECRET_KEY");
const GMAIL_USER = env("GMAIL_USER"), GMAIL_PASS = env("GMAIL_APP_PASSWORD");
const RESEND = env("RESEND_API_KEY"), MAIL_FROM = env("MAIL_FROM");
const SITE_URL = env("SITE_URL");
const HOURLY_LIMIT = Number(env("HOURLY_LIMIT") || 20);   // 쿠팡 호출 시간당 상한
const BATCH = Number(env("BATCH_PER_RUN") || 15);         // 매시 조회 상품 수
const STALE_HOURS = Number(env("STALE_HOURS") || 3);      // 이 시간 지난 상품만 재조회
const MAX_PER_USER = Number(env("MAX_PER_USER") || 10);   // 1인당 등록 상한

const DISCLOSURE = "이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const won = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("ko-KR") + "원");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const hasApi = () => !!(AK && SK);

async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- 쿠팡 파트너스 검색 API ----------
function signedDate() {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
async function callsLastHour() {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from("cp_api_log").select("id", { count: "exact", head: true }).gte("called_at", since);
  return count ?? 0;
}
async function coupangSearch(keyword: string) {
  if (!hasApi()) throw new Error("NO_API");
  if ((await callsLastHour()) >= HOURLY_LIMIT) throw new Error("LIMIT");
  await sb.from("cp_api_log").insert({});
  const path = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search";
  const query = `keyword=${encodeURIComponent(keyword)}&limit=10`;
  const dt = signedDate();
  const sig = await hmacHex(SK, dt + "GET" + path + query);
  const r = await fetch(`https://api-gateway.coupang.com${path}?${query}`, {
    headers: { Authorization: `CEA algorithm=HmacSHA256, access-key=${AK}, signed-date=${dt}, signature=${sig}`, "Content-Type": "application/json;charset=UTF-8" },
  });
  const j = await r.json().catch(() => ({}));
  if (String(j.rCode) !== "0") throw new Error(`쿠팡 API 오류: ${j.rMessage || j.message || r.status}`);
  return (j.data?.productData ?? []).map((p: any) => ({
    api_id: String(p.productId),                                            // API 내부 상품 ID
    page_key: (String(p.productUrl || "").match(/[?&]pageKey=(\d+)/) || [])[1] ?? "", // 쿠팡 주소(/vp/products/번호)의 번호
    name: p.productName, price: Number(p.productPrice), image: p.productImage, url: p.productUrl,
  }));
}
// 상품번호로 찾기: 검색어 결과(상위 10개) 중 주소 번호(pageKey) 또는 API ID가 같은 상품
// ※ 공식 문서 예시에서 productId(27664441)와 주소 번호(pageKey=319834306)가 서로 다름
async function lookup(productId: string, keyword: string) {
  const items = await coupangSearch(keyword);
  return items.find((x: any) => x.page_key === productId) ?? items.find((x: any) => x.api_id === productId) ?? null;
}

// ---------- 메일 (Gmail 우선, 없으면 Resend) ----------
let transporter: any = null;
async function sendMail(to: string[], subject: string, html: string) {
  if (!to.length) return;
  if (GMAIL_USER && GMAIL_PASS) {
    transporter ??= nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
    await transporter.sendMail({ from: `쿠팡 가격 알림 <${GMAIL_USER}>`, bcc: to, subject, html });
    return;
  }
  if (RESEND && MAIL_FROM) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [MAIL_FROM.match(/<(.+)>/)?.[1] ?? MAIL_FROM], bcc: to, subject, html }),
    });
    if (!r.ok) throw new Error(`메일 발송 실패: ${await r.text()}`);
    return;
  }
  throw new Error("메일 설정(GMAIL_USER·GMAIL_APP_PASSWORD)이 없습니다.");
}
const linkOf = (p: any) => p.partner_url || p.url || "";
function mailBody(p: any, lines: string[]) {
  const href = linkOf(p);
  return `<div style="font-family:sans-serif;line-height:1.6;max-width:520px">
    <p style="margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid #e3342f;font-size:13px">* ${DISCLOSURE}</p>
    ${p.image ? `<img src="${esc(p.image)}" width="96" style="float:right;margin-left:12px">` : ""}
    <h3 style="margin:0 0 6px">${esc(p.name)}</h3>
    ${lines.map((l) => `<p style="margin:4px 0">${l}</p>`).join("")}
    <p style="margin:10px 0 0;color:#555;font-size:13px">역대 최저 ${won(p.min_price)} · 역대 최고 ${won(p.max_price)} · 상품번호 ${esc(p.product_id)}</p>
    <p>${href ? `<a href="${esc(href)}">쿠팡에서 보기</a>` : ""}${SITE_URL ? ` · <a href="${esc(SITE_URL)}">가격 그래프 보기</a>` : ""}</p>
    <p style="clear:both"></p></div>`;
}

// ---------- 가격 반영 ----------
async function applyPrice(p: any, hit: any) {
  const changed = p.last_price == null || p.last_price !== hit.price;
  if (changed) await sb.from("cp_prices").insert({ product_id: p.product_id, price: hit.price });
  const upd = {
    name: hit.name || p.name, url: hit.url || p.url, image: hit.image || p.image,
    last_price: hit.price,
    min_price: p.min_price == null ? hit.price : Math.min(p.min_price, hit.price),
    max_price: p.max_price == null ? hit.price : Math.max(p.max_price, hit.price),
    last_checked: new Date().toISOString(), last_status: "정상",
  };
  await sb.from("cp_products").update(upd).eq("product_id", p.product_id);
  return { changed, prev: p.last_price as number | null, product: { ...p, ...upd } };
}
async function markStatus(id: string, status: string) {
  await sb.from("cp_products").update({ last_checked: new Date().toISOString(), last_status: status }).eq("product_id", id);
}
async function subscribers(id: string) {
  const { data } = await sb.from("cp_subs").select("email").eq("product_id", id);
  return (data ?? []).map((x: any) => x.email);
}

// ---------- 매시 자동 조회 ----------
async function cronRun() {
  if (!hasApi()) return { skipped: "쿠팡 API 키 미등록" };
  const stale = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString();
  const { data: list } = await sb.from("cp_products").select("*")
    .or(`last_checked.is.null,last_checked.lt.${stale}`).order("last_checked", { ascending: true, nullsFirst: true }).limit(BATCH);
  const out: any[] = [];
  for (const p of list ?? []) {
    try {
      const hit = await lookup(p.product_id, p.keyword);
      if (!hit) { await markStatus(p.product_id, "검색 결과에 없음 — 검색어 확인 필요"); out.push([p.product_id, "미검출"]); }
      else {
        const r = await applyPrice(p, hit);
        if (r.changed && r.prev != null) {
          const diff = hit.price - r.prev, up = diff > 0;
          const low = hit.price <= (p.min_price ?? Infinity);
          await sendMail(await subscribers(p.product_id),
            `[쿠팡 가격${up ? "↑" : "↓"}] ${r.product.name.slice(0, 40)} ${won(hit.price)}${low ? " (역대 최저)" : ""}`,
            mailBody(r.product, [
              `<b style="font-size:20px">${won(hit.price)}</b> <span style="color:${up ? "#c0392b" : "#1a7f37"}">${up ? "▲" : "▼"} ${won(Math.abs(diff))}</span>`,
              `직전 가격 ${won(r.prev)}${low ? " · <b>역대 최저가</b>" : ""}`,
            ])).catch((e) => markStatus(p.product_id, "메일 실패: " + e.message));
        }
        out.push([p.product_id, r.changed ? "변동" : "동일"]);
      }
    } catch (e) {
      const m = (e as Error).message;
      if (m === "LIMIT") { out.push(["-", "시간당 상한 도달, 다음 시간에 계속"]); break; }
      await markStatus(p.product_id, "오류: " + m); out.push([p.product_id, m]);
    }
    await sleep(2500);
  }
  return { checked: out };
}

// ---------- 로그인 ----------
async function login(emailRaw: string, pin: string) {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "이메일 형식이 올바르지 않습니다." }, 400);
  if (!/^\d{4}$/.test(String(pin))) return json({ error: "숫자 4자리를 입력하십시오." }, 400);
  const hash = await sha256(`${PEPPER}|${email}|${pin}`);
  const { data: u } = await sb.from("cp_users").select("*").eq("email", email).maybeSingle();
  let isNew = false;
  if (!u) {
    await sb.from("cp_users").insert({ email, pin_hash: hash });
    isNew = true;
  } else {
    if (u.locked_until && new Date(u.locked_until) > new Date())
      return json({ error: "입력 오류가 많아 10분간 잠겼습니다. 잠시 후 다시 시도하십시오." }, 429);
    if (u.pin_hash !== hash) {
      const fc = (u.fail_count ?? 0) + 1;
      await sb.from("cp_users").update(fc >= 5 ? { fail_count: 0, locked_until: new Date(Date.now() + 600_000).toISOString() } : { fail_count: fc }).eq("email", email);
      return json({ error: `숫자 4자리가 맞지 않습니다. (${fc >= 5 ? "10분간 잠금" : `${fc}/5회`})` }, 401);
    }
    await sb.from("cp_users").update({ fail_count: 0, locked_until: null }).eq("email", email);
  }
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await sb.from("cp_sessions").insert({ token, email, expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() });
  return json({ token, email, isNew });
}
async function sessionEmail(token: string) {
  if (!token) return null;
  const { data } = await sb.from("cp_sessions").select("email,expires_at").eq("token", token).maybeSingle();
  if (!data || new Date(data.expires_at) < new Date()) return null;
  return data.email as string;
}

// ---------- 상품번호 해석 ----------
// 받는 형식: 숫자만 / PC 주소(…/vp/products/번호?itemId=…&vendorItemId=…) / 앱 공유 짧은 주소(link.coupang.com/a/…, coupa.ng/…)
async function parseProduct(raw: string): Promise<{ id: string; url: string } | { error: string }> {
  let s = String(raw || "").trim();
  if (/^\d{5,}$/.test(s)) return { id: s, url: `https://www.coupang.com/vp/products/${s}` };
  // 상품 페이지의 "쿠팡상품번호: 9145532845 - 26924074730" 형식 (상품번호 - 옵션번호[ - 판매자옵션번호])
  const m = s.replace(/^.*?(?=\d)/, "").match(/^(\d{5,})\s*[-–—~]\s*(\d{5,})(?:\s*[-–—~]\s*(\d{5,}))?\s*$/);
  if (m) return { id: m[1], url: `https://www.coupang.com/vp/products/${m[1]}?itemId=${m[2]}${m[3] ? `&vendorItemId=${m[3]}` : ""}` };
  if (/^(https?:\/\/)?(link\.coupang\.com|coupa\.ng)\//i.test(s)) {           // 짧은 주소 → 실제 주소 따라가기
    let u = s.startsWith("http") ? s : "https://" + s;
    for (let i = 0; i < 4 && !/\/vp\/products\/\d+|[?&]pageKey=\d+/.test(u); i++) {
      const r = await fetch(u, { redirect: "manual" }).catch(() => null);
      const loc = r?.headers.get("location");
      if (!loc) break;
      u = new URL(loc, u).toString();
    }
    s = u;
  }
  const id = s.match(/\/vp\/products\/(\d+)/)?.[1] ?? s.match(/[?&]pageKey=(\d+)/)?.[1];
  if (!id) return { error: "상품번호를 찾지 못했습니다. PC 쿠팡 상품 페이지 주소(…/vp/products/숫자…)를 그대로 붙여 넣거나, 주소 속 products/ 뒤의 숫자만 입력하십시오." };
  const q = new URLSearchParams(s.split("?")[1] || "");
  const keep = ["itemId", "vendorItemId"].filter((k) => /^\d+$/.test(q.get(k) || "")).map((k) => `${k}=${q.get(k)}`).join("&");
  return { id, url: `https://www.coupang.com/vp/products/${id}${keep ? "?" + keep : ""}` };
}

// ---------- 파트너스 링크 해석 ----------
// 받는 형식: https://link.coupang.com/a/xxxx (단축 URL) / 파트너스 "이미지+텍스트" HTML 코드(<a href=…><img src=…>)
function parsePartner(raw: string): { url: string; image?: string } | null | { error: string } {
  const s = String(raw || "").trim();
  if (!s) return null;
  const href = s.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? s.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? s;
  let u: URL;
  try { u = new URL(href.startsWith("http") ? href : "https://" + href); } catch { return { error: "파트너스 링크 형식이 올바르지 않습니다." }; }
  if (!/^(link\.coupang\.com|coupa\.ng)$/i.test(u.hostname))
    return { error: "파트너스 링크는 쿠팡 파트너스 [링크 생성]에서 만든 link.coupang.com 주소여야 합니다." };
  const img = s.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i)?.[1];
  return { url: u.toString(), image: img && /^https:\/\//.test(img) ? img : undefined };
}

// ---------- 상품 등록 ----------
async function addProduct(email: string, rawId: string, keywordRaw: string, partnerRaw: string) {
  // 상품번호 칸에 파트너스 링크를 넣은 경우도 파트너스 링크로 사용
  if (!partnerRaw && /(link\.coupang\.com\/a\/|coupa\.ng\/)/i.test(String(rawId))) partnerRaw = rawId;
  const partner = parsePartner(partnerRaw);
  if (partner && "error" in partner) return json({ error: partner.error }, 400);
  const parsed = await parseProduct(rawId);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const productId = parsed.id;
  const keyword = String(keywordRaw || "").trim();
  if (!keyword) return json({ error: "검색어(상품명)를 입력하십시오. 쿠팡 API는 상품번호만으로 조회할 수 없습니다." }, 400);
  const { count } = await sb.from("cp_subs").select("product_id", { count: "exact", head: true }).eq("email", email);
  if ((count ?? 0) >= MAX_PER_USER) return json({ error: `1인당 ${MAX_PER_USER}개까지 등록할 수 있습니다.` }, 400);

  let { data: p } = await sb.from("cp_products").select("*").eq("product_id", productId).maybeSingle();
  let note = "";
  if (!p) {
    let hit: any = null;
    if (hasApi()) {
      try { hit = await lookup(productId, keyword); }
      catch (e) { note = (e as Error).message === "LIMIT" ? "조회 한도로 다음 자동 조회 때 확인합니다." : (e as Error).message; }
      if (!hit && !note) return json({ error: "검색어로 찾은 상위 10개 상품 중에 이 상품번호가 없습니다. 검색어를 더 구체적으로(브랜드·용량 포함) 바꿔 보십시오." }, 404);
    } else note = "쿠팡 API 키 등록 전이라 가격은 키 등록 후 자동 조회됩니다.";
    await sb.from("cp_products").insert({ product_id: productId, name: hit?.name || keyword, keyword, url: parsed.url,
      partner_url: partner?.url ?? null, image: partner?.image ?? null, last_status: hit ? "정상" : "조회 대기" });
    ({ data: p } = await sb.from("cp_products").select("*").eq("product_id", productId).single());
    if (hit) ({ product: p } = await applyPrice(p, hit));
  } else if (partner && !p.partner_url) {
    await sb.from("cp_products").update({ partner_url: partner.url, image: p.image || partner.image || null }).eq("product_id", productId);
    p = { ...p, partner_url: partner.url, image: p.image || partner.image || null };
  }
  const { error } = await sb.from("cp_subs").upsert({ email, product_id: productId });
  if (error) throw error;

  // 최초 등록 메일
  let mailNote = "";
  try {
    await sendMail([email], `[쿠팡 가격 알림] 등록 완료 — ${p.name.slice(0, 40)}`,
      mailBody(p, [p.last_price != null ? `현재 가격 <b style="font-size:20px">${won(p.last_price)}</b>` : `현재 가격: ${esc(note || "조회 대기")}`,
        "앞으로 가격이 바뀌면 이 주소로 알려 드립니다."]));
  } catch (e) { mailNote = " (등록 메일 발송 실패: " + (e as Error).message + ")"; }
  return json({ ok: true, note: note + mailNote });
}

// ---------- 진입점 ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "cron") {
      if (!CRON || b.token !== CRON) return json({ error: "unauthorized" }, 401);
      return json(await cronRun());
    }
    if (b.action === "login") return await login(b.email, b.pin);
    if (b.action === "public") {
      const { data } = await sb.from("cp_products").select("product_id,name,image,url,partner_url,last_price,min_price")
        .order("created_at", { ascending: false }).limit(30);
      const items = (data ?? []).filter((p: any) => /link\.coupang\.com|coupa\.ng/.test(linkOf(p))).slice(0, 6)
        .map((p: any) => ({ product_id: p.product_id, name: p.name, image: p.image, link: linkOf(p), last_price: p.last_price, min_price: p.min_price }));
      return json({ disclosure: DISCLOSURE, items });
    }

    const email = await sessionEmail(b.token);
    if (!email) return json({ error: "다시 로그인하십시오.", relogin: true }, 401);

    switch (b.action) {
      case "list": {
        const { data: subs } = await sb.from("cp_subs").select("product_id,created_at").eq("email", email).order("created_at");
        const ids = (subs ?? []).map((s: any) => s.product_id);
        const { data: prods } = ids.length ? await sb.from("cp_products").select("*").in("product_id", ids) : { data: [] };
        const { data: hist } = ids.length ? await sb.from("cp_prices").select("product_id,price,checked_at").in("product_id", ids).order("checked_at") : { data: [] };
        const items = ids.map((id: string) => ({ ...(prods ?? []).find((p: any) => p.product_id === id), history: (hist ?? []).filter((h: any) => h.product_id === id).map((h: any) => ({ price: h.price, t: h.checked_at })) })).filter((x: any) => x.product_id);
        return json({ email, hasApi: hasApi(), maxPerUser: MAX_PER_USER, disclosure: DISCLOSURE, items });
      }
      case "add":
        return await addProduct(email, b.product_id, b.keyword, b.partner);
      case "update_partner": {
        await sb.from("cp_subs").select("product_id").eq("email", email).eq("product_id", b.product_id).single().then(({ error }) => { if (error) throw new Error("등록되지 않은 상품입니다."); });
        const pt = parsePartner(b.partner);
        if (!pt) return json({ error: "파트너스 링크를 입력하십시오." }, 400);
        if ("error" in pt) return json({ error: pt.error }, 400);
        const upd: any = { partner_url: pt.url };
        if (pt.image) upd.image = pt.image;
        await sb.from("cp_products").update(upd).eq("product_id", b.product_id);
        return json({ ok: true });
      }
      case "update_keyword": {
        await sb.from("cp_subs").select("product_id").eq("email", email).eq("product_id", b.product_id).single().then(({ error }) => { if (error) throw new Error("등록되지 않은 상품입니다."); });
        await sb.from("cp_products").update({ keyword: String(b.keyword || "").trim(), last_checked: null, last_status: "검색어 변경 — 다음 자동 조회 대기" }).eq("product_id", b.product_id);
        return json({ ok: true });
      }
      case "remove": {
        await sb.from("cp_subs").delete().eq("email", email).eq("product_id", b.product_id);
        const { count } = await sb.from("cp_subs").select("email", { count: "exact", head: true }).eq("product_id", b.product_id);
        if (!count) await sb.from("cp_products").delete().eq("product_id", b.product_id);
        return json({ ok: true });
      }
      case "logout":
        await sb.from("cp_sessions").delete().eq("token", b.token);
        return json({ ok: true });
      default:
        return json({ error: "알 수 없는 요청입니다." }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
