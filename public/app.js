const map = L.map('map', { zoomControl: false }).setView([43.35, 6.2], 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);

const layer = L.layerGroup().addTo(map);

const sel = document.getElementById("filter");
const info = document.getElementById("info");
const modeSel = document.getElementById("mode");

// ✅ nouveaux selects temps
const yearSel = document.getElementById("year");
const periodTypeSel = document.getElementById("periodType");
const periodValueSel = document.getElementById("periodValue");

const csvFile = document.getElementById("csvFile");
const applyCsv = document.getElementById("applyCsv");
const csvStatus = document.getElementById("csvStatus");

const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_apoBZZyaQ7hVW2pT6xJlfkHWEr2rlHoeRGZsjty9wftpXYQCt-GXdeYd18gVVsdKh2FZtvnkZbgx/pub?gid=1819733423&single=true&output=csv";

let DATA = null;      // {categories, rows}
let EPCI_GEO = null;
let ROWS_WITH_EPCI = null;

const COL_TS   = "Horodateur";
const COL_COMMUNE = "Commune du domicile"; // Le nouveau CSV utilise la commune sans espace final grâce au trim()
const COL_DATE = "Date de survenue de la rupture (indiquez la date de l'évènement ou le 1er du mois concerné)";
const COL_ORIG = "Selon vous, qu'est ce qui est à l'origine de la situation ?";

// -------------------------
// Helpers UI
// -------------------------
function setOptions(selectEl, options, { placeholder = null } = {}) {
  selectEl.innerHTML = "";
  if (placeholder) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = placeholder;
    selectEl.appendChild(o);
  }
  options.forEach(({ value, label }) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    selectEl.appendChild(o);
  });
}

function setCategoryOptions(categories){
  sel.innerHTML = "";
  categories.forEach(c => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = (c === "TOTAL") ? "Total (toutes difficultés)" : c;
    sel.appendChild(o);
  });
}

// -------------------------
// Parsing date
// -------------------------
// On essaye d'être robuste si tu as des formats type:
// - "2026-01-14" (ISO)
// - "14/01/2026"
// - "14/01/2026 10:32:11"
// - "2026-01-14T10:32:11.000Z"
function parseToDate(dateStr){
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;

  // ISO direct
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;

  // FR dd/mm/yyyy (avec ou sans heure)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m){
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10) - 1;
    const yy = parseInt(m[3], 10);
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mi = m[5] ? parseInt(m[5], 10) : 0;
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    const d = new Date(yy, mm, dd, hh, mi, ss);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function yearOfRow(r){
  const d = parseToDate(r.date);
  return d ? d.getFullYear() : null;
}

function monthOfRow(r){
  const d = parseToDate(r.date);
  return d ? (d.getMonth() + 1) : null; // 1..12
}

function quarterFromMonth(m){ // m 1..12
  return Math.floor((m - 1) / 3) + 1; // 1..4
}

function semesterFromMonth(m){
  return (m <= 6) ? 1 : 2;
}

// -------------------------
// Time filter logic
// -------------------------
function buildTimeUI(rows){
  // Années dispo
  const years = Array.from(new Set(rows.map(yearOfRow).filter(Boolean))).sort((a,b)=>a-b);

  // Année: "ALL" + liste
  setOptions(yearSel, [
    { value: "ALL", label: "Toutes années" },
    ...years.map(y => ({ value: String(y), label: String(y) }))
  ]);

  yearSel.value = "ALL";

  // Période type : par défaut tout
  setOptions(periodTypeSel, [
    { value: "ALL", label: "Toute l’année" },
    { value: "SEMESTER", label: "Semestre" },
    { value: "QUARTER", label: "Trimestre" },
    { value: "MONTH", label: "Mois" }
  ]);
  periodTypeSel.value = "ALL";

  // Période value vide au départ
  setOptions(periodValueSel, [{ value: "ALL", label: "—" }]);
  periodValueSel.value = "ALL";

  syncPeriodUIState();
}

function syncPeriodUIState(){
  const y = yearSel.value;

  if (y === "ALL"){
    periodTypeSel.disabled = true;
    periodValueSel.disabled = true;
    periodTypeSel.value = "ALL";
    setOptions(periodValueSel, [{ value: "ALL", label: "—" }]);
    periodValueSel.value = "ALL";
    return;
  }

  periodTypeSel.disabled = false;

  // si "ALL" => pas de choix de période
  if (periodTypeSel.value === "ALL"){
    periodValueSel.disabled = true;
    setOptions(periodValueSel, [{ value: "ALL", label: "—" }]);
    periodValueSel.value = "ALL";
    return;
  }

  periodValueSel.disabled = false;

  if (periodTypeSel.value === "SEMESTER"){
    setOptions(periodValueSel, [
      { value: "1", label: "Semestre 1 (Jan–Juin)" },
      { value: "2", label: "Semestre 2 (Juil–Déc)" }
    ]);
    periodValueSel.value = "1";
  }

  if (periodTypeSel.value === "QUARTER"){
    setOptions(periodValueSel, [
      { value: "1", label: "Trimestre 1 (Jan–Mar)" },
      { value: "2", label: "Trimestre 2 (Avr–Juin)" },
      { value: "3", label: "Trimestre 3 (Juil–Sep)" },
      { value: "4", label: "Trimestre 4 (Oct–Déc)" }
    ]);
    periodValueSel.value = "1";
  }

  if (periodTypeSel.value === "MONTH"){
    setOptions(periodValueSel, [
      { value: "1", label: "Janvier" },
      { value: "2", label: "Février" },
      { value: "3", label: "Mars" },
      { value: "4", label: "Avril" },
      { value: "5", label: "Mai" },
      { value: "6", label: "Juin" },
      { value: "7", label: "Juillet" },
      { value: "8", label: "Août" },
      { value: "9", label: "Septembre" },
      { value: "10", label: "Octobre" },
      { value: "11", label: "Novembre" },
      { value: "12", label: "Décembre" }
    ]);
    periodValueSel.value = "1";
  }
}

function filterRowsByTime(rows){
  const y = yearSel.value;

  // toutes années => pas de filtrage temps
  if (y === "ALL") return rows;

  const year = parseInt(y, 10);
  let out = rows.filter(r => yearOfRow(r) === year);

  const type = periodTypeSel.value;
  if (type === "ALL") return out;

  const pv = parseInt(periodValueSel.value, 10);

  if (type === "SEMESTER"){
    out = out.filter(r => {
      const m = monthOfRow(r);
      return m && semesterFromMonth(m) === pv;
    });
  }

  if (type === "QUARTER"){
    out = out.filter(r => {
      const m = monthOfRow(r);
      return m && quarterFromMonth(m) === pv;
    });
  }

  if (type === "MONTH"){
    out = out.filter(r => monthOfRow(r) === pv);
  }

  return out;
}

// -------------------------
// Aggregation (commune / EPCI)
// ------------------------
function normStr(v){
  return String(v ?? "").trim().replace(/\s+/g, " ").normalize("NFKC");
}

function matchesCategory(row, category){
  if (category === "TOTAL") return true;
  const target = normStr(category);
  const arr = Array.isArray(row.origins) ? row.origins : [];
  return arr.some(o => normStr(o) === target);
}

function aggregateByCommune(rows, category){
  const byKey = new Map();

  rows.forEach(r => {
    if (!matchesCategory(r, category)) return;

    const key = `${r.cp}__${r.label}`;
    if (!byKey.has(key)){
      byKey.set(key, {
        cp: r.cp,
        label: r.label,
        lat: r.lat,
        lng: r.lng,
        value: 0
      });
    }
    byKey.get(key).value += 1;
  });

  return Array.from(byKey.values()).filter(x => x.value > 0);
}

function aggregateByEPCI(rowsWithEpci, category){
  const byEPCI = new Map();

  rowsWithEpci.forEach(r => {
    if (!matchesCategory(r, category)) return;

    const key = r.epciCode;
    if (!byEPCI.has(key)){
      byEPCI.set(key, { epciCode: key, epciName: r.epciName, total: 0 });
    }
    byEPCI.get(key).total += 1;
  });

  return Array.from(byEPCI.values()).filter(x => x.total > 0);
}

// -------------------------
// Render
// -------------------------
function bubbleIconCommune(value){
  // Taille dynamique selon le nombre de cas
  const size = Math.min(80, 25 + (value * 3)); 
  const radius = size / 2;
  return L.divIcon({
    className: "",
    html: `<div class="bubble" style="width:${size}px; height:${size}px; font-size:${Math.max(12, size/2.5)}px;">${value}</div>`,
    iconSize: [size, size],
    iconAnchor: [radius, radius]
  });
}

function bubbleIconEPCI(value){
  // Taille dynamique EPCI
  const size = Math.min(100, 35 + (value * 3)); 
  const radius = size / 2;
  return L.divIcon({
    className: "",
    html: `<div class="bubble-epci" style="width:${size}px; height:${size}px; font-size:${Math.max(14, size/3)}px;">${value}</div>`,
    iconSize: [size, size],
    iconAnchor: [radius, radius]
  });
}

function render(){
  layer.clearLayers();

  const category = sel.value;
  const mode = modeSel.value;

  // texte période
  const timeLabel = (() => {
    const y = yearSel.value;
    if (y === "ALL") return "Toutes années";
    if (periodTypeSel.value === "ALL") return `Année ${y}`;
    const pv = periodValueSel.options[periodValueSel.selectedIndex]?.textContent || "";
    return `${y} – ${pv}`;
  })();

  // Filtrage temps
  const rowsTime = filterRowsByTime(DATA.rows);

  if (mode === "commune"){
    const points = aggregateByCommune(rowsTime, category);

    info.textContent = `${points.length} points (communes) — ${timeLabel} — filtre: ${category}`;
    points.forEach(p => {
      L.marker([p.lat, p.lng], { icon: bubbleIconCommune(p.value) })
        .addTo(layer)
        .bindPopup(
          `<b>${p.label}</b><br>` +
          `CP: ${p.cp}<br>` +
          `Période: ${timeLabel}<br>` +
          `Filtre: ${category}<br>` +
          `<b>${p.value}</b> cas`
        );
    });

    return;
  }

  // mode EPCI
  if (mode === "epci" && (!EPCI_GEO || !ROWS_WITH_EPCI)){
    info.textContent = "Chargement des EPCI…";
    return;
  }

  const rowsWithEpciTime = filterRowsByTime(ROWS_WITH_EPCI);
  const epciItems = aggregateByEPCI(rowsWithEpciTime, category);

  info.textContent = `${epciItems.length} points (EPCI) — ${timeLabel} — filtre: ${category}`;

  epciItems.forEach(item => {
    const center = getEPCICenter(item.epciCode);
    if (!center) return;

    L.marker([center.lat, center.lng], { icon: bubbleIconEPCI(item.total) })
      .addTo(layer)
      .bindPopup(
        `<b>${item.epciName}</b><br>` +
        `Code: ${item.epciCode}<br>` +
        `Période: ${timeLabel}<br>` +
        `Filtre: ${category}<br>` +
        `<b>${item.total}</b> cas (somme réponses)`
      );
  });
}

// -------------------------
// EPCI geometry / center
// -------------------------
function normalizeGeometry(geometry){
  if (!geometry) return null;
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") return geometry;

  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    return geometry.geometries.find(g => g.type === "Polygon" || g.type === "MultiPolygon") || null;
  }
  return null;
}

function getEPCICenter(epciCode){
  const f = EPCI_GEO.features.find(ft => String(ft.properties?.EPCI_CODE) === String(epciCode));
  if (!f) return null;

  const geom = normalizeGeometry(f.geometry);
  if (!geom) return null;

  try {
    const c = turf.centroid(turf.feature(geom));
    const [lng, lat] = c.geometry.coordinates;
    return { lat, lng };
  } catch(e) {
    const lyr = L.geoJSON({ type: "Feature", geometry: geom });
    const center = lyr.getBounds().getCenter();
    return { lat: center.lat, lng: center.lng };
  }
}

function colorForEPCI(code){
  const palette = [
    "#d1dff2", "#d9f0f7", "#fde8b8", "#f9d1ca", 
    "#ebf2fb", "#c5e6f1", "#fae3ac"
  ];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function attachEPCIToRows(rows, epciGeo){
  const features = epciGeo.features;

  return rows.map(r => {
    const pt = turf.point([r.lng, r.lat]);

    let found = null;
    for (const f of features) {
      const geom = normalizeGeometry(f.geometry);
      if (!geom) continue;

      const polyFeat = turf.feature(geom, f.properties);
      if (turf.booleanPointInPolygon(pt, polyFeat)) {
        found = f.properties;
        break;
      }
    }

    return {
      ...r,
      epciCode: (found?.EPCI_CODE ?? "UNKNOWN").toString(),
      epciName: (found?.EPCI ?? "EPCI inconnu").toString()
    };
  });
}

// -------------------------
// Load Google Sheet en direct
// -------------------------
async function loadLiveGoogleSheet() {
  try {
    info.textContent = "Téléchargement des données en direct...";
    
    // 1. On charge d'abord le dictionnaire des communes
    const cpGeo = await loadCpGeo();
    
    // 2. On va chercher le CSV en direct depuis Google Sheets
    const response = await fetch(GOOGLE_SHEET_CSV_URL);
    const csvText = await response.text();
    
    // 3. On utilise tes fonctions existantes pour parser !
    const table = parseCSV(csvText);
    const objs = toObjects(table);
    
    // 4. On construit les lignes utilisables par la carte
    const built = buildRowsFromGoogleForms(objs, cpGeo);
    DATA = built;
    
    // 5. On met à jour l'interface (Filtres, Temps...)
    setCategoryOptions(DATA.categories);
    sel.value = "TOTAL";
    buildTimeUI(DATA.rows);
    
    // 6. On attache les EPCI si la couche est déjà chargée
    if (EPCI_GEO) {
      ROWS_WITH_EPCI = attachEPCIToRows(DATA.rows, EPCI_GEO);
    }
    
    render(); // On affiche la carte
  } catch (error) {
    console.error("Erreur lors de la récupération des données :", error);
    info.textContent = "Erreur : " + error.message;
  }
}
// La fonction loadLiveGoogleSheet() sera appelée tout à la fin du fichier !
// -------------------------
// Load EPCI geojson
// -------------------------
fetch("./EPCI_2025.geojson")
  .then(r => r.json())
  .then(geo => {
    EPCI_GEO = geo;

    L.geoJSON(geo, {
      style: (feature) => {
        const code = String(feature.properties?.EPCI_CODE ?? "UNKNOWN");
        return {
          color: "#1f3b63",
          weight: 2,
          dashArray: "4 3",
          fillColor: colorForEPCI(code),
          fillOpacity: 0.55
        };
      },
      onEachFeature: (feature, layer) => {
        const name = feature.properties?.EPCI ?? "EPCI";
        const code = feature.properties?.EPCI_CODE ?? "";
        layer.bindTooltip(`${name} (${code})`, { sticky: true });
      }
    }).addTo(map);

    if (DATA && !ROWS_WITH_EPCI){
      ROWS_WITH_EPCI = attachEPCIToRows(DATA.rows, EPCI_GEO);
      render();
    }
  });

// -------------------------
// Events
// -------------------------
modeSel.addEventListener("change", render);
sel.addEventListener("change", render);

yearSel.addEventListener("change", () => {
  syncPeriodUIState();
  render();
});

periodTypeSel.addEventListener("change", () => {
  syncPeriodUIState();
  render();
});

periodValueSel.addEventListener("change", render);

//---------------------------------------
//   Load CSV
//---------------------------------------
// Gère les virgules et champs
function parseCSV(text){
  //Gérer les virgules et espaces 
  const rows = [];
  let i = 0, field = "", row = [];
  let inQuotes = false;

  while (i < text.length){
    const c = text[i];

    if (inQuotes){
      if (c === '"'){
        if (text[i+1] === '"'){ // escape ""
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += c;
        i++;
        continue;
      }
    } else {
      if (c === '"'){
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ","){
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\r"){
        i++; // ignore
        continue;
      }
      if (c === "\n"){
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }

  // dernier champ
  row.push(field);
  rows.push(row);

  return rows;

}

function toObjects(table){
  const header = table[0].map(h => String(h ?? "").trim());
  const out = [];
  for (let r = 1; r < table.length; r++){
    if (table[r].length === 1 && String(table[r][0] ?? "").trim() === "") continue;
    const obj = {};
    for (let c = 0; c < header.length; c++){
      obj[header[c]] = table[r][c] ?? "";
    }
    out.push(obj);
  }
  return out;
}

// Parse date et split multi et extraire les CP
function extractCP(v){
  const m = String(v ?? "").match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

function splitMulti(v){
  if (!v) return [];
  return String(v)
    .split(/\n|;|,/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function parseToISODate(dateStr){
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;

  // ISO direct
  const d1 = new Date(s);
  if (!isNaN(d1.getTime())) return d1.toISOString().slice(0,10);

  // FR dd/mm/yyyy (avec ou sans heure)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m){
    const dd = parseInt(m[1],10);
    const mm = parseInt(m[2],10)-1;
    const yy = parseInt(m[3],10);
    const d = new Date(yy, mm, dd);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  }
  return null;
}

function normalizeName(str) {
  return String(str ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/[-']/g, " ");
}

//Charger var_communes
let CP_GEO = null;
async function loadCpGeo(){
  if (CP_GEO) return CP_GEO;
  const res = await fetch("./var_communes.csv");
  const text = await res.text();
  const table = parseCSV(text);
  const objs = toObjects(table);

  const map = {};
  objs.forEach(o => {
    const cp = String(o.CP ?? "").trim();
    if (!cp) return;
    const lat = parseFloat(String(o.LAT).replace(",", "."));
    const lng = parseFloat(String(o.LNG).replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lng)){
      const label = o.LABEL || cp;
      // On indexe par le nom normalisé de la commune au lieu du code postal seul
      map[normalizeName(label)] = { cp, lat, lng, label };
    }
  });
  CP_GEO = map;
  return CP_GEO;
}

//construire rows depuis le google sheet

function buildRowsFromGoogleForms(objs, cpGeo){
  const rows = [];
  const catsSet = new Set();

  for (const o of objs){
    // Le nouveau CSV donne la commune, pas le CP
    const communeName = String(o[COL_COMMUNE] ?? "").trim();
    if (!communeName) continue;
    
    // On cherche dans notre dictionnaire via le nom normalisé
    const geo = cpGeo[normalizeName(communeName)];
    if (!geo) {
      console.warn("Commune non trouvée dans le référentiel :", communeName);
      continue;
    }

    const date = parseToISODate(o[COL_DATE]);
    if (!date) continue;

    const origins = splitMulti(o[COL_ORIG]);
    origins.forEach(x => catsSet.add(x));

    rows.push({
      // tu peux garder l'horodateur pour dédoublonner (vide si absent)
      ts: String(o[COL_TS] ?? "").trim(),
      date,
      cp: geo.cp, // On récupère le CP via le référentiel
      label: geo.label,
      lat: geo.lat,
      lng: geo.lng,
      origins
    });
  }

  return { rows, categories: ["TOTAL", ...Array.from(catsSet).sort()] };
}

//Merge sans doublons

function rowKey(r){
  // clé de dédoublonnage (adaptable)
  // horodateur est idéal s'il est toujours unique
  const origins = Array.isArray(r.origins) ? r.origins.slice().sort().join("|") : "";
  return [r.ts || "", r.date || "", r.cp || "", origins].join("::");
}

function mergeRows(existing, incoming){
  const seen = new Set(existing.map(rowKey));
  const out = existing.slice();

  let added = 0;
  for (const r of incoming){
    const k = rowKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    added++;
  }
  return { rows: out, added };
}

function rebuildCategoriesFromRows(rows){
  const set = new Set();
  rows.forEach(r => (Array.isArray(r.origins) ? r.origins : []).forEach(x => set.add(x)));
  return ["TOTAL", ...Array.from(set).sort()];
}

// btn charger le csv 

if (applyCsv) {
  applyCsv.addEventListener("click", async () => {
    if (!csvFile.files || !csvFile.files[0]){
      csvStatus.textContent = "Choisis un fichier CSV.";
      return;
    }

    csvStatus.textContent = "Lecture du CSV…";

    const cpGeo = await loadCpGeo();

    const file = csvFile.files[0];
    const text = await file.text();

    const table = parseCSV(text);
    const objs = toObjects(table);

    const built = buildRowsFromGoogleForms(objs, cpGeo);

    // DATA doit exister (sinon on initialise)
    if (!DATA) DATA = { categories: ["TOTAL"], rows: [] };

    const merged = mergeRows(DATA.rows, built.rows);
    DATA.rows = merged.rows;
    DATA.categories = rebuildCategoriesFromRows(DATA.rows);

    // reset options filtre catégories
    setCategoryOptions(DATA.categories);
    sel.value = "TOTAL";

    // si EPCI déjà chargé : on ré-attache
    if (EPCI_GEO){
      ROWS_WITH_EPCI = attachEPCIToRows(DATA.rows, EPCI_GEO);
    }

    csvStatus.textContent = `OK: ${built.rows.length} lignes lues, +${merged.added} ajoutées (total ${DATA.rows.length}).`;
    render();
  });
}

// On lance le téléchargement au démarrage maintenant que tout est initialisé !
loadLiveGoogleSheet();