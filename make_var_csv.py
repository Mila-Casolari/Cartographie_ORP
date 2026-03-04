import csv
import requests

URL = "https://geo.api.gouv.fr/departements/83/communes?fields=nom,codesPostaux,centre"

data = requests.get(URL, timeout=30).json()

with open("data/var_communes.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["CP", "LAT", "LNG", "LABEL"])

    for c in sorted(data, key=lambda x: x["nom"]):
        cp = c["codesPostaux"][0] if c.get("codesPostaux") else ""
        lat = c["centre"]["coordinates"][1]
        lng = c["centre"]["coordinates"][0]
        label = c["nom"]
        w.writerow([cp, lat, lng, label])

print("OK -> var_communes.csv généré")