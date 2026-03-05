import csv, json, re
from collections import defaultdict
from datetime import datetime

RESPONSES_CSV = "data/reponses.csv"
CP_GEO_CSV = "data/var_communes.csv"
OUTPUT_JSON = "public/data.json"

COL_CP = "Code postal du domicile "
COL_ORIG = "Selon vous, qu'est ce qui est à l'origine de la situation ?"
COL_DATE = "Date de survenue de la rupture (indiquez la date de l'évènement ou le 1er du mois concerné) "


def extract_cp(value: str):
    if not value:
        return None
    m=re.search(r"\b(\d{5})\b", str(value))
    return m.group(1) if m else None

def split_multi(value: str):
    if not value:
        return []
    #support ; et , et retour à la ligne
    parts = re.split(r"[\n;,]+", str(value))
    return [p.strip() for p in parts if p.strip()]

def parse_date_iso(value: str):
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    
    #essaie ISO direct via fromsoformat
    try:
        s2 = s.replace("Z", "")
        dt = datetime.fromisoformat(s2)
        return dt.date().isoformat()
    except Exception:
        pass

    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$", s)
    if m:
        dd, mm, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(yy, mm, dd).date().isoformat()
        except Exception:
            return None
    return None

def load_cp_geo():
    cp_geo = {}
    with open(CP_GEO_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cp = str(row["CP"]).strip()
            if not cp:
                continue
            try:
                cp_geo[cp] = {
                    "lat": float(row["LAT"]),
                    "lng": float(row["LNG"]),
                    "label": row.get("LABEL", cp) or cp
                }
            except Exception:
                continue
    return cp_geo

def main():
    cp_geo = load_cp_geo()

    #counts_total = defaultdict(int)  # cp -> count
    #counts_by_cat = defaultdict(lambda: defaultdict(int))  # cat -> cp -> count
    #categories_set = set()

    rows_out = []
    categories_set = set()

    skipped_no_cp = 0
    skipped_no_geo = 0
    skipped_no_date = 0

    with open(RESPONSES_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cp = extract_cp(row.get(COL_CP, ""))
            if not cp:
                skipped_no_cp += 1
                continue
            if cp not in cp_geo:
                skipped_no_geo += 1
                continue  # pas de coords => pas affiché

            #counts_total[cp] += 1

            #cats = split_multi(row.get(COL_ORIG, ""))
            #for c in cats:
            #    categories_set.add(c)
            #    counts_by_cat[c][cp] += 1

            date_iso = parse_date_iso(row.get(COL_DATE, ""))
            if not date_iso:
                # si tu préfères quand même garder la ligne (sans filtre temps),
                # on peut mettre une date 'UNKNOWN'. Mais ton filtre temps va la perdre.
                skipped_no_date += 1
                continue

            """cats = split_multi(row.get(COL_ORIG, ""))

            # Si pas de catégorie, on la met dans TOTAL seulement
            if not cats:
                geo = cp_geo[cp]
                rows_out.append({
                    "date": date_iso,
                    "cp": cp,
                    "label": geo["label"],
                    "lat": geo["lat"],
                    "lng": geo["lng"],
                    "origin": ""  # vide => ne matchera pas un filtre, mais TOTAL inclura tout
                })
            else:
                # 1 ligne par catégorie (pratique pour filtrer)
                geo = cp_geo[cp]
                for c in cats:
                    categories_set.add(c)
                    rows_out.append({
                        "date": date_iso,
                        "cp": cp,
                        "label": geo["label"],
                        "lat": geo["lat"],
                        "lng": geo["lng"],
                        "origin": c
                    })"""
            
            cats = split_multi(row.get(COL_ORIG, ""))

            # on collecte les catégories existantes (même si on n'ajoute qu'1 row)
            for c in cats:
                categories_set.add(c)

            geo = cp_geo[cp]
            rows_out.append({
                "date": date_iso,
                "cp": cp,
                "label": geo["label"],
                "lat": geo["lat"],
                "lng": geo["lng"],
                "origins": cats  # ✅ liste des difficultés (0..n)
            })


    # construire payload JSON
    payload = {
        "categories": ["TOTAL"] + sorted(categories_set),
        #"points": []
        "rows": rows_out
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"✅ data.json généré: {OUTPUT_JSON}")
    print(f"✅ catégories: {len(payload['categories'])-1} + TOTAL")
    print(f"✅ rows (événements): {len(payload['rows'])}")
    print(f"ℹ️ skip: no_cp={skipped_no_cp}, no_geo={skipped_no_geo}, no_date={skipped_no_date}")


"""   # points total
    for cp, count in counts_total.items():
        geo = cp_geo[cp]
        payload["points"].append({
            "cp": cp,
            "label": geo["label"],
            "lat": geo["lat"],
            "lng": geo["lng"],
            "counts": {"TOTAL": count}
        })

    # injecter counts par catégorie dans chaque point
    # pour éviter de dupliquer les points, on enrichit "counts"
    cp_to_point = {p["cp"]: p for p in payload["points"]}
    for cat, cp_map in counts_by_cat.items():
        for cp, ccount in cp_map.items():
            cp_to_point[cp]["counts"][cat] = ccount

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"✅ data.json généré: {OUTPUT_JSON}")
    print(f"✅ catégories: {len(payload['categories'])-1} + TOTAL")
    print(f"✅ points: {len(payload['points'])}")"""

if __name__ == "__main__":
    main()