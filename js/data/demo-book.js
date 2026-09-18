// The demo book (spec 48).
//
// A real sample: five written chapters, a blueprint for the rest, a Book
// Bible, figures, a cover and a campaign. Five chapters rather than
// seventeen because the demo has to load instantly and be read, not
// scrolled past — and because a demo that ships a whole manuscript
// invites the reader to think the product wrote it just now.
//
// Everything here is clearly labelled as demo data wherever it appears.

export const DEMO_IDS = {
  PROJECT: "d1000000-0000-4000-8000-000000000001",
  PART_1: "d1000000-0000-4000-8000-000000000101",
  PART_2: "d1000000-0000-4000-8000-000000000102",
  PART_3: "d1000000-0000-4000-8000-000000000103",
  COVER: "d1000000-0000-4000-8000-000000000301",
};

const chapterId = (n) => `d1000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;

export const DEMO_PROJECT = {
  id: DEMO_IDS.PROJECT,
  user_id: "demo",
  idea:
    "A book about where personal power actually comes from, for people who feel " +
    "their judgement is being quietly outsourced to machines. Not anti-technology — " +
    "about what stays yours.",
  title: "The 17 Principles of Human Power",
  subtitle:
    "How to Master Your Mind, Purpose, and Potential in a World Powered by Artificial Intelligence",
  author_name: "Zirlandia Milkovic",
  genre: "Personal Development",
  audience:
    "Professionals in their thirties to fifties who are competent, busy, and increasingly " +
    "unsure which of their judgements are still their own",
  language: "en",
  purpose: "authority",
  writing_style: "mentor",
  tone: "Direct, warm, unsentimental",
  target_pages: 220,
  target_words: 57200,
  status: "writing",
  stages: {
    positioning: "approved",
    blueprint: "approved",
    bible: "generated",
    writing: "in_progress",
    visuals: "generated",
    design: "approved",
    cover: "approved",
  },
  theme_id: "editorial",
  template_id: null,
  brand_kit_id: null,
  trim_size: "6x9",
  design: {},
  metadata: { publisher: "", keywords: ["personal development", "AI", "judgement", "attention"] },
  book_id: null,
  is_demo: true,
  created_at: "2026-02-02T09:00:00.000Z",
  updated_at: "2026-03-14T16:20:00.000Z",
};

export const DEMO_POSITIONING = {
  id: "d1000000-0000-4000-8000-000000000201",
  project_id: DEMO_IDS.PROJECT,
  title_ideas: [
    "The 17 Principles of Human Power",
    "What Stays Yours",
    "The Last Human Skills",
    "Judgement",
    "The Unautomated Self",
    "Think Like It Matters",
    "Your Own Mind",
    "The Deciding Animal",
    "Still Yours",
    "The Human Advantage",
  ],
  subtitle_ideas: [
    "How to Master Your Mind, Purpose, and Potential in a World Powered by Artificial Intelligence",
    "Seventeen habits of judgement for people who work beside machines",
    "Keeping your judgement when everything else is automated",
    "What to build when the answers are free",
    "A field guide to thinking for yourself",
    "The skills that do not transfer to a model",
    "On attention, judgement and the things worth deciding",
    "Practical philosophy for an automated decade",
    "How to stay the author of your own work",
    "Seventeen principles for keeping your own mind",
  ],
  promise:
    "A way of working that keeps your judgement sharp and your attention your own, " +
    "in a decade that will offer to take both.",
  target_reader:
    "A competent professional between 30 and 55 who uses these tools daily, gets value from " +
    "them, and has started to notice they no longer form a view before asking for one.",
  reader_problem:
    "They are not afraid of being replaced. They are quietly worried that they have stopped " +
    "practising the thing they were good at, and they cannot tell how far it has gone.",
  transformation:
    "From delegating the first draft of every thought, to knowing exactly which judgements " +
    "to keep and how to keep them in practice.",
  unique_angle:
    "Most books on this subject are either about the technology or against it. This one is " +
    "about the reader's own working habits, and treats the tools as a given.",
  category: "Personal Development / Business Skills",
  comparable_titles: [
    "Books on attention and deep work",
    "Practical philosophy for professionals",
    "Skills-and-craft books written by practitioners",
  ],
  reasoning:
    "The idea named a feeling rather than a market, so the positioning takes the feeling " +
    "seriously and gives it a reader. The angle is deliberately narrow: the general AI book " +
    "shelf is crowded and the specific working-habits shelf is not.",
  model: "demo",
  approved_at: "2026-02-02T10:12:00.000Z",
  created_at: "2026-02-02T09:40:00.000Z",
};

export const DEMO_BIBLE = {
  project_id: DEMO_IDS.PROJECT,
  audience: DEMO_PROJECT.audience,
  tone: "Direct and warm. Never scolding, never breathless. Assumes the reader is capable.",
  writing_style:
    "Second person throughout. Present tense. British spelling. Contractions allowed. " +
    "Sentences vary in length deliberately; no paragraph opens with a rhetorical question.",
  promise: DEMO_POSITIONING.promise,
  transformation: DEMO_POSITIONING.transformation,
  voice_rules: [
    "Second person throughout — you, not one or we",
    "British spelling",
    "No exclamation marks in body text",
    "Never open a chapter with a question",
    "Concrete example before abstract principle, every time",
    "No em-dash pile-ups: one per paragraph at most",
    "Name the cost of a principle as well as its benefit",
  ],
  terminology: [
    { term: "Judgement", definition: "Deciding under uncertainty when the information will not improve in time." },
    { term: "Delegation", definition: "Handing over a task whose output you can still evaluate." },
    { term: "Abdication", definition: "Handing over a task whose output you can no longer evaluate. The book's central distinction." },
    { term: "Practice", definition: "Work done at the edge of your ability on purpose, whether or not it ships." },
  ],
  key_concepts: [
    "The delegation/abdication line",
    "Attention as a budget, not a virtue",
    "Evaluation is the last skill to go",
    "Cheap answers raise the price of good questions",
    "Taste is trained, not held",
  ],
  recurring_examples: [
    { name: "The Tuesday meeting", description: "An ordinary work meeting revisited in several chapters to show a principle at real scale." },
    { name: "The second draft", description: "The point at which a writer's judgement either engages or does not." },
  ],
  characters: [],
  facts: [
    { claim: "Most professional decisions are made with information that will not improve before the deadline.", status: "needs_verification" },
    { claim: "The author has run this framework with their own consulting clients since 2023.", status: "supplied_by_author", source: "Author's own practice" },
  ],
  visual_style:
    "Figures are diagrams of decisions, not decoration. Two colours, plenty of white space, " +
    "no icons that repeat what the label already says.",
  image_style: "Quiet editorial photography; people at work, no stock-photo enthusiasm.",
  brand_colors: ["#1f2a44", "#a9631a"],
  typography: {},
  chapter_summaries: [
    { id: chapterId(1), number: 1, title: "The Word You Were Taught to Fear",
      summary: "Establishes power as capacity rather than performance, and names its three sources: knowledge, reliable capability, and alternatives. Sets up the delegation/abdication distinction the book returns to." },
    { id: chapterId(2), number: 2, title: "Attention Is the Only Currency You Actually Spend",
      summary: "Treats attention as a finite budget with a real exchange rate, and shows how tools that save time can spend attention faster than they return it." },
    { id: chapterId(3), number: 3, title: "The Line Between Delegating and Abdicating",
      summary: "Gives the book's central test: can you still evaluate the output? Works through three cases where the answer changed without anyone noticing." },
    { id: chapterId(4), number: 4, title: "Cheap Answers, Expensive Questions",
      summary: "Argues that when answers become free, the scarce skill becomes asking the question that is worth answering, and shows how to practise it." },
    { id: chapterId(5), number: 5, title: "Taste Is a Muscle",
      summary: "Taste as trained discrimination rather than innate sensibility, with a practice for keeping it sharp when the first draft is always available." },
  ],
  notes:
    "The author has fifteen years of consulting practice to draw on and prefers examples from " +
    "ordinary working life over famous case studies.",
  created_at: "2026-02-02T11:00:00.000Z",
  updated_at: "2026-03-10T08:30:00.000Z",
};

export const DEMO_PARTS = [
  { id: DEMO_IDS.PART_1, project_id: DEMO_IDS.PROJECT, number: 1, title: "Seeing Clearly",
    purpose: "Before anything can be rebuilt, the ground has to be surveyed honestly.",
    sort_order: 0, created_at: "2026-02-02T11:05:00.000Z" },
  { id: DEMO_IDS.PART_2, project_id: DEMO_IDS.PROJECT, number: 2, title: "Keeping What Is Yours",
    purpose: "The principles that decide which judgements stay with you.",
    sort_order: 1, created_at: "2026-02-02T11:05:00.000Z" },
  { id: DEMO_IDS.PART_3, project_id: DEMO_IDS.PROJECT, number: 3, title: "Building Something That Holds",
    purpose: "Turning the principles into a way of working that survives a bad week.",
    sort_order: 2, created_at: "2026-02-02T11:05:00.000Z" },
];

// --- The written chapters -------------------------------------------

const CHAPTER_1 = `Most people meet the word "power" and picture someone else holding it. That is the first mistake, and it is the one this chapter exists to correct.

Power is not volume. It is not the ability to make a room go quiet, and it is not the confidence you were told to fake until it arrived. Those are performances, and performances are expensive to keep up.

## What it actually looks like

Consider the twenty minutes after a meeting ends. One person is replaying their own sentences, wondering how they landed. Another is already working on what comes next, because the decision went the way they had reasoned it should. Only one of them had power in that room, and it was not the one who spoke most.

> Power is the capacity to act on what you actually want, in the presence of people who want something else.

That definition does two useful things. It removes the audience, and it makes power measurable in a way that posture never is. You either acted on what you wanted, or you did not.

## The three sources

Every kind of power a working person can hold comes from one of three places.

- What you know that others do not, and can explain
- What you can do that others cannot, and will do reliably
- What you are willing to walk away from

[[visual: the three sources of power]]

The first two are familiar. They are the ones on your CV, and they are the ones that a competent professional spends a decade accumulating. The third is the uncomfortable one.

Most negotiating advice treats walking away as a tactic, something you hold in reserve and deploy at the right moment. It is not a tactic. It is a statement about what you have built elsewhere, and it cannot be bluffed for long. People can tell.

:::exercise Name your three
Write down one item under each of the three headings above, as it applies to you today. Not what you are working towards. Today.

Most people find the first two easy and stall on the third. That stall is the most useful information in this chapter.
:::

## Why this matters now

Here is where the argument turns, and where the rest of the book comes from.

If power comes from those three sources, then the arrival of tools that are very good at the first one — knowing things, explaining things — changes the arithmetic. Not catastrophically, and not in the direction most commentary assumes. But it changes it.

What used to be scarce was the knowledge. What is becoming scarce is the judgement about which knowledge matters, and the reliability of actually doing the thing. That is not a loss. For a certain kind of professional it is the best news in twenty years. But only if you notice it happening.

---

You will have noticed that none of the three sources has anything to do with how you come across. That is deliberate, and it is the last thing to say before we go on.

There is a version of this subject that is about presence: how to enter a room, how to hold eye contact, what to do with your hands. That version sells well and changes nothing, because it treats the symptom. People who have built the three sources tend to have presence. People who have only worked on presence tend to be exhausting.

:::takeaways
- Power is capacity, not performance: did you act on what you wanted?
- It comes from knowledge, reliable capability, and alternatives
- Only the third requires building something outside the room you are standing in
- The arrival of very capable tools raises the price of judgement and reliability, and lowers the price of knowing
:::`;

const CHAPTER_2 = `You have a budget you have never seen a statement for. It is spent every day, usually before ten in the morning, and almost nobody tracks where it went.

Attention is not a virtue and it is not a character trait. It is a quantity. You get a certain amount each day, the amount varies with sleep and stress and how much of the previous day you spent deciding things, and when it is gone it is gone regardless of how much time is left on the clock.

## The exchange rate nobody quotes

Every tool that saves you time charges you something. Usually attention, and usually at a bad rate.

Take the ordinary case. A tool drafts something for you in nine seconds that would have taken you forty minutes. That is a spectacular saving on the time axis. But you now have to read it as an editor rather than write it as an author, and editing something you did not write is a different and more expensive kind of attention than writing it would have been. Not always more expensive. Often.

The saving is real. The cost is real. What is missing is the habit of pricing both.

## Where it actually goes

Track it for three days and the pattern is usually the same:

1. A small number of genuinely hard decisions, which deserve the attention and get it
2. A much larger number of small decisions that deserve almost none and take a surprising amount
3. A residue of switching costs, which nobody budgets for and which frequently exceeds the first two combined

[[visual: where a working day's attention goes]]

The third line is the one worth looking at. Switching between two kinds of work is not free, and switching between your own judgement and someone else's draft is a switch like any other.

:::callout A note on the word "focus"
This chapter avoids the word deliberately. Focus has become a moral category — something you either have or are failing at. Budget is a better frame because a budget can be spent well on the wrong thing, and that is the actual failure mode for most competent people.
:::

## The Tuesday meeting

Here is the example this book keeps coming back to.

An ordinary recurring meeting, eight people, one hour, nothing dramatic. Everyone arrives having read the document. The discussion covers four topics. Three of them are decisions that the room is genuinely the right place for. One is a status update that could have been two sentences in writing.

The hour is not the cost. The cost is that the status update comes third, when everyone's attention is thinnest, and the fourth topic — the one that actually needed eight people thinking — gets the remainder.

Nobody in that room would describe it as a badly run meeting. It is a well-run meeting with an attention budget spent in the wrong order.

:::exercise The reordering
Take the next recurring meeting you are responsible for or attend. Write its agenda in the order the items would go if the only consideration were how much collective judgement each one needs.

If that order differs from the real one, you have found something you can fix this week.
:::

## What to do about it

Three habits, in the order they are worth adopting.

Decide what the day's one hard thing is before you open anything that talks to you. Not a list. One thing.

Spend the first hour on it, at whatever quality you can manage, before the exchange rate turns against you.

And when you reach for a tool, ask which axis you are saving on. If the answer is time, and you are not short of time, you may be about to make a bad trade at an excellent price.

:::takeaways
- Attention is a quantity, not a virtue
- Every time-saving tool charges attention; the rate is rarely quoted
- Switching costs are the largest unbudgeted line in most working days
- Order the day by how much judgement each thing needs, not by when it arrived
:::`;

const CHAPTER_3 = `There is a line, and almost everyone has crossed it at least once without noticing. This chapter is about where it runs and how to tell which side you are on.

Delegating is handing over a task whose output you can still evaluate. Abdicating is handing over a task whose output you can no longer evaluate. Those two sentences are the centre of this book.

## The test

One question, asked honestly: if this came back wrong, would I know?

Not "would I eventually find out". Not "would someone catch it downstream". Would you, looking at the output, be able to tell that it was wrong.

If yes, you delegated. The work left your hands and your judgement stayed. If no, you abdicated, and something has left that you may want back.

[[visual: the delegation test]]

## Three cases

The line moves, and it usually moves quietly. Three cases where it did.

**The spreadsheet.** A finance lead who had built every model herself for eleven years started accepting generated formulas. For eighteen months this was pure delegation: she could read a formula and see immediately whether it was right. Then the models got more complex, and the formulas got longer, and one day she approved something she had skimmed. Nothing broke. It has not broken yet. But the test has failed since that day, and she knows it.

**The summary.** A partner reads twelve-page memos as one-page summaries. He can evaluate a summary — he has read ten thousand memos. What he cannot evaluate is what the summary left out, and that is a different question that the test catches and habit does not.

**The second opinion.** A designer asks for critique before forming her own view. The critique is usually good. The problem is that her own view no longer gets formed, and so there is nothing for the critique to be a second opinion about.

:::case What the three have in common
None of these people were careless. All three are more competent than average at exactly the thing they handed over. The line moved because they were good enough to get away with it for a long time, which is the only way the line ever moves.

[author: if you have a client example here, it belongs in this slot — the reader needs one story with a name attached, not three anonymous sketches]
:::

## Keeping the ability to evaluate

Evaluation decays without use. It decays slowly, which is what makes it dangerous, and it decays in a way that feels like efficiency at the time.

The maintenance is unglamorous and it works:

- Do the thing yourself periodically, even when you do not have to. Once a month is usually enough.
- Before you look at generated output, write down in one line what a good answer would contain. Then compare.
- Keep one piece of work each quarter that you do end to end with no assistance, chosen because it is difficult rather than because it is important.

:::exercise The honest inventory
List the five things you hand over most often. Beside each, answer the test: if this came back wrong, would I know?

Be strict. "I would probably notice" is a no.
:::

## The part nobody says

Abdication is not always wrong.

There are tasks you have decided not to be good at, and handing those over completely is a reasonable use of a finite life. Nobody expects you to evaluate your own dental work. The failure is not abdicating; the failure is abdicating by drift, in the thing you are supposed to be good at, without ever making the decision.

So make the decision. Write down what you are choosing not to be able to evaluate any more. It is a short list for most people, and it should be.

:::takeaways
- Delegating keeps your judgement; abdicating gives it away
- The test: if this came back wrong, would I know?
- The line moves quietly, and competence is what lets it move
- Abdicate on purpose, in writing, or you will do it by drift
:::`;

const CHAPTER_4 = `When answers get cheap, questions get expensive. That is the whole economic content of this chapter, and everything else in it is about what to do with the information.

## The shift

For most of professional history, the constraint was supply. Finding out what was known took time, and the people who had found out were valuable for having done so. A great deal of professional status still rests on that arrangement, which is why the change feels personal.

The constraint has moved. The answer to a well-specified question is now close to free and getting closer. What has not moved, and shows no sign of moving, is the difficulty of specifying the question that was worth asking.

## What a good question does

A good question is not a clear one. Clarity is table stakes. A good question does three things:

1. It is answerable in a way that would change what you do next
2. It is about the thing that is actually uncertain, not the thing that is comfortable to research
3. It is small enough that a wrong answer is survivable

[[visual: what separates a good question from a clear one]]

The second is where most professionals lose. There is always a comfortable adjacent question — better documented, more tractable, closer to what you already know. Answering it feels like progress and produces a document.

:::callout The comfortable adjacent question
You can recognise it by how good it feels to start. The real question usually feels slightly humiliating to ask, because asking it admits what you do not know.
:::

## Practising

Question-asking is trainable, and almost nobody trains it, which makes it one of the better returns available to a working professional this decade.

The practice is simple and slightly tedious, which is why it works.

Before any piece of substantial work, write the question you are actually trying to answer. One sentence. Then write the decision that the answer will change. If you cannot write the second sentence, the question is not worth the work, and you have saved yourself a week.

Do this for a month and you will notice something uncomfortable: a meaningful fraction of the work you were about to do would not have changed a decision.

:::exercise The two sentences
Take the largest thing on your desk this week.

Sentence one: the question it is trying to answer.
Sentence two: what you will do differently depending on the answer.

If sentence two is hard to write, that is the finding.
:::

## Where this leaves expertise

None of this makes expertise less valuable. It relocates it.

The expert's advantage used to be substantially informational. It is now almost entirely about knowing which questions matter in this domain, which answers are load-bearing, and which confident-sounding output is subtly wrong in a way that only shows up in eighteen months.

That is a better job than the old one, and a harder one to do without practising.

:::takeaways
- Cheap answers raise the price of good questions
- A good question changes a decision, addresses the real uncertainty, and is survivable if wrong
- The comfortable adjacent question is the main failure mode
- Write the question and the decision it changes, before doing the work
:::`;

const CHAPTER_5 = `Taste is usually described as something people have. It is more useful to treat it as something people maintain, because the maintenance is the only part you can act on.

## What taste actually is

Taste is trained discrimination: the ability to tell the difference between two things that look similar to someone who has not spent the time.

A good editor can tell, in one paragraph, whether a piece was written by someone who was thinking or someone who was producing. They cannot always say how. That is not mysticism — it is ten thousand paragraphs of pattern, compressed into a reaction that arrives faster than the reasoning behind it.

The reaction is real. The compression is why it feels innate.

## Why the first draft matters more than it did

Here is the specific problem this decade presents.

Taste is built by making things badly and noticing. Not by consuming good work — that helps, but it is not sufficient, and anyone who has read widely and written little knows the gap. It is built in the moment where you produce something, look at it, feel that it is wrong, and work out why.

When a competent first draft is always available, that moment becomes optional. You can skip from intention straight to something serviceable, and never pass through the part where the discrimination gets built.

[[visual: where taste is built in a normal draft cycle]]

The output is often better in the short run. The trajectory is worse.

:::case A working example
A colleague runs a small studio. In 2024 the work got faster and, by any client measure, better. In 2026 he noticed that his two junior designers, both two years in, had roughly the judgement they had arrived with. They had shipped a great deal and learned very little, because nothing they shipped had been wrong in a way they had to fix.

He now has a rule: every project includes one piece done end to end, unaided, by whoever is least able to do it. It costs him a day a week. He describes it as the cheapest training he has ever run.

[author: confirm he is happy to be named, or keep this anonymous]
:::

## Keeping it

Three practices, in descending order of how much they cost and ascending order of how easy they are to skip.

**Make something badly on purpose.** Regularly, in your own domain, without assistance, and look at it honestly. The point is not the artefact.

**Say why, out loud.** When something is good, articulate what makes it good before you read anyone else's account. The articulation is what converts a reaction into a usable rule.

**Keep a file of near-misses.** Work that almost worked is more instructive than work that did, and much more instructive than work that failed obviously.

:::exercise This week's bad thing
Pick something small in your own discipline. Make it without help. Spend twenty minutes afterwards writing down what is wrong with it and why.

Do not fix it. The fixing is not the exercise.
:::

## The honest caveat

Taste is domain-specific and it does not transfer. A superb editor is not thereby a good judge of typography, and a person with excellent judgement about software can have no discrimination at all about prose.

This matters because the most common way to lose taste quietly is to keep exercising it somewhere it is already strong while it decays somewhere it is needed.

:::takeaways
- Taste is trained discrimination, not an innate sensibility
- It is built by making things badly and working out why
- A competent first draft makes that step optional, which is the risk
- It is domain-specific and decays where it is not exercised
:::`;

const PLANNED = [
  ["The Room You Are Already In", "Situational power: reading what is actually being decided.", 3000],
  ["Reliability Is a Superpower Nobody Brags About", "Why doing what you said is scarcer than it sounds.", 2800],
  ["What You Are Willing to Lose", "Building the alternatives that make refusal possible.", 3100],
  ["The Second Draft Problem", "Where judgement engages, and how to make sure it does.", 2900],
  ["Borrowed Certainty", "Recognising confidence that is not yours and not earned.", 2700],
  ["The Cost of Being Right Too Early", "Timing, patience and the politics of judgement.", 2800],
  ["Teaching as Thinking", "Why explaining is the fastest way to find out what you know.", 2600],
  ["Systems That Survive a Bad Week", "Designing a practice for your worst day, not your best.", 3000],
  ["The People Who Tell You the Truth", "Assembling a circle that will actually disagree.", 2700],
  ["What to Automate and What to Keep", "A working inventory, revisited annually.", 2900],
  ["The Long Game", "Compounding judgement over a decade.", 2800],
  ["Seventeen", "The principles, gathered.", 2200],
];

export const DEMO_CHAPTERS = [
  {
    id: "d1000000-0000-4000-8000-000000000210",
    project_id: DEMO_IDS.PROJECT,
    part_id: null,
    kind: "front",
    front_type: "title_page",
    number: null,
    title: "Title page",
    content: "",
    word_count: 0,
    status: "final",
    include: true,
    sort_order: -100,
    target_words: 0,
    key_concepts: [],
    visual_opportunities: [],
    exercises: [],
    case_studies: [],
    created_at: "2026-02-02T11:10:00.000Z",
    updated_at: "2026-02-02T11:10:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000211",
    project_id: DEMO_IDS.PROJECT,
    part_id: null,
    kind: "front",
    front_type: "copyright",
    number: null,
    title: "Copyright",
    content:
      "Copyright © 2026 Zirlandia Milkovic\n\n" +
      "All rights reserved. No part of this publication may be reproduced, distributed or " +
      "transmitted in any form or by any means without the prior written permission of the publisher.\n\n" +
      "ISBN: [author: ISBN to be assigned]\n\n" +
      "This book describes the author's own working practice. It is not professional advice, " +
      "and nothing in it is a substitute for guidance from a qualified professional about your " +
      "own circumstances.\n\nFirst edition.",
    word_count: 78,
    status: "draft",
    include: true,
    sort_order: -99,
    target_words: 0,
    key_concepts: [],
    visual_opportunities: [],
    exercises: [],
    case_studies: [],
    created_at: "2026-02-02T11:10:00.000Z",
    updated_at: "2026-02-02T11:10:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000212",
    project_id: DEMO_IDS.PROJECT,
    part_id: null,
    kind: "introduction",
    front_type: null,
    number: null,
    title: "Introduction",
    purpose: "Establish the question the book answers and why it is urgent now.",
    promise: "The reader knows exactly what they are about to be asked to do, and why.",
    content:
      "This is not a book about artificial intelligence. It is a book about you, written " +
      "in a decade when a great deal of what you used to do yourself is now offered to you, " +
      "finished, before you have formed a view.\n\n" +
      "The offer is usually good. That is the difficulty. If it were bad, nobody would need " +
      "a book.\n\n" +
      "## What you will be asked to do\n\n" +
      "Seventeen principles, arranged in three parts. The first part is about seeing the " +
      "situation clearly, which is harder than it sounds and mostly involves admitting things. " +
      "The second is about which judgements are worth keeping and how to keep them. The third " +
      "is about building a practice that survives a bad week, because any practice that only " +
      "works on a good week is a hobby.\n\n" +
      "Each chapter ends with something to do. Do them or do not, but know that the reading " +
      "alone will not move anything.",
    word_count: 172,
    status: "draft",
    include: true,
    sort_order: 1,
    target_words: 1400,
    estimated_pages: 5,
    key_concepts: [],
    visual_opportunities: [],
    exercises: [],
    case_studies: [],
    created_at: "2026-02-02T11:10:00.000Z",
    updated_at: "2026-02-08T09:00:00.000Z",
  },

  chapter(1, DEMO_IDS.PART_1, "The Word You Were Taught to Fear",
    "Replace the reader's inherited idea of power with a usable one.",
    "The reader can name the three sources of their own power.",
    ["Power as capacity", "The three sources", "Alternatives as leverage"],
    CHAPTER_1, 2, "reviewed", {
      clarity: 91, structure: 88, readability: 93, consistency: 95, practical_value: 89, originality_review: 84,
    }),

  chapter(2, DEMO_IDS.PART_1, "Attention Is the Only Currency You Actually Spend",
    "Reframe attention as a budget with a measurable exchange rate.",
    "The reader can order a day by judgement required rather than by arrival time.",
    ["Attention as quantity", "The exchange rate", "Switching costs"],
    CHAPTER_2, 3, "draft", null),

  chapter(3, DEMO_IDS.PART_2, "The Line Between Delegating and Abdicating",
    "Give the reader the book's central test and make it usable today.",
    "The reader can apply the evaluation test to their own five most-delegated tasks.",
    ["Delegation", "Abdication", "The evaluation test", "Decay of evaluation"],
    CHAPTER_3, 4, "draft", null),

  chapter(4, DEMO_IDS.PART_2, "Cheap Answers, Expensive Questions",
    "Show where professional value has moved and how to practise the new skill.",
    "The reader can write the question and the decision it changes before starting work.",
    ["Question quality", "The comfortable adjacent question", "Relocated expertise"],
    CHAPTER_4, 5, "draft", null),

  chapter(5, DEMO_IDS.PART_2, "Taste Is a Muscle",
    "Explain taste as maintained discrimination and give the maintenance.",
    "The reader has a weekly practice that keeps their judgement sharp.",
    ["Trained discrimination", "The draft cycle", "Domain specificity"],
    CHAPTER_5, 6, "draft", null),

  ...PLANNED.map((entry, index) =>
    chapter(index + 6,
      index < 3 ? DEMO_IDS.PART_2 : DEMO_IDS.PART_3,
      entry[0], entry[1], "", [], "", index + 7, "planned", null, entry[2])),

  {
    id: "d1000000-0000-4000-8000-000000000290",
    project_id: DEMO_IDS.PROJECT,
    part_id: null,
    kind: "back",
    front_type: "about_author",
    number: null,
    title: "About the author",
    content:
      "[author: your bio goes here — the Book Builder will not invent credentials, clients " +
      "or figures for you]\n\n" +
      "Zirlandia Milkovic writes and consults on judgement and working practice.",
    word_count: 28,
    status: "draft",
    include: true,
    sort_order: 200,
    target_words: 300,
    key_concepts: [],
    visual_opportunities: [],
    exercises: [],
    case_studies: [],
    created_at: "2026-02-02T11:10:00.000Z",
    updated_at: "2026-02-02T11:10:00.000Z",
  },
];

function chapter(number, partId, title, purpose, promise, concepts, content, order, status, quality, targetWords) {
  const words = content
    ? content.replace(/^:::.*$/gm, " ").replace(/\[\[.*?\]\]/g, " ").trim().split(/\s+/).length
    : 0;
  return {
    id: chapterId(number),
    project_id: DEMO_IDS.PROJECT,
    part_id: partId,
    kind: "chapter",
    front_type: null,
    number,
    title,
    subtitle: null,
    purpose,
    promise,
    key_concepts: concepts,
    target_words: targetWords || 2800,
    estimated_pages: Math.round((targetWords || 2800) / 260),
    visual_opportunities: [],
    exercises: [],
    case_studies: [],
    content,
    word_count: words,
    status,
    quality: quality
      ? {
          scores: quality,
          verdict:
            "Ready, with one reservation: the three sources arrive slightly too quickly for a " +
            "reader who has not met the distinction before. Give the third source its own beat.",
          recommendations: [
            {
              where: "“The third is the uncomfortable one”",
              issue: "The most important of the three sources gets the least space.",
              action: "Add two hundred words between this line and the exercise, with one concrete case of someone who had alternatives and one who did not.",
              severity: "important",
            },
            {
              where: "The opening sentence",
              issue: "“Most people” is doing unearned work in the first line of the book.",
              action: "Replace with the specific reader this book is for, or cut the qualifier.",
              severity: "polish",
            },
          ],
          consistency_notes: [],
          claims_to_check: [],
          repetition: [],
          reviewed_at: "2026-03-12T14:10:00.000Z",
          model: "demo",
        }
      : null,
    include: true,
    sort_order: order,
    created_at: "2026-02-02T11:10:00.000Z",
    updated_at: "2026-03-12T14:10:00.000Z",
  };
}

export const DEMO_VISUALS = [
  {
    id: "d1000000-0000-4000-8000-000000000401",
    project_id: DEMO_IDS.PROJECT,
    chapter_id: chapterId(1),
    kind: "process",
    title: "The three sources of power",
    purpose: "Holds the chapter's central list where the reader can come back to it.",
    placement: "After the bulleted list of the three sources.",
    caption: "Figure 1.1  Where power actually comes from.",
    alt_text: "Three stacked panels: knowledge, capability, alternatives, each with a one-line description.",
    data: {
      steps: [
        { label: "Knowledge", detail: "What you understand that others do not, and can explain plainly." },
        { label: "Capability", detail: "What you can do reliably, not once but on a Tuesday in February." },
        { label: "Alternatives", detail: "What you have built elsewhere that makes leaving thinkable." },
      ],
    },
    status: "approved",
    sort_order: 0,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000402",
    project_id: DEMO_IDS.PROJECT,
    chapter_id: chapterId(2),
    kind: "comparison",
    title: "Where a working day's attention goes",
    purpose: "Shows the third line — switching costs — against the two everyone already budgets for.",
    placement: "After the numbered list.",
    caption: "Figure 2.1  The line nobody budgets for.",
    alt_text: "A table comparing hard decisions, small decisions and switching costs by share of attention.",
    data: {
      columns: ["Where it goes", "Share of the day", "Budgeted for?"],
      rows: [
        { cells: ["A few genuinely hard decisions", "15%", "Yes"] },
        { cells: ["Many small decisions", "35%", "Rarely"] },
        { cells: ["Switching between them", "50%", "Almost never"] },
      ],
    },
    status: "approved",
    sort_order: 1,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000403",
    project_id: DEMO_IDS.PROJECT,
    chapter_id: chapterId(3),
    kind: "checklist",
    title: "The delegation test",
    purpose: "The one question, in a form the reader can photograph and keep.",
    placement: "Immediately after the test is stated.",
    caption: "Figure 3.1  Run this before handing anything over.",
    alt_text: "A checklist of four questions that distinguish delegation from abdication.",
    data: {
      items: [
        "If this came back wrong, would I know — looking at it, not eventually?",
        "Could I still do this myself to a decent standard?",
        "Have I done it myself in the last three months?",
        "If the answer to any of these is no, have I decided that on purpose?",
      ],
    },
    status: "approved",
    sort_order: 2,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000404",
    project_id: DEMO_IDS.PROJECT,
    chapter_id: chapterId(4),
    kind: "comparison",
    title: "What separates a good question from a clear one",
    purpose: "Makes the distinction concrete enough to apply to the reader's own work.",
    placement: "After the three-item list.",
    caption: "Figure 4.1  Clarity is table stakes.",
    alt_text: "A two-column comparison of clear questions and good questions.",
    data: {
      columns: ["A clear question", "A good question"],
      rows: [
        { cells: ["Can be understood", "Changes what you do next"] },
        { cells: ["Is well specified", "Is about the actual uncertainty"] },
        { cells: ["Feels productive to start", "Often feels slightly humiliating to ask"] },
        { cells: ["Produces a document", "Produces a decision"] },
      ],
    },
    status: "approved",
    sort_order: 3,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000405",
    project_id: DEMO_IDS.PROJECT,
    chapter_id: chapterId(5),
    kind: "timeline",
    title: "Where taste is built in a normal draft cycle",
    purpose: "Locates the exact step that a ready-made first draft removes.",
    placement: "After the paragraph about skipping from intention to serviceable.",
    caption: "Figure 5.1  The step that becomes optional.",
    alt_text: "A five-step timeline of a draft cycle, with the third step marked as the one that builds taste.",
    data: {
      steps: [
        { when: "Step 1", label: "Intention", detail: "You know roughly what you want." },
        { when: "Step 2", label: "A bad version", detail: "You make it, and it is not right." },
        { when: "Step 3", label: "Noticing", detail: "You see why. This is the step that builds taste." },
        { when: "Step 4", label: "The fix", detail: "You change it, and now you know a rule." },
        { when: "Step 5", label: "Something good", detail: "The artefact, which was never the point." },
      ],
    },
    status: "approved",
    sort_order: 4,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000406",
    project_id: DEMO_IDS.PROJECT,
    chapter_id: chapterId(1),
    kind: "illustration",
    title: "Chapter opener: the empty chair",
    purpose: "A quiet opening image for Part I.",
    placement: "Facing the chapter opener.",
    brief:
      "A meeting room twenty minutes after everyone has left. Late afternoon light, one chair " +
      "pushed back, a whiteboard still covered. Nobody in frame. Muted palette, generous negative " +
      "space at the lower third for a caption.",
    prompt:
      "Editorial photograph of an empty meeting room in late afternoon light, one chair pushed " +
      "back from the table, faint writing on a whiteboard, muted desaturated palette, generous " +
      "negative space in the lower third, shallow depth of field, no people, no text, no logos.",
    alt_text: "An empty meeting room in late afternoon light.",
    caption: "",
    data: {},
    status: "suggested",
    sort_order: 5,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
  },
];

export const DEMO_COVERS = [
  {
    id: DEMO_IDS.COVER,
    project_id: DEMO_IDS.PROJECT,
    concept_name: "The Rule",
    rationale:
      "Typographic and quiet, which is what the argument is. The single rule between title and " +
      "subtitle does the work an image would otherwise do, and it survives being ninety pixels wide.",
    genre_signals: ["Serious non-fiction", "Practitioner voice", "Not a technology book"],
    palette: [
      { hex: "#12203a", role: "background" },
      { hex: "#f4f1ea", role: "title" },
      { hex: "#c4b393", role: "subtitle" },
      { hex: "#f4f1ea", role: "author" },
      { hex: "#a9631a", role: "accent" },
    ],
    layout: {
      title_case: "upper",
      title_align: "left",
      title_position: "upper",
      type_style: "serif",
      composition: "Title in the upper third, rule beneath it, subtitle below, author at the foot.",
      rule: true,
      approach: "typographic",
    },
    title_text: "The 17 Principles of Human Power",
    subtitle_text: "How to Master Your Mind, Purpose, and Potential in a World Powered by Artificial Intelligence",
    author_text: "Zirlandia Milkovic",
    spine_text: "The 17 Principles of Human Power · Milkovic",
    back_blurb:
      "You are not about to be replaced. You are about to be offered, every day, a finished " +
      "version of the thing you used to think through — and the offer will usually be good.\n\n" +
      "This book is about what stays yours. Seventeen principles for keeping your judgement " +
      "sharp and your attention your own, drawn from fifteen years of watching capable people " +
      "hand over more than they meant to.",
    image_id: null,
    image_url: null,
    check_report: {
      scores: {
        thumbnail_readability: "strong",
        title_hierarchy: "strong",
        typography: "good",
        contrast: "strong",
        genre_signalling: "good",
        visual_balance: "good",
      },
      summary:
        "A well-made typographic cover. The title survives at thumbnail size and the hierarchy " +
        "is decided rather than accidental. The subtitle is long enough that it will be illegible " +
        "below about 120 pixels, which is acceptable for a subtitle.",
      improvements: [
        { issue: "The subtitle runs to four lines at trim size.", change: "Cut it to under 90 characters, or set the first clause larger than the rest." },
        { issue: "The author name sits very close to the foot margin.", change: "Raise it by about 4mm so it does not look trimmed." },
      ],
      checked_at: "2026-03-13T11:00:00.000Z",
      model: "demo",
    },
    is_selected: true,
    created_at: "2026-03-13T10:40:00.000Z",
    updated_at: "2026-03-13T11:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000302",
    project_id: DEMO_IDS.PROJECT,
    concept_name: "Seventeen",
    rationale:
      "Leads with the number, which is the most memorable thing about the book and the easiest " +
      "thing to say out loud. Bold and centred; reads as a practical book rather than a reflective one.",
    genre_signals: ["Practical", "List-driven", "Business shelf"],
    palette: [
      { hex: "#f4f1ea", role: "background" },
      { hex: "#12203a", role: "title" },
      { hex: "#5c6672", role: "subtitle" },
      { hex: "#12203a", role: "author" },
      { hex: "#a9631a", role: "accent" },
    ],
    layout: {
      title_case: "title",
      title_align: "center",
      title_position: "middle",
      type_style: "sans",
      composition: "Large numeral behind the title, set in the accent at low opacity.",
      rule: false,
      approach: "geometric",
    },
    title_text: "The 17 Principles of Human Power",
    subtitle_text: "Keeping your judgement when everything else is automated",
    author_text: "Zirlandia Milkovic",
    spine_text: "17 Principles · Milkovic",
    back_blurb:
      "Seventeen principles, three parts, one question: which of your judgements are still " +
      "yours?\n\nA practical book for people who use these tools every day, get real value from " +
      "them, and have started to wonder what they have stopped practising.",
    image_id: null,
    image_url: null,
    check_report: null,
    is_selected: false,
    created_at: "2026-03-13T10:40:00.000Z",
    updated_at: "2026-03-13T10:40:00.000Z",
  },
];

export const DEMO_SOURCES = [
  {
    id: "d1000000-0000-4000-8000-000000000501",
    project_id: DEMO_IDS.PROJECT,
    chapter_id: chapterId(2),
    title: "Peer-reviewed research on task switching and cognitive cost",
    author_org: "Cognitive psychology journals",
    claim: "Switching between tasks carries a measurable cost that people systematically underestimate.",
    summary: "Search terms: task switching cost, attention residue, cognitive load switching",
    kind: "fact",
    verification: "unverified",
    notes:
      "No specific document named. The claim is well supported in the literature, but find one " +
      "before the chapter goes to print.",
    url: null,
    created_at: "2026-03-05T09:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000502",
    project_id: DEMO_IDS.PROJECT,
    chapter_id: chapterId(3),
    title: "The author's own consulting practice, 2023 onwards",
    author_org: "Zirlandia Milkovic",
    claim: "The delegation test has been used with clients since 2023.",
    summary: "Supplied by the author.",
    kind: "example",
    verification: "verified",
    notes: "The author's own material. No external source needed.",
    url: null,
    created_at: "2026-03-05T09:00:00.000Z",
  },
];

export const DEMO_QUALITY = {
  id: "d1000000-0000-4000-8000-000000000601",
  project_id: DEMO_IDS.PROJECT,
  scope: "book",
  chapter_id: null,
  readiness: 61,
  scores: { content: 58, editorial: 74, design: 82, technical: 66 },
  issues: [
    {
      area: "content",
      severity: "blocking",
      where: "Chapters 6 to 17",
      issue: "Twelve chapters are planned but unwritten, which is most of the book.",
      fix: "Write them, or cut the architecture down to the book you are actually making.",
      auto_fixable: false,
    },
    {
      area: "content",
      severity: "important",
      where: "Chapter 3, the case study panel",
      issue: "An [author: ...] placeholder is still in the text, asking for a named client example.",
      fix: "Supply the example or rewrite the panel so it does not need one.",
      auto_fixable: false,
    },
    {
      area: "content",
      severity: "important",
      where: "About the author",
      issue: "The bio is a placeholder.",
      fix: "Write it. The Book Builder will not invent credentials.",
      auto_fixable: false,
    },
    {
      area: "editorial",
      severity: "important",
      where: "Chapter 1, “The third is the uncomfortable one”",
      issue: "The most important of the three sources gets the least space.",
      fix: "Give it two hundred words and one concrete case.",
      auto_fixable: false,
    },
    {
      area: "technical",
      severity: "important",
      where: "Front matter",
      issue: "No ISBN has been supplied, and the copyright page carries a placeholder.",
      fix: "Obtain an ISBN and enter it under Publish → Metadata, or remove the line for a digital-only edition.",
      auto_fixable: false,
    },
    {
      area: "design",
      severity: "polish",
      where: "Chapter 1 opener",
      issue: "One figure is an illustration with no image, so it is left out of the exported book.",
      fix: "Render it elsewhere and attach it, or change the figure to a drawn kind.",
      auto_fixable: false,
    },
  ],
  summary:
    "Five chapters are in good shape; the other twelve do not exist yet, which is what the " +
    "readiness figure is mostly measuring. The written material is consistent with the Book " +
    "Bible and the design is settled. This figure is an editorial and structural judgement only " +
    "— it says nothing about rights, permissions or how the book will be received.",
  model: "demo",
  created_at: "2026-03-14T16:00:00.000Z",
};

export const DEMO_MARKETING = [
  {
    id: "d1000000-0000-4000-8000-000000000701",
    project_id: DEMO_IDS.PROJECT,
    user_id: "demo",
    channel: "linkedin",
    kind: "post",
    title: "The delegation test",
    content:
      "There is one question that tells you whether you delegated something or gave it away.\n\n" +
      "If this came back wrong, would I know?\n\n" +
      "Not “would I eventually find out”. Not “would someone catch it downstream”. " +
      "Would you, looking at the output, be able to tell.\n\n" +
      "If yes, you delegated. The work left your hands and your judgement stayed.\n\n" +
      "If no — and be strict, “I would probably notice” is a no — something has " +
      "left that you may want back.\n\n" +
      "The uncomfortable part: the line moves quietly, and being good at the thing is what lets it move.",
    body: {
      hook: "There is one question that tells you whether you delegated something or gave it away.",
      from_chapter: "Chapter 3: The Line Between Delegating and Abdicating",
      visual_idea: "The delegation-test checklist from the book, as a single card.",
      hashtags: ["#judgement", "#work"],
    },
    status: "draft",
    sort_order: 0,
    created_at: "2026-03-14T15:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000702",
    project_id: DEMO_IDS.PROJECT,
    user_id: "demo",
    channel: "instagram",
    kind: "post",
    title: "Attention is a budget",
    content:
      "You have a budget you have never seen a statement for.\n\n" +
      "It is spent every day, usually before ten in the morning, and almost nobody tracks " +
      "where it went.\n\n" +
      "Attention is not a virtue. It is a quantity. And every tool that saves you time charges " +
      "you some of it — usually at a rate nobody quotes.\n\n" +
      "From Chapter 2 of The 17 Principles of Human Power.",
    body: {
      hook: "You have a budget you have never seen a statement for.",
      from_chapter: "Chapter 2: Attention Is the Only Currency You Actually Spend",
      visual_idea: "Quote card, cream on deep navy, the first line only.",
      hashtags: ["#attention", "#deepwork", "#judgement"],
    },
    status: "draft",
    sort_order: 1,
    created_at: "2026-03-14T15:00:00.000Z",
  },
  {
    id: "d1000000-0000-4000-8000-000000000703",
    project_id: DEMO_IDS.PROJECT,
    user_id: "demo",
    channel: "sales",
    kind: "book_description",
    title: "Retail description",
    content:
      "You are not about to be replaced. You are about to be offered, every day, a finished " +
      "version of the thing you used to think through — and the offer will usually be good.\n\n" +
      "That is the difficulty. If it were bad, nobody would need a book.\n\n" +
      "The 17 Principles of Human Power is about what stays yours: which judgements are worth " +
      "keeping, how to tell when one has quietly left, and what a working practice looks like " +
      "that survives a bad week rather than only a good one.\n\n" +
      "Written for people who use these tools daily, get real value from them, and have started " +
      "to wonder what they have stopped practising.",
    body: {
      hook: "You are not about to be replaced.",
      from_chapter: "Introduction",
      visual_idea: "",
      hashtags: [],
    },
    status: "approved",
    sort_order: 2,
    created_at: "2026-03-14T15:00:00.000Z",
  },
];

export const DEMO_EXPORTS = [
  {
    id: "d1000000-0000-4000-8000-000000000801",
    project_id: DEMO_IDS.PROJECT,
    user_id: "demo",
    format: "pdf_digital",
    status: "ready",
    file_name: "The-17-Principles-of-Human-Power.pdf",
    byte_size: 214_338,
    page_count: 38,
    watermark: true,
    metadata: {},
    created_at: "2026-03-14T16:10:00.000Z",
  },
];

export const DEMO_VERSIONS = [
  {
    id: "d1000000-0000-4000-8000-000000000901",
    project_id: DEMO_IDS.PROJECT,
    version: 1,
    label: "Before the editorial pass",
    note: "Saved before working through the Editorial Director's notes on chapter 1.",
    created_at: "2026-03-12T14:00:00.000Z",
  },
];

export const DEMO_BRAND_KIT = {
  id: "d1000000-0000-4000-8000-000000000a01",
  user_id: "demo",
  name: "Milkovic (demo)",
  logo_url: null,
  colors: ["#12203a", "#a9631a", "#f4f1ea"],
  fonts: { heading: "Serif", body: "Serif" },
  author_photo_url: null,
  author_bio: "[author: your bio goes here]",
  company_name: "",
  company_details: "",
  is_default: true,
  created_at: "2026-02-02T09:00:00.000Z",
  updated_at: "2026-02-02T09:00:00.000Z",
};
