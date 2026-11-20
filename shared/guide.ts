// „Gut zu wissen“: kurze Karten rund um Platten, Nadel, Anlage und Auflegen.
// Bewusst kein Blog: Pflege-Wissen veraltet nicht und braucht kein Datum. Jede Karte ist in einer halben Minute
// gelesen: so geht es, das lässt du besser.
// Regel wie bei der Nadel-Lebensdauer (stylusLife.ts): nur Ratschläge, die sich belegen lassen. Die Quellen stehen
// an jeder Karte. Karten aus reiner Praxis (Packliste) tragen `practice` und sagen das auch.
// Gelesen am 20. November 2026: Library of Congress, Canadian Conservation Institute, Ortofon, Audio-Technica,
// Genelec, WHO. Was dort nicht steht, steht auch hier nicht als Tatsache.
// Für das Auflegen selbst (Bereich „Mixen“, Set packen, Warm-up, Aufnehmen) ist Digital DJ Tips die Grundlage
// (Franz: viel gutes, fundiertes Wissen). Die Karten fassen in eigenen Worten zusammen und verweisen auf den
// jeweiligen Artikel, sie übernehmen keinen Text.

export interface GuideSource {
  label: string;
  url: string;
}

export type GuideArea = "start" | "platten" | "nadel" | "anlage" | "mixen" | "auflegen";

export interface GuideCard {
  slug: string;
  area: GuideArea;
  title: string;
  /** Ein, zwei Sätze: worum es geht und warum es zählt */
  lead: string;
  /** So geht es */
  todo: string[];
  /** Das lässt du besser */
  avoid?: string[];
  /** Stellen in Crate, die dazu passen */
  more?: { label: string; to: string }[];
  /** Verwandte Karten (slug) */
  see?: string[];
  sources: GuideSource[];
  /** Aus der Praxis, ohne Herstellerangabe oder Studie dahinter */
  practice?: boolean;
}

export const GUIDE_AREAS: { id: GuideArea; title: string; sub: string }[] = [
  { id: "start", title: "Neu dabei?", sub: "Womit du anfängst und was am Anfang schiefgeht" },
  { id: "platten", title: "Platten", sub: "Anfassen, reinigen, lagern, verschicken" },
  { id: "nadel", title: "Nadel und System", sub: "Reinigen, einstellen, rechtzeitig wechseln" },
  { id: "anlage", title: "Anlage", sub: "Boxen, Mixer, Pegel" },
  { id: "mixen", title: "Mixen", sub: "Tempo, Takte, Übergänge, Tonart" },
  { id: "auflegen", title: "Auflegen", sub: "Kiste, Warm-up, Soundcheck, Gehör" },
];

const LOC: GuideSource = { label: "Library of Congress: Care, Handling and Storage of Audio Visual Materials", url: "https://www.loc.gov/preservation/care/record.html" };
const CCI: GuideSource = { label: "Canadian Conservation Institute: Caring for audio, video and data recording media", url: "https://www.canada.ca/en/conservation-institute/services/preventive-conservation/guidelines-collections/caring-audio-video-data-recording-media.html" };
const ORTOFON_CARE: GuideSource = { label: "Ortofon: Stylus and record care", url: "https://www.ortofon.com/wear-tear" };
const ORTOFON_DJ: GuideSource = { label: "Ortofon: DJ FAQ", url: "https://ortofon.com/pages/dj-faq" };
const ORTOFON_SHAPE: GuideSource = { label: "Ortofon: Elliptical or spherical stylus", url: "https://ortofon.com/blogs/news/elliptical-or-spherical-stylus-on-cartridges-what-s-the-difference" };
const AT_TONEARM: GuideSource = { label: "Audio-Technica: Setting up the tonearm on a turntable", url: "https://audio-technica.com/en-gb/support/setting-up-the-tonearm-on-a-turntable" };
const AT_DRIVE: GuideSource = { label: "Audio-Technica: Direct-drive and belt-drive turntables", url: "https://audio-technica.com/en-us/support/audio-solutions-question-week-direct-drive-belt-drive-turntables" };
const AT_PHONO: GuideSource = { label: "Audio-Technica: What does the PHONO/LINE switch mean?", url: "https://blog.audio-technica.com/audio-solutions-question-of-the-week-what-does-the-phonoline-switch-mean-on-audio-technica-turntables/" };
const GENELEC: GuideSource = { label: "Genelec: Monitor placement", url: "https://www.genelec.com/monitor-placement" };
const UTURN: GuideSource = { label: "U-Turn Audio: How to position your turntable", url: "https://uturnaudio.com/pages/turntable-positioning" };
const PSW: GuideSource = { label: "ProSoundWeb: Turntables and low-frequency noise", url: "https://www.prosoundweb.com/tech-tip-of-the-day-turntables-low-frequency-noise/" };
const DJTT: GuideSource = { label: "DJ TechTools: Gain staging for DJs", url: "https://djtechtools.com/2015/10/11/gain-staging-for-djs-staying-out-of-the-red/" };
const BONEDO: GuideSource = { label: "Bonedo: Pegel am DJ-Mixer richtig einstellen", url: "https://www.bonedo.de/artikel/pegel-am-mixer-richtig-einstellen-und-uebersteuerungen-beim-auflegen-vermeiden" };
const XONE: GuideSource = { label: "Allen & Heath: Xone:24 User Guide", url: "https://support.allen-heath.com/hc/en-gb/articles/39799443772689-Xone-24-User-Guide" };
const THOMANN_PA: GuideSource = { label: "Thomann: PA systems quick guide", url: "https://www.thomann.co.uk/onlineexpert_page_pa_systems_quick_guide.html" };
const DELAMAR: GuideSource = { label: "delamar: Aktiv- oder Passiv-Lautsprecher?", url: "https://www.delamar.de/studiomonitore/aktiv-passiv-lautsprecher-55286/" };
const WHO_VENUES: GuideSource = { label: "WHO: Global standard for safe listening venues and events", url: "https://www.who.int/publications/i/item/9789240043114" };
const WHO_DEVICES: GuideSource = { label: "WHO und ITU: Safe listening devices and systems", url: "https://www.who.int/publications/i/item/9789241515276" };
const SHIPSTATION: GuideSource = { label: "ShipStation: How to ship vinyl records", url: "https://www.shipstation.com/blog/how-to-ship-vinyl-records/" };
const EASYSHIP: GuideSource = { label: "Easyship: Guide to packing and shipping vinyl records", url: "https://www.easyship.com/blog/shipping-vinyl-records" };

const DDJT = (label: string, path: string): GuideSource => ({ label: `Digital DJ Tips: ${label}`, url: `https://www.digitaldjtips.com/${path}/` });
const DDJT_ELEMENTS = DDJT("The three elements of a good beatmix", "rock-the-dancefloor/beatmixing-part-2-the-three-elements-of-a-good-beatmix");
const DDJT_BEATMATCH = DDJT("Learn to beatmatch", "learn-to-beatmatch");
const DDJT_TIMING = DDJT("Beatmixing, part 1: Timing", "rock-the-dancefloor/beatmixing-part-1-timing");
const DDJT_TRANSITIONS = DDJT("Five basic DJ transitions", "rock-the-dancefloor/five-basic-dj-transitions");
const DDJT_EQ = DDJT("Adding EQ, filters and effects", "rock-the-dancefloor/adding-eq-filters-and-effects");
const DDJT_KEY = DDJT("The ultimate guide to keymixing for DJs", "the-ultimate-guide-to-keymixing-for-djs");
const DDJT_VOLUME = DDJT("Getting the volume right", "a-practical-guide-to-volume-settings-for-djs");
const DDJT_PACK = DDJT("How to pack the perfect DJ set", "rock-the-dancefloor/how-to-pack-the-perfect-dj-set");
const DDJT_WARMUP = DDJT("How to DJ warm-up sets", "how-to-dj-warm-up-sets");
const DDJT_WARMUP_TIPS = DDJT("5 essential tips for playing a great warm-up set", "5-essential-tips-for-playing-a-great-warm-up-set");
const DDJT_RECORD = DDJT("How to record and critique your sets", "rock-the-dancefloor/how-to-record-and-critique-your-sets");
const MIK: GuideSource = { label: "Mixed In Key: How to use the Camelot wheel", url: "https://mixedinkey.com/workflows/how-to-use-the-camelot-wheel/" };

export const GUIDE: GuideCard[] = [
  // ---------- Neu dabei ----------
  {
    slug: "grundausstattung",
    area: "start",
    title: "Was du zum Auflegen brauchst",
    lead: "Zwei Plattenspieler, ein Mixer, Kopfhörer, Boxen. Mehr braucht es am Anfang nicht.",
    todo: [
      "Plattenspieler mit Direktantrieb und Pitch-Regler. Der Motor sitzt direkt unter dem Teller: viel Kraft, stabiles Tempo, schneller Start. Das brauchst du, um zwei Platten anzugleichen.",
      "Ein Mixer mit zwei Phono-Eingängen und Vorhören über Kopfhörer.",
      "Ein DJ-System mit sphärischer Nadel, wenn du viel zurückdrehst oder scratchst.",
      "Boxen, die du direkt an den Mixer hängen kannst (aktive Boxen), sind für den Anfang am einfachsten.",
    ],
    avoid: ["Zum Mixen einen Plattenspieler mit Riemenantrieb kaufen. Er läuft langsamer an und ist fürs Hören zuhause gebaut."],
    see: ["phono-oder-line", "nadelform", "aktiv-oder-passiv"],
    sources: [AT_DRIVE, ORTOFON_DJ],
  },
  {
    slug: "phono-oder-line",
    area: "start",
    title: "Phono oder Line: richtig anschließen",
    lead: "Ein Plattenspieler liefert ein sehr leises Signal. Es muss erst verstärkt und entzerrt werden, das macht der Phono-Eingang.",
    todo: [
      "Plattenspieler in einen Eingang mit der Aufschrift Phono stecken. Der Mixer verstärkt und entzerrt dann selbst.",
      "Hat dein Plattenspieler einen Schalter Phono/Line: auf Phono für den Phono-Eingang, auf Line für alles andere (Line-Eingang, Aktivboxen).",
      "Das dünne Erdungskabel an die Schraube GND am Mixer klemmen. Fehlt es, brummt es.",
      "Vom Mixer in die Stereoanlage: immer in einen Line-Eingang (AUX, CD, Tape).",
    ],
    avoid: ["Zweimal vorverstärken, also Schalter auf Line und trotzdem in den Phono-Eingang. Das übersteuert.", "Ein Phono-Signal in einen Line-Eingang stecken. Dann ist es leise und dünn."],
    see: ["brummen-und-droehnen", "pegel"],
    sources: [AT_PHONO],
  },
  {
    slug: "erste-fehler",
    area: "start",
    title: "Fünf Fehler, die am Anfang fast jeder macht",
    lead: "Sie kosten Platten, Nadeln oder Gehör. Alle fünf lassen sich leicht vermeiden.",
    todo: [
      "Platten nur am Rand und am Etikett anfassen, nie auf den Rillen.",
      "Die Auflagekraft nach Angabe des Herstellers einstellen, nicht nach Gefühl.",
      "Den Nadelschutz aufsetzen, wenn der Plattenspieler steht oder getragen wird.",
      "Den Pegel am Mixer aus dem roten Bereich halten.",
      "Gehörschutz einstecken, auch wenn du selbst auflegst.",
    ],
    see: ["anfassen", "auflagekraft", "pegel", "gehoer"],
    sources: [LOC, ORTOFON_CARE, ORTOFON_DJ],
  },

  // ---------- Platten ----------
  {
    slug: "anfassen",
    area: "platten",
    title: "Platten richtig anfassen",
    lead: "Fingerabdrücke verschmieren und halten Staub fest. Der landet in der Rille und unter der Nadel.",
    todo: [
      "Nur am Rand und am Etikett halten.",
      "Hände vorher waschen und gut abtrocknen.",
      "Platten, die im Kalten lagen (Keller, Auto im Winter), erst auf Zimmertemperatur kommen lassen, bevor du sie spielst.",
    ],
    avoid: ["Die Spielfläche berühren.", "Essen und Getränke neben den Platten."],
    see: ["staub", "lagern"],
    sources: [LOC, CCI],
  },
  {
    slug: "staub",
    area: "platten",
    title: "Staub runter vor dem Spielen",
    lead: "Staub und Schmutz in der Rille nutzen die Nadel schneller ab und machen den Klang schlechter.",
    todo: [
      "Vor dem Auflegen mit einer Plattenbürste über die Platte gehen.",
      "Losen Staub kannst du auch mit Druckluft wegblasen.",
      "Sichtbar beschädigte Platten nicht spielen: Kratzer und Risse nutzen die Nadel stark ab.",
    ],
    avoid: ["Mit Ärmel oder irgendeinem Tuch drüberwischen. Falsches Reinigen kann mehr schaden, als die Platte in Ruhe zu lassen."],
    see: ["waschen", "nadel-reinigen"],
    sources: [ORTOFON_CARE, LOC, CCI],
  },
  {
    slug: "waschen",
    area: "platten",
    title: "Wann eine Platte gewaschen werden muss",
    lead: "Nur wenn sie wirklich schmutzig ist. Zu häufiges oder falsches Reinigen macht mehr Probleme, als es löst.",
    todo: [
      "Am sichersten ist eine Plattenwaschmaschine.",
      "Ein Mittel nehmen, das für Schallplatten gemacht ist, und danach mit destilliertem Wasser nachspülen, damit nichts in der Rille bleibt.",
      "Die Platte erst ganz trocken wieder in die Hülle stecken.",
    ],
    avoid: ["Schellackplatten (78er) und Lackfolien wie Vinyl waschen. Sie vertragen Wasser schlecht und können Schaden nehmen.", "Zur Sicherheit jede Platte waschen, auch wenn sie sauber ist."],
    see: ["staub", "lagern"],
    sources: [CCI],
  },
  {
    slug: "lagern",
    area: "platten",
    title: "Hüllen und Lagern",
    lead: "Platten stehen aufrecht, kühl und trocken. So verziehen sie sich nicht.",
    todo: [
      "Immer aufrecht stellen.",
      "Kühl und eher trocken lagern: Zimmertemperatur oder darunter, rund 35 bis 40 % Luftfeuchte.",
      "Abstand zu Heizung, Lüftung und direkter Sonne halten.",
      "Innenhüllen aus weichem Polyethylen nehmen (gefütterte Hüllen). Die passen auch in die alte Papierhülle, wenn du sie behalten willst.",
      "Im Regal alle 10 bis 15 cm eine feste Stütze, damit nichts schräg lehnt. Platten sind schwer: rund 50 kg je Regalmeter.",
      "Platten gleicher Größe zusammen stellen.",
    ],
    avoid: ["Dachboden, Keller und andere Orte mit Feuchte oder großen Temperatursprüngen.", "Hüllen aus PVC oder saurem Karton für die Platte selbst."],
    see: ["unterwegs", "anfassen"],
    sources: [LOC, CCI],
  },
  {
    slug: "unterwegs",
    area: "platten",
    title: "Platten zum Gig bringen",
    lead: "Vinyl verformt sich leicht, wenn es warm wird oder die Temperatur stark schwankt. Im Auto passiert das schneller als im Club.",
    todo: [
      "Aufrecht in einer festen Tasche oder Kiste transportieren.",
      "Die Tasche nicht im Auto in der Sonne stehen lassen und nicht neben die Heizung stellen.",
      "Sind die Platten unterwegs kalt geworden: kurz warm werden lassen, bevor du sie spielst.",
    ],
    avoid: ["Platten flach stapeln, erst recht in der Wärme."],
    more: [{ label: "Kiste für ein Set packen", to: "/sets" }],
    see: ["tasche", "lagern"],
    sources: [LOC, CCI],
  },
  {
    slug: "verschicken",
    area: "platten",
    title: "Platten sicher verschicken",
    lead: "Typische Versandschäden sind aufgeplatzte Hüllenkanten, geknickte Ecken und verzogene Platten.",
    todo: [
      "Die Platte aus dem Cover nehmen und in ihrer Innenhülle neben das Cover legen. Steckt sie drin, schlägt sie bei einem Stoß die Kante der Hülle auf.",
      "Beides zusammen in eine Schutzhülle stecken.",
      "Zwischen zwei Pappen (Stiffener) in einen stabilen Plattenkarton legen.",
      "Ecken schützen. Im Karton darf nichts rutschen.",
    ],
    avoid: ["Dünne Versandtaschen ohne Verstärkung.", "Dich auf den Aufkleber „Nicht knicken“ verlassen."],
    more: [{ label: "Was könnte weg? Im Wert-Blatt deiner Sammlung", to: "/collection" }],
    sources: [SHIPSTATION, EASYSHIP],
  },

  // ---------- Nadel und System ----------
  {
    slug: "nadel-reinigen",
    area: "nadel",
    title: "Die Nadel reinigen",
    lead: "Eine saubere Nadel klingt besser und hält länger. Es dauert zwei Sekunden.",
    todo: [
      "Eine trockene Nadelbürste nehmen.",
      "Immer von hinten nach vorn bürsten: vom System zur Nadelspitze, so wie die Platte läuft.",
      "Ein paar Züge reichen. Vor jeder Session und immer, wenn du die Platte oder die Seite wechselst.",
      "Nadelschutz aufsetzen, wenn das System nicht benutzt wird.",
    ],
    avoid: ["Von vorn nach hinten oder seitlich bürsten.", "Flüssigkeiten oder Gele benutzen. Sie können Nadel und System beschädigen.", "Die Nadel mit dem Finger anfassen."],
    more: [{ label: "Nadel-Stunden ansehen", to: "/settings/stylus" }],
    see: ["nadel-wechseln", "staub"],
    sources: [ORTOFON_CARE],
  },
  {
    slug: "auflagekraft",
    area: "nadel",
    title: "Auflagekraft und Antiskating",
    lead: "Jedes System hat einen Bereich, in dem es sauber abtastet. Außerhalb springt die Nadel, klingt schlechter oder nutzt die Platte unnötig ab.",
    todo: [
      "Tonarm ausbalancieren: Nadelschutz ab, Gegengewicht drehen, bis der Arm waagerecht schwebt.",
      "Die Skala auf 0 stellen, dann das ganze Gegengewicht auf den Wert des Herstellers drehen.",
      "Im angegebenen Bereich bleiben. Bei DJ-Systemen liegt er meist zwischen drei und vier Gramm.",
      "Antiskating beim Auflegen auf 0 stellen. So folgt die Nadel der Rille, egal in welche Richtung die Platte läuft.",
      "Nur zum reinen Hören: Antiskating etwa auf den Wert der Auflagekraft.",
    ],
    avoid: ["Das System schräg in die Headshell schrauben, um einen geraden Tonarm nachzuahmen. Das nutzt Platte und Nadel stark ab."],
    see: ["nadelform", "vor-dem-ersten-track"],
    sources: [ORTOFON_DJ, AT_TONEARM],
  },
  {
    slug: "nadelform",
    area: "nadel",
    title: "Sphärisch oder elliptisch",
    lead: "Die Form der Nadelspitze entscheidet, wofür ein System taugt.",
    todo: [
      "Sphärisch (rund): für viel Zurückdrehen und Scratchen. Bleibt sicher in der Rille und verzeiht mehr.",
      "Elliptisch: für leichteres Cueing und den besseren Klang.",
      "Eine neue Nadel braucht bis zu 20 Stunden normales Abspielen, bis sie eingespielt ist.",
    ],
    avoid: ["Nadeln verschiedener Serien mischen. Sie passen oft nicht einmal mechanisch.", "Eine neue Nadel in der Auslaufrille einspielen. Das hinterlässt Rückstände am Diamanten."],
    see: ["auflagekraft", "nadel-wechseln"],
    sources: [ORTOFON_DJ, ORTOFON_SHAPE],
  },
  {
    slug: "nadel-wechseln",
    area: "nadel",
    title: "Wann die Nadel neu muss",
    lead: "Eine Nadel nutzt sich langsam ab. Man gewöhnt sich an den Klang und merkt es spät.",
    todo: [
      "Achte auf mehr Rauschen und Knistern, Verzerrungen, fehlende Höhen und weniger Klarheit.",
      "Die Stunden mitzählen. Crate rechnet sie aus deinen gespielten Sets und erinnert dich rechtzeitig.",
      "Die Angabe des Herstellers zur Lebensdauer als Richtwert nehmen.",
    ],
    avoid: ["Warten, bis es deutlich kratzt."],
    more: [{ label: "Nadel-Stunden ansehen", to: "/settings/stylus" }],
    see: ["nadel-reinigen"],
    sources: [ORTOFON_CARE],
  },

  // ---------- Anlage ----------
  {
    slug: "aktiv-oder-passiv",
    area: "anlage",
    title: "Aktive oder passive Boxen",
    lead: "Bei aktiven Boxen steckt der Verstärker im Gehäuse. Passive brauchen eine eigene Endstufe.",
    todo: [
      "Aktiv: Mixer anschließen, Strom dran, fertig. Meist kompakt und gut für zuhause und kleine bis mittlere Partys.",
      "Passiv: Endstufe und Boxen sind getrennt und müssen zueinander passen. Das verlangt etwas Grundwissen.",
      "Passive Boxen enthalten weniger Bauteile und sind einzeln günstiger zu ersetzen.",
    ],
    avoid: ["Passive Boxen direkt an den Mixer hängen. Ohne Endstufe kommt nichts an."],
    see: ["hifi-monitore-pa", "boxen-aufstellen"],
    sources: [THOMANN_PA, DELAMAR],
  },
  {
    slug: "hifi-monitore-pa",
    area: "anlage",
    title: "Stereoanlage, Monitore oder PA",
    lead: "Welche Boxen passen, hängt davon ab, wo du auflegst: allein zuhause oder vor Leuten.",
    todo: [
      "Stereoanlage zuhause: Mixer in einen Line-Eingang des Verstärkers (AUX, CD, Tape). Zum Üben reicht das.",
      "Studiomonitore: für das Üben am Pult, nah am Ohr aufgestellt.",
      "PA: wenn du einen Raum mit Leuten beschallst. Es gibt sie aktiv und passiv, auch als fertiges Set.",
    ],
    avoid: ["Die Wohnzimmer-Anlage auf der Party am Anschlag fahren. Ein übersteuertes Signal klingt schlecht und kann im schlimmsten Fall Lautsprecher beschädigen."],
    see: ["aktiv-oder-passiv", "pegel"],
    sources: [THOMANN_PA, AT_PHONO, DJTT],
  },
  {
    slug: "boxen-aufstellen",
    area: "anlage",
    title: "Boxen aufstellen",
    lead: "Gut aufgestellte Boxen klingen deutlich besser. Das kostet nichts.",
    todo: [
      "Du und die beiden Boxen bilden ein gleichseitiges Dreieck (60 Grad). Beide zeigen auf dich.",
      "Die Boxen stehen auf Ohrhöhe.",
      "Beide gleich hoch und gleich weit von den Seitenwänden und der Wand dahinter.",
      "Dein Platz ist mindestens einen Meter von den Wänden entfernt und nicht genau in der Raummitte.",
      "Plattenspieler und Boxen stehen auf getrennten Flächen.",
    ],
    avoid: ["Boxen auf denselben Tisch stellen wie die Plattenspieler. Der Bass wandert über die Fläche in die Nadel und es dröhnt."],
    see: ["brummen-und-droehnen"],
    sources: [GENELEC, UTURN],
  },
  {
    slug: "pegel",
    area: "anlage",
    title: "Gain, Pegel und der rote Bereich",
    lead: "Rot am Mixer heißt: das Signal wird abgeschnitten. Es klingt schlechter und wird nicht lauter.",
    todo: [
      "Alle EQ-Regler in die Mitte stellen. Dann den Gain so, dass die Anzeige im Schnitt bei 0 dB liegt (die letzte grüne Leuchte). Laute Schläge dürfen ins Gelbe, nie ins Rote.",
      "Kanalfader ganz auf. Den Master genauso einstellen: im Schnitt 0 dB.",
      "Danach je Platte nur noch den Gain nachstellen, damit alle gleich laut sind.",
      "Leuchtet es rot: Gain, EQ oder Fader zurücknehmen.",
      "Reicht die Lautstärke nicht, an der Endstufe oder an den Boxen aufdrehen. Ist dort Schluss, braucht es mehr Anlage, nicht mehr Gain.",
    ],
    avoid: [
      "Im Roten fahren. Im schlimmsten Fall beschädigt das die Lautsprecher.",
      "Im Club mehr Gain geben, damit es lauter wird. Dort sitzt oft ein Limiter in der Anlage: es wird nur schlechter und ermüdet die Leute.",
    ],
    see: ["bass-tauschen", "brummen-und-droehnen", "vor-dem-ersten-track"],
    sources: [DDJT_VOLUME, DJTT, XONE, BONEDO],
  },
  {
    slug: "brummen-und-droehnen",
    area: "anlage",
    title: "Brummen und Dröhnen loswerden",
    lead: "Brummen kommt meist von der Erdung. Dröhnen entsteht, wenn die Boxen den Plattenspieler anregen und die Nadel das wieder aufnimmt.",
    todo: [
      "Brummen: das Erdungskabel des Plattenspielers an die Masseschraube des Mixers klemmen.",
      "Dröhnen bei lauter Musik: Plattenspieler und Boxen trennen, jedes auf eine eigene Fläche oder einen Ständer.",
      "Den Plattenspieler auf etwas Schweres und Festes stellen.",
      "Bass und Gain am Mixer etwas zurücknehmen.",
    ],
    avoid: ["Schaumstoff unter die Boxen legen und erwarten, dass der Bass wegbleibt. Bei tiefen Tönen hilft das kaum."],
    see: ["boxen-aufstellen", "phono-oder-line"],
    sources: [UTURN, PSW],
  },

  // ---------- Mixen ----------
  {
    slug: "tempo-angleichen",
    area: "mixen",
    title: "Zwei Platten auf ein Tempo bringen",
    lead: "Drei Dinge müssen stimmen: gleiches Tempo, Schläge übereinander, Phrasen übereinander. Das Ohr lernt das nur durch Wiederholen.",
    todo: [
      "Die neue Platte auf der Eins einer Phrase bereitlegen, am besten dort, wo der Beat eine Weile ohne Pause läuft.",
      "Ein Ohr hört die Boxen, das andere den Kopfhörer.",
      "Die neue Platte starten, wenn die laufende auf ihrer Eins ist. Dann hinhören: zieht sie davon oder fällt sie zurück?",
      "Erst mit der Hand an Teller oder Platte kurz anschieben oder bremsen, dann den Pitch ein kleines Stück nachstellen. Immer in dieser Reihenfolge.",
      "Wiederholen, bis beide lange beieinander bleiben. Dann stimmt das Tempo.",
      "Zum Üben: zwei Exemplare derselben Platte oder schlichter House mit klarem Beat.",
    ],
    avoid: [
      "Den Kopfhörer immer lauter drehen. Kleine Unterschiede hörst du dann schlechter.",
      "Platten zusammenbringen, die im Tempo weit auseinanderliegen. Als Faustregel gelten rund 4 %, bei House etwa 5 BPM.",
    ],
    see: ["takte-und-phrasen", "uebergaenge"],
    sources: [DDJT_ELEMENTS, DDJT_BEATMATCH],
  },
  {
    slug: "takte-und-phrasen",
    area: "mixen",
    title: "Takte und Phrasen zählen",
    lead: "Fast alle Tanzmusik läuft in Takten zu vier Schlägen, und die Takte bilden Gruppen von vier oder acht. An deren Anfang ändert sich die Musik.",
    todo: [
      "Auf die Bassdrum mitzählen: eins, zwei, drei, vier. Die Eins betonen.",
      "Phrasen zählst du, indem du auf jeder Eins die Nummer des Takts sagst: 1-2-3-4, 2-2-3-4, 3-2-3-4, 4-2-3-4.",
      "Auf die Eins einer neuen Phrase achten: dort setzt etwas ein oder fällt weg, zum Beispiel Gesang, Bassline oder Hi-Hat.",
      "Die neue Platte so starten, dass ihre Phrasen auf den Phrasen der laufenden liegen.",
      "Zum Üben ein paar Platten aufzeichnen: ein Kästchen je vier oder acht Takte, dazu was dort passiert.",
    ],
    avoid: ["Nur die Schläge übereinanderlegen und die Takte übergehen. Das klingt schief, auch wenn das Tempo stimmt."],
    see: ["tempo-angleichen", "uebergaenge"],
    sources: [DDJT_TIMING, DDJT_ELEMENTS],
  },
  {
    slug: "uebergaenge",
    area: "mixen",
    title: "Fünf Übergänge, die reichen",
    lead: "Nicht jeder Übergang muss ein langer Mix sein. Mit diesen fünf kommst du durch jeden Abend.",
    todo: [
      "Ausblenden: die laufende Platte erst zügig, dann langsam über 10 bis 15 Sekunden leiser machen und die neue auf einer Eins starten. Hilft immer, wenn etwas nicht passt.",
      "Ende an Anfang: die Platte ausspielen lassen, mitzählen, die nächste auf der Eins starten. Gut bei Stücken mit klarem Schluss.",
      "Schnitt: auf einer Eins die eine stoppen und die andere starten. Lebt vom Zeitpunkt und von der Wahl der Platte.",
      "Kurzer Mix: beide laufen eine Phrase lang zusammen (vier oder acht Takte), dann geht die alte raus. Am besten dort, wo fast nur Schlagzeug spielt.",
      "Mix mit Bass-Tausch: länger überblenden und dabei die Bässe tauschen. Für House, Techno und Disco.",
    ],
    avoid: ["Lange übereinanderlegen, ohne die Bässe zu trennen. Zwei Bassdrums und zwei Basslines klingen matschig."],
    see: ["bass-tauschen", "takte-und-phrasen"],
    sources: [DDJT_TRANSITIONS],
  },
  {
    slug: "bass-tauschen",
    area: "mixen",
    title: "Mit dem EQ mixen: Bässe tauschen",
    lead: "Zwei Bassdrums und zwei Basslines gleichzeitig klingen schlechter, nicht fetter. Deshalb spielt immer nur ein Bass.",
    todo: [
      "Bei der neuen Platte den Bass ganz herausdrehen, bevor du sie dazunimmst.",
      "Die neue Platte hereinholen. Auf der Eins einer Phrase tauschen: Bass bei der neuen rein, bei der alten raus.",
      "Danach die alte Platte ausblenden.",
      "Sonst stehen die EQ-Regler in der Mitte. Gedreht wird nur, wenn es einen Grund gibt.",
      "Lieber Frequenzen wegnehmen als anheben und den Pegel mit dem Gain ausgleichen.",
    ],
    avoid: ["Bässe anheben, damit es mehr drückt. Das verbraucht den Spielraum des Mixers am schnellsten."],
    see: ["uebergaenge", "pegel"],
    sources: [DDJT_TRANSITIONS, DDJT_EQ, DDJT_VOLUME],
  },
  {
    slug: "harmonisch-mixen",
    area: "mixen",
    title: "Harmonisch mixen mit dem Camelot-Rad",
    lead: "Laufen zwei Platten mit Melodie oder Bassline zusammen, sollten ihre Tonarten zueinander passen. Das Camelot-Rad macht daraus eine Zahl und einen Buchstaben.",
    todo: [
      "Jede Tonart hat eine Zahl von 1 bis 12 und einen Buchstaben: A steht für Moll, B für Dur.",
      "Es passt: dieselbe Tonart (8A auf 8A), eine Zahl hoch oder runter (8A auf 7A oder 9A) oder dieselbe Zahl mit dem anderen Buchstaben (8A auf 8B).",
      "Das zählt nur, wo beide Platten wirklich Töne spielen. Läuft an der Stelle nur Schlagzeug, ist die Tonart egal.",
      "Am sichersten: von jeder Sorte nur eins. Eine Bassline gegen eine Melodie, nicht Melodie gegen Melodie.",
      "Am Ende entscheidet dein Ohr. Die Tonart ist ein Werkzeug, keine Regel.",
    ],
    avoid: [
      "Der Angabe blind vertrauen. Keine Erkennung liegt immer richtig. In Crate steht bei unsicheren Tonarten deshalb ein Fragezeichen.",
      "Die richtige Platte für den Moment liegen lassen, nur weil die Tonart nicht passt.",
    ],
    more: [{ label: "Nächster Track: Platten, die nach Tonart und Tempo passen", to: "/sets" }],
    see: ["uebergaenge", "set-packen"],
    sources: [DDJT_KEY, MIK],
  },

  // ---------- Auflegen ----------
  {
    slug: "set-packen",
    area: "auflegen",
    title: "Wie viele Platten du einpackst",
    lead: "Nimm ungefähr doppelt so viel Musik mit, wie du spielen wirst. Mit weniger hängst du an einer festen Reihenfolge, mit viel mehr fällt die Wahl schwer.",
    todo: [
      "Ausrechnen, wie viele Stücke du in deiner Zeit spielst, und das Doppelte einpacken.",
      "Bei jeder Platte drei Fragen: Passt sie zum Abend? Mag das Publikum sie? Willst du sie selbst spielen?",
      "Kleine Gruppen aus zwei bis vier Platten bilden, die gut aufeinander folgen.",
      "Die Kiste grob in der Reihenfolge des Abends sortieren, die ruhigen Platten nach vorn.",
      "Bewährtes von früheren Gigs mitnehmen, dazu ein paar neue und ein paar sichere Platten.",
      "Vorher klären, was Veranstalter und Laden erwarten. Kennst du den Ort nicht: hingehen und zuhören.",
    ],
    avoid: ["Eine feste Liste abspielen. Die Kiste ist ein Plan, kein Drehbuch."],
    more: [{ label: "Kiste für ein Set packen", to: "/sets" }],
    see: ["tasche", "warm-up"],
    sources: [DDJT_PACK],
  },
  {
    slug: "tasche",
    area: "auflegen",
    title: "Was in die Tasche gehört",
    lead: "Die Platten vergisst niemand. Den Rest schon.",
    todo: [
      "Ersatznadel oder ein zweites System.",
      "Eigene Kopfhörer und ein Adapter von 3,5 auf 6,3 mm.",
      "Slipmats und ein Puck für Singles.",
      "Nadelbürste und Plattenbürste.",
      "Gehörschutz.",
      "Die Setliste: gedruckt oder in Crate, dort liegt sie auch ohne Netz bereit.",
    ],
    more: [{ label: "Sets und Kisten", to: "/sets" }],
    see: ["unterwegs", "vor-dem-ersten-track"],
    sources: [],
    practice: true,
  },
  {
    slug: "vor-dem-ersten-track",
    area: "auflegen",
    title: "Vor dem ersten Track",
    lead: "Fremde Plattenspieler sind selten so eingestellt wie deine. Fünf Minuten vorher sparen dir den Ärger mittendrin.",
    todo: [
      "Nadeln ansehen und kurz abbürsten.",
      "Auflagekraft prüfen und Antiskating auf 0 stellen.",
      "Beide Plattenspieler und beide Seiten (links, rechts) kurz anspielen. Brummt es, sitzt die Erdung nicht.",
      "Den Pegel mit einer lauten Platte einstellen.",
      "Den Monitor so laut wie nötig, nicht lauter.",
    ],
    see: ["auflagekraft", "pegel", "gehoer"],
    sources: [ORTOFON_DJ],
    practice: true,
  },
  {
    slug: "warm-up",
    area: "auflegen",
    title: "Ein Warm-up spielen",
    lead: "Wer anfängt, baut die Stimmung langsam auf und überlässt den Höhepunkt dem, der danach kommt. Ein Freibrief für langweilige Musik ist das nicht.",
    todo: [
      "Leiser anfangen, als der Abend wird, und mit niedrigerem Tempo.",
      "Die Energie langsam steigern. Die Tanzfläche soll einladend wirken für alle, die gerade hereinkommen.",
      "Dubs und Instrumentals statt der großen Versionen: andeuten, nicht ausspielen.",
      "Für die spielen, die schon tanzen, auch wenn es wenige sind.",
      "Die eigene Zeit einhalten.",
    ],
    avoid: ["Die großen Platten des Abends verheizen und früh laut machen.", "Stücke spielen, die von den DJs nach dir stammen."],
    see: ["set-packen", "vor-dem-ersten-track"],
    sources: [DDJT_WARMUP, DDJT_WARMUP_TIPS],
  },
  {
    slug: "aufnehmen",
    area: "auflegen",
    title: "Dein Set aufnehmen und anhören",
    lead: "Beim Auflegen kannst du dich nicht selbst beurteilen. Erst die Aufnahme zeigt, was die Leute wirklich gehört haben.",
    todo: [
      "Jede Übungsrunde mitschneiden, von Anfang bis Ende. Bei Fehlern einfach weiterspielen.",
      "Aus dem Mixer aufnehmen, mit Kabel in einen Recorder oder ins Handy, nicht über das Mikrofon des Handys.",
      "Mit Abstand anhören: am besten erst am nächsten Tag und nicht am Pult.",
      "Einmal nebenbei laufen lassen für den Gesamteindruck, einmal konzentriert für die Einzelheiten.",
      "Achte auf Auswahl und Reihenfolge, ob die Schläge saßen und ob die Lautstärke über das Set gleich bleibt.",
    ],
    avoid: ["Die Aufnahme für ein fertiges Mixtape halten. Sie ist zum Lernen da."],
    see: ["tempo-angleichen", "pegel"],
    sources: [DDJT_RECORD],
  },
  {
    slug: "gehoer",
    area: "auflegen",
    title: "Gehör schützen",
    lead: "Laut der WHO sind weltweit über eine Milliarde junger Menschen durch laute Musik in der Freizeit von Hörverlust bedroht. Wer auflegt, steht am längsten im Lauten.",
    todo: [
      "Gehörschutz tragen, auch hinter dem Pult.",
      "Als Richtwert der WHO für Kopfhörer: 80 dB bis zu 40 Stunden in der Woche.",
      "Für Veranstaltungen empfiehlt die WHO höchstens 100 dB im Mittel über 15 Minuten.",
      "Den Monitor zwischen den Übergängen leiser drehen.",
    ],
    avoid: ["Den Monitor immer lauter machen, weil die Ohren müde werden."],
    see: ["vor-dem-ersten-track", "tasche"],
    sources: [WHO_VENUES, WHO_DEVICES],
  },
];

export const guideCard = (slug: string | undefined): GuideCard | undefined => GUIDE.find((c) => c.slug === slug);
export const guideArea = (id: GuideArea) => GUIDE_AREAS.find((a) => a.id === id)!;
export const cardsOf = (area: GuideArea) => GUIDE.filter((c) => c.area === area);

/** Die nächste Karte im selben Bereich, am Ende die erste des nächsten Bereichs */
export function nextCard(slug: string): GuideCard | undefined {
  const i = GUIDE.findIndex((c) => c.slug === slug);
  return i >= 0 ? GUIDE[i + 1] : undefined;
}

/** Alles, was die Suche durchsucht */
export const cardText = (c: GuideCard) => [c.title, c.lead, ...c.todo, ...(c.avoid ?? []), guideArea(c.area).title].join(" ");
