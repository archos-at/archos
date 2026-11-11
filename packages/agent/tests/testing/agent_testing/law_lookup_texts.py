"""Law texts for the parity rig's document pages, written for the test (not the laws' wording).

Each is laid out the way a consolidated text on a statute database's page reads
once converted: a heading line, then ``§ N.`` with its first Absatz on the same
line, later Absätze on their own lines. The rig (``law_lookup_parity``) wraps
each in a document page; what is being tested is the cutting, not the content.
"""

from __future__ import annotations

_BO = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage="

PAGES: dict[str, tuple[str, str]] = {
    f"{_BO}LrW&Gesetzesnummer=20000006": (
        "Bauordnung für Wien",
        """
Bauordnung für Wien
Inhaltsverzeichnis
§ 60 Bewilligungspflichtige Bauvorhaben
§ 63 Bauansuchen
Bewilligungspflichtige Bauvorhaben
§ 60. (1) Bei folgenden Bauvorhaben ist eine Baubewilligung erforderlich:
a) Neu-, Zu- und Umbauten,
b) die Änderung der Raumwidmung.
(2) Ausgenommen sind Bauvorhaben nach § 62a.
Bauansuchen
§ 63. (1) Dem Ansuchen um Baubewilligung sind anzuschließen:
a) der Nachweis des Eigentums,
b) die Baupläne in dreifacher Ausfertigung.
(2) Die Baupläne müssen von einem hierzu Befugten verfasst sein.
(3) Die Behörde kann weitere Unterlagen verlangen.
Bauverhandlung
§ 64. (1) Über das Bauansuchen ist eine Bauverhandlung anzuberaumen.
(2) Die Nachbarn sind zu laden.
Gebäudehöhe
§ 75. (1) Die Gebäudehöhe ergibt sich aus der Bauklasse.
(2) In der Bauklasse I darf die Gebäudehöhe 9 m nicht überschreiten.
(3) In der Bauklasse II darf die Gebäudehöhe 12 m nicht überschreiten.
""",
    ),
    f"{_BO}LrW&Gesetzesnummer=20000052": (
        "Wiener Garagengesetz 2008",
        """
Wiener Garagengesetz 2008
Stellplatzverpflichtung
§ 48. (1) Bei Neubauten ist für je 100 m² Wohnnutzfläche ein Stellplatz zu schaffen.
(2) Die Behörde kann Ausnahmen gewähren.
Ausgleichsabgabe
§ 49. (1) Wird die Stellplatzverpflichtung nicht erfüllt, ist eine Ausgleichsabgabe zu entrichten.
Verwendung der Ausgleichsabgabe
§ 50. (1) Die Erträge der Ausgleichsabgabe sind für die Errichtung öffentlicher Garagen zu verwenden.
(2) Sie können auch für Maßnahmen des öffentlichen Verkehrs verwendet werden.
(3) Über die Verwendung ist jährlich zu berichten.
Inkrafttreten
§ 51. (1) Dieses Gesetz tritt mit dem der Kundmachung folgenden Tag in Kraft.
""",
    ),
    f"{_BO}LrT&Gesetzesnummer=20000911": (
        "Tiroler Bauordnung 2022",
        """
Tiroler Bauordnung 2022
Begriffsbestimmungen
§ 2. (1) Bauliche Anlagen sind mit dem Erdboden verbundene Anlagen.
Abstellmöglichkeiten für Kraftfahrzeuge
§ 8. (1) Bei Neubauten sind Abstellmöglichkeiten für Kraftfahrzeuge in ausreichender Zahl zu schaffen.
(2) Die Zahl richtet sich nach der Verordnung der Gemeinde.
""",
    ),
    f"{_BO}LrSbg&Gesetzesnummer=10001005": (
        "Baupolizeigesetz 1997",
        """
Baupolizeigesetz 1997
Bewilligungspflichtige Maßnahmen
§ 2. (1) Einer Bewilligung bedürfen die Errichtung und die Änderung von Bauten.
Bewilligungsfreie Maßnahmen
§ 3. (1) Keiner Bewilligung bedürfen Gartenhütten bis 12 m² Grundfläche.
(2) Die Bestimmungen über Abstände bleiben unberührt.
""",
    ),
    f"{_BO}Bundesnormen&Gesetzesnummer=10008910": (
        "ArbeitnehmerInnenschutzgesetz",
        """
ArbeitnehmerInnenschutzgesetz
Arbeitsstätten
§ 19. (1) Arbeitsstätten müssen den Erfordernissen des Schutzes der Arbeitnehmer entsprechen.
(2) Die Arbeitgeber haben dafür zu sorgen, dass Arbeitsstätten instand gehalten werden.
""",
    ),
    f"{_BO}LrW&Gesetzesnummer=20000061": (
        "Wiener Kleingartengesetz 1996",
        """
Wiener Kleingartengesetz 1996
Geltungsbereich
§ 1. (1) Dieses Gesetz gilt für Kleingärten im Gebiet der Stadt Wien.
Bebauung
§ 12. (1) Auf einem Kleingarten darf ein Kleingartenhaus errichtet werden.
""",
    ),
    "__default__": (
        "Rechtsvorschrift",
        """
Rechtsvorschrift
Geltungsbereich
§ 1. (1) Diese Vorschrift gilt im ganzen Landesgebiet.
(2) Sie gilt nicht für Bauten des Bundes.
Pflichten
§ 5. (1) Hunde sind an öffentlichen Orten an der Leine zu führen.
""",
    ),
}
