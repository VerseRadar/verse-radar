const CONFIG = {
  dataBase: "/data/",
  newsEndpoint: "/api/news",
  siteVersion: "0.13.11"
};
let usingStaticData = false;

async function loadJSON(name){
  const url = name === "news.json" ? CONFIG.newsEndpoint : name === "patches.json" ? "/api/patches" : name === "freefly.json" ? "/api/freefly" : name === "events.json" ? "/api/events" : name === "activities.json" ? "/api/activities" : name === "deals.json" ? "/api/deals" : name === "referral.json" ? "/api/referral" : name === "referral-special.json" ? "/api/referral-special" : CONFIG.dataBase+name;
  let r;
  try { r=await fetch(url,{cache:"no-store"}); }
  catch (e) {
    if(name === "news.json") return loadStaticNews();
    if(name === "patches.json") return loadStaticPatches();
    throw e;
  }
  if(!r.ok) {
    if(name === "news.json") return loadStaticNews();
    if(name === "patches.json") return loadStaticPatches();
    throw new Error(name+" "+r.status);
  }
  if(name === "news.json" && r.headers?.get("x-verse-radar-news-source") === "static-fallback") usingStaticData = true;
  if(name === "patches.json" && r.headers?.get("x-verse-radar-patches-source") === "static-fallback") usingStaticData = true;
  if((name === "events.json" || name === "freefly.json") && r.headers?.get("x-verse-radar-event-source") === "static-fallback") usingStaticData = true;
  if(name === "deals.json" && r.headers?.get("x-verse-radar-deals-source") === "static-fallback") usingStaticData = true;
  const data=await r.json();
  if(name === "news.json" && !Array.isArray(data)) return loadStaticNews();
  if(name === "patches.json" && !Array.isArray(data)) return loadStaticPatches();
  return data;
}
async function loadStaticNews(){
  usingStaticData = true;
  const r=await fetch(CONFIG.dataBase+"news.json",{cache:"no-store"});
  if(!r.ok) throw new Error("news.json "+r.status);
  const data=await r.json();
  if(!Array.isArray(data)) throw new Error("news.json is not an array");
  return data;
}
async function loadStaticPatches(){
  usingStaticData = true;
  const r=await fetch(CONFIG.dataBase+"patches.json",{cache:"no-store"});
  if(!r.ok) throw new Error("patches.json "+r.status);
  const data=await r.json();
  if(!Array.isArray(data)) throw new Error("patches.json is not an array");
  return data;
}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function dateDE(v){if(!v)return "—"; const d=new Date(v); return Number.isNaN(d.getTime())?esc(v):new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}).format(d);}
function isFuture(v){const d=new Date(v);return !Number.isNaN(d.getTime())&&d.getTime()>Date.now();}
function isOfficialSource(value){try{const u=new URL(value);return u.protocol==="https:"&&["robertsspaceindustries.com","www.robertsspaceindustries.com"].includes(u.hostname);}catch{return false;}}
function validPrice(value){return (typeof value==="number"||typeof value==="string")&&/^\d+(?:\.\d{1,2})?$/.test(String(value))&&Number(value)>0&&Number(value)<100000;}
function isOfficialPackageImage(value){try{const u=new URL(value);return u.protocol==="https:"&&(u.hostname==="robertsspaceindustries.com"||u.hostname.endsWith(".robertsspaceindustries.com"))&&!u.username&&!u.password&&!u.port&&/\.(?:png|jpe?g|webp|avif)$/i.test(u.pathname);}catch{return false;}}
function liveDeals(items,now=Date.now()){
  if(!Array.isArray(items))return [];
  return items.filter(d=>d&&d.active===true&&d.type==="Game Package"&&d.gameAccessConfirmed===true&&d.name&&isOfficialSource(d.sourceUrl)&&/^\/(?:en\/)?pledge\/Packages\/[^/]+\/?$/i.test(new URL(d.sourceUrl).pathname)&&isOfficialPackageImage(d.imageUrl)&&validPrice(d.price)&&typeof d.referralEligible==="boolean"&&["USD","EUR"].includes(d.currency)&&typeof d.contents?.ship==="string"&&d.contents.ship.trim()&&Array.isArray(d.contents?.extras)&&d.contents.extras.length&&d.contents.extras.every(x=>typeof x==="string"&&x.trim())&&Number.isFinite(Date.parse(d.checkedAt))&&Date.parse(d.checkedAt)<=now&&Date.parse(d.checkedAt)>now-7*86400000&&Number.isFinite(Date.parse(d.validUntil))&&Date.parse(d.validUntil)>now&&(!d.oldPrice||validPrice(d.oldPrice)&&Number(d.oldPrice)>Number(d.price)))
    .sort((a,b)=>{
      if(a.referralEligible!==b.referralEligible)return a.referralEligible?-1:1;
      // Preise verschiedener Währungen lassen sich ohne Umrechnung nicht vergleichen.
      if(a.currency!==b.currency)return a.currency==="EUR"?-1:1;
      if(Number(a.price)!==Number(b.price))return Number(a.price)-Number(b.price);
      const discount=d=>d.oldPrice?(Number(d.oldPrice)-Number(d.price))/Number(d.oldPrice):0;
      if(discount(a)!==discount(b))return discount(b)-discount(a);
      return String(a.name).localeCompare(String(b.name),"de-DE");
    });
}
function dealPrice(amount,currency){return new Intl.NumberFormat("de-DE",{style:"currency",currency}).format(Number(amount));}
function dealDiscount(price,oldPrice){if(!validPrice(price)||!validPrice(oldPrice)||Number(oldPrice)<=Number(price))return "";const percent=(1-Number(price)/Number(oldPrice))*100;return percent<0.5?"<1 % Rabatt":`−${Math.round(percent)} % Rabatt`;}
function renderDeals(items){return items.map(d=>`<article class="article"><span class="tag">GAME PACKAGE</span><h2>${esc(d.name)}</h2><figure class="package-image"><img src="${esc(d.imageUrl)}" alt="Bild zu ${esc(d.name)}" loading="lazy" referrerpolicy="no-referrer"><figcaption>Abbildung des Game Packages oder Schiffs von RSI</figcaption></figure><p>${d.oldPrice?`<s>${dealPrice(d.oldPrice,d.currency)}</s> `:""}<strong>${dealPrice(d.price,d.currency)}</strong>${d.oldPrice?` <span class="deal-discount">${dealDiscount(d.price,d.oldPrice)}</span>`:""}</p><p class="ai-note">${d.currency==="EUR"?"Preis inklusive deutscher MwSt. zum Zeitpunkt der Prüfung. In anderen Ländern kann der Preis abweichen.":"Preis laut RSI zum Zeitpunkt der Prüfung. Steuern können je nach Land abweichen."}</p><h3>Im Package enthalten</h3><ul class="package-contents"><li>Schiff: ${esc(d.contents.ship)}</li>${d.contents.extras.map(x=>`<li>${esc(x)}</li>`).join("")}</ul><p class="referral-check${d.referralEligible?"":" referral-no"}">Qualifiziert sich für Referral: <strong>${d.referralEligible?"Ja":"Nein"}</strong></p><p class="ai-note">Manuell eingetragene Einschätzung. Ob ein Kauf als Referral zählt, entscheidet RSI nach den aktuellen Bedingungen.</p>${d.note?`<p class="deal-note">${esc(d.note)}</p>`:""}<p class="ai-note">Zuletzt geprüft: ${dateDE(d.checkedAt)} · ${d.officialEndProvided?"Offizielles Ende laut Eintrag":"Anzeige spätestens bis"}: ${dateDE(d.validUntil)}. Angaben ohne Gewähr; Preis, Lieferumfang und Bedingungen bitte auf der RSI-Shopseite prüfen.</p><p>${sourceLink(d)}</p></article>`).join("")||'<article class="article"><p>Derzeit keine aktuell geprüften Game Packages eingetragen.</p></article>';}
function confirmedTime(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));}
function activeEvents(items,now=Date.now()){
  if(!Array.isArray(items))return [];
  return items.filter(e=>e&&e.name&&e.type!=="Community Event"&&confirmedTime(e.start)&&confirmedTime(e.end)&&Date.parse(e.end)>Date.parse(e.start)&&Date.parse(e.end)>now&&isOfficialSource(e.sourceUrl))
    .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}
function freeFlyState(data,now=Date.now()){
  const confirmed=Boolean(data?.active&&data.title&&confirmedTime(data.start)&&confirmedTime(data.end)&&Date.parse(data.end)>Date.parse(data.start)&&isOfficialSource(data.sourceUrl));
  if(!confirmed||Date.parse(data.end)<=now)return {status:"inactive",title:"Kein Free Fly aktiv",summary:"Derzeit ist kein bestätigter Free Fly eingetragen. Termine und Teilnahmebedingungen findest du bei RSI.",sourceUrl:"https://robertsspaceindustries.com/en/flyfree",dateText:""};
  const range=`${new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",dateStyle:"medium",timeStyle:"short"}).format(new Date(data.start))} – ${new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",dateStyle:"medium",timeStyle:"short"}).format(new Date(data.end))} Uhr`;
  return {status:Date.parse(data.start)<=now?"active":"upcoming",title:data.title,summary:data.summary||"Teilnahme und Bedingungen stehen in der offiziellen Meldung.",sourceUrl:data.sourceUrl,dateText:range};
}
function eventNews(items,now=Date.now()){
  if(!Array.isArray(items))return [];
  return items.filter(n=>["EVENT","FREE FLY"].includes(n.category)&&isOfficialSource(n.sourceUrl)&&Number.isFinite(Date.parse(n.date))&&Date.parse(n.date)<=now&&Date.parse(n.date)>now-90*86400000).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}
function timeDE(v){if(!v)return ""; const d=new Date(v); return Number.isNaN(d.getTime())?"":new Intl.DateTimeFormat("de-DE",{hour:"2-digit",minute:"2-digit"}).format(d);}
function relative(v){const d=new Date(v), diff=Date.now()-d.getTime(); if(Number.isNaN(d.getTime()))return ""; const h=Math.round(diff/36e5); if(h<1)return "gerade eben"; if(h<24)return `vor ${h} Std.`; const days=Math.round(h/24); return days===1?"gestern":`vor ${days} Tagen`;}
function sourceLink(n){return n.sourceUrl?`<a class="source" href="${esc(n.sourceUrl)}" target="_blank" rel="noopener noreferrer">${/https?:\/\/(?:www\.)?starcitizen\.tools\//i.test(n.sourceUrl)?"Community-Archiv":"Originalquelle"} ↗</a>`:"";}
function renderNews(items,limit=3){
  return items.slice(0,limit).map((n,i)=>`<details class="news-card" data-category="${esc(n.category||'NEWS')}"><summary class="news-teaser"><span class="news-art art-${i%4}"><span class="art-signal">${esc((n.category||"NEWS").replace(" / "," · "))}</span></span><span class="news-body"><span class="news-heading"><span class="tag">${esc(n.category||"NEWS")}</span><span class="date" title="${esc(n.date||"")}">${relative(n.date)||dateDE(n.date)}</span></span><span class="news-title">${esc(n.title)}</span><span class="news-toggle news-open">Kurzüberblick anzeigen ↓</span><span class="news-toggle news-close">Schließen ↑</span></span></summary><div class="news-expanded"><p>${esc(n.summary||"Für diesen Artikel liegt noch keine deutsche Kurzbeschreibung vor.")}</p><p class="ai-note">${n.ai === true ? "KI-gestützte Zusammenfassung" : n.summaryBasis === "Titel" ? "Einordnung nur anhand des Titels; keine geprüften Artikeldetails" : n.summaryBasis === "Patch Notes" ? "Aus den Patch Notes" : n.summaryBasis === "Quelltext" ? "Aus dem Artikeltext" : "Kurze Einordnung"} · ${sourceLink(n)}</p></div></details>`).join("");
}
let radarFrameId=null;
function alignRadar(root){
  const panel=root.closest(".radar-panel"),sweep=panel?.querySelector(".sweep");
  if(!panel||!sweep)return;
  if(radarFrameId!==null)cancelAnimationFrame(radarFrameId);
  const bounds=panel.getBoundingClientRect(),centerX=bounds.left+bounds.width/2,centerY=bounds.top+bounds.height/2;
  const contacts=[...root.querySelectorAll(".radar-contact")].map(contact=>{
    const rect=contact.getBoundingClientRect();
    const angle=(Math.atan2(rect.top+rect.height/2-centerY,rect.left+rect.width/2-centerX)*180/Math.PI+360)%360;
    return {contact,angle};
  });
  function scan(){
    // Die sichtbare Nadel selbst bestimmt den Zeitpunkt. Damit läuft kein zweiter Takt vor.
    const transform=getComputedStyle(sweep).transform;
    const matrix=/^matrix\(([^)]+)\)$/.exec(transform);
    if(matrix){
      const [a,b]=matrix[1].split(",").map(Number);
      const beam=(Math.atan2(b,a)*180/Math.PI+360)%360;
      for(const {contact,angle} of contacts){
        const justPassed=(beam-angle+360)%360<14;
        if(contact.classList.contains("is-scanned")!==justPassed)contact.classList.toggle("is-scanned",justPassed);
      }
    }else{
      for(const {contact} of contacts)contact.classList.remove("is-scanned");
    }
    radarFrameId=requestAnimationFrame(scan);
  }
  radarFrameId=requestAnimationFrame(scan);
}
function radarContacts(news,events){
  const root=document.querySelector("#radar-contacts"); if(!root)return;
  const contacts=[...news.slice(0,6).map((n,i)=>({kind:"N",label:n.category||"NEWS",x:[23,67,42,78,31,55][i],y:[28,22,68,56,82,40][i]})),...events.slice(0,4).map((e,i)=>({kind:"E",label:"EVENT",x:[18,73,56,86][i],y:[56,72,36,18][i]}))];
  root.innerHTML=contacts.map((c,i)=>`<button class="radar-contact" style="left:${c.x}%;top:${c.y}%" title="${esc(c.label)}"><span>${c.kind}</span></button>`).join("");
  // Der Zeiger beginnt rechts und dreht sich in sechs Sekunden im Uhrzeigersinn.
  alignRadar(root);
  if(typeof window!=="undefined"){
    let timer;
    window.addEventListener("resize",()=>{clearTimeout(timer);timer=setTimeout(()=>alignRadar(root),150)});
  }
}
function renderStats(news,patches,deals,events){
  const map={"stat-news":news.length,"stat-patches":patches.length,"stat-deals":liveDeals(deals).length,"stat-events":events.length};
  Object.entries(map).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=v;});
}
function renderPatchChanges(changes){
  if(!Array.isArray(changes)||!changes.length)return '<p class="page-intro">Noch keine strukturierte Änderungsliste verfügbar.</p>';
  return `<div class="patch-changes">${changes.map(c=>`<div class="article"><span class="tag">${esc(c.category||"ÄNDERUNG")}</span><h3>${esc(c.title||"")}</h3><p>${esc(c.description||"")}</p></div>`).join("")}</div>`;
}
function renderPatches(items){
  return items.slice(0,5).map(p=>`<article class="article patch-card" id="${encodeURIComponent(p.version)}"><div><span class="tag">${patchIsAnnouncement(p)?"UPDATE-MELDUNG":"PATCH NOTES"}</span><span class="date">${dateDE(p.date)}</span></div><h2>${esc(p.version)}</h2><p class="patch-lead">${esc(p.summary||"")}</p><h3>Wichtige Änderungen in ${esc(p.version)}</h3>${renderPatchChanges(p.changes)}<h3>Deutsche Zusammenfassung ${patchIsAnnouncement(p)?"der Update-Meldung":"der Patch Notes"}</h3><p>${esc(p.fullSummary||"")}</p><p class="ai-note">${p.ai === true ? "KI-gestützte" : "Regelbasierte"} Zusammenfassung · Kein offizieller RSI-Text · ${sourceLink({sourceUrl:p.sourceUrl})}</p></article>`).join("");
}
function patchIsAnnouncement(p){return p.sourceType==="Release Info" || p.sourceType==="RSI Release Info" || p.sourceType==="Content Update" || (p.sourceType!=="Patch Notes" && /\/comm-link\/transmission\//i.test(p.sourceUrl||""));}
function renderPatchHistory(items){
  return items.map((p,i)=>`<article class="article" id="${encodeURIComponent(p.version)}"><span class="tag">${patchIsAnnouncement(p)?"UPDATE-MELDUNG":"PATCH"}</span><span class="date">${dateDE(p.date)}</span><h2>${esc(p.version)}</h2><p>${esc(p.summary||"")}</p>${p.previous?`<p>Vorgängerversion: ${esc(p.previous)}</p>`:""}${i<5?`<p><a class="source" href="/patches.html#${encodeURIComponent(p.version)}">Zusammenfassung und Änderungen ↗</a> · ${sourceLink(p)}</p>`:`<details><summary>Zusammenfassung und Änderungen anzeigen</summary><h3>Wichtige Änderungen in ${esc(p.version)}</h3>${renderPatchChanges(p.changes)}<h3>Deutsche Zusammenfassung ${patchIsAnnouncement(p)?"der Update-Meldung":"der Patch Notes"}</h3><p>${esc(p.fullSummary||"")}</p><p class="ai-note">${p.ai === true ? "KI-gestützte" : "Regelbasierte"} Zusammenfassung · Kein offizieller RSI-Text · ${sourceLink(p)}</p></details>`}</article>`).join("");
}
function eventDateTime(value){return new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",dateStyle:"medium",timeStyle:"short"}).format(new Date(value))+" Uhr";}
function renderConfirmedEvents(items,now=Date.now()){
  return items.map(e=>`<article class="article"><span class="tag">${Date.parse(e.start)<=now?"JETZT AKTIV":"BESTÄTIGT · DEMNÄCHST"}</span><h3>${esc(e.name)}</h3><p>${eventDateTime(e.start)} – ${eventDateTime(e.end)}</p>${e.summary?`<p>${esc(e.summary)}</p>`:""}<p>${sourceLink(e)}</p></article>`).join("")||'<p class="page-intro">Derzeit keine laufenden oder kommenden Termine eingetragen.</p>';
}
function activeActivities(items,now=Date.now()){
  return Array.isArray(items)?items.filter(a=>a?.type==="Ingame Activity"&&a.active===true&&a.name&&isOfficialSource(a.sourceUrl)&&Array.isArray(a.tasks)&&a.tasks.length&&Array.isArray(a.rewards)&&a.rewards.length&&(!a.end||confirmedTime(a.end)&&Date.parse(a.end)>now)&&(!a.start||confirmedTime(a.start))).sort((a,b)=>(Date.parse(b.start)||0)-(Date.parse(a.start)||0)):[];
}
function renderGroupPairs(a){
  const goals=Array.isArray(a.groupGoals)?a.groupGoals:typeof a.groupGoal==="string"&&a.groupGoal?[a.groupGoal]:[];
  const rewards=Array.isArray(a.groupRewards)?a.groupRewards:typeof a.groupReward==="string"&&a.groupReward?[a.groupReward]:[];
  if(!goals.length||goals.length!==rewards.length)return "";
  return "<h4>Gemeinschaftsziele und Belohnungen</h4><ul>"+goals.map((g,i)=>"<li><strong>Ziel:</strong> "+esc(g)+"<br><strong>Belohnung:</strong> "+esc(rewards[i])+"</li>").join("")+"</ul>";
}
function renderActivities(items,limit=items.length){
  return items.slice(0,limit).map(a=>`<article class="article"><span class="tag">OFFIZIELLE INGAME-AKTION</span><h3>${esc(a.name)}</h3>${/^\/activity-image\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(a.imageUrl||"")?`<img class="event-image" src="${esc(a.imageUrl)}" alt="Bild zu ${esc(a.name)}" loading="lazy">`:""}<p>${a.start?`Beginn: ${eventDateTime(a.start)} · `:""}${a.end?`Ende: ${eventDateTime(a.end)}`:"Ende nicht bestätigt – aktuellen Stand bei RSI prüfen"}</p>${a.summary?`<p>${esc(a.summary)}</p>`:""}<h4>Aufgaben</h4><ul>${a.tasks.map(x=>`<li>${esc(x)}</li>`).join("")}</ul><h4>Persönliche Belohnungen</h4><ul>${a.rewards.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>${renderGroupPairs(a)}<p>${sourceLink(a)}</p></article>`).join("")||'<p class="page-intro">Derzeit keine offizielle Ingame-Aktion eingetragen.</p>';
}
function renderEventNews(items){
  return items.slice(0,8).map(n=>`<article class="article"><span class="tag">${esc(n.category)} · MELDUNG VOM ${dateDE(n.date)}</span><h3>${esc(n.title)}</h3><p>${esc(n.summary||"")}</p><p>${sourceLink(n)}</p></article>`).join("")||'<p class="page-intro">Keine aktuellen Event-Meldungen vorhanden.</p>';
}
async function freeFlyPage(){
  const status=document.querySelector("#freefly-page");if(!status)return;
  try{
    const [data,events,news,activities]=await Promise.all(["freefly.json","events.json","news.json","activities.json"].map(loadJSON));
    const fly=freeFlyState(data);
    status.innerHTML=`<article class="article"><span class="tag">${fly.status==="active"?"JETZT AKTIV":fly.status==="upcoming"?"BESTÄTIGT · DEMNÄCHST":"DERZEIT INAKTIV"}</span><h2>${esc(fly.title)}</h2>${fly.dateText?`<p>${esc(fly.dateText)}</p>`:""}<p>${esc(fly.summary)}</p><p>${sourceLink(fly)}</p></article>`;
    document.querySelector("#confirmed-events").innerHTML=renderConfirmedEvents(activeEvents(events));
    document.querySelector("#activities").innerHTML=renderActivities(activeActivities(activities));
    document.querySelector("#event-news").innerHTML=renderEventNews(eventNews(news));
  }catch(e){console.error(e);status.innerHTML='<p class="page-intro">Free-Fly- und Event-Daten konnten nicht geladen werden.</p>';}
}
function setReferral(referral){
  const url=referral?.enabled&&typeof referral.url==="string"&&isOfficialSource(referral.url)&&!referral.url.includes("DEINCODE")?referral.url:null;
  for(const id of ["referral-link","ref-main"]){const link=document.querySelector("#"+id);if(link){link.hidden=!url;if(url)link.href=url;else link.removeAttribute("href");}}
  const info=document.querySelector("#ref-main-status");if(info)info.textContent=url?"Über diesen Link können Vorteile für Verse Radar entstehen.":"Der persönliche Referral-Link ist noch nicht eingerichtet. Informationen zum Programm findest du bei RSI.";
  const dealInfo=document.querySelector("#ref-deals-status");if(dealInfo)dealInfo.textContent=url?"Bei einer Registrierung über diesen Link kann Verse Radar Vorteile erhalten. Für Boni und Bedingungen ist RSI maßgeblich.":"Der Referral-Link ist derzeit nicht verfügbar. Details findest du auf der Referral-Seite.";
}
async function dealsPage(){const target=document.querySelector("#deals");if(!target)return;loadJSON("referral.json").then(setReferral).catch(()=>setReferral(null));try{target.innerHTML=renderDeals(liveDeals(await loadJSON("deals.json")))}catch(e){console.error(e);target.innerHTML='<p class="page-intro">Angebote konnten nicht geladen werden.</p>';}}
function renderReferralSpecial(data,now=Date.now()){
  if(!data || data.active!==true || typeof data.title!=="string" || !data.title.trim() || !isOfficialSource(data.sourceUrl) || data.imageUrl && !isOfficialPackageImage(data.imageUrl) || !confirmedTime(data.start) || !confirmedTime(data.end) || Date.parse(data.start)>now || Date.parse(data.end)<=now || !Array.isArray(data.rewards) || !data.rewards.length || data.rewards.some(x=>typeof x!=="string"||!x.trim()))return "";
  const range=new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",dateStyle:"medium",timeStyle:"short"});
  return `<h2>Zusätzlich während der Referral-Sonderaktion</h2><p><strong>${esc(data.title)}</strong> · ${range.format(new Date(data.start))} bis ${range.format(new Date(data.end))} Uhr</p>${data.imageUrl?`<figure class="referral-special-image"><img src="${esc(data.imageUrl)}" alt="Bild zur Referral-Sonderaktion ${esc(data.title)}" loading="lazy" referrerpolicy="no-referrer"><figcaption>Bild von RSI</figcaption></figure>`:""}<h3>Was erhält der neue Spieler zusätzlich?</h3><ul>${data.rewards.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>${data.note?`<p>${esc(data.note)}</p>`:""}<p>Der Sonderbonus gilt für neu geworbene Spieler. Der Referral-Code muss bei der Kontoerstellung oder innerhalb von 24 Stunden danach eingetragen werden. Wer über ein Game Package teilnehmen möchte, kauft während der Aktion im Pledge Store ein Game Package für mindestens 40 USD. Das Konto darf schon vor der Aktion erstellt worden sein, wenn der Spieler erst während der Aktion als neuer Backer qualifiziert wird. Store Credit und geschenkte Pledges zählen nicht. Maßgeblich sind die Bedingungen der offiziellen Aktionsmeldung.</p><p><a class="source" href="${esc(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">Offizielle Sonderaktion bei RSI ↗</a></p>`;
}
async function referralPage(){
  if(!document.querySelector("#ref-main"))return;
  try{setReferral(await loadJSON("referral.json"))}catch{setReferral(null)}
  const section=document.querySelector("#referral-special");
  if(!section)return;
  try{const html=renderReferralSpecial(await loadJSON("referral-special.json"));section.hidden=!html;if(html)section.innerHTML=html}
  catch{section.hidden=true}
}
async function home(){
  const status=document.querySelector("#data-status");
  try{
    const [news,patches,deals,events,freefly,meta,activities,referral]=await Promise.all([...["news.json","patches.json","deals.json","events.json","freefly.json","meta.json","activities.json"].map(loadJSON),loadJSON("referral.json").catch(()=>({enabled:false}))]);
    setReferral(referral);
    document.querySelector("#top-news").innerHTML=renderNews(news,3);
    document.querySelector("#latest-patches").innerHTML=patches.slice(0,5).map(p=>`<a class="list-row" href="/patches.html#${encodeURIComponent(p.version)}"><span><b>${esc(p.version)}</b><small>${esc(p.summary||"").slice(0,55)}${(p.summary||"").length>55?"…":""}</small></span><span>${dateDE(p.date)}</span></a>`).join("");
    document.querySelector("#latest-deals").innerHTML=liveDeals(deals).slice(0,4).map(d=>`<a class="list-row deal-row" href="/deals.html"><span>${esc(d.name)}</span><strong>${dealPrice(d.price,d.currency)}</strong></a>`).join("") || '<p class="page-intro">Aktuell keine geprüften Angebote.</p>';
    const liveEvents=activeEvents(events); document.querySelector("#events").innerHTML=liveEvents.slice(0,5).map(e=>`<a class="list-row" href="/free-fly.html"><span><b>${esc(e.name)}</b><small>${Date.parse(e.start)<=Date.now()?"JETZT AKTIV":"DEMNÄCHST"}</small></span><span>${Date.parse(e.start)<=Date.now()?"bis "+dateDE(e.end):"ab "+dateDE(e.start)}</span></a>`).join("") || '<p class="page-intro">Keine laufenden oder kommenden Events eingetragen.</p>';
    document.querySelector("#home-activities").innerHTML=renderActivities(activeActivities(activities),2);
    const ff=document.querySelector("#free-fly");
    const fly=freeFlyState(freefly);
    if(fly.status==="active"){ff.classList.remove("hidden");document.querySelector("#freefly-title").textContent=fly.title;document.querySelector("#freefly-dates").textContent=fly.dateText;document.querySelector("#freefly-text").textContent=fly.summary;document.querySelector("#freefly-link").href="/free-fly.html";}
    radarContacts(news,liveEvents); renderStats(news,patches,deals,liveEvents);
    if(status){if(usingStaticData){status.classList.remove("online");status.innerHTML=`<span></span> Letzter gespeicherter News-/Patch-Stand: ${dateDE(meta.updatedAt)} · ${timeDE(meta.updatedAt)} Uhr`;}else{status.classList.add("online");status.innerHTML=`<span></span> Letzter gespeicherter News-/Patch-Stand: ${dateDE(meta.updatedAt)} · ${timeDE(meta.updatedAt)} Uhr <b>● DATENABFRAGE ONLINE</b>`;}}
    const badge=document.querySelector(".demo-badge"); if(badge)badge.textContent=`VERSION ${CONFIG.siteVersion} · LIVE PIPELINE`;
  }catch(e){console.error(e);if(status)status.innerHTML='<span></span> Lokaler Datenstand · Automatische Aktualisierung noch nicht verbunden';}
}
async function listing(){
  const target=document.querySelector("#all-news"); if(!target)return;
  try{
    const news=await loadJSON("news.json");
    const search=document.querySelector("#news-search"), filter=document.querySelector("#news-filter");
    const draw=()=>{const q=(search?.value||"").toLowerCase().trim(), f=filter?.value||"ALL"; const list=news.filter(n=>(f==="ALL"||n.category===f)&&(!q||`${n.title} ${n.summary}`.toLowerCase().includes(q))); target.innerHTML=list.length?renderNews(list,list.length):'<div class="empty-state">Keine Meldungen gefunden.</div>'; const c=document.querySelector("#result-count");if(c)c.textContent=`${list.length} Meldungen`;};
    search?.addEventListener("input",draw);filter?.addEventListener("change",draw);draw();
  }catch(e){target.innerHTML='<div class="empty-state">News konnten nicht geladen werden.</div>';}
}
function setupMenu(){document.querySelector(".menu-toggle")?.addEventListener("click",()=>document.querySelector(".site-header").classList.toggle("menu-open"));}
function countPageView(){
  if(["localhost","127.0.0.1"].includes(location.hostname)||navigator.doNotTrack==="1"||navigator.globalPrivacyControl===true)return;
  fetch("/api/page-view",{method:"POST",body:"",keepalive:true,cache:"no-store"}).catch(()=>{});
}
document.addEventListener("DOMContentLoaded",()=>{setupMenu();countPageView();if(location.pathname.endsWith("/")||location.pathname.endsWith("index.html"))home(); listing(); freeFlyPage(); dealsPage(); referralPage();});
