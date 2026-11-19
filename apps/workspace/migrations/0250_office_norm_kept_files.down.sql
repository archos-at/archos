-- Reverse 0250. ORDER: roll the frontend back first; the newer build reads the
-- table on every scan of the office shelf for norms.
--
-- LOSSY: every „Im Ordner lassen“ decision is forgotten, and ARCHOS offers those
-- files for Normen & Richtlinien again.
DROP TABLE IF EXISTS "office_norm_kept_files";
