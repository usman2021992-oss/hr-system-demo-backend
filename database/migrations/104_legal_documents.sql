CREATE TABLE IF NOT EXISTS legal_documents (
  id SERIAL PRIMARY KEY,
  document_key VARCHAR(50) NOT NULL,
  language VARCHAR(5) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(document_key, language)
);

-- Seed initial Privacy Policy (IT)
INSERT INTO legal_documents (document_key, language, title, content)
VALUES (
  'privacy',
  'it',
  'INFORMATIVA SULLA PRIVACY',
  'Ultimo aggiornamento: 8 Giugno 2026

La presente informativa descrive le modalità di trattamento dei dati personali dei candidati che presentano la propria candidatura presso {{companyName}}, in qualità di Titolare del trattamento.

Il trattamento dei dati personali avviene nel rispetto del Regolamento (UE) 2016/679 (GDPR) e della normativa nazionale applicabile.

---

1. TITOLARE DEL TRATTAMENTO

Il Titolare del trattamento dei dati personali è {{companyName}}

Per qualsiasi richiesta o informazione relativa al trattamento dei dati personali, è possibile contattare il Titolare al seguente indirizzo email:
{{companyEmail}}

---

2. UTILIZZO DELLA PIATTAFORMA

La gestione delle candidature avviene tramite strumenti informatici messi a disposizione dalla piattaforma Veylo HR.

Il Titolare utilizza tali strumenti in autonomia, determinando finalità, modalità e tempi di conservazione dei dati personali trattati.

Il Titolare è l’unico responsabile della gestione dei dati inseriti e del loro utilizzo nell’ambito delle attività di selezione del personale.

---

3. TIPOLOGIA DI DATI TRATTATI

Nel contesto della candidatura possono essere raccolti:

- dati identificativi e di contatto (nome, cognome, email, telefono)
- informazioni professionali (CV, esperienze lavorative, formazione, competenze)
- informazioni fornite volontariamente dal candidato
- preferenze lavorative e disponibilità

L’utente è invitato a non inserire dati non necessari o non pertinenti.

---

4. FINALITÀ DEL TRATTAMENTO

I dati personali sono trattati esclusivamente per:

- gestione delle candidature
- selezione del personale
- valutazione dei profili professionali
- eventuale contatto per opportunità lavorative presenti o future

---

5. BASE GIURIDICA DEL TRATTAMENTO

Il trattamento si basa su:

- misure precontrattuali richieste dall’interessato
- legittimo interesse del Titolare alla gestione del processo di selezione

---

6. MODALITÀ DEL TRATTAMENTO

Il trattamento dei dati avviene tramite strumenti informatici e telematici.

Il Titolare è responsabile della corretta gestione degli accessi, dell’utilizzo dei dati e dell’adozione delle misure organizzative interne necessarie.

---

7. CONSERVAZIONE DEI DATI

I dati saranno conservati per un periodo massimo di 24 mesi dalla candidatura o dall’ultimo contatto, salvo diverse esigenze o obblighi di legge.

---

8. COMUNICAZIONE DEI DATI

I dati personali non sono oggetto di diffusione.

Essi possono essere trattati tramite strumenti tecnologici utilizzati dal Titolare per l’erogazione del servizio.

---

9. DIRITTI DELL’INTERESSATO

L’interessato può esercitare i diritti previsti dalla normativa vigente in materia di protezione dei dati personali.

Tali richieste devono essere rivolte direttamente al Titolare del trattamento ai recapiti indicati.'
)
ON CONFLICT (document_key, language) DO NOTHING;

-- Seed initial Privacy Policy (EN)
INSERT INTO legal_documents (document_key, language, title, content)
VALUES (
  'privacy',
  'en',
  'PRIVACY POLICY',
  'Last Updated: June 8, 2026

This privacy policy describes how we process the personal data of candidates applying for open positions at {{companyName}}, acting as Data Controller.

The processing of personal data takes place in compliance with Regulation (EU) 2016/679 (GDPR) and the applicable national legislation.

---

1. DATA CONTROLLER

The Data Controller of personal data is {{companyName}}

For any requests or questions regarding how your personal data is handled, please contact us at:
{{companyEmail}}

---

2. USE OF THE PLATFORM

The management of applications takes place through computer tools made available by the Veylo HR platform.

The Data Controller uses these tools independently, determining the purposes, methods, and retention times of the processed personal data.

The Data Controller is solely responsible for the management of the entered data and their use within the scope of personnel selection activities.

---

3. TYPES OF DATA PROCESSED

We collect the following categories of data in the context of applications:

- Contact details: first name, last name, email address, phone number
- Professional profile: CV/Resume, cover letters, references, education history, and skills
- Information provided voluntarily by the candidate
- Preferences: work availability, salary expectations, and location preferences

The user is invited not to enter unnecessary or irrelevant data.

---

4. PURPOSE OF THE PROCESSING

The collected data is used exclusively for:

- management of applications
- personnel selection
- evaluation of professional profiles
- potential contact for present or future job opportunities

---

5. LEGAL BASIS OF THE PROCESSING

The processing is based on:

- pre-contractual measures requested by the data subject
- legitimate interest of the Data Controller in managing the selection process

---

6. METHOD OF PROCESSING

The processing of data takes place through computer and telematic tools.

The Data Controller is responsible for the correct management of accesses, use of data, and adoption of the necessary internal organizational measures.

---

7. DATA RETENTION

Candidate data will be retained for a maximum period of 24 months from the last contact or application submission, after which it will be safely deleted or anonymized to protect your privacy.

---

8. COMMUNICATION OF DATA

Personal data is not subject to dissemination.

They may be processed through technological tools used by the Data Controller for the provision of the service.

---

9. RIGHTS OF THE DATA SUBJECT

Under GDPR, you can exercise the rights provided by the current legislation on the protection of personal data.

Such requests must be addressed directly to the Data Controller at the contact details indicated.'
)
ON CONFLICT (document_key, language) DO NOTHING;

-- Seed initial Terms of Service (IT)
INSERT INTO legal_documents (document_key, language, title, content)
VALUES (
  'terms',
  'it',
  'TERMINI DI SERVIZIO',
  'Ultimo aggiornamento: 8 Giugno 2026

Benvenuto nel portale Careers di {{companyName}}

L’accesso e l’utilizzo del presente portale implica l’accettazione dei presenti Termini di Servizio.

---

1. UTILIZZO DEL PORTALE

Il portale è destinato esclusivamente a candidati interessati a opportunità lavorative presso {{companyName}}

È vietato:

- fornire dati falsi, incompleti o fuorvianti
- utilizzare il portale per finalità diverse dalla candidatura
- tentare di compromettere o alterare il funzionamento del sistema

---

2. CANDIDATURE E PROCESSO DI SELEZIONE

L’invio della candidatura non costituisce un’offerta di lavoro né genera alcun obbligo in capo a {{companyName}}

La valutazione delle candidature è gestita autonomamente dal Titolare.

---

3. RESPONSABILITÀ DEL TITOLARE

La gestione delle candidature, dei dati e dei processi di selezione è effettuata direttamente da {{companyName}}

Il Titolare è responsabile:

- della gestione delle informazioni inserite
- dell’utilizzo dei dati
- delle decisioni legate alla selezione

---

4. PIATTAFORMA TECNOLOGICA

Il portale è reso disponibile tramite la piattaforma Veylo HR.

Veylo HR fornisce esclusivamente l’infrastruttura tecnica e non partecipa ai processi decisionali né alla gestione delle candidature.

---

5. LIMITAZIONE DI RESPONSABILITÀ

Nei limiti consentiti dalla legge, Veylo HR non è responsabile per:

- contenuti inseriti dal Titolare o dagli utenti
- errori o inesattezze nei dati
- decisioni di selezione o mancati contatti
- utilizzi impropri della piattaforma

---

6. PROPRIETÀ INTELETTUALE

La piattaforma tecnologica, il software, il design e le funzionalità sono di proprietà di Veylo HR.

I contenuti inseriti dal Titolare (annunci, informazioni aziendali, ecc.) restano di proprietà del rispettivo Titolare.

È vietato qualsiasi utilizzo non autorizzato della piattaforma.

---

7. LEGGE APPLICABILE

I presenti Termini sono regolati dalla legge italiana.'
)
ON CONFLICT (document_key, language) DO NOTHING;

-- Seed initial Terms of Service (EN)
INSERT INTO legal_documents (document_key, language, title, content)
VALUES (
  'terms',
  'en',
  'TERMS OF SERVICE',
  'Last Updated: June 8, 2026

Welcome to the Careers portal of {{companyName}}

Access and use of this portal implies acceptance of these Terms of Service.

---

1. PORTAL USAGE

This portal is intended solely for candidates interested in job opportunities at {{companyName}}

It is prohibited to:

- provide false, incomplete, or misleading data
- use the portal for purposes other than the application
- attempt to compromise or alter the operation of the system

---

2. APPLICATIONS AND SELECTION PROCESS

Submitting an application does not constitute a job offer nor does it generate any obligation for {{companyName}}

The evaluation of applications is managed independently by the Data Controller.

---

3. RESPONSIBILITY OF THE CONTROLLER

The management of applications, data, and selection processes is carried out directly by {{companyName}}

The Controller is responsible:

- for the management of the entered information
- for the use of the data
- for decisions related to selection

---

4. TECHNOLOGICAL PLATFORM

The portal is made available through the Veylo HR platform.

Veylo HR provides only the technical infrastructure and does not participate in decision-making processes or application management.

---

5. LIMITATION OF LIABILITY

Within the limits allowed by law, Veylo HR is not responsible for:

- content entered by the Controller or users
- errors or inaccuracies in the data
- selection decisions or lack of contact
- improper uses of the platform

---

6. INTELLECTUAL PROPERTY

The technological platform, software, design, and features are property of Veylo HR.

Content entered by the Controller (job postings, company information, etc.) remains property of the respective Controller.

Any unauthorized use of the platform is prohibited.

---

7. APPLICABLE LAW

These Terms are governed by Italian law.'
)
ON CONFLICT (document_key, language) DO NOTHING;

-- Seed initial Cookie Policy (IT)
INSERT INTO legal_documents (document_key, language, title, content)
VALUES (
  'cookie',
  'it',
  'INFORMATIVA SUI COOKIE',
  'Ultimo aggiornamento: 8 Giugno 2026

Il portale Careers di {{companyName}} utilizza cookie e tecnologie simili per garantire il corretto funzionamento del sito e migliorare l’esperienza di navigazione.

---

1. TITOLARE DEL TRATTAMENTO

Il Titolare del trattamento dei dati è {{companyName}}

Per informazioni è possibile contattare:
{{companyEmail}}

---

2. COSA SONO I COOKIE

I cookie sono piccoli file di testo che vengono salvati sul dispositivo dell’utente durante la navigazione.

Tali file consentono il corretto funzionamento del sito e permettono di memorizzare alcune informazioni necessarie all’utilizzo del portale.

---

3. TIPOLOGIE DI COOKIE UTILIZZATI

Il portale utilizza le seguenti tipologie di cookie:

Cookie Tecnici (Necessari)
Essenziali per il funzionamento del sito (es. gestione sessione candidatura, compilazione moduli).

Cookie Analitici
Utilizzati, ove presenti, in forma aggregata e anonima per finalità statistiche (es. visualizzazione pagine, accessi).

Cookie di Profilazione
Il portale non utilizza cookie di profilazione o pubblicitari.

---

4. BASE GIURIDICA

I cookie tecnici sono utilizzati sulla base del legittimo interesse del Titolare.

Per eventuali cookie non tecnici, ove presenti, il consenso viene richiesto secondo la normativa vigente.

---

5. UTILIZZO DELLA PIATTAFORMA

Il portale è gestito tramite strumenti tecnologici forniti da Veylo HR.

Il Titolare utilizza tali strumenti per la gestione del sito e delle funzionalità connesse.

---

6. GESTIONE DEI COOKIE

L’utente può gestire o disabilitare i cookie tramite le impostazioni del proprio browser.

La disattivazione dei cookie tecnici potrebbe limitare il corretto funzionamento del portale.

---

7. CONSENSO

Laddove richiesto, il consenso all’utilizzo dei cookie viene raccolto tramite appositi strumenti informativi presenti sul sito.'
)
ON CONFLICT (document_key, language) DO NOTHING;

-- Seed initial Cookie Policy (EN)
INSERT INTO legal_documents (document_key, language, title, content)
VALUES (
  'cookie',
  'en',
  'COOKIE POLICY',
  'Last Updated: June 8, 2026

The Careers portal of {{companyName}} uses cookies and similar technologies to ensure the correct operation of the site and improve the browsing experience.

---

1. DATA CONTROLLER

The Data Controller of personal data is {{companyName}}

For information it is possible to contact:
{{companyEmail}}

---

2. WHAT ARE COOKIES

Cookies are small text files saved on the user''s device during browsing.

These files allow the correct operation of the site and allow storing some information necessary to use the portal.

---

3. TYPES OF COOKIES USED

The portal uses the following types of cookies:

Technical Cookies (Necessary)
Essential for the operation of the site (e.g. application session management, form filling).

Analytical Cookies
Used, where present, in aggregate and anonymous form for statistical purposes (e.g. page views, access).

Profiling Cookies
The portal does not use profiling or advertising cookies.

---

4. LEGAL BASIS

Technical cookies are used on the basis of the legitimate interest of the Controller.

For any non-technical cookies, where present, consent is requested according to the current legislation.

---

5. USE OF THE PLATFORM

The portal is managed through technological tools provided by Veylo HR.

The Controller uses these tools for the management of the site and connected features.

---

6. COOKIE MANAGEMENT

The user can manage or disable cookies through their browser settings.

Disabling technical cookies could limit the correct operation of the portal.

---

7. CONSENT

Where required, consent to the use of cookies is collected through appropriate information tools on the site.'
)
ON CONFLICT (document_key, language) DO NOTHING;
