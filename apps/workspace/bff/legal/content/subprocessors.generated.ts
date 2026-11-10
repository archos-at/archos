// AUTO-GENERATED from configs/subprocessors/*.yaml — do not edit; run
// `.venv/bin/python scripts/generate_subprocessor_pages.py`. Strings may hold
// `{productName}`: read them through `withProductName`.
import type { LegalTable } from '../types'

/** The generated parts of the processor page in one language. */
export interface SubprocessorPageParts {
  processors: LegalTable
  selfHosted: LegalTable
  latent: string[]
  publicSources: string[]
  build: string[]
}

export const SUBPROCESSOR_PAGE: Record<'de' | 'en', SubprocessorPageParts> = {
  "de": {
    "processors": {
      "headers": [
        "Dienst",
        "Zweck",
        "Verarbeitete Daten",
        "Standort",
        "Übermittlungsgrundlage",
        "Erforderlich?"
      ],
      "rows": [
        [
          "IPAX (Hosting-Anbieter)",
          "Betrieb der Anwendung, Datenbanken und des Objektspeichers; nächtliche Sicherungskopien (Velero)",
          "Alle Anwendungsdaten",
          "Österreich (Wien)",
          "Keine Drittlandübermittlung (EU/EWR)",
          "Ja"
        ],
        [
          "OpenRouter, Inc.",
          "KI-Gateway für alle Sprachmodell-, Embedding-, Bildmodell- und Transkriptionsanfragen",
          "Chat-Nachrichten; Dokumentinhalte, die eine Frage braucht (Passagen, bei Bedarf ganze Seiten); beim Einlesen jede Seite eines Dokuments; abgerufene Vorschriften; erzeugte Antworten; Audio von Diktaten",
          "USA (Gateway); vorgelagerter Modellanbieter variiert — siehe Hinweis unten",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Ja"
        ],
        [
          "Vorgelagerte KI-Modellanbieter (via OpenRouter, z. B. DeepSeek, OpenAI, Anthropic, Google, Meta, Mistral)",
          "Betrieb des von Ihrer Organisation gewählten KI-Modells",
          "Gleiche Inhalte wie OpenRouter",
          "Abhängig vom gewählten Modell (auch außerhalb EU/EWR möglich)",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Jeweils eines, je Organisation gewählt"
        ],
        [
          "ElevenLabs (via OpenRouter; Ausweichmodell OpenAI Whisper)",
          "Spracheingabe im Chat (Diktat in Text umwandeln); von der Plattform festgelegt, nicht von Ihrer Organisation gewählt",
          "Audioaufnahme des Diktats",
          "USA",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Nur wenn jemand diktiert"
        ],
        [
          "WorkOS, Inc.",
          "Identität & Anmeldung (SSO, MFA), Autorisierung, Audit-Log-Speicherung",
          "Name, E-Mail, Organisationszugehörigkeit, Rollen, Anmeldeereignisse, Audit-Ereignisse (inkl. IP-Adresse sowie Namen von Organisationen, Projekten und Dokumenten, soweit die betroffene Ablage für alle Projektmitglieder sichtbar ist)",
          "USA",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Ja"
        ],
        [
          "PostHog, Inc.",
          "Produktanalyse, Sitzungsaufzeichnung, Fehlererfassung, Betriebsprotokolle (ab Warnstufe), Umfragen, Support",
          "Nutzer-ID (WorkOS), Organisations-ID und -Name, Rolle, Sprache, Seitenaufrufe, Bedienereignisse, Geräte- und Browserangaben, Fehlerberichte und Betriebsprotokolle (ohne deren Text), maskierte Sitzungsaufzeichnungen, Umfrageantworten und Support-Nachrichten (Text maskiert durch die Inhaltsprüfung Ihrer Organisation); KI-Metadaten und Antwort-Bewertungen aus Langfuse. Keine E-Mail-Adresse, kein Name",
          "EU (Frankfurt); Konzern mit Sitz in den USA",
          "Speicherung in der EU; Zugriff aus den USA auf Grundlage des EU-US Data Privacy Framework und von Standardvertragsklauseln",
          "Ja (Produktanalyse, Fehlererfassung); Sitzungsaufzeichnung nur stichprobenweise und nur falls aktiviert; abschaltbar in den Profil-Einstellungen"
        ],
        [
          "Slack Technologies, LLC",
          "Interne Benachrichtigung unseres Teams über neue Rückmeldungen und Antwort-Bewertungen",
          "Ticketnummer, Art der Rückmeldung, Grund einer negativen Bewertung, Name der Organisation, Links; kein Text Ihrer Rückmeldungen oder Chats",
          "USA",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Ja"
        ],
        [
          "Tavily",
          "Websuche für Recherchefragen",
          "Aus Ihren Fragen abgeleitete (KI-generierte) Suchanfragen",
          "USA",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Ja (für Web-Recherche)"
        ],
        [
          "Cloudflare, Inc.",
          "DNS für die Domains von {productName}; Weiterleitung der www-Adresse auf die Hauptdomain; Empfang und Weiterleitung von E-Mails an Projektadressen (Email Routing), falls Ihre Organisation die Funktion freigeschaltet hat",
          "DNS-Abfragen der Domainnamen; nur bei Aufrufen der www-Adresse die IP-Adresse der Besucherin bzw. des Besuchers und die aufgerufene Adresse. E-Mails an Projektadressen: Absender, Empfänger und die ganze Nachricht auf dem Weg zu {productName}. Die Anwendung selbst wird direkt erreicht, nicht über Cloudflare",
          "USA (weltweites Netzwerk)",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Ja"
        ],
        [
          "komoot GmbH (öffentlicher Photon-Dienst)",
          "Adresssuche beim Anlegen eines Projekts",
          "Die eingetippte Adresse, während Sie tippen; die Anfrage stellt unser Server, Ihre IP-Adresse erreicht komoot nicht",
          "Deutschland",
          "Keine Drittlandübermittlung (EU/EWR)",
          "Nur für die Adresssuche (vom Betreiber abschaltbar)"
        ],
        [
          "Push-Dienst Ihres Browsers (Google, Mozilla oder Apple)",
          "Zustellung von Benachrichtigungen, die Sie in Ihrem Browser erlaubt haben",
          "Eine verschlüsselte Benachrichtigung, die der Dienst nicht lesen kann, und die Adresse Ihres Browsers beim Dienst",
          "Abhängig von Ihrem Browser (meist USA)",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Nur wenn Sie Benachrichtigungen erlauben"
        ],
        [
          "OpenAI, Inc. (direkt)",
          "Nur mit einem eigenen OpenAI-Schlüssel Ihrer Organisation (BYOK) oder einer abweichenden Konfiguration des Betreibers",
          "Chat-Nachrichten, Dokumentauszüge, Projektprofil-Text, Audio von Diktaten",
          "USA",
          "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter zertifiziert ist",
          "Optional (nur falls konfiguriert)"
        ]
      ]
    },
    "selfHosted": {
      "headers": [
        "Komponente",
        "Zweck",
        "Gespeicherte Daten"
      ],
      "rows": [
        [
          "PostgreSQL",
          "Anwendungsdatenbank",
          "Projekte, Konversationen, Memory, Nutzungsledger, Konfiguration"
        ],
        [
          "SeaweedFS (S3-kompatibel / S3-compatible)",
          "Objektspeicher",
          "Hochgeladene Dokumente"
        ],
        [
          "Qdrant",
          "Vektorindex",
          "Embeddings von Dokumenten und Vorschriften"
        ],
        [
          "Dragonfly (Redis-kompatibel / Redis-compatible)",
          "Cache, Rate-Limiting",
          "Kurzlebige Betriebsdaten"
        ],
        [
          "Langfuse",
          "Nachvollziehbarkeit der KI-Anfragen (Tracing)",
          "Fragen, Antworten und Zwischenschritte der KI einschließlich gefundener Dokumentauszüge; Bewertungen"
        ],
        [
          "Hatchet",
          "Warteschlange für Hintergrundarbeit",
          "Aufträge und ihre Zwischenstände"
        ],
        [
          "ClamAV",
          "Virenprüfung von Anhängen, die Externe senden",
          "Keine: geprüfte Dateien werden nicht gespeichert"
        ]
      ]
    },
    "latent": [
      "Modal Labs (USA) — Isolierte Code-Ausführung bei Tiefenrecherchen; Code und Daten, die der Recherche-Agent ausführt.",
      "Serper (Google-Suche) (USA) — aus Ihren Fragen abgeleitete Suchanfragen; derzeit mit keinem Codepfad verbunden.",
      "Jina AI (Deutschland) — Dokumentauszüge zur Neusortierung von Suchtreffern; derzeit mit keinem Codepfad verbunden.",
      "Weights & Biases (USA) — Evaluierungsläufe; derzeit mit keinem Codepfad verbunden.",
      "LangSmith (LangChain) (USA) — vollständige KI-Eingaben und -Antworten, falls Tracing aktiviert wird.",
      "Datadog RUM (USA) — Browser-Performance-/Nutzungstelemetrie, falls vom Deployment eingebunden.",
      "Anthropic (direkt, ohne OpenRouter) (USA) — Chat-Nachrichten und Dokumentauszüge, falls ein Modell direkt angebunden wird.",
      "Google Gemini (direkt, ohne OpenRouter) (USA) — Chat-Nachrichten und Dokumentauszüge, falls ein Modell direkt angebunden wird."
    ],
    "publicSources": [
      "Rechtsinformationssystem des Bundes (Bundeskanzleramt, Österreich): Suchbegriffe und Kennungen von Rechtsvorschriften, die aus Ihren Fragen abgeleitet sind"
    ],
    "build": [
      "GitHub (USA) — Quellcode-Hosting, CI-Pipelines, Sicherheits-Scans.",
      "SonarSource / SonarQube Cloud (EU/CH) — statische Analyse des Quellcodes.",
      "Paket-Registries, Helm-Charts und Basis-Images (PyPI, npm, Docker Hub, NVIDIA NGC, Debian-/Node-Mirrors) — Software-Abhängigkeiten, die zur Build- und Deploy-Zeit geladen werden.",
      "Let’s Encrypt (USA) — TLS-Zertifikate für die Domains von {productName}; erhält nur die Domainnamen.",
      "ClamAV-Signaturen (Cisco Talos) — Signaturen für die Virenprüfung werden heruntergeladen; nichts wird hochgeladen.",
      "Google Fonts — Schriften werden einmalig zur Build-Zeit geladen und selbst gehostet; Ihr Browser kontaktiert bei der Nutzung von {productName} niemals Google."
    ]
  },
  "en": {
    "processors": {
      "headers": [
        "Service",
        "Purpose",
        "Data processed",
        "Location",
        "Transfer safeguard",
        "Required?"
      ],
      "rows": [
        [
          "IPAX (hosting provider)",
          "Runs the application, databases and object storage; nightly backup copies (Velero)",
          "All application data",
          "Austria (Vienna)",
          "No third-country transfer (EU/EEA)",
          "Yes"
        ],
        [
          "OpenRouter, Inc.",
          "AI gateway for all language-model, embedding, vision-model and transcription requests",
          "Chat messages; the document content a question needs (passages, and whole pages where needed); every page of a document when it is read in; retrieved regulations; generated answers; dictation audio",
          "USA (gateway); upstream model provider varies — see notice below",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "Yes"
        ],
        [
          "Upstream AI model providers (via OpenRouter, e.g. DeepSeek, OpenAI, Anthropic, Google, Meta, Mistral)",
          "Operating the AI model selected by your organization",
          "Same content as OpenRouter receives",
          "Depends on selected model (may be outside EU/EEA)",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "One at a time, selected per organization"
        ],
        [
          "ElevenLabs (via OpenRouter; fallback model OpenAI Whisper)",
          "Voice input in the chat (turning dictation into text); fixed by the platform, not chosen by your organization",
          "The dictation's audio recording",
          "USA",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "Only when someone dictates"
        ],
        [
          "WorkOS, Inc.",
          "Identity & sign-in (SSO, MFA), authorization, audit-log storage",
          "Name, email, organization membership, roles, sign-in events, audit events (incl. IP address and the names of organizations, projects and documents, where the folder concerned is visible to every project member)",
          "USA",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "Yes"
        ],
        [
          "PostHog, Inc.",
          "Product analytics, session replay, error tracking, operational logs (warning level and above), surveys, support",
          "User ID (WorkOS), organization ID and name, role, language, page views, interaction events, device and browser details, error reports and operational logs (without their text), masked session recordings, survey answers and support messages (text masked by your organization's content screening); AI metadata and answer ratings from Langfuse. No email address, no name",
          "EU (Frankfurt); group headquartered in the USA",
          "Stored in the EU; access from the USA under the EU-US Data Privacy Framework and standard contractual clauses",
          "Yes (product analytics, error tracking); session replay sampled and only if enabled; can be switched off in profile settings"
        ],
        [
          "Slack Technologies, LLC",
          "Notifying our team internally about new reports and answer ratings",
          "Ticket number, kind of report, reason of a negative rating, organization name, links; no text of your reports or chats",
          "USA",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "Yes"
        ],
        [
          "Tavily",
          "Web search for research questions",
          "Search queries derived from your questions (AI-generated from your prompts)",
          "USA",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "Yes (for web research)"
        ],
        [
          "Cloudflare, Inc.",
          "DNS for the {productName} domains; redirects the www address to the main domain; receiving and forwarding mail to project addresses (Email Routing), where your organization has switched the feature on",
          "DNS lookups of the domain names; for requests to the www address only, the visitor’s IP address and the requested address. Mail to project addresses: sender, recipients and the whole message on its way to {productName}. The application itself is reached directly, not through Cloudflare",
          "USA (global network)",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "Yes"
        ],
        [
          "komoot GmbH (public Photon service)",
          "Address search when creating a project",
          "The address you type, while you type it; our server makes the request, so your IP address does not reach komoot",
          "Germany",
          "No third-country transfer (EU/EEA)",
          "Only for address search (the operator can switch it off)"
        ],
        [
          "Your browser's push service (Google, Mozilla or Apple)",
          "Delivering notifications you allowed in your browser",
          "An encrypted notification the service cannot read, and your browser's address at the service",
          "Depends on your browser (usually USA)",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "Only if you allow notifications"
        ],
        [
          "OpenAI, Inc. (direct)",
          "Only with your organization's own OpenAI key (BYOK) or an operator configuration that points there",
          "Chat messages, document excerpts, project profile text, dictation audio",
          "USA",
          "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is certified",
          "Optional (only if configured)"
        ]
      ]
    },
    "selfHosted": {
      "headers": [
        "Component",
        "Purpose",
        "Data held"
      ],
      "rows": [
        [
          "PostgreSQL",
          "Application database",
          "Projects, conversations, memory, usage ledger, configuration"
        ],
        [
          "SeaweedFS (S3-kompatibel / S3-compatible)",
          "Object storage",
          "Uploaded documents"
        ],
        [
          "Qdrant",
          "Vector index",
          "Document and regulation embeddings"
        ],
        [
          "Dragonfly (Redis-kompatibel / Redis-compatible)",
          "Cache, rate limiting",
          "Short-lived operational data"
        ],
        [
          "Langfuse",
          "Tracing of AI requests",
          "The AI's questions, answers and intermediate steps, including retrieved document excerpts; ratings"
        ],
        [
          "Hatchet",
          "Queue for background work",
          "Jobs and their intermediate state"
        ],
        [
          "ClamAV",
          "Malware scanning of attachments sent from outside",
          "None: scanned files are not stored"
        ]
      ]
    },
    "latent": [
      "Modal Labs (USA) — sandboxed code execution during deep research; code and data the research agent chooses to execute.",
      "Serper (Google search) (USA) — search queries derived from your questions; not wired to any code path today.",
      "Jina AI (Germany) — document excerpts for re-ranking search hits; not wired to any code path today.",
      "Weights & Biases (USA) — evaluation runs; not wired to any code path today.",
      "LangSmith (LangChain) (USA) — full AI prompts and responses, if tracing is enabled.",
      "Datadog RUM (USA) — browser performance/usage telemetry, if injected by the deployment.",
      "Anthropic (direct, without OpenRouter) (USA) — chat messages and document excerpts, if a model is connected directly.",
      "Google Gemini (direct, without OpenRouter) (USA) — chat messages and document excerpts, if a model is connected directly."
    ],
    "publicSources": [
      "Federal Legal Information System (Federal Chancellery, Austria): search terms and identifiers of legal provisions derived from your questions"
    ],
    "build": [
      "GitHub (USA) — source-code hosting, CI pipelines, security scanning.",
      "SonarSource / SonarQube Cloud (EU/CH) — static analysis of source code.",
      "Package registries, Helm charts and base images (PyPI, npm, Docker Hub, NVIDIA NGC, Debian/Node mirrors) — software dependencies fetched at build and deploy time.",
      "Let’s Encrypt (USA) — TLS certificates for the {productName} domains; receives only the domain names.",
      "ClamAV signatures (Cisco Talos) — malware signatures are downloaded; nothing is uploaded.",
      "Google Fonts — fonts are downloaded once at build time and self-hosted; your browser never contacts Google when using {productName}."
    ]
  }
}
