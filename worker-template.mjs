const HTML = __HTML_JSON__;

/* 29Court Convert capture loop v1.
 * Free tool stays 100% free and ungated. Capture fires at the value moment.
 * Auth: email-identified accounts + 30-day HttpOnly session. No passwords, ever.
 * Email sending: NOT CONFIGURED (no RESEND_API_KEY). Magic-link email endpoint
 * exists but answers 501 honestly; sessions + pairing codes are the real path.
 * Never fake a "check your inbox".
 */

const SESSION_DAYS = 30;
const PAIR_MINUTES = 5;
const MAGIC_MINUTES = 15;
const EVENT_KINDS = ["value_moment","capture_shown","capture_done","capture_dismissed","cheat_downloaded","signup_view"];

function json(data, status, headers){
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({"Content-Type":"application/json","Cache-Control":"no-store"}, headers || {})
  });
}
function bad(msg, status){ return json({ ok:false, error:msg }, status || 400); }
function getCookie(req, name){
  const h = req.headers.get("Cookie") || "";
  const m = new RegExp("(?:^|;\\s*)" + name + "=([^;]*)").exec(h);
  return m ? decodeURIComponent(m[1]) : null;
}
async function sha256hex(s){
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(function(x){ return x.toString(16).padStart(2,"0"); }).join("");
}
function randToken(n){
  const b = new Uint8Array(n || 32);
  crypto.getRandomValues(b);
  return Array.from(b).map(function(x){ return x.toString(16).padStart(2,"0"); }).join("");
}
function nowSec(){ return Math.floor(Date.now()/1000); }
function validEmail(e){
  return typeof e === "string" && e.trim().length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}
function clientIp(req){ return req.headers.get("CF-Connecting-IP") || "unknown"; }
function sessionCookie(tok){
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toUTCString();
  return "cv_sid=" + encodeURIComponent(tok) + "; Path=/; Expires=" + exp + "; HttpOnly; Secure; SameSite=Lax";
}
function clearSessionCookie(){
  return "cv_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax";
}
async function getSession(env, req){
  const tok = getCookie(req, "cv_sid");
  if (!tok) return null;
  const h = await sha256hex(tok);
  const row = await env.DB.prepare(
    "SELECT s.token_hash, s.account_id, a.email, a.email_verified FROM sessions s " +
    "JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(h, nowSec()).first();
  return row || null;
}
async function logEvent(env, kind, meta){
  if (EVENT_KINDS.indexOf(kind) < 0) return;
  await env.DB.prepare("INSERT INTO events (kind, ts, meta) VALUES (?, ?, ?)")
    .bind(kind, nowSec(), meta ? JSON.stringify(meta).slice(0, 2000) : null).run();
}
async function rateOk(env, bucket, key, limit, windowSec){
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM events WHERE kind = ? AND ts > ? AND meta LIKE ?"
  ).bind(bucket, nowSec() - windowSec, "%" + key + "%").first();
  return (r && r.c || 0) < limit;
}
async function conversionCount(env, accountId){
  const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM conversions WHERE account_id = ?")
    .bind(accountId).first();
  return (r && r.c) || 0;
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const p = url.pathname;
    const method = request.method.toUpperCase();

    if (p === "/api/health"){
      return json({ ok:true, service:"convert", capture:"v1", time:new Date().toISOString() });
    }

    /* ---------- instrumentation (no PII in events, ever) ---------- */
    if (p === "/api/event" && method === "POST"){
      let body = {};
      try { body = await request.json(); } catch(e){}
      if (EVENT_KINDS.indexOf(body.kind) < 0) return bad("unknown kind");
      await logEvent(env, body.kind, body.meta || null);
      return json({ ok:true });
    }

    /* ---------- aggregate stats: counts only, no emails ---------- */
    if (p === "/api/stats" && method === "GET"){
      const rows = await env.DB.prepare("SELECT kind, COUNT(*) AS c FROM events GROUP BY kind").all();
      const stats = {};
      (rows.results || []).forEach(function(r){ stats[r.kind] = r.c; });
      const accts = await env.DB.prepare("SELECT COUNT(*) AS c FROM accounts").first();
      stats.accounts = (accts && accts.c) || 0;
      return json({ ok:true, stats:stats });
    }

    /* ---------- capture: email -> account + session, guest history migrates ---------- */
    if (p === "/api/capture" && method === "POST"){
      let body = {};
      try { body = await request.json(); } catch(e){ return bad("bad json"); }
      const email = (body.email || "").trim().toLowerCase();
      if (!validEmail(email)) return bad("enter a valid email");
      const ip = clientIp(request);
      await logEvent(env, "signup_view", { ip:ip });
      if (!(await rateOk(env, "signup_view", ip, 20, 3600))) return bad("too many tries from this address, slow down", 429);
      if (!(await rateOk(env, "signup_view", email, 5, 3600))) return bad("too many tries for this email, slow down", 429);

      let acct = await env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first();
      if (!acct){
        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO accounts (id, email, created_at, email_verified, note) VALUES (?, ?, ?, 0, ?)"
        ).bind(id, email, nowSec(),
          "email not verified: no mail sender configured, magic-link emails pending RESEND_API_KEY").run();
        acct = { id:id, email:email, email_verified:0 };
      }

      /* migrate guest history (cap 50) */
      let migrated = 0;
      const hist = Array.isArray(body.history) ? body.history.slice(0, 50) : [];
      for (const h of hist){
        if (!h || !h.srcExt || !h.dstExt) continue;
        await env.DB.prepare(
          "INSERT INTO conversions (id, account_id, src_name, src_ext, dst_ext, dst_name, bytes, created_at, guest_migrated) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"
        ).bind(crypto.randomUUID(), acct.id,
          String(h.srcName || "").slice(0, 200), String(h.srcExt).slice(0, 12),
          String(h.dstExt).slice(0, 12), String(h.dstName || "").slice(0, 200),
          Math.max(0, parseInt(h.bytes, 10) || 0),
          Math.max(0, parseInt(h.ts, 10) || nowSec())).run();
        migrated++;
      }

      /* queue the receipt follow-up (sends when a mail sender exists; never faked) */
      await env.DB.prepare(
        "INSERT INTO pending_emails (id, account_id, kind, payload, created_at, sent_at) VALUES (?, ?, 'receipt', ?, ?, NULL)"
      ).bind(crypto.randomUUID(), acct.id,
        JSON.stringify({ email:email, migrated:migrated, at:nowSec() }), nowSec()).run();

      const tok = randToken(32);
      await env.DB.prepare(
        "INSERT INTO sessions (token_hash, account_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)"
      ).bind(await sha256hex(tok), acct.id, nowSec(), nowSec() + SESSION_DAYS * 86400,
        (request.headers.get("User-Agent") || "").slice(0, 200)).run();

      await logEvent(env, "capture_done", { migrated:migrated });
      return json({
        ok:true,
        email:acct.email,
        email_verified:!!acct.email_verified,
        conversions: await conversionCount(env, acct.id),
        label:"Signed in on this device. Your email is not verified yet: we cannot send sign-in emails until our mail sender is connected. Link other devices with a pairing code under Your stuff."
      }, 200, { "Set-Cookie": sessionCookie(tok) });
    }

    /* ---------- who am i ---------- */
    if (p === "/api/me" && method === "GET"){
      const s = await getSession(env, request);
      if (!s) return json({ signed_in:false });
      return json({ signed_in:true, email:s.email, email_verified:!!s.email_verified,
        conversions: await conversionCount(env, s.account_id) });
    }

    /* ---------- conversion history ---------- */
    if (p === "/api/history" && method === "GET"){
      const s = await getSession(env, request);
      if (!s) return bad("not signed in", 401);
      const rows = await env.DB.prepare(
        "SELECT src_name, src_ext, dst_ext, dst_name, bytes, created_at, guest_migrated " +
        "FROM conversions WHERE account_id = ? ORDER BY created_at DESC LIMIT 100"
      ).bind(s.account_id).all();
      return json({ ok:true, conversions: rows.results || [] });
    }
    if (p === "/api/history" && method === "POST"){
      const s = await getSession(env, request);
      if (!s) return bad("not signed in", 401);
      let body = {};
      try { body = await request.json(); } catch(e){ return bad("bad json"); }
      if (!body.srcExt || !body.dstExt) return bad("missing fields");
      await env.DB.prepare(
        "INSERT INTO conversions (id, account_id, src_name, src_ext, dst_ext, dst_name, bytes, created_at, guest_migrated) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)"
      ).bind(crypto.randomUUID(), s.account_id,
        String(body.srcName || "").slice(0, 200), String(body.srcExt).slice(0, 12),
        String(body.dstExt).slice(0, 12), String(body.dstName || "").slice(0, 200),
        Math.max(0, parseInt(body.bytes, 10) || 0), nowSec()).run();
      return json({ ok:true });
    }

    /* ---------- device pairing (real cross-device without email) ---------- */
    if (p === "/api/pair/new" && method === "POST"){
      const s = await getSession(env, request);
      if (!s) return bad("not signed in", 401);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.DB.prepare(
        "INSERT INTO pairing_codes (code_hash, account_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)"
      ).bind(await sha256hex(code), s.account_id, nowSec(), nowSec() + PAIR_MINUTES * 60).run();
      return json({ ok:true, code:code, expires_in: PAIR_MINUTES * 60 });
    }
    if (p === "/api/pair/claim" && method === "POST"){
      let body = {};
      try { body = await request.json(); } catch(e){ return bad("bad json"); }
      const email = (body.email || "").trim().toLowerCase();
      const code = String(body.code || "").replace(/\D/g, "");
      if (!validEmail(email) || code.length !== 6) return bad("enter your email and the 6-digit code");
      const acct = await env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first();
      if (!acct) return bad("no account for that email yet", 404);
      const pc = await env.DB.prepare(
        "SELECT * FROM pairing_codes WHERE code_hash = ? AND account_id = ? AND used = 0 AND expires_at > ?"
      ).bind(await sha256hex(code), acct.id, nowSec()).first();
      if (!pc) return bad("code is wrong or expired", 400);
      await env.DB.prepare("UPDATE pairing_codes SET used = 1 WHERE code_hash = ?").bind(pc.code_hash).run();
      const tok = randToken(32);
      await env.DB.prepare(
        "INSERT INTO sessions (token_hash, account_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)"
      ).bind(await sha256hex(tok), acct.id, nowSec(), nowSec() + SESSION_DAYS * 86400,
        (request.headers.get("User-Agent") || "").slice(0, 200)).run();
      return json({ ok:true, email:acct.email }, 200, { "Set-Cookie": sessionCookie(tok) });
    }

    /* ---------- sign out ---------- */
    if (p === "/api/signout" && method === "POST"){
      const tok = getCookie(request, "cv_sid");
      if (tok) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256hex(tok)).run();
      return json({ ok:true }, 200, { "Set-Cookie": clearSessionCookie() });
    }

    /* ---------- magic link: dormant until RESEND_API_KEY exists. Honest 501, never faked. ---------- */
    if (p === "/api/magic-link" && method === "POST"){
      if (!env.RESEND_API_KEY){
        return json({ ok:false, reason:"email-sender-not-configured",
          message:"Sign-in emails are not wired yet. You are signed in on this device; link others with a pairing code." }, 501);
      }
      let body = {};
      try { body = await request.json(); } catch(e){ return bad("bad json"); }
      const email = (body.email || "").trim().toLowerCase();
      if (!validEmail(email)) return bad("enter a valid email");
      const acct = await env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first();
      if (!acct) return bad("no account for that email yet", 404);
      const tok = randToken(32);
      await env.DB.prepare(
        "INSERT INTO magic_tokens (token_hash, account_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)"
      ).bind(await sha256hex(tok), acct.id, nowSec(), nowSec() + MAGIC_MINUTES * 60).run();
      const link = "https://convert.29court.com/api/verify?token=" + tok;
      const res = await fetch("https://api.resend.com/emails", {
        method:"POST",
        headers:{ "Authorization":"Bearer " + env.RESEND_API_KEY, "Content-Type":"application/json" },
        body: JSON.stringify({ from:"29Court <hello@29court.com>", to:[email],
          subject:"Your 29Court sign-in link",
          text:"Sign in to 29Court Convert (and your stuff, everywhere):\n\n" + link + "\n\nThis link expires in 15 minutes. No password, ever." })
      });
      if (!res.ok) return bad("mail sender failed", 502);
      return json({ ok:true });
    }
    if (p === "/api/verify" && method === "GET"){
      const tok = url.searchParams.get("token") || "";
      const mt = await env.DB.prepare(
        "SELECT * FROM magic_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?"
      ).bind(await sha256hex(tok), nowSec()).first();
      if (!mt){
        return new Response("That link is wrong or expired.", { status:400,
          headers:{ "Content-Type":"text/plain; charset=utf-8" } });
      }
      await env.DB.prepare("UPDATE magic_tokens SET used = 1 WHERE token_hash = ?").bind(mt.token_hash).run();
      const st = randToken(32);
      await env.DB.prepare(
        "INSERT INTO sessions (token_hash, account_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)"
      ).bind(await sha256hex(st), mt.account_id, nowSec(), nowSec() + SESSION_DAYS * 86400,
        (request.headers.get("User-Agent") || "").slice(0, 200)).run();
      return new Response(null, { status:302,
        headers:{ "Location":"/?verified=1", "Set-Cookie": sessionCookie(st) } });
    }

    return new Response(HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Frame-Options": "SAMEORIGIN"
      }
    });
  }
};
