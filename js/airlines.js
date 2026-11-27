// Airline rule-page links. Only links are kept here; no fare rules are stored.
// Part of Fare Rules AI. See docs/how-it-works.md.

/* ---------- Airline rule pages: links only, no rules are stored ---------- */
const AIRLINE_SOURCES = {
  "FZ": {name:"flydubai",   urls:["https://www.flydubai.com/en/plan/fare-types"]},
  "XY": {name:"flynas",     urls:["https://www.flynas.com/en/booking-flynas/fare-types","https://static.flynas.com/images/Fares_and_Regulations/flynas-EN-fare-regulations.pdf"]},
  "G9": {name:"Air Arabia", urls:["https://www.airarabia.com/en/fare-types"]},
  "6E": {name:"IndiGo",     urls:["https://www.goindigo.in/information/fees-and-charges.html"]}
};
function findAirline(text){
  const up = String(text||"").trim().toUpperCase();
  if(!up) return null;
  if(AIRLINE_SOURCES[up]) return up;
  return Object.keys(AIRLINE_SOURCES).find(k => up.includes(AIRLINE_SOURCES[k].name.toUpperCase())) || null;
}

