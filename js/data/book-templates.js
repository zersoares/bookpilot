// Starting templates for the Book Builder (spec 28).
//
// These are the same rows the database holds: sql/008_book_builder_seed.sql
// (the first eleven) and sql/017_more_book_templates.sql (the rest). The demo
// has no database, so it serves this copy; tests/book-templates.test.mjs
// fails if the two ever disagree about which templates exist.
//
// A template is a starting architecture, not a finished blueprint: the Book
// Architect begins from it and the author edits what comes back. Nothing
// here is a promise about how a book will sell.

const part = (title, ...chapters) => ({ title, chapters });

const template = (sort_order, id, category, name, description, theme_id, audience_hint,
  purpose, writing_style, target_pages, ...parts) => ({
  id, category, name, description, theme_id, audience_hint, purpose, writing_style,
  target_pages, structure: { parts }, is_premium: false, is_active: true, sort_order,
});

export const BOOK_TEMPLATES = [
  // ---- 008_book_builder_seed.sql ------------------------------------
  template(0, "business_authority", "Business", "The Authority Book",
    "The book a consultant writes to stop explaining the same thing on every call.",
    "modern_business", "Decision-makers who already have the problem", "authority", "professional", 160,
    part("The Problem Nobody Names", "Why the usual answer stopped working", "What it actually costs", "The three symptoms"),
    part("The Method", "The principle", "The framework", "Running it for the first time", "What goes wrong"),
    part("In Practice", "A case from the field", "Making it stick", "The first ninety days")),

  template(1, "self_help_transformation", "Self-help", "The Transformation Book",
    "A structured path from where the reader is to where they want to be, one chapter per step.",
    "wellness", "Someone mid-change who wants a sequence, not a pep talk", "educate", "mentor", 180,
    part("Where You Are", "The honest inventory", "What you were told", "What is actually true"),
    part("The Work", "The first shift", "Building the habit", "When it stops working", "The turn"),
    part("The New Normal", "Holding the ground", "Telling people", "What comes next")),

  template(2, "womens_rebuild", "Women's books", "Rebuilding After Change",
    "For readers navigating divorce, redundancy, bereavement or relocation. Practical, never pitying.",
    "feminine_modern", "Women rebuilding after a major life change", "educate", "mentor", 200,
    part("The Ground Gives Way", "The week everything changed", "Grief is admin too", "Who you can actually call"),
    part("Standing Up", "Money, plainly", "Your name on the paperwork", "Work again", "The body keeps score"),
    part("Building", "A home that is yours", "New people", "The version of you that comes next")),

  template(3, "finance_practical", "Finance", "Money, Explained Properly",
    "Plain-language personal finance with worked examples and no product pitches.",
    "academic", "Adults who were never taught this", "educate", "practical", 190,
    part("The Foundations", "What money is doing while you sleep", "Income, tax and what is left", "The buffer"),
    part("Building", "Debt, in order", "Saving that survives a bad month", "Investing without the folklore"),
    part("Protecting", "Insurance, honestly", "Retirement arithmetic", "Passing it on")),

  template(4, "wellness_programme", "Wellness", "The Twelve-Week Programme",
    "A dated programme with weekly chapters, exercises and a workbook at the back.",
    "wellness", "Readers who want a schedule to follow", "educate", "practical", 170,
    part("Weeks One to Four: Settling", "Week one: the baseline", "Week two: sleep", "Week three: movement", "Week four: food"),
    part("Weeks Five to Eight: Building", "Week five: strength", "Week six: stress", "Week seven: people", "Week eight: the plateau"),
    part("Weeks Nine to Twelve: Keeping", "Week nine: rebuilding the week", "Week ten: travel and disruption",
      "Week eleven: measuring", "Week twelve: what you keep")),

  template(5, "education_course", "Education", "The Course Companion",
    "A teaching book: objectives, worked examples, exercises and a summary per chapter.",
    "academic", "Students and self-teachers", "educate", "academic", 220,
    part("Foundations", "The vocabulary", "The first principle", "Working an example"),
    part("Core Skills", "Technique one", "Technique two", "Putting them together", "Common mistakes"),
    part("Mastery", "Harder cases", "Judgement", "Where to go next")),

  template(6, "entrepreneur_playbook", "Entrepreneurship", "The Founder's Playbook",
    "Short chapters, hard numbers, one decision per chapter.",
    "entrepreneur", "Operators, not aspirants", "authority", "business", 150,
    part("Before You Build", "The problem worth having", "Proof before product", "The first ten customers"),
    part("Building", "Pricing", "The first hire", "Cash", "Saying no"),
    part("Scaling", "Systems", "The second product", "When to stop")),

  template(7, "memoir_arc", "Memoir", "The Memoir Arc",
    "A life told in three movements, with scene-led chapters rather than chronology.",
    "editorial", "General readers", "personal", "storytelling", 240,
    part("Before", "The house", "What we did not say", "Leaving"),
    part("During", "The city", "The work", "The mistake", "The people who stayed"),
    part("After", "Going back", "What I would tell them", "Now")),

  template(8, "travel_narrative", "Travel", "The Travel Narrative",
    "Place-led chapters with practical notes separated from the story.",
    "editorial", "Readers who travel and readers who do not", "personal", "storytelling", 210,
    part("Departure", "Why this route", "The first border", "Learning to be slow"),
    part("The Middle", "A city that would not open", "The road north", "The kindness of strangers", "Getting it wrong"),
    part("Return", "The last week", "Coming home", "What travels with you")),

  template(9, "technology_explained", "Technology", "Technology, Explained",
    "A non-specialist guide: what it is, what it is not, and what to do about it.",
    "minimal", "Professionals outside the field", "educate", "practical", 180,
    part("What It Actually Is", "The idea in one page", "How it got here", "What it cannot do"),
    part("What It Changes", "Your work", "Your industry", "The risks worth taking seriously", "The ones that are noise"),
    part("What To Do", "The first experiment", "Buying decisions", "The next five years")),

  template(10, "leadership_field", "Leadership", "The Leadership Field Guide",
    "Situational chapters: the conversation, the decision, the crisis.",
    "modern_business", "First-time and stretched managers", "authority", "mentor", 175,
    part("Yourself", "The job changed", "Attention as a budget", "Your own feedback"),
    part("People", "The one-to-one that works", "Hard conversations", "Hiring", "Letting someone go"),
    part("The Work", "Deciding with incomplete information", "Crisis", "Handing it over")),

  // ---- 017_more_book_templates.sql ----------------------------------
  template(11, "lead_magnet_guide", "Marketing", "The Short Guide",
    "A short guide that solves one problem well, built to be given away in exchange for an email address.",
    "minimal", "Readers who found you through an ad or a search and want one answer fast",
    "lead_generation", "practical", 40,
    part("The Problem", "The one problem this guide solves", "Why the usual advice falls short"),
    part("The Fix", "Step one: the setup", "Step two: the move", "Step three: the check"),
    part("Next", "A worked example", "What to do this week", "Where to go from here")),

  template(12, "guided_workbook", "Self-help", "The Guided Workbook",
    "Prompts, exercises and space to write: a book the reader completes rather than reads.",
    "wellness", "Readers who learn by doing", "educate", "mentor", 120,
    part("Start Here", "How to use this workbook", "The baseline check-in"),
    part("The Exercises", "Set one: notice", "Set two: name it", "Set three: decide", "Set four: practise", "Review points"),
    part("Keeping Going", "Your first month", "When you slip", "Your one-page plan")),

  template(13, "career_change", "Career", "The Career Change Roadmap",
    "For people moving from one line of work to another, with the money and the story both handled.",
    "modern_business", "Mid-career professionals planning a move", "authority", "practical", 180,
    part("Deciding", "Is it the job or the field?", "What you already have", "The money you need"),
    part("Moving", "Choosing the target", "Closing the gap", "Your CV, told truthfully",
      "Interviews for a role you have not done"),
    part("Landing", "The first ninety days", "Letting go of the old identity", "If it does not work")),

  template(14, "productivity_system", "Productivity", "The Focus System",
    "A complete method for getting meaningful work done, built from small daily habits.",
    "minimal", "Busy people who have already tried the apps", "educate", "practical", 160,
    part("Clearing the Deck", "Where your time actually goes", "Commitments you never chose", "A single list"),
    part("The Daily Engine", "The morning start", "Deep work blocks", "Email and messages", "The shutdown"),
    part("The Weekly Layer", "The weekly review", "Saying no without apologising", "When the system breaks")),

  template(15, "parenting_practical", "Parenting", "The Parent's Field Guide",
    "Chapters for the situations that actually come up, with words you can use tonight.",
    "wellness", "Parents of children under twelve", "educate", "conversational", 200,
    part("The Early Years", "Sleep", "Food", "Tantrums, decoded"),
    part("School Age", "Homework without a war", "Friends and falling out", "Screens"),
    part("Growing Up", "Big feelings", "Honest conversations", "Letting go a little at a time")),

  template(16, "cookbook_seasonal", "Cooking", "The Seasonal Cookbook",
    "Recipes grouped by season, each part opened by a short essay.",
    "editorial", "Home cooks who want fewer, better recipes", "sell", "storytelling", 180,
    part("Spring", "First greens", "Long lunches"),
    part("Summer", "Cooking without the oven", "Fruit and preserves", "Sunday tables"),
    part("Autumn", "Roots and squash", "Slow braises"),
    part("Winter", "Soups that feed a week", "Bread and bakes", "Tables for a crowd")),

  template(17, "compliance_explained", "Law & compliance", "Regulation, Explained",
    "A plain-language guide to one regulation: who it applies to, what it requires and what to do first. Written as guidance, not legal advice.",
    "academic", "Owners and managers who carry compliance without a legal team", "authority", "professional", 170,
    part("What the Rules Are", "Why the rules exist", "Who they apply to", "The key terms"),
    part("What They Require", "The core obligations", "Records and evidence", "Working with suppliers", "When something goes wrong"),
    part("Getting Compliant", "A first-month plan", "The checklist", "Staying compliant")),

  template(18, "relationships_talk", "Relationships", "Talking It Through",
    "A guide to the hard conversations in a relationship, with the words to begin them.",
    "feminine_modern", "Adults with one conversation they keep avoiding", "educate", "mentor", 170,
    part("Why It Goes Wrong", "The conversation you keep having", "What you are really asking for", "The trigger"),
    part("Saying It", "How to begin", "Listening properly", "Money", "Family"),
    part("After", "When it goes badly", "Repair", "Keeping it easier next time")),
];
