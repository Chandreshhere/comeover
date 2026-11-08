-- 003: reference/taxonomy data only (no demo users or plans). Idempotent.
INSERT INTO activity_categories (slug, label, short, pictogram, risk_level, sort_order) VALUES
  ('chai', 'Chai & coffee', 'Chai', 'chai', 'standard', 10),
  ('badminton', 'Badminton', 'Badminton', 'badminton', 'standard', 20),
  ('gym', 'Gym partner', 'Gym', 'gym', 'standard', 30),
  ('walk', 'Walks', 'Walk', 'walk', 'standard', 40),
  ('run', 'Running', 'Run', 'run', 'standard', 50),
  ('cowork', 'Coworking', 'Cowork', 'laptop', 'standard', 60),
  ('study', 'Study', 'Study', 'book', 'standard', 70),
  ('food', 'Food walks', 'Food', 'food', 'standard', 80),
  ('boardgames', 'Board games', 'Games', 'board', 'standard', 90),
  ('gaming', 'Gaming', 'Gaming', 'game', 'standard', 100),
  ('movies', 'Movies', 'Movies', 'film', 'standard', 110),
  ('music', 'Music & jams', 'Music', 'music', 'standard', 120),
  ('photo', 'Photography', 'Photo', 'camera', 'standard', 130),
  ('explore', 'City explore', 'Explore', 'pin', 'elevated', 140)
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label, short = EXCLUDED.short, pictogram = EXCLUDED.pictogram, sort_order = EXCLUDED.sort_order;

INSERT INTO levels (level, name, xp_threshold, subtitle, pictogram) VALUES
  (1, 'Newcomer', 0, 'Welcome to IRL', 'sparkle'),
  (2, 'First Hello', 40, 'Complete your first meetup', 'chat'),
  (3, 'Regular', 100, 'Keep showing up', 'check'),
  (4, 'Explorer', 160, 'Try different kinds of plans', 'pin'),
  (5, 'Connector', 300, 'Meet new people regularly', 'people'),
  (6, 'Host', 480, 'Host plans that happen', 'star'),
  (7, 'Circle Builder', 700, 'Grow a circle', 'board'),
  (8, 'Local Legend', 1000, '50 meetups · reliable host', 'sparkle')
ON CONFLICT (level) DO UPDATE SET name = EXCLUDED.name, xp_threshold = EXCLUDED.xp_threshold, subtitle = EXCLUDED.subtitle, pictogram = EXCLUDED.pictogram;

-- Quest criteria are evaluated server-side by src/lib/quests.js (evaluateQuest).
INSERT INTO quests (slug, title, description, criteria, xp_reward, kind, pictogram) VALUES
  ('q_new_person', 'Chai with someone new', 'Complete 1 plan with a new person', '{"type":"new_people","count":1,"window":"day"}', 40, 'daily', 'chai'),
  ('q_new_category', 'Explore a new category', 'Try something you have not done yet', '{"type":"new_category","count":1,"window":"week"}', 60, 'weekly', 'sparkle'),
  ('q_weekly_goal', 'Weekly goal', '2 verified meetups this week', '{"type":"complete_activities","count":2,"window":"week"}', 80, 'weekly', 'calendar'),
  ('q_host', 'Host a micro-plan', 'Host one plan that actually happens', '{"type":"host_completed","count":1,"window":"week"}', 100, 'weekly', 'people'),
  ('q_early', 'Early bird', 'Join a plan that starts before 8 AM', '{"type":"early_activity","count":1,"beforeHour":8,"window":"day"}', 30, 'daily', 'sun')
ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, criteria = EXCLUDED.criteria, xp_reward = EXCLUDED.xp_reward, kind = EXCLUDED.kind, pictogram = EXCLUDED.pictogram;

INSERT INTO achievements (slug, title, description, pictogram, color, criteria) VALUES
  ('b_chai', 'Chai Champ', 'Complete 3 chai plans', 'chai', 'orange', '{"type":"category_completed","category":"chai","count":3}'),
  ('b_early', 'Early Bird', 'Complete a plan starting before 7 AM', 'sun', 'periwinkle', '{"type":"early_activity","beforeHour":7,"count":1,"window":"all"}'),
  ('b_reliable', 'Reliable', '95%+ show-up across 10 plans', 'shield', 'mint', '{"type":"reliability","min":0.95,"minPlans":10}'),
  ('b_court', 'Court Regular', 'Play badminton 5 times', 'badminton', 'pink', '{"type":"category_completed","category":"badminton","count":5}'),
  ('b_night', 'Night Owl', 'Complete 3 plans after 9 PM', 'film', 'lavender', '{"type":"late_activity","afterHour":21,"count":3,"window":"all"}'),
  ('b_trail', 'Trailblazer', 'Try 6 categories', 'pin', 'orange', '{"type":"distinct_categories","count":6}'),
  ('b_host', 'Good Host', 'Host 3 completed plans with no cancellations', 'people', 'periwinkle', '{"type":"host_completed","count":3,"window":"all"}')
ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, criteria = EXCLUDED.criteria, color = EXCLUDED.color, pictogram = EXCLUDED.pictogram;

-- Ahmedabad pilot clusters (manual area selection when location is off).
INSERT INTO city_areas (city, name, centroid) VALUES
  ('Ahmedabad', 'Navrangpura', ST_SetSRID(ST_MakePoint(72.5600, 23.0370), 4326)::geography),
  ('Ahmedabad', 'Bodakdev', ST_SetSRID(ST_MakePoint(72.5070, 23.0400), 4326)::geography),
  ('Ahmedabad', 'Satellite', ST_SetSRID(ST_MakePoint(72.5250, 23.0270), 4326)::geography),
  ('Ahmedabad', 'Vastrapur', ST_SetSRID(ST_MakePoint(72.5290, 23.0370), 4326)::geography),
  ('Ahmedabad', 'Prahlad Nagar', ST_SetSRID(ST_MakePoint(72.5090, 23.0120), 4326)::geography),
  ('Ahmedabad', 'SG Highway', ST_SetSRID(ST_MakePoint(72.5070, 23.0600), 4326)::geography),
  ('Ahmedabad', 'Law Garden', ST_SetSRID(ST_MakePoint(72.5600, 23.0270), 4326)::geography),
  ('Ahmedabad', 'Riverfront', ST_SetSRID(ST_MakePoint(72.5770, 23.0300), 4326)::geography),
  ('Ahmedabad', 'Old City', ST_SetSRID(ST_MakePoint(72.5880, 23.0250), 4326)::geography)
ON CONFLICT (city, name) DO NOTHING;
