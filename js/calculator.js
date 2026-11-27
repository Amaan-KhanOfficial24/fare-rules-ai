// Charge calculator: plain code, no AI. Works out hours to departure, picks the rule window, multiplies fee x pax x sectors.
// Part of Fare Rules AI. See docs/how-it-works.md.

/* ---------- Pure calculation (no AI) ---------- */
// hoursBefore > 0 means before departure, < 0 means after departure.
function pickWindow(windows, hoursBefore){
  return (windows||[]).find(w =>
    (w.minHoursBefore == null || hoursBefore >= w.minHoursBefore) &&
    (w.maxHoursBefore == null || hoursBefore <  w.maxHoursBefore)) || null;
}
function describeWindows(windows){
  return (windows||[]).map(w => {
    const at = h => h >= 0 ? `${h}h before departure` : `${-h}h after departure`;
    const from = w.maxHoursBefore == null ? "from booking" : `from ${at(w.maxHoursBefore)}`;
    const to = w.minHoursBefore == null ? "onwards" : `until ${at(w.minHoursBefore)}`;
    return `${from} ${to}`;
  }).join("; ") || "none";
}
// Returns {fee, reason}: fee null with a reason = needs a manual check.
function feeFor(w, baseFarePerPax, windows, hoursBefore){
  if(!isFinite(hoursBefore)) return {fee:null, reason:"The departure date or time could not be read from the ticket, so the time to departure is unknown."};
  if(!w) return {fee:null, reason:`No airline rule covers this point (${fmtHours(hoursBefore)} departure). The rules found cover: ${describeWindows(windows)}.`};
  if(w.permitted === false) return {fee:null, reason:null};
  if(w.permitted == null) return {fee:null, reason: w.reason || "The airline's rules do not say what applies at this time before departure."};
  if(typeof w.fee === "number") return {fee:w.fee, reason:null};
  if(typeof w.feePercentOfBaseFare === "number"){
    if(baseFarePerPax) return {fee:+(baseFarePerPax*w.feePercentOfBaseFare/100).toFixed(2), reason:null};
    return {fee:null, reason:`The fee is ${w.feePercentOfBaseFare}% of the base fare, but the base fare was not found on the ticket.`};
  }
  return {fee:null, reason: w.reason || "The airline's rule allows this but does not state the fee amount."};
}
function calculate({ticket, rule, rules, pax, requestTime, fareDiff}){
  const perJourney = rule.basis === "per_pax_per_journey";
  const sectors = (ticket.sectors||[]).map(s => {
    const dep = new Date(s.departure);
    const h = (dep - requestTime) / 3.6e6;
    return {...s, hoursBefore: h};
  });
  const out = {};
  for(const kind of ["change","refund"]){
    const rows = [];
    let total = 0, blocked = false, unclear = false;
    const reasons = [];
    const list = perJourney ? sectors.slice(0,1) : sectors;
    if(!list.length){ unclear = true; reasons.push("No flight sectors could be read from the ticket."); }
    for(const s of list){
      const key = `${s.from}-${s.to}`;
      const R = (rules||[]).find(x => x !== rule && sameFare(x.fareType, rule.fareType) && (x.sectors||[]).includes(key))
             || (rule.sectors && !rule.sectors.includes(key) ? (rules||[]).find(x => sameFare(x.fareType, rule.fareType) && !x.sectors) || rule : rule);
      const r = R[kind] || {};
      const w = r.permitted === false ? {permitted:false, source_text:r.source_text} : pickWindow(r.windows, s.hoursBefore);
      let {fee, reason} = feeFor(w, ticket.baseFarePerPax, r.windows, s.hoursBefore);
      const rawFee = fee;
      if(fee != null && R.currency && rule.currency && R.currency !== rule.currency){
        reason = `This sector is charged in ${R.currency} (${money(fee, R.currency)}), not ${rule.currency}. Convert it before adding to the total.`;
        fee = null;
      }
      if(w && w.permitted === false) blocked = true;
      if(reason){ unclear = true; const t = `${s.from}-${s.to}: ${reason}`; if(!reasons.includes(t)) reasons.push(t); }
      const sub = fee == null ? null : fee * pax;
      if(sub != null) total += sub;
      rows.push({sector:key, ruleCurrency:R.currency || rule.currency, rawFee, flight:s.flight, departure:s.departure, hoursBefore:s.hoursBefore,
                 window:w, feePerPax:fee, pax, subtotal:sub, reason});
    }
    out[kind] = {rows, total, blocked, unclear, reasons};
  }
  out.change.grand = out.change.total + (fareDiff||0);
  const paid = ticket.totalPaid ?? ((ticket.totalPerPax||0) * pax);
  out.refund.estimatedRefund = out.refund.blocked || out.refund.unclear ? null : Math.max(0, paid - out.refund.total);
  if(!out.refund.blocked && !out.refund.unclear && !paid){ out.refund.reasons.push("The amount paid was not found on the ticket, so the refund balance cannot be worked out."); }
  out.paid = paid;
  return out;
}
window.calculate = calculate;

