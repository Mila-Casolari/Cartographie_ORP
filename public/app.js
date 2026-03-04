const map = L.map('map').setView([43.35, 6.2], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);

const layer = L.layerGroup().addTo(map);
const sel = document.getElementById("filter");
const info = document.getElementById("info");
const modeSel = document.getElementById("mode");

let DATA = null;
let EPCI_GEO = null;
let POINTS_WITH_EPCI = null;

function setOptions(categories){
  sel.innerHTML = "";
  categories.forEach(c => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = (c === "TOTAL") ? "Total (toutes difficultés)" : c;
    sel.appendChild(o);
  });
}

function render(filter){
  layer.clearLayers();

  const mode = modeSel.value;

  // Par sécurité : si on est en mode EPCI mais pas encore prêt
  if (mode === "epci" && (!EPCI_GEO || !POINTS_WITH_EPCI)) {
    info.textContent = "Chargement des EPCI…";
    return;
  }

  if (mode === "commune") {
    const points = DATA.points
      .map(p => ({...p, value: p.counts[filter] || 0}))
      .filter(p => p.value > 0);

    info.textContent = `${points.length} points (communes)`;

    points.forEach(p => {
      const icon = L.divIcon({
        className: "",
        html: `<div class="bubble">${p.value}</div>`,
        iconSize: [42,42],
        iconAnchor: [21,21]
      });

      L.marker([p.lat, p.lng], { icon })
        .addTo(layer)
        .bindPopup(`<b>${p.label}</b><br>CP: ${p.cp}<br>${filter}<br><b>${p.value}</b> cas`);
    });

    return;
  }

  // ✅ MODE EPCI : on agrège les communes par epciCode
  const byEPCI = new Map();

  POINTS_WITH_EPCI.forEach(p => {
    const v = p.counts[filter] || 0;
    if (v <= 0) return;

    const key = p.epciCode;
    if (!byEPCI.has(key)) {
      byEPCI.set(key, { epciCode: key, epciName: p.epciName, total: 0 });
    }
    byEPCI.get(key).total += v;
  });

  const epciItems = Array.from(byEPCI.values()).filter(x => x.total > 0);
  info.textContent = `${epciItems.length} points (EPCI)`;

  epciItems.forEach(item => {
    const center = getEPCICenter(item.epciCode);
    if (!center) return;

    const icon = L.divIcon({
      className: "",
      html: `<div class="bubble-epci">${item.total}</div>`,
      iconSize: [60,60],
      iconAnchor: [30,30]
    });

    L.marker([center.lat, center.lng], { icon })
      .addTo(layer)
      .bindPopup(`<b>${item.epciName}</b><br>Code: ${item.epciCode}<br>${filter}<br><b>${item.total}</b> cas (somme communes)`);
  });
}

function getEPCICenter(epciCode){
  const f = EPCI_GEO.features.find(ft => String(ft.properties?.EPCI_CODE) === String(epciCode));
  if (!f) return null;

  const geom = normalizeGeometry(f.geometry);
  if (!geom) return null;

  // Turf centroid (souvent plus propre)
  try {
    const c = turf.centroid(turf.feature(geom));
    const [lng, lat] = c.geometry.coordinates;
    return { lat, lng };
  } catch(e) {
    // fallback Leaflet bounds
    const lyr = L.geoJSON({ type: "Feature", geometry: geom });
    const center = lyr.getBounds().getCenter();
    return { lat: center.lat, lng: center.lng };
  }
}

fetch("./data.json")
  .then(r => r.json())
  .then(json => {
    DATA = json;
    setOptions(DATA.categories);
    sel.value = "TOTAL";

    // ✅ si EPCI déjà chargé, on enrichit tout de suite
    if (EPCI_GEO) {
      POINTS_WITH_EPCI = attachEPCIToPoints(DATA.points, EPCI_GEO);
    }

    render("TOTAL");
  });

modeSel.addEventListener("change", () => render(sel.value))
sel.addEventListener("change", () => render(sel.value));

function getTerritoryKey(feature){
  const p = feature.properties || {};
  return (
    p.siren || p.SIREN || p.SIREN_EPCI || p.siren_epci ||
    p.code  || p.CODE  || p.CODE_EPCI ||
    p.nom   || p.NOM   || p.LIBEPCI  || p.libelle ||
    "unknown"
  ).toString().trim();
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

fetch("./EPCI_2025.geojson")
  .then(r => r.json())
  .then(geo => {
    EPCI_GEO = geo;

    //console.log("props exemple:", geo.features[0].properties); // debug 1 fois

    L.geoJSON(geo, {
      style: (feature) => {
        const code = String(feature.properties?.EPCI_CODE ?? "UNKNOWN");
        return {
          color: "#1f3b63",
          weight: 2,
          dashArray: "4 3",
          fillColor: colorForEPCI(code),   // ✅ couleurs différentes
          fillOpacity: 0.55                // ✅ visible
        };
      },
      onEachFeature: (feature, layer) => {
        const name = feature.properties?.EPCI ?? "EPCI";
        const code = feature.properties?.EPCI_CODE ?? "";
        layer.bindTooltip(`${name} (${code})`, { sticky: true });
      }
    }).addTo(map);

    // si les données points sont déjà chargées, on enrichit
    if (DATA && !POINTS_WITH_EPCI){
      POINTS_WITH_EPCI = attachEPCIToPoints(DATA.points, EPCI_GEO);
      render(sel.value);
    }
  });

function attachEPCIToPoints(points, epciGeo){
  // On transforme les features en Turf feature pour les tests point-in-polygon
  const features = epciGeo.features;

  return points.map(p => {
    const pt = turf.point([p.lng, p.lat]);

    let found = null;
    for (const f of features) {
      // Certains geojson ont GeometryCollection -> Turf le gère mal parfois.
      // On prend le "premier Polygon/MultiPolygon" si besoin.
      const geom = normalizeGeometry(f.geometry);
      if (!geom) continue;

      const polyFeat = turf.feature(geom, f.properties);
      if (turf.booleanPointInPolygon(pt, polyFeat)) {
        found = f.properties;
        break;
      }
    }

    return {
      ...p,
      epciCode: (found?.EPCI_CODE ?? "UNKNOWN").toString(),
      epciName: (found?.EPCI ?? "EPCI inconnu").toString()
    };
  });
}

function normalizeGeometry(geometry){
  if (!geometry) return null;

  // Cas standard
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") return geometry;

  // Cas GeometryCollection -> on cherche un Polygon ou MultiPolygon dedans
  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    return geometry.geometries.find(g => g.type === "Polygon" || g.type === "MultiPolygon") || null;
  }

  return null;
}