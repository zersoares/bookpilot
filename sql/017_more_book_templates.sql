-- =====================================================================
-- BookPilot — more Book Builder templates
--
-- Eight further starting templates, added after 008_book_builder_seed.sql.
-- Same shape as the first eleven: a starting architecture the Book Architect
-- works from, not a finished blueprint. `on conflict do nothing` makes this
-- safe to run more than once, and it never overwrites an edited template.
--
-- The demo workspace serves the same rows from js/data/book-templates.js;
-- tests/book-templates.test.mjs fails if the two drift apart.
--
-- Run after 008_book_builder_seed.sql.
-- =====================================================================

insert into public.book_templates
  (id, category, name, description, theme_id, audience_hint, purpose, writing_style,
   target_pages, sort_order, structure)
values
  ('lead_magnet_guide', 'Marketing', 'The Short Guide',
   'A short guide that solves one problem well, built to be given away in exchange for an email address.',
   'minimal', 'Readers who found you through an ad or a search and want one answer fast', 'lead_generation', 'practical', 40, 11,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'The Problem', 'chapters', jsonb_build_array(
       'The one problem this guide solves', 'Why the usual advice falls short')),
     jsonb_build_object('title', 'The Fix', 'chapters', jsonb_build_array(
       'Step one: the setup', 'Step two: the move', 'Step three: the check')),
     jsonb_build_object('title', 'Next', 'chapters', jsonb_build_array(
       'A worked example', 'What to do this week', 'Where to go from here'))))),

  ('guided_workbook', 'Self-help', 'The Guided Workbook',
   'Prompts, exercises and space to write: a book the reader completes rather than reads.',
   'wellness', 'Readers who learn by doing', 'educate', 'mentor', 120, 12,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Start Here', 'chapters', jsonb_build_array(
       'How to use this workbook', 'The baseline check-in')),
     jsonb_build_object('title', 'The Exercises', 'chapters', jsonb_build_array(
       'Set one: notice', 'Set two: name it', 'Set three: decide', 'Set four: practise', 'Review points')),
     jsonb_build_object('title', 'Keeping Going', 'chapters', jsonb_build_array(
       'Your first month', 'When you slip', 'Your one-page plan'))))),

  ('career_change', 'Career', 'The Career Change Roadmap',
   'For people moving from one line of work to another, with the money and the story both handled.',
   'modern_business', 'Mid-career professionals planning a move', 'authority', 'practical', 180, 13,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Deciding', 'chapters', jsonb_build_array(
       'Is it the job or the field?', 'What you already have', 'The money you need')),
     jsonb_build_object('title', 'Moving', 'chapters', jsonb_build_array(
       'Choosing the target', 'Closing the gap', 'Your CV, told truthfully', 'Interviews for a role you have not done')),
     jsonb_build_object('title', 'Landing', 'chapters', jsonb_build_array(
       'The first ninety days', 'Letting go of the old identity', 'If it does not work'))))),

  ('productivity_system', 'Productivity', 'The Focus System',
   'A complete method for getting meaningful work done, built from small daily habits.',
   'minimal', 'Busy people who have already tried the apps', 'educate', 'practical', 160, 14,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Clearing the Deck', 'chapters', jsonb_build_array(
       'Where your time actually goes', 'Commitments you never chose', 'A single list')),
     jsonb_build_object('title', 'The Daily Engine', 'chapters', jsonb_build_array(
       'The morning start', 'Deep work blocks', 'Email and messages', 'The shutdown')),
     jsonb_build_object('title', 'The Weekly Layer', 'chapters', jsonb_build_array(
       'The weekly review', 'Saying no without apologising', 'When the system breaks'))))),

  ('parenting_practical', 'Parenting', 'The Parent''s Field Guide',
   'Chapters for the situations that actually come up, with words you can use tonight.',
   'wellness', 'Parents of children under twelve', 'educate', 'conversational', 200, 15,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'The Early Years', 'chapters', jsonb_build_array(
       'Sleep', 'Food', 'Tantrums, decoded')),
     jsonb_build_object('title', 'School Age', 'chapters', jsonb_build_array(
       'Homework without a war', 'Friends and falling out', 'Screens')),
     jsonb_build_object('title', 'Growing Up', 'chapters', jsonb_build_array(
       'Big feelings', 'Honest conversations', 'Letting go a little at a time'))))),

  ('cookbook_seasonal', 'Cooking', 'The Seasonal Cookbook',
   'Recipes grouped by season, each part opened by a short essay.',
   'editorial', 'Home cooks who want fewer, better recipes', 'sell', 'storytelling', 180, 16,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Spring', 'chapters', jsonb_build_array(
       'First greens', 'Long lunches')),
     jsonb_build_object('title', 'Summer', 'chapters', jsonb_build_array(
       'Cooking without the oven', 'Fruit and preserves', 'Sunday tables')),
     jsonb_build_object('title', 'Autumn', 'chapters', jsonb_build_array(
       'Roots and squash', 'Slow braises')),
     jsonb_build_object('title', 'Winter', 'chapters', jsonb_build_array(
       'Soups that feed a week', 'Bread and bakes', 'Tables for a crowd'))))),

  ('compliance_explained', 'Law & compliance', 'Regulation, Explained',
   'A plain-language guide to one regulation: who it applies to, what it requires and what to do first. Written as guidance, not legal advice.',
   'academic', 'Owners and managers who carry compliance without a legal team', 'authority', 'professional', 170, 17,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'What the Rules Are', 'chapters', jsonb_build_array(
       'Why the rules exist', 'Who they apply to', 'The key terms')),
     jsonb_build_object('title', 'What They Require', 'chapters', jsonb_build_array(
       'The core obligations', 'Records and evidence', 'Working with suppliers', 'When something goes wrong')),
     jsonb_build_object('title', 'Getting Compliant', 'chapters', jsonb_build_array(
       'A first-month plan', 'The checklist', 'Staying compliant'))))),

  ('relationships_talk', 'Relationships', 'Talking It Through',
   'A guide to the hard conversations in a relationship, with the words to begin them.',
   'feminine_modern', 'Adults with one conversation they keep avoiding', 'educate', 'mentor', 170, 18,
   jsonb_build_object('parts', jsonb_build_array(
     jsonb_build_object('title', 'Why It Goes Wrong', 'chapters', jsonb_build_array(
       'The conversation you keep having', 'What you are really asking for', 'The trigger')),
     jsonb_build_object('title', 'Saying It', 'chapters', jsonb_build_array(
       'How to begin', 'Listening properly', 'Money', 'Family')),
     jsonb_build_object('title', 'After', 'chapters', jsonb_build_array(
       'When it goes badly', 'Repair', 'Keeping it easier next time')))))
on conflict (id) do nothing;
