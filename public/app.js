const map = L.map('map').setView([43.35, 6.2], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);

const layer = L.layerGroup().addTo(map);

const sel = document.getElementById("filter");
const info = document.getElementById("info");
const modeSel = document.getElementById("mode");

// ✅ nouveaux selects temps
const yearSel = document.getElementById("year");
const periodTypeSel = document.getElementById("periodType");
const periodValueSel = document.getElementById("periodValue");

let DATA = null;      // {categories, rows}
let EPCI_GEO = null;
let ROWS_WITH_EPCI = null;

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
  return L.divIcon({
    className: "",
    html: `<div class="bubble">${value}</div>`,
    iconSize: [42,42],
    iconAnchor: [21,21]
  });
}

function bubbleIconEPCI(value){
  return L.divIcon({
    className: "",
    html: `<div class="bubble-epci">${value}</div>`,
    iconSize: [60,60],
    iconAnchor: [30,30]
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
    "#b7e3f5","#bfe7c2","#f6e1a6","#cbb7f0",
    "#f2b7c8","#b9d5ff","#c8f2e7","#d7f1b6"
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
// Load data.json
// -------------------------
fetch("./data.json")
  .then(r => r.json())
  .then(json => {
    DATA = json;

    // ✅ Categories (filtre “origine”)
    setCategoryOptions(DATA.categories);
    sel.value = "TOTAL";

    // ✅ UI temps
    buildTimeUI(DATA.rows);

    // si EPCI déjà chargé, on enrichit
    if (EPCI_GEO) {
      ROWS_WITH_EPCI = attachEPCIToRows(DATA.rows, EPCI_GEO);
    }

    render();
  });

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