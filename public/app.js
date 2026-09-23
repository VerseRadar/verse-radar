const CONFIG = {
  referralUrl: "https://robertsspaceindustries.com/enlist?referral=DEINCODE",
  dataBase: "/data/",
  siteVersion: "0.5"
};

async function loadJSON(name){
  const r=await fetch(CONFIG.dataBase+name,{cache:"no-store"});
  if(!r.ok) throw new Error(name+" "+r.status);
  return r.json();
}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function dateDE(v){if(!v)return "—"; const d=new Date(v); return Number.isNaN(d.getTime())?esc(v):new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}).format(d);}
function isFuture(v){const d=new Date(v);return !Number.isNaN(d.getTime())&&d.getTime()>Date.now();}
function activeEvents(items){return items.filter(e=>!e.end||new Date(e.end).getTime()>=Date.now()).sort((a,b)=>new Date(a.start||a.date)-new Date(b.start||b.date));}
function timeDE(v){if(!v)return ""; const d=new Date(v); return Number.isNaN(d.getTime())?"":new Intl.DateTimeFormat("de-DE",{hour:"2-digit",minute:"2-digit"}).format(d);}
function relative(v){const d=new Date(v), diff=Date.now()-d.getTime(); if(Number.isNaN(d.getTime()))return ""; const h=Math.round(diff/36e5); if(h<1)return "gerade eben"; if(h<24)return `vor ${h} Std.`; const days=Math.round(h/24); return days===1?"gestern":`vor ${days} Tagen`;}
function sourceLink(n){return n.sourceUrl?`<a class="source" href="${esc(n.sourceUrl)}" target="_blank" rel="noopener noreferrer">Originalquelle ↗</a>`:"";}
function renderNews(items,limit=3){
  return items.slice(0,limit).map((n,i)=>`<article class="news-card" data-category="${esc(n.category||'NEWS')}"><div class="news-art art-${i%4}"><span class="art-signal">${esc((n.category||"NEWS").replace(" / "," · "))}</span></div><div class="news-body"><div><span class="tag">${esc(n.category||"NEWS")}</span><span class="date" title="${esc(n.date||"")}">${relative(n.date)||dateDE(n.date)}</span></div><h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p><p class="ai-note">KI-übersetzt & zusammengefasst · ${sourceLink(n)}</p></div></article>`).join("");
}
function radarContacts(news,events){
  const root=document.querySelector("#radar-contacts"); if(!root)return;
  const contacts=[...news.slice(0,6).map((n,i)=>({kind:"N",label:n.category||"NEWS",x:[23,67,42,78,31][i],y:[28,22,68,56,82][i]})),...events.slice(0,4).map((e,i)=>({kind:"E",label:"EVENT",x:[18,73,56][i],y:[56,72,36][i]}))];
  root.innerHTML=contacts.map((c,i)=>`<button class="radar-contact rc${i}" style="left:${c.x}%;top:${c.y}%" title="${esc(c.label)}"><span>${c.kind}</span></button>`).join("");
  const count=document.querySelector("#radar-count"); if(count)count.textContent=`${contacts.length} Kontakte`;
}
function renderStats(news,patches,deals,events){
  const map={"stat-news":news.length,"stat-patches":patches.length,"stat-deals":deals.filter(d=>d.active).length,"stat-events":events.length};
  Object.entries(map).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=v;});
}
async function home(){
  document.querySelectorAll("#referral-link").forEach(a=>a.href=CONFIG.referralUrl);
  const status=document.querySelector("#data-status");
  try{
    const [news,patches,deals,events,freefly,meta]=await Promise.all(["news.json","patches.json","deals.json","events.json","freefly.json","meta.json"].map(loadJSON));
    document.querySelector("#top-news").innerHTML=renderNews(news,3);
    document.querySelector("#latest-patches").innerHTML=patches.slice(0,5).map(p=>`<a class="list-row" href="/patches.html#${encodeURIComponent(p.version)}"><span><b>${esc(p.version)}</b><small>${esc(p.summary||"").slice(0,55)}${(p.summary||"").length>55?"…":""}</small></span><span>${dateDE(p.date)}</span></a>`).join("");
    document.querySelector("#latest-deals").innerHTML=deals.filter(d=>d.active).slice(0,4).map(d=>`<a class="list-row deal-row" href="${esc(d.url||"/deals.html")}" ${d.url?.startsWith("http")?'target="_blank" rel="noopener"':''}><span>${esc(d.name)}</span><strong>${esc(d.price||"Angebot")}</strong></a>`).join("") || '<p class="page-intro">Aktuell keine bekannten Angebote.</p>';
    const liveEvents=activeEvents(events); document.querySelector("#events").innerHTML=liveEvents.slice(0,5).map(e=>`<div class="list-row"><span><b>${esc(e.name)}</b><small>${esc(e.type||"Event")}</small></span><span>${esc(e.dateText||dateDE(e.start))}</span></div>`).join("");
    const ff=document.querySelector("#free-fly");
    if(freefly.active){ff.classList.remove("hidden");document.querySelector("#freefly-title").textContent=freefly.title;document.querySelector("#freefly-dates").textContent=freefly.dateText;document.querySelector("#freefly-text").textContent=freefly.summary;document.querySelector("#freefly-link").href=freefly.pageUrl;}
    radarContacts(news,liveEvents); renderStats(news,patches,deals,liveEvents);
    if(status){status.classList.add("online");status.innerHTML=`<span></span> Datenstand: ${dateDE(meta.updatedAt)} · ${timeDE(meta.updatedAt)} Uhr <b>● ONLINE</b>`;}
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
document.addEventListener("DOMContentLoaded",()=>{setupMenu(); if(location.pathname.endsWith("/")||location.pathname.endsWith("index.html"))home(); listing();});
