-- =====================================================================
-- BookPilot — Book Builder seed data
--
-- Design themes, starting templates, credit costs and feature flags.
-- Everything here is editable afterwards; these are starting values.
--
-- The canonical theme geometry lives in
-- netlify/functions/bookpilot-lib/doc/themes.js, because the document
-- engine has to lay out a page whether or not the database answers.
-- The rows below are what the picker shows and what a project points at.
--
-- Run after 007_book_builder_rls.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Interior design themes (spec 16)
-- ---------------------------------------------------------------------
insert into public.book_design_themes
  (id, name, tagline, description, body_font, heading_font, base_font_pt, "leading",
   accent_color, chapter_style, sort_order)
values
  ('editorial', 'Editorial', 'Magazine-inspired premium typography',
   'Serif text with a generous measure, small-caps running heads and a numbered chapter opener that sits a third of the way down the page.',
   'serif', 'sans', 11, 1.52, '#1f2a44', 'numbered', 0),

  ('luxury', 'Luxury', 'Elegant typography, sophisticated spacing',
   'Wide margins, letter-spaced display headings and a rule-and-numeral chapter opener. Reads slowly on purpose.',
   'serif', 'serif', 11.5, 1.62, '#8a6a2f', 'rule', 1),

  ('modern_business', 'Modern Business', 'Professional corporate publication',
   'Sans-serif headings, tight subheads and callout panels for frameworks, checklists and key takeaways.',
   'sans', 'sans', 10.5, 1.5, '#1b4f72', 'band', 2),

  ('minimal', 'Minimal', 'Clean, spacious and simple',
   'One typeface, one weight of emphasis, nothing on the page that is not the text. Chapter openers are a single line.',
   'sans', 'sans', 11, 1.55, '#2b2b2b', 'plain', 3),

  ('wellness', 'Wellness', 'Soft editorial aesthetic',
   'Warm serif text, airy leading and rounded quote panels for exercises and reflections.',
   'serif', 'sans', 11.5, 1.62, '#4f7360', 'display', 4),

  ('feminine_modern', 'Feminine Modern', 'Contemporary lifestyle design',
   'High-contrast display headings over an open serif text face, with an accent rule that carries through the running heads.',
   'serif', 'serif', 11, 1.58, '#9b4a6b', 'display', 5),

  ('academic', 'Academic', 'Structured and highly readable',
   'Numbered sections, a narrow measure sized for citations, and footnote-style references at the back.',
   'serif', 'serif', 10.5, 1.48, '#3f3aa8', 'numbered', 6),

  ('entrepreneur', 'Entrepreneur', 'Bold business-book style',
   'Heavy display numerals, short measure, wide callouts. Built for books read in airports.',
   'sans', 'sans', 11, 1.5, '#a9631a', 'band', 7)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Templates (spec 28)
--
-- `structure` is a starting architecture, not a finished blueprint: the
-- Book Architect works from it and the author edits what comes back.
-- ---------------------------------------------------------------------
insert into public.book_templates
  (id, category, name, description, theme_id, audience_hint, purpose, writing_style,
   target_pages, sort_order, structure)
values
  ('business_authority', 'Business', 'The Authority Book',
   'The book a consultant writes to stop explaining the same thing on every call.',
   'modern_business', 'Decision-makers who already have the problem', 'authority', 'professional', 160, 0,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'The Problem Nobody Names', 'chapters', jsonb_build_array(
       'Why the usual answer stopped working', 'What it actually costs', 'The three symptoms')),
     jsonb_build_object('title', 'The Method', 'chapters', jsonb_build_array(
       'The principle', 'The framework', 'Running it for the first time', 'What goes wrong')),
     jsonb_build_object('title', 'In Practice', 'chapters', jsonb_build_array(
       'A case from the field', 'Making it stick', 'The first ninety days'))))),

  ('self_help_transformation', 'Self-help', 'The Transformation Book',
   'A structured path from where the reader is to where they want to be, one chapter per step.',
   'wellness', 'Someone mid-change who wants a sequence, not a pep talk', 'educate', 'mentor', 180, 1,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Where You Are', 'chapters', jsonb_build_array(
       'The honest inventory', 'What you were told', 'What is actually true')),
     jsonb_build_object('title', 'The Work', 'chapters', jsonb_build_array(
       'The first shift', 'Building the habit', 'When it stops working', 'The turn')),
     jsonb_build_object('title', 'The New Normal', 'chapters', jsonb_build_array(
       'Holding the ground', 'Telling people', 'What comes next'))))),

  ('womens_rebuild', 'Women''s books', 'Rebuilding After Change',
   'For readers navigating divorce, redundancy, bereavement or relocation. Practical, never pitying.',
   'feminine_modern', 'Women rebuilding after a major life change', 'educate', 'mentor', 200, 2,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'The Ground Gives Way', 'chapters', jsonb_build_array(
       'The week everything changed', 'Grief is admin too', 'Who you can actually call')),
     jsonb_build_object('title', 'Standing Up', 'chapters', jsonb_build_array(
       'Money, plainly', 'Your name on the paperwork', 'Work again', 'The body keeps score')),
     jsonb_build_object('title', 'Building', 'chapters', jsonb_build_array(
       'A home that is yours', 'New people', 'The version of you that comes next'))))),

  ('finance_practical', 'Finance', 'Money, Explained Properly',
   'Plain-language personal finance with worked examples and no product pitches.',
   'academic', 'Adults who were never taught this', 'educate', 'practical', 190, 3,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'The Foundations', 'chapters', jsonb_build_array(
       'What money is doing while you sleep', 'Income, tax and what is left', 'The buffer')),
     jsonb_build_object('title', 'Building', 'chapters', jsonb_build_array(
       'Debt, in order', 'Saving that survives a bad month', 'Investing without the folklore')),
     jsonb_build_object('title', 'Protecting', 'chapters', jsonb_build_array(
       'Insurance, honestly', 'Retirement arithmetic', 'Passing it on'))))),

  ('wellness_programme', 'Wellness', 'The Twelve-Week Programme',
   'A dated programme with weekly chapters, exercises and a workbook at the back.',
   'wellness', 'Readers who want a schedule to follow', 'educate', 'practical', 170, 4,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Weeks One to Four: Settling', 'chapters', jsonb_build_array(
       'Week one: the baseline', 'Week two: sleep', 'Week three: movement', 'Week four: food')),
     jsonb_build_object('title', 'Weeks Five to Eight: Building', 'chapters', jsonb_build_array(
       'Week five: strength', 'Week six: stress', 'Week seven: people', 'Week eight: the plateau')),
     jsonb_build_object('title', 'Weeks Nine to Twelve: Keeping', 'chapters', jsonb_build_array(
       'Week nine: rebuilding the week', 'Week ten: travel and disruption',
       'Week eleven: measuring', 'Week twelve: what you keep'))))),

  ('education_course', 'Education', 'The Course Companion',
   'A teaching book: objectives, worked examples, exercises and a summary per chapter.',
   'academic', 'Students and self-teachers', 'educate', 'academic', 220, 5,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Foundations', 'chapters', jsonb_build_array(
       'The vocabulary', 'The first principle', 'Working an example')),
     jsonb_build_object('title', 'Core Skills', 'chapters', jsonb_build_array(
       'Technique one', 'Technique two', 'Putting them together', 'Common mistakes')),
     jsonb_build_object('title', 'Mastery', 'chapters', jsonb_build_array(
       'Harder cases', 'Judgement', 'Where to go next'))))),

  ('entrepreneur_playbook', 'Entrepreneurship', 'The Founder''s Playbook',
   'Short chapters, hard numbers, one decision per chapter.',
   'entrepreneur', 'Operators, not aspirants', 'authority', 'business', 150, 6,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Before You Build', 'chapters', jsonb_build_array(
       'The problem worth having', 'Proof before product', 'The first ten customers')),
     jsonb_build_object('title', 'Building', 'chapters', jsonb_build_array(
       'Pricing', 'The first hire', 'Cash', 'Saying no')),
     jsonb_build_object('title', 'Scaling', 'chapters', jsonb_build_array(
       'Systems', 'The second product', 'When to stop'))))),

  ('memoir_arc', 'Memoir', 'The Memoir Arc',
   'A life told in three movements, with scene-led chapters rather than chronology.',
   'editorial', 'General readers', 'personal', 'storytelling', 240, 7,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Before', 'chapters', jsonb_build_array(
       'The house', 'What we did not say', 'Leaving')),
     jsonb_build_object('title', 'During', 'chapters', jsonb_build_array(
       'The city', 'The work', 'The mistake', 'The people who stayed')),
     jsonb_build_object('title', 'After', 'chapters', jsonb_build_array(
       'Going back', 'What I would tell them', 'Now'))))),

  ('travel_narrative', 'Travel', 'The Travel Narrative',
   'Place-led chapters with practical notes separated from the story.',
   'editorial', 'Readers who travel and readers who do not', 'personal', 'storytelling', 210, 8,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Departure', 'chapters', jsonb_build_array(
       'Why this route', 'The first border', 'Learning to be slow')),
     jsonb_build_object('title', 'The Middle', 'chapters', jsonb_build_array(
       'A city that would not open', 'The road north', 'The kindness of strangers', 'Getting it wrong')),
     jsonb_build_object('title', 'Return', 'chapters', jsonb_build_array(
       'The last week', 'Coming home', 'What travels with you'))))),

  ('technology_explained', 'Technology', 'Technology, Explained',
   'A non-specialist guide: what it is, what it is not, and what to do about it.',
   'minimal', 'Professionals outside the field', 'educate', 'practical', 180, 9,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'What It Actually Is', 'chapters', jsonb_build_array(
       'The idea in one page', 'How it got here', 'What it cannot do')),
     jsonb_build_object('title', 'What It Changes', 'chapters', jsonb_build_array(
       'Your work', 'Your industry', 'The risks worth taking seriously', 'The ones that are noise')),
     jsonb_build_object('title', 'What To Do', 'chapters', jsonb_build_array(
       'The first experiment', 'Buying decisions', 'The next five years'))))),

  ('leadership_field', 'Leadership', 'The Leadership Field Guide',
   'Situational chapters: the conversation, the decision, the crisis.',
   'modern_business', 'First-time and stretched managers', 'authority', 'mentor', 175, 10,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Yourself', 'chapters', jsonb_build_array(
       'The job changed', 'Attention as a budget', 'Your own feedback')),
     jsonb_build_object('title', 'People', 'chapters', jsonb_build_array(
       'The one-to-one that works', 'Hard conversations', 'Hiring', 'Letting someone go')),
     jsonb_build_object('title', 'The Work', 'chapters', jsonb_build_array(
       'Deciding with incomplete information', 'Crisis', 'Handing it over')))))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Credit costs for the authoring operations (spec 35)
--
-- Sized so a free account can take a book through positioning and an
-- outline -- the first value moment -- before it needs a plan.
-- ---------------------------------------------------------------------
insert into public.credit_costs (operation, label, credits) values
  ('book_positioning',   'Book positioning',            5),
  ('book_architecture',  'Book architecture (outline)',15),
  ('book_bible',         'Book Bible',                  8),
  ('chapter_write',      'Write a chapter',            12),
  ('chapter_revise',     'Revise a passage',            4),
  ('front_matter',       'Front matter',                4),
  ('back_matter',        'Back matter',                 4),
  ('editorial_review',   'Editorial review',            6),
  ('research_brief',     'Research brief',              8),
  ('visual_direction',   'Visual direction',            6),
  ('visual_render',      'Render a designed visual',    2),
  ('book_image',         'Book illustration',           5),
  ('cover_concepts',     'Cover concepts',             10),
  ('cover_check',        'Cover review',                3),
  ('quality_report',     'Publication check',          10),
  ('marketing_campaign', 'Book marketing campaign',    20),
  ('repurpose_book',     'Repurpose the book',          8)
on conflict (operation) do nothing;

-- ---------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------
insert into public.feature_flags (key, enabled, description) values
  ('book_builder',         true,  'Book Builder: authoring, design, export'),
  ('book_image_generation', false, 'AI illustration rendering for book interiors and covers'),
  ('template_marketplace', false, 'Paid template marketplace'),
  ('book_export',          true,  'PDF, EPUB, DOCX and HTML export')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('max_projects_per_user',    to_jsonb(50)),
  ('max_chapter_words',        to_jsonb(6000)),
  ('export_watermark_plans',   jsonb_build_array('free')),
  ('book_builder_version',     to_jsonb('1.0'::text))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Plan features: say what the authoring side includes.
-- Prices are untouched -- they are the operator's to set (spec 34).
-- ---------------------------------------------------------------------
update public.plans set features = jsonb_build_array(
  '1 book project', 'Positioning and outline', '25 AI credits per month',
  'Watermarked export', 'Demo workspace'
) where id = 'free';

update public.plans set features = jsonb_build_array(
  'Up to 3 book projects', '100 AI credits per month', 'AI writing and editing',
  'All design themes', 'PDF and EPUB export', 'Marketing studio'
) where id = 'author';

update public.plans set features = jsonb_build_array(
  'Unlimited book projects', '500 AI credits per month', 'Advanced design controls',
  'Cover studio', 'PDF, EPUB, DOCX and HTML export', 'Brand Kit', 'Advanced marketing'
) where id = 'author_pro';

update public.plans set features = jsonb_build_array(
  'Multiple authors', 'Unlimited projects', 'Team projects', 'Client management',
  'White-label export', 'Bulk generation', '2000 AI credits per month'
) where id = 'publisher';
