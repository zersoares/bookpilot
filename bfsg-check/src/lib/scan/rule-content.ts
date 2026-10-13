/**
 * Kuratierte deutsche Texte zu axe-core-Regeln.
 *
 * Wichtig: Dieser Katalog erzeugt KEINE Befunde. Befunde stammen ausschließlich
 * aus dem tatsächlichen axe-core-Lauf; hier stehen nur Erklärung, betroffene
 * Gruppen und Lösungshinweise zu einer bereits gefundenen Regel.
 * Für Regeln ohne Eintrag greift `genericContent` (kennzeichnet sich selbst).
 */

export const WHO = {
  keyboard: "Tastaturnutzende",
  screenreader: "Screenreader-Nutzende",
  lowVision: "Menschen mit Sehbehinderung",
  colorBlind: "Menschen mit Farbsehschwäche",
  motor: "Menschen mit motorischen Einschränkungen",
  cognitive: "Menschen mit kognitiven oder Lernbeeinträchtigungen",
  deaf: "Gehörlose und schwerhörige Menschen",
  voice: "Nutzende von Sprachsteuerung",
} as const;

type Who = (typeof WHO)[keyof typeof WHO];

export interface RuleContent {
  title: string;
  explanation: string;
  affected: Who[];
  remediation: string[];
}

const { keyboard: KB, screenreader: SR, lowVision: LV, colorBlind: CB, motor: MO, cognitive: CO, deaf: DF, voice: VO } = WHO;

export const RULE_CONTENT: Record<string, RuleContent> = {
  "image-alt": {
    title: "Bilder ohne Textalternative",
    explanation:
      "Bilder haben keine Textalternative. Screenreader können dann nur den Dateinamen oder gar nichts vorlesen; der Inhalt des Bildes geht verloren.",
    affected: [SR, LV],
    remediation: [
      "Informative Bilder erhalten ein alt-Attribut, das den Zweck oder Inhalt kurz beschreibt (nicht „Bild von …“).",
      "Rein dekorative Bilder erhalten alt=\"\" (leer), damit sie übersprungen werden.",
      "Bilder, die Links oder Buttons sind, beschreiben das Ziel bzw. die Aktion.",
    ],
  },
  "input-image-alt": {
    title: "Bildschaltflächen ohne Textalternative",
    explanation: "Eine Schaltfläche, die als Bild dargestellt wird, hat keinen zugänglichen Namen. Nutzende wissen nicht, was sie auslöst.",
    affected: [SR, VO],
    remediation: ["Ergänzen Sie ein alt-Attribut, das die Aktion beschreibt (z. B. „Suchen“).", "Alternativ einen echten <button> mit sichtbarem Text verwenden."],
  },
  "role-img-alt": {
    title: "Elemente mit Rolle „img“ ohne Beschreibung",
    explanation: "Ein Element wird als Bild ausgezeichnet, hat aber keinen zugänglichen Namen.",
    affected: [SR],
    remediation: ["Ergänzen Sie aria-label oder aria-labelledby mit einer kurzen Beschreibung.", "Ist das Element dekorativ, entfernen Sie role=\"img\" bzw. nutzen Sie aria-hidden=\"true\"."],
  },
  "svg-img-alt": {
    title: "SVG-Grafiken ohne Textalternative",
    explanation: "Eine SVG-Grafik ist als Bild ausgezeichnet, hat aber keinen zugänglichen Namen.",
    affected: [SR, LV],
    remediation: ["Fügen Sie ein <title>-Element oder aria-label hinzu.", "Dekorative SVGs mit aria-hidden=\"true\" ausblenden."],
  },
  "object-alt": {
    title: "Eingebettete Objekte ohne Textalternative",
    explanation: "Ein <object>-Element hat keine Textalternative.",
    affected: [SR],
    remediation: ["Ergänzen Sie aria-label oder alternativen Inhalt innerhalb des Elements."],
  },
  "area-alt": {
    title: "Bereiche in Bildkarten ohne Textalternative",
    explanation: "Klickbare Bereiche einer Bildkarte (image map) haben keine Beschriftung.",
    affected: [SR, KB],
    remediation: ["Geben Sie jedem <area>-Element ein aussagekräftiges alt-Attribut.", "Besser: Bildkarte durch normale Links ersetzen."],
  },
  "button-name": {
    title: "Schaltflächen ohne erkennbaren Namen",
    explanation: "Buttons haben keinen Text und keinen zugänglichen Namen. Screenreader lesen nur „Schaltfläche“ vor; Sprachsteuerung kann sie nicht ansprechen.",
    affected: [SR, VO],
    remediation: [
      "Fügen Sie sichtbaren Text in den <button> ein.",
      "Bei reinen Icon-Buttons: aria-label (z. B. „Warenkorb öffnen“) ergänzen und das Icon selbst mit aria-hidden=\"true\" ausblenden.",
    ],
  },
  "input-button-name": {
    title: "Eingabe-Schaltflächen ohne Namen",
    explanation: "Eine Schaltfläche (input type=button/submit/reset) hat keinen Text.",
    affected: [SR, VO],
    remediation: ["Setzen Sie das value-Attribut auf eine klare Beschriftung (z. B. „Absenden“)."],
  },
  "link-name": {
    title: "Links ohne erkennbaren Namen",
    explanation: "Links haben keinen Text und keinen zugänglichen Namen. Nutzende erfahren nicht, wohin der Link führt.",
    affected: [SR, KB, VO],
    remediation: [
      "Fügen Sie einen aussagekräftigen Linktext hinzu.",
      "Bei Icon- oder Bild-Links: aria-label oder ein alt-Attribut am Bild ergänzen.",
    ],
  },
  label: {
    title: "Formularfelder ohne Beschriftung",
    explanation:
      "Eingabefelder haben kein verknüpftes Label. Screenreader sagen nicht an, was einzugeben ist; auch die Klickfläche zum Fokussieren fehlt.",
    affected: [SR, VO, MO, CO],
    remediation: [
      "Verknüpfen Sie ein sichtbares <label for=\"…\"> mit der id des Feldes.",
      "Platzhaltertexte (placeholder) ersetzen kein Label.",
      "Nur wenn eine sichtbare Beschriftung nicht möglich ist: aria-label bzw. aria-labelledby verwenden.",
    ],
  },
  "select-name": {
    title: "Auswahlfelder ohne Beschriftung",
    explanation: "Ein Auswahlfeld (<select>) hat kein Label.",
    affected: [SR, VO],
    remediation: ["Verknüpfen Sie ein sichtbares <label> mit dem Auswahlfeld."],
  },
  "label-title-only": {
    title: "Formularfelder nur mit title-Attribut beschriftet",
    explanation: "Das Feld ist nur über das title-Attribut beschriftet, das viele Nutzende nicht wahrnehmen.",
    affected: [SR, CO, MO],
    remediation: ["Ergänzen Sie ein sichtbares <label>."],
  },
  "label-content-name-mismatch": {
    title: "Sichtbarer Text fehlt im zugänglichen Namen",
    explanation: "Der zugängliche Name eines Bedienelements enthält den sichtbaren Text nicht. Sprachsteuerung („Klicke auf Suchen“) funktioniert dann nicht.",
    affected: [VO, SR],
    remediation: ["Der sichtbare Text sollte am Anfang des aria-label stehen oder ganz auf aria-label verzichten."],
  },
  "form-field-multiple-labels": {
    title: "Formularfeld mit mehreren Labels",
    explanation: "Ein Feld ist mit mehreren Labels verknüpft. Hilfstechnik gibt sie unterschiedlich wieder.",
    affected: [SR],
    remediation: ["Nutzen Sie ein einziges Label je Feld; zusätzliche Hinweise per aria-describedby anbinden."],
  },
  "autocomplete-valid": {
    title: "Ungültiges autocomplete-Attribut",
    explanation: "Das autocomplete-Attribut hat einen ungültigen Wert. Browser und Hilfstechnik können Daten (z. B. Name, Adresse) nicht automatisch ausfüllen.",
    affected: [CO, MO, SR],
    remediation: ["Verwenden Sie die gültigen HTML-Tokens, z. B. autocomplete=\"given-name\", \"email\", \"postal-code\"."],
  },
  "color-contrast": {
    title: "Zu geringer Farbkontrast bei Text",
    explanation:
      "Text und Hintergrund haben zu wenig Kontrast (mindestens 4,5:1 bei normalem Text, 3:1 bei großem Text). Der Text ist für viele Menschen schlecht oder nicht lesbar – etwa bei Sehschwäche oder Sonnenlicht.",
    affected: [LV, CB, CO],
    remediation: [
      "Dunkeln Sie die Textfarbe ab oder hellen Sie den Hintergrund auf, bis das Verhältnis erreicht ist.",
      "Prüfen Sie auch Zustände wie Hover, Fokus und deaktivierte Elemente.",
      "Text über Bildern oder Verläufen: einfarbige, ausreichend dunkle bzw. helle Fläche hinterlegen.",
    ],
  },
  "color-contrast-enhanced": {
    title: "Erhöhter Farbkontrast nicht erreicht (Stufe AAA)",
    explanation: "Der Kontrast erfüllt die erhöhte Anforderung (7:1) nicht. Das ist über die Pflichtstufe AA hinaus.",
    affected: [LV],
    remediation: ["Optional: Kontrast weiter erhöhen."],
  },
  "link-in-text-block": {
    title: "Links im Fließtext nur durch Farbe erkennbar",
    explanation: "Links in Absätzen unterscheiden sich vom Text nur durch die Farbe. Wer Farben nicht unterscheiden kann, erkennt sie nicht.",
    affected: [CB, LV],
    remediation: ["Unterstreichen Sie Links im Fließtext oder nutzen Sie ein weiteres Merkmal (Fettdruck) mit ausreichendem Kontrast zum Text."],
  },
  "document-title": {
    title: "Seite ohne Titel",
    explanation: "Die Seite hat keinen <title>. Der Titel wird als Erstes vorgelesen und erscheint in Tabs und Lesezeichen.",
    affected: [SR, CO, LV],
    remediation: ["Ergänzen Sie ein <title>, das den Seiteninhalt eindeutig beschreibt (z. B. „Warenkorb – Shopname“)."],
  },
  "html-has-lang": {
    title: "Seitensprache nicht angegeben",
    explanation: "Das <html>-Element hat kein lang-Attribut. Screenreader wählen dann ggf. die falsche Aussprache.",
    affected: [SR, CO],
    remediation: ["Setzen Sie lang=\"de\" (bzw. die passende Sprache) auf das <html>-Element."],
  },
  "html-lang-valid": {
    title: "Ungültige Seitensprache",
    explanation: "Das lang-Attribut enthält keinen gültigen Sprachcode.",
    affected: [SR],
    remediation: ["Verwenden Sie einen gültigen Code, z. B. \"de\" oder \"de-DE\"."],
  },
  "html-xml-lang-mismatch": {
    title: "Widersprüchliche Sprachangaben",
    explanation: "lang und xml:lang weichen voneinander ab.",
    affected: [SR],
    remediation: ["Vereinheitlichen Sie beide Angaben oder entfernen Sie xml:lang."],
  },
  "valid-lang": {
    title: "Ungültige Sprachangabe bei Textabschnitten",
    explanation: "Ein Element trägt ein lang-Attribut mit ungültigem Wert.",
    affected: [SR],
    remediation: ["Korrigieren Sie den Sprachcode (z. B. \"en\" für englische Textstellen)."],
  },
  bypass: {
    title: "Kein Mechanismus, um wiederkehrende Bereiche zu überspringen",
    explanation: "Es gibt keinen „Zum Inhalt springen“-Link, keine Überschriften und keine Landmarken. Tastaturnutzende müssen bei jeder Seite erst die gesamte Navigation durchtabben.",
    affected: [KB, SR, MO],
    remediation: [
      "Fügen Sie als erstes fokussierbares Element einen Link „Zum Hauptinhalt springen“ ein.",
      "Strukturieren Sie die Seite mit <header>, <nav>, <main> und <footer>.",
    ],
  },
  "skip-link": {
    title: "Sprunglink ohne gültiges Ziel",
    explanation: "Ein „Zum Inhalt springen“-Link verweist auf ein Ziel, das nicht existiert oder nicht fokussierbar ist.",
    affected: [KB, SR],
    remediation: ["Stellen Sie sicher, dass die Ziel-ID existiert (z. B. <main id=\"inhalt\" tabindex=\"-1\">)."],
  },
  "heading-order": {
    title: "Überschriftenebenen übersprungen",
    explanation: "Überschriften folgen nicht der logischen Reihenfolge (z. B. h2 direkt auf h4). Nutzende, die per Überschriften navigieren, verlieren den Überblick.",
    affected: [SR, CO],
    remediation: ["Verwenden Sie Ebenen ohne Sprünge. Die Überschriftenebene bestimmt die Struktur, nicht die Schriftgröße – dafür CSS nutzen."],
  },
  "empty-heading": {
    title: "Leere Überschriften",
    explanation: "Eine Überschrift enthält keinen Text. Screenreader kündigen sie trotzdem an.",
    affected: [SR],
    remediation: ["Entfernen Sie leere Überschriften oder füllen Sie sie mit Text."],
  },
  "page-has-heading-one": {
    title: "Keine Hauptüberschrift (h1)",
    explanation: "Die Seite hat keine h1. Eine klare Hauptüberschrift hilft bei der Orientierung.",
    affected: [SR, CO],
    remediation: ["Ergänzen Sie genau eine h1, die den Seiteninhalt beschreibt."],
  },
  "p-as-heading": {
    title: "Absatz sieht aus wie Überschrift",
    explanation: "Ein Absatz ist nur durch Formatierung als Überschrift gestaltet, ohne Überschriften-Auszeichnung.",
    affected: [SR],
    remediation: ["Verwenden Sie echte Überschriften-Elemente (h1–h6)."],
  },
  region: {
    title: "Inhalte außerhalb von Landmarken",
    explanation: "Teile der Seite liegen in keiner Landmarke (header, nav, main, footer). Landmarken-Navigation überspringt solche Inhalte.",
    affected: [SR, KB],
    remediation: ["Fassen Sie alle Inhalte in passende Landmarken-Elemente."],
  },
  "landmark-one-main": {
    title: "Keine Hauptlandmarke (main)",
    explanation: "Die Seite hat kein <main>-Element. Screenreader-Nutzende können nicht direkt zum Hauptinhalt springen.",
    affected: [SR, KB],
    remediation: ["Umschließen Sie den Hauptinhalt mit genau einem <main>."],
  },
  "landmark-unique": {
    title: "Landmarken nicht unterscheidbar",
    explanation: "Mehrere gleichartige Landmarken (z. B. zwei <nav>) haben keine unterschiedlichen Beschriftungen.",
    affected: [SR],
    remediation: ["Vergeben Sie je Landmarke ein eigenes aria-label (z. B. „Hauptnavigation“, „Fußzeile“)."],
  },
  "landmark-no-duplicate-main": {
    title: "Mehrere Hauptlandmarken",
    explanation: "Es gibt mehr als ein <main>-Element.",
    affected: [SR],
    remediation: ["Verwenden Sie nur ein sichtbares <main> je Seite."],
  },
  "landmark-no-duplicate-banner": {
    title: "Mehrere Kopf-Landmarken",
    explanation: "Es gibt mehrere Seitenkopf-Bereiche (banner).",
    affected: [SR],
    remediation: ["Nutzen Sie je Seite nur einen Seitenkopf auf oberster Ebene."],
  },
  "landmark-no-duplicate-contentinfo": {
    title: "Mehrere Fuß-Landmarken",
    explanation: "Es gibt mehrere Seitenfuß-Bereiche (contentinfo).",
    affected: [SR],
    remediation: ["Nutzen Sie je Seite nur einen Seitenfuß auf oberster Ebene."],
  },
  "landmark-banner-is-top-level": {
    title: "Kopfbereich ist verschachtelt",
    explanation: "Die Landmarke „banner“ liegt innerhalb einer anderen Landmarke.",
    affected: [SR],
    remediation: ["Platzieren Sie den Seitenkopf auf oberster Ebene."],
  },
  "landmark-contentinfo-is-top-level": {
    title: "Fußbereich ist verschachtelt",
    explanation: "Die Landmarke „contentinfo“ liegt innerhalb einer anderen Landmarke.",
    affected: [SR],
    remediation: ["Platzieren Sie den Seitenfuß auf oberster Ebene."],
  },
  "landmark-main-is-top-level": {
    title: "Hauptbereich ist verschachtelt",
    explanation: "Die Landmarke „main“ liegt innerhalb einer anderen Landmarke.",
    affected: [SR],
    remediation: ["Platzieren Sie <main> nicht innerhalb von article, aside, header, footer oder nav."],
  },
  "landmark-complementary-is-top-level": {
    title: "Ergänzender Bereich ist verschachtelt",
    explanation: "Die Landmarke „complementary“ (aside) liegt innerhalb einer anderen Landmarke.",
    affected: [SR],
    remediation: ["Platzieren Sie <aside> auf oberster Ebene."],
  },
  "duplicate-id-aria": {
    title: "Doppelte IDs, auf die ARIA verweist",
    explanation: "IDs sind mehrfach vergeben und werden von Labels oder ARIA-Attributen referenziert. Die Zuordnung ist dann unzuverlässig.",
    affected: [SR],
    remediation: ["Machen Sie jede id auf der Seite eindeutig."],
  },
  "aria-hidden-focus": {
    title: "Ausgeblendete Bereiche enthalten fokussierbare Elemente",
    explanation:
      "Ein mit aria-hidden=\"true\" ausgeblendeter Bereich enthält Links, Buttons oder Felder, die per Tastatur erreichbar bleiben. Tastaturnutzende landen auf Elementen, die Screenreader nicht kennen.",
    affected: [KB, SR],
    remediation: [
      "Entfernen Sie aria-hidden oder machen Sie die Elemente nicht fokussierbar (tabindex=\"-1\", disabled oder das Attribut inert verwenden).",
      "Bei Menüs/Dialogen: Fokussierbarkeit beim Schließen konsequent abschalten.",
    ],
  },
  "aria-hidden-body": {
    title: "aria-hidden auf dem Seitenkörper",
    explanation: "Das <body>-Element ist mit aria-hidden=\"true\" versehen. Hilfstechnik kann dadurch die gesamte Seite nicht mehr lesen.",
    affected: [SR],
    remediation: ["Entfernen Sie aria-hidden=\"true\" vom <body>."],
  },
  "aria-allowed-attr": {
    title: "ARIA-Attribute an unpassenden Elementen",
    explanation: "ARIA-Attribute werden verwendet, die für die Rolle des Elements nicht erlaubt sind. Das verwirrt Hilfstechnik.",
    affected: [SR],
    remediation: ["Entfernen Sie unzulässige Attribute oder wählen Sie eine passende Rolle. Faustregel: kein ARIA ist besser als falsches ARIA."],
  },
  "aria-allowed-role": {
    title: "Ungeeignete ARIA-Rolle für das Element",
    explanation: "Einem HTML-Element wurde eine Rolle zugewiesen, die dafür nicht vorgesehen ist.",
    affected: [SR],
    remediation: ["Nutzen Sie das passende native HTML-Element statt einer abweichenden Rolle."],
  },
  "aria-valid-attr": {
    title: "Unbekannte ARIA-Attribute",
    explanation: "Es werden ARIA-Attribute genutzt, die nicht existieren (z. B. Tippfehler).",
    affected: [SR],
    remediation: ["Korrigieren Sie die Schreibweise oder entfernen Sie das Attribut."],
  },
  "aria-valid-attr-value": {
    title: "Ungültige Werte in ARIA-Attributen",
    explanation: "ARIA-Attribute haben unzulässige Werte oder verweisen auf nicht vorhandene IDs.",
    affected: [SR],
    remediation: ["Verwenden Sie zulässige Werte und prüfen Sie, dass referenzierte IDs existieren."],
  },
  "aria-roles": {
    title: "Ungültige ARIA-Rollen",
    explanation: "Es werden Rollen vergeben, die es nicht gibt.",
    affected: [SR],
    remediation: ["Verwenden Sie gültige Rollennamen oder nutzen Sie passendes natives HTML."],
  },
  "aria-required-attr": {
    title: "Pflicht-ARIA-Attribute fehlen",
    explanation: "Eine ARIA-Rolle verlangt bestimmte Attribute (z. B. aria-checked), die fehlen. Der Zustand wird nicht vermittelt.",
    affected: [SR],
    remediation: ["Ergänzen Sie die erforderlichen Attribute oder verwenden Sie native Elemente (z. B. <input type=\"checkbox\">)."],
  },
  "aria-required-children": {
    title: "ARIA-Rolle ohne erforderliche Kindelemente",
    explanation: "Eine Rolle wie list, menu oder tablist verlangt bestimmte Kindrollen, die fehlen.",
    affected: [SR],
    remediation: ["Ergänzen Sie die erforderlichen Kindrollen (z. B. listitem, menuitem, tab)."],
  },
  "aria-required-parent": {
    title: "ARIA-Rolle ohne erforderliches Elternelement",
    explanation: "Eine Rolle wie listitem oder tab steht nicht im vorgesehenen Container.",
    affected: [SR],
    remediation: ["Platzieren Sie das Element im passenden Eltern-Element (z. B. tab in tablist)."],
  },
  "aria-input-field-name": {
    title: "ARIA-Eingabefelder ohne Namen",
    explanation: "Benutzerdefinierte Eingabeelemente (z. B. combobox, slider) haben keinen zugänglichen Namen.",
    affected: [SR, VO],
    remediation: ["Ergänzen Sie aria-label oder aria-labelledby."],
  },
  "aria-command-name": {
    title: "ARIA-Bedienelemente ohne Namen",
    explanation: "Elemente mit Rolle button, link oder menuitem haben keinen zugänglichen Namen.",
    affected: [SR, VO],
    remediation: ["Ergänzen Sie sichtbaren Text, aria-label oder aria-labelledby."],
  },
  "aria-toggle-field-name": {
    title: "Umschalter ohne Namen",
    explanation: "Checkbox-, Schalter- oder Radio-Elemente per ARIA haben keinen Namen.",
    affected: [SR, VO],
    remediation: ["Ergänzen Sie ein Label oder aria-label."],
  },
  "aria-dialog-name": {
    title: "Dialoge ohne Namen",
    explanation: "Ein Dialog (role=\"dialog\") hat keinen zugänglichen Namen. Screenreader kündigen ihn nur als „Dialog“ an.",
    affected: [SR],
    remediation: ["Verknüpfen Sie die Dialogüberschrift per aria-labelledby."],
  },
  "aria-progressbar-name": {
    title: "Fortschrittsanzeige ohne Namen",
    explanation: "Eine Fortschrittsanzeige hat keinen zugänglichen Namen.",
    affected: [SR],
    remediation: ["Ergänzen Sie aria-label oder aria-labelledby."],
  },
  "aria-tooltip-name": {
    title: "Tooltips ohne Namen",
    explanation: "Ein Element mit Rolle tooltip hat keinen Inhalt.",
    affected: [SR],
    remediation: ["Geben Sie dem Tooltip einen Text."],
  },
  "aria-meter-name": {
    title: "Messanzeige ohne Namen",
    explanation: "Ein meter-Element hat keinen zugänglichen Namen.",
    affected: [SR],
    remediation: ["Ergänzen Sie aria-label oder aria-labelledby."],
  },
  "aria-treeitem-name": {
    title: "Baumelemente ohne Namen",
    explanation: "Elemente eines Baums haben keinen zugänglichen Namen.",
    affected: [SR],
    remediation: ["Ergänzen Sie Text oder aria-label."],
  },
  "nested-interactive": {
    title: "Verschachtelte interaktive Elemente",
    explanation: "Interaktive Elemente (z. B. ein Link in einem Button) sind ineinander geschachtelt. Screenreader und Tastatur verhalten sich dabei unvorhersehbar.",
    affected: [SR, KB, VO],
    remediation: ["Trennen Sie die Elemente: Eine Karte darf z. B. einen Hauptlink haben, aber keine weiteren Buttons in diesem Link."],
  },
  "presentation-role-conflict": {
    title: "Dekorative Rolle bei fokussierbarem Element",
    explanation: "Ein Element mit role=\"presentation\" ist fokussierbar oder hat globale ARIA-Attribute. Die dekorative Rolle wird dann ignoriert.",
    affected: [SR],
    remediation: ["Entfernen Sie role=\"presentation\" oder das Konfliktattribut."],
  },
  tabindex: {
    title: "Positiver tabindex-Wert",
    explanation: "tabindex mit Wert größer 0 verändert die natürliche Tab-Reihenfolge und führt zu unlogischen Sprüngen.",
    affected: [KB, MO],
    remediation: ["Verwenden Sie tabindex=\"0\" oder \"-1\" und richten Sie die Reihenfolge im HTML-Quelltext logisch aus."],
  },
  "scrollable-region-focusable": {
    title: "Scrollbare Bereiche nicht per Tastatur erreichbar",
    explanation: "Ein scrollbarer Bereich enthält keine fokussierbaren Elemente. Tastaturnutzende können den verborgenen Inhalt nicht erreichen.",
    affected: [KB, MO],
    remediation: ["Ergänzen Sie tabindex=\"0\" am Container samt zugänglichem Namen (aria-label) – oder vermeiden Sie das Scrollen."],
  },
  "frame-title": {
    title: "Frames ohne Titel",
    explanation: "Eingebettete Frames/iframes haben keinen title. Nutzende erfahren nicht, welchen Inhalt sie enthalten.",
    affected: [SR],
    remediation: ["Vergeben Sie ein title-Attribut, das den Inhalt beschreibt (z. B. „Kartenansicht“)."],
  },
  "frame-title-unique": {
    title: "Frame-Titel nicht eindeutig",
    explanation: "Mehrere Frames tragen denselben Titel.",
    affected: [SR],
    remediation: ["Vergeben Sie unterscheidbare Titel."],
  },
  "frame-focusable-content": {
    title: "Frames mit fokussierbarem Inhalt sind nicht erreichbar",
    explanation: "Ein Frame enthält bedienbare Elemente, ist aber per tabindex=\"-1\" aus der Tastaturbedienung genommen.",
    affected: [KB],
    remediation: ["Entfernen Sie tabindex=\"-1\" vom Frame."],
  },
  "meta-viewport": {
    title: "Zoom ist deaktiviert",
    explanation: "Das Viewport-Meta-Tag verhindert das Vergrößern der Seite (user-scalable=no oder zu kleines maximum-scale). Menschen mit Sehbehinderung können Inhalte nicht vergrößern.",
    affected: [LV],
    remediation: ["Entfernen Sie user-scalable=no sowie maximum-scale unter 5. Beispiel: <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."],
  },
  "meta-viewport-large": {
    title: "Zoom ist eingeschränkt",
    explanation: "Das Viewport-Meta-Tag begrenzt die Vergrößerung.",
    affected: [LV],
    remediation: ["Entfernen Sie Zoom-Beschränkungen aus dem Viewport-Meta-Tag."],
  },
  "meta-refresh": {
    title: "Automatische Weiterleitung/Aktualisierung",
    explanation: "Die Seite lädt sich per meta refresh automatisch neu oder leitet weiter. Nutzende verlieren Kontext und Kontrolle.",
    affected: [SR, CO, MO],
    remediation: ["Verwenden Sie serverseitige Weiterleitungen und verzichten Sie auf zeitgesteuertes Neuladen."],
  },
  blink: {
    title: "Blinkender Text",
    explanation: "Blinkender Text lenkt ab und kann Beschwerden auslösen.",
    affected: [CO, LV],
    remediation: ["Entfernen Sie <blink>."],
  },
  marquee: {
    title: "Laufschrift",
    explanation: "Bewegter Text per <marquee> ist schwer lesbar und nicht pausierbar.",
    affected: [CO, LV],
    remediation: ["Entfernen Sie <marquee>; zeigen Sie Inhalte statisch an."],
  },
  "no-autoplay-audio": {
    title: "Automatisch startende Audioinhalte",
    explanation: "Audio startet automatisch und länger als drei Sekunden, ohne dass es gestoppt werden kann. Es stört Screenreader-Nutzende massiv.",
    affected: [SR, CO, DF],
    remediation: ["Starten Sie Audio nicht automatisch oder bieten Sie ein sichtbares Bedienelement zum Pausieren an."],
  },
  "video-caption": {
    title: "Videos ohne Untertitel",
    explanation: "Videos haben keine Untertitelspur. Gehörlose und schwerhörige Menschen erhalten den gesprochenen Inhalt nicht.",
    affected: [DF],
    remediation: ["Ergänzen Sie Untertitel (<track kind=\"captions\">) bzw. nutzen Sie einen Player mit Untertiteln."],
  },
  list: {
    title: "Listen enthalten unzulässige Elemente",
    explanation: "Listen (ul/ol) enthalten Kindelemente, die keine Listeneinträge sind. Screenreader geben die Liste falsch wieder.",
    affected: [SR],
    remediation: ["Verwenden Sie in ul/ol nur <li> (und script/template)."],
  },
  listitem: {
    title: "Listeneinträge außerhalb einer Liste",
    explanation: "<li>-Elemente stehen nicht in einer ul/ol.",
    affected: [SR],
    remediation: ["Fassen Sie <li> in <ul> oder <ol> ein."],
  },
  dlitem: {
    title: "Definitionslisten-Einträge außerhalb einer Liste",
    explanation: "<dt>/<dd> stehen nicht in einer <dl>.",
    affected: [SR],
    remediation: ["Umschließen Sie <dt>/<dd> mit <dl>."],
  },
  "definition-list": {
    title: "Fehlerhafte Definitionsliste",
    explanation: "Eine <dl> enthält unzulässige Elemente.",
    affected: [SR],
    remediation: ["Nutzen Sie in <dl> nur <dt>, <dd> und <div>-Gruppen."],
  },
  "td-has-header": {
    title: "Datenzellen großer Tabellen ohne Kopfzellen",
    explanation: "In einer größeren Tabelle fehlen Kopfzellen. Screenreader können Zellwerte keiner Spalte/Zeile zuordnen.",
    affected: [SR, CO],
    remediation: ["Kennzeichnen Sie Kopfzellen mit <th> (und scope=\"col\"/\"row\")."],
  },
  "th-has-data-cells": {
    title: "Tabellenkopf ohne zugehörige Daten",
    explanation: "Eine Kopfzelle bezieht sich auf keine Datenzellen.",
    affected: [SR],
    remediation: ["Prüfen Sie die Tabellenstruktur; verwenden Sie <th> nur für echte Köpfe."],
  },
  "td-headers-attr": {
    title: "Fehlerhafte headers-Attribute in Tabellen",
    explanation: "Das headers-Attribut verweist auf nicht vorhandene Zellen.",
    affected: [SR],
    remediation: ["Korrigieren Sie die referenzierten IDs."],
  },
  "scope-attr-valid": {
    title: "Ungültiges scope-Attribut",
    explanation: "scope ist falsch eingesetzt.",
    affected: [SR],
    remediation: ["Verwenden Sie scope=\"col\" oder \"row\" nur an <th>."],
  },
  "empty-table-header": {
    title: "Leere Tabellenköpfe",
    explanation: "Eine Tabellenkopfzelle hat keinen Text.",
    affected: [SR],
    remediation: ["Ergänzen Sie sichtbaren oder visuell versteckten Text."],
  },
  "identical-links-same-purpose": {
    title: "Gleiche Linktexte mit unterschiedlichem Ziel",
    explanation: "Links mit identischem Text („Mehr erfahren“) führen an verschiedene Ziele. Aus einer Linkliste heraus sind sie nicht unterscheidbar.",
    affected: [SR, CO, VO],
    remediation: ["Machen Sie Linktexte eindeutig (z. B. „Mehr zu Versandkosten“) oder ergänzen Sie ein aria-label mit Kontext."],
  },
  "target-size": {
    title: "Zu kleine Klick- und Tippflächen",
    explanation: "Interaktive Elemente sind kleiner als 24×24 px und haben zu wenig Abstand. Sie sind schwer zu treffen – etwa bei Tremor oder auf Touchgeräten.",
    affected: [MO, LV],
    remediation: ["Vergrößern Sie die Klickfläche (Padding) auf mindestens 24×24 px, besser 44×44 px, oder schaffen Sie Abstand."],
  },
  accesskeys: {
    title: "Doppelte Zugriffstasten",
    explanation: "Mehrere Elemente nutzen dieselbe accesskey.",
    affected: [KB],
    remediation: ["Vergeben Sie accesskeys nur eindeutig – oder verzichten Sie ganz darauf."],
  },
  "css-orientation-lock": {
    title: "Bildschirmausrichtung gesperrt",
    explanation: "Die Darstellung ist auf eine Ausrichtung festgelegt. Wer sein Gerät fest montiert hat, kann die Seite nicht nutzen.",
    affected: [MO, LV],
    remediation: ["Unterstützen Sie Hoch- und Querformat."],
  },
  "server-side-image-map": {
    title: "Serverseitige Bildkarten",
    explanation: "Serverseitige Bildkarten sind per Tastatur nicht bedienbar.",
    affected: [KB, SR],
    remediation: ["Ersetzen Sie sie durch clientseitige Bildkarten oder durch Links."],
  },
  "summary-name": {
    title: "Aufklapper ohne Beschriftung",
    explanation: "Ein <summary>-Element hat keinen Text.",
    affected: [SR, KB],
    remediation: ["Ergänzen Sie sichtbaren Text im <summary>."],
  },
  "image-redundant-alt": {
    title: "Alternativtext wiederholt umgebenden Text",
    explanation: "Der Alternativtext eines Bildes wiederholt den benachbarten Linktext. Er wird doppelt vorgelesen.",
    affected: [SR],
    remediation: ["Setzen Sie alt=\"\" oder formulieren Sie die Alternative komplementär."],
  },
};

const FALLBACK_BY_CATEGORY: Array<{ tag: string; who: Who[]; area: string }> = [
  { tag: "cat.color", who: [LV, CB], area: "Farben und Kontrast" },
  { tag: "cat.keyboard", who: [KB, MO], area: "Tastaturbedienung" },
  { tag: "cat.name-role-value", who: [SR, VO], area: "Namen, Rollen und Zustände" },
  { tag: "cat.text-alternatives", who: [SR, LV], area: "Textalternativen" },
  { tag: "cat.forms", who: [SR, VO, CO], area: "Formulare" },
  { tag: "cat.structure", who: [SR, CO], area: "Seitenstruktur" },
  { tag: "cat.semantics", who: [SR], area: "Semantik" },
  { tag: "cat.aria", who: [SR], area: "ARIA" },
  { tag: "cat.language", who: [SR], area: "Sprache" },
  { tag: "cat.tables", who: [SR], area: "Tabellen" },
  { tag: "cat.time-and-media", who: [DF, CO], area: "Zeit und Medien" },
  { tag: "cat.sensory-and-visual-cues", who: [LV, CB], area: "Sensorische und visuelle Hinweise" },
  { tag: "cat.parsing", who: [SR], area: "Quelltext-Qualität" },
];

export interface GenericContentInput {
  ruleId: string;
  help: string;
  description: string;
  tags: readonly string[];
}

/** Platzhalter für Regeln ohne kuratierten Text: ehrlich als solcher gekennzeichnet. */
export function genericContent(input: GenericContentInput): RuleContent {
  const cat = FALLBACK_BY_CATEGORY.find((c) => input.tags.includes(c.tag));
  return {
    title: `Technische Auffälligkeit (${input.ruleId})`,
    explanation: `Für diese Regel liegt noch kein deutscher Erklärtext vor. Originalbeschreibung der Prüfregel (Englisch): „${input.help}“.${cat ? ` Thematischer Bereich: ${cat.area}.` : ""}`,
    affected: cat?.who ?? [SR],
    remediation: [
      "Öffnen Sie die verlinkte Regelbeschreibung für die genaue Ursache und Lösungswege.",
      "Prüfen Sie das betroffene Element im Quelltext und testen Sie die Korrektur anschließend manuell.",
    ],
  };
}
