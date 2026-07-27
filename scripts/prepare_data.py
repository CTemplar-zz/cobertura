from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


SOURCE = Path(r"C:\Articulos Cientificos\COBERTURA\COBERTURA_TOTAL2.xlsx")
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "data"
YEARS = list(range(2010, 2026))


def clean_text(value: object) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def clean_number(value: object) -> float | None:
    if pd.isna(value):
        return None
    return float(value)


frame = pd.read_excel(SOURCE, sheet_name=0)
frame.columns = [str(column).strip() for column in frame.columns]

required = {
    "FID",
    "MUNICIPIO",
    "YEAR",
    "COD_UNICO",
    "AREA",
    "X",
    "Y",
    "Densidad",
    "CL_DENSIDAD",
    "ID_PREDIO",
    "AreaPredio",
    "CLAS_PRED",
    "Principal",
    "Secundario",
    *{str(year) for year in YEARS},
}
missing = sorted(required.difference(frame.columns))
if missing:
    raise RuntimeError(f"Faltan columnas requeridas: {missing}")

records: list[dict[str, object]] = []
for row in frame.to_dict(orient="records"):
    x = clean_number(row["X"])
    y = clean_number(row["Y"])
    if x is None or y is None:
        continue
    records.append(
        {
            "id": int(row["FID"]),
            "municipio": clean_text(row["MUNICIPIO"]),
            "year": int(row["YEAR"]),
            "code": clean_text(row["COD_UNICO"]),
            "area": clean_number(row["AREA"]) or 0,
            "x": x,
            "y": y,
            "density": clean_number(row["Densidad"]) or 0,
            "densityClass": clean_text(row["CL_DENSIDAD"]),
            "parcelId": int(row["ID_PREDIO"]),
            "parcelArea": clean_number(row["AreaPredio"]) or 0,
            "parcelClass": clean_text(row["CLAS_PRED"]),
            "principal": clean_number(row["Principal"]) or 0,
            "secondary": clean_number(row["Secundario"]) or 0,
            "cover": [clean_text(row[str(year)]) for year in YEARS],
        }
    )

classes = sorted(
    {
        cover
        for record in records
        for cover in record["cover"]
        if isinstance(cover, str) and cover
    }
)
municipalities = sorted({str(record["municipio"]) for record in records})

summary = {
    "source": SOURCE.name,
    "sheet": frame.attrs.get("sheet_name", 0),
    "rowsInWorkbook": int(len(frame)),
    "validPointRows": len(records),
    "years": YEARS,
    "classes": classes,
    "municipalities": municipalities,
    "ranges": {
        "density": [
            min(float(record["density"]) for record in records),
            max(float(record["density"]) for record in records),
        ],
        "principal": [
            min(float(record["principal"]) for record in records),
            max(float(record["principal"]) for record in records),
        ],
        "secondary": [
            min(float(record["secondary"]) for record in records),
            max(float(record["secondary"]) for record in records),
        ],
        "parcelArea": [
            min(float(record["parcelArea"]) for record in records),
            max(float(record["parcelArea"]) for record in records),
        ],
    },
}

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
(OUTPUT_DIR / "points.json").write_text(
    json.dumps(
        {"years": YEARS, "classes": classes, "points": records},
        ensure_ascii=False,
        separators=(",", ":"),
    ),
    encoding="utf-8",
)
(OUTPUT_DIR / "data-summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print(json.dumps(summary, ensure_ascii=False, indent=2))
