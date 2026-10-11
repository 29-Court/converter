/* 29Court Convert capture loop v1 (client).
 * Fires at the value moment (cv:converted). Free tool stays ungated.
 * Guest conversion history lives in localStorage and migrates on capture.
 * Email is NEVER marked verified in UI: no mail sender is configured yet.
 * Pairing codes are the real cross-device path. Nothing is faked.
 */
(function(){
"use strict";

var meCache = null;

function fire(kind, meta){
  try {
    fetch("/api/event", { method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ kind:kind, meta:meta || null }), keepalive:true });
  } catch(e){}
}
async function me(force){
  if (meCache && !force) return meCache;
  try {
    var r = await fetch("/api/me", { credentials:"same-origin" });
    meCache = await r.json();
  } catch(e){ meCache = { signed_in:false }; }
  return meCache;
}
function esc(s){
  return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmtDate(ts){ return new Date(ts * 1000).toLocaleDateString(); }

/* ---------- guest history ---------- */
var GUEST_KEY = "cv_guest_history";
function guestHistory(){
  try { return JSON.parse(localStorage.getItem(GUEST_KEY) || "[]"); } catch(e){ return []; }
}
function pushGuest(conv){
  var h = guestHistory();
  h.push(conv);
  while (h.length > 50) h.shift();
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(h)); } catch(e){}
}
function clearGuest(){
  try { localStorage.removeItem(GUEST_KEY); } catch(e){}
}

/* ---------- cheat sheet (real PDF, generated on the spot) ---------- */
function sanitizePdf(s){
  return String(s).replace(/→/g,"->").replace(/•/g,"-").replace(/×/g,"x").replace(/…/g,"...");
}
async function cheatSheet(){
  if (typeof PDFLib === "undefined"){ alert("PDF engine is still loading. Try again in a moment."); return; }
  try {
    var d = await PDFLib.PDFDocument.create();
    var F = { reg: await d.embedFont(PDFLib.StandardFonts.Helvetica),
              bold: await d.embedFont(PDFLib.StandardFonts.HelveticaBold) };
    var PW = 595.28, PH = 841.89, M = 44, maxW = PW - M * 2;
    var page = d.addPage([PW, PH]), y = PH - M;
    function need(h){ if (y - h < M){ page = d.addPage([PW, PH]); y = PH - M; } }
    function text(str, font, size, after){
      font = font || F.reg; size = size || 11;
      var words = sanitizePdf(str).split(/\s+/), line = "";
      function flush(ln){ need(size * 1.45); page.drawText(ln, { x:M, y:y - size, size:size, font:font }); y -= size * 1.45; }
      words.forEach(function(w){
        var t = line ? line + " " + w : w;
        if (font.widthOfTextAtSize(t, size) <= maxW) line = t;
        else { if (line) flush(line); line = w; }
      });
      if (line) flush(line);
      y -= (after == null ? 4 : after);
    }
    text("29Court Convert: everything to everything", F.bold, 20, 6);
    text("Every converter says what it keeps. Generated " + new Date().toLocaleDateString() + ".", F.reg, 10, 12);
    var cards = document.querySelectorAll("#matrixcards .card");
    Array.prototype.forEach.call(cards, function(c){
      var h = c.querySelector("h3"), p = c.querySelector("p");
      if (!h) return;
      text(h.innerText.replace(/\s+/g," ").trim(), F.bold, 12, 2);
      if (p) text(p.innerText.replace(/\s+/g," ").trim(), F.reg, 10, 8);
    });
    var bytes = await d.save();
    var blob = new Blob([bytes], { type:"application/pdf" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "29Court-everything-to-everything.pdf";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    fire("cheat_downloaded");
  } catch(e){ alert("Could not build the cheat sheet: " + (e && e.message ? e.message : e)); }
}

/* ---------- capture panel ---------- */
var panelShown = false;

var PANEL_HTML =
  '<div class="cv-cap-inner">' +
  '<h2>Done. Now keep it forever.</h2>' +
  '<p class="cv-sub">Your conversion is saved to your stuff the moment you sign in.</p>' +
  '<ul>' +
  '<li>Every conversion you do here, kept in one place</li>' +
  '<li>Your stuff on any device. No password, ever.</li>' +
  '<li>The everything-to-everything cheat sheet, free right now</li>' +
  '</ul>' +
  '<form id="cv-cap-form" novalidate>' +
  '<input type="email" id="cv-cap-email" placeholder="you@example.com" autocomplete="email" aria-label="Email address">' +
  '<button class="court-btn" type="submit">Keep my stuff</button>' +
  '</form>' +
  '<p class="cv-err" id="cv-cap-err" hidden></p>' +
  '<p class="cv-micro">Free forever. New converters hit your inbox first. Unsubscribe anytime.</p>' +
  '<button class="cv-code-toggle" id="cv-code-toggle" type="button">Have a pairing code from another device?</button>' +
  '<form id="cv-code-form" hidden novalidate>' +
  '<input type="email" id="cv-code-email" placeholder="you@example.com" autocomplete="email" aria-label="Email address">' +
  '<input type="text" id="cv-code-code" placeholder="6-digit code" inputmode="numeric" maxlength="6" aria-label="Pairing code">' +
  '<button class="court-btn" type="submit">Link this device</button>' +
  '</form>' +
  '<p class="cv-err" id="cv-code-err" hidden></p>' +
  '<button class="cv-dismiss" id="cv-cap-dismiss" type="button">No thanks, just the download</button>' +
  '</div>';

var SUCCESS_HTML =
  '<div class="cv-cap-inner">' +
  '<h2>You are in. This conversion is saved.</h2>' +
  '<p class="cv-sub">Your stuff is building. Here is the first bonus:</p>' +
  '<div class="cv-success-actions">' +
  '<button class="court-btn" id="cv-cheat-btn" type="button">Get the cheat sheet</button>' +
  '<button class="court-btn court-btn-ghost" id="cv-stuff-btn" type="button">See your stuff</button>' +
  '</div>' +
  '<p class="cv-micro">Signed in on this device. Your email is not verified yet: we cannot send sign-in emails until our mail sender is connected. Link other devices with a pairing code under Your stuff.</p>' +
  '</div>';

function showPanel(){
  if (panelShown) return;
  panelShown = true;
  var anchor = document.querySelector("#convert .actions");
  if (!anchor) return;
  var sec = document.createElement("section");
  sec.id = "cv-cap"; sec.className = "cv-cap"; sec.setAttribute("aria-label", "Keep your conversions");
  sec.innerHTML = PANEL_HTML;
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);
  fire("capture_shown");
  wirePanel(sec);
}

function panelError(id, msg){
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg; el.hidden = false;
}

function wirePanel(sec){
  var form = document.getElementById("cv-cap-form");
  form.addEventListener("submit", async function(e){
    e.preventDefault();
    var input = document.getElementById("cv-cap-email");
    var email = (input.value || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){
      panelError("cv-cap-err", "Enter a valid email and it is yours.");
      input.focus(); return;
    }
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Keeping it...";
    try {
      var r = await fetch("/api/capture", { method:"POST",
        headers:{ "Content-Type":"application/json" }, credentials:"same-origin",
        body: JSON.stringify({ email:email, history: guestHistory() }) });
      var d = await r.json();
      if (!d.ok){ throw new Error(d.error || "Something went wrong."); }
      clearGuest();
      meCache = null;
      sessionStorage.setItem("cv_cap", "done");
      sec.innerHTML = SUCCESS_HTML;
      document.getElementById("cv-cheat-btn").addEventListener("click", cheatSheet);
      document.getElementById("cv-stuff-btn").addEventListener("click", function(){ toggleDrawer(true); });
      renderStuffLink();
    } catch(err){
      panelError("cv-cap-err", err.message || "Something went wrong. Try again.");
      btn.disabled = false; btn.textContent = "Keep my stuff";
    }
  });

  document.getElementById("cv-cap-dismiss").addEventListener("click", function(){
    fire("capture_dismissed");
    sessionStorage.setItem("cv_cap", "dismissed");
    sec.remove();
  });

  var toggle = document.getElementById("cv-code-toggle");
  var codeForm = document.getElementById("cv-code-form");
  toggle.addEventListener("click", function(){
    codeForm.hidden = !codeForm.hidden;
    if (!codeForm.hidden) document.getElementById("cv-code-email").focus();
  });
  codeForm.addEventListener("submit", async function(e){
    e.preventDefault();
    var email = (document.getElementById("cv-code-email").value || "").trim();
    var code = (document.getElementById("cv-code-code").value || "").replace(/\D/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || code.length !== 6){
      panelError("cv-code-err", "Enter your email and the 6-digit code."); return;
    }
    try {
      var r = await fetch("/api/pair/claim", { method:"POST",
        headers:{ "Content-Type":"application/json" }, credentials:"same-origin",
        body: JSON.stringify({ email:email, code:code }) });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || "That code did not work.");
      meCache = null;
      sessionStorage.setItem("cv_cap", "done");
      sec.innerHTML = SUCCESS_HTML;
      document.getElementById("cv-cheat-btn").addEventListener("click", cheatSheet);
      document.getElementById("cv-stuff-btn").addEventListener("click", function(){ toggleDrawer(true); });
      renderStuffLink();
    } catch(err){ panelError("cv-code-err", err.message); }
  });
}

/* ---------- your stuff drawer ---------- */
var drawerBuilt = false;
function renderStuffLink(){
  me().then(function(m){
    if (!m.signed_in) return;
    var nav = document.querySelector(".top-inner nav");
    if (!nav || document.getElementById("cv-stuff-link")) return;
    var a = document.createElement("a");
    a.href = "#stuff"; a.id = "cv-stuff-link"; a.textContent = "Your stuff";
    a.addEventListener("click", function(e){ e.preventDefault(); toggleDrawer(); });
    nav.appendChild(a);
    buildDrawer();
  });
}
function buildDrawer(){
  if (drawerBuilt) return;
  drawerBuilt = true;
  var main = document.querySelector("main");
  var sec = document.createElement("section");
  sec.id = "cv-drawer"; sec.className = "cv-drawer"; sec.hidden = true;
  sec.setAttribute("aria-label", "Your stuff");
  main.appendChild(sec);
  refreshDrawer();
}
async function refreshDrawer(){
  var sec = document.getElementById("cv-drawer");
  if (!sec) return;
  var m = await me(true);
  if (!m.signed_in){ sec.hidden = true; return; }
  var hist = [];
  try {
    var r = await fetch("/api/history", { credentials:"same-origin" });
    var d = await r.json();
    if (d.ok) hist = d.conversions || [];
  } catch(e){}
  var items = hist.map(function(c){
    return "<li><b>" + esc(c.src_name || "file") + "</b> " +
      "<span class='cv-hist-arrow'>" + esc(c.src_ext) + " -> " + esc(c.dst_ext) + "</span>" +
      "<time>" + esc(fmtDate(c.created_at)) + "</time></li>";
  }).join("");
  sec.innerHTML =
    '<div class="cv-drawer-inner">' +
    '<div class="cv-drawer-head"><h2>Your stuff</h2>' +
    '<button class="cv-dismiss" id="cv-drawer-close" type="button">Close</button></div>' +
    '<p class="cv-micro">Signed in as <b>' + esc(m.email) + "</b>. " +
    (m.email_verified ? "Email verified." :
      "Email not verified yet: we cannot send sign-in emails until our mail sender is connected.") + "</p>" +
    (hist.length ? "<ul class='cv-hist'>" + items + "</ul>"
      : "<p class='cv-micro'>No conversions yet. Convert something and it lands here.</p>") +
    '<div class="cv-drawer-actions">' +
    '<button class="court-btn court-btn-ghost" id="cv-pair-btn" type="button">Link another device</button>' +
    '<button class="court-btn court-btn-ghost" id="cv-cheat-btn2" type="button">Cheat sheet</button>' +
    '<button class="court-btn court-btn-ghost" id="cv-signout-btn" type="button">Sign out</button>' +
    '</div>' +
    '<p class="cv-pair" id="cv-pair-out" hidden></p>' +
    '</div>';
  document.getElementById("cv-drawer-close").addEventListener("click", function(){ toggleDrawer(false); });
  document.getElementById("cv-cheat-btn2").addEventListener("click", cheatSheet);
  document.getElementById("cv-signout-btn").addEventListener("click", async function(){
    await fetch("/api/signout", { method:"POST", credentials:"same-origin" });
    meCache = null;
    var link = document.getElementById("cv-stuff-link");
    if (link) link.remove();
    drawerBuilt = false; sec.remove();
  });
  document.getElementById("cv-pair-btn").addEventListener("click", async function(){
    var out = document.getElementById("cv-pair-out");
    try {
      var r = await fetch("/api/pair/new", { method:"POST", credentials:"same-origin" });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || "Could not make a code.");
      out.hidden = false;
      out.innerHTML = "On the other device, enter your email and this code within 5 minutes: <b class='cv-code'>" + esc(d.code) + "</b>";
    } catch(err){ out.hidden = false; out.textContent = err.message; }
  });
}
function toggleDrawer(open){
  var sec = document.getElementById("cv-drawer");
  if (!sec){ buildDrawer(); sec = document.getElementById("cv-drawer"); }
  var show = (typeof open === "boolean") ? open : sec.hidden;
  if (show) refreshDrawer();
  sec.hidden = !show;
  if (show) sec.scrollIntoView({ behavior:"smooth", block:"start" });
}

/* ---------- value moment hook ---------- */
window.addEventListener("cv:converted", async function(e){
  var d = (e && e.detail) || {};
  var conv = { srcName:d.srcName || "", srcExt:d.srcExt || "", dstExt:d.dstExt || "",
    dstName:d.dstName || "", bytes:d.bytes || 0, ts:Math.floor(Date.now() / 1000) };
  fire("value_moment", { src:conv.srcExt, dst:conv.dstExt });
  var m = await me();
  if (m.signed_in){
    try {
      await fetch("/api/history", { method:"POST", headers:{ "Content-Type":"application/json" },
        credentials:"same-origin", body: JSON.stringify(conv) });
    } catch(err){}
    return;
  }
  pushGuest(conv);
  var state = sessionStorage.getItem("cv_cap");
  if (!state) showPanel();
});

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", function(){
  renderStuffLink();
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("verified") === "1"){
      meCache = null;
      renderStuffLink();
    }
  } catch(e){}
});

})();
