// Gemini: prompts, live web reading (URL context), retry and model fallback.
// Part of Fare Rules AI. See docs/how-it-works.md.

/* ---------- Gemini ---------- */
const TICKET_PROMPT = `You read airline ticket copies for a travel agency.
Return ONLY JSON with this exact shape:
{"ticket": {
   "airline": string, "airlineCode": "2-character IATA code"|null, "pnr": string|null, "currency": string,
   "passengers": [{"name": string, "type": "ADT"|"CHD"|"INF"}],
   "sectors": [{"from": "IATA", "to": "IATA", "flight": string, "departure": "YYYY-MM-DDTHH:MM"}],
   "fareType": string|null, "fareBasis": string|null,
   "baseFarePerPax": number|null, "taxesPerPax": number|null, "totalPerPax": number|null, "totalPaid": number|null
}}
Numbers must be plain numbers without commas. Never invent values; use null when not shown.`;

const RULES_SHAPE = `{
 "sourcesRead": [{"url": string, "read": boolean}],
 "zone": {"name": string|null, "how": string, "source": "sheet"|"website"|"ai_inferred"|null, "confident": boolean} | null,
 "sheet": {"used": boolean, "effectiveDate": string|null, "fareTypeOnSheet": string|null} | null,
 "rules": [{
   "fareType": string, "currency": string, "sectors": [string] | null,
   "basis": "per_pax_per_sector"|"per_pax_per_journey",
   "change": {"permitted": boolean, "source_text": string, "plusFareDifference": boolean,
              "windows": [{"minHoursBefore": number|null, "maxHoursBefore": number|null, "permitted": boolean|null, "fee": number|null, "feePercentOfBaseFare": number|null, "source_text": string, "reason": string|null, "sheetFee": number|null, "sheetCurrency": string|null, "sheetRef": string|null}]},
   "refund": {"permitted": boolean, "source_text": string, "refundForm": "cash"|"credit"|"voucher"|"unknown",
              "windows": [{"minHoursBefore": number|null, "maxHoursBefore": number|null, "permitted": boolean|null, "fee": number|null, "feePercentOfBaseFare": number|null, "source_text": string, "reason": string|null, "sheetFee": number|null, "sheetCurrency": string|null, "sheetRef": string|null}]}
 }],
 "notes": [string]
}`;

function rulesPrompt(summary, urls, pasted, sheet){
  const where = pasted
    ? "Use ONLY the AIRLINE FARE RULES TEXT at the end of this message."
    : `Open and read these official airline pages now:\n${urls.join("\n")}\nUse ONLY what these pages say today. Do not use your own knowledge or older versions of the rules.
If you cannot open a page, set read:false for it. If you could read none of them, return "rules": [] and explain in notes.`;
  return `You extract airline change (reissue) and cancellation (refund) rules for a travel agency.
${where}

TICKET (no passenger data): ${JSON.stringify(summary)}

Return ONLY JSON, no other text, with this exact shape:
${RULES_SHAPE}

Read ALL text on the page, including info (i) tooltips, pop-ups, footnotes and asterisk (*) notes: they often hold the time limits (e.g. "within 24 hrs prior to departure is not permitted") and route conditions. Turn each such condition into its own window, and put asterisk notes in notes.
Return one rules entry per fare type that applies to this ticket's route. If the fee, currency or sheet row differs by sector or direction (e.g. "Ex-India to Dubai" vs "Ex-Dubai to India"), return separate entries for the same fareType with "sectors" listing the sectors each applies to (e.g. ["BOM-DXB"]); otherwise set "sectors" to null.
Windows: hours are measured BEFORE departure; negative means after departure.
"up to 24 hrs prior" => minHoursBefore 24, maxHoursBefore null.
"within 24 hrs prior and up to 30 days after departure" => minHoursBefore -720, maxHoursBefore 24.
If a period is not mentioned, add a window for it with permitted null and source_text "Not stated in rules".
Whenever permitted is null, or a fee is allowed but no amount is given, fill "reason" with one plain sentence a ticketing agent understands, saying exactly what the airline page does not settle (e.g. "The page gives the fee up to 24 hours before departure but says nothing about changes inside 24 hours."). Otherwise set reason to null.
Free = fee 0. Not permitted = permitted false, fee null.
If fees differ by route type (domestic vs international, region or zone group), return ONLY the rules for this ticket's route and say in notes which route set you used and why.
If two sources disagree, use the airline's fare-types page and put the disagreement in notes.
Copy source_text word for word from the page. Never invent amounts. Put anything unclear (route variations, vague wording) in notes.
ZONES: if the fees depend on a zone or region (e.g. "Zone 3 | Middle East"), decide the zone for this ticket's route and fill "zone":
- first use the AIRLINE FEE SHEET, if given: it lists cities/sectors under region headings (e.g. "Ex-India to Dubai/Sharjah" under "middle east") -> source "sheet";
- otherwise use any list on the website -> source "website";
- otherwise use the country of the airports -> source "ai_inferred".
Write "how" as one plain sentence, e.g. "Dubai is listed under Middle East in the airline sheet, which is Zone 3 on the website." If you are not sure, set confident false and set permitted null with a reason on the windows that depend on the zone. If fees do not depend on zones, set "zone": null.
Numbers must be plain numbers without commas.${sheet ? `

AIRLINE FEE SHEET (uploaded by the agency, file "${sheet.name}"; it may be out of date):
The AIRLINE WEBSITE is the source of every fee amount. Use this sheet ONLY to (1) find the zone/region of the ticket's sectors, and (2) cross-check: for every window, put the sheet's fee for the same sector, fare type and time window in sheetFee/sheetCurrency, and the row label + column heading in sheetRef; use null if the sheet has nothing comparable. Fill "sheet" with the effective date printed on the sheet and the fare type name the sheet uses for this fare.
In notes, say when the sheet uses different fare-type names or different time windows than the website, and when the sheet has a separate fee for journeys starting outside the airline's home country (e.g. "Ex-Dubai ... AED") that the website does not show.

${sheet.text}` : ""}${pasted ? "\n\nAIRLINE FARE RULES TEXT:\n" + pasted : ""}`;
}

function parseJSON(txt){
  try { return JSON.parse(txt); }
  catch {
    const f = txt.match(/```(?:json)?\s*([\s\S]*?)```/); if(f){ try { return JSON.parse(f[1]); } catch {} }
    const j = txt.match(/\{[\s\S]*\}/); if(j) return JSON.parse(j[0]);
    throw new Error("Gemini did not return valid JSON. Click Calculate again.");
  }
}

// One Gemini call with retry and model fallback. urlContext = let Gemini read web pages live.
async function gemini({key, parts, json, urlContext}){
  const model = $("model").value.trim() || FALLBACK_MODELS[0];
  const req = {contents:[{role:"user",parts}], generationConfig:{temperature:0}};
  if(json) req.generationConfig.responseMimeType = "application/json";
  if(urlContext) req.tools = [{url_context:{}}];
  const body = JSON.stringify(req);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const queue = [model, ...FALLBACK_MODELS.filter(m => m !== model)];
  const tried = new Set();
  let lastMsg = "";
  while(queue.length){
    const m = queue.shift();
    if(tried.has(m)) continue;
    tried.add(m);
    for(let attempt = 1; attempt <= 2; attempt++){
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
      let res, data;
      try {
        res = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body});
        data = await res.json().catch(()=>({}));
      } catch { lastMsg = "Could not reach Gemini. Check your internet connection."; break; }

      if(res.ok){
        $("model").value = m;
        const cand = data?.candidates?.[0] || {};
        const text = cand?.content?.parts?.map(p=>p.text||"").join("") || "";
        const meta = cand.urlContextMetadata || cand.url_context_metadata || {};
        const urlStatus = (meta.urlMetadata || meta.url_metadata || []).map(u => ({
          url: u.retrievedUrl || u.retrieved_url, status: String(u.urlRetrievalStatus || u.url_retrieval_status || "")}));
        return {text, urlStatus, model:m};
      }

      const msg = data?.error?.message || `Gemini returned HTTP ${res.status}`;
      lastMsg = msg;
      if(urlContext && res.status === 400 && /tool|url.?context/i.test(msg)){ const e = new Error(msg); e.code = "TOOL"; throw e; }
      const busy = res.status === 503 || res.status === 429 || res.status === 500 || /high demand|overloaded|unavailable|try again later|resource.?exhausted|quota/i.test(msg);
      const retired = res.status === 404 || /no longer available|deprecated|not found/i.test(msg);
      if(retired){
        const named = (msg.match(/models\/(gemini-[\w.\-]+)/g) || []).map(x=>x.slice(7)).filter(x => !tried.has(x));
        queue.unshift(...named);
        break;
      }
      if(busy){
        if(attempt === 1){ setStatus(`${m} is busy. Waiting 4 seconds…`); await wait(4000); continue; }
        break;
      }
      throw new Error(msg);
    }
  }
  throw new Error(`All Gemini models are busy right now. Wait a minute and click Calculate again. (Last error: ${lastMsg})`);
}

// Fallback: Google's newer Interactions API, which also offers live web-page reading.
async function geminiInteractions({key, text}){
  const model = $("model").value.trim() || FALLBACK_MODELS[0];
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta2/interactions",{method:"POST",
    headers:{"Content-Type":"application/json","x-goog-api-key":key},
    body:JSON.stringify({model, input:text, tools:[{type:"url_context"}]})});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error?.message || `Gemini returned HTTP ${res.status}`);
  const steps = data.steps || [];
  const out = steps.filter(s=>s.type==="model_output").flatMap(s=>s.content||[]).map(c=>c.text||"").join("");
  const urlStatus = steps.filter(s=>s.type==="url_context_result").flatMap(s=>s.results||s.content||[s]).map(r=>({url:r.url||r.retrieved_url, status:String(r.status||"")}));
  return {text: out, urlStatus, model};
}
const FALLBACK_MODELS = ["gemini-3.8-flash","gemini-3.7-flash","gemini-3.6-flash","gemini-3.5-flash-lite"];

async function fileToPart(file){
  const b64 = await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(",")[1]);fr.onerror=rej;fr.readAsDataURL(file);});
  return {inline_data:{mime_type:file.type, data:b64}};
}

