import csv, json, re
from collections import defaultdict

RESPONSES_CSV = "data/reponses.csv"
CP_GEO_CSV = "data/var_communes.csv"
OUTPUT_JSON = "public/data.json"

COL_CP = "Code postal du domicile "
COL_ORIG = "Selon vous, qu'est ce qui est à l'origine de la situation ?"

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

def load_cp_geo():
    cp_geo = {}
    with open(CP_GEO_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cp = str(row["CP"]).strip()
            if not cp:
                continue
            cp_geo[cp] = {
                "lat": float(row["LAT"]),
                "lng": float(row["LNG"]),
                "label": row.get("LABEL", cp) or cp
            }
    return cp_geo

def main():
    cp_geo = load_cp_geo()

    counts_total = defaultdict(int)  # cp -> count
    counts_by_cat = defaultdict(lambda: defaultdict(int))  # cat -> cp -> count
    categories_set = set()

    with open(RESPONSES_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cp = extract_cp(row.get(COL_CP, ""))
            if not cp:
                continue
            if cp not in cp_geo:
                continue  # pas de coords => pas affiché

            counts_total[cp] += 1

            cats = split_multi(row.get(COL_ORIG, ""))
            for c in cats:
                categories_set.add(c)
                counts_by_cat[c][cp] += 1

    # construire payload JSON
    payload = {
        "categories": ["TOTAL"] + sorted(categories_set),
        "points": []
    }

    # points total
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
    print(f"✅ points: {len(payload['points'])}")

if __name__ == "__main__":
    main()