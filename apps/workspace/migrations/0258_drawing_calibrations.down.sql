-- Reverse 0236. ORDER: roll the frontend and the agent back first; the newer
-- builds read `drawing_calibrations` when a drawing is measured.
--
-- LOSSY: every calibration is deleted. A region a person had calibrated reads
-- as estimated or uncalibrated again; nothing else referenced the rows.
DROP TABLE IF EXISTS "drawing_calibrations";
