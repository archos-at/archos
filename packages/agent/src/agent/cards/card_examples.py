CARD_EXAMPLES: dict[str, dict] = {
    "surface": {
        "type": "surface",
        "title": "Zweiter Fluchtweg — zwei Varianten",
        "components": [
            {
                "id": "root",
                "component": "Tabs",
                "tabs": [
                    {"title": "Außentreppe", "child": "aussen"},
                    {"title": "Zweites Treppenhaus", "child": "innen"},
                ],
            },
            {
                "id": "aussen",
                "component": "Text",
                "text": (
                    "| Kriterium | Anforderung | Status | Fundstelle |\n|---|---|---|---|\n"
                    "| Abstand zu Öffnungen | ≥ 2,0 m | offen | [1] |\n"
                    "| Baustoff | A2 | erfüllt | [1] |"
                ),
            },
            {
                "id": "innen",
                "component": "Text",
                "text": (
                    "| Kriterium | Anforderung | Status | Fundstelle |\n|---|---|---|---|\n"
                    "| Wände des Treppenhauses | REI 90 | erfüllt | [1] |\n"
                    "| Rauchabzug | ≥ 1 m² | nicht erfüllt | [1] |"
                ),
            },
        ],
    },
    "ifc_compliance": {
        "type": "ifc_compliance",
        "title": "Offene Anforderungen — Brandschutz",
        "model_file": "haus-a.ifc",
        "rule_ids": ["oib2-fire-resistance-load-bearing"],
        "note": "Orientierende Prüfung, kein Nachweis.",
    },
    "ifc_viewer": {
        "type": "ifc_viewer",
        "title": "Brandabschnitte – Erdgeschoss",
        "model_file": "haus-a.ifc",
        "storey": "Erdgeschoss",
        "highlights": [
            {
                "match": {
                    "ifc_types": ["IfcWall"],
                    "storeys": ["Erdgeschoss"],
                    "properties": [{"set": "Pset_WallCommon", "name": "FireRating", "operator": "missing"}],
                },
                "label": "Keine Feuerwiderstandsklasse hinterlegt",
                "status": "fail",
            },
            {
                "global_ids": ["1kTvXnbbzCWw8lcMd1dR4o", "0RSwXnbbzCWw8lcMd1dR9z"],
                "label": "REI 90 erfüllt",
                "status": "pass",
            },
        ],
        "note": "Die hervorgehobenen Wände stammen aus der Modellabfrage, nicht aus dem Plan.",
    },
    "ifc_model_picker": {
        "type": "ifc_model_picker",
        "title": "Welches Modell möchten Sie öffnen?",
        "note": "Ein Klick öffnet das Modell im 3D-Viewer.",
    },
    "daylight_incidence": {
        "type": "daylight_incidence",
        "title": "Belichtung – freier Lichteinfall (Gästezimmer)",
        "room_floor_area_m2": 25,
        "glass_area": {
            "label": "Lichteintrittsfläche",
            "value": 3.0,
            "required": 2.5,
            "unit": "m²",
            "comparator": ">=",
            "status": "pass",
        },
        "window_sill_height_m": 0.9,
        "window_head_height_m": 2.4,
        "reference": {
            "document": "OIB-Richtlinie 3",
            "section": "Pkt. 9.1.1",
            "edition": "Ausgabe Mai 2023",
        },
    },
    "building_section": {
        "type": "building_section",
        "title": "Gebäudeschnitt – Höhenprüfung",
        "storeys": [
            {"label": "KG", "height_m": 3.0, "below_grade": True},
            {"label": "EG", "height_m": 3.5},
            {"label": "1.OG", "height_m": 3.2},
        ],
        "markers": [{"label": "Fluchtniveau", "height_m": 9.8, "kind": "escape_level"}],
        "reference": {
            "document": "OIB-Richtlinie 2",
            "section": "Pkt. 2 (Gebäudeklassen)",
            "edition": "Ausgabe Mai 2023",
        },
    },
    "project_profile_patch": {
        "type": "project_profile_patch",
        "title": "Projektkontext aktualisieren: Fluchtniveau",
        "rationale": (
            "Sie haben angegeben, dass das oberste Fluchtniveau bei 25 m liegt — damit ist das "
            "Gebäude ein Hochhaus (> 22 m) und OIB-Richtlinie 2.3 wird anwendbar."
        ),
        "patch": [{"op": "add", "path": "/facts/fluchtniveau", "value": ">22m"}],
        "preview": [{"label": "Escape level", "before": "11–22m", "after": "> 22m"}],
    },
    "calculation": {
        "type": "calculation",
        "title": "Netto-Grundfläche Brandabschnitt BA 2",
        "steps": [
            {
                "label": "Netto-Grundfläche",
                "operation": "sum",
                "unit": "m²",
                "operands": [
                    {"label": "Büros Nord", "value": 612.4, "unit": "m²", "source": "Raumbuch 3. OG"},
                    {"label": "Büros Süd", "value": 588.0, "unit": "m²", "source": "Raumbuch 3. OG"},
                    {
                        "label": "Gang und Nebenräume",
                        "value": 241.6,
                        "unit": "m²",
                        "provenance": "computed",
                        "tolerance": 2.0,
                        "source": "Modell, Geschoß 3. OG",
                    },
                ],
            }
        ],
        "limit": {
            "comparator": "<=",
            "value": 1600,
            "label": "Büronutzung",
            "reference": {"document": "OIB-Richtlinie 2", "section": "Pkt. 3.1.1", "edition": "Ausgabe Mai 2023"},
        },
    },
}


CARD_EXAMPLES["formula"] = {
    "type": "formula",
    "title": "U-Wert Außenwand AW 01",
    "formula": {
        "name": "u_value",
        "component": "external_wall",
        "measure": "new_build",
        "layers": [
            {
                "label": "Stahlbeton",
                "thickness": {"value": 18, "source": "Wandaufbau AW 01"},
                "conductivity": {"value": 2.3, "source": "Wandaufbau AW 01"},
            },
            {
                "label": "EPS-F",
                "thickness": {"value": 20, "min": 0, "max": 40, "step": 1, "source": "Wandaufbau AW 01"},
                "conductivity": {"value": 0.035, "step": 0.001, "source": "Produktdatenblatt"},
            },
        ],
    },
}
