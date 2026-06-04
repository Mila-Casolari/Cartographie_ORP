const map = L.map('map', { zoomControl: false }).setView([43.35, 6.2], 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);

const layer = L.layerGroup().addTo(map);

//const sel = document.getElementById("filter");
let selectedCategories = ["TOTAL"];
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
const COL_DETAIL = "Détail de la difficulté"

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

// function setCategoryOptions(categories){
//   sel.innerHTML = "";
//   categories.forEach(c => {
//     const o = document.createElement("option");
//     o.value = c;
//     o.textContent = (c === "TOTAL") ? "Total (toutes difficultés)" : c;
//     sel.appendChild(o);
//   });
// }

function setCategoryOptions(categories) {
  const container = document.getElementById("custom-options-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  categories.forEach(c => {
    const optionDiv = document.createElement("div");
    optionDiv.className = "custom-option";
    
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = c;
    checkbox.id = `chk-${c.replace(/[^a-zA-Z0-9]/g, "-")}`;
    checkbox.checked = selectedCategories.includes(c);
    
    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = (c === "TOTAL") ? "Total (toutes difficultés)" : c;
    
    optionDiv.appendChild(checkbox);
    optionDiv.appendChild(label);
    container.appendChild(optionDiv);
    
    // Événement quand on clique sur une difficulté
    checkbox.addEventListener("change", () => {
      handleCategorySelectionChange(c, checkbox.checked, categories);
    });
  });
  
  updateSelectTriggerText();
}

function handleCategorySelectionChange(category, isChecked, allCategories) {
  if (category === "TOTAL") {
    if (isChecked) {
      selectedCategories = ["TOTAL"];
    } else {
      selectedCategories = ["TOTAL"];
    }
  } else {
    if (isChecked) {
      selectedCategories = selectedCategories.filter(c => c !== "TOTAL");
      selectedCategories.push(category);
    } else {
      selectedCategories = selectedCategories.filter(c => c !== category);
      if (selectedCategories.length === 0) {
        selectedCategories = ["TOTAL"];
      }
    }
  }
  
  // Synchroniser l'état coché de toutes les cases graphiquement
  const checkboxes = document.querySelectorAll("#custom-options-container input[type='checkbox']");
  checkboxes.forEach(chk => {
    chk.checked = selectedCategories.includes(chk.value);
  });
  
  updateSelectTriggerText();
  render(); // Mettre à jour la carte immédiatement !
}

function updateSelectTriggerText() {
  const triggerSpan = document.querySelector("#select-trigger span");
  if (!triggerSpan) return;
  
  if (selectedCategories.includes("TOTAL")) {
    triggerSpan.textContent = "Total (toutes difficultés)";
  } else {
    if (selectedCategories.length === 1) {
      triggerSpan.textContent = selectedCategories[0];
    } else {
      triggerSpan.textContent = `${selectedCategories.length} difficultés sélectionnées`;
    }
  }
}

// Ouvrir/fermer le menu au clic sur le déclencheur
document.getElementById("select-trigger")?.addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("custom-options-container")?.classList.toggle("show");
});

// Fermer le menu si on clique en dehors
document.addEventListener("click", () => {
  document.getElementById("custom-options-container")?.classList.remove("show");
});

// Empêcher la fermeture si on clique à l'intérieur du menu d'options
document.getElementById("custom-options-container")?.addEventListener("click", (e) => {
  e.stopPropagation();
});

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
  // 1. Tester le format français dd/mm/yyyy (avec ou sans heure) EN PREMIER
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m){
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10) - 1; // En JS, les mois vont de 0 à 11
    const yy = parseInt(m[3], 10);
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mi = m[5] ? parseInt(m[5], 10) : 0;
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    const d = new Date(yy, mm, dd, hh, mi, ss);
    return isNaN(d.getTime()) ? null : d;
  }
  // 2. Fallback sur le format ISO direct (si la date vient d'une autre source)
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;
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

function matchesCategory(row, categories){
  const catArray = Array.isArray(categories) ? categories : [categories];
  if (!catArray || catArray.length === 0 || catArray.includes("TOTAL")) {
    return true;
  }
  
  const rowOrigins = Array.isArray(row.origins) ? row.origins.map(normStr) : [];
  
  // Renvoie vrai si au moins une des difficultés est partagée
  return catArray.some(cat => {
    const target = normStr(cat);
    return rowOrigins.some(o => o === target);
  });
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
  const mode = modeSel.value;
  // Texte d'affichage de la période
  const timeLabel = (() => {
    const y = yearSel.value;
    if (y === "ALL") return "Toutes années";
    if (periodTypeSel.value === "ALL") return `Année ${y}`;
    const pv = periodValueSel.options[periodValueSel.selectedIndex]?.textContent || "";
    return `${y} – ${pv}`;
  })();
  // Filtrage temporel initial
  const rowsTime = filterRowsByTime(DATA.rows);
  // Libellé textuel simplifié du filtre actif pour le badge d'info
  const filterText = selectedCategories.includes("TOTAL") 
    ? "Toutes" 
    : (selectedCategories.length > 2 
        ? `${selectedCategories.length} diff.` 
        : selectedCategories.join(", "));
  // -------------------------
  // MODE COMMUNE (CLUSTERING & SPIDERFY)
  // -------------------------
  if (mode === "commune") {
    // A. Créer le groupe de clusters Leaflet MarkerCluster
    const markerClusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true, // Écarte les marqueurs identiques au zoom maximum
      maxClusterRadius: 40,   // Rayon d'attraction des clusters
      // Personnalisation graphique du cluster pour garder tes jolies bulles d'origine
      iconCreateFunction: function(cluster) {
        const childCount = cluster.getChildCount();
        const size = Math.min(80, 25 + (childCount * 3));
        const radius = size / 2;
        return L.divIcon({
          className: "",
          html: `<div class="bubble" style="width:${size}px; height:${size}px; font-size:${Math.max(12, size/2.5)}px;">${childCount}</div>`,
          iconSize: [size, size],
          iconAnchor: [radius, radius]
        });
      }
    });
    // B. Filtrer les lignes selon les difficultés sélectionnées
    const matchingRows = rowsTime.filter(r => matchesCategory(r, selectedCategories));
    // C. Mettre à jour l'info-badge avec le NOMBRE RÉEL de ruptures (et non de communes)
    info.textContent = `${matchingRows.length} ruptures — ${timeLabel} — filtre: ${filterText}`;
    // D. Créer un marqueur individuel par rupture
    matchingRows.forEach(r => {
      // Notre joli point rouge défini dans style.css
      const miniIcon = L.divIcon({
        className: "",
        html: `<div class="mini-marker-bubble" title="${r.label}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      // Contenu stylisé et détaillé du popup
      const popupContent = `
        <div style="font-family: 'Outfit', sans-serif; min-width: 220px; max-width: 300px;">
          <b style="color: var(--blue-dark); font-size: 15px;">${r.label}</b> (CP: ${r.cp})<br>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 8px 0;">
          <b>Date de survenue :</b>${formatToFrDate(r.date)}<br>
          <b style="color: var(--blue-dark); display: block; margin-top: 8px; font-size: 13px;">Difficultés rencontrées :</b>
          <ul style="margin: 4px 0; padding-left: 18px; color: var(--text-dark); font-size: 13px;">
            ${r.origins.map(o => `<li>${o}</li>`).join("")}
          </ul>
          <!-- Encart esthétique pour le détail (s'il existe) -->
          ${r.detail ? `
            <b style="color: var(--blue-dark); display: block; margin-top: 10px; font-size: 13px;">Précisions :</b>
            <div style="margin-top: 4px; padding: 8px 10px; background: #f8fafc; border-left: 3px solid var(--blue-light); border-radius: 4px; font-size: 12.5px; color: var(--text-muted); font-style: italic; line-height: 1.4; max-height: 100px; overflow-y: auto; box-sizing: border-box;">
              "${r.detail}"
            </div>
          ` : ""}
        </div>
      `;
      const marker = L.marker([r.lat, r.lng], { icon: miniIcon })
        .bindPopup(popupContent);
      
      markerClusterGroup.addLayer(marker);
    });
    // E. Ajouter l'ensemble du groupe de clusters sur la carte
    layer.addLayer(markerClusterGroup);
    return;
  }
  // -------------------------
  // MODE EPCI (AGRÉGATION PAR ZONE)
  // -------------------------
  if (mode === "epci" && (!EPCI_GEO || !ROWS_WITH_EPCI)) {
    info.textContent = "Chargement des EPCI…";
    return;
  }
  const rowsWithEpciTime = filterRowsByTime(ROWS_WITH_EPCI);
  const epciItems = aggregateByEPCI(rowsWithEpciTime, selectedCategories);
  // Somme totale des cas EPCI filtrés
  const totalRupturesEPCI = epciItems.reduce((sum, item) => sum + item.total, 0);
  info.textContent = `${totalRupturesEPCI} ruptures — ${timeLabel} — filtre: ${filterText}`;
  epciItems.forEach(item => {
    const center = getEPCICenter(item.epciCode);
    if (!center) return;
    L.marker([center.lat, center.lng], { icon: bubbleIconEPCI(item.total) })
      .addTo(layer)
      .bindPopup(
        `<div style="font-family: 'Outfit', sans-serif;">
          <b style="font-size:15px;">${item.epciName}</b><br>
          <b>Code EPCI :</b> ${item.epciCode}<br>
          <b>Période :</b> ${timeLabel}<br>
          <b>Difficultés :</b> ${filterText}<br>
          <hr style="border:0; border-top:1px solid #eee; margin:8px 0;">
          <b style="color:var(--blue-dark); font-size:14px;">${item.total} ruptures</b>
        </div>`
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
    //sel.value = "TOTAL";
    selectedCategories = ['TOTAL'];
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
//sel.addEventListener("change", render);

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
  const str = String(v);
  const result = [];
  let current = "";
  let parenDepth = 0; // Permet de savoir si on est dans des parenthèses (...)
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (char === '(') {
      parenDepth++;
      current += char;
    } else if (char === ')') {
      parenDepth--;
      current += char;
    } else if ((char === ',' || char === ';' || char === '\n') && parenDepth === 0) {
      // On découpe UNIQUEMENT si on croise un séparateur hors des parenthèses !
      if (current.trim()) {
        result.push(current.trim());
      }
      current = ""; // On réinitialise pour l'élément suivant
    } else {
      current += char;
    }
  }
  
  // Ne pas oublier d'ajouter le dernier élément après la dernière virgule
  if (current.trim()) {
    result.push(current.trim());
  }
  
  return result;
}

function parseToISODate(dateStr){
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;

  // 1. Tester le format français dd/mm/yyyy EN PREMIER
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m){
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const yy = m[3];
    return `${yy}-${mm}-${dd}`; // Renvoie directement "AAAA-MM-JJ" de manière ultra-fiable
  }

  // 2. Fallback sur le format ISO direct
  const d1 = new Date(s);
  if (!isNaN(d1.getTime())){
    const yy = d1.getFullYear();
    const mm = String(d1.getMonth() + 1).padStart(2, '0');
    const dd = String(d1.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

function formatToFrDate(isoDateStr) {
  if (!isoDateStr) return "";
  const parts = isoDateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDateStr;
}

function normalizeName(str) {
  let s = String(str ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Supprime les accents
    .trim()
    .replace(/[-']/g, " ")           // Remplace les tirets et apostrophes par des espaces
    .replace(/\s+/g, " ");           // Nettoie les doubles espaces
  // 👈 LE CODE MAGIQUE DU MENTOR :
  // Remplace "st" par "saint" et "ste" par "sainte" lorsqu'ils forment des mots entiers (\b)
  s = s.replace(/\bst\b/g, "saint")
       .replace(/\bste\b/g, "sainte");
  return s;
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
      origins,
      detail: String(o[COL_DETAIL]?? "").trim()
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
    selectedCategories = ["TOTAL"];
    setCategoryOptions(DATA.categories);

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

/* ==========================================================================
   LOGIQUE DE SÉCURITÉ ET DE CONNEXION
   ========================================================================== */

// 1. Fonction pour chiffrer en SHA-256 (méthode de sécurité native du navigateur)
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 2. Vérification de la session existante au chargement
function checkSession() {
  const isAuth = localStorage.getItem("orp_authenticated");
  const loginScreen = document.getElementById("login-screen");
  if (isAuth === "true" && loginScreen) {
    loginScreen.classList.add("hidden");
  }
}

// 3. Gestionnaire des événements pour l'écran de connexion
function initLogin() {
  const loginBtn = document.getElementById("login-button");
  const passwordInput = document.getElementById("password-input");
  const errorMsg = document.getElementById("login-error");
  const togglePasswordBtn = document.getElementById("toggle-password");
  const loginScreen = document.getElementById("login-screen");

  if (!loginBtn || !passwordInput || !togglePasswordBtn || !loginScreen) return;

  // Afficher / Masquer le mot de passe
  togglePasswordBtn.addEventListener("click", () => {
    const isPassword = passwordInput.getAttribute("type") === "password";
    passwordInput.setAttribute("type", isPassword ? "text" : "password");
    togglePasswordBtn.textContent = isPassword ? "🙈" : "👁️";
  });

  // Valider en appuyant sur la touche "Entrée"
  passwordInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      loginBtn.click();
    }
  
  });

  // Clic sur le bouton de connexion
  loginBtn.addEventListener("click", async () => {
    const password = passwordInput.value;
    
    // Calcul du hash SHA-256 du texte saisi
    const inputHash = await sha256(password);
    
    // Hash SHA-256 correspondant au mot de passe "ORP2026"
    const correctHash = "fe04b3ec2a429362ac1ffd3c6aae75f6488af17fa7a937c508cd530e803038ec";

    if (inputHash === correctHash) {
      // Connexion réussie : on sauvegarde la session et on cache l'écran
      localStorage.setItem("orp_authenticated", "true");
      loginScreen.classList.add("hidden");
      errorMsg.textContent = "";
    } else {
      // Échec : message d'erreur
      errorMsg.textContent = "Mot de passe incorrect.";
      passwordInput.value = "";
      passwordInput.focus();
    }
  });
    // Bouton de déconnexion
  const logoutBtn = document.getElementById("logout-button");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      // 1. Supprime la sauvegarde de session
      localStorage.removeItem("orp_authenticated");
      
      // 2. Vibe et réaffiche l'écran de connexion
      if (loginScreen) {
        loginScreen.classList.remove("hidden");
      }
      if (passwordInput) {
        passwordInput.value = ""; // Vide le champ pour la prochaine fois
      }
    });
  }
}

// Lancement automatique au chargement
checkSession();
initLogin();