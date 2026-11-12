/**
 * Two answers as the server stored them (2026-11-12, a dev environment), trimmed:
 * the rows the Herleitung header misread. `UNBACKED` cites two sources and its
 * answer check found two statements unbacked; `ASKED_BACK` read the office's
 * documents and then asked for the site. `/dev/derivation` maps them through
 * `mapServerMessageToChatMessage`, as a reload does.
 */

import type { ServerMessageInput } from '@/features/chat/lib/server-message-mapper'

export interface StoredAnswer {
  question: string
  answer: ServerMessageInput
}

export const UNBACKED: StoredAnswer = {
  question:
    'Wie hoch muss die Absturzsicherung eines Balkons im 3. Obergeschoß mindestens sein, und welche Ausgabe der OIB-Richtlinie 4 gilt hier seit wann?',
  answer: {
    id: '585ddd7a-f68c-5126-a489-065826ae29f3',
    role: 'assistant',
    content:
      'Für den Balkon im Burgenland beträgt die Mindesthöhe **1,00 m**; bei einer Absturzhöhe von **mehr als 12 m** sind es **1,10 m**, jeweils gemessen ab der Standfläche [1]. Aus dem 3. Obergeschoß allein lässt sich die maßgebliche Absturzhöhe nicht bestimmen.\n\n\n\nBei einer Brüstung mit mindestens 20 cm oberer Tiefe darf die Höhe um die halbe Brüstungstiefe reduziert werden; 85 cm dürfen dabei nicht unterschritten werden [1].\n\n**Geltende Ausgabe:** Im Burgenland gilt die OIB-Richtlinie 4, **Ausgabe April 2019**, seit **10. April 2021**. Die Novelle LGBl. Nr. 22/2021 wurde am 9. April 2021 kundgemacht; § 43 Abs. 6 der Bauverordnung bestimmt das Inkrafttreten am folgenden Tag [2]. Die Ausgabe Mai 2023 ist hier nicht die verbindliche Ausgabe.\n\nDie tatsächliche Absturzhöhe ist anhand des Gelände- und Balkonanschlusses zu prüfen. Bei einer Bauführung im Bestand sind außerdem die Anwendbarkeit und allfällige Übergangsbestimmungen gesondert zu prüfen.\n\n## Quellen\n- [1] [KB] oib-rl-4-2019-text-bfe3f994b9b6.pdf, p.11\n- [2] [RIS] Burgenländische Bauverordnung 2008, § 43 (Fassung 2016-10-25)\n',
    createdAt: '2026-11-12T08:55:09.237Z',
    metadata: {
      messageType: 'agent_response',
      citations: {
        v: 1,
        sources: [
          {
            kind: 'building_law',
            lane: 'building_law_base',
            page: 11,
            role: 'binding',
            tool: 'knowledge_search',
            as_of: '2026-11-12',
            route: {
              work_id: 'work:bgld-bauvo',
              provision: 'Bgld. BauVO 2008 idF LGBl. 22/2021',
              designation: 'Bgld. BauVO 2008',
            },
            score: 1,
            shelf: 'base',
            title: 'OIB-Richtlinie 4, Ausgabe April 2019',
            clause: '4.2',
            number: 1,
            origin: 'kb',
            content: '[KB] oib-rl-4-2019-text-bfe3f994b9b6.pdf, p.11',
            snippet:
              '4 Schutz vor Absturzunfällen › 4.2 Anforderungen an Absturzsicherungen\n\n4.2.1 Die Höhe der Absturzsicherung hat mindestens 1,00 m, ab einer Absturzhöhe von mehr als 12 m\nmindestens 1,10 m zu betragen. Bei Wohnungstreppen genügt eine Höhe der Absturzsicherung\nvon 90 cm. Die Höhe der Absturzsicherung wird von der Standfläche gemessen. Bei Absturzsicherungen mit einer oberen Tiefe von mindestens 20 c',
            work_id: 'work:oib-rl-4',
            language: 'de',
            file_name: 'oib-rl-4-2019-text-bfe3f994b9b6.pdf',
            freshness: 'check_due',
            collection: 'oib_knowledge',
            edition_id: 'edition:oib-rl-4-2019',
            lane_label: 'Basisdokument',
            role_since: '2021-04-10',
            designation: 'OIB-Richtlinie 4',
            document_id: 'doc:oib_knowledge:oib-rl-4-2019-text-bfe3f994b9b6.pdf',
            role_labels: ['check_overdue', 'unchecked_since'],
            source_type: 'knowledge_layer',
            text_status: 'authentic',
            citation_key: 'oib-rl-4-2019-text-bfe3f994b9b6.pdf, p.11',
            edition_label: 'Ausgabe April 2019',
            binding_status: 'declared_binding',
          },
          {
            kind: 'building_law',
            lane: 'building_law_ris',
            tool: 'law_lookup',
            score: 1,
            shelf: 'base',
            title: 'Burgenländische Bauverordnung 2008',
            clause: '§ 43',
            number: 2,
            origin: 'ris',
            content: '[RIS] Burgenländische Bauverordnung 2008, § 43 (Fassung 2016-10-25)',
            snippet:
              '§ 43\nInkrafttreten und Übergangsbestimmungen\n(1)\nDiese Verordnung tritt am auf die Kundmachung folgenden Monatsersten, frühestens jedoch mit dem In-Kraft-Treten des Gesetzes\nLGBl. Nr. 53/2008\n(Burgenländische Baugesetz-Novelle 2008) in Kraft.\n(2)\nGleichzeitig tritt die Verordnung der Burgenländischen Landesregierung vom 2. Feber 1998, mit der Vorschriften über die Zulässigkeit von Bauvorhaben erla',
            revision: {
              date: '2016-10-25',
            },
            collection: 'ris/LrKons/Burgenland',
            lane_label: 'Rechtsquelle (RIS)',
            public_url:
              'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrBgld&Gesetzesnummer=20000684',
            document_id:
              'doc:ris/lrkons/burgenland:burgenländische bauverordnung 2008, § 43 (fassung 2016-10-25)',
            source_type: 'knowledge_layer',
            citation_key: 'Burgenländische Bauverordnung 2008, § 43 (Fassung 2016-10-25)',
            retrieved_at: '2026-11-12',
            binding_status: 'unknown',
          },
        ],
      },
      answerMeta: {
        v: 1,
        kind: 'ruling',
        verdict: {
          value: '1,00 m bzw. 1,10 m',
          subject: 'Mindesthöhe der Balkon-Absturzsicherung',
          reference: {
            edition: 'Ausgabe April 2019',
            section: 'Punkt 4.2.1',
            document: 'OIB-Richtlinie 4',
          },
        },
      },
      provenance: {
        confidenceCheck: {
          level: 'low',
          status: 'judged',
          findings: [
            {
              reason:
                'Die angeführte Passage zu § 43 ist eine Fassung von 2016 und enthält weder LGBl. Nr. 22/2021 noch ein Inkrafttreten der Ausgabe April 2019. Keine Passage im Belegblock belegt das behauptete Datum oder die landesrechtliche Geltung dieser Ausgabe.',
              source: '[2] Burgenländische Bauverordnung 2008, § 43 (Fassung 2016-10-25)',
              problem: 'unbacked',
              statement:
                'Im Burgenland gilt die OIB-Richtlinie 4, Ausgabe April 2019, seit 10. April 2021; LGBl. Nr. 22/2021 wurde am 9. April kundgemacht und § 43 Abs. 6 setzt das Inkrafttreten auf den Folgetag.',
            },
            {
              reason:
                'Die Belege zeigen den Text der Ausgabe Mai 2023, enthalten aber keine Passage dazu, welche Ausgabe im Burgenland verbindlich ist. Damit ist die zentrale Aussage zur geltenden Ausgabe nicht belegt.',
              source: 'none',
              problem: 'unbacked',
              statement: 'Die Ausgabe Mai 2023 ist hier nicht die verbindliche Ausgabe.',
            },
          ],
        },
        answerConfidence: 'low',
        answerConfidenceReason:
          'Die Rechtsgrundlagen sind belegt; die tatsächliche Absturzhöhe ist nicht bekannt.',
        answerConfidenceVersion: 2,
        routingDecision: 'shallow',
        retrievalLedger: [
          {
            key: 'status.retrieval.withQuery',
            docs: [
              {
                name: 'oib-rl_4_ausgabe_mai_2023.pdf',
                shelf: 'base',
                title: 'OIB-Richtlinie 4, Ausgabe Mai 2023',
                detail: 'Pkt. 0 p.4',
                repeat: false,
              },
              {
                name: 'erlaeuterungen_oib-rl_4_ausgabe_mai_2023.pdf',
                shelf: 'base',
                title: 'Erläuterungen zu OIB-Richtlinie 4, Ausgabe Mai 2023',
                detail: 'p.4',
                repeat: false,
              },
              {
                name: 'erlaeuterungen_oib-rl_4_ausgabe_mai_2023.pdf',
                shelf: 'base',
                title: 'Erläuterungen zu OIB-Richtlinie 4, Ausgabe Mai 2023',
                detail: 'p.3',
                repeat: false,
              },
              {
                name: 'oib-rl-4-erlaeuterungen-2023-text-50805c4014e5.pdf',
                shelf: 'base',
                title: 'OIB-Richtlinie 4 - Erläuterungen, Ausgabe Mai 2023',
                detail: 'Pkt. Nutzungssicherheit und Barrierefreiheit › Allgemeines p.4',
                repeat: false,
              },
              {
                name: 'oib-rl-4-erlaeuterungen-2019-text-fd42ad249c36.pdf',
                shelf: 'base',
                title: 'OIB-Richtlinie 4 - Erläuterungen, Ausgabe April 2019',
                detail: 'Pkt. Nutzungssicherheit und Barrierefreiheit › Allgemeines p.4',
                repeat: false,
              },
            ],
            hits: 27,
            index: 0,
            query: 'Wie hoch muss die Absturzsicher…',
            tools: ['knowledge_search', 'knowledge_search'],
            corpora: ['knowledge'],
            newDocs: [
              'oib-rl_4_ausgabe_mai_2023.pdf',
              'erlaeuterungen_oib-rl_4_ausgabe_mai_2023.pdf',
              'oib-rl-4-erlaeuterungen-2023-text-50805c4014e5.pdf',
              'oib-rl-4-erlaeuterungen-2019-text-fd42ad249c36.pdf',
              'oib-rl-4-2023-text-7ad87c47e2b7.pdf',
            ],
            documents: 6,
          },
          {
            key: 'status.retrieval.withQuery',
            docs: [
              {
                name: 'oib-rl-4-2019-text-bfe3f994b9b6.pdf',
                shelf: 'base',
                title: 'OIB-Richtlinie 4, Ausgabe April 2019',
                detail: 'Pkt. 4.2 p.11',
                repeat: true,
              },
              {
                name: 'oib-rl-4-2019-text-bfe3f994b9b6.pdf',
                shelf: 'base',
                title: 'OIB-Richtlinie 4, Ausgabe April 2019',
                detail: 'Pkt. 4.2 p.12',
                repeat: true,
              },
              {
                name: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrBgld&Gesetzesnummer=20000684',
                title: 'Burgenländische Bauverordnung 2008',
                detail: '§ 36',
                repeat: false,
              },
              {
                name: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrBgld&Gesetzesnummer=20000684',
                title: 'Burgenländische Bauverordnung 2008',
                detail: '§ 39',
                repeat: false,
              },
              {
                name: 'Burgenländische Bauverordnung 2008, § 36 (Fassung 2021-04-10)',
                shelf: 'base',
                repeat: false,
              },
            ],
            hits: 8,
            index: 1,
            query: 'Welche Ausgabe der OIB-Richtlin…',
            tools: ['law_lookup', 'law_lookup', 'read_file'],
            reason: 'Ich prüfe die Höhe und die Ausnahmen in der Ausgabe April 2019.',
            corpora: ['ris', 'knowledge'],
            newDocs: [
              'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrBgld&Gesetzesnummer=20000684',
              'Burgenländische Bauverordnung 2008, § 36 (Fassung 2021-04-10)',
              'Burgenländische Bauverordnung 2008, § 39 (Fassung 2021-04-10)',
              'Burgenländische Bauverordnung 2008, § 36 (Fassung 2026-11-05)',
              'Burgenländische Bauverordnung 2008, § 39 (Fassung 2026-11-05)',
            ],
            documents: 6,
          },
          {
            key: 'status.retrieval.withQuery',
            docs: [
              {
                name: 'https://www.austrian-standards.at/de/shop/oib-richtlinie-4-2019-04~p2476090',
                title: 'OIB Richtlinie 4:2019 04 | Austrian Standards',
                repeat: false,
              },
              {
                name: 'https://www.austrian-standards.at/de/shop/oib-richtlinie-4-2019-04~p2476091',
                title: 'OIB Richtlinie 4:2019 04 | Austrian Standards',
                repeat: false,
              },
              {
                name: 'https://www.austrian-standards.at/de/shop/oib-richtlinie-2-2-2019-04~p2476078',
                title: 'OIB Richtlinie 2.2:2019 04 | Austrian Standards',
                repeat: false,
              },
              {
                name: 'https://www.austrian-standards.at/de/shop/oib-richtlinie-2-2019-04~p2476064',
                title: 'OIB Richtlinie 2:2019 04 | Austrian Standards',
                repeat: false,
              },
              {
                name: 'https://www.austrian-standards.at/de/shop/oib-richtlinie-6-2018-02~p2401713',
                title: 'OIB Richtlinie 6:2018 02 | Austrian Standards',
                repeat: false,
              },
            ],
            hits: 10,
            index: 2,
            query: 'Welche Inkrafttretensregel enth…',
            tools: ['law_lookup', 'web_search_tool', 'law_lookup', 'grep'],
            corpora: ['ris', 'web', 'documents'],
            newDocs: [
              'https://www.austrian-standards.at/de/shop/oib-richtlinie-4-2019-04~p2476090',
              'https://www.austrian-standards.at/de/shop/oib-richtlinie-4-2019-04~p2476091',
              'https://www.austrian-standards.at/de/shop/oib-richtlinie-2-2-2019-04~p2476078',
              'https://www.austrian-standards.at/de/shop/oib-richtlinie-2-2019-04~p2476064',
              'https://www.austrian-standards.at/de/shop/oib-richtlinie-6-2018-02~p2401713',
            ],
            documents: 10,
          },
          {
            key: 'status.retrieval.withQuery',
            docs: [
              {
                name: 'https://www.austrian-standards.at/de/shop/oib-richtlinie-2-2019-04~p2476064',
                title: 'OIB Richtlinie 2:2019 04 | Austrian Standards',
                repeat: true,
              },
              {
                name: 'https://www.austrian-standards.at/de/shop/oib-richtlinie-6-2018-02~p2401713',
                title: 'OIB Richtlinie 6:2018 02 | Austrian Standards',
                repeat: true,
              },
              {
                name: 'https://www.austrian-standards.at/de/shop/oib-richtlinie-2-leitfaden-2015-03~p2132686',
                title: 'OIB Richtlinie 2 - Leitfaden:2015 03 | Austrian Standards',
                repeat: false,
              },
              {
                name: 'https://repositum.tuwien.at/bitstream/20.500.12708/19568/1/Skolud%20Matthias%20-%202021%20-%20Brandschutzrechtliche%20Rahmenbedingungen%20holzbasierter...pdf',
                title: 'Brandschutzrechtliche Rahmenbedingungen holzbasierter ...',
                repeat: true,
              },
              {
                name: 'https://www.meta-wissen-holzbau.at/normen_recht/SitePages/Besonders%20f%C3%BCr%20den%20Holzbau%20relevante%20Regelungen%20in%20den%20OIB-Richtlinien.aspx',
                title:
                  'Normen & Recht - Besonders für den Holzbau relevante Regelungen in den OIB-Richtlinien',
                repeat: false,
              },
            ],
            hits: 14,
            index: 3,
            query: 'Was sagt die Bauverordnung zum…',
            tools: ['law_lookup', 'web_search_tool', 'ls'],
            corpora: ['ris', 'web', 'knowledge'],
            newDocs: [
              'https://www.austrian-standards.at/de/shop/oib-richtlinie-2-leitfaden-2015-03~p2132686',
              'https://www.meta-wissen-holzbau.at/normen_recht/SitePages/Besonders%20f%C3%BCr%20den%20Holzbau%20relevante%20Regelungen%20in%20den%20OIB-Richtlinien.aspx',
              'https://www.austrian-standards.at/de/shop/oib-begriffsbestimmungen-2019-04~p2476113',
              'https://www.ag.ch/de/themen/planen-bauen/baurecht/bauverordnung-(bauv)',
              'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrBgld&Gesetzesnummer=20000684',
            ],
            documents: 13,
          },
          {
            key: 'status.retrieval.withQuery',
            docs: [
              {
                name: 'https://www.oerok.gv.at/fileadmin/user_upload/Bilder/2.Reiter-Raum_u._Region/2.Daten_und_Grundlagen/Rechtssammlung/2_Rechtschronik_2021-I.pdf',
                title: 'Rechtschronik 2021-I (1. Halbjahr 2021)',
                repeat: false,
              },
              {
                name: 'https://repositum.tuwien.at/bitstream/20.500.12708/19568/1/Skolud%20Matthias%20-%202021%20-%20Brandschutzrechtliche%20Rahmenbedingungen%20holzbasierter...pdf',
                title: 'Brandschutzrechtliche Rahmenbedingungen holzbasierter ...',
                repeat: true,
              },
              {
                name: 'https://www.hagebau-wallner.at/popup.aspx?r=403%24ebau%24%24PARA%24%24107%24%24357%24%242392%24%2411328%24%24%24%24%40%40',
                title: 'hagebau Baurechtsdatenbank - Heizungs',
                repeat: false,
              },
              {
                name: 'https://volksanwaltschaft.gv.at/fileadmin/user_upload/Downloads/Berichte/LT/W/43-wien-bericht-2021_bf-1.pdf',
                title: 'Bericht der Volksanwaltschaft an den Wiener Landtag 2021',
                repeat: false,
              },
              {
                name: 'https://www.wien.gv.at/ma08/infodat/2022/167915.pdf',
                title: 'Bericht der Volksanwaltschaft an den Wiener Landtag 2021',
                repeat: false,
              },
            ],
            hits: 11,
            index: 4,
            query: 'Was lautet die Inkrafttretens-…',
            tools: ['law_lookup', 'web_search_tool', 'law_lookup'],
            corpora: ['ris', 'web'],
            newDocs: [
              'https://www.oerok.gv.at/fileadmin/user_upload/Bilder/2.Reiter-Raum_u._Region/2.Daten_und_Grundlagen/Rechtssammlung/2_Rechtschronik_2021-I.pdf',
              'https://www.hagebau-wallner.at/popup.aspx?r=403%24ebau%24%24PARA%24%24107%24%24357%24%242392%24%2411328%24%24%24%24%40%40',
              'https://volksanwaltschaft.gv.at/fileadmin/user_upload/Downloads/Berichte/LT/W/43-wien-bericht-2021_bf-1.pdf',
              'https://www.wien.gv.at/ma08/infodat/2022/167915.pdf',
              'https://www.bmimi.gv.at/dam/jcr:b2c25693-eac7-43e0-8a79-df98574ce6d4/SP-V_S1_Umweltbericht.pdf',
            ],
            documents: 11,
          },
        ],
      },
    },
  },
}

export const ASKED_BACK: StoredAnswer = {
  question:
    'Welche Ausgabe der OIB-Richtlinie 6 galt für eine Einreichung am 1. Oktober 2026, und welche gilt für eine Einreichung heute? Seit wann?',
  answer: {
    id: '00f26922-8f90-585c-8b6a-952c7a741c38',
    role: 'assistant',
    content:
      'Welche Ausgabe an den beiden Tagen galt und seit wann, lässt sich ohne den Standort des Bauvorhabens nicht bestimmen. Die Übernahme der OIB-Richtlinie und mögliche Übergangsbestimmungen hängen vom anwendbaren Landesrecht ab.\n\nIn welchem Land und Bundesland liegt das Bauvorhaben?',
    createdAt: '2026-11-12T08:52:16.091Z',
    metadata: {
      messageType: 'agent_response',
      provenance: {
        confidenceCheck: {
          level: 'medium',
          status: 'judged',
          findings: [
            {
              reason:
                'Die Evidenz enthält zwar einen Eintrag zur OIB-Richtlinie 6, Ausgabe 2025, aber keine Passage zu ihrer Geltung, zum Inkrafttreten oder zu landesrechtlichen Übernahmen und Übergangsbestimmungen. Daher ist weder die behauptete Standortabhängigkeit belegt noch die erbetene zeitliche Einordnung beantwor',
              source: 'none',
              problem: 'unbacked',
              statement:
                'Ohne Standort lässt sich nicht bestimmen, welche Ausgabe am 1. Oktober 2026 und heute galt; die Übernahme und Übergangsbestimmungen hängen vom anwendbaren Landesrecht ab.',
            },
          ],
        },
        answerConfidence: 'medium',
        answerConfidenceReason:
          'Der Standort und damit das anwendbare Landesrecht sind nicht bestätigt',
        answerConfidenceVersion: 2,
        routingDecision: 'shallow',
        retrievalLedger: [
          {
            key: 'status.retrieval.withQuery',
            docs: [
              {
                name: 'Übersicht_Baurecht_Wien.jpg',
                shelf: 'office_shelf',
                detail: 'p.1',
                repeat: false,
              },
              {
                name: 'Planungsbericht_2024-118_LPH5_RevC.pdf',
                shelf: 'office_shelf',
                detail: 'p.3',
                repeat: false,
              },
              {
                name: 'Planungsbericht_2024-118_LPH5_RevC.pdf',
                shelf: 'office_shelf',
                detail: 'p.1',
                repeat: false,
              },
              {
                name: 'Planungsbericht_2024-118_LPH5_RevC.pdf',
                shelf: 'office_shelf',
                detail: 'p.2',
                repeat: false,
              },
              {
                name: 'pro clima 01_Holzmassivbau_Sockeldetails.pdf',
                shelf: 'office_shelf',
                detail: 'Pkt. OKFFB GOK p.1',
                repeat: false,
              },
            ],
            hits: 18,
            index: 0,
            query: 'Welche Ausgabe der OIB-Richtlin…',
            tools: ['knowledge_search'],
            corpora: ['knowledge'],
            newDocs: [
              'Übersicht_Baurecht_Wien.jpg',
              'Planungsbericht_2024-118_LPH5_RevC.pdf',
              'pro clima 01_Holzmassivbau_Sockeldetails.pdf',
              'Ifc2x3_SampleCastle.ifc',
              '021-01 GR_UG-1. Untergeschoss.pdf',
            ],
            documents: 9,
          },
        ],
      },
    },
  },
}
