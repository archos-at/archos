from __future__ import annotations

import datetime as dt
import math
from typing import Any

import numpy as np

from . import operators as op
from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import undecidable
from .model import SpatialModel

SOLAR_TOLERANCE_DEGREES = 0.01
SOLAR_TOLERANCE_DEGREES_EXTRAPOLATED = 0.1


def _by_type(model: SpatialModel, ifc_type: str) -> list[Any]:
    try:
        return list(model.file.by_type(ifc_type))
    except RuntimeError:
        return []


def _compound_angle(value: Any) -> float | None:
    if not value:
        return None
    try:
        parts = [int(component) for component in value]
    except TypeError, ValueError:
        return None
    if len(parts) < 3:
        return None
    sign = -1.0 if any(part < 0 for part in parts) else 1.0
    magnitude = abs(parts[0]) + abs(parts[1]) / 60.0 + abs(parts[2]) / 3600.0
    if len(parts) > 3:
        magnitude += abs(parts[3]) / 3.6e9
    return sign * magnitude


def _site_coordinates(model: SpatialModel) -> tuple[float, float, str] | None:
    for site in _by_type(model, "IfcSite"):
        latitude = _compound_angle(getattr(site, "RefLatitude", None))
        longitude = _compound_angle(getattr(site, "RefLongitude", None))
        if latitude is None or longitude is None:
            continue
        if not (-90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0):
            continue
        return latitude, longitude, site.GlobalId
    return None


def _map_conversion_north(model: SpatialModel) -> float | None:
    for conversion in _by_type(model, "IfcMapConversion"):
        abscissa = getattr(conversion, "XAxisAbscissa", None)
        ordinate = getattr(conversion, "XAxisOrdinate", None)
        if abscissa is None or ordinate is None:
            continue
        if abs(float(abscissa)) < 1e-12 and abs(float(ordinate)) < 1e-12:
            continue
        return float(np.arctan2(float(ordinate), float(abscissa)))
    return None


def _julian_day(when: dt.datetime) -> float:
    year, month = when.year, when.month
    if month <= 2:
        year -= 1
        month += 12
    century = year // 100
    gregorian = 2 - century + century // 4
    day = when.day + (when.hour + when.minute / 60.0 + (when.second + when.microsecond / 1e6) / 3600.0) / 24.0
    return math.floor(365.25 * (year + 4716)) + math.floor(30.6001 * (month + 1)) + day + gregorian - 1524.5


def _solar_azimuth_altitude(when: dt.datetime, latitude: float, longitude: float) -> dict[str, float]:
    n = _julian_day(when) - 2451545.0
    hour = when.hour + when.minute / 60.0 + (when.second + when.microsecond / 1e6) / 3600.0

    mean_longitude = (280.460 + 0.9856474 * n) % 360.0
    mean_anomaly = math.radians((357.528 + 0.9856003 * n) % 360.0)
    ecliptic_longitude = math.radians(
        (mean_longitude + 1.915 * math.sin(mean_anomaly) + 0.020 * math.sin(2 * mean_anomaly)) % 360.0
    )
    obliquity = math.radians(23.439 - 0.0000004 * n)

    right_ascension = math.atan2(math.cos(obliquity) * math.sin(ecliptic_longitude), math.cos(ecliptic_longitude))
    declination = math.asin(math.sin(obliquity) * math.sin(ecliptic_longitude))

    gmst = (6.697375 + 0.0657098242 * n + hour) % 24.0
    local_sidereal = (gmst + longitude / 15.0) % 24.0
    hour_angle = math.radians((local_sidereal * 15.0 - math.degrees(right_ascension) + 180.0) % 360.0 - 180.0)

    phi = math.radians(latitude)
    altitude = math.asin(
        math.sin(phi) * math.sin(declination) + math.cos(phi) * math.cos(declination) * math.cos(hour_angle)
    )
    azimuth = math.atan2(
        -math.cos(declination) * math.sin(hour_angle),
        math.cos(phi) * math.sin(declination) - math.sin(phi) * math.cos(declination) * math.cos(hour_angle),
    )
    return {
        "azimuth": math.degrees(azimuth) % 360.0,
        "altitude": math.degrees(altitude),
        "declination": math.degrees(declination),
        "hourAngle": math.degrees(hour_angle),
    }


def _parse_instant(when_iso: str, method: str) -> tuple[dt.datetime | None, Answer[Any] | None]:
    try:
        parsed = dt.datetime.fromisoformat(str(when_iso).replace("Z", "+00:00"))
    except TypeError, ValueError:
        return None, undecidable(
            from_=[],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"„{when_iso}“ ist kein lesbarer Zeitpunkt",
                remedy=(
                    "Den Zeitpunkt nach ISO 8601 mit Zeitzone angeben, z. B. 2026-06-21T12:00:00+02:00 "
                    "(Sommerzeit in Österreich) oder 2026-06-21T10:00:00Z."
                ),
            ),
        )
    if parsed.tzinfo is None:
        return None, undecidable(
            from_=[],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"Zeitzone fehlt im Zeitpunkt „{when_iso}“",
                remedy=(
                    "Den Zeitpunkt mit Zonenangabe wiederholen, z. B. 2026-06-21T12:00:00+02:00 oder "
                    "2026-06-21T10:00:00Z. Ohne Zone wird hier nichts angenommen: Österreich läuft im Winter "
                    "auf UTC+1 und im Sommer auf UTC+2, und eine als UTC gelesene Ortszeit verschiebt die "
                    "Sonne um bis zu 30° — zwei Stunden Schattenverlauf."
                ),
            ),
        )
    return parsed.astimezone(dt.UTC), None


def sun_position(
    model: SpatialModel,
    when_iso: str,
    latitude: float | None = None,
    longitude: float | None = None,
) -> Answer[dict[str, Any]]:
    method = f"sunPosition({when_iso})"
    when, refusal = _parse_instant(when_iso, method)
    if refusal is not None:
        return refusal  # type: ignore[return-value]
    assert when is not None
    site = _coordinates(model, latitude, longitude, method)
    if not isinstance(site, tuple):
        return site
    latitude, longitude, from_, coordinate_source = site

    sun = _solar_azimuth_altitude(when, float(latitude), float(longitude))
    north, north_source, direction = _model_north(model, sun)

    in_span = 1950 <= when.year <= 2050
    tolerance = SOLAR_TOLERANCE_DEGREES if in_span else SOLAR_TOLERANCE_DEGREES_EXTRAPOLATED

    value = {
        "azimuth": round(sun["azimuth"], 4),
        "altitude": round(sun["altitude"], 4),
        "compass": op.COMPASS[int(round(sun["azimuth"] / 22.5)) % 16],
        "aboveHorizon": bool(sun["altitude"] > 0.0),
        "declination": round(sun["declination"], 4),
        "latitude": round(float(latitude), 6),
        "longitude": round(float(longitude), 6),
        "utc": when.isoformat().replace("+00:00", "Z"),
        "directionInModel": direction,
        "trueNorthDegrees": None if north is None else round(math.degrees(north) % 360.0, 4),
    }

    return computed(
        value,
        unit="°",
        tolerance=tolerance,
        from_=from_,
        method=method,
        caveat=_sun_caveat(
            coordinate_source=coordinate_source,
            north=north,
            north_source=north_source,
            in_span=in_span,
            tolerance=tolerance,
            altitude=sun["altitude"],
            when=when,
        ),
    )


def _coordinates(
    model: SpatialModel, latitude: float | None, longitude: float | None, method: str
) -> tuple[float, float, list[str], str] | Answer[Any]:
    from_: list[str] = []
    if (latitude is None) != (longitude is None):
        return undecidable(
            from_=[],
            method=method,
            provenance="declared",
            missing=MissingFact(
                what="nur eine der beiden Koordinaten übergeben",
                remedy=(
                    "sunPosition() braucht Breite UND Länge zusammen, in Dezimalgrad (Norden und Osten "
                    "positiv). Beide weglassen, um die Georeferenz des Modells zu verwenden."
                ),
            ),
        )

    if latitude is not None and longitude is not None:
        coordinate_source = "vom Aufrufer übergeben"
    else:
        site = _site_coordinates(model)
        if site is None:
            return _not_georeferenced(model, method)
        latitude, longitude, site_id = site
        from_.append(site_id)
        coordinate_source = f"IfcSite.RefLatitude/RefLongitude ({site_id})"
    return latitude, longitude, from_, coordinate_source


def _model_north(model: SpatialModel, sun: dict[str, float]) -> tuple[float | None, str, list[float] | None]:
    north = model.true_north
    north_source = "IfcGeometricRepresentationContext.TrueNorth"
    if north is None:
        north = _map_conversion_north(model)
        north_source = "IfcMapConversion.XAxisAbscissa/XAxisOrdinate (Gitternord)"
    direction: list[float] | None = None
    if north is not None:
        north_vector = np.array([math.sin(north), math.cos(north), 0.0])
        east_vector = np.array([north_vector[1], -north_vector[0], 0.0])
        bearing = math.radians(sun["azimuth"])
        horizontal = math.cos(bearing) * north_vector + math.sin(bearing) * east_vector
        towards = math.cos(math.radians(sun["altitude"])) * horizontal + np.array(
            [0.0, 0.0, math.sin(math.radians(sun["altitude"]))]
        )
        direction = [round(float(c), 6) for c in towards]
    return north, north_source, direction


def _sun_caveat(
    *,
    coordinate_source: str,
    north: float | None,
    north_source: str,
    in_span: bool,
    tolerance: float,
    altitude: float,
    when: dt.datetime,
) -> str:
    parts = [
        "Das ist der Sonnenstand, KEINE Besonnungsstudie: die Antwort sagt, wo die Sonne steht, nicht, was "
        "beschattet ist. Ob der Strahl beim Fenster ankommt, entscheiden Nachbargebäude, Gelände, Balkone "
        "und Dachüberstände — davon kennt diese Datei nur, was in ihr modelliert ist. Für die Verschattung "
        "die Richtung `directionInModel` an ray() bzw. obstructions() übergeben; alles außerhalb des Modells "
        "bleibt unberücksichtigt.",
        f"Koordinaten: {coordinate_source}."
        + (
            " Diese Koordinaten stehen NICHT in der Datei — sie stammen aus dem Aufruf. Ob sie zu diesem "
            "Gebäude gehören, kann hier niemand prüfen; der ganze Sonnenstand hängt daran."
            if coordinate_source.startswith("vom Aufrufer")
            else ""
        ),
        (
            "Algorithmus: Michalsky (1988), der Näherungsalgorithmus des Astronomical Almanac, angegebene "
            f"Genauigkeit 0,01° für 1950–2050; hier als Toleranz {tolerance} ° geführt."
        ),
        "Gerechnet ist die GEOMETRISCHE Sonnenposition ohne Refraktion — Schatten wirft die geometrische "
        "Sonne. Die scheinbare Sonne steht in Horizontnähe bis zu 0,57° höher.",
    ]
    if not in_span:
        parts.append(
            f"Der Zeitpunkt liegt im Jahr {when.year} und damit außerhalb des Gültigkeitsbereichs 1950–2050 "
            "des Algorithmus. Der Wert wird ausgegeben, die Toleranz ist dafür auf "
            f"{SOLAR_TOLERANCE_DEGREES_EXTRAPOLATED} ° erhöht."
        )
    if altitude <= 0.0:
        parts.append(
            f"Die Sonne steht zu diesem Zeitpunkt {abs(altitude):.2f}° UNTER dem Horizont — es ist Nacht. "
            "Der Azimut ist trotzdem angegeben und beschreibt die Richtung unter dem Horizont."
        )
    if north is None:
        parts.append(
            "Die Datei nennt keine Nordrichtung (weder IfcGeometricRepresentationContext.TrueNorth noch "
            "IfcMapConversion). Azimut und Höhe sind echte Himmelskoordinaten und davon unberührt, aber die "
            "Richtung im Modell (`directionInModel`) lässt sich nicht bilden: es ist unbekannt, wie das "
            "Gebäude zum Norden steht. Abhilfe: die Nordrichtung im CAD setzen und mitexportieren."
        )
    elif north_source.startswith("IfcMapConversion"):
        parts.append(
            "Die Nordrichtung stammt aus IfcMapConversion und ist damit GITTERNORD des Projektionssystems, "
            "nicht geografisch Nord. Die beiden weichen um die Meridiankonvergenz voneinander ab — in einer "
            "UTM-Zone bis etwa 3°. Abhilfe: TrueNorth im Geometriekontext setzen."
        )
    else:
        parts.append(f"Nordrichtung: {north_source}.")
    return " ".join(parts)


def _not_georeferenced(model: SpatialModel, method: str) -> Answer[Any]:
    map_conversion = _by_type(model, "IfcMapConversion")
    if map_conversion:
        crs = getattr(map_conversion[0], "TargetCRS", None)
        crs_name = getattr(crs, "Name", None) or "unbenannt"
        return undecidable(
            from_=[],
            method=method,
            provenance="declared",
            missing=MissingFact(
                what="IfcSite.RefLatitude / RefLongitude (geografische Koordinaten)",
                remedy=(
                    f"Dieses Modell ist georeferenziert, aber in ein projiziertes Koordinatensystem "
                    f"(IfcMapConversion, TargetCRS „{crs_name}“). Aus Rechts- und Hochwert lassen sich Breite "
                    "und Länge nur mit den Parametern genau dieser Projektion zurückrechnen — dafür fehlt "
                    "dieser Bibliothek die Projektionsbibliothek, und eine Näherung wäre um Kilometer "
                    "daneben. Abhilfe: am IfcSite zusätzlich RefLatitude und RefLongitude setzen (in Revit "
                    "und ArchiCAD der Standort des Projekts), oder sunPosition() mit latitude/longitude "
                    "aufrufen."
                ),
            ),
        )
    return undecidable(
        from_=[],
        method=method,
        provenance="declared",
        missing=MissingFact(
            what="IfcSite.RefLatitude / RefLongitude",
            remedy=(
                "Dieses Modell sagt nicht, wo es steht. Im CAD den Standort des Projekts setzen (Revit: "
                "Verwalten → Standort; ArchiCAD: Optionen → Projektstandort) und mitexportieren — dann "
                "stehen Breite und Länge am IfcSite. Ein angenommener Standort wird hier nicht eingesetzt: "
                "48° statt 47° Breite verschiebt die Sonnenhöhe um ein Grad, und der Fehler ist an der "
                "Antwort nicht zu erkennen. Wer die Koordinaten hat, kann sie sunPosition() direkt "
                "übergeben."
            ),
        ),
    )
