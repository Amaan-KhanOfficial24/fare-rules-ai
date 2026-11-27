// Page logic: inputs, rendering the result, and the Calculate flow.
// Part of Fare Rules AI. See docs/how-it-works.md.

/* ---------- UI ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const money = (n,c) => n==null ? "—" : `${c||""} ${Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`.trim();
function fmtHours(h){
  if(!isFinite(h)) return "—";
  const d = Math.floor(Math.abs(h)/24), hr = Math.round(Math.abs(h)%24);
  const t = d ? `${d}d ${hr}h` : `${hr}h`;
  return h >= 0 ? `${t} before` : `${t} after`;
}
function localNow(){const d=new Date();d.setSeconds(0,0);return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,16);}

$("ticketText").value = SAMPLE_TICKET;
$("reqTime").value = localNow();
try { const k = localStorage.getItem("gemini_key"); if(k) $("apiKey").value = k; } catch {}
$("saveKey").onclick = () => { try { localStorage.setItem("gemini_key",$("apiKey").value.trim()); setStatus("Key saved in this browser only."); } catch { setStatus("This browser blocked saving. Paste the key each time.", true); } };
function loadSample(ticket){
  setTab(false);
  $("ticketText").value = ticket; $("ruleUrls").value = ""; $("rulesText").value = "";
  $("airline").value = ""; $("fareType").value = ""; $("pax").value = ""; $("fareDiff").value = "";
  setStatus("Sample loaded. Click Calculate charges.");
}
$("loadFZ").onclick = () => loadSample(SAMPLE_TICKET);
$("loadXY").onclick = () => loadSample(XY_TICKET);
$("load6E").onclick = () => loadSample(IN_TICKET);
function setTab(file){ $("tabText").setAttribute("aria-pressed",!file); $("tabFile").setAttribute("aria-pressed",file); $("ticketText").hidden=file; $("fileWrap").hidden=!file; }
$("sheetFile").onchange = async () => {
  const f = $("sheetFile").files[0];
  SHEET = null;
  if(!f){ $("sheetInfo").textContent = "No sheet loaded."; return; }
  try {
    SHEET = await readSheet(f);
    $("sheetInfo").textContent = `Loaded ${SHEET.name}: ${SHEET.tabs} tabs, ${SHEET.rows} rows${SHEET.cut ? " (very large: only the first part is used)" : ""}. Used for zone and cross-check only; not saved.`;
  } catch(e){ $("sheetInfo").textContent = e.message || "Could not read this file."; }
};
$("tabText").onclick = () => setTab(false);
$("tabFile").onclick = () => setTab(true);
function setStatus(msg, err){ $("status").textContent = msg; $("status").className = "status" + (err ? " err" : ""); }

function sameFare(a,b){ return String(a||"").toLowerCase().trim() === String(b||"").toLowerCase().trim(); }
function matchRule(rules, fareType){
  const ft = (fareType||"").toLowerCase().trim();
  return rules.find(r => (r.fareType||"").toLowerCase() === ft && !(r.sectors||[]).length)
      || rules.find(r => (r.fareType||"").toLowerCase() === ft)
      || rules.find(r => ft && ((r.fareType||"").toLowerCase().includes(ft) || ft.includes((r.fareType||"").toLowerCase())));
}

function windowText(w){
  if(!w) return `<span class="pill warn">No matching rule</span>`;
  if(w.permitted === false) return `<span class="pill bad">Not permitted</span>`;
  if(w.permitted == null) return `<span class="pill warn">Check manually</span>`;
  return `<span class="pill ok">Allowed</span>`;
}

function renderTable(part, cur){
  return `<div class="tablewrap"><table>
    <thead><tr><th>Sector</th><th>Departure</th><th>Rule applied</th><th style="text-align:right">Fee / pax</th><th style="text-align:right">Pax</th><th style="text-align:right">Subtotal</th></tr></thead>
    <tbody>${part.rows.map(r=>`<tr>
      <td class="mono">${esc(r.sector)}<br><span class="hint">${esc(r.flight||"")}</span></td>
      <td class="mono">${esc((r.departure||"").split("T")[0])}<br>${esc((r.departure||"").split("T")[1]||"")}<br><span class="hint" style="white-space:nowrap">${fmtHours(r.hoursBefore)}</span></td>
      <td>${r.reason ? `<span class="pill warn">Check manually</span>` : windowText(r.window)}<div class="quote">${esc(r.window?.source_text || "")}</div>${sheetCheck(r, cur)}${r.reason ? `<div class="why"><strong>Why:</strong> ${esc(r.reason)}</div>` : ""}</td>
      <td class="num">${r.feePerPax==null?"—":money(r.feePerPax,cur)}</td>
      <td class="num">${r.pax}</td>
      <td class="num">${r.subtotal==null?"—":money(r.subtotal,cur)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function sheetCheck(r, cur){
  const w = r.window;
  if(!w || w.sheetFee == null) return "";
  const sc = w.sheetCurrency || r.ruleCurrency || cur;
  const wc = r.ruleCurrency || cur;
  const same = r.rawFee != null && sc === wc && Math.abs(w.sheetFee - r.rawFee) < 0.005;
  return same ? `<div class="hint"><span class="pill ok">Matches sheet</span></div>`
              : `<div class="hint"><span class="pill warn" style="white-space:normal">Sheet: ${esc(money(w.sheetFee, sc))}</span></div>`;
}
function sheetDiffs(calc, cur){
  const out = [];
  for(const [kind, label] of [["change","Reissue"],["refund","Refund"]])
    for(const r of calc[kind].rows){
      const w = r.window; if(!w || w.sheetFee == null) continue;
      const sc = w.sheetCurrency || r.ruleCurrency || cur, wc = r.ruleCurrency || cur;
      if(r.rawFee == null || sc !== wc || Math.abs(w.sheetFee - r.rawFee) >= 0.005)
        out.push(`${label} · ${r.sector}: website ${r.rawFee == null ? "no amount" : money(r.rawFee, wc)}, sheet ${money(w.sheetFee, sc)}${w.sheetRef ? ` (${w.sheetRef})` : ""}`);
    }
  return out;
}
function zoneHtml(ai){
  const z = ai.zone; if(!z || !z.name) return "";
  const src = {sheet:"from your airline sheet", website:"from the airline website", ai_inferred:"worked out by the AI from the airport's country"}[z.source] || "";
  return `<div class="label">Zone used</div><div style="font-size:.88rem"><span class="pill ${z.confident===false?"warn":"ok"}">${esc(z.name)}</span> <span class="hint">${esc(src)}</span><div class="hint" style="margin-top:3px">${esc(z.how||"")}</div></div>`;
}
function sourcesHtml(ai){
  const when = new Date(ai.readAt).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"});
  if(ai.pasted) return `<div class="hint">Rules pasted by you (live read not used) · ${esc(when)}</div>`;
  const read = new Map((ai.sourcesRead||[]).map(x=>[x.url, x.read]));
  const st = new Map((ai.urlStatus||[]).map(x=>[x.url, x.status]));
  return `<ul style="margin:0;padding-left:18px;font-size:.84rem">${(ai.urls||[]).map(u => {
    const s = st.get(u) || "", ok = /SUCCESS/i.test(s) || (s === "" && read.get(u) === true), bad = /ERROR|FAIL|UNSAFE|PAYWALL/i.test(s) || read.get(u) === false;
    const pill = ok ? '<span class="pill ok">Read live</span>' : bad ? '<span class="pill bad">Not read</span>' : '<span class="pill warn">Unconfirmed</span>';
    return `<li style="overflow-wrap:anywhere">${pill} <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`;
  }).join("")}${ai.sheet ? `<li><span class="pill ok">Sheet</span> ${esc(ai.sheet.name)}${ai.sheet.effectiveDate ? ` · effective ${esc(ai.sheet.effectiveDate)}` : ""}${ai.sheet.fareTypeOnSheet ? ` · fare on sheet: ${esc(ai.sheet.fareTypeOnSheet)}` : ""} · used for zone and cross-check only</li>` : ""}</ul><div class="hint">Read on ${esc(when)} by ${esc(ai.model||"")}. Nothing was stored.</div>`;
}

function render(ai, calc, rule, pax, fareType, fareDiff){
  const t = ai.ticket, cur = rule.currency || t.currency;
  const curWarn = t.currency && rule.currency && t.currency !== rule.currency
    ? `<div class="warnbox">Ticket is in ${esc(t.currency)} but the rules are in ${esc(rule.currency)}. Convert before quoting.</div>` : "";
  const ch = calc.change, rf = calc.refund;
  const chStatus = ch.blocked ? `<span class="pill bad">Not permitted</span>` : ch.unclear ? `<span class="pill warn">Check manually</span>` : `<span class="pill ok">Allowed</span>`;
  const rfStatus = rf.blocked ? `<span class="pill bad">Not permitted</span>` : rf.unclear ? `<span class="pill warn">Check manually</span>` : `<span class="pill ok">Allowed</span>`;
  const notes = (ai.notes||[]).filter(Boolean);
  $("result").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span class="label">Result</span>
      <span class="hint">${esc(t.airline||"")} · ${esc(fareType)} fare · ${pax} pax · ${esc(rule.basis==="per_pax_per_journey"?"per pax, per journey":"per pax, per sector")}</span>
    </div>
    <div class="totals">
      <div class="tot"><span class="label">Reissue charge ${chStatus}</span>
        <span class="amt">${ch.blocked||ch.unclear?"—":money(ch.grand,cur)}</span>
        <span class="note">${ch.blocked?"Change not allowed on this fare at this time":ch.unclear?"Some sectors need a manual check. See why below.":`Change fee ${money(ch.total,cur)}${fareDiff?` + fare difference ${money(fareDiff,cur)}`:" + fare difference, if any"}`}</span></div>
      <div class="tot"><span class="label">Refund charge ${rfStatus}</span>
        <span class="amt">${rf.blocked||rf.unclear?"—":money(rf.total,cur)}</span>
        <span class="note">${rf.blocked?"Refund not allowed. Check the rule text for tax refunds.":rf.unclear?"Some sectors need a manual check. See why below.":`Paid ${money(calc.paid,t.currency)} → estimated refund ${money(rf.estimatedRefund,t.currency)}${rule.refund?.refundForm && rule.refund.refundForm!=="cash" && rule.refund.refundForm!=="unknown" ? ` as ${esc(rule.refund.refundForm)}` : ""}`}</span></div>
    </div>
    ${curWarn}
    ${(ch.reasons.length || rf.reasons.length) ? `<div class="warnbox"><strong>Why a manual check is needed:</strong><ul style="margin:4px 0 0;padding-left:18px">${
      [...ch.reasons.map(x=>`Reissue · ${x}`), ...rf.reasons.map(x=>`Refund · ${x}`)].map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${(() => { const d = sheetDiffs(calc, cur); return d.length ? `<div class="warnbox"><strong>Airline sheet differs from the website (website amounts used):</strong><ul style="margin:4px 0 0;padding-left:18px">${d.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>` : ""; })()}
    ${zoneHtml(ai)}
    <div class="label">Reissue breakdown</div>${renderTable(ch,cur)}
    <div class="label">Refund breakdown</div>${renderTable(rf,cur)}
    ${notes.length?`<div class="warnbox"><strong>Check before quoting:</strong><ul style="margin:4px 0 0;padding-left:18px">${notes.map(n=>`<li>${esc(n)}</li>`).join("")}</ul></div>`:""}
    <div class="label">Fare rules source</div>
    ${sourcesHtml(ai)}
    <div class="label">Read from ticket</div>
    <div class="facts">
      <div><span>PNR</span><b>${esc(t.pnr||"—")}</b></div>
      <div><span>Passengers</span><b>${(t.passengers||[]).length}</b></div>
      <div><span>Fare basis</span><b>${esc(t.fareBasis||"—")}</b></div>
      <div><span>Base / pax</span><b>${money(t.baseFarePerPax,t.currency)}</b></div>
      <div><span>Taxes / pax</span><b>${money(t.taxesPerPax,t.currency)}</b></div>
      <div><span>Total paid</span><b>${money(calc.paid,t.currency)}</b></div>
    </div>
    <details><summary>Show what Gemini extracted (JSON)</summary><pre>${esc(JSON.stringify(ai,null,2))}</pre></details>`;
}

$("run").onclick = async () => {
  const key = $("apiKey").value.trim();
  if(!key) return setStatus("Paste your Gemini API key first.", true);
  const useFile = $("tabFile").getAttribute("aria-pressed") === "true";
  const file = useFile ? $("ticketFile").files[0] : null;
  if(useFile && !file) return setStatus("Choose a ticket file to upload.", true);
  if(!useFile && !$("ticketText").value.trim()) return setStatus("Paste the ticket copy.", true);
  const requestTime = new Date($("reqTime").value || Date.now());
  $("run").disabled = true;
  try{
    // Step 1: read the ticket
    setStatus("Step 1 of 2: Gemini is reading the ticket…");
    const tParts = [{text: TICKET_PROMPT}];
    if(file){ tParts.push({text:"TICKET COPY (attached file):"}); tParts.push(await fileToPart(file)); }
    else tParts.push({text:"TICKET COPY:\n" + $("ticketText").value});
    const tRes = await gemini({key, parts:tParts, json:true});
    const t = (parseJSON(tRes.text).ticket) || {};
    if($("airline").value.trim()) t.airline = $("airline").value.trim();

    // Step 2: read the airline's rules live from its website (or the pasted fallback)
    const code = findAirline($("airline").value) || findAirline(t.airlineCode) || findAirline(t.airline);
    const typed = $("ruleUrls").value.split(/\s+/).map(x=>x.trim()).filter(x=>/^https?:\/\//i.test(x));
    const urls = typed.length ? typed : (code ? AIRLINE_SOURCES[code].urls : []);
    const pasted = $("rulesText").value.trim();
    if(!pasted && !urls.length) throw new Error(`No rule page link is set up for ${t.airline || "this airline"}. Paste the airline's fare-rules page link in "Rule page link".`);
    const fareTypeWanted = $("fareType").value.trim() || t.fareType || null;
    const summary = {airline:t.airline, airlineCode:t.airlineCode, fareType:fareTypeWanted, fareBasis:t.fareBasis, currency:t.currency,
                     route:(t.sectors||[]).map(x=>`${x.from}-${x.to}`)};
    const prompt = rulesPrompt(summary, urls, pasted, SHEET);
    setStatus(pasted ? "Step 2 of 2: Gemini is reading the pasted rules…" : SHEET ? `Step 2 of 2: Gemini is reading ${code ? AIRLINE_SOURCES[code].name : "the airline"}'s website live and checking it against your fee sheet…`
                     : `Step 2 of 2: Gemini is reading the fare rules live from ${code ? AIRLINE_SOURCES[code].name : "the airline"}'s website…`);
    let rRes;
    if(pasted) rRes = await gemini({key, parts:[{text:prompt}], json:true});
    else {
      try { rRes = await gemini({key, parts:[{text:prompt}], urlContext:true}); }
      catch(e){ if(e.code !== "TOOL") throw e; rRes = await geminiInteractions({key, text:prompt}); }
    }
    const rj = parseJSON(rRes.text);
    const ai = {ticket:t, rules:rj.rules||[], notes:rj.notes||[], sourcesRead:rj.sourcesRead||[], urlStatus:rRes.urlStatus||[],
                urls: pasted ? [] : urls, pasted: !!pasted, readAt: new Date().toISOString(), model: rRes.model,
                zone: rj.zone || null, sheet: SHEET ? {...(rj.sheet||{}), name: SHEET.name} : null};
    if(ai.zone && ai.zone.confident === false) ai.notes.unshift(`Zone not certain: ${ai.zone.how}`);
    const allFailed = !pasted && (ai.urlStatus.length ? ai.urlStatus.every(x=>!/SUCCESS/i.test(x.status)) : (ai.sourcesRead.length && ai.sourcesRead.every(x=>x.read===false)));
    if(!ai.rules.length || allFailed)
      throw new Error(`Gemini could not read the fare rules from the airline website${ai.notes.length ? ` (${ai.notes.join(" ")})` : ""}. Open "Airline page can't be read?" and paste the rules, or try again.`);

    const fareType = fareTypeWanted || "";
    const rule = matchRule(ai.rules, fareType);
    if(!rule) throw new Error(`No rules found for fare type "${fareType || "unknown"}". Rules found: ${ai.rules.map(r=>r.fareType).join(", ") || "none"}.`);
    const pax = parseInt($("pax").value,10) || (t.passengers||[]).filter(p=>p.type!=="INF").length || 1;
    const fareDiff = parseFloat($("fareDiff").value) || 0;
    const calc = calculate({ticket:t, rule, rules:ai.rules, pax, requestTime, fareDiff});
    render(ai, calc, rule, pax, rule.fareType, fareDiff);
    setStatus("Done. Rules were read live from the airline website. Check the quoted rule lines before giving the amount to the agent.");
  }catch(e){
    setStatus(e.message || String(e), true);
  }finally{ $("run").disabled = false; }
};
