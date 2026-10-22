# Catalogue of AI tells

Reference for the human skill. Adapted from Wikipedia's "Signs of AI writing" (WP:AISIGNS, CC BY-SA 4.0). Use it to recognise patterns in a draft. Removing these patterns is not enough on its own: a 2026 study of 61,608 texts found that cleaning vocabulary barely lowered detection, because structure gives a text away. Treat the word lists as hints that go out of date, and the habits behind them as the target.

Models smooth specific facts into inflated platitudes, hide the person doing something behind abstract nouns, and lock sentences into repeated formulas. The parts below list the patterns by kind.

## Meaning, Content, and Tone Tells

### 2.1 Undue Emphasis on Significance, Legacy, and Broader Trends

Models compulsively inflate mundane subjects by claiming they represent a grand historical trajectory or societal shift. When writing about modest topics, models frequently attach a **pre-hedged significance claim**—acknowledging the subject is small before puffing it up anyway.

- **Diagnostic triggers to eliminate:**
  - *stands as / serves as a testament to*
  - *plays a vital / pivotal / crucial / significant / integral / key role in*
  - *underscores / highlights its enduring importance*
  - *leaves a lasting / enduring legacy*
  - *watershed moment / key turning point / milestone in the evolution of*
  - *deeply rooted in / profound cultural heritage*
  - *steadfast dedication / unwavering commitment*
  - *solidifies its place / cements its status as*
  - *continues to captivate / inspire audiences to this day*
  - *While seemingly modest / Though not a household name, [Subject] nonetheless marks a pivotal...*
- **Editorial rule:** Delete all assertions that a subject is important, historic, or influential. State what happened and what changed measurably.
  - *AI Tell:* "While seemingly a local infrastructure update, the 1987 municipal zoning reform was a watershed moment that played a pivotal role in shaping the city's modern landscape, serving as a testament to civic foresight."
  - *Human:* "The 1987 zoning reform abolished minimum parking requirements downtown. Within five years, developers converted 14 surface lots into six-story apartment buildings."

### 2.2 Canned Emphasis on Notability and Media Coverage

LLMs argue that a person, organization, or work is notable by asserting they have media coverage or an online following rather than stating their actual work.

- **Diagnostic triggers to eliminate:**
  - *maintains an active social media presence*
  - *garnered significant / widespread media coverage from outlets such as...*
  - *has been widely recognized for contributions to...*
  - *established themselves as a prominent / leading voice in...*
  - *profiled by major publications including...*
- **Editorial rule:** Never state that a subject is famous, recognized, or covered by the press. Cite the specific work, discovery, office held, or primary event.

### 2.3 Superficial Participial Analyses (The `-ing` Tail)

The single most reliable structural tell of LLM writing is tacking a present-participle (`-ing`) phrase onto the end of a factual clause to manufacture fake analytical depth. As `WP:AISIGNS` notes, a person can highlight or emphasize an idea, but a fact, object, or event cannot—these tails inject unattributed opinions from a disembodied narrator.

- **Diagnostic triggers (especially following a comma in the second half of a sentence):**
  - *, highlighting...* / *, underscoring...* / *, emphasizing...*
  - *, reflecting...* / *, showcasing...* / *, illustrating...*
  - *, ensuring...* / *, demonstrating...* / *, symbolizing...*
  - *, contributing to...* / *, aligning with...* / *, fostering...*
  - *, paving the way for...* / *, solidifying...* / *, reinforcing...*
- **Editorial rule:** Sever the `-ing` clause immediately. If the downstream effect is factually real and necessary, write it as a finite clause with a concrete subject and active verb, or explain *how* the mechanism works.
  - *AI Tell:* "The compiler caches intermediate AST nodes on disk, reducing cold-build latency by 38% and underscoring the engineering team's focus on developer velocity."
  - *Human:* "The compiler caches intermediate AST nodes on disk, which cuts cold-build latency by 38% on repositories over 100,000 lines."

### 2.4 Promotional, Brochure, and Subtle-Positivity Bias

Even when avoiding explicit superlatives (*"the best"*), RLHF-tuned models default to upbeat public-relations copy, particularly when describing towns, architecture, companies, universities, cultural traditions, or products.

- **Diagnostic triggers to eliminate:**
  - *rich cultural heritage / rich history / rich tapestry*
  - *breathtaking / stunning natural beauty / picturesque / scenic*
  - *must-visit / must-see / hidden gem*
  - *nestled in the heart of / vibrant community / bustling / thriving*
  - *beacon of / hub of innovation / at the forefront of*
  - *seamlessly blends / harmoniously combines / dynamic intersection of*
  - *cutting-edge / state-of-the-art / next-generation / world-class / robust*
- **Editorial rule:** Strip all travel-brochure and marketing modifiers. Describe physical layout, economics, history, or technical specifications neutrally, and include friction, trade-offs, or limitations where relevant.
  - *AI Tell:* "Nestled in the heart of the valley, the town boasts a rich cultural heritage that seamlessly blends historic charm with vibrant modern living."
  - *Human:* "The town sits in the Shenandoah Valley along Route 11. Half the storefronts on Main Street date to the 1880s, and the former brick textile mill now houses a two-year community college."

### 2.5 Fuzzy Sociological Connections

When LLMs do not know the exact causal link between two concepts, they bridge them with vague academic filler.

- **Diagnostic triggers to eliminate:**
  - *is particularly / widely associated with*
  - *is closely linked to / deeply intertwined with*
  - *bridges the gap between X and Y*
  - *explores themes of identity, memory, and the human condition*
  - *situated at the nexus / crossroads / intersection of*
- **Editorial rule:** Name the exact causal or compositional link. Instead of saying a book *"explores themes of grief and resilience,"* state what happens in the plot: *"follows a retired marine machinist rebuilding his brother's fishing boat after the 2011 tsunami."*

### 2.6 Weasel Attributions and Source Over-Extrapolation

Models manufacture authority by attributing claims to unnamed collectives, or by citing a specific real source for a broad platitude the source never made.

- **Diagnostic triggers to eliminate:**
  - *Studies show / Research indicates / Data suggests*
  - *Experts say / Industry reports suggest / Analysts note*
  - *Observers have cited / Critics argue / Proponents maintain*
  - *It has been described as / Is widely regarded as*
- **Editorial rule:** Every attribution must name the exact person, study, or institution, date it where relevant, and restrict the claim strictly to what that source proved. If no specific source exists, state the verifiable fact directly or delete the sentence.

### 2.7 Outline-Like Conclusions ("Challenges and Future Prospects")

LLMs routinely close articles, sections, or essays with a formulaic wrap-up that balances "current challenges" against a "promising future," or summarizes what the reader just read.

- **Diagnostic triggers to eliminate:**
  - *In summary, / In conclusion, / To sum up, / Overall, / Ultimately,*
  - *"Despite its many advantages, [Subject] faces several key challenges, including..."*
  - *"Looking ahead, the future of [Subject] remains bright/promising as..."*
  - *"As [Subject] continues to evolve, striking a balance between X and Y will be essential."*
- **Editorial rule:** Never write a summary conclusion or a symmetrical "Challenges and Future Outlook" closer. End the text on your final substantive fact, technical detail, or concrete observation.

### 2.8 Didactic Throat-Clearing and Editorializing Asides

Models frequently announce that an upcoming sentence is important before delivering it.

- **Diagnostic triggers to eliminate:**
  - *It is important to note / remember / consider / recognize that*
  - *It is worth mentioning / noting that*
  - *Crucially, / Notably, / Significantly, / Importantly, / Interestingly,*
  - *No discussion of X would be complete without mentioning Y*
  - *Here's the thing: / Let's unpack this: / At its core,*
- **Editorial rule:** Cut the preamble. Start the sentence with the subject of the main clause.

---

## Syntax, Grammar, and Lexical Tells

### 3.1 High-Density AI Vocabulary List

Corpus analyses confirm that LLMs overuse specific words at 10x to 100x their baseline frequency in human prose. Treat the following words as hard-banned unless quoting an external source verbatim:

- **Verbs:** *delve, underscore, showcase, foster, garner, catalyze, resonate, embark, navigate (abstract), spearhead, bolster, harness, leverage, cultivate, illuminate, unravel, elevate, empower, revolutionize, streamline, intertwine.*
- **Nouns:** *tapestry, testament, realm, landscape (abstract), paradigm, synergy, myriad, plethora, nuance, beacon, cornerstone, nexus, labyrinth, symphony (abstract), pinnacle, catalyst, bedrock.*
- **Adjectives & Adverbs:** *pivotal, crucial, vital, meticulous, meticulously, intricate, multifaceted, poised, overarching, burgeoning, seamless, seamlessly, relentless, groundbreaking, transformative, indelible, paramount, bespoke, holistic.*

### 3.2 Negative Parallelisms (Contrastive Negation)

Contrastive negation is the hardest rhetorical tic for an LLM to suppress. Models rely on it to simulate profundity or punchiness.

- **All five subtypes are banned for rhetorical emphasis:**
  1. **Not just X, but Y:** *"It's not just a text editor; it's a complete writing environment."*
  2. **Not only X, but (also) Y:** *"The ruling not only reverses precedent, but also reshapes..."*
  3. **Not X, but Y:** *"The bottleneck is not compute, but memory bandwidth."*
  4. **Y rather than X:** *"The team focused on stability rather than raw speed."*
  5. **Triplet / Staccato Negation:** *"No configuration. No dependencies. Just pure C."*
  6. **Two-Sentence False Pivot:** *"She trained as a classical violinist. Her career in acoustics, however, took a very different path."*
- **Editorial rule:** State what something *is* or *does* directly in the affirmative. Use negation only when correcting an explicit misconception raised by the reader.
  - *AI Tell:* "This database isn't about storing rows; it's about modeling time-series state changes at scale."
  - *Human:* "This database stores immutable time-series events and reconstructs state at any timestamp by replaying the log."

### 3.3 Copulative Avoidance (`is` / `has` Aversion)

Models avoid plain forms of *to be* and *to have*, swapping in ornate verbs that sound stiff and promotional.

- **Diagnostic triggers -> Human replacement:**
  - *serves as / stands as / acts as / functions as* -> **is / are**
  - *represents / marks / constitutes* -> **is / are**
  - *boasts / features / sports / houses / harbors / possesses* -> **has / have**
- **Editorial rule:** Use `is`, `are`, `was`, `were`, `has`, and `have` whenever stating identity, role, or possession.

### 3.4 The Rule of Three and False Ranges

- **Triadic compulsion:** LLMs reflexively group adjectives, nouns, verbs, and examples into threes (*"fast, scalable, and secure"*, *"from farmers, artisans, and merchants"*). Break triplets into a single exact word, a two-item pair, or an exhaustively specific four-item list.
- **False ranges (`from X to Y`):** Models write *"offering features ranging from automated billing to dark mode"* or *"affecting everyone from students to retirees"* where the endpoints do not form a real continuous scale. Replace with a plain conjunction (*"offers automated billing and a dark mode"*) or use `from X to Y` strictly for literal quantitative/geographic spans (*"from 40 Hz to 18 kHz"*).

### 3.5 Elegant Variation (Synonym Cycling)

Because language models penalize immediate token repetition, they cycle through awkward synonyms or epithets to refer to the same subject across consecutive sentences (*"Postgres... the relational database... the open-source powerhouse... the system"*).

- **Editorial rule:** Repeat the exact noun or use a simple pronoun (*it, they, he, she*). Never invent journalistic epithets (*the Mountain View giant*, *the burgeoning startup*).

### 3.6 Dropped Human Actors and Nominalization Bloat

LLMs frequently put inanimate nouns or locations in the subject slot to perform human actions, and turn crisp verbs into clunky noun phrases.

- **Diagnostic triggers:**
  - *"The 1990s saw the introduction of..."* / *"The streets witnessed protests..."*
  - *"The investigation looked into..."* / *"The policy aimed to reduce..."*
  - *"facilitate the implementation of"* / *"conduct an analysis of"*
- **Editorial rule:** Name the human actors in the subject slot and turn nominalizations back into active verbs.
  - *AI Tell:* "The 2022 audit saw the implementation of stricter access controls across all production clusters."
  - *Human:* "After the 2022 audit, the security team restricted production cluster access to hardware-key sign-ins."

### 3.7 Overloaded Opening Appositives and Anaphora

- **Opening appositives:** Never start a biography or section with a stuffed noun phrase before the subject (*"A pioneering computer scientist and outspoken advocate for open standards, Radia Perlman..."*). Put the name first: *"Radia Perlman designed the Spanning Tree Protocol in 1985 while working at Digital Equipment Corporation."*
- **Anaphoric repetition:** Do not start consecutive sentences or paragraphs with identical syntactic frames (*"When teams scale...", "When systems fail...", "When budgets tighten..."*).

### 3.8 Mechanical Conjunctive Transitions

LLMs over-index on heavy sentence-initial transitions: *Moreover,*, *Furthermore,*, *Additionally,*, *In addition,*, *Consequently,*, *Nevertheless,*, *Nonetheless,*, *Conversely,*, *Specifically,*, *Essentially,*, *Indeed,*.

- **Editorial rule:** Delete 90% of sentence-initial conjunctive adverbs. Let the end of sentence A lead naturally into the beginning of sentence B. When a contrast or addition marker is needed, use *But*, *And*, *So*, *Yet*, or *Still*.

---

## Formatting, Punctuation, and Meta-Artifacts

1. **Heading Hygiene:**
   - Always use **sentence case** (`## Architecture of the storage engine`), never Title Case (`## Architecture Of The Storage Engine`).
   - Never use **colon-subtitle headings** (`## The Storage Engine: A Deep Dive into Performance`).
   - Never stack headings (`## H2` immediately followed by `### H3`) without prose in between.
2. **Prose Over `**Bold:**` Bullet Lists:**
   - Do not break standard explanations into bulleted lists where every item begins with a bolded label and a colon (`- **Latency:** The system reduces...`). Write connected paragraphs. Reserve lists for genuinely discrete items, steps, or reference specs.
3. **Boldface and Emoji Restraint:**
   - Do not bold random phrases inside paragraphs to simulate skimmability.
   - Never use emojis (`🚀`, `💡`, `✅`, `🧠`) in headings, bullets, or body text unless explicitly requested.
4. **Punctuation Discipline:**
   - **Em dashes (`—`):** Models use em dashes as an all-purpose clause splicer. Replace them with commas, parentheses, colons, or periods. Never exceed one em dash per 1,000 words, and never use two in the same paragraph.
   - **Quotation marks:** Use standard straight quotes (`"` and `'`) consistently; do not mix curly and straight typographic marks.
5. **Zero Conversational or Meta Wrapper:**
   - Never start with *"Certainly!"*, *"Here is the revised version:"*, or *"Great question!"*
   - Never end with *"I hope this helps!"* or *"Let me know if you would like any changes."*
   - Never include meta-disclaimers about knowledge cutoffs or source constraints.

---

## Diagnostic Replacement Table

| AI Pattern | Example of AI Tell | Clean Human Rewrite |
| :--- | :--- | :--- |
| **Participial `-ing` tail** | "...cut latency by 20%, highlighting the efficiency of the new cache." | "...cut latency by 20% by pinning hot keys in L2 cache." |
| **Negative parallelism** | "It's not just a linter; it's a guardrail for your entire codebase." | "The linter blocks commits that violate type-safety or import rules." |
| **Copulative avoidance** | "The building serves as the regional headquarters and boasts 40 labs." | "The building is the regional headquarters and has 40 labs." |
| **Significance puffery** | "The treaty stands as a testament to diplomacy and plays a vital role..." | "The treaty ended the 14-month border blockade and reopened the rail line." |
| **False range + Triplet** | "...users ranging from students to executives with fast, easy, and secure tools." | "...gives individual developers and enterprise teams encrypted local storage." |
| **Weasel attribution** | "Observers have cited the release as a turning point, though critics note risks." | "Ars Technica praised the release's memory safety, while Debian maintainers objected to the new license." |

---
