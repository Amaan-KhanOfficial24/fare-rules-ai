// Optional airline fee sheet: read in the browser, kept only in memory.
// Part of Fare Rules AI. See docs/how-it-works.md.

/* ---------- Airline fee sheet: read in the browser, kept only in memory ---------- */
let SHEET = null;
async function readSheet(file){
  if(!window.XLSX) throw new Error("The spreadsheet reader could not load. Check your internet connection and reload the page.");
  const wb = XLSX.read(await file.arrayBuffer(), {type:"array"});
  const parts = []; let rows = 0;
  for(const name of wb.SheetNames){
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], {blankrows:false, strip:true})
      .split("\n").map(l => l.replace(/,+$/,"")).filter(l => l.replace(/[,\s]/g,"")).join("\n");
    if(!csv) continue;
    rows += csv.split("\n").length;
    parts.push(`### TAB: ${name.trim()}\n${csv}`);
  }
  let text = parts.join("\n\n");
  const cut = text.length > 200000;
  if(cut) text = text.slice(0, 200000);
  return {name:file.name, tabs:parts.length, rows, text, cut};
}

