GENERIC_ERROR_MESSAGE = (
    "Bei der Recherche zu Ihrer Frage ist ein Fehler aufgetreten. Bitte versuchen Sie es noch einmal."
)

NO_SOURCES_MESSAGE = (
    "Ich habe die verfügbaren Quellen durchsucht, aber nichts gefunden, worauf sich "
    "eine Antwort auf diese Frage stützen ließe. Das kann vorübergehend sein – "
    "versuchen Sie es bitte noch einmal oder formulieren Sie die Frage um."
)

SCOPED_NO_SOURCES_MESSAGE = (
    "Ich habe die verfügbaren Quellen durchsucht, aber nichts gefunden, worauf sich "
    "eine Antwort stützen ließe. Stellen Sie die Frage gern weiter gefasst, oder "
    "ohne sie auf eine einzelne Datei einzugrenzen."
)

TOOLS_UNAVAILABLE_MESSAGE = (
    "Einige Suchfunktionen stehen derzeit nicht zur Verfügung. Bitte wenden Sie sich "
    "an Ihre Administration oder versuchen Sie es später noch einmal."
)

ZDR_MODEL_REFUSED_MESSAGE = (
    "Diese Frage konnte nicht beantwortet werden, weil das eingestellte Modell keinen Anbieter "
    "ohne Datenspeicherung hat und Ihre Organisation Zero Data Retention verlangt. Eine "
    "Administratorin oder ein Administrator muss unter Organisation → Modelle ein Modell mit "
    "Zero-Data-Retention-Anbieter wählen."
)

NO_RESPONSE_TEXT = "Es wurde keine Antwort erzeugt."

NON_ANSWER_PREFIXES: tuple[str, ...] = (
    NO_RESPONSE_TEXT,
    GENERIC_ERROR_MESSAGE,
    NO_SOURCES_MESSAGE,
    SCOPED_NO_SOURCES_MESSAGE,
    TOOLS_UNAVAILABLE_MESSAGE,
    ZDR_MODEL_REFUSED_MESSAGE,
)
